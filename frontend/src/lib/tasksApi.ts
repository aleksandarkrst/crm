/**
 * Project tasks (CD-146, `/api/tasks`). The API only returns tasks the caller can see (404
 * otherwise); each says what the caller may do (`access`, `canManage`).
 */
import type { ApiProjectStatus } from './projectsApi';
import { api } from './api';

export type TaskStatus = 'todo' | 'in_progress' | 'on_hold' | 'done';
/** The kanban columns and the task page's status bar, in order (design v2 §3, §4). */
export const TASK_STATUSES: { id: TaskStatus; label: string; dot: string }[] = [
  { id: 'todo', label: 'To do', dot: '#93A39B' },
  { id: 'in_progress', label: 'In progress', dot: '#14503C' },
  { id: 'on_hold', label: 'On hold', dot: '#B42318' },
  { id: 'done', label: 'Done', dot: '#3E8E6A' },
];
export const statusLabel = (s: TaskStatus) => TASK_STATUSES.find((x) => x.id === s)!.label;
/** The On hold dialog's presets (design v2 §4); any other text works too. */
export const HOLD_REASONS = ['Waiting for the client', 'Waiting for another task', 'Waiting for access or keys', 'Assignee unavailable'] as const;

/** Another task in a few words (the Dependencies card). */
export interface ApiTaskBrief {
  id: string;
  number: number;
  name: string;
  status: TaskStatus;
  dueDate: string | null;
}

export interface ApiTaskAssignee {
  employeeId: string;
  name: string;
  jobTitle: string | null;
  /** False once taken off the task ("Not assigned any more"). */
  active: boolean;
  /** Has an account (else "No account yet": no emails). */
  hasAccount: boolean;
  /** Left the company. */
  formerMember: boolean;
  /** Their hour limit on this task (CD-147); null: no limit. */
  hourLimit: number | null;
}

export interface ApiTask {
  id: string;
  number: number;
  name: string;
  projectId: string;
  projectName: string;
  projectCode: string | null;
  projectStatus: ApiProjectStatus;
  projectLeadUserId: string | null;
  companyId: string;
  companyName: string;
  stageId: string | null;
  stageName: string | null;
  stagePosition: number | null;
  /** The task this one waits for (CD-269), and in brief: its number, status and due date. */
  waitsForTaskId: string | null;
  waitsFor: { id: string; number: number; status: TaskStatus; dueDate: string | null } | null;
  /** On one task's read only: the dependencies the caller can see, with names. */
  dependencies?: { waitsFor: ApiTaskBrief | null; blocks: ApiTaskBrief[] };
  status: TaskStatus;
  onHoldReason: string | null;
  description: string | null;
  startDate: string | null;
  dueDate: string | null;
  estimateHours: number | null;
  doneAt: string | null;
  createdAt: string;
  version: string;
  assignees: ApiTaskAssignee[];
  /** `read`: an indirect manager sees it but can't change it. */
  access: 'act' | 'read';
  /** May delete it or move it to another project (the lead, owners and admins). */
  canManage: boolean;
}

/** One person on the People and hours card (CD-147). Hidden hours (`visible: false`) are null. */
export interface ApiHoursRow {
  employeeId: string;
  name: string;
  jobTitle: string | null;
  active: boolean;
  formerMember: boolean;
  hourLimit: number | null;
  visible: boolean;
  logged: number | null;
  approved: number | null;
  remaining: number | null;
  usedPercent: number | null;
  level: 'neutral' | 'amber' | 'red' | null;
  over: boolean;
}
export interface ApiTaskHours {
  rows: ApiHoursRow[];
  total: { logged: number; approved: number; taskLimit: number | null; remaining: number | null; someWithoutLimit: boolean };
}

export interface NewTaskInput {
  projectId: string;
  name: string;
  stageId?: string | null;
  description?: string | null;
  startDate?: string | null;
  dueDate?: string | null;
  estimateHours?: number | null;
  assigneeIds?: string[];
}

/** On hold needs `onHoldReason` (or keeps the one it has); `projectId` moves it. */
export type TaskPatch = Partial<{
  name: string;
  projectId: string;
  stageId: string | null;
  status: TaskStatus;
  onHoldReason: string;
  description: string | null;
  startDate: string | null;
  dueDate: string | null;
  estimateHours: number | null;
  waitsForTaskId: string | null;
}>;

export interface TaskFilter {
  projectId?: string;
  /** An employee id, or `me`. */
  assigneeId?: string;
  status?: TaskStatus;
  q?: string;
}

/** The API's rule for estimates (and hour limits): 0.25 to 9,999 h in quarter hours; null when fine. */
export function quarterHourError(n: number): string | null {
  if (!Number.isFinite(n) || n < 0.25) return 'At least 0.25 h';
  if (n > 9999) return 'At most 9,999 h';
  if (!Number.isInteger(n * 4)) return 'Use steps of 0.25 h (a quarter of an hour)';
  return null;
}

/** "T-12". */
export const taskId = (t: { number: number }) => `T-${t.number}`;

export const tasksApi = {
  list: (filter: TaskFilter = {}) => {
    const q = new URLSearchParams(Object.entries(filter).filter((e): e is [string, string] => !!e[1]));
    return api<ApiTask[]>('/tasks' + (q.size ? `?${q}` : ''));
  },
  get: (id: string) => api<ApiTask>(`/tasks/${id}`),
  create: (input: NewTaskInput) => api<ApiTask>('/tasks', { method: 'POST', json: input }),
  update: (id: string, patch: TaskPatch) => api<ApiTask>(`/tasks/${id}`, { method: 'PATCH', json: patch }),
  remove: (id: string) => api<null>(`/tasks/${id}`, { method: 'DELETE' }),
  // Assignees: each change answers with the task.
  /** `hourLimits`: employee id → hours (the lead, owners and admins, CD-147). */
  assign: (id: string, employeeIds: string[], hourLimits?: Record<string, number>) => api<ApiTask>(`/tasks/${id}/assignees`, { method: 'POST', json: { employeeIds, hourLimits } }),
  setHourLimit: (id: string, employeeId: string, hourLimit: number | null) => api<ApiTask>(`/tasks/${id}/assignees/${employeeId}`, { method: 'PATCH', json: { hourLimit } }),
  hours: (id: string) => api<ApiTaskHours>(`/tasks/${id}/hours`),
  unassign: (id: string, employeeId: string) => api<ApiTask>(`/tasks/${id}/assignees/${employeeId}`, { method: 'DELETE' }),
};
