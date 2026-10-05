/**
 * Who sees and changes what about an employee (milestone 13, spec 4.5, 9.3–9.5): response shapes per
 * role (Employee, Manager, Administration, Payroll, Admin), personal data and IBANs never reaching
 * anyone else (AC 4.9.3, 9.7.5), the IBAN sealed at rest and masked in history, the reveal audit,
 * the "Bank account changed" email and the limits of editing your own card.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { call, createTenant, eventually, mailTo, ok, type Session, signIn } from './helpers';
import { asTenantSql, DOMESTIC, grantRole, IBAN, IBAN_MASK, joinAsEmployee, START } from './people-helpers';

const PRIVATE_EMAIL = 'emp.private@example.test';

let owner: Session;
let wsAdmin: Session;
let hr: Session;
let pay: Session;
let mgr: Session;
let emp: Session;
let other: Session;
let tenant: string;
const id = {} as Record<'owner' | 'wsAdmin' | 'hr' | 'pay' | 'mgr' | 'emp' | 'other', string>;
const as = (s: Session) => ({ token: s.token, tenant });

/** "Bank account changed" emails to `to`, newest first (the invitation email went there too). */
const bankMails = async (to: string) => (await mailTo(owner, to)).filter((m) => m.subject.startsWith('Your bank account in'));
const waitForBankMail = (to: string, count: number) => eventually(async () => {
  const mails = await bankMails(to);
  return mails.length >= count ? mails[0] : null;
}, `bank account email #${count} to ${to}`);

beforeAll(async () => {
  [owner, wsAdmin, hr, pay, mgr, emp, other] = (await Promise.all(['roles-owner', 'roles-wsadmin', 'roles-hr', 'roles-pay', 'roles-mgr', 'roles-emp', 'roles-other'].map((l) => signIn(l)))) as [
    Session,
    Session,
    Session,
    Session,
    Session,
    Session,
    Session,
  ];
  tenant = await createTenant(owner, 'People roles');
  id.owner = (await ok('GET', '/people/access', as(owner))).employeeId;
  id.wsAdmin = await joinAsEmployee(owner, tenant, wsAdmin, 'admin');
  for (const [key, s] of [['hr', hr], ['pay', pay], ['mgr', mgr], ['emp', emp], ['other', other]] as const) id[key] = await joinAsEmployee(owner, tenant, s);
  await grantRole(tenant, id.hr, 'administration');
  await grantRole(tenant, id.pay, 'payroll');
  // emp reports to mgr; other reports to pay (Payroll + Manager: roles are additive).
  await ok('PATCH', `/people/employees/${id.emp}`, { ...as(owner), body: { managerId: id.mgr, employmentStartDate: START } }, 200);
  await ok('PATCH', `/people/employees/${id.other}`, { ...as(owner), body: { managerId: id.pay } }, 200);
  await ok(
    'PATCH',
    `/people/employees/${id.emp}`,
    {
      ...as(owner),
      body: {
        dateOfBirth: '1990-05-01',
        privateEmail: PRIVATE_EMAIL,
        privatePhone: '+381 64 111 222',
        addressStreet: 'Knez Mihailova 1',
        addressCity: 'Beograd',
        emergencyContactName: 'Mila',
        iban: DOMESTIC,
        bankName: 'AIK Banka',
      },
    },
    200,
  );
});

describe('access', () => {
  it('derives each caller’s roles and scope', async () => {
    expect((await ok('GET', '/people/access', as(owner))).roles).toEqual(['employee', 'admin']);
    expect((await ok('GET', '/people/access', as(wsAdmin))).roles).toEqual(['employee', 'admin']);
    expect((await ok('GET', '/people/access', as(hr))).roles).toEqual(['employee', 'administration']);
    expect((await ok('GET', '/people/access', as(pay))).roles).toEqual(['employee', 'manager', 'payroll']);
    expect((await ok('GET', '/people/access', as(emp))).roles).toEqual(['employee']);
    const m = await ok('GET', '/people/access', as(mgr));
    expect(m).toMatchObject({ employeeId: id.mgr, roles: ['employee', 'manager'], directReportIds: [id.emp], reportIds: [id.emp] });
  });
});

describe('the IBAN at rest, in history and in the email', () => {
  it('is converted from the domestic number and stored sealed: no plain IBAN in the table', async () => {
    const [row] = await asTenantSql<Record<string, unknown>>(tenant, `select * from employee_personal where employee_id = $1`, [id.emp]);
    expect(row).toMatchObject({ iban_last4: '1379', iban_country: 'RS', iban_masked: IBAN_MASK });
    expect(String(row!.iban_sealed)).toMatch(/^v1\./);
    const text = JSON.stringify(row);
    expect(text).not.toContain(IBAN);
    expect(text).not.toContain('260005601001611379');
    expect(text).not.toContain(DOMESTIC);
  });

  it('history records the change masked, never the number', async () => {
    const rows = await asTenantSql<{ field: string; old_value: unknown; new_value: unknown }>(
      tenant,
      `select field, old_value, new_value from record_changes where entity_type = 'employee' and entity_id = $1`,
      [id.emp],
    );
    expect(rows.find((r) => r.field === 'iban')).toMatchObject({ old_value: null, new_value: IBAN_MASK });
    expect(JSON.stringify(rows)).not.toContain('260005601001611379');
    expect(JSON.stringify(rows)).not.toContain('v1.');
  });

  it('emails the employee "Bank account changed" with the masked number and who changed it', async () => {
    const mail = await waitForBankMail(emp.email, 1);
    expect(mail.subject).toMatch(/^Your bank account in People roles .+ was changed$/);
    expect(mail.text).toContain(IBAN_MASK);
    expect(mail.text).toContain('Roles-owner Tester changed the bank account');
    expect(mail.text).not.toContain('260005601001611379');
  });
});

describe('the card per role (sections absent, never empty)', () => {
  const card = (s: Session, who: string) => ok('GET', `/people/employees/${who}`, as(s));

  it('the employee sees their own personal details and bank account, masked', async () => {
    const c = await card(emp, id.emp);
    expect(c.personal).toMatchObject({ dateOfBirth: '1990-05-01', privateEmail: PRIVATE_EMAIL, addressCity: 'Beograd', addressCountry: 'Serbia' });
    expect(c.bank).toMatchObject({ iban: { masked: 'RS35 •••• •••• •••• ••13 79', last4: '1379', country: 'RS', foreign: false }, bankName: 'AIK Banka' });
    expect(c.employment).toMatchObject({ startDate: START, type: 'permanent', weeklyHours: 40 });
    expect(c.employment).not.toHaveProperty('leavingReason');
    expect(c).not.toHaveProperty('appAccess');
    expect(c.manager).toMatchObject({ id: id.mgr, hasAccount: true });
    expect(c.approvals).toMatchObject({ kind: 'manager', reason: 'manager', approvers: [{ employeeId: id.mgr, userId: mgr.userId }] });
    expect(JSON.stringify(c)).not.toContain(IBAN);
  });

  it('their manager sees employment fields, not personal details or the bank account', async () => {
    const c = await card(mgr, id.emp);
    expect(c.employment).toMatchObject({ startDate: START });
    expect(c).not.toHaveProperty('personal');
    expect(c).not.toHaveProperty('bank');
    expect(c).not.toHaveProperty('hr');
    expect(JSON.stringify(c)).not.toContain(PRIVATE_EMAIL);
    expect(JSON.stringify(c)).not.toContain('•');
    expect(c.permissions).toMatchObject({ editableFields: [], canRevealBank: false, canSeeHistory: false });
  });

  it('Payroll sees neither employment fields outside their reports, nor personal details, nor the IBAN (Q2)', async () => {
    const c = await card(pay, id.emp);
    for (const section of ['employment', 'personal', 'bank', 'hr', 'appAccess']) expect(c).not.toHaveProperty(section);
    expect(JSON.stringify(c)).not.toContain(PRIVATE_EMAIL);
    // Payroll + Manager: the Manager part shows their report's employment fields, still no personal data.
    const report = await card(pay, id.other);
    expect(report).toHaveProperty('employment');
    expect(report).not.toHaveProperty('personal');
  });

  it('another employee sees only the directory', async () => {
    const c = await card(other, id.emp);
    for (const section of ['employment', 'personal', 'bank', 'hr', 'appAccess']) expect(c).not.toHaveProperty(section);
    expect(c).toMatchObject({ id: id.emp, workEmail: emp.email, managerId: id.mgr, status: 'active' });
  });

  it('Administration sees everything but app access; Admins (owner or admin) everything', async () => {
    const h = await card(hr, id.emp);
    expect(h).toHaveProperty('personal.privateEmail', PRIVATE_EMAIL);
    expect(h).toHaveProperty('bank.iban.last4', '1379');
    expect(h).toHaveProperty('employment.leavingReason');
    expect(h).toHaveProperty('hr.dataIssues');
    expect(h).not.toHaveProperty('appAccess');
    for (const s of [owner, wsAdmin]) {
      const c = await card(s, id.emp);
      expect(c).toHaveProperty('personal.privateEmail', PRIVATE_EMAIL);
      expect(c.appAccess).toMatchObject({ signInEmail: emp.email, workspaceRole: 'member', invitation: null });
      expect(c.permissions.canDelete).toBe(false);
    }
  });
});

describe('the list per role', () => {
  const list = (s: Session) => ok('GET', '/people/employees', as(s));

  it('never contains personal details or bank accounts, for anyone', async () => {
    for (const s of [owner, hr, pay, mgr, emp, other]) {
      const body = await list(s);
      const text = JSON.stringify(body);
      expect(text).not.toContain(PRIVATE_EMAIL);
      expect(text).not.toContain('•');
      expect(text).not.toContain('Knez Mihailova');
      for (const row of body.employees) {
        expect(row).not.toHaveProperty('personal');
        expect(row).not.toHaveProperty('bank');
      }
      expect(body.total).toBe(7);
    }
  });

  it('has employment fields only for rows in the caller’s scope', async () => {
    const rowOf = async (s: Session, who: string) => (await list(s)).employees.find((r: { id: string }) => r.id === who);
    expect(await rowOf(emp, id.emp)).toHaveProperty('employment');
    expect(await rowOf(emp, id.mgr)).not.toHaveProperty('employment');
    expect(await rowOf(mgr, id.emp)).toHaveProperty('employment');
    expect(await rowOf(mgr, id.other)).not.toHaveProperty('employment');
    expect(await rowOf(pay, id.emp)).not.toHaveProperty('employment');
    expect(await rowOf(hr, id.other)).toHaveProperty('employment');
    // Account state and data issues for HR; roles for Admins.
    expect(await rowOf(hr, id.emp)).toMatchObject({ hr: { account: 'linked' } });
    expect(await rowOf(hr, id.emp)).not.toHaveProperty('roles');
    expect(await rowOf(owner, id.pay)).toMatchObject({ roles: ['employee', 'manager', 'payroll'] });
    expect(await rowOf(emp, id.emp)).not.toHaveProperty('hr');
  });

  it('inactive employees: hidden from everyone but HR; filtering on them is HR only', async () => {
    const gone = await ok('POST', '/people/employees', { ...as(owner), body: { firstName: 'Gone', lastName: 'Away', employmentStartDate: START } });
    await asTenantSql(tenant, `update employees set employment_end_date = '2026-01-31', deactivated_at = now() where id = $1`, [gone.id]);
    expect((await call('GET', `/people/employees/${gone.id}`, as(emp))).status).toBe(404);
    expect((await call('GET', '/people/employees?status=inactive', as(emp))).status).toBe(403);
    expect((await ok('GET', `/people/employees/${gone.id}`, as(hr))).status).toBe('inactive');
    const inactive = await ok('GET', '/people/employees?status=inactive', as(hr));
    expect(inactive.employees.map((e: { id: string }) => e.id)).toEqual([gone.id]);
    expect((await list(emp)).employees.some((e: { id: string }) => e.id === gone.id)).toBe(false);
  });
});

describe('revealing the IBAN', () => {
  it('returns the full number to the employee, Administration and Admins, audited', async () => {
    for (const s of [emp, hr, owner]) {
      const r = await ok('POST', `/people/employees/${id.emp}/bank/reveal`, { ...as(s), body: { account: 'iban' } }, 200);
      expect(r).toEqual({ account: 'iban', iban: IBAN, formatted: 'RS35 2600 0560 1001 6113 79', domestic: DOMESTIC, foreign: false });
    }
    const [audit] = await asTenantSql<{ n: number }>(tenant, `select count(*)::int as n from audit_logs where action = 'employee.iban_viewed' and entity_id = $1`, [id.emp]);
    expect(audit!.n).toBe(3);
  });

  it('is refused to managers, Payroll and other employees', async () => {
    for (const s of [mgr, pay, other]) {
      const r = await call('POST', `/people/employees/${id.emp}/bank/reveal`, { ...as(s), body: {} });
      expect(r.status).toBe(403);
      expect(JSON.stringify(r.body)).not.toContain('2600');
    }
  });
});

describe('history', () => {
  it('the employee reads their own, with personal and masked IBAN rows, without the reason for leaving', async () => {
    await asTenantSql(tenant, `update employees set leaving_reason = 'resigned' where id = $1`, [id.emp]);
    const mine = await ok('GET', `/people/history?entityType=employee&entityId=${id.emp}`, as(emp));
    const fields = mine.entries.map((e: { field: string | null }) => e.field);
    expect(fields).toContain('privateEmail');
    expect(fields).toContain('managerId');
    expect(fields).not.toContain('leavingReason');
    expect(mine.entries.find((e: { field: string }) => e.field === 'iban')).toMatchObject({ newValue: IBAN_MASK });
    expect(mine.entries.find((e: { field: string }) => e.field === 'managerId')).toMatchObject({ newLabel: 'Roles-mgr Tester' });

    const theirs = await ok('GET', `/people/history?entityType=employee&entityId=${id.emp}`, as(hr));
    expect(theirs.entries.map((e: { field: string | null }) => e.field)).toContain('leavingReason');
    await asTenantSql(tenant, `update employees set leaving_reason = null where id = $1`, [id.emp]);
  });

  it('is refused to managers, Payroll and colleagues; the CRM history endpoint never serves it', async () => {
    for (const s of [mgr, pay, other]) expect((await call('GET', `/people/history?entityType=employee&entityId=${id.emp}`, as(s))).status).toBe(403);
    expect((await call('GET', `/crm/history?entityType=employee&entityId=${id.emp}`, as(owner))).status).toBe(400);
  });
});

describe('editing your own card (spec 4.5)', () => {
  const patch = (s: Session, who: string, body: unknown) => call('PATCH', `/people/employees/${who}`, { ...as(s), body });

  it('an employee changes their work phone, personal details and bank account, nothing else', async () => {
    expect((await patch(emp, id.emp, { workPhone: '+381 11 222' })).status).toBe(200);
    expect((await patch(emp, id.emp, { privatePhone: '+381 64 999', addressCity: 'Novi Sad' })).status).toBe(200);
    for (const body of [{ jobTitle: 'Boss' }, { managerId: null }, { departmentId: null }, { employmentType: 'contractor' }, { weeklyHours: 20 }, { firstName: 'X' }]) {
      const r = await patch(emp, id.emp, body);
      expect(r.status, JSON.stringify(body)).toBe(403);
    }
    const c = await ok('GET', `/people/employees/${id.emp}`, as(emp));
    expect(c.permissions.editableFields).toContain('iban');
    expect(c.permissions.editableFields).not.toContain('jobTitle');
  });

  it("nobody edits someone else's card without an HR role; managers neither", async () => {
    expect((await patch(emp, id.other, { workPhone: '1' })).status).toBe(403);
    expect((await patch(mgr, id.emp, { workPhone: '1' })).status).toBe(403);
    expect((await patch(pay, id.other, { workPhone: '1' })).status).toBe(403);
  });

  it('Administration edits others, not their own employment fields, department, team or manager', async () => {
    expect((await patch(hr, id.emp, { jobTitle: 'Technician', weeklyHours: 32 })).status).toBe(200);
    expect((await patch(hr, id.hr, { managerId: id.mgr })).status).toBe(403);
    expect((await patch(hr, id.hr, { weeklyHours: 30 })).status).toBe(403);
    expect((await patch(hr, id.hr, { jobTitle: 'HR lead' })).status).toBe(200);
    // Nobody but an Admin makes themselves someone's manager.
    const self = await patch(hr, id.other, { managerId: id.hr });
    expect(self.status).toBe(403);
    expect(self.body.message).toBe("Only an Admin can make themselves someone's manager");
    // An Admin changes their own card freely.
    expect((await patch(owner, id.owner, { jobTitle: 'CEO', weeklyHours: 45 })).status).toBe(200);
  });

  it('the bank account only while the workspace allows it; Administration always', async () => {
    await ok('PATCH', '/workspace', { ...as(owner), body: { employeeSelfEditBank: false } }, 200);
    try {
      const r = await patch(emp, id.emp, { iban: 'DE89370400440532013000' });
      expect(r.status).toBe(403);
      expect(r.body.message).toBe('In this workspace, only Administration and Admins change bank accounts');
      expect((await patch(hr, id.hr, { iban: IBAN })).status).toBe(200);
    } finally {
      await ok('PATCH', '/workspace', { ...as(owner), body: { employeeSelfEditBank: true } }, 200);
    }
    const before = (await bankMails(emp.email)).length;
    const r = await patch(emp, id.emp, { iban: 'DE89 3704 0044 0532 0130 00' });
    expect(r.status).toBe(200);
    expect(r.body.bank.iban).toMatchObject({ country: 'DE', foreign: true, last4: '3000' });
    const mail = await waitForBankMail(emp.email, before + 1);
    expect(mail.text).toContain('You changed the bank account');
    expect(mail.text).toContain('DE89 •••• 3000');
  });

  it('refuses an invalid IBAN with the spec message', async () => {
    const r = await patch(emp, id.emp, { iban: 'RS35260005601001611378' });
    expect(r.status).toBe(400);
    expect(r.body.issues).toEqual([{ path: 'iban', message: 'This is not a valid IBAN or Serbian account number' }]);
  });
});
