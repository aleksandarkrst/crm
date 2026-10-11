import type { TimesheetSettings, WeekDay } from './timesheet-rules';

/**
 * The approval rules (CD-157, spec 8.3 and 5.3 T3/T4) as pure functions, unit-tested without a
 * database. Who may act is resolved when they look or act, never stored.
 */

/** The caller as the rule sees them: PeopleAccess.of(ctx) gives all of it. */
export interface ApprovingCaller {
  employeeId: string | null;
  isAdmin: boolean;
}

/** One employee's reporting line as it is now: whether their manager can approve (active, with an account). */
export interface ApprovalTarget {
  employeeId: string;
  managerId: string | null;
  managerActive: boolean;
  managerHasAccount: boolean;
}

/**
 * What the caller is to this employee's week: their approver (the manager; or an Admin when the
 * manager can't, spec 7.4), an Admin overriding a manager who could (decided 9 Oct: allowed and
 * recorded), or nobody (read-only, or their own week: nobody approves themselves).
 */
export type ApprovalRight = 'approver' | 'override' | null;

export function approvalRight(caller: ApprovingCaller, target: ApprovalTarget): ApprovalRight {
  if (!caller.employeeId && !caller.isAdmin) return null;
  if (caller.employeeId === target.employeeId) return null;
  const managerCanAct = !!target.managerId && target.managerActive && target.managerHasAccount;
  if (managerCanAct && caller.employeeId === target.managerId) return 'approver';
  if (caller.isAdmin) return managerCanAct ? 'override' : 'approver';
  return null;
}

export type DayPick = { dates: string[] } | { error: string; conflict?: boolean };

const submittedOf = (days: readonly WeekDay[]) => days.filter((d) => d.status === 'submitted').map((d) => d.date);

/** `dates` must all still be Submitted; otherwise the week changed under the approver (spec 8.2). */
function pick(days: readonly WeekDay[], dates: string[] | undefined, nothing: string): DayPick {
  const submitted = submittedOf(days);
  if (dates && dates.some((d) => !submitted.includes(d))) return { error: 'This week changed, please review it again', conflict: true };
  const chosen = dates ?? submitted;
  return chosen.length ? { dates: chosen } : { error: nothing };
}

/**
 * Which days Approve covers (T3). Whole week mode: the whole week, only once no required day is
 * Draft or Rejected; Day by day: the chosen Submitted days, or all of them.
 */
export function approvableDays(days: readonly WeekDay[], mode: TimesheetSettings['approvalMode'], dates?: string[]): DayPick {
  if (mode === 'week') {
    if (dates) return { error: 'This workspace approves whole weeks' };
    if (days.some((d) => d.required && (d.status === 'draft' || d.status === 'rejected'))) return { error: 'Approve the week once every required day is submitted' };
  }
  return pick(days, dates, 'Nothing to approve');
}

/** Which days Return covers (T4): the chosen Submitted days, or all of them, in either mode. */
export function returnableDays(days: readonly WeekDay[], dates?: string[]): DayPick {
  return pick(days, dates, 'Nothing to return');
}
