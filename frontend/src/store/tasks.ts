import { type ApiChecklistItem, type ApiTask, type ApiTaskComment, type ApiTaskHours, type TaskFilter, tasksApi } from '../lib/tasksApi';
import { useProjectsRead } from './projects';

/**
 * Tasks (CD-283) are read on demand, like projects, and again shortly after any task or project
 * change (`s.taskRev`, raised by live hints, this tab's own included).
 */

/** The tasks the caller can see, narrowed by `filter` (the Tasks page, a project's Plan tab, Ctrl/⌘K). */
export const useTasks = (filter: TaskFilter = {}, enabled = true) =>
  useProjectsRead<ApiTask[]>(enabled, () => tasksApi.list(filter), `tasks:${JSON.stringify(filter)}`, 'taskRev');

/** One task (its page). */
export const useTask = (id: string | undefined) => useProjectsRead<ApiTask>(!!id, () => tasksApi.get(id!), `task:${id ?? ''}`, 'taskRev');

/** A task's People and hours (CD-147): read with the task, again on any task change. */
export const useTaskHours = (id: string | undefined) => useProjectsRead<ApiTaskHours>(!!id, () => tasksApi.hours(id!), `hours:${id ?? ''}`, 'taskRev');

/** A task's checklist and comments (CD-270), read again on any task change. */
export const useChecklist = (id: string | undefined) => useProjectsRead<ApiChecklistItem[]>(!!id, () => tasksApi.checklist(id!), `checklist:${id ?? ''}`, 'taskRev');
export const useComments = (id: string | undefined) => useProjectsRead<ApiTaskComment[]>(!!id, () => tasksApi.comments(id!), `comments:${id ?? ''}`, 'taskRev');

/** Due date as "7 Oct"; past due and not Done is late. */
export const dueText = (iso: string | null) => (iso ? new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : null);
export const isLate = (t: Pick<ApiTask, 'dueDate' | 'status'>, today: string) => !!t.dueDate && t.status !== 'done' && t.dueDate < today;
/** Today in the browser's calendar, as YYYY-MM-DD (due dates are calendar days). */
export const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
/** "6 h", "6.5 h"; nothing without a number. */
export const hours = (n: number | null | undefined) => (n == null ? null : `${Number(n.toFixed(2))} h`);
/** The people working on it now. */
export const activeAssignees = (t: ApiTask) => t.assignees.filter((a) => a.active);
