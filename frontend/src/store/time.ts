/**
 * Wall-clock time in the workspace time zone (CD-130). Meetings are stored as exact moments and
 * shown and entered in `s.workspace.timezone`, not the browser's. Intl does the zone math, so
 * daylight saving changes are handled without a library: a wall-clock date and time is turned
 * into a moment by asking Intl for the zone's offset at that moment (twice, for the DST edges).
 *
 * Dates are ISO calendar dates ("2026-10-05"); times are "HH:MM"; moments are epoch ms.
 */

const MINUTE = 60_000;
const DAY = 86_400_000;

const partsFormatters = new Map<string, Intl.DateTimeFormat>();
/** A cached formatter giving the numeric parts of a moment in `tz` (24-hour clock). */
function partsFormatter(tz: string): Intl.DateTimeFormat {
  let f = partsFormatters.get(tz);
  if (!f) {
    const opts: Intl.DateTimeFormatOptions = { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' };
    try {
      f = new Intl.DateTimeFormat('en-US', { ...opts, timeZone: tz || undefined });
    } catch {
      f = new Intl.DateTimeFormat('en-US', opts); // an unknown zone: the browser's
    }
    partsFormatters.set(tz, f);
  }
  return f;
}

interface Wall {
  y: number;
  m: number;
  d: number;
  h: number;
  mi: number;
  s: number;
}
function wallOf(ms: number, tz: string): Wall {
  const out: Record<string, number> = {};
  for (const p of partsFormatter(tz).formatToParts(new Date(ms))) if (p.type !== 'literal') out[p.type] = Number(p.value);
  return { y: out.year!, m: out.month!, d: out.day!, h: out.hour! % 24, mi: out.minute!, s: out.second! };
}
/** The zone's offset from UTC at a moment, in ms (positive east of Greenwich). */
function offsetAt(ms: number, tz: string): number {
  const w = wallOf(ms, tz);
  return Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s) - Math.floor(ms / 1000) * 1000;
}

const pad = (n: number) => String(n).padStart(2, '0');
const isoOfUtc = (ms: number) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};
const utcOfIso = (iso: string) => {
  const [y = 1970, m = 1, d = 1] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};

/** A moment in the zone: its calendar date, "HH:MM" and minutes since midnight. */
export interface Zoned {
  date: string;
  time: string;
  minutes: number;
}
export function instantToZoned(at: string | number | Date, tz: string): Zoned {
  const ms = typeof at === 'number' ? at : new Date(at).getTime();
  const w = wallOf(ms, tz);
  return { date: `${w.y}-${pad(w.m)}-${pad(w.d)}`, time: `${pad(w.h)}:${pad(w.mi)}`, minutes: w.h * 60 + w.mi };
}

/**
 * The moment a wall-clock date and time ("HH:MM", or minutes since midnight, which may run past a
 * day) happens in the zone. A time that doesn't exist (the hour skipped when clocks go forward)
 * lands after the gap.
 */
export function zonedToInstant(date: string, time: string | number, tz: string): number {
  const minutes = typeof time === 'number' ? time : minutesOf(time);
  const guess = utcOfIso(date) + minutes * MINUTE;
  const o1 = offsetAt(guess, tz);
  let at = guess - o1;
  const o2 = offsetAt(at, tz);
  if (o2 !== o1) {
    const alt = guess - o2;
    at = offsetAt(alt, tz) === o2 ? alt : Math.max(at, alt);
  }
  return at;
}

// ---------------------------------------------------------------- calendar dates

export const addDays = (iso: string, n: number): string => isoOfUtc(utcOfIso(iso) + n * DAY);
/** 0 = Monday … 6 = Sunday. */
export const weekdayOf = (iso: string): number => (new Date(utcOfIso(iso)).getUTCDay() + 6) % 7;
/** The Monday of the week (weeks run Monday to Sunday). */
export const weekStart = (iso: string): string => addDays(iso, -weekdayOf(iso));
export const monthStart = (iso: string): string => iso.slice(0, 8) + '01';
export const addMonths = (iso: string, n: number): string => {
  const [y = 1970, m = 1, d = 1] = iso.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return isoOfUtc(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(d, last)));
};
/** Whole days from `a` to `b`. */
export const daysBetween = (a: string, b: string): number => Math.round((utcOfIso(b) - utcOfIso(a)) / DAY);
export const isIsoDate = (v: string | null | undefined): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(utcOfIso(v));
/** Every date from `from` to `to`, both included. */
export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Today in the zone. */
export const todayIn = (tz: string): string => instantToZoned(Date.now(), tz).date;

/** A span of calendar dates [first, last] and the moments it covers [from, to). */
export interface Range {
  first: string;
  last: string;
  from: number;
  to: number;
}
const rangeOf = (first: string, last: string, tz: string): Range => ({ first, last, from: zonedToInstant(first, 0, tz), to: zonedToInstant(addDays(last, 1), 0, tz) });
export const dayRange = (date: string, tz: string): Range => rangeOf(date, date, tz);
export const weekRange = (date: string, tz: string): Range => rangeOf(weekStart(date), addDays(weekStart(date), 6), tz);
export const monthRange = (date: string, tz: string): Range => rangeOf(monthStart(date), addDays(addMonths(monthStart(date), 1), -1), tz);
/** The month as a grid of whole weeks (Monday of its first week to Sunday of its last). */
export const monthGridRange = (date: string, tz: string): Range => {
  const m = monthRange(date, tz);
  return rangeOf(weekStart(m.first), addDays(weekStart(m.last), 6), tz);
};
export const datesRange = (first: string, last: string, tz: string): Range => rangeOf(first, last, tz);

// ---------------------------------------------------------------- labels

const labelFormatters = new Map<string, Intl.DateTimeFormat>();
function fmt(key: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  let f = labelFormatters.get(key);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat('en-GB', opts);
    } catch {
      f = new Intl.DateTimeFormat('en-GB', { ...opts, timeZone: undefined });
    }
    labelFormatters.set(key, f);
  }
  return f;
}
/** A calendar date in words: "Mon 5 Oct", or with the year "Mon 5 Oct 2026". */
export const dateLabel = (iso: string, opts: { year?: boolean; weekday?: 'short' | 'long' | false } = {}): string =>
  fmt(`d|${opts.year}|${opts.weekday}`, { timeZone: 'UTC', day: 'numeric', month: 'short', ...(opts.year ? { year: 'numeric' } : {}), ...(opts.weekday === false ? {} : { weekday: opts.weekday ?? 'short' }) }).format(new Date(utcOfIso(iso)));
/** "October 2026". */
export const monthLabel = (iso: string): string => fmt('month', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(new Date(utcOfIso(iso)));
/** "10:00" in the zone. */
export const timeLabel = (at: string | number, tz: string): string => instantToZoned(at, tz).time;
/** A meeting's time: "Mon 5 Oct 2026 · 10:00–11:00", or across days "Mon 5 Oct 22:00 – Tue 6 Oct 01:00". */
export function spanLabel(startsAt: string, endsAt: string, tz: string, year = true): string {
  const a = instantToZoned(startsAt, tz);
  const b = instantToZoned(endsAt, tz);
  if (a.date === b.date) return `${dateLabel(a.date, { year })} · ${a.time}–${b.time}`;
  return `${dateLabel(a.date, { year })} ${a.time} – ${dateLabel(b.date, { year })} ${b.time}`;
}
/** "HH:MM" plus minutes, wrapping past midnight (for end times). */
export const plusMinutes = (time: string, minutes: number): string => {
  const total = (((Number(time.slice(0, 2)) || 0) * 60 + (Number(time.slice(3, 5)) || 0) + minutes) % 1440 + 1440) % 1440;
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
};
export const minutesOf = (time: string): number => (Number(time.slice(0, 2)) || 0) * 60 + (Number(time.slice(3, 5)) || 0);
export const timeOf = (minutes: number): string => `${pad(Math.floor((((minutes % 1440) + 1440) % 1440) / 60))}:${pad((((minutes % 1440) + 1440) % 1440) % 60)}`;
