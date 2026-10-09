/**
 * The staging seed (CD-313, src/seed-staging.ts): builds Seed Alpha and Seed Bravo, rebuilds them
 * identically on a second run, and never touches another workspace while it purges its own.
 * Runs the built command (dist/seed-staging.js) against the test database in dev auth mode.
 */
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { DEFAULT_MIGRATION_DATABASE_URL } from './env';
import { createTenant, ok, signIn } from './helpers';

// Vitest runs from backend/ (vitest.integration.config.mts), where dist/ and storage/ live.
const backendDir = process.cwd();
const WORKSPACES = ['Seed Alpha', 'Seed Bravo'];

function runSeed() {
  const result = spawnSync(process.execPath, [join(backendDir, 'dist', 'seed-staging.js')], {
    cwd: backendDir,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DATABASE_URL: inject('databaseUrl'),
      AUTH_MODE: 'dev',
      DEV_JWT_SECRET: process.env.DEV_JWT_SECRET || 'integration-tests-secret-at-least-32-characters',
      APP_URL: 'http://staging.example.test',
      MAIL_DRIVER: 'log',
      RATE_LIMIT_ENABLED: 'false',
      STORAGE_DIR: inject('storageDir') || join(backendDir, 'storage'),
      LOG_LEVEL: 'error',
    },
    encoding: 'utf8',
    timeout: 120_000,
  });
  expect(result.status, `seed exited ${result.status}\n${result.stdout}\n${result.stderr}`).toBe(0);
  return result.stdout;
}

/** Per seed workspace: rows in the tables the seed fills (read as the owner role, so RLS doesn't filter). */
async function counts(db: Client) {
  const { rows } = await db.query<{ name: string; counts: Record<string, number> }>(`
    select t.name, jsonb_build_object(
      'members', (select count(*) from memberships m where m.tenant_id = t.id),
      'employees', (select count(*) from employees e where e.tenant_id = t.id),
      'companies', (select count(*) from companies c where c.tenant_id = t.id),
      'contacts', (select count(*) from contacts c where c.tenant_id = t.id),
      'products', (select count(*) from products p where p.tenant_id = t.id),
      'deals', (select count(*) from deals d where d.tenant_id = t.id),
      'meetings', (select count(*) from meetings m where m.tenant_id = t.id),
      'projects', (select count(*) from projects p where p.tenant_id = t.id),
      'tasks', (select count(*) from tasks x where x.tenant_id = t.id),
      'work_orders', (select count(*) from work_orders w where w.tenant_id = t.id),
      'time_entries', (select count(*) from time_entries x where x.tenant_id = t.id),
      'submitted_days', (select count(*) from timesheet_days d where d.tenant_id = t.id and d.status = 'submitted'),
      'ceo', (t.ceo_employee_id is not null)::int,
      'tenants_with_name', (select count(*) from tenants t2 where t2.name = t.name)
    ) as counts
    from tenants t where t.name = any($1) order by t.name`,
    [WORKSPACES],
  );
  return Object.fromEntries(rows.map((r) => [r.name, r.counts]));
}

describe('staging seed', () => {
  let db: Client;
  let other: { tenant: string; company: string };

  beforeAll(async () => {
    db = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL || DEFAULT_MIGRATION_DATABASE_URL });
    await db.connect();
    // A workspace that is not the seed's, with a record of its own, which the seed must leave alone.
    const owner = await signIn('seed-bystander');
    const tenant = await createTenant(owner, 'Bystander');
    const company = await ok('POST', '/crm/companies', { token: owner.token, tenant, body: { name: 'Bystander Co' } });
    other = { tenant, company: company.id };
  });

  afterAll(async () => {
    await db.end();
  });

  it('builds both workspaces, rebuilds them identically, and leaves other workspaces alone', async () => {
    const out = runSeed();
    expect(out).toContain('seed-a-owner@example.com');
    expect(out).toContain('seed-b-member@example.com');
    const first = await counts(db);
    expect(Object.keys(first).sort()).toEqual(WORKSPACES);
    for (const name of WORKSPACES) {
      expect(first[name], name).toMatchObject({
        members: 3, employees: 3, companies: 3, contacts: 3, products: 2, deals: 3, meetings: 1, projects: 1, tasks: 3, work_orders: 1, time_entries: 4, ceo: 1, tenants_with_name: 1,
      });
      expect(first[name]!.submitted_days).toBeGreaterThan(0);
    }

    const again = runSeed();
    expect(again).toContain('removed the previous "Seed Alpha"');
    expect(again).toContain('removed the previous "Seed Bravo"');
    expect(await counts(db)).toEqual(first);

    const { rows } = await db.query('select 1 from companies where tenant_id = $1 and id = $2', [other.tenant, other.company]);
    expect(rows, "the bystander workspace's company survived the seed's reset").toHaveLength(1);
    const accounts = await db.query<{ n: string }>(`select count(*)::text as n from users where email like 'seed-%@example.com'`);
    expect(accounts.rows[0]!.n).toBe('6');
  });
});
