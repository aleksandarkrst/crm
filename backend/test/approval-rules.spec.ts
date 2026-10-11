import { describe, expect, it } from 'vitest';
import { approvableDays, approvalRight, returnableDays } from '../src/modules/timesheet/approval-rules';
import type { WeekDay } from '../src/modules/timesheet/timesheet-rules';

const day = (date: string, status: WeekDay['status'], required = true, minutes = 480): WeekDay => ({ date, status, required, minutes });
const week = (...statuses: WeekDay['status'][]): WeekDay[] => [
  ...statuses.map((s, i) => day(`2026-10-0${5 + i}`, s)),
  day('2026-10-10', 'draft', false, 0),
  day('2026-10-11', 'draft', false, 0),
];

describe('approvalRight (spec 8.3, Admin override decided 9 Oct)', () => {
  const target = { employeeId: 'e', managerId: 'm', managerActive: true, managerHasAccount: true };
  it('is the manager for their direct report, nobody for anyone else', () => {
    expect(approvalRight({ employeeId: 'm', isAdmin: false }, target)).toBe('approver');
    expect(approvalRight({ employeeId: 'x', isAdmin: false }, target)).toBeNull();
    expect(approvalRight({ employeeId: null, isAdmin: false }, target)).toBeNull();
  });
  it('is an override for an Admin while the manager can act, the approver when the manager cannot', () => {
    expect(approvalRight({ employeeId: 'a', isAdmin: true }, target)).toBe('override');
    expect(approvalRight({ employeeId: 'a', isAdmin: true }, { ...target, managerId: null })).toBe('approver');
    expect(approvalRight({ employeeId: 'a', isAdmin: true }, { ...target, managerActive: false })).toBe('approver');
    expect(approvalRight({ employeeId: 'a', isAdmin: true }, { ...target, managerHasAccount: false })).toBe('approver');
    expect(approvalRight({ employeeId: 'm', isAdmin: true }, target)).toBe('approver');
  });
  it('never lets anyone approve their own week', () => {
    expect(approvalRight({ employeeId: 'e', isAdmin: true }, target)).toBeNull();
    expect(approvalRight({ employeeId: 'e', isAdmin: false }, { ...target, managerId: 'e' })).toBeNull();
  });
});

describe('approvableDays (spec 5.3 T3)', () => {
  it('Whole week: all Submitted days, only once no required day is Draft or Rejected, never a selection', () => {
    expect(approvableDays(week('submitted', 'submitted', 'submitted', 'submitted', 'submitted'), 'week')).toEqual({ dates: ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09'] });
    expect(approvableDays(week('approved', 'submitted', 'submitted', 'submitted', 'submitted'), 'week')).toEqual({ dates: ['2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09'] });
    expect(approvableDays(week('draft', 'submitted', 'submitted', 'submitted', 'submitted'), 'week')).toEqual({ error: 'Approve the week once every required day is submitted' });
    expect(approvableDays(week('rejected', 'submitted', 'submitted', 'submitted', 'submitted'), 'week')).toEqual({ error: 'Approve the week once every required day is submitted' });
    expect(approvableDays(week('submitted', 'submitted', 'submitted', 'submitted', 'submitted'), 'week', ['2026-10-05'])).toEqual({ error: 'This workspace approves whole weeks' });
    expect(approvableDays(week('approved', 'approved', 'approved', 'approved', 'approved'), 'week')).toEqual({ error: 'Nothing to approve' });
  });
  it('Day by day: the chosen Submitted days, or all of them; a day no longer Submitted is a conflict', () => {
    const days = week('submitted', 'draft', 'submitted', 'rejected', 'approved');
    expect(approvableDays(days, 'day')).toEqual({ dates: ['2026-10-05', '2026-10-07'] });
    expect(approvableDays(days, 'day', ['2026-10-07'])).toEqual({ dates: ['2026-10-07'] });
    expect(approvableDays(days, 'day', ['2026-10-06'])).toEqual({ error: 'This week changed, please review it again', conflict: true });
    expect(approvableDays(week('draft', 'draft', 'draft', 'draft', 'draft'), 'day')).toEqual({ error: 'Nothing to approve' });
  });
});

describe('returnableDays (spec 5.3 T4)', () => {
  it('returns the chosen Submitted days, or all of them, in either mode', () => {
    const days = week('submitted', 'draft', 'submitted', 'rejected', 'approved');
    expect(returnableDays(days)).toEqual({ dates: ['2026-10-05', '2026-10-07'] });
    expect(returnableDays(days, ['2026-10-05'])).toEqual({ dates: ['2026-10-05'] });
    expect(returnableDays(days, ['2026-10-09'])).toEqual({ error: 'This week changed, please review it again', conflict: true });
    expect(returnableDays(week('approved', 'approved', 'approved', 'approved', 'approved'))).toEqual({ error: 'Nothing to return' });
  });
});
