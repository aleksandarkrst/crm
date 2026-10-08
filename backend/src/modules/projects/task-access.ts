/**
 * Who may see and change a task (CD-146). Pure, so the rules are unit-tested
 * (test/task-access.spec.ts); TasksService feeds it the caller (PeopleAccess) and the task's facts.
 *
 * - `act`: owners and admins; the project lead; the project team (CD-271); the task's active
 *   assignees; the direct managers of an active assignee.
 * - `read`: the indirect managers of an active assignee (above the direct manager).
 * - `none`: everyone else. The API answers 404, as if the task didn't exist.
 *
 * Changing who works on it: owners, admins and the lead assign anyone; a direct manager assigns
 * and removes their direct reports; anyone who can act assigns or removes themselves.
 */
export type TaskAccessLevel = 'act' | 'read' | 'none';

export interface TaskCaller {
  userId: string;
  /** Workspace owner or admin. */
  admin: boolean;
  /** The caller's employee record (null for a member without one). */
  employeeId: string | null;
  directReportIds: ReadonlySet<string>;
  /** Direct and indirect reports. */
  reportIds: ReadonlySet<string>;
}

export interface TaskFacts {
  leadUserId: string | null;
  /** Employee ids on the project's team. */
  teamIds: readonly string[];
  /** Employee ids of the task's active assignees. */
  assigneeIds: readonly string[];
}

export function taskAccess(caller: TaskCaller, task: TaskFacts): TaskAccessLevel {
  if (caller.admin || task.leadUserId === caller.userId) return 'act';
  const me = caller.employeeId;
  if (me && (task.teamIds.includes(me) || task.assigneeIds.includes(me))) return 'act';
  if (task.assigneeIds.some((id) => caller.directReportIds.has(id))) return 'act';
  if (task.assigneeIds.some((id) => caller.reportIds.has(id))) return 'read';
  return 'none';
}

/** Whether the caller may create a task in a project: owners, admins, the lead and the team. */
export function canCreateTask(caller: TaskCaller, project: Pick<TaskFacts, 'leadUserId' | 'teamIds'>): boolean {
  return caller.admin || project.leadUserId === caller.userId || (!!caller.employeeId && project.teamIds.includes(caller.employeeId));
}

/** Whether the caller may add or remove `employeeId` on a task they can act on. */
export function canAssign(caller: TaskCaller, leadUserId: string | null, employeeId: string): boolean {
  return caller.admin || leadUserId === caller.userId || caller.employeeId === employeeId || caller.directReportIds.has(employeeId);
}

/** Whether the caller may delete the task, or move it out of / into a project with this lead. */
export function canManage(caller: TaskCaller, leadUserId: string | null): boolean {
  return caller.admin || leadUserId === caller.userId;
}
