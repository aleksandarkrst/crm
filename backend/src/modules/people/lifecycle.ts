import { BadRequestException, ConflictException, HttpException, NotFoundException } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { AuditService } from '../../shared/audit/audit.service';
import type { TenantContext } from '../../shared/authorization';
import type { Tx } from '../../shared/database/database.service';
import { type DeactivationPlan, departments, employeePersonal, employeeRoles, employees, type LeavingReason, teams, tenants } from '../../shared/database/schema';
import type { JobsService } from '../../shared/events/jobs.service';
import { removeMembership, withdrawEmployeeInvitations } from '../identity';
import { assertValidManager, type ManagerChange, queueManagerEmails } from './reporting-lines';

/**
 * Leaving and linking (spec 4.6, 4.8): the parts the API (EmployeeLifecycleService) and the worker
 * (people.deactivate-due) share. Everything runs in the caller's transaction, with the reporting
 * line lock already taken where managers change.
 */

/** The workspace's local date and minutes since midnight at `now` (its IANA time zone; UTC if unknown). */
export function zonedParts(timeZone: string, now: Date): { date: string; minutes: number } {
  const format = (tz: string) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = format(timeZone);
  } catch {
    parts = format('UTC');
  }
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

/** `yyyy-mm-dd` moved by whole days. */
export function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Today in the workspace's time zone. */
export async function workspaceToday(tx: Tx, tenantId: string, now = new Date()): Promise<string> {
  const [t] = await tx.select({ timezone: tenants.timezone }).from(tenants).where(eq(tenants.id, tenantId));
  return zonedParts(t?.timezone ?? 'UTC', now).date;
}

/**
 * Why a member's employee record can't be merged into another one by "Link to member" (spec 4.6):
 * it holds data of its own. Empty for a record made automatically when they joined (no
 * department, manager, reports, leads, roles or personal details). Workforce modules (14–21) add
 * their data here as they ship.
 */
export async function mergeBlockers(tx: Tx, employeeId: string): Promise<string[]> {
  const [e] = await tx
    .select({
      departmentId: employees.departmentId,
      managerId: employees.managerId,
      reports: sql<number>`(select count(*)::int from ${employees} r where r.manager_id = ${employees.id})`,
      leads: sql<number>`(select count(*)::int from ${teams} t where t.lead_employee_id = ${employees.id})`,
      heads: sql<number>`(select count(*)::int from ${departments} d where d.head_employee_id = ${employees.id})`,
      roles: sql<number>`(select count(*)::int from ${employeeRoles} er where er.employee_id = ${employees.id})`,
      personal: sql<boolean>`exists (select 1 from ${employeePersonal} p where p.employee_id = ${employees.id})`,
    })
    .from(employees)
    .where(eq(employees.id, employeeId));
  if (!e) return [];
  const out: string[] = [];
  if (e.departmentId) out.push('a department');
  if (e.managerId) out.push('a manager');
  if (e.reports) out.push('direct reports');
  if (e.leads) out.push('a team they lead');
  if (e.heads) out.push('a department they head');
  if (e.roles) out.push('HR roles');
  if (e.personal) out.push('personal details or a bank account');
  return out;
}

/** "a department and a manager". */
export const listBlockers = (b: string[]) => (b.length <= 1 ? (b[0] ?? '') : `${b.slice(0, -1).join(', ')} and ${b.at(-1)}`);

export interface ApplyDeactivation {
  employeeId: string;
  lastWorkingDay: string;
  reason: LeavingReason | null;
  plan: Omit<DeactivationPlan, 'byUserId'>;
  /**
   * The daily job: a planned manager or replacement who left (or would now close a loop) since the
   * dialog falls back to the leaving person's own manager, else nobody, instead of failing. The
   * dialog's immediate path is strict: the choice was just validated.
   */
  lenient: boolean;
}

export interface LifecycleDeps {
  audit: AuditService;
  jobs: JobsService;
}

/**
 * Applies a deactivation (spec 4.8), in `tx` under the reporting-line lock: status Inactive (end
 * date, reason), direct reports to the chosen manager, team leads and department heads replaced or
 * cleared, pending invitations withdrawn, the membership removed through identity (the last owner
 * can't go: 409), and "people.employee-deactivated" for other modules. Returns how many reports moved.
 */
export async function applyDeactivation(tx: Tx, deps: LifecycleDeps, ctx: TenantContext, input: ApplyDeactivation): Promise<{ movedReports: number }> {
  const [e] = await tx
    .select({ id: employees.id, userId: employees.userId, managerId: employees.managerId, deactivatedAt: employees.deactivatedAt, fullName: employees.fullName })
    .from(employees)
    .where(eq(employees.id, input.employeeId))
    .for('update');
  if (!e) throw new NotFoundException('Employee not found');
  if (e.deactivatedAt) throw new ConflictException(`${e.fullName} has already left`);

  const active = async (id: string | null) => {
    if (!id || id === e.id) return false;
    const [row] = await tx.select({ id: employees.id }).from(employees).where(and(eq(employees.id, id), isNull(employees.deactivatedAt)));
    return !!row;
  };
  const skipLevel = (await active(e.managerId)) ? e.managerId : null;

  // Direct reports: to the chosen manager. One of the reports chosen as the new manager reports to
  // the leaving person's own manager instead (they can't report to themselves).
  const reports = await tx
    .select({ id: employees.id })
    .from(employees)
    .where(and(eq(employees.managerId, e.id), isNull(employees.deactivatedAt)));
  let chosen = input.plan.reportsManagerId;
  if (chosen && !(await active(chosen))) {
    if (!input.lenient) throw new BadRequestException('The new manager must be an active employee other than the person leaving');
    chosen = skipLevel;
  }
  const moved: ManagerChange[] = [];
  for (const r of reports) {
    const candidates = [r.id === chosen ? skipLevel : chosen, ...(input.lenient ? [skipLevel, null] : [])];
    let done = false;
    for (const target of candidates) {
      try {
        await assertValidManager(tx, r.id, target);
      } catch (err) {
        if (input.lenient && err instanceof HttpException) continue;
        throw err;
      }
      await tx.update(employees).set({ managerId: target }).where(eq(employees.id, r.id));
      moved.push({ employeeId: r.id, oldManagerId: e.id, newManagerId: target });
      done = true;
      break;
    }
    if (!done) await tx.update(employees).set({ managerId: null }).where(eq(employees.id, r.id));
  }
  // One "New manager" email per moved report; the new manager isn't told (spec 10.2).
  await queueManagerEmails(deps.jobs, tx, ctx.tenantId, ctx.userId, moved, { manager: false });

  // Team leads and department heads they hold: the replacement, or nobody.
  const leads = await tx.select({ id: teams.id }).from(teams).where(eq(teams.leadEmployeeId, e.id));
  for (const t of leads) {
    const pick = input.plan.teamLeads.find((x) => x.teamId === t.id)?.employeeId ?? null;
    const ok = await active(pick);
    if (pick && !ok && !input.lenient) throw new BadRequestException('A new team lead must be an active employee other than the person leaving');
    await tx.update(teams).set({ leadEmployeeId: ok ? pick : null }).where(eq(teams.id, t.id));
  }
  const heads = await tx.select({ id: departments.id }).from(departments).where(eq(departments.headEmployeeId, e.id));
  for (const d of heads) {
    const pick = input.plan.departmentHeads.find((x) => x.departmentId === d.id)?.employeeId ?? null;
    const ok = await active(pick);
    if (pick && !ok && !input.lenient) throw new BadRequestException('A new department head must be an active employee other than the person leaving');
    await tx.update(departments).set({ headEmployeeId: ok ? pick : null }).where(eq(departments.id, d.id));
  }

  await tx
    .update(employees)
    .set({ deactivatedAt: new Date(), employmentEndDate: input.lastWorkingDay, leavingReason: input.reason, deactivationPlan: null })
    .where(eq(employees.id, e.id));
  await withdrawEmployeeInvitations(tx, ctx.tenantId, e.id);
  // Access ends: the membership goes (identity's rules: never the last owner).
  if (e.userId) await removeMembership(tx, deps.audit, ctx, e.userId, 'member.deactivated');
  await deps.jobs.send('people.employee-deactivated', { tenantId: ctx.tenantId, employeeId: e.id, userId: e.userId }, tx);
  await deps.audit.record(tx, ctx, { action: 'employee.deactivated', entityType: 'employee', entityId: e.id, data: { lastWorkingDay: input.lastWorkingDay, movedReports: reports.length } });
  return { movedReports: reports.length };
}

/** Employees whose scheduled deactivation is due on `localDate` (their last working day is over). */
export async function dueDeactivations(tx: Tx, localDate: string) {
  return tx
    .select({ id: employees.id, lastWorkingDay: employees.employmentEndDate, reason: employees.leavingReason, plan: employees.deactivationPlan })
    .from(employees)
    .where(and(isNull(employees.deactivatedAt), sql`${employees.employmentEndDate} < ${localDate}`));
}
