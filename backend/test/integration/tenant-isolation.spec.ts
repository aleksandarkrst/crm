/**
 * Tenant isolation: tenant B can't read or change tenant A's rows, whether it asks through the
 * API (RLS + membership check) or runs SQL as the runtime role directly (RLS + composite FKs).
 */
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { call, createTenant, firstFunnel, type Funnel, ok, productLine, saveProducts, type Session, signIn, testPib } from './helpers';

let alice: Session;
let bob: Session;
let tenantA: string;
let tenantB: string;
let funnelB: Funnel;
const a = {} as { company: string; contact: string; deal: string; line: string; playbookTask: string; extraTask: string; product: string };

beforeAll(async () => {
  [alice, bob] = await Promise.all([signIn('iso-alice'), signIn('iso-bob')]);
  [tenantA, tenantB] = await Promise.all([createTenant(alice, 'Alpha'), createTenant(bob, 'Bravo')]);
  const as = { token: alice.token, tenant: tenantA };
  const funnelA = await firstFunnel(alice, tenantA);
  funnelB = await firstFunnel(bob, tenantB);

  a.company = (await ok('POST', '/crm/companies', { ...as, body: { pib: testPib(), name: 'Alpha Secret Co' } })).id;
  a.contact = (await ok('POST', '/crm/contacts', { ...as, body: { fullName: 'Alpha Person', companyId: a.company } })).id;
  a.product = (await ok('POST', '/crm/products', { ...as, body: { name: 'Alpha Product', unitPrice: 100 } })).id;
  a.deal = (
    await ok('POST', '/crm/deals', { ...as, body: { title: 'Alpha Deal', funnelId: funnelA.id, companyId: a.company, primaryContactId: a.contact, amount: 1000 } })
  ).id;
  a.line = (await saveProducts(alice, tenantA, a.deal, [productLine(a.product, { quantity: 2, unitPrice: 100 })])).lines[0].id;
  const stage = funnelA.stages[0]!;
  a.playbookTask = (await ok('PUT', `/crm/deals/${a.deal}/tasks/playbook`, { ...as, body: { stageId: stage.id, checklistItemId: stage.checklistItems[0]!.id, done: true } })).id;
  a.extraTask = (await ok('POST', `/crm/deals/${a.deal}/tasks`, { ...as, body: { stageId: stage.id, label: 'Alpha private to-do' } })).id;
});

describe('through the API', () => {
  const asB = () => ({ token: bob.token, tenant: tenantB });

  it("a non-member can't use the other tenant's id", async () => {
    for (const path of ['/crm/deals', '/crm/companies', '/crm/deal-lines', '/crm/deal-tasks', `/crm/deals/${a.deal}`, '/team']) {
      const res = await call('GET', path, { token: bob.token, tenant: tenantA });
      expect(res.status, path).toBe(403);
    }
  });

  it("lists in tenant B contain none of tenant A's rows", async () => {
    const [deals, companies, contacts, lines, tasks, products] = await Promise.all(
      ['/crm/deals', '/crm/companies', '/crm/contacts', '/crm/deal-lines', '/crm/deal-tasks', '/crm/products'].map((p) => ok('GET', p, asB())),
    );
    expect(deals).toEqual([]);
    expect(companies).toEqual([]);
    expect(contacts).toEqual([]);
    expect(lines).toEqual([]);
    expect(tasks).toEqual([]);
    expect(products).toEqual([]);
    // Search can't find them either.
    expect(await ok('GET', '/crm/deals?q=Alpha', asB())).toEqual([]);
  });

  it("tenant A's rows are not found by id", async () => {
    expect((await call('GET', `/crm/deals/${a.deal}`, asB())).status).toBe(404);
    expect((await call('GET', `/crm/companies/${a.company}`, asB())).status).toBe(404);
    expect((await call('GET', `/crm/contacts/${a.contact}`, asB())).status).toBe(404);
    expect(await ok('GET', `/crm/deals/${a.deal}/activities`, asB())).toEqual([]);
  });

  it("tenant B can't update tenant A's rows", async () => {
    const attempts: [string, string, unknown][] = [
      ['PATCH', `/crm/deals/${a.deal}`, { title: 'Hijacked' }],
      ['POST', `/crm/deals/${a.deal}/move`, { stageId: funnelB.stages[1]!.id }],
      ['PATCH', `/crm/companies/${a.company}`, { name: 'Hijacked' }],
      ['PATCH', `/crm/contacts/${a.contact}`, { fullName: 'Hijacked' }],
      ['PATCH', `/crm/products/${a.product}`, { name: 'Hijacked' }],
      ['PUT', `/crm/deals/${a.deal}/products`, { taxMode: 'exclusive', lines: [] }],
      ['PATCH', `/crm/deal-tasks/${a.playbookTask}`, { done: false }],
      ['PATCH', `/crm/deal-tasks/${a.extraTask}`, { label: 'Hijacked' }],
    ];
    for (const [method, path, body] of attempts) {
      const res = await call(method, path, { ...asB(), body });
      expect(res.status, `${method} ${path}`).toBe(404);
    }
  });

  it("tenant B can't delete tenant A's rows", async () => {
    // Bob is the owner of B, so the role check passes and only RLS stands in the way.
    for (const path of [
      `/crm/deal-tasks/${a.extraTask}`,
      `/crm/deals/${a.deal}`,
      `/crm/companies/${a.company}`,
      `/crm/contacts/${a.contact}`,
      `/crm/products/${a.product}`,
    ]) {
      const res = await call('DELETE', path, asB());
      expect(res.status, `DELETE ${path}`).toBe(404);
    }
  });

  it("tenant B can't attach its rows to tenant A's rows (composite foreign keys)", async () => {
    const own = await ok('POST', '/crm/deals', { ...asB(), body: { title: 'Bravo Deal', funnelId: funnelB.id } });
    const attempts: [string, string, unknown][] = [
      ['POST', '/crm/deals', { title: 'Bravo → Alpha company', funnelId: funnelB.id, companyId: a.company }],
      ['POST', '/crm/deals', { title: 'Bravo → Alpha contact', funnelId: funnelB.id, primaryContactId: a.contact }],
      ['PATCH', `/crm/deals/${own.id}`, { companyId: a.company }],
      ['POST', '/crm/contacts', { fullName: 'Bravo Person', companyId: a.company }],
      ['PUT', `/crm/deals/${own.id}/contacts/${a.contact}`, undefined],
      ['PUT', `/crm/deals/${own.id}/products`, { taxMode: 'exclusive', lines: [productLine(a.product)] }],
      ['POST', `/crm/deals/${a.deal}/tasks`, { stageId: funnelB.stages[0]!.id, label: 'Sneaky' }],
      ['PUT', `/crm/deals/${a.deal}/tasks/playbook`, { stageId: funnelB.stages[0]!.id, checklistItemId: funnelB.stages[0]!.checklistItems[0]!.id }],
    ];
    for (const [method, path, body] of attempts) {
      const res = await call(method, path, { ...asB(), body });
      // 409 from a foreign key violation, or 404 where the service looks the row up first.
      expect([404, 409], `${method} ${path} → ${res.status} ${JSON.stringify(res.body)}`).toContain(res.status);
    }
    // Tenant B's own deal is untouched.
    const after = await ok('GET', `/crm/deals/${own.id}`, asB());
    expect(after.companyId).toBeNull();
    expect(after.contacts).toEqual([]);
  });

  it("tenant A's data is unchanged after all of that", async () => {
    const as = { token: alice.token, tenant: tenantA };
    const deal = await ok('GET', `/crm/deals/${a.deal}`, as);
    expect(deal).toMatchObject({ title: 'Alpha Deal', companyId: a.company, primaryContactId: a.contact });
    expect(Number(deal.amount)).toBe(200);
    expect((await ok('GET', `/crm/companies/${a.company}`, as)).name).toBe('Alpha Secret Co');
    const lines = await ok('GET', '/crm/deal-lines', as);
    expect(lines.map((l: { id: string; quantity: string }) => [l.id, Number(l.quantity)])).toEqual([[a.line, 2]]);
    const tasks = await ok('GET', '/crm/deal-tasks', as);
    expect(tasks.map((t: { id: string }) => t.id).sort()).toEqual([a.extraTask, a.playbookTask].sort());
    expect(tasks.find((t: { id: string }) => t.id === a.playbookTask).done).toBe(true);
    expect(tasks.find((t: { id: string }) => t.id === a.extraTask).label).toBe('Alpha private to-do');
    expect((await ok('GET', '/crm/products', as)).map((p: { name: string }) => p.name)).toEqual(['Alpha Product']);
  });
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

  /** Runs `fn` in a transaction with app.tenant_id set, like DatabaseService.withTenant(), then rolls back. */
  async function asTenant<T>(tenantId: string | null, fn: () => Promise<T>): Promise<T> {
    await db.query('begin');
    try {
      if (tenantId) await db.query(`select set_config('app.tenant_id', $1, true)`, [tenantId]);
      return await fn();
    } finally {
      await db.query('rollback');
    }
  }

  const sqlError = (p: Promise<unknown>) =>
    p.then(
      () => null,
      (err: { code?: string }) => err.code,
    );

  it('the API role is not a superuser, does not bypass RLS and does not own the tables', async () => {
    const { rows } = await db.query(
      `select r.rolsuper, r.rolbypassrls, (select tableowner from pg_tables where schemaname = 'public' and tablename = 'deals') as owner, current_user as me
         from pg_roles r where r.rolname = current_user`,
    );
    expect(rows[0]).toMatchObject({ rolsuper: false, rolbypassrls: false });
    expect(rows[0].owner).not.toBe(rows[0].me);
  });

  it('sees no tenant rows at all without a tenant set', async () => {
    await asTenant(null, async () => {
      for (const table of ['deals', 'companies', 'contacts', 'deal_lines', 'deal_tasks', 'products', 'activities', 'timeoff_policies', 'timeoff_policy_experience_rules', 'employee_timeoff_profiles', 'vacation_entitlements', 'vacation_balance_adjustments', 'vacation_balance_expiries', 'timeoff_notices', 'timeoff_reasons', 'timeoff_requests', 'timeoff_request_days', 'public_holiday_preloads', 'hr_documents', 'sick_leaves', 'sick_leave_types', 'timesheet_absences']) {
        const { rows } = await db.query(`select count(*)::int as n from ${table}`);
        expect(rows[0].n, table).toBe(0);
      }
    });
  });

  it("tenant B sees none of tenant A's deals, companies, deal_lines and deal_tasks", async () => {
    await asTenant(tenantB, async () => {
      for (const [table, id] of [
        ['deals', a.deal],
        ['companies', a.company],
        ['deal_lines', a.line],
        ['deal_tasks', a.playbookTask],
      ] as const) {
        const { rowCount } = await db.query(`select 1 from ${table} where id = $1`, [id]);
        expect(rowCount, table).toBe(0);
        const { rows } = await db.query(`select count(*)::int as n from ${table} where tenant_id = $1`, [tenantA]);
        expect(rows[0].n, table).toBe(0);
      }
    });
  });

  it("tenant B's updates and deletes of tenant A's rows touch nothing", async () => {
    await asTenant(tenantB, async () => {
      expect((await db.query(`update deals set title = 'x' where id = $1`, [a.deal])).rowCount).toBe(0);
      expect((await db.query(`update companies set name = 'x' where id = $1`, [a.company])).rowCount).toBe(0);
      expect((await db.query(`update deal_lines set quantity = 99 where id = $1`, [a.line])).rowCount).toBe(0);
      expect((await db.query(`update deal_tasks set label = 'x' where id = $1`, [a.extraTask])).rowCount).toBe(0);
      expect((await db.query(`delete from deal_lines where id = $1`, [a.line])).rowCount).toBe(0);
      expect((await db.query(`delete from deals where id = $1`, [a.deal])).rowCount).toBe(0);
    });
  });

  it("rejects writing rows into another tenant (RLS WITH CHECK)", async () => {
    await asTenant(tenantB, async () => {
      const code = await sqlError(db.query(`insert into companies (tenant_id, name) values ($1, 'Planted')`, [tenantA]));
      expect(code).toBe('42501'); // insufficient_privilege: new row violates row-level security policy
    });
    await asTenant(tenantB, async () => {
      const own = await db.query(`insert into companies (tenant_id, name) values ($1, 'Mine') returning id`, [tenantB]);
      const code = await sqlError(db.query(`update companies set tenant_id = $1 where id = $2`, [tenantA, own.rows[0].id]));
      expect(code).toBe('42501');
    });
  });

  it('keeps the audit log append-only: rows can be added and read, never changed or deleted (CD-101)', async () => {
    await asTenant(tenantA, async () => {
      const { rows } = await db.query(`insert into audit_logs (tenant_id, action, entity_type) values ($1, 'test.append', 'test') returning id`, [tenantA]);
      expect((await db.query(`select 1 from audit_logs where id = $1`, [rows[0].id])).rowCount).toBe(1);
    });
    for (const text of [`update audit_logs set action = 'x'`, `delete from audit_logs`, `truncate audit_logs`]) {
      const code = await asTenant(tenantA, () => sqlError(db.query(text)));
      expect(code, text).toBe('42501'); // insufficient_privilege
    }
  });

  it("rejects cross-tenant references (composite foreign keys)", async () => {
    const stageB = funnelB.stages[0]!.id;
    const cases: [string, string, unknown[]][] = [
      ['deal → company', `insert into deals (tenant_id, funnel_id, stage_id, title, company_id) values ($1, $2, $3, 'x', $4)`, [tenantB, funnelB.id, stageB, a.company]],
      ['deal → contact', `insert into deals (tenant_id, funnel_id, stage_id, title, primary_contact_id) values ($1, $2, $3, 'x', $4)`, [tenantB, funnelB.id, stageB, a.contact]],
      ['deal line → deal', `insert into deal_lines (tenant_id, deal_id) values ($1, $2)`, [tenantB, a.deal]],
      ['deal task → deal', `insert into deal_tasks (tenant_id, deal_id, stage_id, label) values ($1, $2, $3, 'x')`, [tenantB, a.deal, stageB]],
      ['contact → company', `insert into contacts (tenant_id, full_name, company_id) values ($1, 'x', $2)`, [tenantB, a.company]],
    ];
    for (const [name, text, params] of cases) {
      const code = await asTenant(tenantB, () => sqlError(db.query(text, params)));
      expect(code, name).toBe('23503'); // foreign_key_violation
    }
  });

  it('isolates the time off tables (CD-163): policies, rules, profiles and entitlements', async () => {
    // Every workspace has its default policy (provisioned on creation).
    const policyA = await asTenant(tenantA, async () => (await db.query(`select id from timeoff_policies where is_default`)).rows[0].id as string);
    const employeeA = await asTenant(tenantA, async () => (await db.query(`select id from employees limit 1`)).rows[0].id as string);
    await asTenant(tenantB, async () => {
      expect((await db.query(`select count(*)::int as n from timeoff_policies where id = $1`, [policyA])).rows[0].n).toBe(0);
    });
    // Planting rows in A's workspace (RLS WITH CHECK). Each failing statement gets its own transaction.
    expect(await asTenant(tenantB, () => sqlError(db.query(`insert into timeoff_policies (tenant_id, name) values ($1, 'Planted')`, [tenantA])))).toBe('42501');
    // Pointing B's rows at A's policy or employee (composite foreign keys).
    const cases: [string, string, unknown[]][] = [
      ['rule → policy', `insert into timeoff_policy_experience_rules (tenant_id, policy_id, from_years, extra_days) values ($1, $2, 1, 1)`, [tenantB, policyA]],
      ['profile → employee, policy', `insert into employee_timeoff_profiles (tenant_id, employee_id, policy_id) values ($1, $2, $3)`, [tenantB, employeeA, policyA]],
      ['entitlement → employee, policy', `insert into vacation_entitlements (tenant_id, employee_id, year, policy_id, base_days, annual_days, total_days) values ($1, $2, 2026, $3, 20, 20, 20)`, [tenantB, employeeA, policyA]],
    ];
    for (const [name, text, params] of cases) {
      const code = await asTenant(tenantB, () => sqlError(db.query(text, params)));
      expect(code, name).toBe('23503');
    }
  });

  it('isolates the balance tables (CD-164) and keeps adjustments append-only', async () => {
    const employeeA = await asTenant(tenantA, async () => (await db.query(`select id from employees limit 1`)).rows[0].id as string);
    const employeeB = await asTenant(tenantB, async () => (await db.query(`select id from employees limit 1`)).rows[0].id as string);
    expect(await asTenant(tenantB, () => sqlError(db.query(`insert into vacation_balance_adjustments (tenant_id, employee_id, pool_year, days, kind, reason) values ($1, $2, 2026, 1, 'correction', 'x')`, [tenantA, employeeA])))).toBe('42501');
    const cases: [string, string, unknown[]][] = [
      ['adjustment → employee', `insert into vacation_balance_adjustments (tenant_id, employee_id, pool_year, days, kind, reason) values ($1, $2, 2026, 1, 'correction', 'x')`, [tenantB, employeeA]],
      ['expiry → employee', `insert into vacation_balance_expiries (tenant_id, employee_id, pool_year, days) values ($1, $2, 2025, 1)`, [tenantB, employeeA]],
      ['notice → employee', `insert into timeoff_notices (tenant_id, kind, employee_id, period) values ($1, 'carry_over_expiring', $2, '2026-05')`, [tenantB, employeeA]],
    ];
    for (const [name, text, params] of cases) {
      const code = await asTenant(tenantB, () => sqlError(db.query(text, params)));
      expect(code, name).toBe('23503');
    }
    // Requests, their days and the reasons (CD-165): planted rows and cross-workspace references.
    expect(await asTenant(tenantB, () => sqlError(db.query(`insert into timeoff_reasons (tenant_id, kind, name) values ($1, 'paid_leave', 'Planted')`, [tenantA])))).toBe('42501');
    const requestCases: [string, string, unknown[]][] = [
      ['request → employee', `insert into timeoff_requests (tenant_id, employee_id, type, start_date, end_date, working_days) values ($1, $2, 'vacation', '2026-06-01', '2026-06-02', 2)`, [tenantB, employeeA]],
      ['request day → employee', `insert into timeoff_request_days (tenant_id, request_id, employee_id, date) values ($1, gen_random_uuid(), $2, '2026-06-01')`, [tenantB, employeeA]],
      ['sick leave → employee', `insert into sick_leaves (tenant_id, employee_id, start_date) values ($1, $2, '2026-06-01')`, [tenantB, employeeA]],
      ['sick leave → type', `insert into sick_leaves (tenant_id, employee_id, start_date, type_id) values ($1, (select id from employees limit 1), '2026-06-01', gen_random_uuid())`, [tenantB]],
      ['sick leave → continued record', `insert into sick_leaves (tenant_id, employee_id, start_date, continuation_of_id) values ($1, (select id from employees limit 1), '2026-06-01', gen_random_uuid())`, [tenantB]],
      ['request day → sick leave', `insert into timeoff_request_days (tenant_id, request_id, employee_id, date, sick_leave_id) values ($1, gen_random_uuid(), (select id from employees limit 1), '2026-06-01', gen_random_uuid())`, [tenantB]],
    ];
    for (const [name, text, params] of requestCases) {
      const code = await asTenant(tenantB, () => sqlError(db.query(text, params)));
      expect(code, name).toBe('23503');
    }
    // Append-only: the app can add and read, never change or delete (no such policy).
    await asTenant(tenantB, async () => {
      const { rows } = await db.query(`insert into vacation_balance_adjustments (tenant_id, employee_id, pool_year, days, kind, reason) values ($1, $2, 2026, 1, 'correction', 'x') returning id`, [tenantB, employeeB]);
      expect((await db.query(`update vacation_balance_adjustments set days = 2 where id = $1`, [rows[0].id])).rowCount).toBe(0);
      expect((await db.query(`delete from vacation_balance_adjustments where id = $1`, [rows[0].id])).rowCount).toBe(0);
    });
  });
});
