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
  canRecall: boolean;
  /** First submitted after the deadline; submitted by the deadline job (CD-153). */
  late: boolean;
  autoSubmitted: boolean;
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

export const timesheetApi = {
  week: (week?: string) => api<ApiTimesheetWeek>(`/timesheet/week${week ? `?week=${week}` : ''}`),
  loggable: () => api<ApiLoggable[]>('/timesheet/loggable'),
  /** `minutes` 0 clears the cell; `note` empty clears the note, left out keeps it. */
  setCell: (date: string, target: RowTarget, minutes: number, note?: string | null) =>
    api<ApiTimesheetWeek>('/timesheet/cells', { method: 'PUT', json: { date, ...target, minutes, ...(note !== undefined ? { note } : {}) } }),
  addRow: (weekStart: string, target: RowTarget) => api<ApiTimesheetWeek>('/timesheet/rows', { method: 'POST', json: { weekStart, ...target } }),
  copyPreview: (weekStart: string) => api<ApiCopyPreview>(`/timesheet/copy?weekStart=${weekStart}`),
  copy: (weekStart: string, mode: 'rows' | 'hours') => api<ApiCopyResult>('/timesheet/copy', { method: 'POST', json: { weekStart, mode } }),
  /** The week; with `date`, that day only (Day by day mode, CD-156). */
  submit: (weekStart: string, date?: string) => api<ApiTimesheetWeek>('/timesheet/submit', { method: 'POST', json: { weekStart, ...(date ? { date } : {}) } }),
  recall: (weekStart: string) => api<ApiTimesheetWeek>('/timesheet/recall', { method: 'POST', json: { weekStart } }),
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

/** A public holiday (CD-153): `minutes` off, null for the whole standard day. */
export interface ApiHoliday {
  id: string;
  date: string;
  name: string;
  minutes: number | null;
}

export const holidaysApi = {
  list: (year: number) => api<ApiHoliday[]>(`/timesheet/holidays?year=${year}`),
  create: (h: { date: string; name: string; minutes?: number | null }) => api<ApiHoliday>('/timesheet/holidays', { method: 'POST', json: h }),
  update: (id: string, patch: Partial<{ date: string; name: string; minutes: number | null }>) => api<ApiHoliday>(`/timesheet/holidays/${id}`, { method: 'PATCH', json: patch }),
  remove: (id: string) => api<null>(`/timesheet/holidays/${id}`, { method: 'DELETE' }),
  copyFromLastYear: (year: number) => api<{ copied: number; holidays: ApiHoliday[] }>('/timesheet/holidays/copy', { method: 'POST', json: { year } }),
  /** The first submission deadline that hasn't passed (Settings → Workforce → Approvals). */
  nextDeadline: () => api<{ weekStart: string; weekNumber: number; date: string; time: string }>('/timesheet/deadline'),
};
