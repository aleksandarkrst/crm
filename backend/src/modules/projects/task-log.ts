import { and, asc, eq, ne } from 'drizzle-orm';
import type { Tx } from '../../shared/database/database.service';
import { companies, projects, taskAssignments, tasks } from '../../shared/database/schema';
import { taskHours } from './task-hours';

/**
 * Who may log time on a task (CD-146): the one rule milestone 15's timesheets use, so they never
 * reimplement it. Call it inside `DatabaseService.withTenant` (RLS).
 */

/** Why someone can't log time on a task; null when they can. */
export type LogTimeRefusal = 'not_found' | 'not_assigned' | 'task_done' | 'project_closed' | 'over_limit';

export interface LogTimeFacts {
  taskStatus: string;
  projectStatus: string;
  /** The person has an assignment on the task, whether it is active, and their hour limit (CD-147). */
  assignment: { active: boolean; hourLimit?: number | null } | null;
  /** Block mode (CD-149): an entry may not take the person past their own limit. */
  block?: { logged: number; hours: number };
}

/** Pure: an active assignee, on a task that isn't Done, in an open project, within their own limit in Block mode (unit-tested). */
export function logTimeRefusal(facts: LogTimeFacts | null): LogTimeRefusal | null {
  if (!facts) return 'not_found';
  if (!facts.assignment?.active) return 'not_assigned';
  if (facts.taskStatus === 'done') return 'task_done';
  if (facts.projectStatus !== 'open') return 'project_closed';
  // One person's hours never count toward another's limit: only their own logged hours.
  const limit = facts.assignment.hourLimit;
  if (facts.block && limit != null && facts.block.logged + facts.block.hours > limit) return 'over_limit';
  return null;
}

/**
 * Whether `employeeId` may log `hours` on `taskId` on `date`. With `block` (the workspace's Block
 * mode, CD-149) an entry that takes the person past their own hour limit (CD-147) is refused;
 * without it the limit only warns, which the Timesheet shows.
 */
export async function canLogTime(tx: Tx, employeeId: string, taskId: string, _date: string, hours: number, opts: { block?: boolean } = {}): Promise<boolean> {
  return (await logTimeRefusalFor(tx, employeeId, taskId, opts.block ? hours : undefined)) === null;
}

/** Why not, or null; `blockHours`: check the limit (Block mode) for an entry of that many hours. */
export async function logTimeRefusalFor(tx: Tx, employeeId: string, taskId: string, blockHours?: number): Promise<LogTimeRefusal | null> {
  const [row] = await tx
    .select({ taskStatus: tasks.status, projectStatus: projects.status, active: taskAssignments.active, hourLimit: taskAssignments.hourLimit })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .leftJoin(taskAssignments, and(eq(taskAssignments.taskId, tasks.id), eq(taskAssignments.employeeId, employeeId)))
    .where(eq(tasks.id, taskId));
  if (!row) return logTimeRefusal(null);
  const block = blockHours !== undefined && row.hourLimit != null ? { logged: (await taskHours(tx, taskId, employeeId)).get(employeeId)?.logged ?? 0, hours: blockHours } : undefined;
  return logTimeRefusal({ taskStatus: row.taskStatus, projectStatus: row.projectStatus, assignment: row.active === null ? null : { active: row.active, hourLimit: row.hourLimit }, block });
}

/** The tasks `employeeId` can log time on now (the Timesheet's picker), by project and number, with the project's company. */
export function loggableTasks(tx: Tx, employeeId: string) {
  return tx
    .select({ id: tasks.id, number: tasks.number, name: tasks.name, status: tasks.status, projectId: projects.id, projectName: projects.name, companyName: companies.name })
    .from(taskAssignments)
    .innerJoin(tasks, eq(tasks.id, taskAssignments.taskId))
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .innerJoin(companies, eq(companies.id, projects.companyId))
    .where(and(eq(taskAssignments.employeeId, employeeId), eq(taskAssignments.active, true), ne(tasks.status, 'done'), eq(projects.status, 'open')))
    .orderBy(asc(projects.name), asc(tasks.number));
}
