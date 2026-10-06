/**
 * Customer visit plans (CD-134): the store keeps the plans the API shows this user (`s.visitPlans`;
 * members only get their own) and these helpers for the screens. Periods follow the same rules as
 * the backend (modules/crm/visit-plans/periods.ts): a month, or a quarter of the workspace's fiscal
 * year (`s.workspace.fiscalMonth`, 1 = January). Dates are calendar dates (YYYY-MM-DD).
 */
import type { ApiVisitPlan, ApiVisitScope, ApiVisitTotals, VisitPlanPeriodType } from '../lib/api';
import { paths } from '../lib/paths';

export type VisitPlan = ApiVisitPlan;

/** Whether this user may make a plan for anyone (Admins; managers for their direct reports, CD-142). */
export const canCreatePlans = (scope: ApiVisitScope) => scope.manageAll || (scope.manageableUserIds?.length ?? 0) > 0;
/** Whether this user sees `userId`'s plans (and numbers). */
export const seesPlansOf = (scope: ApiVisitScope, userId: string) => scope.all || (scope.visibleUserIds ?? []).includes(userId);
/** Whether this user makes and changes `userId`'s plans. */
export const managesPlansOf = (scope: ApiVisitScope, userId: string) => scope.manageAll || (scope.manageableUserIds ?? []).includes(userId);
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

// ------------------------------------------------------------ tracking (CD-135)

/** Completion as a whole percentage, rounded down: 100% only when the plan is done. */
export const completionLabel = (completion: number): string => Math.floor(completion * 100 + 1e-9) + '%';

/** The colour class and explanation of a plan's pace (spec 9.2): green done, amber behind, grey before the period. */
export function paceOf(t: Pick<ApiVisitTotals, 'pace' | 'expectedPace' | 'planned' | 'heldCapped'>): { className: string; title: string } {
  // The expected pace in visits (CD-224): "3 of 5 visits expected by today, 1 held".
  const expected = `${expectedVisits(t)} of ${t.planned} ${t.planned === 1 ? 'visit' : 'visits'} expected by today, ${t.heldCapped} held (${Math.round(t.expectedPace * 100)}% of the period has passed)`;
  switch (t.pace) {
    case 'done':
      return { className: 'vp-pace vp-pace-done', title: 'Every planned visit is held' };
    case 'behind':
      return { className: 'vp-pace vp-pace-behind', title: `Behind pace: ${expected}` };
    case 'notStarted':
      return { className: 'vp-pace vp-pace-not-started', title: `The period hasn't started yet: 0 of ${t.planned} ${t.planned === 1 ? 'visit' : 'visits'} expected by today` };
    default:
      return { className: 'vp-pace', title: `On pace: ${expected}` };
  }
}

/** The visits that should be held by now at an even pace: the plan times the share of the period passed, rounded down. */
export const expectedVisits = (t: Pick<ApiVisitTotals, 'expectedPace' | 'planned'>): number => Math.floor(t.planned * t.expectedPace + 1e-9);

/** The months of the quarter starting on `quarterStart` that have no monthly plan, as month names (CD-224, B18). */
export function missingMonths(quarterStart: string, plans: readonly { periodStart: string }[]): string[] {
  const { year, month } = parts(quarterStart);
  const have = new Set(plans.map((p) => p.periodStart.slice(0, 7)));
  return [0, 1, 2].map((i) => addMonths(year, month, i)).filter((start) => !have.has(start.slice(0, 7))).map((start) => MONTHS[parts(start).month - 1]!);
}

/** "December", "November or December", "October, November or December". */
export const joinOr = (names: readonly string[]): string => (names.length <= 1 ? (names[0] ?? '') : names.slice(0, -1).join(', ') + ' or ' + names[names.length - 1]);

export type VisitCount = 'held' | 'upcoming' | 'notClosed' | 'unplanned';

/** `YYYY-MM-DD` moved by whole days. */
function shiftDay(date: string, days: number): string {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The most meetings a Calendar link lists by id (the API's `ids=` limit). */
export const MAX_LINK_IDS = 200;

/**
 * The Calendar's table with exactly the meetings behind a number (CD-211): their ids in the URL
 * (`ids=`, shown as the chip "N meetings from report"), so "Held 3" opens those 3 rows. The
 * counts credit one salesperson per visit and the Calendar's own filters can't say that.
 *
 * Over MAX_LINK_IDS meetings the link falls back to the closest filter: the period's Customer
 * visits of the salesperson (organizer or participant) and customer, held or planned; `report=N`
 * makes the chip say the list is approximate.
 */
export function visitsInCalendar(kind: VisitCount, ids: readonly string[], period: { periodStart: string; periodEnd: string }, filter: { userId?: string | null; companyId?: string | null }): string {
  const last = shiftDay(period.periodEnd, -1);
  if (ids.length <= MAX_LINK_IDS) return paths.calendar({ view: 'table', from: period.periodStart, to: last, ids: ids.join(',') });
  return paths.calendar({
    view: 'table',
    from: period.periodStart,
    to: last,
    user: filter.userId || 'all',
    company: filter.companyId || undefined,
    type: 'visit',
    status: kind === 'held' || kind === 'unplanned' ? 'held' : 'planned',
    notClosed: kind === 'notClosed' ? '1' : undefined,
    report: String(ids.length),
  });
}
