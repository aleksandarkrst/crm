/**
 * The Org structure list's bulk actions and personal-details export (CD-137, spec 5.4, 9.3, 9.5):
 * who may use them, department and team together, the reporting-line rules (no loops, all or
 * nothing), Administration's own row, and the audit entry of every personal-details export.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { call, createTenant, ok, type Session, signIn } from './helpers';
import { asTenantSql, createDepartment, createTeam, grantRole, IBAN, joinAsEmployee, START } from './people-helpers';

let owner: Session;
let hr: Session;
let pay: Session;
let mgr: Session;
let emp: Session;
let tenant: string;
const id = {} as Record<'owner' | 'hr' | 'pay' | 'mgr' | 'emp', string>;
const as = (s: Session = owner) => ({ token: s.token, tenant });
const create = async (firstName: string, lastName: string, extra: Record<string, unknown> = {}) =>
  (await ok('POST', '/people/employees', { ...as(), body: { firstName, lastName, employmentStartDate: START, ...extra } })).id as string;
const bulk = (s: Session, body: Record<string, unknown>) => call('POST', '/people/employees/bulk', { ...as(s), body });
const card = (who: string) => ok('GET', `/people/employees/${who}`, as());

let sales: string;
let support: string;
let north: string;
let south: string;
let helpdesk: string;

beforeAll(async () => {
  [owner, hr, pay, mgr, emp] = (await Promise.all(['bulk-owner', 'bulk-hr', 'bulk-pay', 'bulk-mgr', 'bulk-emp'].map((l) => signIn(l)))) as [Session, Session, Session, Session, Session];
  tenant = await createTenant(owner, 'People bulk');
  id.owner = (await ok('GET', '/people/access', as(owner))).employeeId;
  for (const [key, s] of [['hr', hr], ['pay', pay], ['mgr', mgr], ['emp', emp]] as const) id[key] = await joinAsEmployee(owner, tenant, s);
  await grantRole(tenant, id.hr, 'administration');
  await grantRole(tenant, id.pay, 'payroll');
  await ok('PATCH', `/people/employees/${id.emp}`, { ...as(), body: { managerId: id.mgr } });
  sales = await createDepartment(tenant, 'Sales');
  support = await createDepartment(tenant, 'Support');
  north = await createTeam(tenant, sales, 'North');
  south = await createTeam(tenant, sales, 'South');
  helpdesk = await createTeam(tenant, support, 'Helpdesk');
});

describe('who may use the bulk actions and the export', () => {
  it('refuses Employee, Manager and Payroll; allows Administration and Admin', async () => {
    const target = await create('Bulk', 'Target');
    for (const s of [emp, mgr, pay]) {
      expect((await bulk(s, { employeeIds: [target], departmentId: sales })).status).toBe(403);
      expect((await call('POST', '/people/employees/export', { ...as(s), body: { employeeIds: [target] } })).status).toBe(403);
    }
    expect((await card(target)).departmentId).toBeNull();
    expect((await bulk(hr, { employeeIds: [target], departmentId: sales })).body).toEqual({ updated: 1 });
    expect((await bulk(owner, { employeeIds: [target], departmentId: support })).body).toEqual({ updated: 1 });
    expect((await card(target)).departmentName).toBe('Support');
  });

  it('validates the request', async () => {
    const target = await create('Bulk', 'Valid');
    expect((await bulk(owner, { employeeIds: [], departmentId: sales })).status).toBe(400);
    expect((await bulk(owner, { employeeIds: [target] })).status).toBe(400);
    expect((await bulk(owner, { employeeIds: ['not-a-uuid'], departmentId: sales })).status).toBe(400);
    // An id of no employee here (another workspace's, or made up): nothing is changed.
    const res = await bulk(owner, { employeeIds: [target, '00000000-0000-4000-8000-000000000000'], departmentId: sales });
    expect(res.status).toBe(400);
    expect((await card(target)).departmentId).toBeNull();
  });
});

describe('Set department and team', () => {
  it('a team brings its department; a department alone clears the team; null is No department', async () => {
    const a = await create('Ana', 'Org');
    const b = await create('Bora', 'Org', { departmentId: support, teamId: helpdesk });
    expect((await bulk(hr, { employeeIds: [a, b], teamId: north })).body).toEqual({ updated: 2 });
    for (const who of [a, b]) expect(await card(who)).toMatchObject({ departmentId: sales, teamId: north, teamName: 'North' });
    // Same values again: nothing changes.
    expect((await bulk(hr, { employeeIds: [a, b], departmentId: sales, teamId: north })).body).toEqual({ updated: 0 });
    expect((await bulk(hr, { employeeIds: [a], departmentId: sales })).body).toEqual({ updated: 1 });
    expect(await card(a)).toMatchObject({ departmentId: sales, teamId: null });
    expect((await bulk(hr, { employeeIds: [a, b], departmentId: null, teamId: null })).body).toEqual({ updated: 2 });
    expect(await card(b)).toMatchObject({ departmentId: null, teamId: null });
  });

  it('refuses a team of another department and a missing team', async () => {
    const a = await create('Cira', 'Org');
    expect((await bulk(hr, { employeeIds: [a], departmentId: support, teamId: south })).status).toBe(400);
    expect((await bulk(hr, { employeeIds: [a], teamId: '00000000-0000-4000-8000-000000000000' })).status).toBe(400);
    expect((await card(a)).departmentId).toBeNull();
  });

  it('records the change in each employee’s history and one audit entry', async () => {
    const a = await create('Dara', 'History');
    await bulk(owner, { employeeIds: [a], teamId: south });
    const { entries } = await ok('GET', `/people/history?entityType=employee&entityId=${a}`, as());
    expect(entries.map((e: { field: string | null }) => e.field)).toEqual(expect.arrayContaining(['departmentId', 'teamId']));
    const [audit] = await asTenantSql<{ n: number }>(tenant, `select count(*)::int as n from audit_logs where action = 'employee.bulk_updated'`);
    expect(audit!.n).toBeGreaterThan(0);
  });

  it("Administration can't include their own row; an Admin can", async () => {
    const a = await create('Ema', 'Own');
    const res = await bulk(hr, { employeeIds: [a, id.hr], departmentId: sales });
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/own card/);
    expect((await card(a)).departmentId).toBeNull();
    expect((await bulk(owner, { employeeIds: [a, id.owner], departmentId: sales })).body).toEqual({ updated: 2 });
  });
});

describe('Set manager', () => {
  // ceo → vp → lead → dev (four levels); x and y report to nobody.
  const t = {} as Record<'ceo' | 'vp' | 'lead' | 'dev' | 'x' | 'y', string>;
  beforeAll(async () => {
    t.ceo = await create('Ceo', 'Tree');
    t.vp = await create('Vp', 'Tree', { managerId: t.ceo });
    t.lead = await create('Lead', 'Tree', { managerId: t.vp });
    t.dev = await create('Dev', 'Tree', { managerId: t.lead });
    t.x = await create('Xena', 'Tree');
    t.y = await create('Yan', 'Tree');
  });

  it('sets the manager of every selected employee', async () => {
    expect((await bulk(hr, { employeeIds: [t.x, t.y], managerId: t.lead })).body).toEqual({ updated: 2 });
    expect((await card(t.x)).managerId).toBe(t.lead);
    const { employees } = await ok('GET', `/people/employees?managerId=${t.ceo}&managerScope=indirect`, as());
    expect(employees.map((e: { id: string }) => e.id).sort()).toEqual([t.vp, t.lead, t.dev, t.x, t.y].sort());
    expect((await bulk(hr, { employeeIds: [t.x, t.y], managerId: null })).body).toEqual({ updated: 2 });
    expect((await card(t.y)).managerId).toBeNull();
  });

  it('refuses a loop anywhere in the selection and changes nobody', async () => {
    // x is fine, but the ceo under the dev closes ceo → vp → lead → dev → ceo.
    const res = await bulk(owner, { employeeIds: [t.x, t.ceo], managerId: t.dev });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'reporting_loop' });
    expect(res.body.message).toBe('This would create a loop: Ceo Tree → Dev Tree → Lead Tree → Vp Tree → Ceo Tree');
    expect((await card(t.x)).managerId).toBeNull();
    expect((await card(t.ceo)).managerId).toBeNull();
    // The middle of the chain too.
    expect((await bulk(owner, { employeeIds: [t.vp], managerId: t.dev })).status).toBe(409);
  });

  it('refuses reporting to yourself and an inactive manager', async () => {
    expect((await bulk(owner, { employeeIds: [t.x, t.y], managerId: t.y })).status).toBe(400);
    const gone = await create('Gone', 'Tree');
    await asTenantSql(tenant, `update employees set deactivated_at = now() where id = $1`, [gone]);
    expect((await bulk(owner, { employeeIds: [t.x], managerId: gone })).status).toBe(400);
    // An inactive employee can't be changed in bulk either.
    expect((await bulk(owner, { employeeIds: [gone], departmentId: sales })).status).toBe(400);
  });

  it("only an Admin makes themselves someone's manager", async () => {
    expect((await bulk(hr, { employeeIds: [t.x], managerId: id.hr })).status).toBe(403);
    expect((await bulk(owner, { employeeIds: [t.x], managerId: id.owner })).body).toEqual({ updated: 1 });
  });
});

describe('Export with personal details and bank accounts', () => {
  it('returns them to Administration and Admin, each export audited with its row count', async () => {
    const a = await create('Iva', 'Export', { privateEmail: 'iva.private@example.test', addressCity: 'Novi Sad', iban: IBAN, bankName: 'AIK Banka' });
    const b = await create('Jan', 'Export');
    const before = await asTenantSql<{ n: number }>(tenant, `select count(*)::int as n from audit_logs where action = 'employee.personal_exported'`);
    const out = await ok('POST', '/people/employees/export', { ...as(hr), body: { employeeIds: [a, b] } }, 200);
    const byId = new Map(out.employees.map((e: { id: string }) => [e.id, e]));
    expect(byId.get(a)).toMatchObject({
      personal: { privateEmail: 'iva.private@example.test', addressCity: 'Novi Sad' },
      bank: { iban: 'RS35 2600 0560 1001 6113 79', bankName: 'AIK Banka', fxSameAsIban: true },
    });
    expect(byId.get(b)).toMatchObject({ personal: { privateEmail: null }, bank: { iban: null } });
    await ok('POST', '/people/employees/export', { ...as(owner), body: { employeeIds: [a] } }, 200);
    const rows = await asTenantSql<{ actor: string; data: { count: number } }>(
      tenant,
      `select actor_user_id::text as actor, data from audit_logs where action = 'employee.personal_exported' order by created_at desc limit 2`,
    );
    expect(rows.length).toBe(2);
    expect(rows[0]).toMatchObject({ actor: owner.userId, data: { count: 1 } });
    expect(rows[1]).toMatchObject({ actor: hr.userId, data: { count: 2 } });
    const after = await asTenantSql<{ n: number }>(tenant, `select count(*)::int as n from audit_logs where action = 'employee.personal_exported'`);
    expect(after[0]!.n - before[0]!.n).toBe(2);
  });

  it('the directory list never carries personal details or bank accounts', async () => {
    const { employees } = await ok('GET', '/people/employees', as());
    for (const e of employees) {
      expect(e).not.toHaveProperty('personal');
      expect(e).not.toHaveProperty('bank');
    }
  });
});
