import { describe, expect, it } from 'vitest';
import {
  copyPlan,
  type CopySourceRow,
  type CopyTarget,
  dayLimitRefusal,
  endAfter,
  deadlineOf,
  DEFAULT_TIMESHEET_SETTINGS as S,
  expectedMinutes,
  formatMinutes,
  isoWeek,
  isRequired,
  mondayOf,
  spanMinutes,
  submittableDays,
  type WeekDay,
  weekLabel,
  weekStatus,
} from '../src/modules/timesheet/timesheet-rules';

const always = { start: null, end: null };

describe('weeks (CD-152)', () => {
  it('a week is its Monday, numbered by ISO week', () => {
    expect(mondayOf('2026-10-05')).toBe('2026-10-05');
    expect(mondayOf('2026-10-11')).toBe('2026-10-05');
    expect(mondayOf('2026-10-07')).toBe('2026-10-05');
    expect(isoWeek('2026-10-05')).toBe(41);
    expect(isoWeek('2026-12-28')).toBe(53);
    expect(isoWeek('2027-01-04')).toBe(1);
    expect(isoWeek('2025-12-29')).toBe(1);
  });

  it('labels the week as the design does', () => {
    expect(weekLabel('2026-10-05')).toBe('Week 41 · 5 to 11 Oct 2026');
    expect(weekLabel('2026-09-28')).toBe('Week 40 · 28 Sep to 4 Oct 2026');
    expect(weekLabel('2026-12-28')).toBe('Week 53 · 28 Dec to 3 Jan 2027');
  });

  it('is due on Friday 17:00 of the same week by default', () => {
    expect(deadlineOf('2026-10-05', S)).toEqual({ date: '2026-10-09', time: '17:00' });
  });
});

describe('expected hours and required days (spec 5.1)', () => {
  it('expects the standard day on working days within employment', () => {
    expect(expectedMinutes('2026-10-05', S, always)).toBe(480);
    expect(expectedMinutes('2026-10-10', S, always)).toBe(0);
    expect(expectedMinutes('2026-10-05', S, { start: '2026-10-06', end: null })).toBe(0);
    expect(expectedMinutes('2026-10-09', S, { start: null, end: '2026-10-08' })).toBe(0);
  });

  it('a day with hours is required, also on a weekend', () => {
    expect(isRequired(0, 0)).toBe(false);
    expect(isRequired(0, 60)).toBe(true);
    expect(isRequired(480, 0)).toBe(true);
  });

  it('submits required Draft days up to the end of the current week', () => {
    const days: WeekDay[] = [
      { date: '2026-10-05', status: 'draft', required: true, minutes: 480 },
      { date: '2026-10-06', status: 'submitted', required: true, minutes: 480 },
      { date: '2026-10-07', status: 'rejected', required: true, minutes: 480 },
      { date: '2026-10-10', status: 'draft', required: false, minutes: 0 },
      { date: '2026-10-11', status: 'draft', required: true, minutes: 60 },
    ];
    expect(submittableDays(days, '2026-10-07')).toEqual(['2026-10-05', '2026-10-11']);
    // A future week has nothing to submit.
    expect(submittableDays(days, '2026-09-30')).toEqual([]);
  });
});

describe('week status (spec 5.4)', () => {
  const day = (date: string, status: WeekDay['status'], required = true, minutes = 480): WeekDay => ({ date, status, required, minutes });

  it('first match wins', () => {
    expect(weekStatus([day('a', 'draft', false, 0)])).toEqual({ status: 'no_entry', label: 'No entry needed' });
    expect(weekStatus([day('a', 'rejected'), day('b', 'rejected'), day('c', 'draft')]).label).toBe('Rejected (2 days)');
    expect(weekStatus([day('a', 'rejected'), day('b', 'approved')]).label).toBe('Rejected (1 day)');
    expect(weekStatus([day('a', 'draft', true, 0), day('b', 'draft', true, 0)])).toEqual({ status: 'not_submitted', label: 'Not submitted' });
    expect(weekStatus([day('a', 'draft'), day('b', 'submitted')])).toEqual({ status: 'draft', label: 'Draft' });
    expect(weekStatus([day('a', 'submitted'), day('b', 'submitted')])).toEqual({ status: 'submitted', label: 'Submitted' });
    expect(weekStatus([day('a', 'approved'), day('b', 'approved'), day('c', 'submitted')]).label).toBe('Partly approved (2 of 3 days)');
    expect(weekStatus([day('a', 'approved'), day('b', 'approved'), day('c', 'draft', false, 0)])).toEqual({ status: 'approved', label: 'Approved' });
  });
});

describe('hours (spec 4.5)', () => {
  it('shows minutes in the workspace format', () => {
    expect(formatMinutes(450, 'decimal')).toBe('7.50');
    expect(formatMinutes(450, 'clock')).toBe('7:30');
    expect(formatMinutes(15, 'clock')).toBe('0:15');
  });

  it('refuses a day above the maximum, not up to it', () => {
    expect(dayLimitRefusal(600, 120, S)).toBeNull();
    expect(dayLimitRefusal(600, 135, S)).toBe('Maximum 12 h per day');
  });
});

describe('Copy last week (spec 4.7)', () => {
  const target = (over: Partial<CopyTarget> = {}): CopyTarget => ({
    monday: '2026-10-05',
    lastDate: '2026-10-11',
    cellMinutes: () => 0,
    dayMinutes: {},
    dayStatus: {},
    ...over,
  });
  const source: CopySourceRow[] = [
    { key: 'task:a', label: 'task T-1', refusal: null, minutes: { '2026-09-28': 240, '2026-09-29': 480 } },
    { key: 'work_order:b', label: 'WO-1001', refusal: 'is completed', minutes: { '2026-09-28': 120 } },
    { key: 'task:c', label: 'task T-2', refusal: null, minutes: {} },
  ];

  it('rows only: copies the rows it can, lists the ones it skips', () => {
    const plan = copyPlan(source, target(), false, S);
    expect(plan.rows).toEqual(['task:a', 'task:c']);
    expect(plan.cells).toEqual([]);
    expect(plan.skippedRows).toEqual([{ label: 'WO-1001', reason: 'is completed' }]);
  });

  it('rows and hours: day by day into empty cells, never over a value or the maximum', () => {
    const plan = copyPlan(
      source,
      target({ cellMinutes: (key, date) => (key === 'task:a' && date === '2026-10-06' ? 60 : 0), dayMinutes: { '2026-10-05': 600 } }),
      true,
      S,
    );
    // Monday would make 14 h; Tuesday already has hours on that task.
    expect(plan.cells).toEqual([]);
    expect(plan.fullDays).toEqual(['2026-10-05']);
    expect(copyPlan(source, target(), true, S).cells).toEqual([
      { key: 'task:a', date: '2026-10-05', minutes: 240 },
      { key: 'task:a', date: '2026-10-06', minutes: 480 },
    ]);
  });

  it('skips submitted and approved days and days after the current week', () => {
    expect(copyPlan(source, target({ dayStatus: { '2026-10-05': 'submitted', '2026-10-06': 'approved' } }), true, S).cells).toEqual([]);
    expect(copyPlan(source, target({ dayStatus: { '2026-10-05': 'rejected' } }), true, S).cells).toHaveLength(2);
    expect(copyPlan(source, target({ lastDate: '2026-10-05' }), true, S).cells).toEqual([{ key: 'task:a', date: '2026-10-05', minutes: 240 }]);
  });
});

describe('Start → End (CD-276)', () => {
  it('is the minutes between, in quarter hours, never backwards', () => {
    expect(spanMinutes('08:00', '10:30')).toBe(150);
    expect(spanMinutes('08:10', '09:10')).toBe(60);
    expect(spanMinutes('08:00', '08:10')).toBeNull();
    expect(spanMinutes('10:00', '09:00')).toBeNull();
    expect(spanMinutes('10:00', '10:00')).toBeNull();
  });

  it('moves the end with new hours, and drops it past midnight', () => {
    expect(endAfter('08:00', 150)).toBe('10:30');
    expect(endAfter('22:00', 120)).toBeNull();
    expect(endAfter('22:00', 105)).toBe('23:45');
  });
});
