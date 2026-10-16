import { addDays } from './request-rules';

/**
 * Sick leave arithmetic (CD-169, spec 13.2 to 13.4), pure and unit-tested
 * (test/sick-leave-rules.spec.ts). Dates are ISO strings; an open record (no end date) counts up
 * to `today`.
 */

const DAY_MS = 86_400_000;
const toUtc = (date: string) => Date.parse(`${date}T00:00:00Z`);

/** Calendar days from `start` to `end`, both included; 0 when `end` is before `start`. */
export const calendarDays = (start: string, end: string) => Math.max(0, Math.round((toUtc(end) - toUtc(start)) / DAY_MS) + 1);

/** The last day that counts: the end date, or today while open (a record starting later counts nothing yet). */
export const countedEnd = (r: { startDate: string; endDate: string | null }, today: string) => r.endDate ?? (today < r.startDate ? addDays(r.startDate, -1) : today);

/** Two periods share a day; an open end is "until return", so it overlaps everything after its start. */
export const periodsOverlap = (a: { startDate: string; endDate: string | null }, b: { startDate: string; endDate: string | null }) =>
  (a.endDate === null || a.endDate >= b.startDate) && (b.endDate === null || b.endDate >= a.startDate);

/**
 * A record continues `earlier` when it starts the day after the earlier one ended, or with only
 * non-working days (weekends, holidays) between (spec 13.2).
 */
export function continues(earlier: { endDate: string | null }, startDate: string, isWorkingDay: (date: string) => boolean): boolean {
  if (!earlier.endDate || earlier.endDate >= startDate) return false;
  for (let d = addDays(earlier.endDate, 1); d < startDate; d = addDays(d, 1)) if (isWorkingDay(d)) return false;
  return true;
}

/**
 * The 31st calendar day of the chain (the record and the ones it continues; spec 13.3: from then
 * RFZO pays an illness outside work). `priorDays` are the calendar days of the earlier records.
 * Null when the record ends before reaching it; the record's start when the chain passed it already.
 */
export function day31(record: { startDate: string; endDate: string | null }, priorDays: number): string | null {
  const date = priorDays >= 30 ? record.startDate : addDays(record.startDate, 30 - priorDays);
  return record.endDate !== null && date > record.endDate ? null : date;
}
