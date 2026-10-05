import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, or, type SQL, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { AuditService } from '../../shared/audit/audit.service';
import type { TenantContext } from '../../shared/authorization';
import { DatabaseService, type Tx } from '../../shared/database/database.service';
import { mapDbError } from '../../shared/database/errors';
import { departments, employees, teams } from '../../shared/database/schema';
import { JobsService } from '../../shared/events/jobs.service';
import type { CallerAccess } from './caller-access';
import { DEPARTMENT_USAGE, type DepartmentUsage } from './department-usage';
import type { Assign, AssignmentPreview, CreateDepartment, CreateTeam, SetReportingLines, UpdateDepartment, UpdateTeam } from './org.schemas';
import { PeopleAccess } from './people-access';
import { assertValidManager, isLoopError, lockReportingLines, queueManagerEmails, setManagers } from './reporting-lines';

const head = alias(employees, 'head');
const lead = alias(employees, 'lead');
const managerRow = alias(employees, 'manager');

const departmentColumns = {
  id: departments.id,
  name: departments.name,
  code: departments.code,
  headEmployeeId: departments.headEmployeeId,
  headName: head.fullName,
  version: departments.updatedAt,
  teams: sql<number>`(select count(*)::int from ${teams} t where t.department_id = ${departments.id})`,
  activeEmployees: sql<number>`(select count(*)::int from ${employees} e where e.department_id = ${departments.id} and e.deactivated_at is null)`,
};
const teamColumns = {
  id: teams.id,
  departmentId: teams.departmentId,
  name: teams.name,
  leadEmployeeId: teams.leadEmployeeId,
  leadName: lead.fullName,
  /** The lead is not a member of the team: the chart shows them at the top with "(lead)". */
  leadOutside: sql<boolean>`(${teams.leadEmployeeId} is not null and ${lead.teamId} is distinct from ${teams.id})`,
  version: teams.updatedAt,
  activeEmployees: sql<number>`(select count(*)::int from ${employees} e where e.team_id = ${teams.id} and e.deactivated_at is null)`,
};

/** An employee as the confirmations and previews name them. */
const personColumns = {
  id: employees.id,
  fullName: employees.fullName,
  jobTitle: employees.jobTitle,
  departmentId: employees.departmentId,
  teamId: employees.teamId,
  teamName: teams.name,
  managerId: employees.managerId,
  managerName: managerRow.fullName,
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Departments, teams and reporting lines (CD-138, CD-139; spec 6 and 7). Every change is for
 * Administration and Admin (403 otherwise; nobody but an Admin changes their own department, team
 * or manager, or makes themselves someone's manager). Manager changes go through `setManagers`
 * (reporting-line lock first, loop check per change) and queue the "New manager" / "New direct
 * report" emails. Live updates come from the tables' triggers.
 */
@Injectable()
export class OrgService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: PeopleAccess,
    private readonly audit: AuditService,
    private readonly jobs: JobsService,
    @Inject(DEPARTMENT_USAGE) private readonly usage: DepartmentUsage,
  ) {}

  // ------------------------------------------------------------------ read (every member)

  /** Every department, by name: head, number of teams and of active employees. */
  departments(ctx: TenantContext) {
    return this.database.withTenant(ctx.tenantId, (tx) => this.departmentRows(tx));
  }

  /** Every team, by department and name: lead, number of active employees. */
  teams(ctx: TenantContext) {
    return this.database.withTenant(ctx.tenantId, (tx) => this.teamRows(tx));
  }

  private departmentRows(tx: Tx, where?: SQL) {
    return tx
      .select(departmentColumns)
      .from(departments)
      .leftJoin(head, eq(head.id, departments.headEmployeeId))
      .where(where)
      .orderBy(asc(sql`lower(${departments.name})`));
  }

  private teamRows(tx: Tx, where?: SQL) {
    return tx
      .select(teamColumns)
      .from(teams)
      .innerJoin(departments, eq(departments.id, teams.departmentId))
      .leftJoin(lead, eq(lead.id, teams.leadEmployeeId))
      .where(where)
      .orderBy(asc(sql`lower(${departments.name})`), asc(sql`lower(${teams.name})`));
  }

  // ------------------------------------------------------------------ departments

  createDepartment(ctx: TenantContext, input: CreateDepartment) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        await this.hr(tx, ctx);
        if (input.headEmployeeId) await activeEmployee(tx, input.headEmployeeId, 'The department head');
        const [row] = await tx
          .insert(departments)
          .values({ tenantId: ctx.tenantId, name: input.name, code: input.code ?? null, headEmployeeId: input.headEmployeeId ?? null })
          .returning({ id: departments.id });
        await this.audit.record(tx, ctx, { action: 'department.created', entityType: 'department', entityId: row!.id, data: { name: input.name } });
        return this.department(tx, row!.id);
      })
      .catch(mapDbError);
  }

  /** Rename (the new name shows everywhere; history keeps the old one), code, head. */
  updateDepartment(ctx: TenantContext, id: string, input: UpdateDepartment) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        await this.hr(tx, ctx);
        const [current] = await tx.select({ id: departments.id }).from(departments).where(eq(departments.id, id)).for('no key update');
        if (!current) throw new NotFoundException('Department not found');
        if (input.headEmployeeId) await activeEmployee(tx, input.headEmployeeId, 'The department head');
        await tx.update(departments).set(input).where(eq(departments.id, id));
        await this.audit.record(tx, ctx, { action: 'department.updated', entityType: 'department', entityId: id, data: { fields: Object.keys(input) } });
        return this.department(tx, id);
      })
      .catch(mapDbError);
  }

  /**
   * Refused while it has teams (delete or move them first) or another module uses it (the message
   * names what); otherwise its members end up with no department (the foreign key).
   */
  deleteDepartment(ctx: TenantContext, id: string) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        await this.hr(tx, ctx);
        const [d] = await tx.select({ name: departments.name }).from(departments).where(eq(departments.id, id)).for('update');
        if (!d) throw new NotFoundException('Department not found');
        const owned = await tx.select({ name: teams.name }).from(teams).where(eq(teams.departmentId, id)).orderBy(asc(teams.name));
        if (owned.length) {
          throw new ConflictException(`${d.name} has ${plural(owned.length, 'team')} (${owned.map((t) => t.name).join(', ')}). Delete them or move them to another department first.`);
        }
        const usedBy = await this.usage.usedBy(tx, ctx.tenantId, id);
        if (usedBy.length) throw new ConflictException(`${d.name} is used by ${usedBy.join(', ')}, so it can't be deleted.`);
        await tx.delete(departments).where(eq(departments.id, id));
        await this.audit.record(tx, ctx, { action: 'department.deleted', entityType: 'department', entityId: id, data: { name: d.name } });
      })
      .catch(mapDbError);
  }

  /** For the delete confirmation: its teams (blocking), what else uses it (blocking), its active members. */
  departmentUsage(ctx: TenantContext, id: string) {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      await this.hr(tx, ctx);
      const [d] = await tx.select({ id: departments.id, name: departments.name }).from(departments).where(eq(departments.id, id));
      if (!d) throw new NotFoundException('Department not found');
      const owned = await tx.select({ id: teams.id, name: teams.name }).from(teams).where(eq(teams.departmentId, id)).orderBy(asc(teams.name));
      return { ...d, teams: owned, usedBy: await this.usage.usedBy(tx, ctx.tenantId, id), members: await this.people(tx, eq(employees.departmentId, id)) };
    });
  }

  // ------------------------------------------------------------------ teams

  createTeam(ctx: TenantContext, input: CreateTeam) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        await this.hr(tx, ctx);
        await departmentExists(tx, input.departmentId);
        if (input.leadEmployeeId) await activeEmployee(tx, input.leadEmployeeId, 'The team lead');
        const [row] = await tx
          .insert(teams)
          .values({ tenantId: ctx.tenantId, departmentId: input.departmentId, name: input.name, leadEmployeeId: input.leadEmployeeId ?? null })
          .returning({ id: teams.id });
        await this.audit.record(tx, ctx, { action: 'team.created', entityType: 'team', entityId: row!.id, data: { name: input.name } });
        return { team: await this.team(tx, row!.id), moved: 0, reassigned: [], loops: [] };
      })
      .catch(mapDbError);
  }

  /**
   * Rename, move to another department (its members' department changes in the same statement,
   * by the foreign key's ON UPDATE CASCADE; `moved` counts the active ones), set the lead. With
   * `makeMembersReport`, members who had no manager or reported to the previous lead now report to
   * the lead (spec 6.3), except where that would close a loop (`loops`) and, for Administration,
   * their own record. Returns `{ team, moved, reassigned, loops }`.
   */
  updateTeam(ctx: TenantContext, id: string, input: UpdateTeam) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const access = await this.hr(tx, ctx);
        // The reporting-line lock before any row lock (reporting-lines.ts).
        if (input.makeMembersReport) await lockReportingLines(tx, ctx.tenantId);
        const [team] = await tx.select().from(teams).where(eq(teams.id, id)).for('update');
        if (!team) throw new NotFoundException('Team not found');

        const set: Partial<typeof teams.$inferInsert> = {};
        if (input.name !== undefined) set.name = input.name;
        let moved = 0;
        if (input.departmentId !== undefined && input.departmentId !== team.departmentId) {
          await departmentExists(tx, input.departmentId);
          set.departmentId = input.departmentId;
          moved = await countActive(tx, eq(employees.teamId, id));
        }
        if (input.leadEmployeeId !== undefined && input.leadEmployeeId !== team.leadEmployeeId) {
          if (input.leadEmployeeId) await activeEmployee(tx, input.leadEmployeeId, 'The team lead');
          set.leadEmployeeId = input.leadEmployeeId;
        }
        if (Object.keys(set).length) await tx.update(teams).set(set).where(eq(teams.id, id));

        let reassigned: string[] = [];
        let loops: LoopSkip[] = [];
        if (input.makeMembersReport && input.leadEmployeeId) {
          const plan = await this.leadPlan(tx, access, id, team.leadEmployeeId, input.leadEmployeeId);
          if (plan.members.length && input.leadEmployeeId === access.employeeId && !access.isAdmin) {
            throw new ForbiddenException("Only an Admin can make themselves someone's manager");
          }
          const changes = await setManagers(
            tx,
            ctx.tenantId,
            plan.members.map((m) => ({ employeeId: m.id, managerId: input.leadEmployeeId! })),
          );
          await queueManagerEmails(this.jobs, tx, ctx.tenantId, ctx.userId, changes);
          reassigned = changes.map((c) => c.employeeId);
          loops = plan.loops;
        }
        await this.audit.record(tx, ctx, {
          action: 'team.updated',
          entityType: 'team',
          entityId: id,
          data: { fields: Object.keys(set), ...(moved ? { moved } : {}), ...(reassigned.length ? { reassigned: reassigned.length } : {}) },
        });
        return { team: await this.team(tx, id), moved, reassigned, loops };
      })
      .catch(mapDbError);
  }

  /** What "Make team members report to <lead>" would change: `{ members, loops }` (nothing is saved). */
  leadPreview(ctx: TenantContext, id: string, leadEmployeeId: string) {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const access = await this.hr(tx, ctx);
      const [team] = await tx.select({ leadEmployeeId: teams.leadEmployeeId }).from(teams).where(eq(teams.id, id));
      if (!team) throw new NotFoundException('Team not found');
      await activeEmployee(tx, leadEmployeeId, 'The team lead');
      return this.leadPlan(tx, access, id, team.leadEmployeeId, leadEmployeeId);
    });
  }

  /**
   * Members of the team who would report to `leadId`: active, not the lead, with no manager or
   * reporting to the previous lead. Those for whom it would close a loop go to `loops` with the
   * message; an Administration caller's own record is left out (only Admins change their own).
   */
  private async leadPlan(tx: Tx, access: CallerAccess, teamId: string, previousLeadId: string | null, leadId: string) {
    const rows = await this.people(
      tx,
      and(eq(employees.teamId, teamId), sql`${employees.id} <> ${leadId}`, previousLeadId ? or(isNull(employees.managerId), eq(employees.managerId, previousLeadId)) : isNull(employees.managerId)),
    );
    const members: typeof rows = [];
    const loops: LoopSkip[] = [];
    for (const r of rows) {
      if (r.managerId === leadId) continue;
      if (access.isSelf(r.id) && !access.isAdmin) continue;
      try {
        await assertValidManager(tx, r.id, leadId);
        members.push(r);
      } catch (err) {
        if (!isLoopError(err)) throw err;
        loops.push({ id: r.id, fullName: r.fullName, message: (err.getResponse() as { message: string }).message });
      }
    }
    return { members, loops };
  }

  /** Deleting a team is allowed at any time: its members stay in the department without a team. */
  deleteTeam(ctx: TenantContext, id: string) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        await this.hr(tx, ctx);
        const [t] = await tx.select({ name: teams.name }).from(teams).where(eq(teams.id, id)).for('update');
        if (!t) throw new NotFoundException('Team not found');
        await tx.delete(teams).where(eq(teams.id, id));
        await this.audit.record(tx, ctx, { action: 'team.deleted', entityType: 'team', entityId: id, data: { name: t.name } });
      })
      .catch(mapDbError);
  }

  /** For the delete and move confirmations: the team's active members. */
  teamUsage(ctx: TenantContext, id: string) {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      await this.hr(tx, ctx);
      const [t] = await tx.select({ id: teams.id, name: teams.name, departmentId: teams.departmentId }).from(teams).where(eq(teams.id, id));
      if (!t) throw new NotFoundException('Team not found');
      return { ...t, members: await this.people(tx, eq(employees.teamId, id)) };
    });
  }

  // ------------------------------------------------------------------ assigning people

  /**
   * "Add people" before saving: for each employee, where they are now (`moves` when they leave
   * another team or department) and, when they have no manager, the suggested Reports to: the
   * team's lead, else the department's head (never themselves, never a loop). Nothing is saved.
   */
  previewAssignment(ctx: TenantContext, input: AssignmentPreview) {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      await this.hr(tx, ctx);
      const target = await this.target(tx, input.departmentId, input.teamId ?? null);
      const rows = await this.people(tx, inArray(employees.id, input.employeeIds), true);
      const people = [];
      for (const r of rows) {
        const moves = input.teamId ? r.teamId !== input.teamId && (r.teamId !== null || r.departmentId !== input.departmentId) : r.departmentId !== input.departmentId;
        let suggested: { id: string; fullName: string } | null = null;
        if (!r.managerId) {
          for (const candidate of [target.lead, target.head]) {
            if (!candidate || candidate.id === r.id) continue;
            try {
              await assertValidManager(tx, r.id, candidate.id);
              suggested = candidate;
              break;
            } catch (err) {
              if (!isLoopError(err)) throw err;
            }
          }
        }
        people.push({ ...r, moves, suggestedManagerId: suggested?.id ?? null, suggestedManagerName: suggested?.fullName ?? null });
      }
      return { employees: people };
    });
  }

  /**
   * Puts the employees in the department, and in the team when given (moving them out of any other
   * team). Without a team, someone already in a team of that department keeps it. `managers` sets
   * Reports to of some of them in the same transaction (loop-checked, emails queued).
   */
  assign(ctx: TenantContext, input: Assign) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const access = await this.hr(tx, ctx);
        const ids = [...new Set(input.employeeIds)];
        if (!access.isAdmin && access.employeeId && ids.includes(access.employeeId)) {
          throw new ForbiddenException('Only an Admin can change their own department, team or manager');
        }
        const managers = Object.entries(input.managers ?? {});
        if (managers.some(([id]) => !ids.includes(id))) throw new BadRequestException('Managers can only be set for the employees being added');
        if (!access.isAdmin && managers.some(([, m]) => m && m === access.employeeId)) throw new ForbiddenException("Only an Admin can make themselves someone's manager");
        if (managers.length) await lockReportingLines(tx, ctx.tenantId);
        await this.target(tx, input.departmentId, input.teamId ?? null);

        const rows = await tx.select({ id: employees.id, fullName: employees.fullName, deactivatedAt: employees.deactivatedAt }).from(employees).where(inArray(employees.id, ids));
        if (rows.length !== ids.length) throw new BadRequestException('Employee not found');
        const left = rows.find((r) => r.deactivatedAt);
        if (left) throw new BadRequestException(`${left.fullName} has left the company`);

        await tx
          .update(employees)
          .set({
            departmentId: input.departmentId,
            teamId: input.teamId ? input.teamId : sql`case when ${employees.departmentId} = ${input.departmentId} then ${employees.teamId} end`,
          })
          .where(inArray(employees.id, ids));
        const changes = await setManagers(
          tx,
          ctx.tenantId,
          managers.map(([employeeId, managerId]) => ({ employeeId, managerId })),
        );
        await queueManagerEmails(this.jobs, tx, ctx.tenantId, ctx.userId, changes);
        await this.audit.record(tx, ctx, {
          action: 'employees.assigned',
          entityType: input.teamId ? 'team' : 'department',
          entityId: input.teamId ?? input.departmentId,
          data: { count: ids.length, managers: changes.length },
        });
        return { updated: ids.length, managersChanged: changes.map((c) => c.employeeId) };
      })
      .catch(mapDbError);
  }

  /**
   * "Set manager" for one or many employees (spec 7.2): Administration and Admin; nobody but an
   * Admin changes their own manager or makes themselves someone's manager. All or nothing: a loop
   * anywhere refuses the whole change (409, naming the loop). Emails the changes.
   */
  setReportingLines(ctx: TenantContext, input: SetReportingLines) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const access = await this.access.of(ctx, tx);
        if (!access.isHr) throw new ForbiddenException('Only Administration and Admins change reporting lines');
        const ids = [...new Set(input.employeeIds)];
        if (!access.isAdmin && access.employeeId && ids.includes(access.employeeId)) throw new ForbiddenException('Only an Admin can change their own manager');
        if (!access.isAdmin && input.managerId && input.managerId === access.employeeId) throw new ForbiddenException("Only an Admin can make themselves someone's manager");
        await lockReportingLines(tx, ctx.tenantId);
        const rows = await tx.select({ id: employees.id, fullName: employees.fullName, deactivatedAt: employees.deactivatedAt }).from(employees).where(inArray(employees.id, ids));
        if (rows.length !== ids.length) throw new BadRequestException('Employee not found');
        const left = rows.find((r) => r.deactivatedAt);
        if (left) throw new BadRequestException(`${left.fullName} has left the company`);
        const changes = await setManagers(
          tx,
          ctx.tenantId,
          ids.map((employeeId) => ({ employeeId, managerId: input.managerId })),
        );
        await queueManagerEmails(this.jobs, tx, ctx.tenantId, ctx.userId, changes);
        if (changes.length) {
          await this.audit.record(tx, ctx, { action: 'employees.manager_set', entityType: 'employee', entityId: changes[0]!.employeeId, data: { count: changes.length } });
        }
        return { changed: changes.map((c) => c.employeeId) };
      })
      .catch(mapDbError);
  }

  // ------------------------------------------------------------------ helpers

  /** Administration or Admin, or 403. */
  private async hr(tx: Tx, ctx: TenantContext): Promise<CallerAccess> {
    const access = await this.access.of(ctx, tx);
    if (!access.isHr) throw new ForbiddenException('Only Administration and Admins change departments and teams');
    return access;
  }

  private async department(tx: Tx, id: string) {
    const [row] = await this.departmentRows(tx, eq(departments.id, id));
    return row!;
  }

  private async team(tx: Tx, id: string) {
    const [row] = await this.teamRows(tx, eq(teams.id, id));
    return row!;
  }

  /** Active employees matching `where` (all of them with `includeInactive`), by name. */
  private people(tx: Tx, where: SQL | undefined, includeInactive = false) {
    return tx
      .select(personColumns)
      .from(employees)
      .leftJoin(teams, eq(teams.id, employees.teamId))
      .leftJoin(managerRow, eq(managerRow.id, employees.managerId))
      .where(and(where, includeInactive ? undefined : isNull(employees.deactivatedAt)))
      .orderBy(asc(employees.lastName), asc(employees.firstName));
  }

  /** The department and team people are added to (400 when missing, or the team is elsewhere), with the active lead and head. */
  private async target(tx: Tx, departmentId: string, teamId: string | null) {
    const [d] = await tx
      .select({ id: departments.id, headId: head.id, headName: head.fullName, headLeft: head.deactivatedAt })
      .from(departments)
      .leftJoin(head, eq(head.id, departments.headEmployeeId))
      .where(eq(departments.id, departmentId));
    if (!d) throw new BadRequestException('Department not found');
    let leadOf: { id: string; fullName: string } | null = null;
    if (teamId) {
      const [t] = await tx
        .select({ departmentId: teams.departmentId, leadId: lead.id, leadName: lead.fullName, leadLeft: lead.deactivatedAt })
        .from(teams)
        .leftJoin(lead, eq(lead.id, teams.leadEmployeeId))
        .where(eq(teams.id, teamId));
      if (!t) throw new BadRequestException('Team not found');
      if (t.departmentId !== departmentId) throw new BadRequestException('The team belongs to another department');
      if (t.leadId && t.leadName && !t.leadLeft) leadOf = { id: t.leadId, fullName: t.leadName };
    }
    return { lead: leadOf, head: d.headId && d.headName && !d.headLeft ? { id: d.headId, fullName: d.headName } : null };
  }
}

/** A member the team-lead dialog leaves alone because reporting to the lead would close a loop. */
interface LoopSkip {
  id: string;
  fullName: string;
  message: string;
}

/** A head or lead must be an active employee of the workspace (spec 6.2). */
async function activeEmployee(tx: Tx, id: string, what: string) {
  const [e] = await tx.select({ fullName: employees.fullName, deactivatedAt: employees.deactivatedAt }).from(employees).where(eq(employees.id, id));
  if (!e) throw new BadRequestException(`${what} must be an employee of this workspace`);
  if (e.deactivatedAt) throw new BadRequestException(`${what} must be an active employee: ${e.fullName} has left the company`);
}

async function departmentExists(tx: Tx, id: string) {
  const [d] = await tx.select({ id: departments.id }).from(departments).where(eq(departments.id, id));
  if (!d) throw new BadRequestException('Department not found');
}

async function countActive(tx: Tx, where: SQL): Promise<number> {
  const [row] = await tx.select({ n: sql<number>`count(*)::int` }).from(employees).where(and(where, isNull(employees.deactivatedAt)));
  return row?.n ?? 0;
}
