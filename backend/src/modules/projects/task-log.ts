import { and, asc, eq, ne } from 'drizzle-orm';
import type { Tx } from '../../shared/database/database.service';
import { projects, taskAssignments, tasks } from '../../shared/database/schema';

/**
 * Who may log time on a task (CD-146): the one rule milestone 15's timesheets use, so they never
 * reimplement it. Call it inside `DatabaseService.withTenant` (RLS).
 */

/** Why someone can't log time on a task; null when they can. */
export type LogTimeRefusal = 'not_found' | 'not_assigned' | 'task_done' | 'project_closed';

export interface LogTimeFacts {
  taskStatus: string;
  projectStatus: string;
  /** The person has an assignment on the task, and whether it is active. */
  assignment: { active: boolean } | null;
}

/** Pure: an active assignee, on a task that isn't Done, in an open project (unit-tested). */
export function logTimeRefusal(facts: LogTimeFacts | null): LogTimeRefusal | null {
  if (!facts) return 'not_found';
  if (!facts.assignment?.active) return 'not_assigned';
  if (facts.taskStatus === 'done') return 'task_done';
  if (facts.projectStatus !== 'open') return 'project_closed';
  return null;
}

/**
 * Whether `employeeId` may log `hours` on `taskId` on `date`. The date and hours are for the
 * per-person limit (CD-147, Block mode); until then only the assignment and statuses decide.
 */
export async function canLogTime(tx: Tx, employeeId: string, taskId: string, _date: string, _hours: number): Promise<boolean> {
  return (await logTimeRefusalFor(tx, employeeId, taskId)) === null;
}

export async function logTimeRefusalFor(tx: Tx, employeeId: string, taskId: string): Promise<LogTimeRefusal | null> {
  const [row] = await tx
    .select({ taskStatus: tasks.status, projectStatus: projects.status, active: taskAssignments.active })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .leftJoin(taskAssignments, and(eq(taskAssignments.taskId, tasks.id), eq(taskAssignments.employeeId, employeeId)))
    .where(eq(tasks.id, taskId));
  return logTimeRefusal(row ? { taskStatus: row.taskStatus, projectStatus: row.projectStatus, assignment: row.active === null ? null : { active: row.active } } : null);
}

/** The tasks `employeeId` can log time on now (the Timesheet's task picker), by project and number. */
export function loggableTasks(tx: Tx, employeeId: string) {
  return tx
    .select({ id: tasks.id, number: tasks.number, name: tasks.name, status: tasks.status, projectId: projects.id, projectName: projects.name })
    .from(taskAssignments)
    .innerJoin(tasks, eq(tasks.id, taskAssignments.taskId))
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(and(eq(taskAssignments.employeeId, employeeId), eq(taskAssignments.active, true), ne(tasks.status, 'done'), eq(projects.status, 'open')))
    .orderBy(asc(projects.name), asc(tasks.number));
}
