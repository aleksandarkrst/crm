/**
 * Today's status performance target (CD-162, spec 15 section 13): under 1 second for 500
 * employees, in departments and teams, with managers, sick leave and last week's time entries.
 * Runs in the performance suite (`npm run test:performance`) with the time report's.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { call, createTenant, type Session, signIn } from '../integration/helpers';
import { asTenantSql, createDepartment, createTeam } from '../integration/people-helpers';

let owner: Session;
let tenant: string;

beforeAll(async () => {
  owner = await signIn('tsp-owner');
  tenant = await createTenant(owner, 'Status performance');
  const teams: string[] = [];
  for (let d = 1; d <= 5; d++) {
    const dept = await createDepartment(tenant, `Department ${d}`);
    for (let t = 1; t <= 4; t++) teams.push(await createTeam(tenant, dept, `Team ${d}.${t}`));
  }
  // 500 people in 20 teams; the first of each 25 manages the other 24.
  await asTenantSql(
    tenant,
    `insert into employees (tenant_id, first_name, last_name, employment_start_date, unit_id)
     select $1, 'Person', 'No ' || g, '2024-01-01', ($2::uuid[])[1 + (g - 1) / 25] from generate_series(1, 500) g`,
    [tenant, teams],
  );
  await asTenantSql(
    tenant,
    `with e as (select id, unit_id, row_number() over (partition by unit_id order by last_name) as n from employees where tenant_id = $1 and first_name = 'Person')
     update employees x set manager_id = m.id from e, e m where x.id = e.id and m.unit_id = e.unit_id and m.n = 1 and e.n > 1`,
    [tenant],
  );
  // One in ten on open sick leave; everyone with hours on each day of the last two weeks.
  await asTenantSql(
    tenant,
    `insert into sick_leaves (tenant_id, employee_id, start_date, status)
     select $1, id, current_date - 3, 'reported' from employees where tenant_id = $1 and first_name = 'Person' and right(last_name, 1) = '7'`,
    [tenant],
  );
  const [company] = await asTenantSql<{ id: string }>(tenant, `insert into companies (tenant_id, name) values ($1, 'Kovin Pančevo') returning id`, [tenant]);
  const [type] = await asTenantSql<{ id: string; stage: string }>(tenant, `select t.id, s.id as stage from project_types t join project_stages s on s.project_type_id = t.id order by s.position limit 1`);
  const [project] = await asTenantSql<{ id: string; stage: string }>(
    tenant,
    `insert into projects (tenant_id, name, project_type_id, stage_id, company_id, lead_user_id) values ($1, 'Project', $2, $3, $4, $5) returning id, stage_id as stage`,
    [tenant, type!.id, type!.stage, company!.id, owner.userId],
  );
  const [task] = await asTenantSql<{ id: string }>(tenant, `insert into tasks (tenant_id, number, project_id, stage_id, name) values ($1, 900001, $2, $3, 'Task') returning id`, [tenant, project!.id, project!.stage]);
  await asTenantSql(tenant, `insert into task_assignments (tenant_id, task_id, employee_id) select $1, $2, id from employees where tenant_id = $1 and first_name = 'Person'`, [tenant, task!.id]);
  await asTenantSql(
    tenant,
    `insert into time_entries (tenant_id, employee_id, task_id, work_date, minutes)
     select $1, e.id, $2, current_date - g, 480 from employees e cross join generate_series(1, 14) g where e.tenant_id = $1 and e.first_name = 'Person'`,
    [tenant, task!.id],
  );
}); // hookTimeout in vitest.performance.config.mts

const timed = async (path: string) => {
  const started = performance.now();
  const res = await call<{ rows: unknown[] }>('GET', path, { token: owner.token, tenant });
  return { status: res.status, ms: performance.now() - started, rows: res.body.rows?.length ?? 0 };
};

describe("Today's status performance (spec 13)", () => {
  it('answers for 500 employees in under 1 second', async () => {
    await timed('/timesheet/status'); // warm up
    const { status, ms, rows } = await timed('/timesheet/status');
    expect(status).toBe(200);
    expect(rows).toBeGreaterThanOrEqual(500);
    expect(ms).toBeLessThan(1_000);
  });
});
