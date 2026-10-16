/**
 * Serbia's non-working days (milestone 16, spec 4.3, assumptions A13 and A14), pure and
 * unit-tested (test/serbian-holidays.spec.ts) against the spec's table for 2026 to 2029 and the
 * Orthodox Easter dates to 2035. Names are Serbian with English in brackets.
 */

export interface GeneratedHoliday {
  /** The first day. */
  date: string;
  /** The last day of a span, null for one day. */
  endDate: string | null;
  name: string;
  /** Fixed-date holidays repeat every year; Easter and moved days hold for one year only. */
  repeats: boolean;
}

const DAY_MS = 86_400_000;
const toUtc = (date: string) => Date.parse(`${date}T00:00:00Z`);
const fromUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const addDays = (date: string, days: number) => fromUtc(toUtc(date) + days * DAY_MS);
const isSunday = (date: string) => new Date(toUtc(date)).getUTCDay() === 0;
const isWeekend = (date: string) => [0, 6].includes(new Date(toUtc(date)).getUTCDay());
const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Orthodox Easter Sunday in the Gregorian calendar (Meeus's Julian algorithm, plus the 13 days
 * between the calendars for 1900 to 2099).
 */
export function orthodoxEaster(year: number): string {
  const a = year % 4;
  const b = year % 7;
  const c = year % 19;
  const d = (19 * c + 15) % 30;
  const e = (2 * a + 4 * b - d + 34) % 7;
  const month = Math.floor((d + e + 114) / 31);
  const day = ((d + e + 114) % 31) + 1;
  // The Julian date, moved to the Gregorian calendar.
  return addDays(`${year}-${pad(month)}-${pad(day)}`, 13);
}

/** State holidays (A14): when they fall on a Sunday, the next working day is non-working. Religious ones don't move. */
const STATE: { month: number; day: number; span: number; name: string }[] = [
  { month: 1, day: 1, span: 2, name: 'Nova godina (New Year)' },
  { month: 2, day: 15, span: 2, name: 'Sretenje (Statehood Day)' },
  { month: 5, day: 1, span: 2, name: 'Praznik rada (Labour Day)' },
  { month: 11, day: 11, span: 1, name: 'Dan primirja (Armistice Day)' },
];
const RELIGIOUS_FIXED = [{ month: 1, day: 7, name: 'Božić (Orthodox Christmas)' }];

/** The non-working days of `year` in Serbia, first day first. */
export function serbianHolidays(year: number): GeneratedHoliday[] {
  const out: GeneratedHoliday[] = [];
  const taken = new Set<string>();
  const add = (h: GeneratedHoliday) => {
    out.push(h);
    for (let d = h.date; d <= (h.endDate ?? h.date); d = addDays(d, 1)) taken.add(d);
  };
  for (const h of STATE) {
    const date = `${year}-${pad(h.month)}-${pad(h.day)}`;
    add({ date, endDate: h.span > 1 ? addDays(date, h.span - 1) : null, name: h.name, repeats: true });
  }
  for (const h of RELIGIOUS_FIXED) add({ date: `${year}-${pad(h.month)}-${pad(h.day)}`, endDate: null, name: h.name, repeats: true });
  const easter = orthodoxEaster(year);
  add({ date: addDays(easter, -2), endDate: null, name: 'Veliki petak (Orthodox Good Friday)', repeats: false });
  add({ date: easter, endDate: null, name: 'Vaskrs (Orthodox Easter)', repeats: false });
  add({ date: addDays(easter, 1), endDate: null, name: 'Vaskršnji ponedeljak (Orthodox Easter Monday)', repeats: false });
  // The Sunday rule, for each day of each state holiday.
  for (const h of STATE) {
    for (let i = 0; i < h.span; i++) {
      const date = addDays(`${year}-${pad(h.month)}-${pad(h.day)}`, i);
      if (!isSunday(date)) continue;
      let moved = addDays(date, 1);
      while (isWeekend(moved) || taken.has(moved)) moved = addDays(moved, 1);
      add({ date: moved, endDate: null, name: `Neradni dan (moved: ${h.name})`, repeats: false });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** Every single non-working date of `year`, for tests and the request form. */
export function serbianHolidayDates(year: number): string[] {
  const dates: string[] = [];
  for (const h of serbianHolidays(year)) for (let d = h.date; d <= (h.endDate ?? h.date); d = addDays(d, 1)) dates.push(d);
  return [...new Set(dates)].sort();
}
