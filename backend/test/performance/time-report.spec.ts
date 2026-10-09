/**
 * The time report's performance target (CD-149, spec 10.2, TC 16): under 2 seconds for a workspace
 * with 100,000 time entries on 2,000 tasks by 200 people, across all projects and per person.
 * Its own suite (`npm run test:performance`, vitest.performance.config.mts): the data takes minutes
 * to generate, so the "Nightly" workflow runs it, not every pull request (CD-250).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { call, createTenant, type Session, signIn } from '../integration/helpers';
import { asTenantSql } from '../integration/people-helpers';

let owner: Session;
let tenant: string;

beforeAll(async () => {
  owner = await signIn('trp-owner');
  tenant = await createTenant(owner, 'Report performance');
  const [company] = await asTenantSql<{ id: string }>(tenant, `insert into companies (tenant_id, name) values ($1, 'Kovin Pančevo') returning id`, [tenant]);
  const [type] = await asTenantSql<{ id: string; stage: string }>(tenant, `select t.id, s.id as stage from project_types t join project_stages s on s.project_type_id = t.id order by s.position limit 1`);
  await asTenantSql(
    tenant,
    `insert into employees (tenant_id, first_name, last_name, employment_start_date) select $1, 'Person', 'No ' || g, '2024-01-01' from generate_series(1, 200) g`,
    [tenant],
  );
  await asTenantSql(
    tenant,
    `insert into projects (tenant_id, name, project_type_id, stage_id, company_id, lead_user_id) select $1, 'Project ' || g, $2, $3, $4, $5 from generate_series(1, 40) g`,
    [tenant, type!.id, type!.stage, company!.id, owner.userId],
  );
  // 2,000 tasks, 50 per project, a stage each; 3 people per task with a limit.
  await asTenantSql(
    tenant,
    `insert into tasks (tenant_id, number, project_id, stage_id, name)
     select $1, 900000 + row_number() over (), p.id, p.stage_id, 'Task ' || g from projects p cross join generate_series(1, 50) g where p.tenant_id = $1`,
    [tenant],
  );
  await asTenantSql(
    tenant,
    `with e as (select id, row_number() over (order by id) - 1 as n from employees where tenant_id = $1 and first_name = 'Person'),
          t as (select id, row_number() over (order by number) - 1 as n from tasks where tenant_id = $1)
     insert into task_assignments (tenant_id, task_id, employee_id, hour_limit)
     select $1, t.id, e.id, 40 from t join e on e.n in ((t.n * 3) % 200, (t.n * 3 + 1) % 200, (t.n * 3 + 2) % 200)`,
    [tenant],
  );
  // 100,000 entries: 50 per task, by its people, spread over 2025.
  await asTenantSql(
    tenant,
    `insert into time_entries (tenant_id, employee_id, task_id, work_date, minutes)
     select $1, a.employee_id, a.task_id, date '2025-01-01' + ((g * 7 + a.n) % 360)::int, 60 + 15 * (g % 4)
     from (select task_id, employee_id, row_number() over (partition by task_id order by employee_id) as n from task_assignments where tenant_id = $1) a
     cross join generate_series(1, 17) g
     where (a.n < 3 or g < 17)`,
    [tenant],
  );
}, 300_000);

const timed = async (path: string) => {
  const started = performance.now();
  const res = await call('GET', path, { token: owner.token, tenant });
  return { status: res.status, ms: performance.now() - started, body: res.body };
};

describe('time report performance (TC 16)', () => {
  it('has the generated data', async () => {
    const [counts] = await asTenantSql<{ entries: string; tasks: string; people: string }>(
      tenant,
      `select (select count(*) from time_entries) as entries, (select count(*) from tasks) as tasks, (select count(*) from employees where first_name = 'Person') as people`,
    );
    expect(Number(counts!.entries)).toBeGreaterThanOrEqual(100_000);
    expect([Number(counts!.tasks), Number(counts!.people)]).toEqual([2_000, 200]);
  });

  it.each(['/time-report', '/time-report?groupBy=person', '/time-report?period=this_year&onlyOver80=true', '/time-report/csv'])('%s answers in under 2 seconds', async (path) => {
    await timed(path); // warm up
    const { status, ms } = await timed(path);
    expect(status).toBe(200);
    expect(ms).toBeLessThan(2_000);
  });
});
