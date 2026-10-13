/** The weekly timesheet (CD-152, `/api/timesheet`): always the caller's own. */
import { api } from './api';

export type DayStatus = 'draft' | 'submitted' | 'rejected' | 'approved';
export type WeekStatus = 'no_entry' | 'rejected' | 'draft' | 'not_submitted' | 'partly_submitted' | 'submitted' | 'partly_approved' | 'approved';
export type RowKind = 'task' | 'work_order';
export type TimeFormat = 'decimal' | 'clock';

export interface ApiCell {
  minutes: number;
  /** The note when the cell is one entry. */
  note: string | null;
  /** More than one: logged on the task or work order page (CD-276); change them there. */
  entries: number;
}

export interface ApiTimesheetRow {
  key: string;
  kind: RowKind;
  id: string;
  /** "T-12" or "WO-1044". */
  code: string;
  name: string;
  /** "Company › Project". */
  path: string;
  /** Why no new hours can go on it, or null. */
  lockedReason: string | null;
  /** Any day's hours, only hours already there (unassigned since), or nothing. */
  edit: 'any' | 'existing' | 'none';
  limit: { limitMinutes: number; loggedMinutes: number } | null;
  cells: Record<string, ApiCell>;
  minutes: number;
}

export interface ApiTimesheetDay {
  date: string;
  status: DayStatus;
  submittedAt: string | null;
  expectedMinutes: number;
  minutes: number;
  required: boolean;
  editable: boolean;
  /** A public holiday on a working day (CD-153): its name and the hours off. */
  holiday: { name: string; minutes: number } | null;
  /** The approver's decision (CD-157): the latest comment, who returned or approved the day and when. */
  comment: string | null;
  returnedAt: string | null;
  returnedBy: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  /** The day as it was approved (CD-159): expected and entered minutes at that moment. */
  approvedExpectedMinutes: number | null;
  approvedMinutes: number | null;
  /** The employee resubmitted the returned day (CD-158): when, and their reply to the comment. */
  resubmittedAt: string | null;
  reply: string | null;
}

export interface ApiTimesheetWeek {
  weekStart: string;
  weekNumber: number;
  /** "Week 41 · 5 to 11 Oct 2026". */
  label: string;
  today: string;
  thisWeek: string;
  deadline: { date: string; time: string };
  settings: { dayMinutes: number; maxDayMinutes: number; timeFormat: TimeFormat; approvalMode: 'week' | 'day' };
  employee: { id: string; name: string } | null;
  status: WeekStatus;
  statusLabel: string;
  submittable: string[];
  /** Rejected days "Resubmit rejected days" sends again (CD-158). */
  resubmittable: string[];
  canRecall: boolean;
  /** First submitted after the deadline; submitted by the deadline job (CD-153). */
  late: boolean;
  autoSubmitted: boolean;
  /** A day was submitted or resubmitted by an Admin on the employee's behalf (CD-317). */
  onBehalf: boolean;
  /** The week's deadline has passed (CD-155). */
  deadlinePassed: boolean;
  /** Days never submitted that would make the week Late now (spec 5.5). */
  lateIfSubmitted: string[];
  days: ApiTimesheetDay[];
  rows: ApiTimesheetRow[];
}

export interface ApiLoggable {
  kind: RowKind;
  id: string;
  code: string;
  name: string;
  path: string;
}

export interface ApiCopyPreview {
  fromWeek: number;
  toWeek: number;
  rows: number;
  skipped: { label: string; reason: string }[];
}

export interface ApiCopyResult {
  week: ApiTimesheetWeek;
  copiedRows: number;
  copiedCells: number;
  skipped: { label: string; reason: string }[];
  fullDays: string[];
}

export type RowTarget = { taskId: string } | { workOrderId: string };
export const targetOf = (row: { kind: RowKind; id: string }): RowTarget => (row.kind === 'task' ? { taskId: row.id } : { workOrderId: row.id });

/** What the caller may do with someone's week (CD-157): approve and return, the same as an Admin override, or only look. */
export type ApprovalRight = 'approver' | 'override' | null;

export interface ApiApprovalRow {
  employee: { id: string; name: string; jobTitle: string | null };
  right: ApprovalRight;
  status: WeekStatus;
  statusLabel: string;
  late: boolean;
  autoSubmitted: boolean;
  days: { date: string; status: DayStatus; required: boolean; minutes: number }[];
  enteredMinutes: number;
  expectedMinutes: number;
  /** Required days never submitted: "Not submitted" after the deadline. */
  missing: string[];
  waiting: number;
  /** Of the waiting days, those resubmitted after a return (CD-158). */
  resubmitted: number;
  returned: number;
  approvable: boolean;
  /** A day was submitted or resubmitted by an Admin on the employee's behalf (CD-317). */
  onBehalf: boolean;
}

export interface ApiApprovals {
  weekStart: string;
  weekNumber: number;
  label: string;
  thisWeek: string;
  deadline: { date: string; time: string };
  deadlinePassed: boolean;
  approvalMode: 'week' | 'day';
  timeFormat: TimeFormat;
  rows: ApiApprovalRow[];
}

export interface ApiApproverWeek {
  week: ApiTimesheetWeek;
  right: ApprovalRight;
  /** Days the caller submitted on the employee's behalf (CD-317): someone else must approve them. */
  enteredByMe: string[];
}

/** The week's history (CD-159, spec 9.5): status events and entry changes, oldest first; `onBehalf`: done by an Admin for the employee (CD-317). */
export interface ApiWeekHistory {
  events: { date: string; kind: string; actorName: string | null; onBehalf: boolean; comment: string | null; approvalMode: 'week' | 'day'; at: string }[];
  changes: { at: string; actorName: string | null; onBehalf: boolean; date: string; action: 'created' | 'updated' | 'deleted'; field: string | null; from: unknown; to: unknown; row: string; minutes: number; note: string | null }[];
}

/** Approvals (CD-157, `/api/timesheet/approvals`): the weeks the caller approves. */
export const approvalsApi = {
  list: (week?: string) => api<ApiApprovals>(`/timesheet/approvals${week ? `?week=${week}` : ''}`),
  week: (employeeId: string, week?: string) => api<ApiApproverWeek>(`/timesheet/approvals/${employeeId}/week${week ? `?week=${week}` : ''}`),
  /** The week (Whole week mode) or `dates` of it (Day by day). */
  approve: (employeeId: string, weekStart: string, dates?: string[]) => api<ApiApproverWeek>('/timesheet/approvals/approve', { method: 'POST', json: { employeeId, weekStart, ...(dates ? { dates } : {}) } }),
  /** The Submitted days (or `dates` of them) go back to the employee with the comment. */
  return: (employeeId: string, weekStart: string, comment: string, dates?: string[]) =>
    api<ApiApproverWeek>('/timesheet/approvals/return', { method: 'POST', json: { employeeId, weekStart, comment, ...(dates ? { dates } : {}) } }),
  /** Admins (CD-159): approved days go back to the employee as Rejected, with the reason (10 to 1,000 characters). */
  unlock: (employeeId: string, weekStart: string, reason: string, dates?: string[]) =>
    api<ApiApproverWeek>('/timesheet/approvals/unlock', { method: 'POST', json: { employeeId, weekStart, reason, ...(dates ? { dates } : {}) } }),
  /** The week's history (CD-159): for the employee, their approvers and Admins. */
  history: (employeeId: string, week?: string) => api<ApiWeekHistory>(`/timesheet/approvals/${employeeId}/history${week ? `?week=${week}` : ''}`),
};

/** `employeeId` on every call (CD-317): an Admin entering time on that employee's behalf; left out, the caller's own timesheet. */
const forEmployee = (employeeId?: string) => (employeeId ? { employeeId } : {});
const query = (params: Record<string, string | undefined>) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `?${s}` : '';
};

export const timesheetApi = {
  week: (week?: string, employeeId?: string) => api<ApiTimesheetWeek>(`/timesheet/week${query({ week, employeeId })}`),
  loggable: (employeeId?: string) => api<ApiLoggable[]>(`/timesheet/loggable${query({ employeeId })}`),
  /** `minutes` 0 clears the cell; `note` empty clears the note, left out keeps it. */
  setCell: (date: string, target: RowTarget, minutes: number, note?: string | null, employeeId?: string) =>
    api<ApiTimesheetWeek>('/timesheet/cells', { method: 'PUT', json: { date, ...target, minutes, ...(note !== undefined ? { note } : {}), ...forEmployee(employeeId) } }),
  addRow: (weekStart: string, target: RowTarget, employeeId?: string) => api<ApiTimesheetWeek>('/timesheet/rows', { method: 'POST', json: { weekStart, ...target, ...forEmployee(employeeId) } }),
  copyPreview: (weekStart: string, employeeId?: string) => api<ApiCopyPreview>(`/timesheet/copy${query({ weekStart, employeeId })}`),
  copy: (weekStart: string, mode: 'rows' | 'hours', employeeId?: string) => api<ApiCopyResult>('/timesheet/copy', { method: 'POST', json: { weekStart, mode, ...forEmployee(employeeId) } }),
  /** The week; with `date`, that day only (Day by day mode, CD-156). */
  submit: (weekStart: string, date?: string, employeeId?: string) =>
    api<ApiTimesheetWeek>('/timesheet/submit', { method: 'POST', json: { weekStart, ...(date ? { date } : {}), ...forEmployee(employeeId) } }),
  recall: (weekStart: string) => api<ApiTimesheetWeek>('/timesheet/recall', { method: 'POST', json: { weekStart } }),
  /** The week's rejected days; with `date`, that day only (Day by day mode). `reply` goes to the approver (CD-158). */
  resubmit: (weekStart: string, date?: string, reply?: string | null, employeeId?: string) =>
    api<ApiTimesheetWeek>('/timesheet/resubmit', { method: 'POST', json: { weekStart, ...(date ? { date } : {}), ...(reply ? { reply } : {}), ...forEmployee(employeeId) } }),
};

/**
 * Typed hours to whole minutes (spec 4.5): "7.5", "7,5", "7:30" and "8" all work; rounded to the
 * nearest 15 minutes. Empty is 0. Null when it isn't a number of hours.
 */
export function parseHours(text: string): number | null {
  const t = text.trim();
  if (t === '') return 0;
  let hours: number;
  const clock = /^(\d{1,2}):([0-5]\d)$/.exec(t);
  if (clock) hours = Number(clock[1]) + Number(clock[2]) / 60;
  else if (/^\d+([.,]\d+)?$/.test(t)) hours = Number(t.replace(',', '.'));
  else return null;
  if (!Number.isFinite(hours) || hours > 24) return null;
  return Math.round((hours * 60) / 15) * 15;
}

/** Minutes as the workspace shows hours: "7.50" or "7:30". */
export function formatHours(minutes: number, format: TimeFormat): string {
  if (format === 'clock') return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
  return (minutes / 60).toFixed(2);
}

/** Short, for totals and cells: "8", "7.5" or "7:30"; with a sign for differences when `signed`. */
export function shortHours(minutes: number, format: TimeFormat, signed = false): string {
  const sign = signed ? (minutes > 0 ? '+' : minutes < 0 ? '−' : '') : minutes < 0 ? '−' : '';
  const m = Math.abs(minutes);
  const body = format === 'clock' ? (m % 60 ? formatHours(m, 'clock') : String(m / 60)) : String(Math.round((m / 60) * 100) / 100);
  return sign + body;
}

const DAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const weekday = (date: string) => (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
/** "Wed 7 Oct". */
export const dayLabel = (date: string) => `${DAY[weekday(date)]} ${Number(date.slice(8))} ${MONTH[Number(date.slice(5, 7)) - 1]}`;
/** "Wednesday". */
export const dayName = (date: string) => ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][weekday(date)]!;
export const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** One entry on a task's Time card or a work order's Track time card (CD-276). */
export interface ApiTimeEntry {
  id: string;
  employeeId: string;
  name: string;
  date: string;
  minutes: number;
  note: string | null;
  /** "HH:MM": Start → End, both or neither. */
  startTime: string | null;
  endTime: string | null;
  dayStatus: DayStatus;
  mine: boolean;
  /** Edit and Delete: your own entry on a Draft or Rejected day, while nothing locks the task or order. */
  canChange: boolean;
}

export interface ApiTimeCard {
  /** Everyone's minutes, also entries you don't see. */
  loggedMinutes: number;
  /** A task's estimate. */
  estimateMinutes?: number | null;
  /** A work order's planned duration. */
  plannedMinutes?: number;
  entries: ApiTimeEntry[];
  canLog: boolean;
  lock: { kind: 'project_closed' | 'task_done' | 'completed'; title: string; text: string } | null;
}

export interface NewEntry {
  date: string;
  minutes?: number;
  startTime?: string;
  endTime?: string;
  note?: string | null;
}
export type EntryPatch = Partial<{ date: string; minutes: number; startTime: string | null; endTime: string | null; note: string | null }>;

export const entriesApi = {
  create: (target: RowTarget, entry: NewEntry) => api<ApiTimeEntry>('/timesheet/entries', { method: 'POST', json: { ...target, ...entry } }),
  update: (id: string, patch: EntryPatch) => api<ApiTimeEntry>(`/timesheet/entries/${id}`, { method: 'PATCH', json: patch }),
  remove: (id: string) => api<null>(`/timesheet/entries/${id}`, { method: 'DELETE' }),
};

/**
 * A public holiday (CD-153) as shown for one year: its first and last day in that year (the same
 * for a single day), `minutes` off (null for the whole standard day), and the year it was entered,
 * from which it repeats every year (CD-318).
 */
export interface ApiHoliday {
  id: string;
  date: string;
  endDate: string;
  name: string;
  minutes: number | null;
  since: number;
}

export const holidaysApi = {
  list: (year: number) => api<ApiHoliday[]>(`/timesheet/holidays?year=${year}`),
  create: (h: { date: string; endDate: string | null; name: string; minutes?: number | null }) => api<ApiHoliday>('/timesheet/holidays', { method: 'POST', json: h }),
  update: (id: string, patch: Partial<{ date: string; endDate: string | null; name: string; minutes: number | null }>) => api<ApiHoliday>(`/timesheet/holidays/${id}`, { method: 'PATCH', json: patch }),
  remove: (id: string) => api<null>(`/timesheet/holidays/${id}`, { method: 'DELETE' }),
  /** The first submission deadline that hasn't passed (Settings → Workforce → Approvals). */
  nextDeadline: () => api<{ weekStart: string; weekNumber: number; date: string; time: string }>('/timesheet/deadline'),
};
