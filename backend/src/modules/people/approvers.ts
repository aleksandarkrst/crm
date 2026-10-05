import type { Tx } from '../../shared/database/database.service';

/**
 * The approver rule (spec 7.4), used by Timesheet (15), Time off (16) and Travel (17). For a request
 * of employee E for date D:
 *   1. M = E's manager.
 *   2. M exists, is active, has a linked member and is not absent on D → M approves.
 *   3. Otherwise all Admins (workspace owners and admins) except E; any one of them decides.
 *   4. E is the only Admin and step 3 leaves nobody → E approves their own request, marked
 *      "Self-approved (no other Admin)".
 * It is resolved when someone looks or acts, never stored, so pending requests follow a change of
 * manager automatically. `resolveApprovers` is the pure rule (unit-tested with the table of 7.6
 * AC2); PeopleAccess.approversFor loads its input.
 */

export interface ApproverInput {
  employee: { id: string; userId: string | null };
  /** E's manager, or null. `active`: not deactivated. `userId`: their linked member (null: no account). */
  manager: { id: string; active: boolean; userId: string | null } | null;
  /** Whether the manager is on approved time off or sick leave on the date (milestone 16). */
  managerAbsent: boolean;
  /** Every workspace owner and admin, with their employee record when they have one. */
  admins: { userId: string; employeeId: string | null }[];
}

export type ApproverReason = 'manager' | 'no_manager' | 'manager_inactive' | 'manager_no_account' | 'manager_absent';

export interface Approver {
  userId: string;
  employeeId: string | null;
}

export interface ApproverResult {
  /** Who decides: the manager, the Admins, or (rule 4) the requester themselves. */
  kind: 'manager' | 'admins' | 'self';
  /** Why: the manager, or why the manager can't (no manager, inactive, no account, absent). */
  reason: ApproverReason;
  /** Everyone who may decide; any one of them is enough. Empty only if the workspace has no Admin. */
  approvers: Approver[];
  /** Rule 4: the decision is shown as "Self-approved (no other Admin)". */
  selfApproved: boolean;
}

export const SELF_APPROVED_LABEL = 'Self-approved (no other Admin)';

export function resolveApprovers(input: ApproverInput): ApproverResult {
  const m = input.manager;
  const reason: ApproverReason = !m ? 'no_manager' : !m.active ? 'manager_inactive' : !m.userId ? 'manager_no_account' : input.managerAbsent ? 'manager_absent' : 'manager';
  if (reason === 'manager') return { kind: 'manager', reason, approvers: [{ userId: m!.userId!, employeeId: m!.id }], selfApproved: false };

  const others = input.admins.filter((a) => a.userId !== input.employee.userId && a.employeeId !== input.employee.id);
  if (others.length > 0) return { kind: 'admins', reason, approvers: others, selfApproved: false };
  const self = input.admins.find((a) => a.userId === input.employee.userId);
  if (self) return { kind: 'self', reason, approvers: [self], selfApproved: true };
  return { kind: 'admins', reason, approvers: [], selfApproved: false };
}

/**
 * Where the approver rule learns who is absent. Milestone 16 (Time off) provides the real source
 * (approved time off or sick leave covering the date) by overriding the ABSENCE_SOURCE provider;
 * until then nobody is ever absent.
 */
export interface AbsenceSource {
  /** Of `employeeIds`, those absent on `date` (yyyy-mm-dd). Runs in the caller's tenant transaction. */
  absentOn(tx: Tx, tenantId: string, employeeIds: string[], date: string): Promise<Set<string>>;
}

export const ABSENCE_SOURCE = Symbol('ABSENCE_SOURCE');

export const nobodyAbsent: AbsenceSource = {
  absentOn: async () => new Set<string>(),
};
