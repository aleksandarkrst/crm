import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { TenantContext } from '../../shared/authorization';
import { DatabaseService, type Tx } from '../../shared/database/database.service';
import { type AssignedRole, employees, memberships } from '../../shared/database/schema';
import { ABSENCE_SOURCE, type AbsenceSource, type ApproverResult, resolveApprovers } from './approvers';
import { CallerAccess } from './caller-access';

/**
 * The one place that answers "who is the caller in the org, and what may they see" (spec 9.4).
 * Every endpoint of milestone 13 and of the later Workforce modules checks access through it.
 *
 * - `of(ctx)`: the caller's roles, own employee id, and direct and indirect report ids, from ONE
 *   recursive query on employees.manager_id (index (tenant_id, manager_id)), cached for the request
 *   (keyed by its TenantContext object, which the auth guard creates per request).
 * - `approversFor(tenantId, employeeId, date)`: the approver rule (approvers.ts).
 * - `employeeForUser(tenantId, userId)`: the member's employee record.
 * - `reportIdsOf(tx, managerId)`: anyone's subtree (the list's "Including indirect reports").
 */
@Injectable()
export class PeopleAccess {
  private readonly cache = new WeakMap<TenantContext, Promise<CallerAccess>>();

  constructor(
    private readonly database: DatabaseService,
    @Inject(ABSENCE_SOURCE) private readonly absence: AbsenceSource,
  ) {}

  /** The caller's access, computed once per request. Pass `tx` to read inside an open transaction. */
  of(ctx: TenantContext, tx?: Tx): Promise<CallerAccess> {
    let access = this.cache.get(ctx);
    if (!access) {
      access = tx ? this.load(tx, ctx) : this.database.withTenant(ctx.tenantId, (t) => this.load(t, ctx));
      // A failed load is not cached, so a retry within the request can succeed.
      access.catch(() => this.cache.delete(ctx));
      this.cache.set(ctx, access);
    }
    return access;
  }

  private async load(tx: Tx, ctx: TenantContext): Promise<CallerAccess> {
    const { rows } = await tx.execute<{ employee_id: string | null; roles: AssignedRole[] | null; direct: string[] | null; reports: string[] | null }>(sql`
      with recursive me as (
        select id from employees where user_id = ${ctx.userId}
      ), tree(id, depth) as (
        select e.id, 1 from employees e join me on e.manager_id = me.id where e.deactivated_at is null
        union
        select e.id, t.depth + 1 from employees e join tree t on e.manager_id = t.id
        where e.deactivated_at is null and t.depth < 100 and e.id <> (select id from me)
      )
      select (select id::text from me) as employee_id,
        (select array_agg(r.role::text) from employee_roles r join me on r.employee_id = me.id) as roles,
        (select array_agg(distinct id::text) from tree where depth = 1) as direct,
        (select array_agg(distinct id::text) from tree) as reports`);
    const row = rows[0];
    return new CallerAccess({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      workspaceRole: ctx.role,
      employeeId: row?.employee_id ?? null,
      assignedRoles: row?.roles ?? [],
      directReportIds: row?.direct ?? [],
      reportIds: row?.reports ?? [],
    });
  }

  /** Active employees below `managerId` at any depth (`direct`: only their direct reports). */
  async reportIdsOf(tx: Tx, managerId: string, direct = false): Promise<string[]> {
    if (direct) {
      const rows = await tx
        .select({ id: employees.id })
        .from(employees)
        .where(and(eq(employees.managerId, managerId), sql`${employees.deactivatedAt} is null`));
      return rows.map((r) => r.id);
    }
    const { rows } = await tx.execute<{ id: string }>(sql`
      with recursive tree(id, depth) as (
        select id, 1 from employees where manager_id = ${managerId} and deactivated_at is null
        union
        select e.id, t.depth + 1 from employees e join tree t on e.manager_id = t.id
        where e.deactivated_at is null and t.depth < 100 and e.id <> ${managerId}
      ) select distinct id::text as id from tree`);
    return rows.map((r) => r.id);
  }

  /** The member's employee record in this workspace (id, name, status), or null. */
  async employeeForUser(tenantId: string, userId: string, tx?: Tx) {
    const read = (t: Tx) =>
      t
        .select({ id: employees.id, fullName: employees.fullName, deactivatedAt: employees.deactivatedAt, managerId: employees.managerId })
        .from(employees)
        .where(eq(employees.userId, userId))
        .then((rows) => rows[0] ?? null);
    return tx ? read(tx) : this.database.withTenant(tenantId, read);
  }

  /**
   * Who approves a timesheet, time off request or trip of `employeeId` for `date` (yyyy-mm-dd, the
   * first day of the period or the trip), by the rule of spec 7.4. Resolved now, never stored.
   */
  async approversFor(tenantId: string, employeeId: string, date: string, tx?: Tx): Promise<ApproverResult | null> {
    const run = async (t: Tx): Promise<ApproverResult | null> => {
      const [employee] = await t.select({ id: employees.id, userId: employees.userId, managerId: employees.managerId }).from(employees).where(eq(employees.id, employeeId));
      if (!employee) return null;
      const [manager] = employee.managerId
        ? await t
            .select({ id: employees.id, userId: employees.userId, deactivatedAt: employees.deactivatedAt })
            .from(employees)
            .where(eq(employees.id, employee.managerId))
        : [];
      // A link outlives nothing: user_id is cleared when the membership goes, but check it anyway.
      const managerIsMember = manager?.userId ? await this.isMember(t, tenantId, manager.userId) : false;
      const admins = await t
        .select({ userId: memberships.userId, employeeId: employees.id })
        .from(memberships)
        .leftJoin(employees, eq(employees.userId, memberships.userId))
        .where(and(eq(memberships.tenantId, tenantId), inArray(memberships.role, ['owner', 'admin'])));
      const absent = manager ? await this.absence.absentOn(t, tenantId, [manager.id], date) : new Set<string>();
      return resolveApprovers({
        employee: { id: employee.id, userId: employee.userId },
        manager: manager ? { id: manager.id, active: !manager.deactivatedAt, userId: managerIsMember ? manager.userId : null } : null,
        managerAbsent: manager ? absent.has(manager.id) : false,
        admins,
      });
    };
    return tx ? run(tx) : this.database.withTenant(tenantId, run);
  }

  private async isMember(tx: Tx, tenantId: string, userId: string): Promise<boolean> {
    const [m] = await tx
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId)));
    return !!m;
  }
}
