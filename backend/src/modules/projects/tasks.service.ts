import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, inArray, type SQL, sql } from 'drizzle-orm';
import { AuditService } from '../../shared/audit/audit.service';
import { hasRole, type TenantContext } from '../../shared/authorization';
import { DatabaseService, type Tx } from '../../shared/database/database.service';
import { mapDbError } from '../../shared/database/errors';
import { companies, employees, MAX_TASK_ASSIGNEES, projects, projectStages, recordChanges, taskAssignments, taskCounters, tasks, users } from '../../shared/database/schema';
import { JobsService } from '../../shared/events/jobs.service';
import { PeopleAccess } from '../people';
import { canAssign, canCreateTask, canManage, type TaskCaller, taskAccess, type TaskAccessLevel } from './task-access';
import { refreshLimitAlert } from './hour-limits';
import { hoursSummary, taskHours } from './task-hours';
import { loggableTasks, logTimeRefusal } from './task-log';
import { closedProjectHint, timeEntriesOf } from './time-entries';
import type { AssignTask, CreateTask, ListTasksQuery, SetHourLimit, TaskHistoryQuery, UpdateTask } from './tasks.schemas';

/** One person on a task, as the API returns it. */
export interface TaskAssigneeView {
  employeeId: string;
  name: string;
  jobTitle: string | null;
  /** False once removed ("Not assigned any more"); kept for history and, later, their hours. */
  active: boolean;
  /** Has a member account (else "No account yet": no emails, and they can't sign in to see it). */
  hasAccount: boolean;
  /** Left the company ("(former member)"). */
  formerMember: boolean;
  /** Their hour limit on this task (CD-147); null: no limit. */
  hourLimit: number | null;
}

// Correlated subqueries name the outer table explicitly: in a one-table select Drizzle leaves
// columns unqualified, which would bind them to the subquery's own table.
const assigneesJson = sql<TaskAssigneeView[]>`coalesce((
  select json_agg(json_build_object('employeeId', e.id, 'name', e.full_name, 'jobTitle', e.job_title, 'active', a.active,
    'hasAccount', e.user_id is not null, 'formerMember', e.deactivated_at is not null, 'hourLimit', a.hour_limit::float) order by a.active desc, e.full_name)
  from task_assignments a join employees e on e.id = a.employee_id where a.task_id = "tasks"."id"), '[]'::json)`;
const teamJson = sql<string[]>`coalesce((select json_agg(m.employee_id) from project_members m where m.project_id = "tasks"."project_id"), '[]'::json)`;

/** What the API returns for a task (plus `access` and `canManage`, from the caller). */
const columns = {
  id: tasks.id,
  number: tasks.number,
  name: tasks.name,
  projectId: tasks.projectId,
  projectName: projects.name,
  projectCode: projects.code,
  projectStatus: projects.status,
  projectLeadUserId: projects.leadUserId,
  companyId: projects.companyId,
  companyName: companies.name,
  stageId: tasks.stageId,
  waitsForTaskId: tasks.waitsForTaskId,
  /** The task it waits for, in brief (its number, status and due date; the name only on the task's page). */
  waitsFor: sql<{ id: string; number: number; status: string; dueDate: string | null } | null>`(select json_build_object('id', w.id, 'number', w.number, 'status', w.status, 'dueDate', w.due_date::text) from tasks w where w.id = "tasks"."waits_for_task_id")`,
  stageName: projectStages.name,
  stagePosition: projectStages.position,
  status: tasks.status,
  onHoldReason: tasks.onHoldReason,
  description: tasks.description,
  startDate: sql<string | null>`${tasks.startDate}::text`,
  dueDate: sql<string | null>`${tasks.dueDate}::text`,
  estimateHours: tasks.estimateHours,
  doneAt: tasks.doneAt,
  createdAt: tasks.createdAt,
  version: tasks.updatedAt,
  assignees: assigneesJson,
  teamIds: teamJson,
};

type TaskRow = Awaited<ReturnType<typeof selectTasks>>[number];

function selectTasks(tx: Tx, where?: SQL, limit = 500) {
  return tx
    .select(columns)
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .innerJoin(companies, eq(companies.id, projects.companyId))
    .leftJoin(projectStages, eq(projectStages.id, tasks.stageId))
    .where(where)
    .orderBy(desc(tasks.number))
    .limit(limit);
}

const facts = (row: Pick<TaskRow, 'projectLeadUserId' | 'teamIds' | 'assignees'>) => ({
  leadUserId: row.projectLeadUserId,
  teamIds: row.teamIds,
  assigneeIds: row.assignees.filter((a) => a.active).map((a) => a.employeeId),
});

/** A task as the API returns it, with what the caller may do. */
function present(row: TaskRow, caller: TaskCaller, access: TaskAccessLevel) {
  // The team's ids are only for the access check, not for the client.
  const task: Omit<TaskRow, 'teamIds'> & { teamIds?: string[] } = { ...row };
  delete task.teamIds;
  return { ...task, access, canManage: access === 'act' && canManage(caller, row.projectLeadUserId) };
}
export type TaskView = ReturnType<typeof present>;

/**
 * What the visibility rules (task-access.ts) let the caller list, as SQL, so lists and search never
 * return a task the caller can't see: the project lead, the project team, and the active assignees
 * that are the caller or below them in the org chart. Owners and admins see every task.
 */
function visibleWhere(caller: TaskCaller): SQL | undefined {
  if (caller.admin) return undefined;
  const people = [...new Set([...(caller.employeeId ? [caller.employeeId] : []), ...caller.reportIds])];
  const conditions: SQL[] = [sql`${projects.leadUserId} = ${caller.userId}`];
  if (caller.employeeId) conditions.push(sql`exists (select 1 from project_members m where m.project_id = "tasks"."project_id" and m.employee_id = ${caller.employeeId})`);
  if (people.length)
    conditions.push(
      sql`exists (select 1 from task_assignments a where a.task_id = "tasks"."id" and a.active and a.employee_id in (${sql.join(
        people.map((id) => sql`${id}`),
        sql`, `,
      )}))`,
    );
  return sql`(${sql.join(conditions, sql` or `)})`;
}

/** The task's history, newest first, as the CRM's history endpoint returns it (ChangeHistory on the page). */
export interface TaskHistoryEntry {
  id: string;
  action: string;
  field: string | null;
  oldValue: unknown;
  newValue: unknown;
  oldLabel: string | null;
  newLabel: string | null;
  label: string | null;
  actor: { userId: string | null; name: string } | null;
  changedAt: Date;
}

/**
 * Project tasks (CD-146, design v2 §3, §4). Who may see and change a task is decided in
 * task-access.ts; this service feeds it the caller (PeopleAccess) and the task's facts, and answers
 * 404 for a task the caller can't see. Assigning someone else emails them through the job
 * `projects.task-assigned`. Time entries (milestone 15) use `canLogTime` and `loggableTasks`
 * (task-log.ts).
 */
@Injectable()
export class TasksService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly jobs: JobsService,
    private readonly people: PeopleAccess,
  ) {}

  /** The tasks the caller can see, newest first, narrowed by project, assignee, status or text. */
  list(ctx: TenantContext, query: ListTasksQuery) {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const caller = await this.caller(ctx, tx);
      const assignee = query.assigneeId === 'me' ? caller.employeeId : query.assigneeId;
      if (query.assigneeId === 'me' && !assignee) return [];
      const q = query.q?.toLowerCase();
      const where = and(
        visibleWhere(caller),
        query.projectId ? eq(tasks.projectId, query.projectId) : undefined,
        query.status ? eq(tasks.status, query.status) : undefined,
        assignee ? sql`exists (select 1 from task_assignments a where a.task_id = "tasks"."id" and a.active and a.employee_id = ${assignee})` : undefined,
        q
          ? sql`(position(${q} in lower(${tasks.name})) > 0 or ('t-' || ${tasks.number}) = ${q} or ${tasks.number}::text = ${q.replace(/^#/, '')} or position(${q} in lower(${projects.name})) > 0)`
          : undefined,
      );
      const rows = await selectTasks(tx, where, query.limit);
      return rows.flatMap((row) => {
        const access = taskAccess(caller, facts(row));
        return access === 'none' ? [] : [present(row, caller, access)];
      });
    });
  }

  /** The caller's own loggable tasks (task-log.ts); none without an employee record. */
  loggable(ctx: TenantContext) {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const caller = await this.caller(ctx, tx);
      return caller.employeeId ? loggableTasks(tx, caller.employeeId) : [];
    });
  }

  get(ctx: TenantContext, id: string) {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const caller = await this.caller(ctx, tx);
      const { row, access } = await this.visible(tx, caller, id);
      return { ...present(row, caller, access), dependencies: await this.dependencies(tx, caller, row) };
    });
  }

  create(ctx: TenantContext, input: CreateTask) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const caller = await this.caller(ctx, tx);
        const project = await this.project(tx, input.projectId);
        if (project.status !== 'open') throw new BadRequestException('Tasks can only be added to an open project');
        if (!canCreateTask(caller, project)) throw new ForbiddenException('Only the project team, its lead, owners and admins can add tasks');
        const stageId = input.stageId === undefined || input.stageId === null ? project.stageId : await this.checkStage(tx, input.stageId, project.projectTypeId);
        const assigneeIds = [...new Set(input.assigneeIds ?? [])];
        for (const employeeId of assigneeIds) this.assertCanAssign(caller, project.leadUserId, employeeId);
        await this.checkAssignable(tx, assigneeIds);

        const [counter] = await tx
          .insert(taskCounters)
          .values({ tenantId: ctx.tenantId, lastNumber: 1 })
          .onConflictDoUpdate({ target: taskCounters.tenantId, set: { lastNumber: sql`${taskCounters.lastNumber} + 1` } })
          .returning({ number: taskCounters.lastNumber });
        const [row] = await tx
          .insert(tasks)
          .values({
            tenantId: ctx.tenantId,
            number: counter!.number,
            projectId: input.projectId,
            stageId,
            name: input.name,
            description: input.description ?? null,
            startDate: input.startDate ?? null,
            dueDate: input.dueDate ?? null,
            estimateHours: input.estimateHours ?? null,
            createdByUserId: ctx.userId,
          })
          .returning({ id: tasks.id });
        const taskId = row!.id;
        if (assigneeIds.length) {
          await tx.insert(taskAssignments).values(assigneeIds.map((employeeId) => ({ tenantId: ctx.tenantId, taskId, employeeId, assignedByUserId: ctx.userId })));
          await this.emailAssigned(tx, ctx, taskId, assigneeIds);
        }
        await this.audit.record(tx, ctx, { action: 'task.created', entityType: 'task', entityId: taskId, data: { ...input, number: counter!.number } });
        return this.presentById(tx, caller, taskId);
      })
      .catch(mapDbError);
  }

  /** See UpdateTask for the rules of status, On hold and moving to another project. */
  update(ctx: TenantContext, id: string, input: UpdateTask) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const caller = await this.caller(ctx, tx);
        const { row } = await this.changeable(tx, caller, id);
        const patch: Partial<typeof tasks.$inferInsert> = {
          name: input.name,
          description: input.description,
          startDate: input.startDate,
          dueDate: input.dueDate,
          estimateHours: input.estimateHours,
        };

        // Another project: the lead of both (or an admin); it lands at that project's current stage.
        let project = { id: row.projectId, projectTypeId: '' };
        if (input.projectId && input.projectId !== row.projectId) {
          const target = await this.project(tx, input.projectId);
          if (!canManage(caller, row.projectLeadUserId) || !canManage(caller, target.leadUserId)) throw new ForbiddenException('Only the lead of both projects, owners and admins can move a task');
          if (target.status !== 'open') throw new BadRequestException('Tasks can only be moved to an open project');
          patch.projectId = target.id;
          patch.stageId = target.stageId;
          // Dependencies stay within a project (CD-269): moving clears them both ways.
          patch.waitsForTaskId = null;
          await tx.update(tasks).set({ waitsForTaskId: null }).where(eq(tasks.waitsForTaskId, id));
          project = target;
        }
        if (input.waitsForTaskId !== undefined) {
          if (input.waitsForTaskId !== null) await this.checkDependency(tx, id, project.id, input.waitsForTaskId);
          patch.waitsForTaskId = input.waitsForTaskId;
        }
        if (input.stageId !== undefined) {
          if (!project.projectTypeId) project = await this.project(tx, project.id);
          patch.stageId = input.stageId === null ? null : await this.checkStage(tx, input.stageId, project.projectTypeId);
        }

        // Status: On hold needs a reason (sent, or the one it has); leaving On hold clears it.
        const status = input.status ?? row.status;
        if (status === 'on_hold') {
          const reason = input.onHoldReason ?? row.onHoldReason;
          if (!reason) throw new BadRequestException('Tell the team why the work is paused');
          patch.onHoldReason = reason;
        } else if (input.onHoldReason) {
          throw new BadRequestException('Only a task on hold has a reason');
        } else {
          patch.onHoldReason = null;
        }
        if (input.status && input.status !== row.status) {
          patch.status = input.status;
          patch.doneAt = input.status === 'done' ? new Date() : null;
        }

        await tx.update(tasks).set(patch).where(eq(tasks.id, id));
        await this.audit.record(tx, ctx, { action: 'task.updated', entityType: 'task', entityId: id, data: input });
        return this.presentById(tx, caller, id);
      })
      .catch(mapDbError);
  }

  /** The project lead, owners and admins. A task with time logged on it is kept: 409 "Mark it done instead" (time_entries_task_fk). */
  remove(ctx: TenantContext, id: string) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const caller = await this.caller(ctx, tx);
        const { row } = await this.changeable(tx, caller, id);
        if (!canManage(caller, row.projectLeadUserId)) throw new ForbiddenException('Only the project lead, owners and admins can delete a task');
        await tx.delete(tasks).where(eq(tasks.id, id));
        await this.audit.record(tx, ctx, { action: 'task.deleted', entityType: 'task', entityId: id, data: { number: row.number, name: row.name, projectId: row.projectId } });
      })
      .catch(mapDbError);
  }

  /** Adds people (or brings back removed ones); someone already on the task: 409. Answers with the task. */
  assign(ctx: TenantContext, id: string, input: AssignTask) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const caller = await this.caller(ctx, tx);
        const { row } = await this.changeable(tx, caller, id);
        const ids = [...new Set(input.employeeIds)];
        for (const employeeId of ids) this.assertCanAssign(caller, row.projectLeadUserId, employeeId);
        const limits = input.hourLimits ?? {};
        if (Object.keys(limits).length && !canManage(caller, row.projectLeadUserId)) throw new ForbiddenException('Only the project lead, owners and admins set hour limits');
        if (row.assignees.some((a) => a.active && ids.includes(a.employeeId))) throw new ConflictException('Already assigned to this task');
        if (row.assignees.filter((a) => a.active).length + ids.length > MAX_TASK_ASSIGNEES) throw new BadRequestException(`At most ${MAX_TASK_ASSIGNEES} people on one task`);
        await this.checkAssignable(tx, ids);
        await tx
          .insert(taskAssignments)
          .values(ids.map((employeeId) => ({ tenantId: ctx.tenantId, taskId: id, employeeId, hourLimit: limits[employeeId] ?? null, assignedByUserId: ctx.userId })))
          .onConflictDoUpdate({
            target: [taskAssignments.tenantId, taskAssignments.taskId, taskAssignments.employeeId],
            set: { active: true, hourLimit: sql`excluded.hour_limit`, assignedByUserId: ctx.userId, assignedAt: sql`now()` },
          });
        await this.emailAssigned(tx, ctx, id, ids);
        // Someone brought back with hours already logged may be at or over their new limit (CD-149).
        for (const employeeId of ids) await refreshLimitAlert(tx, this.jobs, ctx.tenantId, id, employeeId);
        await this.audit.record(tx, ctx, { action: 'task.assigned', entityType: 'task', entityId: id, data: { employeeIds: ids } });
        return this.presentById(tx, caller, id);
      })
      .catch(mapDbError);
  }

  /** Takes someone off the task: their row stays, inactive ("Not assigned any more"). */
  unassign(ctx: TenantContext, id: string, employeeId: string) {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const caller = await this.caller(ctx, tx);
      const { row } = await this.changeable(tx, caller, id);
      this.assertCanAssign(caller, row.projectLeadUserId, employeeId);
      const [done] = await tx
        .update(taskAssignments)
        .set({ active: false })
        .where(and(eq(taskAssignments.taskId, id), eq(taskAssignments.employeeId, employeeId), eq(taskAssignments.active, true)))
        .returning({ employeeId: taskAssignments.employeeId });
      if (!done) throw new NotFoundException('Not assigned to this task');
      await refreshLimitAlert(tx, this.jobs, ctx.tenantId, id, employeeId);
      await this.audit.record(tx, ctx, { action: 'task.unassigned', entityType: 'task', entityId: id, data: { employeeId } });
      return this.presentById(tx, caller, id);
    });
  }

  /**
   * Someone's hour limit on the task (CD-147): the lead, owners and admins; also below the hours
   * they logged (they show as over). Every change is in the task's history.
   */
  setHourLimit(ctx: TenantContext, id: string, employeeId: string, input: SetHourLimit) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const caller = await this.caller(ctx, tx);
        const { row } = await this.changeable(tx, caller, id);
        if (!canManage(caller, row.projectLeadUserId)) throw new ForbiddenException('Only the project lead, owners and admins set hour limits');
        const [done] = await tx
          .update(taskAssignments)
          .set({ hourLimit: input.hourLimit })
          .where(and(eq(taskAssignments.taskId, id), eq(taskAssignments.employeeId, employeeId), eq(taskAssignments.active, true)))
          .returning({ employeeId: taskAssignments.employeeId });
        if (!done) throw new NotFoundException('Not assigned to this task');
        // Raising a limit clears the alert at once; lowering it below the hours logged sends the email (CD-149).
        await refreshLimitAlert(tx, this.jobs, ctx.tenantId, id, employeeId);
        await this.audit.record(tx, ctx, { action: 'task.limit_set', entityType: 'task', entityId: id, data: { employeeId, hourLimit: input.hourLimit } });
        return this.presentById(tx, caller, id);
      })
      .catch(mapDbError);
  }

  /**
   * The People and hours card (CD-147): a row per person (removed people who logged hours too) and
   * the total. The lead, the people's managers and admins see everyone's hours; anyone else sees
   * their own and only the others' names.
   */
  hours(ctx: TenantContext, id: string) {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const caller = await this.caller(ctx, tx);
      const { row } = await this.visible(tx, caller, id);
      const seesAll = canManage(caller, row.projectLeadUserId) || row.assignees.some((a) => caller.reportIds.has(a.employeeId));
      return hoursSummary(row.assignees, await taskHours(tx, id), { seesAll, me: caller.employeeId });
    });
  }

  /**
   * The task page's Time card (CD-276): the entries (the caller's own; everyone's for the lead,
   * owners, admins and the people's managers), everyone's total, whether the caller can log time
   * here and, when the task is locked, why.
   */
  time(ctx: TenantContext, id: string) {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const caller = await this.caller(ctx, tx);
      const { row } = await this.visible(tx, caller, id);
      const lead = canManage(caller, row.projectLeadUserId);
      const projectClosed = row.projectStatus !== 'open';
      const locked = projectClosed || row.status === 'done';
      const me = caller.employeeId ? row.assignees.find((a) => a.employeeId === caller.employeeId) : undefined;
      const refusal = caller.employeeId
        ? logTimeRefusal({ taskStatus: row.status, projectStatus: row.projectStatus, assignment: me ? { active: me.active } : null })
        : 'not_assigned';
      const time = await timeEntriesOf(tx, { taskId: id }, { me: caller.employeeId, seesAllOf: (e) => lead || caller.reportIds.has(e), locked });
      return {
        ...time,
        estimateMinutes: row.estimateHours == null ? null : Math.round(row.estimateHours * 60),
        canLog: refusal === null,
        lock: projectClosed
          ? {
              kind: 'project_closed' as const,
              title: await closedProjectHint(tx, row),
              text: "Time can't be logged, edited or deleted on its tasks. A project lead or Admin can reopen the project to log time again.",
            }
          : row.status === 'done'
            ? { kind: 'task_done' as const, title: 'This task is done.', text: 'Reopen it to log, edit or delete time.' }
            : null,
      };
    });
  }

  /** Newest first; `more` says whether older entries exist. Stages, projects and people are named. */
  history(ctx: TenantContext, id: string, query: TaskHistoryQuery) {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const caller = await this.caller(ctx, tx);
      await this.visible(tx, caller, id);
      const rows = await tx
        .select({ change: recordChanges, actorName: sql<string | null>`coalesce(${users.displayName}, ${users.email})` })
        .from(recordChanges)
        .leftJoin(users, eq(users.id, recordChanges.actorUserId))
        .where(and(eq(recordChanges.entityType, 'task'), eq(recordChanges.entityId, id)))
        .orderBy(desc(recordChanges.changedAt), desc(recordChanges.id))
        .limit(query.limit + 1)
        .offset(query.offset);
      const page = rows.slice(0, query.limit);
      const ids = (field: string) => [...new Set(page.filter((r) => r.change.field === field).flatMap((r) => [r.change.oldValue, r.change.newValue]).filter((v): v is string => typeof v === 'string'))];
      const names = new Map<string, string>();
      const stageIds = ids('stageId');
      const taskIds = ids('waitsForTaskId');
      if (taskIds.length) for (const t of await tx.select({ id: tasks.id, number: tasks.number, name: tasks.name }).from(tasks).where(inArray(tasks.id, taskIds))) names.set(t.id, `T-${t.number} · ${t.name}`);
      const projectIds = ids('projectId');
      if (stageIds.length) for (const s of await tx.select({ id: projectStages.id, name: projectStages.name }).from(projectStages).where(inArray(projectStages.id, stageIds))) names.set(s.id, s.name);
      if (projectIds.length) for (const p of await tx.select({ id: projects.id, name: projects.name }).from(projects).where(inArray(projects.id, projectIds))) names.set(p.id, p.name);
      const GONE: Record<string, string> = { stageId: 'Deleted stage', projectId: 'Deleted project', waitsForTaskId: 'Deleted task' };
      const label = (field: string | null, v: unknown) => (typeof v === 'string' && field && GONE[field] ? (names.get(v) ?? GONE[field]) : null);
      const entries: TaskHistoryEntry[] = page.map(({ change: c, actorName }) => ({
        id: c.id,
        action: c.action,
        field: c.field,
        oldValue: c.oldValue,
        newValue: c.newValue,
        oldLabel: label(c.field, c.oldValue),
        newLabel: label(c.field, c.newValue),
        label: c.label,
        actor: c.actorUserId ? { userId: c.actorUserId, name: actorName ?? 'A former member' } : null,
        changedAt: c.changedAt,
      }));
      return { entries, more: rows.length > query.limit };
    });
  }

  /**
   * For the task's checklist, comments and files (CD-270): the caller and the task, or 404 when
   * they can't see it and 403 when `act` is needed but they only read it.
   */
  async require(tx: Tx, ctx: TenantContext, id: string, need: 'read' | 'act') {
    const caller = await this.caller(ctx, tx);
    const found = need === 'act' ? await this.changeable(tx, caller, id) : await this.visible(tx, caller, id);
    return { caller, ...found };
  }

  // ---------------------------------------------------------------- helpers

  private async caller(ctx: TenantContext, tx: Tx): Promise<TaskCaller> {
    const access = await this.people.of(ctx, tx);
    return { userId: ctx.userId, admin: hasRole(ctx.role, 'admin'), employeeId: access.employeeId, directReportIds: access.directReportIds, reportIds: access.reportIds };
  }

  /** The task and the caller's access to it; 404 when they can't see it (or it doesn't exist). */
  private async visible(tx: Tx, caller: TaskCaller, id: string): Promise<{ row: TaskRow; access: Exclude<TaskAccessLevel, 'none'> }> {
    const [row] = await selectTasks(tx, eq(tasks.id, id), 1);
    const access = row ? taskAccess(caller, facts(row)) : 'none';
    if (!row || access === 'none') throw new NotFoundException('Task not found');
    return { row, access };
  }

  /** As `visible`, and 403 for read-only access (indirect managers). */
  private async changeable(tx: Tx, caller: TaskCaller, id: string) {
    const found = await this.visible(tx, caller, id);
    if (found.access !== 'act') throw new ForbiddenException('You can see this task but not change it');
    return found;
  }

  private async presentById(tx: Tx, caller: TaskCaller, id: string) {
    const [row] = await selectTasks(tx, eq(tasks.id, id), 1);
    // The caller made this change, so they could act on it; after removing themselves they may not see it any more.
    return { ...present(row!, caller, taskAccess(caller, facts(row!)) === 'read' ? 'read' : 'act'), dependencies: await this.dependencies(tx, caller, row!) };
  }

  /**
   * The task page's Dependencies card (CD-269): the task this one waits for and the ones waiting for
   * it, those the caller can see, with names.
   */
  private async dependencies(tx: Tx, caller: TaskCaller, row: TaskRow) {
    const rows = await tx
      .select({ id: tasks.id, number: tasks.number, name: tasks.name, status: tasks.status, dueDate: sql<string | null>`${tasks.dueDate}::text`, waitsForTaskId: tasks.waitsForTaskId })
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(and(visibleWhere(caller), row.waitsForTaskId ? sql`(${tasks.id} = ${row.waitsForTaskId} or ${tasks.waitsForTaskId} = ${row.id})` : eq(tasks.waitsForTaskId, row.id)))
      .orderBy(tasks.number);
    const brief = ({ waitsForTaskId: _w, ...t }: (typeof rows)[number]) => t;
    return { waitsFor: rows.filter((t) => t.id === row.waitsForTaskId).map(brief)[0] ?? null, blocks: rows.filter((t) => t.waitsForTaskId === row.id).map(brief) };
  }

  /** "Waits for" (CD-269): a task of the same project, not itself, and no loop (it can't wait for one that waits for it). */
  private async checkDependency(tx: Tx, id: string, projectId: string, waitsForTaskId: string) {
    if (waitsForTaskId === id) throw new BadRequestException("A task can't wait for itself");
    const [target] = await tx.select({ projectId: tasks.projectId }).from(tasks).where(eq(tasks.id, waitsForTaskId));
    if (!target || target.projectId !== projectId) throw new BadRequestException('Pick a task of the same project');
    // Walk the chain from the target: reaching this task would close a loop.
    const { rows } = await tx.execute<{ id: string }>(sql`
      with recursive chain(id, depth) as (
        select waits_for_task_id, 1 from tasks where id = ${waitsForTaskId} and waits_for_task_id is not null
        union
        select t.waits_for_task_id, c.depth + 1 from tasks t join chain c on t.id = c.id where t.waits_for_task_id is not null and c.depth < 500
      )
      select id::text from chain where id = ${id} limit 1`);
    if (rows.length) throw new BadRequestException('That task already waits for this one');
  }

  private async project(tx: Tx, projectId: string) {
    const [p] = await tx
      .select({
        id: projects.id,
        status: projects.status,
        leadUserId: projects.leadUserId,
        projectTypeId: projects.projectTypeId,
        stageId: projects.stageId,
        teamIds: sql<string[]>`coalesce((select json_agg(m.employee_id) from project_members m where m.project_id = "projects"."id"), '[]'::json)`,
      })
      .from(projects)
      .where(eq(projects.id, projectId));
    if (!p) throw new BadRequestException('Project not found');
    return p;
  }

  private async checkStage(tx: Tx, stageId: string, projectTypeId: string): Promise<string> {
    const [stage] = await tx
      .select({ id: projectStages.id })
      .from(projectStages)
      .where(and(eq(projectStages.id, stageId), eq(projectStages.projectTypeId, projectTypeId)));
    if (!stage) throw new BadRequestException("Pick a stage of the project's type");
    return stage.id;
  }

  private assertCanAssign(caller: TaskCaller, leadUserId: string | null, employeeId: string) {
    if (!canAssign(caller, leadUserId, employeeId)) throw new ForbiddenException('Only the project lead, owners, admins and their managers can assign other people');
  }

  /** Employees of this workspace who haven't left. */
  private async checkAssignable(tx: Tx, ids: string[]) {
    if (!ids.length) return;
    const found = await tx.select({ id: employees.id, deactivatedAt: employees.deactivatedAt }).from(employees).where(inArray(employees.id, ids));
    if (found.length !== ids.length) throw new BadRequestException('Employee not found');
    if (found.some((e) => e.deactivatedAt)) throw new BadRequestException("Someone who left can't be assigned");
  }

  /** "Assigned to a task" to each newly assigned person with an account, other than the caller (the job checks the setting). */
  private async emailAssigned(tx: Tx, ctx: TenantContext, taskId: string, employeeIds: string[]) {
    const people = await tx
      .select({ userId: employees.userId })
      .from(employees)
      .where(and(inArray(employees.id, employeeIds), sql`${employees.userId} is not null`, sql`${employees.userId} <> ${ctx.userId}`));
    for (const { userId } of people) await this.jobs.send('projects.task-assigned', { tenantId: ctx.tenantId, taskId, recipientUserId: userId!, actorUserId: ctx.userId }, tx);
  }
}
