import { describe, expect, it } from 'vitest';
import { calendarDays, continues, countedEnd, day31, periodsOverlap } from '../src/modules/timeoff/sick-leave-rules';

const weekday = (date: string) => ![0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay());

describe('sick leave rules (spec 13.2 to 13.4)', () => {
  it('counts calendar days, open records up to today', () => {
    expect(calendarDays('2026-11-02', '2026-11-02')).toBe(1);
    expect(calendarDays('2026-11-28', '2026-12-03')).toBe(6);
    expect(countedEnd({ startDate: '2026-11-02', endDate: null }, '2026-11-10')).toBe('2026-11-10');
    expect(countedEnd({ startDate: '2026-11-20', endDate: null }, '2026-11-10')).toBe('2026-11-19');
    expect(countedEnd({ startDate: '2026-11-02', endDate: '2026-11-04' }, '2026-11-10')).toBe('2026-11-04');
  });

  it('open periods overlap everything after their start', () => {
    expect(periodsOverlap({ startDate: '2026-11-02', endDate: null }, { startDate: '2027-01-05', endDate: '2027-01-06' })).toBe(true);
    expect(periodsOverlap({ startDate: '2026-11-02', endDate: '2026-11-04' }, { startDate: '2026-11-05', endDate: null })).toBe(false);
    expect(periodsOverlap({ startDate: '2026-11-02', endDate: '2026-11-04' }, { startDate: '2026-11-04', endDate: '2026-11-04' })).toBe(true);
  });

  it('a continuation starts the next day or after only non-working days', () => {
    expect(continues({ endDate: '2026-11-05' }, '2026-11-06', weekday)).toBe(true);
    // Friday to Monday: only the weekend between.
    expect(continues({ endDate: '2026-11-06' }, '2026-11-09', weekday)).toBe(true);
    expect(continues({ endDate: '2026-11-05' }, '2026-11-09', weekday)).toBe(false);
    expect(continues({ endDate: null }, '2026-11-09', weekday)).toBe(false);
  });

  it('day 31 counts across continuations', () => {
    expect(day31({ startDate: '2026-11-01', endDate: null }, 0)).toBe('2026-12-01');
    expect(day31({ startDate: '2026-11-01', endDate: '2026-11-20' }, 0)).toBeNull();
    // 20 days before: the 11th day of this record.
    expect(day31({ startDate: '2026-12-01', endDate: '2026-12-31' }, 20)).toBe('2026-12-11');
    expect(day31({ startDate: '2026-12-01', endDate: '2026-12-02' }, 45)).toBe('2026-12-01');
  });
});
