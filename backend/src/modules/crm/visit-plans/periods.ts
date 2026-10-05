import type { VisitPlanPeriodType } from '../../../shared/database/schema';

/**
 * Visit plan periods (CD-134), as pure functions: a month, or a fiscal quarter that starts at the
 * workspace's fiscal-year start month (`tenants.fiscal_year_start_month`, 1 = January). Dates are
 * calendar dates (`YYYY-MM-DD`), not moments: a period is the same days in every time zone.
 * The frontend has the same rules in store/visitPlans.ts.
 */

export interface Period {
  type: VisitPlanPeriodType;
  /** The first day of the period. */
  start: string;
  /** The first day after the period (exclusive end). */
  end: string;
  /** "October 2026"; "Q4 2026"; "Q1 FY2027 (Oct–Dec 2026)" when the fiscal year doesn't start in January. */
  label: string;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const short = (month: number) => MONTHS[month - 1]!.slice(0, 3);
const pad = (n: number) => String(n).padStart(2, '0');

/** `{ year, month }` (month 1–12) of a `YYYY-MM-DD` date. */
function parts(date: string): { year: number; month: number; day: number } {
  const [y, m, d] = date.split('-').map(Number);
  return { year: y!, month: m!, day: d! };
}

/** The first day of the month `months` after the month of (year, month). */
function addMonths(year: number, month: number, months: number): string {
  const index = year * 12 + (month - 1) + months;
  return `${Math.floor(index / 12)}-${pad((index % 12) + 1)}-01`;
}

const monthsOf = (type: VisitPlanPeriodType) => (type === 'month' ? 1 : 3);

/** Whether `date` is a real calendar date in `YYYY-MM-DD` form. */
function isDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const d = new Date(date + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === date;
}

/**
 * Whether `start` is the first day of a period of this type: the 1st of a month, and for quarters
 * a month 0, 3, 6 or 9 months after the fiscal-year start month.
 */
export function isPeriodStart(type: VisitPlanPeriodType, start: string, fiscalStartMonth: number): boolean {
  if (!isDate(start)) return false;
  const { month, day } = parts(start);
  if (day !== 1) return false;
  return type === 'month' || (month - fiscalStartMonth + 12) % 3 === 0;
}

/** The fiscal quarter (1–4) and fiscal year of a quarter starting in (year, month). The fiscal year is named after the calendar year it ends in. */
export function fiscalQuarter(year: number, month: number, fiscalStartMonth: number): { quarter: number; fiscalYear: number } {
  const offset = (month - fiscalStartMonth + 12) % 12;
  return { quarter: Math.floor(offset / 3) + 1, fiscalYear: fiscalStartMonth === 1 || month < fiscalStartMonth ? year : year + 1 };
}

/**
 * The label of the period [start, end). Months read "October 2026". Quarters read "Q4 2026" when
 * the fiscal year starts in January, else "Q1 FY2027 (Oct–Dec 2026)". A quarter that no longer
 * lines up with the fiscal year (the setting changed after the plan was made) reads by its months.
 */
export function periodLabel(type: VisitPlanPeriodType, start: string, end: string, fiscalStartMonth: number): string {
  const { year, month } = parts(start);
  if (type === 'month') return `${MONTHS[month - 1]} ${year}`;
  const last = parts(addMonths(parts(end).year, parts(end).month, -1));
  const range = last.year === year ? `${short(month)}–${short(last.month)} ${year}` : `${short(month)} ${year}–${short(last.month)} ${last.year}`;
  if (!isPeriodStart('quarter', start, fiscalStartMonth)) return range;
  const { quarter, fiscalYear } = fiscalQuarter(year, month, fiscalStartMonth);
  return fiscalStartMonth === 1 ? `Q${quarter} ${year}` : `Q${quarter} FY${fiscalYear} (${range})`;
}

/** The period of this type starting on `start`, or null when `start` isn't the first day of one. */
export function periodOf(type: VisitPlanPeriodType, start: string, fiscalStartMonth: number): Period | null {
  if (!isPeriodStart(type, start, fiscalStartMonth)) return null;
  const { year, month } = parts(start);
  const end = addMonths(year, month, monthsOf(type));
  return { type, start, end, label: periodLabel(type, start, end, fiscalStartMonth) };
}

/** The first day of the period of this type that contains `date`. */
export function periodStartOf(type: VisitPlanPeriodType, date: string, fiscalStartMonth: number): string {
  const { year, month } = parts(date);
  if (type === 'month') return addMonths(year, month, 0);
  return addMonths(year, month, -((month - fiscalStartMonth + 12) % 3));
}

/** The first day of the period `steps` periods after (or, negative, before) the one starting on `start`. */
export function shiftPeriod(type: VisitPlanPeriodType, start: string, steps: number): string {
  const { year, month } = parts(start);
  return addMonths(year, month, steps * monthsOf(type));
}
