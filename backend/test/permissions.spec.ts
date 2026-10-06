import { describe, expect, it } from 'vitest';
import { VisitScope } from '../src/modules/crm/visit-plans/visit-scope';
import { type AccessData, CallerAccess, FUNCTIONAL_ROLES } from '../src/modules/people/caller-access';
import { allows, PERMISSION_MODULES, permissionMatrix, permissionRow, relationsFor } from '../src/modules/people/permissions';
import { roleChangedEmail } from '../src/modules/people/role-email';

const caller = (over: Partial<AccessData> = {}) =>
  new CallerAccess({ tenantId: 't', userId: 'u-me', workspaceRole: 'member', employeeId: 'me', assignedRoles: [], directReportIds: [], reportIds: [], ...over });

describe('the permission matrix (spec 9.3) as data', () => {
  it('has a cell for every role in every row, and unique row ids', () => {
    const ids = PERMISSION_MODULES.flatMap((m) => m.rows.map((r) => r.id));
    expect(new Set(ids).size).toBe(ids.length);
    for (const row of PERMISSION_MODULES.flatMap((m) => m.rows)) {
      for (const role of FUNCTIONAL_ROLES) expect(row.cells[role]?.label, `${row.id} ${role}`).toBeTruthy();
    }
  });

  it('marks the modules that are live now and the later ones', () => {
    expect(PERMISSION_MODULES.filter((m) => m.live).map((m) => m.id)).toEqual(['crm', 'org', 'settings']);
    expect(PERMISSION_MODULES.filter((m) => !m.live).map((m) => m.milestone)).toEqual([14, 15, 16, 17, 19, 21]);
    expect(permissionMatrix().roles.map((r) => r.id)).toEqual([...FUNCTIONAL_ROLES]);
  });

  it('reads the spec’s cells', () => {
    expect(permissionRow('crm.visit_plans.manage').cells.manager).toEqual({ scope: 'direct', label: 'Direct' });
    expect(permissionRow('org.bank').cells.payroll).toEqual({ scope: 'none', label: 'No' });
    // Open spec questions stay out of the product text (CD-224, B16).
    for (const m of PERMISSION_MODULES) for (const r of m.rows) for (const c of Object.values(r.cells)) expect(c.label, r.id).not.toMatch(/\(Q\d+\)/);
    expect(permissionRow('org.edit_own_bank').cells.employee).toEqual({ scope: 'own', label: 'If setting on' });
    expect(permissionRow('org.directory').cells.administration.label).toBe('All, incl. inactive');
    expect(() => permissionRow('nope')).toThrow();
  });

  it('roles add up, and Employee always counts', () => {
    // Manager: Direct; Employee: No. A manager doesn't manage their own plan.
    expect([...relationsFor('crm.visit_plans.manage', ['manager'])]).toEqual(['direct']);
    // Manager: Indirect; Employee: Own.
    expect(relationsFor('org.employment', ['manager'])).toEqual(new Set(['self', 'direct', 'indirect']));
    // Payroll alone: own only; with Manager: also the reports.
    expect(relationsFor('org.employment', ['payroll'])).toEqual(new Set(['self']));
    expect(relationsFor('org.employment', ['manager', 'payroll'])).toEqual(new Set(['self', 'direct', 'indirect']));
    expect(allows('org.bank', ['manager', 'payroll'], 'direct')).toBe(false);
    expect(allows('org.roles', ['administration', 'payroll', 'manager'])).toBe(false);
    expect(allows('org.roles', ['admin'])).toBe(true);
    expect(allows('crm.visit_plans.see', ['payroll'], 'other')).toBe(false);
    expect(allows('crm.visit_plans.see', ['payroll'], 'self')).toBe(true);
  });
});

describe('CallerAccess.relationTo', () => {
  const me = caller({ directReportIds: ['d'], reportIds: ['d', 'i'], directReportUserIds: ['u-d'], reportUserIds: ['u-d', 'u-i'] });
  it.each([
    ['me', 'self'],
    ['d', 'direct'],
    ['i', 'indirect'],
    ['x', 'other'],
  ])('employee %s is %s', (id, rel) => expect(me.relationTo(id)).toBe(rel));
  it.each([
    ['u-me', 'self'],
    ['u-d', 'direct'],
    ['u-i', 'indirect'],
    ['u-x', 'other'],
  ])('member %s is %s', (id, rel) => expect(me.relationToUser(id)).toBe(rel));
});

describe('whose visit plans (VisitScope, spec 9.3)', () => {
  it('an employee sees their own, manages none', () => {
    const s = new VisitScope(caller());
    expect([s.all, s.manageAll, s.seesTeam, s.canCreate]).toEqual([false, false, false, false]);
    expect([...s.visible]).toEqual(['u-me']);
    expect(s.canSee('u-x')).toBe(false);
  });

  it('a manager sees their reports at any depth and manages their direct reports only', () => {
    const s = new VisitScope(caller({ directReportIds: ['d'], reportIds: ['d', 'i'], directReportUserIds: ['u-d'], reportUserIds: ['u-d', 'u-i'] }));
    expect(s.visible).toEqual(new Set(['u-me', 'u-d', 'u-i']));
    expect(s.manageable).toEqual(new Set(['u-d']));
    expect([s.seesTeam, s.canCreate, s.canManage('u-me'), s.canManage('u-i'), s.canSee('u-x')]).toEqual([true, true, false, false, false]);
  });

  it('Administration and Payroll get nothing beyond their own; Admins everything', () => {
    for (const role of ['administration', 'payroll'] as const) {
      const s = new VisitScope(caller({ assignedRoles: [role] }));
      expect([s.all, s.seesTeam, s.canCreate]).toEqual([false, false, false]);
    }
    const admin = new VisitScope(caller({ workspaceRole: 'admin' }));
    expect([admin.all, admin.manageAll, admin.canManage('u-me'), admin.filter]).toEqual([true, true, true, undefined]);
    expect(admin.toJSON()).toMatchObject({ visibleUserIds: null, manageableUserIds: null });
  });
});

describe('"Role granted" / "Role removed" email (spec 10.2)', () => {
  const base = { to: 'ana@example.test', employeeName: 'Ana Petrović', roleLabel: 'Administration', actorName: 'Marko Ilić', workspaceName: 'Acme', appUrl: 'https://app.example.test/' };
  it('says who gave which role, with a link to the roles', () => {
    const m = roleChangedEmail({ ...base, kind: 'granted' });
    expect(m.subject).toBe('You now have the Administration role in Acme');
    expect(m.text).toContain('Hi Ana,');
    expect(m.text).toContain('Marko Ilić gave you the Administration role in Acme.');
    expect(m.text).toContain('https://app.example.test/settings/roles');
    expect(m.html).toContain('Marko Ilić gave you the Administration role');
  });
  it('and who removed it', () => {
    const m = roleChangedEmail({ ...base, roleLabel: 'Payroll', kind: 'removed', actorName: null });
    expect(m.subject).toBe('Your Payroll role in Acme was removed');
    expect(m.text).toContain('An Admin removed your Payroll role in Acme.');
  });
});
