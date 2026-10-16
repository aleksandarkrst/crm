import { describe, expect, it } from 'vitest';
import { checkRequest, paidLeaveWarnings, workingDaysBetween } from '../src/modules/timeoff/request-rules';
import { serbianHolidays } from '../src/modules/timesheet/serbian-holidays';

const WEEK = [1, 2, 3, 4, 5];
/** Serbia's calendar of a year as the rules see it. */
const serbia = (...years: number[]) => {
  const holidays = new Map<string, { name: string }>();
  for (const y of years) for (const h of serbianHolidays(y)) for (let d = h.date; d <= (h.endDate ?? h.date); d = new Date(Date.parse(d + 'T00:00:00Z') + 86_400_000).toISOString().slice(0, 10)) holidays.set(d, { name: h.name });
  return { workingWeekdays: WEEK, holidays };
};

describe('working days (spec 8.2, AC 8.8.1)', () => {
  it('counts weekdays and leaves out holidays, naming them', () => {
    // 27 April to 8 May 2026: 10 weekdays minus 1 and 2 May (Friday and Saturday: only Friday counts as excluded).
    const w = workingDaysBetween('2026-04-27', '2026-05-08', serbia(2026));
    expect(w.dates).toHaveLength(9);
    expect(w.excluded).toEqual([{ date: '2026-05-01', name: 'Praznik rada (Labour Day)' }]);
    // Easter week 2027: Good Friday 30 April, Easter Monday 3 May, Labour Day 1 May (Saturday) and the moved 4 May.
    const e = workingDaysBetween('2027-04-26', '2027-05-07', serbia(2027));
    expect(e.dates).toEqual(['2027-04-26', '2027-04-27', '2027-04-28', '2027-04-29', '2027-05-05', '2027-05-06', '2027-05-07']);
    expect(e.excluded.map((x) => x.date)).toEqual(['2027-04-30', '2027-05-03', '2027-05-04']);
  });

  it('a weekend only has no working days; a span across New Year counts both years’ holidays', () => {
    expect(workingDaysBetween('2026-10-17', '2026-10-18', serbia(2026)).dates).toEqual([]);
    const ny = workingDaysBetween('2028-12-29', '2029-01-05', serbia(2028, 2029));
    expect(ny.dates).toEqual(['2028-12-29', '2029-01-03', '2029-01-04', '2029-01-05']);
    expect(ny.excluded.map((x) => x.date)).toEqual(['2029-01-01', '2029-01-02']);
  });
});

describe('the checks (spec 8.3)', () => {
  const base = { type: 'vacation' as const, startDate: '2026-11-02', endDate: '2026-11-06', today: '2026-10-16', byAdmin: false, employmentStart: '2024-03-01', workingDays: 5 };

  it('refuses a request without working days', () => {
    expect(checkRequest({ ...base, workingDays: 0 })?.code).toBe('no_working_days');
  });

  it('employees request from today to the end of next year; Admins any date', () => {
    expect(checkRequest({ ...base, startDate: '2026-10-15', endDate: '2026-10-15' })?.code).toBe('past');
    expect(checkRequest({ ...base, startDate: '2026-10-16', endDate: '2026-10-16' })).toBeNull();
    expect(checkRequest({ ...base, startDate: '2028-01-02', endDate: '2028-01-03' })?.code).toBe('too_far');
    expect(checkRequest({ ...base, startDate: '2027-12-30', endDate: '2027-12-31' })).toBeNull();
    expect(checkRequest({ ...base, startDate: '2026-01-05', endDate: '2026-01-06', byAdmin: true })).toBeNull();
  });

  it('vacation needs a start date and one month of work (A2), unless an Admin records it', () => {
    expect(checkRequest({ ...base, employmentStart: null })?.code).toBe('no_start_date');
    const r = checkRequest({ ...base, employmentStart: '2026-10-01', startDate: '2026-10-20', endDate: '2026-10-21' });
    expect(r?.code).toBe('first_month');
    expect(r?.message).toContain('1 Nov 2026');
    expect(checkRequest({ ...base, employmentStart: '2026-10-01', startDate: '2026-11-02', endDate: '2026-11-03' })).toBeNull();
    expect(checkRequest({ ...base, employmentStart: '2026-10-01', startDate: '2026-10-20', endDate: '2026-10-21', byAdmin: true })).toBeNull();
    // Paid leave has no first-month rule and no start date need.
    expect(checkRequest({ ...base, type: 'paid_leave', employmentStart: null })).toBeNull();
  });
});

describe('paid leave limits are warnings (spec 7.2)', () => {
  it('warns over the reason’s days per case and over the yearly group limit', () => {
    expect(paidLeaveWarnings({ maxDays: 5, countsTowardLimit: true, yearlyLimit: 5, days: 3, usedTowardLimit: 0 })).toEqual([]);
    expect(paidLeaveWarnings({ maxDays: 2, countsTowardLimit: false, yearlyLimit: 5, days: 3, usedTowardLimit: 0 })).toEqual(['Exceeds the limit of 2 days for this reason']);
    expect(paidLeaveWarnings({ maxDays: 5, countsTowardLimit: true, yearlyLimit: 5, days: 3, usedTowardLimit: 4 })).toEqual(['Exceeds the yearly limit of 5 paid leave days (4 used this year)']);
    expect(paidLeaveWarnings({ maxDays: 1, countsTowardLimit: true, yearlyLimit: 5, days: 6, usedTowardLimit: 0 })).toHaveLength(2);
    expect(paidLeaveWarnings({ maxDays: null, countsTowardLimit: false, yearlyLimit: 5, days: 30, usedTowardLimit: 10 })).toEqual([]);
  });
});
