import { carryOverDays } from './entitlement';

/**
 * The vacation balance as pure functions (CD-164, spec 6.2, 6.3), unit-tested without a database
 * (test/timeoff-balance.spec.ts). Dates are calendar dates "yyyy-mm-dd".
 *
 * Pools: the days of one entitlement year. Pool P holds `entitlement(P) + adjustments(P)` working
 * days, used during P and, as carry-over, until 30 June of P+1 (when the policy allows it, at most
 * its cap). A vacation day belongs to exactly one pool (`poolYear`), assigned when the request is
 * submitted and again on approval (CD-165, `assignPools`). Year Y's balance covers pool Y plus the
 * carry-over of pool Y-1 used in Y, so the figures of 6.3 add up within the year.
 */

export type VacationDayStatus = 'approved' | 'pending';

/** One working day of vacation (CD-165's `timeoff_request_days`), charged to a pool. */
export interface VacationDay {
  date: string;
  poolYear: number;
  status: VacationDayStatus;
  /** The request it belongs to (the two-week part counts a request's days). */
  requestId: string;
}

/** What a pool starts with: the year's entitlement (0 without a row) and the sum of its adjustments. */
export interface PoolFacts {
  entitlement: number;
  adjustments: number;
}

export interface BalanceInput {
  year: number;
  today: string;
  policy: { carryOver: boolean; carryOverCap: number | null };
  /** Pool facts by year; a missing year is an empty pool. */
  pools: (year: number) => PoolFacts;
  /** Every vacation day of the employee that could touch the year (pools Y-1 and Y). */
  days: readonly VacationDay[];
  /** Working day test for the two-week part; Monday to Friday by default. */
  isWorkingDay?: (date: string) => boolean;
}

/** The figures of spec 6.3, all in working days. */
export interface Balance {
  year: number;
  entitlement: number;
  /** Unused days of last year's pool, after the cap; usable until 30 June. */
  carriedOver: number;
  carryExpiresOn: string;
  adjustments: number;
  total: number;
  used: number;
  scheduled: number;
  pending: number;
  /** Carry-over not used by 30 June (0 until 1 July). */
  expired: number;
  remaining: number;
  available: number;
  /** The part of `remaining` that is carry-over and expires on 30 June (0 from 1 July). */
  carryRemaining: number;
  /** One approved vacation in the year had at least 10 consecutive working days (A5). */
  twoWeekPart: boolean;
}

const yearOf = (date: string) => Number(date.slice(0, 4));
const DAY_MS = 86_400_000;
const isoWeekday = (date: string) => ((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
export const weekday = (date: string) => isoWeekday(date) <= 5;
/** The last day the carry-over of pool `year - 1` can be used (A5). */
export const carryOverEnd = (year: number) => `${year}-06-30`;

const capacity = (f: PoolFacts) => f.entitlement + f.adjustments;

/** Approved days of pool `pool` dated within the pool's own year: what was used before it became carry-over. */
const usedWithinYear = (days: readonly VacationDay[], pool: number) => days.filter((d) => d.poolYear === pool && d.status === 'approved' && yearOf(d.date) === pool).length;

/**
 * The carry-over available in `year` from pool `year - 1` (spec 6.2, 6.3), after the policy's cap.
 * Known only once the year started (before that the previous year is still being used).
 */
export function carriedOverInto(year: number, today: string, policy: BalanceInput['policy'], pools: BalanceInput['pools'], days: readonly VacationDay[]): number {
  if (today < `${year}-01-01`) return 0;
  const previous = pools(year - 1);
  const unused = capacity(previous) - usedWithinYear(days, year - 1);
  return carryOverDays(unused, policy);
}

/**
 * Days that belong to year Y's balance: dated in Y, from pool Y or, as carry-over, pool Y-1. Days
 * of pool Y dated in Y+1 show on Y+1's card (as carry-over used), not on Y's: Y's remaining at the
 * end of the year is exactly what carries over.
 */
const inYearView = (d: VacationDay, year: number) => yearOf(d.date) === year && (d.poolYear === year || d.poolYear === year - 1);
const isCarry = (d: VacationDay, year: number) => d.poolYear === year - 1 && yearOf(d.date) === year;

export function computeBalance(input: BalanceInput): Balance {
  const { year, today, days } = input;
  const own = input.pools(year);
  const carriedOver = carriedOverInto(year, today, input.policy, input.pools, days);
  const mine = days.filter((d) => inYearView(d, year));
  const approved = mine.filter((d) => d.status === 'approved');
  const used = approved.filter((d) => d.date <= today).length;
  const scheduled = approved.length - used;
  const pending = mine.filter((d) => d.status === 'pending').length;
  const carryUsed = approved.filter((d) => isCarry(d, year)).length;
  const afterJune = today > carryOverEnd(year);
  const expired = afterJune ? Math.max(0, carriedOver - carryUsed) : 0;
  const total = own.entitlement + carriedOver + own.adjustments;
  const remaining = total - used - scheduled - expired;
  return {
    year,
    entitlement: own.entitlement,
    carriedOver,
    carryExpiresOn: carryOverEnd(year),
    adjustments: own.adjustments,
    total,
    used,
    scheduled,
    pending,
    expired,
    remaining,
    available: remaining - pending,
    carryRemaining: afterJune ? 0 : Math.max(0, Math.min(remaining, carriedOver - carryUsed)),
    twoWeekPart: twoWeekPartTaken(year, approved, input.isWorkingDay ?? weekday),
  };
}

/**
 * The two-week part (A5, spec 6.2): one approved vacation (request) with at least 10 consecutive
 * working days in the year. Days of a request are consecutive working days by construction (a
 * request is one date range), so it is the request's working days in the year.
 */
export function twoWeekPartTaken(year: number, approved: readonly VacationDay[], isWorkingDay: (date: string) => boolean): boolean {
  const perRequest = new Map<string, number>();
  for (const d of approved) {
    if (yearOf(d.date) !== year || !isWorkingDay(d.date)) continue;
    perRequest.set(d.requestId, (perRequest.get(d.requestId) ?? 0) + 1);
  }
  return [...perRequest.values()].some((n) => n >= 10);
}

export interface PoolAssignment {
  date: string;
  poolYear: number;
}

export type PoolAssignmentResult = { ok: true; days: PoolAssignment[] } | { ok: false; year: number; needed: number; available: number };

/**
 * Which pool each requested working day uses (spec 6.2): a day on or before 30 June uses last
 * year's pool first (while carry-over is on, days are left in it and the cap isn't reached),
 * otherwise the pool of its own year. A pool can't go below zero: pending days count as taken, so
 * two requests can't both use the last days. Fails naming the year that is short.
 */
export function assignPools(dates: readonly string[], input: Omit<BalanceInput, 'year' | 'isWorkingDay'>): PoolAssignmentResult {
  const { today, policy, pools, days } = input;
  const taken = (pool: number) => days.filter((d) => d.poolYear === pool).length;
  const carryTaken = (year: number) => days.filter((d) => isCarry(d, year)).length;
  const poolLeft = new Map<number, number>();
  const carryLeft = new Map<number, number>();
  const left = (pool: number) => {
    if (!poolLeft.has(pool)) poolLeft.set(pool, capacity(pools(pool)) - taken(pool));
    return poolLeft.get(pool)!;
  };
  const carry = (year: number) => {
    if (!carryLeft.has(year)) carryLeft.set(year, carriedOverInto(year, today, policy, pools, days) - carryTaken(year));
    return carryLeft.get(year)!;
  };
  const out: PoolAssignment[] = [];
  const sorted = [...dates].sort();
  for (const date of sorted) {
    const year = yearOf(date);
    if (policy.carryOver && date <= carryOverEnd(year) && carry(year) > 0 && left(year - 1) > 0) {
      carryLeft.set(year, carry(year) - 1);
      poolLeft.set(year - 1, left(year - 1) - 1);
      out.push({ date, poolYear: year - 1 });
      continue;
    }
    if (left(year) <= 0) {
      // What was available before this request, so the message says "4 available, 6 needed".
      const needed = sorted.filter((d) => yearOf(d) === year).length;
      const carryBefore = policy.carryOver ? Math.max(0, carriedOverInto(year, today, policy, pools, days) - carryTaken(year)) : 0;
      return { ok: false, year, needed, available: Math.max(0, capacity(pools(year)) - taken(year)) + carryBefore };
    }
    poolLeft.set(year, left(year) - 1);
    out.push({ date, poolYear: year });
  }
  return { ok: true, days: out };
}

/** The first `n` working days (Monday to Friday) from `from`, for tests and previews. */
export function workingDaysFrom(from: string, n: number, isWorkingDay: (date: string) => boolean = weekday): string[] {
  const out: string[] = [];
  let t = Date.parse(`${from}T00:00:00Z`);
  while (out.length < n) {
    const date = new Date(t).toISOString().slice(0, 10);
    if (isWorkingDay(date)) out.push(date);
    t += DAY_MS;
  }
  return out;
}
