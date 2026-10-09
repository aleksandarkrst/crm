import type { TimesheetDayStatus } from '../../shared/database/schema';

/**
 * The Timesheet's rules as pure functions (CD-152, spec sections 4 and 5), unit-tested without a
 * database. Dates are calendar dates "yyyy-mm-dd" in the workspace time zone; a week is its Monday.
 */

/**
 * What the Timesheet runs on: the workspace's settings (CD-153, columns on `tenants`), read only
 * through `timesheetSettings` (timesheet-settings.ts).
 */
export interface TimesheetSettings {
  /** The standard working day (spec 6.5): 8 h by default, from `dayStart` to `dayEnd`. */
  dayMinutes: number;
  dayStart: string;
  dayEnd: string;
  /** ISO weekdays that are working days: 1 Monday … 7 Sunday. */
  workingDays: readonly number[];
  /** Entries above this on one day are refused (spec 4.5): 12 h by default. */
  maxDayMinutes: number;
  /** How hours are shown: 7.50 (decimal) or 7:30 (clock). Typing either works. */
  timeFormat: 'decimal' | 'clock';
  /** The submission deadline: ISO weekday and local time, in the same week or the next one. */
  deadline: { weekday: number; time: string; week: 'same' | 'next' };
  /** Draft weeks with hours are submitted at the deadline (CD-153), for deadlines from `autoSubmitSince`. */
  autoSubmit: boolean;
  autoSubmitSince: Date | null;
  /** Approval mode (CD-156): `week` offers only Submit week; `day` single days too. */
  approvalMode: 'week' | 'day';
}

export const DEFAULT_TIMESHEET_SETTINGS: TimesheetSettings = {
  dayMinutes: 480,
  dayStart: '08:00',
  dayEnd: '16:00',
  workingDays: [1, 2, 3, 4, 5],
  maxDayMinutes: 720,
  timeFormat: 'decimal',
  deadline: { weekday: 5, time: '17:00', week: 'same' },
  autoSubmit: false,
  autoSubmitSince: null,
  approvalMode: 'week',
};

/** A public holiday (CD-153): `minutes` off, or null for the whole standard day. */
export interface Holiday {
  date: string;
  name: string;
  minutes: number | null;
}

const DAY_MS = 86_400_000;
const toUtc = (date: string) => Date.parse(`${date}T00:00:00Z`);
const fromUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export const isIsoDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && fromUtc(toUtc(s)) === s;
export const addDays = (date: string, days: number) => fromUtc(toUtc(date) + days * DAY_MS);
/** 1 Monday … 7 Sunday. */
export const isoWeekday = (date: string) => ((new Date(toUtc(date)).getUTCDay() + 6) % 7) + 1;
export const mondayOf = (date: string) => addDays(date, 1 - isoWeekday(date));
export const weekDates = (monday: string) => Array.from({ length: 7 }, (_, i) => addDays(monday, i));

/** The ISO week number ("Week 41"): the week of its Thursday. */
export function isoWeek(date: string): number {
  const thursday = addDays(mondayOf(date), 3);
  const jan1 = `${thursday.slice(0, 4)}-01-01`;
  return Math.floor((toUtc(thursday) - toUtc(jan1)) / DAY_MS / 7) + 1;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Week 41 · 5 to 11 Oct 2026" (spec 2), the first month only when the week spans two. */
export function weekLabel(monday: string): string {
  const sunday = addDays(monday, 6);
  const day = (d: string) => Number(d.slice(8));
  const month = (d: string) => MONTHS[Number(d.slice(5, 7)) - 1]!;
  const from = month(monday) === month(sunday) ? `${day(monday)}` : `${day(monday)} ${month(monday)}`;
  return `Week ${isoWeek(monday)} · ${from} to ${day(sunday)} ${month(sunday)} ${sunday.slice(0, 4)}`;
}

/**
 * When the week is due (CD-153): the deadline's weekday of the same week or the next one, at its
 * time. A deadline on a public holiday moves to the next working day that isn't one.
 */
export function deadlineOf(monday: string, settings: TimesheetSettings, isHoliday: (date: string) => boolean = () => false): { date: string; time: string } {
  let date = addDays(monday, (settings.deadline.week === 'next' ? 7 : 0) + settings.deadline.weekday - 1);
  for (let i = 0; i < 31 && isHoliday(date); i++) {
    do date = addDays(date, 1);
    while (!settings.workingDays.includes(isoWeekday(date)));
  }
  return { date, time: settings.deadline.time };
}

/** The employee's employment, when the workspace knows it: days outside need no hours. */
export interface Employment {
  start: string | null;
  end: string | null;
}

export const employed = (date: string, e: Employment) => (!e.start || date >= e.start) && (!e.end || date <= e.end);

/** A holiday's hours off on a day (spec 4.6): on working days only, never more than the standard day. */
export function holidayMinutes(date: string, settings: TimesheetSettings, holiday: Holiday | undefined): number {
  if (!holiday || !settings.workingDays.includes(isoWeekday(date))) return 0;
  return Math.min(settings.dayMinutes, holiday.minutes ?? settings.dayMinutes);
}

/**
 * Expected minutes on a day (spec 2): the standard day on a working day within employment, minus a
 * public holiday's hours (CD-153), else 0.
 */
export function expectedMinutes(date: string, settings: TimesheetSettings, employment: Employment, holiday?: Holiday): number {
  if (!settings.workingDays.includes(isoWeekday(date)) || !employed(date, employment)) return 0;
  return settings.dayMinutes - holidayMinutes(date, settings, holiday);
}

/** The deadline as an instant, given the start of its local day (`zonedDayStart`) in the workspace zone. */
export const deadlineInstant = (dayStart: Date, time: string) => new Date(dayStart.getTime() + (Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))) * 60_000);

/** A day needs submitting when hours are expected on it or it has hours (spec 5.1). */
export const isRequired = (expected: number, entered: number) => expected > 0 || entered > 0;

/** Days that can be submitted (spec 5.3 T1): required, Draft, and not after the current week. */
export function submittableDays(days: readonly WeekDay[], today: string): string[] {
  const lastDay = addDays(mondayOf(today), 6);
  return days.filter((d) => d.required && d.status === 'draft' && d.date <= lastDay).map((d) => d.date);
}

export interface WeekDay {
  date: string;
  status: TimesheetDayStatus;
  required: boolean;
  minutes: number;
}

export type WeekStatus = 'no_entry' | 'rejected' | 'draft' | 'not_submitted' | 'partly_submitted' | 'submitted' | 'partly_approved' | 'approved';

/** The week's status from its days (spec 5.4), first match wins, with the badge's text. */
export function weekStatus(days: readonly WeekDay[]): { status: WeekStatus; label: string } {
  const required = days.filter((d) => d.required);
  if (required.length === 0) return { status: 'no_entry', label: 'No entry needed' };
  const rejected = days.filter((d) => d.status === 'rejected').length;
  if (rejected > 0) return { status: 'rejected', label: `Rejected (${rejected} ${rejected === 1 ? 'day' : 'days'})` };
  if (required.some((d) => d.status === 'draft')) {
    // Single days submitted (day by day, CD-156) while others are still Draft: the mix.
    const sent = required.filter((d) => d.status === 'submitted' || d.status === 'approved').length;
    if (sent > 0) return { status: 'partly_submitted', label: `Partly submitted (${sent} of ${required.length} days)` };
    return days.some((d) => d.minutes > 0) ? { status: 'draft', label: 'Draft' } : { status: 'not_submitted', label: 'Not submitted' };
  }
  const approved = required.filter((d) => d.status === 'approved').length;
  if (required.some((d) => d.status === 'submitted')) {
    return approved > 0 ? { status: 'partly_approved', label: `Partly approved (${approved} of ${required.length} days)` } : { status: 'submitted', label: 'Submitted' };
  }
  return { status: 'approved', label: 'Approved' };
}

/** Hours as the workspace shows them (spec 4.5): "7.50" or "7:30". */
export function formatMinutes(minutes: number, format: TimesheetSettings['timeFormat']): string {
  if (format === 'clock') return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
  return (minutes / 60).toFixed(2);
}

/** Why a day's total can't take `minutes` more (spec 4.5), or null. */
export function dayLimitRefusal(otherMinutes: number, minutes: number, settings: TimesheetSettings): string | null {
  if (otherMinutes + minutes <= settings.maxDayMinutes) return null;
  // The maximum is whole hours (1 to 24): "Maximum 12 h per day" in either format.
  return `Maximum ${Math.round((settings.maxDayMinutes / 60) * 100) / 100} h per day`;
}

/** A row of last week, for Copy last week (spec 4.7): its label and why it can't be copied, or null. */
export interface CopySourceRow {
  key: string;
  label: string;
  refusal: string | null;
  /** Its hours last week, by date. */
  minutes: Readonly<Record<string, number>>;
}

/** What the target week already has: hours per row and date, per date, and each day's status. */
export interface CopyTarget {
  monday: string;
  /** The last date hours can go on: the end of the current week. */
  lastDate: string;
  cellMinutes: (key: string, date: string) => number;
  dayMinutes: Readonly<Record<string, number>>;
  dayStatus: Readonly<Record<string, TimesheetDayStatus>>;
}

export interface CopyPlan {
  rows: string[];
  cells: { key: string; date: string; minutes: number }[];
  skippedRows: { label: string; reason: string }[];
  /** Dates where hours weren't copied because the day was over the maximum. */
  fullDays: string[];
}

/**
 * Copy last week (spec 4.7): rows that can still be logged on; with `hours`, each day's hours a week
 * later into empty cells of Draft or Rejected days up to the current week, never past the daily
 * maximum and never over a value already there.
 */
export function copyPlan(source: readonly CopySourceRow[], target: CopyTarget, hours: boolean, settings: TimesheetSettings): CopyPlan {
  const plan: CopyPlan = { rows: [], cells: [], skippedRows: [], fullDays: [] };
  const added: Record<string, number> = {};
  for (const row of source) {
    if (row.refusal) {
      plan.skippedRows.push({ label: row.label, reason: row.refusal });
      continue;
    }
    plan.rows.push(row.key);
    if (!hours) continue;
    for (const [from, minutes] of Object.entries(row.minutes)) {
      const date = addDays(from, 7);
      if (minutes <= 0 || date > target.lastDate || mondayOf(date) !== target.monday) continue;
      const status = target.dayStatus[date] ?? 'draft';
      if (status !== 'draft' && status !== 'rejected') continue;
      if (target.cellMinutes(row.key, date) > 0) continue;
      const total = (target.dayMinutes[date] ?? 0) + (added[date] ?? 0);
      if (dayLimitRefusal(total, minutes, settings)) {
        if (!plan.fullDays.includes(date)) plan.fullDays.push(date);
        continue;
      }
      added[date] = (added[date] ?? 0) + minutes;
      plan.cells.push({ key: row.key, date, minutes });
    }
  }
  plan.fullDays.sort();
  return plan;
}

const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const toClock = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** Start → End in minutes (CD-276); null when the end isn't after the start or isn't a whole quarter hour later. */
export function spanMinutes(start: string, end: string): number | null {
  const m = toMinutes(end) - toMinutes(start);
  return m > 0 && m % 15 === 0 ? m : null;
}

/** The end of an entry `minutes` long from `start`, or null when it would pass midnight. */
export function endAfter(start: string, minutes: number): string | null {
  const end = toMinutes(start) + minutes;
  return end < 1440 ? toClock(end) : null;
}
