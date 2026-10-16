import { describe, expect, it } from 'vitest';
import { assignPools, type BalanceInput, carriedOverInto, computeBalance, type PoolFacts, type VacationDay, workingDaysFrom } from '../src/modules/timeoff/balance';

const STANDARD = { carryOver: true, carryOverCap: null };
const poolsOf = (facts: Record<number, Partial<PoolFacts>>) => (year: number) => ({ entitlement: facts[year]?.entitlement ?? 0, adjustments: facts[year]?.adjustments ?? 0 });
const day = (date: string, poolYear: number, status: VacationDay['status'] = 'approved', requestId = `r-${date}`): VacationDay => ({ date, poolYear, status, requestId });
/** `n` approved working days from `from`, all in `poolYear`, one request. */
const vacation = (from: string, n: number, poolYear: number, status: VacationDay['status'] = 'approved', requestId = `req-${from}`) => workingDaysFrom(from, n).map((d) => day(d, poolYear, status, requestId));

const input = (over: Partial<BalanceInput> = {}): BalanceInput => ({ year: 2026, today: '2026-10-16', policy: STANDARD, pools: poolsOf({ 2025: { entitlement: 20 }, 2026: { entitlement: 20 } }), days: [], ...over });

describe('carry-over into a year (spec 6.2, 6.3)', () => {
  it('is last year’s unused days, after the cap, once the year started', () => {
    const days = vacation('2025-08-04', 15, 2025);
    expect(carriedOverInto(2026, '2026-01-01', STANDARD, input().pools, days)).toBe(5);
    expect(carriedOverInto(2026, '2026-01-01', { carryOver: true, carryOverCap: 3 }, input().pools, days)).toBe(3);
    expect(carriedOverInto(2026, '2026-01-01', { carryOver: false, carryOverCap: null }, input().pools, days)).toBe(0);
    // Not known before the year starts.
    expect(carriedOverInto(2026, '2025-12-31', STANDARD, input().pools, days)).toBe(0);
    // Adjustments of last year's pool count; a year without a row carries nothing.
    expect(carriedOverInto(2026, '2026-01-01', STANDARD, poolsOf({ 2025: { entitlement: 20, adjustments: -4 } }), days)).toBe(1);
    expect(carriedOverInto(2026, '2026-01-01', STANDARD, poolsOf({}), [])).toBe(0);
  });
});

describe('the figures (spec 6.3, AC 6.6.1)', () => {
  it('a fresh year: everything remaining', () => {
    expect(computeBalance(input({ pools: poolsOf({ 2026: { entitlement: 20 } }) }))).toMatchObject({ entitlement: 20, carriedOver: 0, adjustments: 0, total: 20, used: 0, scheduled: 0, pending: 0, expired: 0, remaining: 20, available: 20, carryRemaining: 0, twoWeekPart: false });
  });

  it('used is dated up to today, scheduled after; pending lowers what can be requested', () => {
    const days = [...vacation('2026-10-12', 5, 2026), ...vacation('2026-11-02', 3, 2026), ...vacation('2026-12-01', 2, 2026, 'pending')];
    const b = computeBalance(input({ days }));
    expect(b).toMatchObject({ used: 5, scheduled: 3, pending: 2, remaining: 12, available: 10 });
  });

  it('carry-over is consumed first and counts in the year it is used; it expires on 1 July', () => {
    const pools = poolsOf({ 2025: { entitlement: 20 }, 2026: { entitlement: 20 } });
    // 2025: 15 used → 5 carry over. In 2026: 3 of them taken in February.
    const days = [...vacation('2025-08-04', 15, 2025), ...vacation('2026-02-02', 3, 2025)];
    const june = computeBalance(input({ pools, days, today: '2026-06-15' }));
    expect(june).toMatchObject({ entitlement: 20, carriedOver: 5, total: 25, used: 3, expired: 0, remaining: 22, carryRemaining: 2, carryExpiresOn: '2026-06-30' });
    const july = computeBalance(input({ pools, days, today: '2026-07-01' }));
    expect(july).toMatchObject({ carriedOver: 5, used: 3, expired: 2, remaining: 20, carryRemaining: 0 });
    // 2025's own card never counts the February days (they are 2026's carry-over).
    expect(computeBalance(input({ year: 2025, pools, days, today: '2026-07-01' }))).toMatchObject({ used: 15, remaining: 5 });
  });

  it('a carry-over cap limits what comes over, and what can expire', () => {
    const pools = poolsOf({ 2025: { entitlement: 20 }, 2026: { entitlement: 20 } });
    const days = [...vacation('2025-08-04', 10, 2025), ...vacation('2026-03-02', 2, 2025)];
    const b = computeBalance(input({ pools, days, today: '2026-07-02', policy: { carryOver: true, carryOverCap: 5 } }));
    expect(b).toMatchObject({ carriedOver: 5, used: 2, expired: 3, total: 25, remaining: 20 });
  });

  it('a late approval of days before 1 July still uses the carry-over and lowers what expired', () => {
    const pools = poolsOf({ 2025: { entitlement: 20 }, 2026: { entitlement: 20 } });
    const before = computeBalance(input({ pools, days: vacation('2025-08-04', 15, 2025), today: '2026-07-10' }));
    expect(before.expired).toBe(5);
    const after = computeBalance(input({ pools, days: [...vacation('2025-08-04', 15, 2025), ...vacation('2026-06-22', 4, 2025)], today: '2026-07-10' }));
    expect(after).toMatchObject({ expired: 1, used: 4 });
  });

  it('a request across New Year takes each day from the right pool', () => {
    const pools = poolsOf({ 2026: { entitlement: 20 }, 2027: { entitlement: 20 } });
    // 29 Dec 2026 to 5 Jan 2027: 3 working days of 2026 (29, 30, 31 Dec), then 4 and 5 Jan (1 Jan is a holiday, 2 and 3 Jan the weekend).
    const assigned = assignPools(['2026-12-29', '2026-12-30', '2026-12-31', '2027-01-04', '2027-01-05'], { today: '2026-12-01', policy: { carryOver: false, carryOverCap: null }, pools, days: [] });
    expect(assigned).toEqual({ ok: true, days: [{ date: '2026-12-29', poolYear: 2026 }, { date: '2026-12-30', poolYear: 2026 }, { date: '2026-12-31', poolYear: 2026 }, { date: '2027-01-04', poolYear: 2027 }, { date: '2027-01-05', poolYear: 2027 }] });
  });

  it('adjustments and opening balances change the pool', () => {
    const pools = poolsOf({ 2025: { entitlement: 20, adjustments: -12 }, 2026: { entitlement: 20, adjustments: 2 } });
    // Opening balance: 12 days of 2025 were used before Pultly; the other 8 carry over.
    const b = computeBalance(input({ pools, today: '2026-03-01' }));
    expect(b).toMatchObject({ entitlement: 20, carriedOver: 8, adjustments: 2, total: 30, remaining: 30 });
  });

  it('the two-week part: one approved request with ten working days in the year', () => {
    expect(computeBalance(input({ days: vacation('2026-08-03', 10, 2026) })).twoWeekPart).toBe(true);
    expect(computeBalance(input({ days: vacation('2026-08-03', 9, 2026) })).twoWeekPart).toBe(false);
    expect(computeBalance(input({ days: [...vacation('2026-08-03', 5, 2026, 'approved', 'a'), ...vacation('2026-08-10', 5, 2026, 'approved', 'b')] })).twoWeekPart).toBe(false);
    expect(computeBalance(input({ days: vacation('2026-08-03', 10, 2026, 'pending') })).twoWeekPart).toBe(false);
  });
});

describe('assigning pools (spec 6.2, 8.3)', () => {
  const pools = poolsOf({ 2025: { entitlement: 20 }, 2026: { entitlement: 20 } });
  const carry = vacation('2025-08-04', 17, 2025); // 3 carry over into 2026

  it('days up to 30 June use the carry-over first, then the year’s pool', () => {
    const r = assignPools(workingDaysFrom('2026-06-25', 5), { today: '2026-06-01', policy: STANDARD, pools, days: carry });
    expect(r.ok && r.days.map((d) => d.poolYear)).toEqual([2025, 2025, 2025, 2026, 2026]);
  });

  it('after 30 June only the year’s pool is used, and with carry-over off too', () => {
    expect(assignPools(['2026-07-01', '2026-07-02'], { today: '2026-06-01', policy: STANDARD, pools, days: carry })).toMatchObject({ ok: true, days: [{ poolYear: 2026 }, { poolYear: 2026 }] });
    expect(assignPools(['2026-03-02'], { today: '2026-03-01', policy: { carryOver: false, carryOverCap: null }, pools, days: carry })).toMatchObject({ ok: true, days: [{ poolYear: 2026 }] });
  });

  it('pending days count, so two requests can’t both use the last days', () => {
    const taken = [...vacation('2026-01-12', 18, 2026, 'approved'), ...vacation('2026-11-02', 2, 2026, 'pending')];
    const r = assignPools(['2026-12-01'], { today: '2026-10-01', policy: STANDARD, pools: poolsOf({ 2026: { entitlement: 20 } }), days: taken });
    expect(r).toEqual({ ok: false, year: 2026, needed: 1, available: 0 });
    const ok = assignPools(['2026-12-01'], { today: '2026-10-01', policy: STANDARD, pools: poolsOf({ 2026: { entitlement: 21 } }), days: taken });
    expect(ok.ok).toBe(true);
  });

  it('says how many days are available when a request does not fit', () => {
    const r = assignPools(workingDaysFrom('2026-03-02', 6), { today: '2026-03-01', policy: STANDARD, pools: poolsOf({ 2025: { entitlement: 20 }, 2026: { entitlement: 20 } }), days: [...vacation('2025-01-05', 19, 2025), ...vacation('2026-01-12', 17, 2026)] });
    // 1 carry-over day + 3 of 2026 = 4 available, 6 needed.
    expect(r).toEqual({ ok: false, year: 2026, needed: 6, available: 4 });
  });
});
