/**
 * The vacation entitlement rules as pure functions (CD-163, spec 5.2 to 5.4), unit-tested without
 * a database (test/timeoff-entitlement.spec.ts). Dates are calendar dates "yyyy-mm-dd".
 */

/** "From N years of work experience: +X days". Rows don't add up: the highest one reached applies. */
export interface ExperienceRule {
  fromYears: number;
  extraDays: number;
}

/** What a policy says (spec 5.2). */
export interface PolicyRules {
  baseDays: number;
  /** Caps base + extra + individual; null is no cap. */
  maxDays: number | null;
  carryOver: boolean;
  /** At most this many unused days carry over; null is all of them. */
  carryOverCap: number | null;
  experienceRules: readonly ExperienceRule[];
}

export interface EntitlementInput {
  year: number;
  policy: PolicyRules;
  /** The employment start date (milestone 13). Without it there is no entitlement. */
  startDate: string | null;
  /** The employment end date, when 13 recorded one (leaving). */
  endDate: string | null;
  /** Work experience before joining, in months (spec 5.3). */
  priorExperienceMonths: number;
  /** Individual extra days for the year, added by an Admin with a reason (spec 5.4). */
  individualDays: number;
}

export interface Entitlement {
  baseDays: number;
  /** Work experience in whole years on the evaluation date (1 January, or the start date for a new hire). */
  experienceYears: number;
  experienceDays: number;
  individualDays: number;
  /** The whole year's total: base + extra + individual, capped by the policy's maximum. */
  annualDays: number;
  /** Full months of work in the year when it is a first or last year, else null (the whole year). */
  monthsWorked: number | null;
  /** What the employee is entitled to in the year: `annualDays`, or its proportional part (A3). */
  totalDays: number;
}

const DAY_MS = 86_400_000;
const toUtc = (date: string) => Date.parse(`${date}T00:00:00Z`);
const fromUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const addDays = (date: string, days: number) => fromUtc(toUtc(date) + days * DAY_MS);

/** The same day `months` later; a day the month doesn't have becomes its last day (31 Jan + 1 → 28 Feb). */
export function addMonths(date: string, months: number): string {
  const d = new Date(toUtc(date));
  const day = d.getUTCDate();
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}

/**
 * Full months from `start` to `end` inclusive, counted from the start date (spec 5.4: 15 March to
 * 14 April is one month; a remaining part of a month does not count). 0 when `end` is before `start`.
 */
export function fullMonthsBetween(start: string, end: string): number {
  if (end < start) return 0;
  const s = new Date(toUtc(start));
  const e = new Date(toUtc(end));
  let months = (e.getUTCFullYear() - s.getUTCFullYear()) * 12 + (e.getUTCMonth() - s.getUTCMonth()) + 1;
  while (months > 0 && addDays(addMonths(start, months), -1) > end) months--;
  return months;
}

/** Full months of service completed before `at` (a date), for someone who started on `start`. */
export const monthsOfService = (start: string, at: string): number => fullMonthsBetween(start, addDays(at, -1));

/** The extra days of the highest experience row the employee reaches, or 0. */
export function experienceExtra(rules: readonly ExperienceRule[], years: number): number {
  let best: ExperienceRule | undefined;
  for (const r of rules) if (r.fromYears <= years && (!best || r.fromYears > best.fromYears)) best = r;
  return best?.extraDays ?? 0;
}

/** Rounded to the nearest whole day, halves up (spec 5.4, Q2). */
export const roundDays = (days: number) => Math.floor(days + 0.5);

/**
 * The entitlement of one employee for one year (spec 5.4), or null without a start date. Work
 * experience (prior + service) is evaluated on 1 January, or on the start date for a new hire
 * (spec 5.3). In the year employment starts or ends the total is proportional: annual × full
 * months of work / 12, rounded halves up (A3). Someone not employed at all in the year gets 0.
 */
export function computeEntitlement(input: EntitlementInput): Entitlement | null {
  const { year, policy, startDate, endDate } = input;
  if (!startDate) return null;
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  const evaluatedAt = startDate > yearStart ? startDate : yearStart;
  const experienceYears = Math.floor((input.priorExperienceMonths + monthsOfService(startDate, evaluatedAt)) / 12);
  const experienceDays = experienceExtra(policy.experienceRules, experienceYears);
  const individualDays = Math.max(0, input.individualDays);
  const uncapped = policy.baseDays + experienceDays + individualDays;
  const annualDays = policy.maxDays === null ? uncapped : Math.min(uncapped, policy.maxDays);

  const from = startDate > yearStart ? startDate : yearStart;
  const to = endDate && endDate < yearEnd ? endDate : yearEnd;
  let monthsWorked: number | null;
  let totalDays: number;
  if (from > to) {
    monthsWorked = 0;
    totalDays = 0;
  } else if (from === yearStart && to === yearEnd) {
    monthsWorked = null;
    totalDays = annualDays;
  } else {
    monthsWorked = fullMonthsBetween(from, to);
    totalDays = roundDays((annualDays * monthsWorked) / 12);
  }
  return { baseDays: policy.baseDays, experienceYears, experienceDays, individualDays, annualDays, monthsWorked, totalDays };
}

/** How many of a pool's `unused` days carry over to June 30 of the next year (spec 5.2, 6.2). */
export function carryOverDays(unused: number, policy: Pick<PolicyRules, 'carryOver' | 'carryOverCap'>): number {
  if (!policy.carryOver || unused <= 0) return 0;
  return policy.carryOverCap === null ? unused : Math.min(unused, policy.carryOverCap);
}

/** "5 years 3 months", "7 months", "0 months": prior experience as the card shows it. */
export function experienceLabel(months: number): string {
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const parts = [];
  if (years) parts.push(`${years} ${years === 1 ? 'year' : 'years'}`);
  if (rest || !years) parts.push(`${rest} ${rest === 1 ? 'month' : 'months'}`);
  return parts.join(' ');
}
