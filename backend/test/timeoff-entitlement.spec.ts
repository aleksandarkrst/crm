import { describe, expect, it } from 'vitest';
import { addMonths, carryOverDays, computeEntitlement, type EntitlementInput, experienceExtra, experienceLabel, fullMonthsBetween, monthsOfService, type PolicyRules, roundDays } from '../src/modules/timeoff/entitlement';

/** The default policy of a new workspace (spec 5.2). */
const STANDARD: PolicyRules = { baseDays: 20, maxDays: null, carryOver: true, carryOverCap: null, experienceRules: [] };
/** A policy with experience rows: from 5 years +2, from 10 years +4. */
const SENIORITY: PolicyRules = { ...STANDARD, experienceRules: [{ fromYears: 10, extraDays: 4 }, { fromYears: 5, extraDays: 2 }] };

const input = (over: Partial<EntitlementInput> = {}): EntitlementInput => ({ year: 2026, policy: STANDARD, startDate: '2020-03-15', endDate: null, priorExperienceMonths: 0, individualDays: 0, ...over });

describe('months (spec 5.4)', () => {
  it('adds months and clamps the day', () => {
    expect(addMonths('2026-03-15', 1)).toBe('2026-04-15');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
    expect(addMonths('2026-11-15', 2)).toBe('2027-01-15');
  });

  it('counts full months from the start date: 15 March to 14 April is one month', () => {
    expect(fullMonthsBetween('2026-03-15', '2026-04-14')).toBe(1);
    expect(fullMonthsBetween('2026-03-15', '2026-04-13')).toBe(0);
    expect(fullMonthsBetween('2026-03-15', '2026-12-31')).toBe(9);
    expect(fullMonthsBetween('2026-01-01', '2026-12-31')).toBe(12);
    expect(fullMonthsBetween('2026-01-02', '2026-12-31')).toBe(11);
    expect(fullMonthsBetween('2026-10-01', '2026-12-31')).toBe(3);
    expect(fullMonthsBetween('2026-05-01', '2026-04-30')).toBe(0);
  });

  it('service completed before a date', () => {
    expect(monthsOfService('2020-03-15', '2026-01-01')).toBe(69);
    expect(monthsOfService('2020-03-15', '2026-03-15')).toBe(72);
    expect(monthsOfService('2020-03-15', '2026-03-14')).toBe(71);
    expect(monthsOfService('2026-05-01', '2026-05-01')).toBe(0);
  });

  it('rounds halves up', () => {
    expect(roundDays(5.5)).toBe(6);
    expect(roundDays(18.33)).toBe(18);
    expect(roundDays(18.75)).toBe(19);
    expect(roundDays(5)).toBe(5);
  });
});

describe('experience rows (spec 5.2)', () => {
  it('applies the highest row reached, rows do not add up', () => {
    expect(experienceExtra(SENIORITY.experienceRules, 4)).toBe(0);
    expect(experienceExtra(SENIORITY.experienceRules, 5)).toBe(2);
    expect(experienceExtra(SENIORITY.experienceRules, 9)).toBe(2);
    expect(experienceExtra(SENIORITY.experienceRules, 10)).toBe(4);
    expect(experienceExtra(SENIORITY.experienceRules, 40)).toBe(4);
    expect(experienceExtra([], 40)).toBe(0);
  });

  it('labels prior experience', () => {
    expect(experienceLabel(0)).toBe('0 months');
    expect(experienceLabel(1)).toBe('1 month');
    expect(experienceLabel(12)).toBe('1 year');
    expect(experienceLabel(63)).toBe('5 years 3 months');
  });
});

describe('entitlement (spec 5.4, AC 5.6.2)', () => {
  it('a full year gets the annual total', () => {
    expect(computeEntitlement(input())).toEqual({ baseDays: 20, experienceYears: 5, experienceDays: 0, individualDays: 0, annualDays: 20, monthsWorked: null, totalDays: 20 });
  });

  it('needs a start date', () => {
    expect(computeEntitlement(input({ startDate: null }))).toBeNull();
  });

  it('a mid-year start is proportional, rounded halves up', () => {
    // The spec's example: start 15 March, 9 full months of 20 days = 15.
    expect(computeEntitlement(input({ startDate: '2026-03-15' }))).toMatchObject({ monthsWorked: 9, totalDays: 15 });
    // Starting on 2 January misses the first month: 11 × 20 / 12 = 18.33 → 18.
    expect(computeEntitlement(input({ startDate: '2026-01-02' }))).toMatchObject({ monthsWorked: 11, totalDays: 18 });
    // Starting on 1 January is a full year.
    expect(computeEntitlement(input({ startDate: '2026-01-01' }))).toMatchObject({ monthsWorked: null, totalDays: 20 });
    // 22 days × 3 / 12 = 5.5 → 6.
    expect(computeEntitlement(input({ startDate: '2026-10-01', policy: { ...STANDARD, baseDays: 22 } }))).toMatchObject({ monthsWorked: 3, annualDays: 22, totalDays: 6 });
    // The partial month at the end doesn't count: 15 Oct to 31 Dec is 2 full months.
    expect(computeEntitlement(input({ startDate: '2026-10-15' }))).toMatchObject({ monthsWorked: 2, totalDays: 3 });
  });

  it('the leaving year is proportional too', () => {
    expect(computeEntitlement(input({ endDate: '2026-06-30' }))).toMatchObject({ monthsWorked: 6, totalDays: 10 });
    expect(computeEntitlement(input({ startDate: '2026-02-01', endDate: '2026-04-30' }))).toMatchObject({ monthsWorked: 3, totalDays: 5 });
    // Not employed in the year at all.
    expect(computeEntitlement(input({ startDate: '2027-01-01' }))).toMatchObject({ monthsWorked: 0, totalDays: 0 });
    expect(computeEntitlement(input({ endDate: '2025-12-31' }))).toMatchObject({ monthsWorked: 0, totalDays: 0 });
  });

  it('experience rows at their thresholds, evaluated on 1 January', () => {
    // Started 15 March 2020: 5 years on 1 January 2026, 4 on 1 January 2025.
    expect(computeEntitlement(input({ policy: SENIORITY }))).toMatchObject({ experienceYears: 5, experienceDays: 2, annualDays: 22, totalDays: 22 });
    expect(computeEntitlement(input({ policy: SENIORITY, year: 2025 }))).toMatchObject({ experienceYears: 4, experienceDays: 0, totalDays: 20 });
    expect(computeEntitlement(input({ policy: SENIORITY, year: 2031 }))).toMatchObject({ experienceYears: 10, experienceDays: 4, totalDays: 24 });
    // Prior experience counts: 60 months before joining on 1 June 2025, 7 months of service by 1 January 2026.
    expect(computeEntitlement(input({ policy: SENIORITY, startDate: '2025-06-01', priorExperienceMonths: 60 }))).toMatchObject({ experienceYears: 5, experienceDays: 2 });
  });

  it('a new hire is evaluated on the start date, and gets the proportional part of the extra days', () => {
    // 10 years of prior experience, starting 1 May: +4 days, 8 full months: 24 × 8 / 12 = 16.
    expect(computeEntitlement(input({ policy: SENIORITY, startDate: '2026-05-01', priorExperienceMonths: 120 }))).toMatchObject({ experienceYears: 10, experienceDays: 4, annualDays: 24, monthsWorked: 8, totalDays: 16 });
  });

  it('individual extra days add up and the maximum caps the total', () => {
    expect(computeEntitlement(input({ policy: SENIORITY, year: 2031, individualDays: 3 }))).toMatchObject({ individualDays: 3, annualDays: 27, totalDays: 27 });
    expect(computeEntitlement(input({ policy: { ...SENIORITY, maxDays: 25 }, year: 2031, individualDays: 3 }))).toMatchObject({ annualDays: 25, totalDays: 25 });
    // The cap applies before the proportional part.
    expect(computeEntitlement(input({ policy: { ...SENIORITY, maxDays: 24 }, startDate: '2026-07-01', priorExperienceMonths: 120, individualDays: 5 }))).toMatchObject({ annualDays: 24, monthsWorked: 6, totalDays: 12 });
  });
});

describe('carry-over (spec 5.2, 6.2; AC 5.6.3)', () => {
  it('on: every unused day, or at most the cap; off: none', () => {
    expect(carryOverDays(7, STANDARD)).toBe(7);
    expect(carryOverDays(7, { carryOver: true, carryOverCap: 5 })).toBe(5);
    expect(carryOverDays(3, { carryOver: true, carryOverCap: 5 })).toBe(3);
    expect(carryOverDays(7, { carryOver: false, carryOverCap: null })).toBe(0);
    expect(carryOverDays(0, STANDARD)).toBe(0);
    expect(carryOverDays(-2, STANDARD)).toBe(0);
  });
});
