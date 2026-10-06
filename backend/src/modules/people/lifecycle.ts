import { BadRequestException, ConflictException, HttpException, NotFoundException } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { AuditService } from '../../shared/audit/audit.service';
import type { TenantContext } from '../../shared/authorization';
import type { Tx } from '../../shared/database/database.service';
import { type DeactivationPlan, employeePersonal, employees, type LeavingReason, orgUnits, tenants } from '../../shared/database/schema';
import type { JobsService } from '../../shared/events/jobs.service';
import { removeMembership, withdrawEmployeeInvitations } from '../identity';
import { loadOrgSnapshot, writeLead, writeOrgChanges } from './org-changes';
import { planChanges, planLead, unitLedBy } from './org-rules';
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
 * unit, manager, reports, a unit they lead or personal details). Workforce modules (14–21) add
 * their data here as they ship.
 */
export async function mergeBlockers(tx: Tx, employeeId: string): Promise<string[]> {
  const [e] = await tx
    .select({
      unitId: employees.unitId,
      managerId: employees.managerId,
      // Qualified by hand: a select from one table renders its columns without the table name,
      // which inside these subqueries would name the subquery's own row.
      reports: sql<number>`(select count(*)::int from ${employees} r where r.manager_id = "employees"."id")`,
      leads: sql<number>`(select count(*)::int from ${orgUnits} u where u.lead_employee_id = "employees"."id")`,
      personal: sql<boolean>`exists (select 1 from ${employeePersonal} p where p.employee_id = "employees"."id")`,
    })
    .from(employees)
    .where(eq(employees.id, employeeId));
  if (!e) return [];
  const out: string[] = [];
  if (e.unitId) out.push('a unit');
  if (e.managerId) out.push('a manager');
  if (e.reports) out.push('direct reports');
  if (e.leads) out.push('a unit they lead');
  if (e.personal) out.push('personal details or a bank account');
  return out;
}

/** "a unit and a manager". */
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
 * date, reason), direct reports to the chosen manager, the unit they lead gets the chosen new lead
 * (who joins it and reports to the nearest lead above, CD-226) or none, pending invitations withdrawn, the membership removed through identity (the last owner
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

  // The unit they lead: the replacement, or nobody (CD-226). The new lead joins the unit and
  // reports to the nearest lead above, else the CEO; the members' managers were set above.
  const led = await tx.select({ id: orgUnits.id }).from(orgUnits).where(eq(orgUnits.leadEmployeeId, e.id));
  for (const u of led) {
    const pick = unitLeadsOf(input.plan).find((x) => x.unitId === u.id)?.employeeId ?? null;
    const ok = await active(pick);
    if (pick && !ok && !input.lenient) throw new BadRequestException('A new lead must be an active employee other than the person leaving');
    await tx.update(orgUnits).set({ leadEmployeeId: null }).where(eq(orgUnits.id, u.id));
    if (!ok) continue;
    const s = await loadOrgSnapshot(tx, ctx.tenantId);
    s.people.get(e.id)!.active = false;
    const other = unitLedBy(s, pick!);
    if (other) {
      if (!input.lenient) throw new BadRequestException(`${s.people.get(pick!)?.fullName ?? 'The new lead'} already leads ${other.name}`);
      continue;
    }
    const own = planLead(s, u.id, pick).changes.filter((c) => c.employeeId === pick);
    const planned = planChanges(s, own);
    await writeOrgChanges(tx, ctx.tenantId, s, planned, { jobs: deps.jobs, actorUserId: ctx.userId, clearLeadRoles: false });
    await writeLead(tx, s, u.id, pick);
  }

  await tx
    .update(employees)
    .set({ deactivatedAt: new Date(), employmentEndDate: input.lastWorkingDay, leavingReason: input.reason, deactivationPlan: null })
    .where(eq(employees.id, e.id));
  await withdrawEmployeeInvitations(tx, ctx.tenantId, e.id);
  // The CEO of the org chart's company node (CD-225) must be active: someone leaving stops being it.
  await tx.update(tenants).set({ ceoEmployeeId: null }).where(and(eq(tenants.id, ctx.tenantId), eq(tenants.ceoEmployeeId, e.id)));
  // Access ends: the membership goes (identity's rules: never the last owner).
  if (e.userId) await removeMembership(tx, deps.audit, ctx, e.userId, 'member.deactivated');
  await deps.jobs.send('people.employee-deactivated', { tenantId: ctx.tenantId, employeeId: e.id, userId: e.userId }, tx);
  await deps.audit.record(tx, ctx, { action: 'employee.deactivated', entityType: 'employee', entityId: e.id, data: { lastWorkingDay: input.lastWorkingDay, movedReports: reports.length } });
  return { movedReports: reports.length };
}

/**
 * The new leads a deactivation plan names: `unitLeads` (CD-226), or for a plan written before it
 * (by a release rolled back to after drizzle/0049) its team leads and department heads, whose ids
 * are the units' ids.
 */
export function unitLeadsOf(plan: Pick<DeactivationPlan, 'unitLeads' | 'teamLeads' | 'departmentHeads'>): { unitId: string; employeeId: string | null }[] {
  if (plan.unitLeads) return plan.unitLeads;
  return [...(plan.teamLeads ?? []).map((t) => ({ unitId: t.teamId, employeeId: t.employeeId })), ...(plan.departmentHeads ?? []).map((d) => ({ unitId: d.departmentId, employeeId: d.employeeId }))];
}

/** Employees whose scheduled deactivation is due on `localDate` (their last working day is over). */
export async function dueDeactivations(tx: Tx, localDate: string) {
  return tx
    .select({ id: employees.id, lastWorkingDay: employees.employmentEndDate, reason: employees.leavingReason, plan: employees.deactivationPlan })
    .from(employees)
    .where(and(isNull(employees.deactivatedAt), sql`${employees.employmentEndDate} < ${localDate}`));
}
