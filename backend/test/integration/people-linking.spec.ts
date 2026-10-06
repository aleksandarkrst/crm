/**
 * Every member is an employee (milestone 13, spec 4.6): the migration's backfill, the workspace
 * creator, the three rules when someone joins, and what removing a member leaves behind.
 */
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_MIGRATION_DATABASE_URL } from './env';
import { call, createTenant, ok, type Session, signIn } from './helpers';
import { accessOf, asTenantSql, joinAsEmployee, START } from './people-helpers';

let owner: Session;
let tenant: string;
const as = () => ({ token: owner.token, tenant });

beforeAll(async () => {
  owner = await signIn('link-owner');
  tenant = await createTenant(owner, 'Linking');
});

async function employeeOfUser(userId: string) {
  const { employees } = await ok('GET', '/people/employees', as());
  return employees.find((e: { userId: string | null }) => e.userId === userId);
}

describe('the migration (people_create_member_employee for every membership)', () => {
  it('creates a linked employee for every member, with the name split at the last space', async () => {
    // Members from before milestone 13: memberships without employees, made directly as the owner
    // role, then the migration's backfill; rolled back so nothing stays behind.
    const admin = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL || DEFAULT_MIGRATION_DATABASE_URL });
    await admin.connect();
    try {
      await admin.query('begin');
      const t = randomUUID();
      const [u1, u2, u3] = [randomUUID(), randomUUID(), randomUUID()];
      await admin.query(`insert into tenants (id, name, slug) values ($1, 'Old', $2)`, [t, `old-${t.slice(0, 8)}`]);
      await admin.query(
        `insert into users (id, auth_subject, email, display_name, job_title, phone) values
          ($1, $4, 'Ana.Petrovic@old.test', 'Ana Marija Petrović', 'CEO', '+381 11 123'),
          ($2, $5, 'marko@old.test', 'Marko', null, null),
          ($3, $6, 'ivan@old.test', null, null, null)`,
        [u1, u2, u3, `test|${u1}`, `test|${u2}`, `test|${u3}`],
      );
      await admin.query(`insert into memberships (tenant_id, user_id, role) values ($1, $2, 'owner'), ($1, $3, 'member'), ($1, $4, 'member')`, [t, u1, u2, u3]);
      // The same loop as drizzle/0039_people_rls.sql.
      await admin.query(`DO $$
        DECLARE m record;
        BEGIN
          FOR m IN SELECT tenant_id, user_id FROM memberships m2
            WHERE NOT EXISTS (SELECT 1 FROM employees e WHERE e.tenant_id = m2.tenant_id AND e.user_id = m2.user_id) ORDER BY tenant_id, created_at LOOP
            PERFORM set_config('app.tenant_id', m.tenant_id::text, true);
            PERFORM people_create_member_employee(m.tenant_id, m.user_id);
          END LOOP;
        END $$`);
      await admin.query(`select set_config('app.tenant_id', $1, true)`, [t]);
      const { rows } = await admin.query(
        `select user_id, first_name, last_name, work_email, job_title, work_phone, employment_type, weekly_hours::float as hours,
                department_id, manager_id, employment_start_date, first_linked_at is not null as linked
           from employees where tenant_id = $1 order by work_email`,
        [t],
      );
      expect(rows).toEqual([
        { user_id: u1, first_name: 'Ana Marija', last_name: 'Petrović', work_email: 'ana.petrovic@old.test', job_title: 'CEO', work_phone: '+381 11 123', employment_type: 'permanent', hours: 40, department_id: null, manager_id: null, employment_start_date: null, linked: true },
        { user_id: u3, first_name: 'ivan', last_name: 'ivan', work_email: 'ivan@old.test', job_title: null, work_phone: null, employment_type: 'permanent', hours: 40, department_id: null, manager_id: null, employment_start_date: null, linked: true },
        // One word: it is the last name; the first name is the email's local part.
        { user_id: u2, first_name: 'marko', last_name: 'Marko', work_email: 'marko@old.test', job_title: null, work_phone: null, employment_type: 'permanent', hours: 40, department_id: null, manager_id: null, employment_start_date: null, linked: true },
      ]);
      // History says they were created, by the system.
      const history = await admin.query(`select count(*)::int as n from record_changes where tenant_id = $1 and entity_type = 'employee' and action = 'created' and actor_user_id is null`, [t]);
      expect(history.rows[0].n).toBe(3);
    } finally {
      await admin.query('rollback');
      await admin.end();
    }
  });

  it('every membership in the database has a linked employee', async () => {
    const admin = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL || DEFAULT_MIGRATION_DATABASE_URL });
    await admin.connect();
    try {
      const { rows } = await admin.query(
        `select count(*)::int as n from memberships m where not exists (select 1 from employees e where e.tenant_id = m.tenant_id and e.user_id = m.user_id)`,
      );
      expect(rows[0].n).toBe(0);
    } finally {
      await admin.end();
    }
  });
});

describe('creating and joining a workspace', () => {
  it("the workspace's creator gets a linked employee record", async () => {
    const access = await accessOf(owner, tenant);
    expect(access.employeeId).toBeTruthy();
    expect(access.roles).toEqual(['employee', 'admin']);
    const card = await ok('GET', `/people/employees/${access.employeeId}`, as());
    expect(card).toMatchObject({ userId: owner.userId, firstName: 'Link-owner', lastName: 'Tester', workEmail: owner.email, account: 'linked', status: 'active' });
  });

  it('rule 3: a new member without a matching record gets a new one from their profile', async () => {
    const newbie = await signIn('link-new');
    const id = await joinAsEmployee(owner, tenant, newbie);
    const row = await employeeOfUser(newbie.userId);
    expect(row).toMatchObject({ id, firstName: 'Link-new', lastName: 'Tester', workEmail: newbie.email });
  });

  it('rule 2: an active employee without an account whose work email is the member’s email is linked', async () => {
    const joiner = await signIn('link-email');
    const created = await ok('POST', '/people/employees', { ...as(), body: { firstName: 'Jelena', lastName: 'Jović', workEmail: joiner.email.toUpperCase(), employmentStartDate: START } });
    expect(created.account).toBe('none');
    const id = await joinAsEmployee(owner, tenant, joiner);
    expect(id).toBe(created.id);
    const card = await ok('GET', `/people/employees/${id}`, as());
    // The record keeps its data; the profile name doesn't overwrite it.
    expect(card).toMatchObject({ firstName: 'Jelena', lastName: 'Jović', userId: joiner.userId, account: 'linked' });
    const { employees } = await ok('GET', '/people/employees', as());
    expect(employees.filter((e: { workEmail: string }) => e.workEmail === joiner.email)).toHaveLength(1);
  });

  it('rule 1: an invitation sent from an employee record links to that record, whatever its email', async () => {
    const joiner = await signIn('link-invite');
    const created = await ok('POST', '/people/employees', { ...as(), body: { firstName: 'Nikola', lastName: 'Nikolić', workEmail: `other-${joiner.email}`, employmentStartDate: START } });
    const { token, invitation } = await ok('POST', '/team/invitations', { ...as(), body: { email: joiner.email, role: 'member' } });
    // "Invite to Pultly" on the card stores the employee on the invitation (the invite flow itself is another issue).
    await asTenantSql(tenant, `update invitations set employee_id = $1 where id = $2`, [created.id, invitation.id]);
    const before = await ok('GET', `/people/employees/${created.id}`, as());
    expect(before.account).toBe('invited');
    await ok('POST', `/invitations/${token}/accept`, { token: joiner.token }, 200);
    expect((await accessOf(joiner, tenant)).employeeId).toBe(created.id);
    expect((await ok('GET', `/people/employees/${created.id}`, as())).account).toBe('linked');
  });

  it('removing a member leaves the employee Active with "No account"; joining again relinks by email', async () => {
    const leaver = await signIn('link-leaver');
    const id = await joinAsEmployee(owner, tenant, leaver);
    await ok('DELETE', `/team/members/${leaver.userId}`, as());
    const card = await ok('GET', `/people/employees/${id}`, as());
    expect(card).toMatchObject({ status: 'active', account: 'none', userId: null });
    // An active employee can't be deleted (deactivate first, CD-225).
    expect((await call('DELETE', `/people/employees/${id}`, as())).status).toBe(409);
    // Back again: rule 2 finds the same record by work email.
    expect(await joinAsEmployee(owner, tenant, leaver)).toBe(id);
  });
});
