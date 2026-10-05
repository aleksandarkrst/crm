import { describe, expect, it } from 'vitest';
import { type ApproverInput, resolveApprovers } from '../src/modules/people/approvers';
import { type AccessData, CallerAccess } from '../src/modules/people/caller-access';
import { BANK_FIELDS, canSeeHistoryField, EDITABLE_FIELDS, editableFields, PERSONAL_FIELDS } from '../src/modules/people/field-rules';
import { loopMessage } from '../src/modules/people/reporting-lines';

const caller = (over: Partial<AccessData> = {}) =>
  new CallerAccess({ tenantId: 't', userId: 'u-me', workspaceRole: 'member', employeeId: 'me', assignedRoles: [], directReportIds: [], reportIds: [], ...over });

describe('approver rule (spec 7.4, table of 7.6 AC2)', () => {
  const admins = [
    { userId: 'u-ceo', employeeId: 'ceo' },
    { userId: 'u-cfo', employeeId: 'cfo' },
  ];
  const base: ApproverInput = {
    employee: { id: 'e', userId: 'u-e' },
    manager: { id: 'm', active: true, userId: 'u-m' },
    managerAbsent: false,
    admins,
  };

  it.each([
    ['manager present', base, { kind: 'manager', reason: 'manager', approvers: [{ userId: 'u-m', employeeId: 'm' }], selfApproved: false }],
    ['no manager', { ...base, manager: null }, { kind: 'admins', reason: 'no_manager', approvers: admins, selfApproved: false }],
    ['manager inactive', { ...base, manager: { id: 'm', active: false, userId: 'u-m' } }, { kind: 'admins', reason: 'manager_inactive', approvers: admins, selfApproved: false }],
    ['manager without account', { ...base, manager: { id: 'm', active: true, userId: null } }, { kind: 'admins', reason: 'manager_no_account', approvers: admins, selfApproved: false }],
    ['manager absent (stubbed absence source)', { ...base, managerAbsent: true }, { kind: 'admins', reason: 'manager_absent', approvers: admins, selfApproved: false }],
    [
      'requester is the only Admin, at the top',
      { employee: { id: 'ceo', userId: 'u-ceo' }, manager: null, managerAbsent: false, admins: [admins[0]!] },
      { kind: 'self', reason: 'no_manager', approvers: [admins[0]], selfApproved: true },
    ],
    [
      'requester is an Admin and another Admin exists: the other one',
      { employee: { id: 'ceo', userId: 'u-ceo' }, manager: null, managerAbsent: false, admins },
      { kind: 'admins', reason: 'no_manager', approvers: [admins[1]], selfApproved: false },
    ],
    [
      'requester is a manager whose own manager is absent: Admins, never themselves',
      { employee: { id: 'm', userId: 'u-m' }, manager: { id: 'd', active: true, userId: 'u-d' }, managerAbsent: true, admins },
      { kind: 'admins', reason: 'manager_absent', approvers: admins, selfApproved: false },
    ],
  ])('%s', (_name, input, expected) => {
    expect(resolveApprovers(input as ApproverInput)).toEqual(expected);
  });

  it('a manager never approves their own request', () => {
    // Their requests go to their own manager.
    const r = resolveApprovers({ employee: { id: 'm', userId: 'u-m' }, manager: { id: 'd', active: true, userId: 'u-d' }, managerAbsent: false, admins });
    expect(r.approvers.map((a) => a.userId)).toEqual(['u-d']);
  });
});

describe('caller access (spec 9.1–9.5)', () => {
  it('derives roles: Employee, Manager from active reports, assigned roles, Admin from the workspace role', () => {
    expect([...caller().roles]).toEqual(['employee']);
    expect([...caller({ directReportIds: ['a'], reportIds: ['a', 'b'] }).roles]).toEqual(['employee', 'manager']);
    expect(caller({ assignedRoles: ['payroll', 'administration'] }).isHr).toBe(true);
    expect(caller({ assignedRoles: ['payroll'] }).isHr).toBe(false);
    expect(caller({ workspaceRole: 'owner' }).isAdmin).toBe(true);
    expect(caller({ workspaceRole: 'admin' }).isAdmin).toBe(true);
    // Roles are additive.
    expect([...caller({ workspaceRole: 'admin', assignedRoles: ['payroll'], directReportIds: ['a'] }).roles].sort()).toEqual(['admin', 'employee', 'manager', 'payroll']);
  });

  it('employment fields: self, managers of the subtree at any depth, HR; not Payroll', () => {
    const manager = caller({ directReportIds: ['a'], reportIds: ['a', 'b', 'c'] });
    expect(manager.canSeeEmployment('me')).toBe(true);
    expect(manager.canSeeEmployment('a')).toBe(true);
    expect(manager.canSeeEmployment('c')).toBe(true);
    expect(manager.canSeeEmployment('x')).toBe(false);
    expect(manager.isDirectReport('a')).toBe(true);
    expect(manager.isDirectReport('c')).toBe(false);
    expect(caller({ assignedRoles: ['payroll'] }).canSeeEmployment('x')).toBe(false);
    expect(caller({ assignedRoles: ['administration'] }).canSeeEmployment('x')).toBe(true);
  });

  it('personal details and bank: self, Administration, Admin; never managers or Payroll', () => {
    const manager = caller({ directReportIds: ['a'], reportIds: ['a'] });
    expect(manager.canSeePersonal('a')).toBe(false);
    expect(manager.canSeeBank('a')).toBe(false);
    expect(manager.canSeePersonal('me')).toBe(true);
    expect(caller({ assignedRoles: ['payroll'] }).canSeeBank('x')).toBe(false);
    expect(caller({ assignedRoles: ['administration'] }).canSeeBank('x')).toBe(true);
    expect(caller({ workspaceRole: 'admin' }).canSeePersonal('x')).toBe(true);
  });

  it('history: self without the reason for leaving; HR everything', () => {
    const me = caller();
    expect(me.canSeeHistory('me')).toBe(true);
    expect(me.canSeeHistory('x')).toBe(false);
    expect(canSeeHistoryField(me, 'me', 'leavingReason')).toBe(false);
    expect(canSeeHistoryField(me, 'me', 'iban')).toBe(true);
    expect(canSeeHistoryField(caller({ assignedRoles: ['administration'] }), 'x', 'leavingReason')).toBe(true);
    expect(canSeeHistoryField(caller({ directReportIds: ['a'], reportIds: ['a'] }), 'a', 'dateOfBirth')).toBe(false);
  });
});

describe('who may change which field (spec 4.5, 9.3)', () => {
  it('an employee changes only their work phone, personal details and (if allowed) bank account', () => {
    expect(editableFields(caller(), 'me', true).sort()).toEqual(['workPhone', ...PERSONAL_FIELDS, ...BANK_FIELDS].sort());
    expect(editableFields(caller(), 'me', false).sort()).toEqual(['workPhone', ...PERSONAL_FIELDS].sort());
    expect(editableFields(caller(), 'x', true)).toEqual([]);
    // A manager edits nothing on their reports' cards.
    expect(editableFields(caller({ directReportIds: ['a'], reportIds: ['a'] }), 'a', true)).toEqual([]);
    expect(editableFields(caller({ assignedRoles: ['payroll'] }), 'x', true)).toEqual([]);
  });

  it('Administration edits everything except their own employment fields, department, team and manager', () => {
    const hr = caller({ assignedRoles: ['administration'] });
    expect(editableFields(hr, 'x', false).sort()).toEqual([...EDITABLE_FIELDS].sort());
    const own = editableFields(hr, 'me', false);
    for (const f of ['managerId', 'departmentId', 'teamId', 'employmentStartDate', 'weeklyHours', 'employeeNumber']) expect(own).not.toContain(f);
    // Their own bank account even when employees may not edit theirs.
    expect(own).toContain('iban');
    expect(own).toContain('jobTitle');
  });

  it('an Admin edits everything, their own card included', () => {
    expect(editableFields(caller({ workspaceRole: 'owner' }), 'me', false).sort()).toEqual([...EDITABLE_FIELDS].sort());
  });
});

describe('reporting loops', () => {
  it('names the loop', () => {
    expect(loopMessage(['Ana', 'Marko', 'Ivan', 'Ana'])).toBe('This would create a loop: Ana → Marko → Ivan → Ana');
  });
});
