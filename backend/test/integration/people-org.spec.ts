/**
 * The org structure's rules (milestone 13): workspace isolation of every new table, reporting loops
 * (also under concurrent requests), uniqueness, team-in-department, filters on a four-level tree,
 * accent-free search, If-Match conflicts, the approver rule, delete and the Employees settings.
 */
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { call, createTenant, ok, type Session, signIn } from './helpers';
import { accessOf, asTenantSql, createDepartment, createTeam, grantRole, IBAN, joinAsEmployee, START } from './people-helpers';

let owner: Session;
let member: Session;
let tenant: string;
const as = (s: Session = owner) => ({ token: s.token, tenant });
const create = async (body: Record<string, unknown>) => (await ok('POST', '/people/employees', { ...as(), body: { employmentStartDate: START, ...body } })).id as string;
const setManager = (who: string, managerId: string | null) => call('PATCH', `/people/employees/${who}`, { ...as(), body: { managerId } });

beforeAll(async () => {
  [owner, member] = (await Promise.all([signIn('org-owner'), signIn('org-member')])) as [Session, Session];
  tenant = await createTenant(owner, 'Org rules');
  await joinAsEmployee(owner, tenant, member);
});

describe('workspace isolation of the people tables', () => {
  let other: Session;
  let otherTenant: string;
  const a = {} as { employee: string; department: string; team: string };

  beforeAll(async () => {
    other = await signIn('org-other');
    otherTenant = await createTenant(other, 'Org other');
    a.department = await createDepartment(tenant, 'Isolated dept');
    a.team = await createTeam(tenant, a.department, 'Isolated team');
    a.employee = await create({ firstName: 'Secret', lastName: 'Person', departmentId: a.department, teamId: a.team, privateEmail: 'secret@example.test', iban: IBAN });
    await grantRole(tenant, a.employee, 'payroll');
  });

  it("the API: another workspace's owner finds nothing", async () => {
    const asB = { token: other.token, tenant: otherTenant };
    expect((await call('GET', `/people/employees/${a.employee}`, asB)).status).toBe(404);
    expect((await call('PATCH', `/people/employees/${a.employee}`, { ...asB, body: { jobTitle: 'x' } })).status).toBe(404);
    expect((await call('POST', `/people/employees/${a.employee}/bank/reveal`, { ...asB, body: {} })).status).toBe(404);
    expect((await call('DELETE', `/people/employees/${a.employee}`, asB)).status).toBe(404);
    const { employees } = await ok('GET', '/people/employees', asB);
    expect(employees.map((e: { firstName: string }) => e.firstName)).toEqual(['Org-other']);
    expect(await ok('GET', '/people/departments', asB)).toEqual([]);
    expect(await ok('GET', '/people/teams', asB)).toEqual([]);
    expect(await ok('GET', `/people/history?entityType=employee&entityId=${a.employee}`, asB)).toEqual({ entries: [], more: false });
    // A non-member can't use the workspace's id at all.
    expect((await call('GET', '/people/employees', { token: other.token, tenant })).status).toBe(403);
    // Ids of the other workspace can't be referenced.
    const own = (await accessOf(other, otherTenant)).employeeId;
    const refs = await call('PATCH', `/people/employees/${own}`, { ...asB, body: { departmentId: a.department } });
    expect(refs.status).toBe(400);
    expect((await call('PATCH', `/people/employees/${own}`, { ...asB, body: { managerId: a.employee } })).status).toBe(400);
  });

  describe('in SQL, as the runtime role', () => {
    let db: Client;
    beforeAll(async () => {
      db = new Client({ connectionString: inject('databaseUrl') });
      await db.connect();
    });
    afterAll(async () => {
      await db?.end();
    });
    const tables = ['employees', 'employee_personal', 'employee_roles', 'departments', 'teams'];

    it('sees no rows of any people table without a tenant, and none of the other workspace', async () => {
      await db.query('begin');
      try {
        for (const table of tables) expect((await db.query(`select count(*)::int as n from ${table}`)).rows[0].n, table).toBe(0);
        await db.query(`select set_config('app.tenant_id', $1, true)`, [otherTenant]);
        for (const table of tables) expect((await db.query(`select count(*)::int as n from ${table} where tenant_id = $1`, [tenant])).rows[0].n, table).toBe(0);
        expect((await db.query(`update employees set job_title = 'x' where id = $1`, [a.employee])).rowCount).toBe(0);
        expect((await db.query(`delete from departments where id = $1`, [a.department])).rowCount).toBe(0);
      } finally {
        await db.query('rollback');
      }
    });

    it("refuses rows for the other workspace and references to the other workspace's rows", async () => {
      const attempts: [string, unknown[]][] = [
        [`insert into departments (tenant_id, name) values ($1, 'Sneaky')`, [tenant]],
        [`insert into employees (tenant_id, first_name, last_name) values ($1, 'Sneaky', 'Person')`, [tenant]],
        [`insert into employee_roles (tenant_id, employee_id, role) values ($1, $2, 'administration')`, [tenant, a.employee]],
        [`insert into teams (tenant_id, department_id, name) values ($2, $1, 'Sneaky')`, [a.department, otherTenant]],
        [`insert into employees (tenant_id, first_name, last_name, manager_id) values ($2, 'Sneaky', 'Person', $1)`, [a.employee, otherTenant]],
        [`insert into employee_personal (tenant_id, employee_id) values ($2, $1)`, [a.employee, otherTenant]],
      ];
      for (const [text, params] of attempts) {
        await db.query('begin');
        try {
          await db.query(`select set_config('app.tenant_id', $1, true)`, [otherTenant]);
          const code = await db.query(text, params).then(
            () => null,
            (err: { code?: string }) => err.code,
          );
          // 42501: row-level security; 23503: composite foreign key.
          expect(['42501', '23503'], text).toContain(code);
        } finally {
          await db.query('rollback');
        }
      }
    });
  });
});

describe('reporting lines', () => {
  it('refuses yourself (400) and a loop (409, naming it), and accepts a valid chain', async () => {
    const ana = await create({ firstName: 'Ana', lastName: 'Loop' });
    const marko = await create({ firstName: 'Marko', lastName: 'Loop', managerId: ana });
    const ivan = await create({ firstName: 'Ivan', lastName: 'Loop', managerId: marko });
    const self = await setManager(ana, ana);
    expect(self.status).toBe(400);
    expect(self.body.message).toBe("An employee can't report to themselves");
    const loop = await setManager(ana, ivan);
    expect(loop.status).toBe(409);
    expect(loop.body).toMatchObject({ code: 'reporting_loop', message: 'This would create a loop: Ana Loop → Ivan Loop → Marko Loop → Ana Loop' });
    expect((await setManager(ivan, ana)).status).toBe(200);
  });

  it('holds under concurrent requests: of A → B and B → A at the same time, exactly one passes', async () => {
    for (let round = 0; round < 3; round++) {
      const x = await create({ firstName: 'Race', lastName: `X${round}` });
      const y = await create({ firstName: 'Race', lastName: `Y${round}` });
      const results = await Promise.all([setManager(x, y), setManager(y, x)]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      const [rx] = await asTenantSql<{ manager_id: string | null }>(tenant, `select manager_id from employees where id = $1`, [x]);
      const [ry] = await asTenantSql<{ manager_id: string | null }>(tenant, `select manager_id from employees where id = $1`, [y]);
      expect([rx!.manager_id, ry!.manager_id].filter(Boolean)).toHaveLength(1);
    }
  });

  it('the manager must be an active employee of the workspace', async () => {
    const left = await create({ firstName: 'Left', lastName: 'Already' });
    await asTenantSql(tenant, `update employees set deactivated_at = now(), employment_end_date = current_date where id = $1`, [left]);
    const someone = await create({ firstName: 'Some', lastName: 'One' });
    expect((await setManager(someone, left)).status).toBe(400);
    expect((await setManager(someone, '00000000-0000-4000-8000-000000000000')).status).toBe(400);
  });

  it('only Admins change reporting lines', async () => {
    const someone = await create({ firstName: 'Some', lastName: 'Two' });
    expect((await call('PATCH', `/people/employees/${someone}`, { ...as(member), body: { managerId: null } })).status).toBe(403);
  });
});

describe('the directory: filters and search', () => {
  const t = {} as Record<'ceo' | 'vp' | 'lead' | 'tech' | 'tech2' | 'side', string>;
  let sales: string;
  let service: string;
  let north: string;

  beforeAll(async () => {
    sales = await createDepartment(tenant, 'Sales', 'SLS');
    service = await createDepartment(tenant, 'Service', 'SRV');
    north = await createTeam(tenant, service, 'North');
    // Four levels: ceo → vp → lead → tech, tech2; side reports to the ceo.
    t.ceo = await create({ firstName: 'Dragan', lastName: 'Ćirić', departmentId: sales });
    t.vp = await create({ firstName: 'Jovana', lastName: 'Petrović', managerId: t.ceo, departmentId: service });
    t.lead = await create({ firstName: 'Lazar', lastName: 'Đorđević', managerId: t.vp, teamId: north });
    t.tech = await create({ firstName: 'Tara', lastName: 'Šarić', managerId: t.lead, teamId: north, jobTitle: 'Serviser' });
    t.tech2 = await create({ firstName: 'Uroš', lastName: 'Žikić', managerId: t.lead, departmentId: service });
    t.side = await create({ firstName: 'Vesna', lastName: 'Side', managerId: t.ceo });
  });

  const ids = async (query: string, s: Session = owner) => (await ok('GET', `/people/employees?${query}`, as(s))).employees.map((e: { id: string }) => e.id).sort();

  it('by manager: direct reports, or everyone below at any depth', async () => {
    expect(await ids(`managerId=${t.ceo}`)).toEqual([t.vp, t.side].sort());
    expect(await ids(`managerId=${t.ceo}&managerScope=indirect`)).toEqual([t.vp, t.lead, t.tech, t.tech2, t.side].sort());
    expect(await ids(`managerId=${t.vp}&managerScope=indirect`)).toEqual([t.lead, t.tech, t.tech2].sort());
    expect(await ids(`managerId=${t.tech}&managerScope=indirect`)).toEqual([]);
  });

  it('by department and team; choosing a team sets its department', async () => {
    expect(await ids(`departmentIds=${service}`)).toEqual([t.vp, t.lead, t.tech, t.tech2].sort());
    expect(await ids(`teamIds=${north}`)).toEqual([t.lead, t.tech].sort());
    const lead = await ok('GET', `/people/employees/${t.lead}`, as());
    expect(lead).toMatchObject({ departmentId: service, departmentName: 'Service', teamId: north, teamName: 'North' });
    // A team of another department is refused.
    const wrong = await call('PATCH', `/people/employees/${t.lead}`, { ...as(), body: { departmentId: sales, teamId: north } });
    expect(wrong.status).toBe(400);
    // Changing the department alone drops a team that isn't in it.
    const moved = await ok('PATCH', `/people/employees/${t.tech}`, { ...as(), body: { departmentId: sales } }, 200);
    expect(moved).toMatchObject({ departmentId: sales, teamId: null });
    await ok('PATCH', `/people/employees/${t.tech}`, { ...as(), body: { teamId: north } }, 200);
  });

  it('searches without accents or case, by name, job title and email', async () => {
    expect(await ids('q=petrovic')).toEqual([t.vp]);
    expect(await ids('q=PETROVIĆ')).toEqual([t.vp]);
    expect(await ids('q=dordevic')).toEqual([t.lead]);
    expect(await ids('q=serviser')).toEqual([t.tech]);
    expect(await ids('q=100%25')).toEqual([]);
  });

  it('data issues for HR; the manager scope of the caller', async () => {
    const issues = await ok('GET', `/people/employees?issues=no_department&managerId=${t.ceo}&managerScope=indirect`, as());
    expect(issues.employees.map((e: { id: string }) => e.id)).toEqual([t.side]);
    expect((await call('GET', '/people/employees?issues=no_manager', as(member))).status).toBe(403);
    expect((await call('GET', '/people/employees?account=none', as(member))).status).toBe(403);
  });

  it('keeps 1,000 employees fast enough to list in one response', async () => {
    const big = await signIn('org-big');
    const bigTenant = await createTenant(big, 'Org big');
    await asTenantSql(
      bigTenant,
      `insert into employees (tenant_id, first_name, last_name, work_email, employment_start_date)
         select $1, 'Person', 'Number ' || g, 'p' || g || '@big.test', date '2024-01-01' from generate_series(1, 1000) g`,
      [bigTenant],
    );
    const started = Date.now();
    const list = await ok('GET', '/people/employees', { token: big.token, tenant: bigTenant });
    expect(list.total).toBe(1001);
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});

describe('uniqueness', () => {
  it('work email (case-insensitive, active or not) and employee number are unique', async () => {
    await create({ firstName: 'Uniq', lastName: 'One', workEmail: 'uniq@example.test', employeeNumber: 'E-100' });
    const email = await call('POST', '/people/employees', { ...as(), body: { firstName: 'Uniq', lastName: 'Two', workEmail: 'UNIQ@example.test', employmentStartDate: START } });
    expect(email.status).toBe(409);
    expect(email.body.message).toBe('Another employee already has this work email');
    const number = await call('POST', '/people/employees', { ...as(), body: { firstName: 'Uniq', lastName: 'Three', employeeNumber: 'E-100', employmentStartDate: START } });
    expect(number.status).toBe(409);
    expect(number.body.message).toBe('Another employee already has this employee number');
  });

  it('department names (trimmed, any case) and codes; team names within a department', async () => {
    const code = (p: Promise<unknown>) =>
      p.then(
        () => null,
        (err: { code?: string }) => err.code,
      );
    const d = await createDepartment(tenant, 'Finance', 'FIN');
    expect(await code(createDepartment(tenant, '  finance '))).toBe('23505');
    expect(await code(createDepartment(tenant, 'Accounting', 'fin'))).toBe('23505');
    await createTeam(tenant, d, 'Payables');
    expect(await code(createTeam(tenant, d, 'PAYABLES'))).toBe('23505');
    const other = await createDepartment(tenant, 'Treasury');
    await createTeam(tenant, other, 'Payables');
  });

  it('validates the fields of spec 4.2–4.4', async () => {
    const bad = async (body: Record<string, unknown>, path: string) => {
      const r = await call('POST', '/people/employees', { ...as(), body: { firstName: 'Val', lastName: 'Id', employmentStartDate: START, ...body } });
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect(r.body.issues.map((i: { path: string }) => i.path)).toContain(path);
    };
    await bad({ firstName: '   ' }, 'firstName');
    await bad({ lastName: 'x'.repeat(101) }, 'lastName');
    await bad({ workEmail: 'not-an-email' }, 'workEmail');
    await bad({ weeklyHours: 61 }, 'weeklyHours');
    await bad({ employmentStartDate: '2099-01-01' }, 'employmentStartDate');
    await bad({ dateOfBirth: '2020-01-01' }, 'dateOfBirth');
    await bad({ iban: 'RS35260005601001611378' }, 'iban');
    await bad({ swiftBic: 'NOPE' }, 'swiftBic');
    const missing = await call('POST', '/people/employees', { ...as(), body: { firstName: 'No', lastName: 'Date' } });
    expect(missing.status).toBe(400);
    // Serbian letters and Cyrillic are names too.
    const id = await create({ firstName: 'Ђорђе', lastName: 'Čačić' });
    expect((await ok('GET', `/people/employees/${id}`, as())).fullName).toBe('Ђорђе Čačić');
    expect((await call('POST', '/people/employees', { ...as(member), body: { firstName: 'Not', lastName: 'Allowed', employmentStartDate: START } })).status).toBe(403);
  });

  it('requires an employee number when the workspace says so', async () => {
    await ok('PATCH', '/workspace', { ...as(), body: { employeeNumberRequired: true } }, 200);
    try {
      const r = await call('POST', '/people/employees', { ...as(), body: { firstName: 'Num', lastName: 'Less', employmentStartDate: START } });
      expect(r.status).toBe(400);
      expect((await ok('GET', '/workspace', as())).employeeNumberRequired).toBe(true);
    } finally {
      await ok('PATCH', '/workspace', { ...as(), body: { employeeNumberRequired: false } }, 200);
    }
  });
});

describe('editing at the same time (If-Match)', () => {
  it('a field someone else changed since is a 409; other fields merge', async () => {
    const id = await create({ firstName: 'Conf', lastName: 'Lict', jobTitle: 'Before' });
    const card = await ok('GET', `/people/employees/${id}`, as());
    await ok('PATCH', `/people/employees/${id}`, { ...as(), headers: { 'x-client-id': 'other-tab-1234' }, body: { jobTitle: 'Theirs' } }, 200);
    const conflict = await call('PATCH', `/people/employees/${id}`, { ...as(), headers: { 'if-match': `"${card.version}"`, 'x-client-id': 'this-tab-12345' }, body: { jobTitle: 'Mine' } });
    expect(conflict.status).toBe(409);
    expect(conflict.body.message).toContain("Your change to the job title wasn't saved.");
    const merged = await call('PATCH', `/people/employees/${id}`, { ...as(), headers: { 'if-match': `"${card.version}"`, 'x-client-id': 'this-tab-12345' }, body: { workLocation: 'Niš' } });
    expect(merged.status).toBe(200);
    expect(merged.body).toMatchObject({ jobTitle: 'Theirs', workLocation: 'Niš' });
  });
});

describe('approvals go to (spec 7.4)', () => {
  it('the manager; the Admins without one; the only Admin approves their own', async () => {
    const ownerId = (await accessOf(owner, tenant)).employeeId;
    const memberId = (await accessOf(member, tenant)).employeeId;
    const boss = await create({ firstName: 'Boss', lastName: 'NoAccount' });
    await ok('PATCH', `/people/employees/${memberId}`, { ...as(), body: { managerId: boss } }, 200);
    // A manager without an account: Admins.
    expect(await ok('GET', `/people/employees/${memberId}/approvers`, as(member))).toMatchObject({ kind: 'admins', reason: 'manager_no_account', approvers: [{ userId: owner.userId, employeeId: ownerId }] });
    await ok('PATCH', `/people/employees/${memberId}`, { ...as(), body: { managerId: ownerId } }, 200);
    expect(await ok('GET', `/people/employees/${memberId}/approvers?date=2026-12-01`, as(member))).toMatchObject({ kind: 'manager', approvers: [{ userId: owner.userId }] });
    expect(await ok('GET', `/people/employees/${ownerId}/approvers`, as(member))).toMatchObject({ kind: 'self', selfApproved: true, approvers: [{ userId: owner.userId }] });
  });
});

describe('deleting an employee', () => {
  it('Admins delete a deactivated record; history keeps it', async () => {
    const id = await create({ firstName: 'Wrong', lastName: 'Row' });
    await asTenantSql(tenant, `update employees set employment_end_date = '2026-01-31', deactivated_at = now() where id = $1`, [id]);
    expect((await call('DELETE', `/people/employees/${id}`, as(member))).status).toBe(403);
    await ok('DELETE', `/people/employees/${id}`, as());
    expect((await call('GET', `/people/employees/${id}`, as())).status).toBe(404);
    const history = await ok('GET', `/people/history?entityType=employee&entityId=${id}`, as());
    expect(history.entries[0]).toMatchObject({ action: 'deleted', label: 'Wrong Row' });
    // An active one can't be deleted (CD-225): deactivate first.
    const memberId = (await accessOf(member, tenant)).employeeId;
    const active = await call('DELETE', `/people/employees/${memberId}`, as());
    expect(active.status).toBe(409);
    expect(active.body.message).toContain('Deactivate first');
  });
});

describe('the top of the organisation (CD-224, B15)', () => {
  let boss: Session;
  let ws: string;
  const asBoss = () => ({ token: boss.token, tenant: ws });
  const issuesOf = async (id: string) => (await ok('GET', `/people/employees/${id}`, asBoss())).hr.dataIssues as string[];
  const noManagerIds = async () => (await ok('GET', '/people/employees?issues=no_manager', asBoss())).employees.map((e: { id: string }) => e.id).sort();

  beforeAll(async () => {
    boss = await signIn('org-top');
    ws = await createTenant(boss, 'Org top');
  });

  it('the only active employee without a manager is not a "No manager" issue; with several, all are', async () => {
    const top = (await accessOf(boss, ws)).employeeId as string;
    expect(await issuesOf(top)).not.toContain('no_manager');
    expect(await noManagerIds()).toEqual([]);

    const second = (await ok('POST', '/people/employees', { ...asBoss(), body: { firstName: 'Second', lastName: 'Top', employmentStartDate: START } })).id as string;
    expect(await noManagerIds()).toEqual([top, second].sort());
    expect(await issuesOf(top)).toContain('no_manager');

    await ok('PATCH', `/people/employees/${second}`, { ...asBoss(), body: { managerId: top } }, 200);
    expect(await noManagerIds()).toEqual([]);
    expect(await issuesOf(second)).not.toContain('no_manager');
  });
});

describe('the CEO (CD-225): a workspace setting, the top of the chart', () => {
  let boss: Session;
  let staff: Session;
  let ws: string;
  const asBoss = () => ({ token: boss.token, tenant: ws });
  const noManagerIds = async () => (await ok('GET', '/people/employees?issues=no_manager', asBoss())).employees.map((e: { id: string }) => e.id).sort();

  beforeAll(async () => {
    boss = await signIn('org-ceo');
    staff = await signIn('org-ceo-member');
    ws = await createTenant(boss, 'Org CEO');
    await joinAsEmployee(boss, ws, staff);
  });

  it('only an Admin sets it, to an active employee of the workspace; the CEO is never "No manager"', async () => {
    const top = (await accessOf(boss, ws)).employeeId as string;
    const ceo = (await ok('POST', '/people/employees', { ...asBoss(), body: { firstName: 'Cora', lastName: 'Ceo', employmentStartDate: START } })).id as string;
    expect((await ok('GET', '/workspace', asBoss())).ceoEmployeeId).toBeNull();
    // Several without a manager and no CEO: all are flagged.
    expect((await noManagerIds()).length).toBeGreaterThan(1);

    expect((await call('PATCH', '/workspace', { token: staff.token, tenant: ws, body: { ceoEmployeeId: ceo } })).status).toBe(403);
    expect((await call('PATCH', '/workspace', { ...asBoss(), body: { ceoEmployeeId: '00000000-0000-4000-8000-000000000000' } })).status).toBe(400);
    // Another workspace's employee is not found (RLS).
    const own = (await accessOf(staff, ws)).employeeId as string;
    const elsewhere = (await accessOf(owner, tenant)).employeeId as string;
    expect((await call('PATCH', '/workspace', { ...asBoss(), body: { ceoEmployeeId: elsewhere } })).status).toBe(400);

    expect((await ok('PATCH', '/workspace', { ...asBoss(), body: { ceoEmployeeId: ceo } })).ceoEmployeeId).toBe(ceo);
    expect((await ok('GET', '/workspace', { token: staff.token, tenant: ws })).ceoEmployeeId).toBe(ceo);
    expect(await noManagerIds()).not.toContain(ceo);
    expect(await noManagerIds()).toEqual([top, own].sort());
  });

  it('deactivating the CEO clears it; an inactive employee can not be the CEO', async () => {
    const ceo = (await ok('GET', '/workspace', asBoss())).ceoEmployeeId as string;
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Belgrade', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    await ok('POST', `/people/employees/${ceo}/deactivate`, { ...asBoss(), body: { lastWorkingDay: today } }, 200);
    expect((await ok('GET', '/workspace', asBoss())).ceoEmployeeId).toBeNull();
    const refused = await call('PATCH', '/workspace', { ...asBoss(), body: { ceoEmployeeId: ceo } });
    expect(refused.status).toBe(400);
    expect(refused.body.message).toBe('The CEO must be an active employee');
    // Deleting a former CEO leaves nothing behind either.
    await ok('DELETE', `/people/employees/${ceo}`, asBoss());
    expect((await ok('GET', '/workspace', asBoss())).ceoEmployeeId).toBeNull();
  });
});
