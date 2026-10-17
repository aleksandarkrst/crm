import { describe, expect, it } from 'vitest';
import { dayStatus, nextWorkingDayAfter, shortDate, type StatusAbsence, type StatusInput } from '../src/modules/timesheet/team-status';

const WEEKDAYS = [1, 2, 3, 4, 5];
// 2026-10-12 is a Monday; 17 and 18 Oct are the weekend.
const base = (over: Partial<StatusInput> = {}): StatusInput => ({
  date: '2026-10-14',
  employment: { start: '2024-01-01', end: null },
  holiday: undefined,
  dayMinutes: 480,
  workingDays: WEEKDAYS,
  absences: [],
  enteredMinutes: 0,
  nextWorkingDay: (d) => nextWorkingDayAfter(d, WEEKDAYS, () => false),
  ...over,
});
const vacation: StatusAbsence = { kind: 'time_off', label: 'Vacation', from: '2026-10-12', to: '2026-10-16' };
const sick: StatusAbsence = { kind: 'sick_leave', label: 'Sick leave', from: '2026-10-13', to: '2026-10-14' };
const trip: StatusAbsence = { kind: 'business_trip', label: 'Vienna, AT', from: '2026-10-16', to: '2026-10-19' };

describe("Today's status rule (CD-162, spec 12.2)", () => {
  it('formats dates as "Wed 14 Oct"', () => {
    expect(shortDate('2026-10-14')).toBe('Wed 14 Oct');
  });

  it('is Working on a working day with nothing else', () => {
    expect(dayStatus(base())).toEqual({ status: 'working', label: 'Working', detail: null });
  });

  it('is Not employed before the start date (with the start) and after the end date', () => {
    expect(dayStatus(base({ employment: { start: '2026-11-02', end: null } }))).toEqual({ status: 'not_employed', label: 'Not employed', detail: 'Starts Mon 2 Nov' });
    expect(dayStatus(base({ employment: { start: '2024-01-01', end: '2026-10-13' }, absences: [vacation] })).status).toBe('not_employed');
    expect(dayStatus(base({ employment: { start: '2024-01-01', end: '2026-10-14' } })).status).toBe('working');
  });

  it('puts a public holiday before a vacation covering it', () => {
    expect(dayStatus(base({ holiday: { date: '2026-10-14', name: 'Armistice Day', minutes: null }, absences: [vacation] }))).toEqual({ status: 'public_holiday', label: 'Public holiday', detail: 'Armistice Day' });
  });

  it('treats a part-day holiday as a working day with the holiday named', () => {
    expect(dayStatus(base({ holiday: { date: '2026-10-14', name: 'Christmas Eve', minutes: 240 } }))).toEqual({ status: 'working', label: 'Working', detail: 'Christmas Eve (part day)' });
    expect(dayStatus(base({ holiday: { date: '2026-10-14', name: 'Long holiday', minutes: 480 } })).status).toBe('public_holiday');
  });

  it('puts sick leave before time off and trips', () => {
    expect(dayStatus(base({ absences: [vacation, trip, sick] }))).toEqual({ status: 'sick_leave', label: 'Sick leave', detail: 'Until Wed 14 Oct' });
    expect(dayStatus(base({ absences: [{ ...sick, to: null }] })).detail).toBe('Since Tue 13 Oct');
  });

  it('shows the time off type and the day back, skipping the weekend and holidays', () => {
    expect(dayStatus(base({ absences: [trip, vacation] }))).toEqual({ status: 'time_off', label: 'Vacation', detail: 'Back on Mon 19 Oct' });
    const holidayMonday = (d: string) => nextWorkingDayAfter(d, WEEKDAYS, (x) => x === '2026-10-19');
    expect(dayStatus(base({ absences: [vacation], nextWorkingDay: holidayMonday })).detail).toBe('Back on Tue 20 Oct');
    expect(dayStatus(base({ absences: [{ ...vacation, label: 'Paid leave: Marriage' }] })).label).toBe('Paid leave: Marriage');
  });

  it('keeps a trip over the weekend a business trip, not a non-working day', () => {
    expect(dayStatus(base({ date: '2026-10-17', absences: [trip] }))).toEqual({ status: 'business_trip', label: 'Business trip', detail: 'Vienna, AT · back on Tue 20 Oct' });
  });

  it('keeps a vacation over the weekend time off', () => {
    const twoWeeks = { ...vacation, to: '2026-10-23' };
    expect(dayStatus(base({ date: '2026-10-18', absences: [twoWeeks] })).status).toBe('time_off');
  });

  it('is Not a working day on a weekend without hours, Working with "Weekend work" with hours', () => {
    expect(dayStatus(base({ date: '2026-10-17' }))).toEqual({ status: 'non_working', label: 'Not a working day', detail: null });
    expect(dayStatus(base({ date: '2026-10-17', enteredMinutes: 120 }))).toEqual({ status: 'working', label: 'Working', detail: 'Weekend work' });
  });

  it('follows the workspace working days', () => {
    expect(dayStatus(base({ date: '2026-10-17', workingDays: [1, 2, 3, 4, 5, 6] })).status).toBe('working');
    expect(dayStatus(base({ workingDays: [1, 2, 4, 5] })).status).toBe('non_working');
  });
});
