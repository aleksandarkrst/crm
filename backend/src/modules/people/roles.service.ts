import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { AuditService } from '../../shared/audit/audit.service';
import type { TenantContext } from '../../shared/authorization';
import { DatabaseService, type Tx } from '../../shared/database/database.service';
import { requestActor } from '../../shared/database/request-context';
import { ASSIGNED_ROLES, type AssignedRole, employeeRoles, employees, memberships, recordChanges, users } from '../../shared/database/schema';
import { JobsService } from '../../shared/events/jobs.service';
import { PeopleAccess } from './people-access';
import { allows } from './permissions';

/** A person in one of the Roles tab's lists. */
export interface RoleHolder {
  employeeId: string | null;
  userId: string | null;
  name: string;
  jobTitle: string | null;
  hasAccount: boolean;
}

/**
 * Administration and Payroll (spec 9.1, 9.6): who has which functional role, and assigning them.
 * Only Admins assign or remove (row "org.roles" of the permission matrix), on any employee with or
 * without an account; it takes effect on the person's next request (PeopleAccess reads
 * employee_roles per request). Each change writes an employee history row (field `roles`), an
 * audit entry, and queues the "Role granted" / "Role removed" email (people.role-changed-email).
 * Admin and Manager are derived (workspace role, reporting lines) and can't be set here.
 */
@Injectable()
export class RolesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: PeopleAccess,
    private readonly audit: AuditService,
    private readonly jobs: JobsService,
  ) {}

  /**
   * The Roles tab's "Who has which role": Administration and Payroll holders (active employees),
   * Admins (workspace owners and admins) and Managers (with their number of active direct reports).
   * Names only, for every member.
   */
  holders(ctx: TenantContext) {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const assigned = await tx
        .select({
          role: employeeRoles.role,
          employeeId: employees.id,
          userId: employees.userId,
          name: employees.fullName,
          jobTitle: employees.jobTitle,
          grantedAt: employeeRoles.grantedAt,
        })
        .from(employeeRoles)
        .innerJoin(employees, eq(employees.id, employeeRoles.employeeId))
        .where(sql`${employees.deactivatedAt} is null`)
        .orderBy(asc(employees.lastName), asc(employees.firstName));
      const holder = (r: (typeof assigned)[number]) => ({ employeeId: r.employeeId, userId: r.userId, name: r.name, jobTitle: r.jobTitle, hasAccount: !!r.userId, grantedAt: r.grantedAt });

      const admins = await tx
        .select({
          userId: memberships.userId,
          role: memberships.role,
          employeeId: employees.id,
          employeeName: employees.fullName,
          jobTitle: employees.jobTitle,
          userName: sql<string>`coalesce(${users.displayName}, ${users.email}, 'Member')`,
        })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .leftJoin(employees, eq(employees.userId, memberships.userId))
        .where(and(eq(memberships.tenantId, ctx.tenantId), inArray(memberships.role, ['owner', 'admin'])));

      const managers = await tx.execute<{ id: string; user_id: string | null; full_name: string; job_title: string | null; reports: number }>(sql`
        select m.id, m.user_id, m.full_name, m.job_title, count(e.id)::int as reports
        from employees m join employees e on e.manager_id = m.id and e.deactivated_at is null
        where m.deactivated_at is null
        group by m.id order by m.last_name, m.first_name`);

      return {
        administration: assigned.filter((r) => r.role === 'administration').map(holder),
        payroll: assigned.filter((r) => r.role === 'payroll').map(holder),
        admins: admins
          .map((a) => ({ employeeId: a.employeeId, userId: a.userId, name: a.employeeName ?? a.userName, jobTitle: a.jobTitle, hasAccount: true, workspaceRole: a.role }))
          .sort((a, b) => a.name.localeCompare(b.name)),
        managers: managers.rows.map((m) => ({ employeeId: m.id, userId: m.user_id, name: m.full_name, jobTitle: m.job_title, hasAccount: !!m.user_id, reports: m.reports })),
      };
    });
  }

  /** Gives `role` to the employee (Admin only). Already having it changes nothing and sends nothing. */
  grant(ctx: TenantContext, employeeId: string, role: AssignedRole) {
    return this.change(ctx, employeeId, role, 'granted');
  }

  /** Takes `role` away (Admin only). Not having it changes nothing. */
  remove(ctx: TenantContext, employeeId: string, role: AssignedRole) {
    return this.change(ctx, employeeId, role, 'removed');
  }

  private change(ctx: TenantContext, employeeId: string, role: AssignedRole, kind: 'granted' | 'removed') {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const access = await this.access.of(ctx, tx);
      if (!allows('org.roles', access.roles)) throw new ForbiddenException('Only Admins assign Administration and Payroll');
      // Lock the employee, so two Admins changing the same person's roles queue.
      const [employee] = await tx
        .select({ id: employees.id, deactivatedAt: employees.deactivatedAt, fullName: employees.fullName })
        .from(employees)
        .where(eq(employees.id, employeeId))
        .for('update');
      if (!employee) throw new NotFoundException('Employee not found');
      const before = await this.assignedOf(tx, employeeId);
      if (kind === 'granted') {
        if (employee.deactivatedAt) throw new BadRequestException(`${employee.fullName} has left the company. Reactivate them first.`);
        if (before.includes(role)) return { employeeId, roles: before };
        await tx.insert(employeeRoles).values({ tenantId: ctx.tenantId, employeeId, role, grantedByUserId: ctx.userId });
      } else {
        if (!before.includes(role)) return { employeeId, roles: before };
        await tx.delete(employeeRoles).where(and(eq(employeeRoles.employeeId, employeeId), eq(employeeRoles.role, role)));
      }
      const after = ASSIGNED_ROLES.filter((r) => (r === role ? kind === 'granted' : before.includes(r)));
      await tx.insert(recordChanges).values({
        tenantId: ctx.tenantId,
        entityType: 'employee',
        entityId: employeeId,
        action: 'updated',
        field: 'roles',
        oldValue: before,
        newValue: after,
        actorUserId: ctx.userId,
        clientId: requestActor.getStore()?.clientId ?? null,
      });
      await this.audit.record(tx, ctx, { action: kind === 'granted' ? 'employee.role_granted' : 'employee.role_removed', entityType: 'employee', entityId: employeeId, data: { role } });
      await this.jobs.send('people.role-changed-email', { tenantId: ctx.tenantId, employeeId, role, kind, actorUserId: ctx.userId }, tx);
      return { employeeId, roles: after };
    });
  }

  private async assignedOf(tx: Tx, employeeId: string): Promise<AssignedRole[]> {
    const rows = await tx.select({ role: employeeRoles.role }).from(employeeRoles).where(eq(employeeRoles.employeeId, employeeId));
    return ASSIGNED_ROLES.filter((r) => rows.some((x) => x.role === r));
  }
}
