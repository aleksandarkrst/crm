import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { ENV, type Env } from '../../infrastructure/config/config.module';
import { AuditService } from '../../shared/audit/audit.service';
import type { TenantContext } from '../../shared/authorization';
import { DatabaseService, type Tx } from '../../shared/database/database.service';
import { mapDbError } from '../../shared/database/errors';
import { type DeactivationPlan, departments, employees, invitations, memberships, teams, users } from '../../shared/database/schema';
import { JobsService } from '../../shared/events/jobs.service';
import { createInvitation, keepAnOwner, membershipRole, withdrawEmployeeInvitations } from '../identity';
import { EmployeesService } from './employees.service';
import { applyDeactivation, listBlockers, mergeBlockers, shiftDate, workspaceToday } from './lifecycle';
import type { BulkInvite, DeactivateEmployee, InviteEmployee, LinkMember, ReactivateEmployee } from './lifecycle.schemas';
import { PeopleAccess } from './people-access';
import { assertValidManager, lockReportingLines } from './reporting-lines';

const pendingInvitation = sql`exists (select 1 from ${invitations} i where i.employee_id = ${employees.id} and i.accepted_at is null and i.revoked_at is null and i.expires_at > now())`;

/**
 * An employee's app access and leaving (spec 4.6–4.8): Invite to Pultly (one or many), Link to
 * member and Unlink (Admin), Deactivate and Reactivate (Administration, Admin). Invitations and
 * membership removal go through identity's public API; the daily job for future last working
 * days is in people-jobs.ts. Every action returns the card, like PATCH.
 */
@Injectable()
export class EmployeeLifecycleService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: PeopleAccess,
    private readonly employees: EmployeesService,
    private readonly audit: AuditService,
    private readonly jobs: JobsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  // ------------------------------------------------------------------ invite (spec 4.7)

  /**
   * "Invite to Pultly" (Admin): an invitation to the work email with the employee on it, so
   * accepting links the new member to this record. Needs a work email and status Active or
   * Leaving. An account with that email already linked to another record is refused; one linked to
   * an automatic record gets 409 `code: 'link_instead'` (the dialog offers "Link instead of invite").
   * Returns `{ invitation, token, card }`.
   */
  invite(ctx: TenantContext, id: string, input: InviteEmployee) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const access = await this.access.of(ctx, tx);
        if (!access.isAdmin) throw new ForbiddenException('Only Admins invite people to Pultly');
        const e = await this.employee(tx, id);
        if (e.deactivatedAt) throw new ConflictException(`${e.fullName} has left the company. Reactivate them first.`);
        if (e.userId) throw new ConflictException(`${e.fullName} already has an account`);
        if (!e.workEmail) throw new BadRequestException('Add a work email to the card first: the invitation goes there');
        await this.refuseExistingAccount(tx, ctx.tenantId, e.workEmail);
        const { invitation, token } = await createInvitation(tx, this.deps(), ctx, { email: e.workEmail, role: input.role, employeeId: id });
        return { invitation, token, card: await this.employees.cardIn(tx, ctx, id) };
      })
      .catch(mapDbError);
  }

  /** A member with this email: "already has an account linked to <name>", or "link instead" for an automatic record. */
  private async refuseExistingAccount(tx: Tx, tenantId: string, email: string) {
    const [member] = await tx
      .select({ userId: users.id, name: sql<string>`coalesce(${users.displayName}, ${users.email})`, employeeId: employees.id, employeeName: employees.fullName })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .leftJoin(employees, eq(employees.userId, memberships.userId))
      .where(and(eq(memberships.tenantId, tenantId), sql`lower(${users.email}) = ${email}`));
    if (!member) return;
    const blockers = member.employeeId ? await mergeBlockers(tx, member.employeeId) : [];
    if (blockers.length) throw new ConflictException({ statusCode: 409, error: 'Conflict', code: 'linked_elsewhere', message: `${email} already has an account linked to ${member.employeeName}` });
    throw new ConflictException({
      statusCode: 409,
      error: 'Conflict',
      code: 'link_instead',
      userId: member.userId,
      memberName: member.name,
      message: `${email} already has an account (${member.name}). Link it to this record instead of inviting.`,
    });
  }

  /**
   * "Invite selected" (Admin, spec 5.4): queues one people.bulk-invite job for the rows that have a
   * work email, no account and no pending invitation, and are Active or Leaving. Returns
   * `{ queued, skipped }` for the confirmation.
   */
  bulkInvite(ctx: TenantContext, input: BulkInvite) {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const access = await this.access.of(ctx, tx);
      if (!access.isAdmin) throw new ForbiddenException('Only Admins invite people to Pultly');
      const ids = [...new Set(input.employeeIds)];
      const rows = await tx
        .select({ id: employees.id })
        .from(employees)
        .where(and(inArray(employees.id, ids), isNull(employees.userId), isNull(employees.deactivatedAt), sql`${employees.workEmail} is not null`, sql`not ${pendingInvitation}`));
      const eligible = rows.map((r) => r.id);
      if (eligible.length) await this.jobs.send('people.bulk-invite', { tenantId: ctx.tenantId, actorUserId: ctx.userId, employeeIds: eligible, role: input.role }, tx);
      await this.audit.record(tx, ctx, { action: 'employee.bulk_invited', entityType: 'employee', data: { queued: eligible.length, skipped: ids.length - eligible.length, role: input.role } });
      return { queued: eligible.length, skipped: ids.length - eligible.length };
    });
  }

  // ------------------------------------------------------------------ link and unlink (spec 4.6)

  /**
   * "Link to member" (Admin): the workspace's members with their employee record and whether it can
   * be merged into this one (`blockers` names the data that prevents it). The member already linked
   * to this record is left out.
   */
  linkCandidates(ctx: TenantContext, id: string) {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const access = await this.access.of(ctx, tx);
      if (!access.isAdmin) throw new ForbiddenException('Only Admins link members');
      await this.employee(tx, id);
      const members = await tx
        .select({ userId: users.id, name: sql<string>`coalesce(${users.displayName}, ${users.email}, 'Member')`, email: users.email, employeeId: employees.id, employeeName: employees.fullName })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .leftJoin(employees, eq(employees.userId, memberships.userId))
        .where(eq(memberships.tenantId, ctx.tenantId))
        .orderBy(asc(sql`lower(coalesce(${users.displayName}, ${users.email}))`));
      const out = [];
      for (const m of members) {
        if (m.employeeId === id) continue;
        const blockers = m.employeeId ? await mergeBlockers(tx, m.employeeId) : [];
        out.push({ ...m, mergeable: blockers.length === 0, blockers });
      }
      return out;
    });
  }

  /**
   * Links a member to this record (Admin). The member's own record, made automatically when they
   * joined, is merged: deleted, this one keeps its data. A record holding data of its own can't be
   * merged (409 naming the data). This record must be active and have no account.
   */
  link(ctx: TenantContext, id: string, input: LinkMember) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const access = await this.access.of(ctx, tx);
        if (!access.isAdmin) throw new ForbiddenException('Only Admins link members');
        const e = await this.employee(tx, id, true);
        if (e.deactivatedAt) throw new ConflictException(`${e.fullName} has left the company. Reactivate them first.`);
        if (e.userId) throw new ConflictException(`${e.fullName} already has an account. Unlink it first.`);
        if (!(await membershipRole(tx, ctx.tenantId, input.userId))) throw new BadRequestException('That person is not a member of this workspace');
        const [own] = await tx.select({ id: employees.id, fullName: employees.fullName }).from(employees).where(eq(employees.userId, input.userId)).for('update');
        if (own) {
          const blockers = await mergeBlockers(tx, own.id);
          if (blockers.length) {
            throw new ConflictException(`${own.fullName}'s employee record has ${listBlockers(blockers)}, so it can't be merged into this one. Unlink that record or clear it first.`);
          }
          await tx.delete(employees).where(eq(employees.id, own.id));
        }
        await tx
          .update(employees)
          .set({ userId: input.userId, firstLinkedAt: sql`coalesce(${employees.firstLinkedAt}, now())` })
          .where(eq(employees.id, id));
        await withdrawEmployeeInvitations(tx, ctx.tenantId, id);
        await this.audit.record(tx, ctx, { action: 'employee.linked', entityType: 'employee', entityId: id, data: { userId: input.userId, mergedEmployeeId: own?.id ?? null } });
        return this.employees.cardIn(tx, ctx, id);
      })
      .catch(mapDbError);
  }

  /**
   * "Unlink" (Admin): the record becomes "No account" and keeps everything else. The member gets a
   * new automatic record (rule 3 of spec 4.6), so every member stays an employee.
   */
  unlink(ctx: TenantContext, id: string) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const access = await this.access.of(ctx, tx);
        if (!access.isAdmin) throw new ForbiddenException('Only Admins unlink members');
        const e = await this.employee(tx, id, true);
        if (!e.userId) throw new ConflictException(`${e.fullName} has no account to unlink`);
        await tx.update(employees).set({ userId: null }).where(eq(employees.id, id));
        await tx.execute(sql`select people_create_member_employee(${ctx.tenantId}, ${e.userId})`);
        await this.audit.record(tx, ctx, { action: 'employee.unlinked', entityType: 'employee', entityId: id, data: { userId: e.userId } });
        return this.employees.cardIn(tx, ctx, id);
      })
      .catch(mapDbError);
  }

  // ------------------------------------------------------------------ deactivate and reactivate (spec 4.8)

  /**
   * Deactivate (Administration, Admin; an Admin may deactivate themselves unless they are the only
   * one, Administration not). Last working day at most 90 days ago in the workspace's time zone.
   * With active direct reports, `reportsManagerId` is required (null = "No manager"); the loop rule
   * applies to every report. Today or earlier: applied now. Later: status Leaving with the choices
   * stored for the daily job (people.deactivate-due). Returns the card.
   */
  deactivate(ctx: TenantContext, id: string, input: DeactivateEmployee) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const access = await this.access.of(ctx, tx);
        if (!access.isHr) throw new ForbiddenException('Only Administration and Admins deactivate employees');
        const self = access.isSelf(id);
        if (self && !access.isAdmin) throw new ForbiddenException('Only an Admin can deactivate their own record');
        await lockReportingLines(tx, ctx.tenantId);
        const e = await this.employee(tx, id, true);
        if (e.deactivatedAt) throw new ConflictException(`${e.fullName} has already left`);

        const today = await workspaceToday(tx, ctx.tenantId);
        if (input.lastWorkingDay < shiftDate(today, -90)) throw new BadRequestException('The last working day can be at most 90 days ago');
        if (e.userId) await this.guardAccess(tx, ctx, e.userId, self);

        const reports = await tx
          .select({ id: employees.id })
          .from(employees)
          .where(and(eq(employees.managerId, id), isNull(employees.deactivatedAt)));
        if (reports.length && input.reportsManagerId === undefined) {
          throw new BadRequestException(`Choose a new manager for ${e.fullName}'s ${reports.length === 1 ? 'direct report' : `${reports.length} direct reports`}`);
        }
        const plan: DeactivationPlan = {
          reportsManagerId: input.reportsManagerId ?? null,
          teamLeads: input.teamLeads,
          departmentHeads: input.departmentHeads,
          byUserId: ctx.userId,
        };
        await this.validatePlan(tx, e, reports, plan);

        if (input.lastWorkingDay <= today) {
          await applyDeactivation(tx, this.deps(), ctx, { employeeId: id, lastWorkingDay: input.lastWorkingDay, reason: input.reason ?? null, plan, lenient: false });
        } else {
          await tx.update(employees).set({ employmentEndDate: input.lastWorkingDay, leavingReason: input.reason ?? null, deactivationPlan: plan }).where(eq(employees.id, id));
          await this.audit.record(tx, ctx, { action: 'employee.deactivation_scheduled', entityType: 'employee', entityId: id, data: { lastWorkingDay: input.lastWorkingDay } });
        }
        return this.employees.cardIn(tx, ctx, id);
      })
      .catch(mapDbError);
  }

  /** The last owner can't be deactivated; an Admin can't deactivate themselves while they are the only Admin. */
  private async guardAccess(tx: Tx, ctx: TenantContext, userId: string, self: boolean) {
    const role = await membershipRole(tx, ctx.tenantId, userId);
    if (self && (role === 'owner' || role === 'admin')) {
      const admins = await tx
        .select({ userId: memberships.userId })
        .from(memberships)
        .where(and(eq(memberships.tenantId, ctx.tenantId), inArray(memberships.role, ['owner', 'admin'])));
      if (admins.length <= 1) throw new ConflictException('You are the only Admin. Make someone else an owner or admin first.');
    }
    if (role === 'owner') await keepAnOwner(tx, ctx.tenantId);
  }

  /** The dialog's choices: an active manager other than the person leaving and no loop for any report; replacements active and real. */
  private async validatePlan(tx: Tx, e: { id: string; managerId: string | null }, reports: { id: string }[], plan: DeactivationPlan) {
    const activeOther = async (pick: string | null, what: string) => {
      if (!pick) return;
      if (pick === e.id) throw new BadRequestException(`The ${what} can't be the person leaving`);
      const [row] = await tx.select({ id: employees.id }).from(employees).where(and(eq(employees.id, pick), isNull(employees.deactivatedAt)));
      if (!row) throw new BadRequestException(`The ${what} must be an active employee`);
    };
    await activeOther(plan.reportsManagerId, 'new manager');
    for (const r of reports) {
      // A report picked as the new manager goes to the leaving person's own manager instead.
      await assertValidManager(tx, r.id, r.id === plan.reportsManagerId ? e.managerId : plan.reportsManagerId);
    }
    for (const t of plan.teamLeads) {
      const [team] = await tx.select({ id: teams.id }).from(teams).where(and(eq(teams.id, t.teamId), eq(teams.leadEmployeeId, e.id)));
      if (!team) throw new BadRequestException('That team is not led by the person leaving');
      await activeOther(t.employeeId, 'new team lead');
    }
    for (const d of plan.departmentHeads) {
      const [dep] = await tx.select({ id: departments.id }).from(departments).where(and(eq(departments.id, d.departmentId), eq(departments.headEmployeeId, e.id)));
      if (!dep) throw new BadRequestException('That department is not headed by the person leaving');
      await activeOther(d.employeeId, 'new department head');
    }
  }

  /**
   * Reactivate (Administration, Admin). Inactive (a rehire): clears the end date and reason, sets
   * the new employment start date (required; the previous period stays in history) and status
   * Active, with no account until invited again. Leaving: cancels the scheduled deactivation.
   */
  reactivate(ctx: TenantContext, id: string, input: ReactivateEmployee) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const access = await this.access.of(ctx, tx);
        if (!access.isHr) throw new ForbiddenException('Only Administration and Admins reactivate employees');
        const e = await this.employee(tx, id, true);
        if (e.deactivatedAt) {
          if (!input.employmentStartDate) throw new BadRequestException('Enter the new employment start date');
          if (input.employmentStartDate > shiftDate(await workspaceToday(tx, ctx.tenantId), 366)) throw new BadRequestException('The start date can be at most one year ahead');
          await tx
            .update(employees)
            .set({ deactivatedAt: null, employmentEndDate: null, leavingReason: null, deactivationPlan: null, employmentStartDate: input.employmentStartDate })
            .where(eq(employees.id, id));
          await this.audit.record(tx, ctx, { action: 'employee.reactivated', entityType: 'employee', entityId: id, data: { employmentStartDate: input.employmentStartDate } });
        } else if (e.employmentEndDate) {
          await tx.update(employees).set({ employmentEndDate: null, leavingReason: null, deactivationPlan: null }).where(eq(employees.id, id));
          await this.audit.record(tx, ctx, { action: 'employee.deactivation_cancelled', entityType: 'employee', entityId: id });
        } else {
          throw new ConflictException(`${e.fullName} is active`);
        }
        return this.employees.cardIn(tx, ctx, id);
      })
      .catch(mapDbError);
  }

  // ------------------------------------------------------------------ helpers

  private deps() {
    return { jobs: this.jobs, audit: this.audit, env: this.env };
  }

  /** The employee (HR sees inactive ones; others get 404 for them), optionally locked. */
  private async employee(tx: Tx, id: string, lock = false) {
    const q = tx
      .select({
        id: employees.id,
        fullName: employees.fullName,
        userId: employees.userId,
        workEmail: employees.workEmail,
        managerId: employees.managerId,
        deactivatedAt: employees.deactivatedAt,
        employmentEndDate: employees.employmentEndDate,
      })
      .from(employees)
      .where(eq(employees.id, id));
    const [e] = lock ? await q.for('update') : await q;
    if (!e) throw new NotFoundException('Employee not found');
    return e;
  }
}
