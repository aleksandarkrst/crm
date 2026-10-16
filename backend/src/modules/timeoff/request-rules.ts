import { addMonths } from './entitlement';

/**
 * The rules of a time off request as pure functions (CD-165, spec 8.2, 8.3, 7.2), unit-tested
 * (test/timeoff-request-rules.spec.ts). Dates are calendar dates "yyyy-mm-dd".
 */

const DAY_MS = 86_400_000;
const toUtc = (date: string) => Date.parse(`${date}T00:00:00Z`);
const fromUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (date: string, days: number) => fromUtc(toUtc(date) + days * DAY_MS);
const isoWeekday = (date: string) => ((new Date(toUtc(date)).getUTCDay() + 6) % 7) + 1;

export interface CalendarInput {
  /** ISO weekdays that are working days (the workspace's standard week): 1 Monday … 7 Sunday. */
  workingWeekdays: readonly number[];
  /** Public holidays by date, with their names. */
  holidays: ReadonlyMap<string, { name: string }>;
}

export interface WorkingDays {
  /** The working days from start to end, in order. */
  dates: string[];
  /** The holidays inside the period that fell on a weekday, so the form can say "excludes 1 May Praznik rada". */
  excluded: { date: string; name: string }[];
}

/** The working days between two dates (spec 8.2): weekdays of the standard week, minus holidays. */
export function workingDaysBetween(start: string, end: string, cal: CalendarInput): WorkingDays {
  const dates: string[] = [];
  const excluded: { date: string; name: string }[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    if (!cal.workingWeekdays.includes(isoWeekday(d))) continue;
    const holiday = cal.holidays.get(d);
    if (holiday) excluded.push({ date: d, name: holiday.name });
    else dates.push(d);
  }
  return { dates, excluded };
}

export type TimeoffRequestType = 'vacation' | 'paid_leave' | 'unpaid_leave' | 'other_absence';

export interface RequestCheckInput {
  type: TimeoffRequestType;
  startDate: string;
  endDate: string;
  today: string;
  /** The caller is an Admin recording or requesting on behalf (spec 8.7): past dates and the first month are allowed, with a reason. */
  byAdmin: boolean;
  /** The employee's employment start date, or null when unknown. */
  employmentStart: string | null;
  workingDays: number;
}

export interface RequestRefusal {
  code: 'no_working_days' | 'past' | 'too_far' | 'first_month' | 'no_start_date';
  message: string;
}

/** "15 Apr 2026" in the messages. */
export const dayLabel = (date: string) => new Date(toUtc(date)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/**
 * The checks of spec 8.3 that need no database: at least one working day, the dates an employee
 * may pick (today to the end of next year; Admins any date) and the first month of work (A2, for
 * vacation; Admins may record it anyway). The overlap and the balance are checked against the rows.
 */
export function checkRequest(input: RequestCheckInput): RequestRefusal | null {
  if (input.workingDays === 0) return { code: 'no_working_days', message: 'These dates contain no working days' };
  if (!input.byAdmin) {
    if (input.startDate < input.today) return { code: 'past', message: 'Time off can be requested from today on. Ask an Admin to record earlier days.' };
    const endOfNextYear = `${Number(input.today.slice(0, 4)) + 1}-12-31`;
    if (input.endDate > endOfNextYear) return { code: 'too_far', message: `Time off can be requested up to ${dayLabel(endOfNextYear)}` };
  }
  if (input.type === 'vacation') {
    if (!input.employmentStart) return { code: 'no_start_date', message: 'Your employment start date is missing. Ask an Admin to set it.' };
    const from = addMonths(input.employmentStart, 1);
    if (!input.byAdmin && input.startDate < from) return { code: 'first_month', message: `Vacation can be used after one month of work, from ${dayLabel(from)}` };
  }
  return null;
}

export interface PaidLeaveLimitInput {
  /** The reason's most working days per case, or null. */
  maxDays: number | null;
  countsTowardLimit: boolean;
  /** The workspace's yearly group limit (A10). */
  yearlyLimit: number;
  /** Working days of this request. */
  days: number;
  /** Approved and pending paid leave days of the employee this year, for reasons that count toward the limit, not counting this request. */
  usedTowardLimit: number;
}

/** Paid leave limits are warnings, never blocks (spec 7.2). */
export function paidLeaveWarnings(input: PaidLeaveLimitInput): string[] {
  const out: string[] = [];
  if (input.maxDays !== null && input.days > input.maxDays) out.push(`Exceeds the limit of ${input.maxDays} ${input.maxDays === 1 ? 'day' : 'days'} for this reason`);
  if (input.countsTowardLimit && input.usedTowardLimit + input.days > input.yearlyLimit) {
    out.push(`Exceeds the yearly limit of ${input.yearlyLimit} paid leave days (${input.usedTowardLimit} used this year)`);
  }
  return out;
}
