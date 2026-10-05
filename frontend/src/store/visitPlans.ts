/**
 * Customer visit plans (CD-134): the store keeps the plans the API shows this user (`s.visitPlans`;
 * members only get their own) and these helpers for the screens. Periods follow the same rules as
 * the backend (modules/crm/visit-plans/periods.ts): a month, or a quarter of the workspace's fiscal
 * year (`s.workspace.fiscalMonth`, 1 = January). Dates are calendar dates (YYYY-MM-DD).
 */
import type { ApiVisitPlan, VisitPlanPeriodType } from '../lib/api';

export type VisitPlan = ApiVisitPlan;
export type PeriodType = VisitPlanPeriodType;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const short = (month: number) => MONTHS[month - 1]!.slice(0, 3);
const pad = (n: number) => String(n).padStart(2, '0');
const parts = (date: string) => {
  const [y, m] = date.split('-').map(Number);
  return { year: y!, month: m! };
};
const addMonths = (year: number, month: number, months: number) => {
  const index = year * 12 + (month - 1) + months;
  return `${Math.floor(index / 12)}-${pad((index % 12) + 1)}-01`;
};
const monthsOf = (type: PeriodType) => (type === 'month' ? 1 : 3);

/** The first day of the period of this type that contains `date`. */
export function periodStartOf(type: PeriodType, date: string, fiscalMonth: number): string {
  const { year, month } = parts(date);
  return addMonths(year, month, type === 'month' ? 0 : -((month - fiscalMonth + 12) % 3));
}

/** The first day of the period `steps` periods after (negative: before) the one starting on `start`. */
export function shiftPeriod(type: PeriodType, start: string, steps: number): string {
  const { year, month } = parts(start);
  return addMonths(year, month, steps * monthsOf(type));
}

/** "October 2026"; "Q4 2026"; "Q1 FY2027 (Oct–Dec 2026)" when the fiscal year doesn't start in January. */
export function periodLabel(type: PeriodType, start: string, fiscalMonth: number): string {
  const { year, month } = parts(start);
  if (type === 'month') return `${MONTHS[month - 1]} ${year}`;
  const last = parts(addMonths(year, month, 2));
  const range = last.year === year ? `${short(month)}–${short(last.month)} ${year}` : `${short(month)} ${year}–${short(last.month)} ${last.year}`;
  const offset = (month - fiscalMonth + 12) % 12;
  if (offset % 3 !== 0) return range;
  const quarter = Math.floor(offset / 3) + 1;
  const fiscalYear = fiscalMonth === 1 || month < fiscalMonth ? year : year + 1;
  return fiscalMonth === 1 ? `Q${quarter} ${year}` : `Q${quarter} FY${fiscalYear} (${range})`;
}

/** Periods to pick from: from `back` periods before the current one to `ahead` after it, newest first. */
export function periodOptions(type: PeriodType, today: string, fiscalMonth: number, back = 6, ahead = 6): { value: string; label: string }[] {
  const current = periodStartOf(type, today, fiscalMonth);
  const out: { value: string; label: string }[] = [];
  for (let i = ahead; i >= -back; i--) {
    const start = shiftPeriod(type, current, i);
    out.push({ value: start, label: periodLabel(type, start, fiscalMonth) });
  }
  return out;
}

/** The same salesperson's plan of the same type for the period before `start`, if there is one. */
export function previousPlan(plans: VisitPlan[], salespersonUserId: string, type: PeriodType, start: string): VisitPlan | undefined {
  const before = shiftPeriod(type, start, -1);
  return plans.find((p) => p.salespersonUserId === salespersonUserId && p.periodType === type && p.periodStart === before);
}

/** Plans as lists show them: newest period first, then months before quarters, then by salesperson. */
export const sortPlans = (plans: VisitPlan[]): VisitPlan[] =>
  [...plans].sort((a, b) => b.periodStart.localeCompare(a.periodStart) || a.periodType.localeCompare(b.periodType) || a.salespersonName.localeCompare(b.salespersonName));
