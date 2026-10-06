/**
 * Times for making meetings (CD-221): the default start, keeping the length when the start moves,
 * and reading what people type into the date and time fields. Pure functions without React or the
 * store, so `frontend/test` runs them in Node. Times are 24-hour "HH:MM", dates ISO "2026-10-06",
 * both in the workspace time zone; moments are epoch ms.
 */
import { addDays, instantToZoned, isIsoDate, timeOf, weekdayOf, zonedToInstant } from './time.ts';

const MINUTE = 60_000;
/** Working hours for a default start: 09:00 to 17:00, Monday to Friday. */
export const WORK_START = 9 * 60;
export const WORK_END = 17 * 60;
/** A new meeting lasts an hour unless something says otherwise. */
export const DEFAULT_MINUTES = 60;
/** The time lists step by a quarter of an hour. */
export const STEP_MINUTES = 15;

export const isWorkingDay = (iso: string): boolean => weekdayOf(iso) < 5;
/** The first working day on or after `iso`. */
export function workingDayFrom(iso: string): string {
  let d = iso;
  for (let i = 0; i < 7 && !isWorkingDay(d); i++) d = addDays(d, 1);
  return d;
}

/**
 * Where a new meeting starts when nothing says (B8): the next full hour if it falls in working
 * hours on a working day, else 09:00 on the next working day (today's, before 09:00).
 */
export function defaultStart(now: number, tz: string): { date: string; time: string } {
  const z = instantToZoned(now, tz);
  const next = (Math.floor(z.minutes / 60) + 1) * 60;
  if (isWorkingDay(z.date)) {
    if (next < WORK_START) return { date: z.date, time: timeOf(WORK_START) };
    if (next < WORK_END) return { date: z.date, time: timeOf(next) };
  }
  return { date: workingDayFrom(addDays(z.date, 1)), time: timeOf(WORK_START) };
}

/**
 * The start of a visit scheduled from a plan (B9): today's default start when today is in the
 * period [first, end), else 09:00 on the period's first working day.
 */
export function startInPeriod(first: string, end: string, now: number, tz: string): { date: string; time: string } {
  const today = instantToZoned(now, tz).date;
  if (today >= first && today < end) {
    const d = defaultStart(now, tz);
    if (d.date < end) return d;
  }
  const day = workingDayFrom(first);
  return { date: day < end ? day : first, time: timeOf(WORK_START) };
}

/** The new end when the start moves (B7): the length is kept; a length that isn't valid becomes an hour. */
export function keepLength(oldStart: number, oldEnd: number, newStart: number): number {
  const length = oldEnd - oldStart;
  return newStart + (Number.isFinite(length) && length > 0 ? length : DEFAULT_MINUTES * MINUTE);
}

/** "30 min", "1 h", "1 h 30 min". */
export function lengthLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** Every time of the day in quarter-hour steps: "00:00", "00:15" … "23:45". */
export const DAY_SLOTS: string[] = Array.from({ length: (24 * 60) / STEP_MINUTES }, (_, i) => timeOf(i * STEP_MINUTES));

/**
 * The end times offered after a start (as Google Calendar's list): every quarter hour for the
 * next 24 hours, with the length and whether it is the next day.
 */
export function endSlots(start: number, tz: string): { at: number; time: string; label: string; nextDay: boolean }[] {
  const day = instantToZoned(start, tz).date;
  const out: { at: number; time: string; label: string; nextDay: boolean }[] = [];
  for (let m = STEP_MINUTES; m <= 24 * 60; m += STEP_MINUTES) {
    const at = start + m * MINUTE;
    const z = instantToZoned(at, tz);
    out.push({ at, time: z.time, label: lengthLabel(m), nextDay: z.date !== day });
  }
  return out;
}

/**
 * A typed time as "HH:MM" (24-hour), or null: "9", "09", "930", "0930", "9:30", "9.30", "9h30",
 * "21:15", and 12-hour forms people paste ("9:30 pm", "12am").
 */
export function parseTime(text: string): string | null {
  const t = text.trim().toLowerCase().replace(/\s+/g, '');
  const m = /^(\d{1,2})(?:[:.h]?(\d{2}))?(am|pm|a|p)?$/.exec(t);
  if (!m) return null;
  let h = Number(m[1]);
  const mi = m[2] ? Number(m[2]) : 0;
  const ampm = m[3];
  if (ampm) {
    if (h < 1 || h > 12) return null;
    if (ampm.startsWith('a')) h = h === 12 ? 0 : h;
    else h = h === 12 ? 12 : h + 12;
  }
  if (h > 23 || mi > 59) return null;
  return timeOf(h * 60 + mi);
}
/** A time typed out in full ("09:30"): the field takes it while typing, without waiting for a blur. */
export const isWholeTime = (text: string): boolean => /^\d{2}:\d{2}$/.test(text.trim()) && parseTime(text) !== null;

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const pad = (n: number) => String(n).padStart(2, '0');
function isoOf(y: number, m: number, d: number): string | null {
  const iso = `${y}-${pad(m)}-${pad(d)}`;
  if (!isIsoDate(iso) || m < 1 || m > 12 || d < 1) return null;
  // 31 Feb rolls over in Date.UTC: refuse it.
  const back = new Date(Date.UTC(y, m - 1, d));
  return back.getUTCMonth() === m - 1 ? iso : null;
}

/**
 * A typed date as ISO, or null: "2026-10-06", "6.10.2026", "6/10/2026" (day first, as in the
 * workspace's region), "6 Oct 2026", "Tue 6 Oct 2026", "Oct 6, 2026", and without a year
 * ("6 Oct", "6.10.") the year of `today`.
 */
export function parseDate(text: string, today: string): string | null {
  const t = text.trim().toLowerCase().replace(/,/g, ' ').replace(/\s+/g, ' ');
  if (!t) return null;
  const year = Number(today.slice(0, 4));
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (m) return isoOf(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4})?)?\.?$/.exec(t);
  if (m) return isoOf(m[3] ? fullYear(Number(m[3])) : year, Number(m[2]), Number(m[1]));
  // Words: an optional weekday, then "6 oct 2026" or "oct 6 2026".
  const words = t.split(' ').filter((w) => !/^(mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?$/.test(w));
  const month = (w: string | undefined) => (w ? MONTHS.indexOf(w.slice(0, 3)) + 1 : 0);
  const num = (w: string | undefined) => (w && /^\d{1,4}$/.test(w.replace(/\.$/, '')) ? Number(w.replace(/\.$/, '')) : NaN);
  if (words.length >= 2 && words.length <= 3) {
    const [a, b, c] = words;
    if (month(b) && !Number.isNaN(num(a))) return isoOf(c ? fullYear(num(c)) : year, month(b), num(a));
    if (month(a) && !Number.isNaN(num(b))) return isoOf(c ? fullYear(num(c)) : year, month(a), num(b));
  }
  return null;
}
const fullYear = (y: number) => (y < 100 ? 2000 + y : y);
/** A date typed out in full (ISO): the field takes it while typing. */
export const isWholeDate = (text: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(text.trim()) && isIsoDate(text.trim());

/** The moment of a date and time, NaN when either is missing. */
export const momentOf = (date: string, time: string, tz: string): number => (date && time ? zonedToInstant(date, time, tz) : NaN);
