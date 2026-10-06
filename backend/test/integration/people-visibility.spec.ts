/**
 * Who the Org structure shows (CD-226): members and people with a pending invitation (people who
 * left too, for Admins); other records stay in the database but aren't listed and their card is
 * 404. Inviting in Settings → Team creates the record (Invited); accepting links it and takes the
 * names from the profile; withdrawing or expiry deletes it. Work email = sign-in email: on linking,
 * when the sign-in email changes, and the migration's backfill.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { DEFAULT_MIGRATION_DATABASE_URL } from './env';
import { call, createTenant, eventually, ok, type Session, signIn } from './helpers';
import { accessOf, asTenantSql, joinAsEmployee, START } from './people-helpers';

let owner: Session;
let member: Session;
let tenant: string;
const as = (s: Session = owner) => ({ token: s.token, tenant });
const listed = async (query = '') => (await ok('GET', `/people/employees${query}`, as())).employees.map((e: { id: string }) => e.id) as string[];
const rowOf = async (id: string) =>
  (await asTenantSql<{ first_name: string; last_name: string; work_email: string | null; user_id: string | null; created_from_invite: boolean }>(
    tenant,
    `select first_name, last_name, work_email, user_id, created_from_invite from employees where id = $1`,
    [id],
  ))[0];
const invite = async (email: string) => (await ok('POST', '/team/invitations', { ...as(), body: { email, role: 'member' } })).invitation as { id: string; employeeId: string | null };
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Belgrade', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

beforeAll(async () => {
  [owner, member] = (await Promise.all([signIn('vis-owner'), signIn('vis-member')])) as [Session, Session];
  tenant = await createTenant(owner, 'Visibility');
  await joinAsEmployee(owner, tenant, member);
});

describe('who is shown', () => {
  it('records without an account or a pending invitation are not listed and their card is 404', async () => {
    const hidden = (await ok('POST', '/people/employees', { ...as(), body: { firstName: 'Old', lastName: 'Import', employmentStartDate: START } })).id as string;
    const memberId = (await accessOf(member, tenant)).employeeId as string;
    const ids = await listed();
    expect(ids).toContain(memberId);
    expect(ids).not.toContain(hidden);
    expect((await call('GET', `/people/employees/${hidden}`, as())).status).toBe(404);
    expect((await call('GET', `/people/employees/${hidden}`, as(member))).status).toBe(404);
    // Kept in the database.
    expect(await rowOf(hidden)).toMatchObject({ first_name: 'Old', user_id: null });
    // A member who is removed leaves the Org structure with their account.
    const leaver = await signIn('vis-leaver');
    const leaverId = await joinAsEmployee(owner, tenant, leaver);
    expect(await listed()).toContain(leaverId);
    await ok('DELETE', `/team/members/${leaver.userId}`, as());
    expect(await listed()).not.toContain(leaverId);
    expect((await call('GET', `/people/employees/${leaverId}`, as())).status).toBe(404);
  });

  it('people who left stay in the Admins’ Inactive view', async () => {
    const gone = await signIn('vis-gone');
    const goneId = await joinAsEmployee(owner, tenant, gone);
    await ok('POST', `/people/employees/${goneId}/deactivate`, { ...as(), body: { lastWorkingDay: today() } }, 200);
    expect(await listed('?status=inactive')).toContain(goneId);
    expect((await ok('GET', `/people/employees/${goneId}`, as())).status).toBe('inactive');
  });

  it('the account filter: Has account and Invited', async () => {
    const pending = await invite(`vis-filter-${randomUUID().slice(0, 8)}@example.test`);
    const linked = await listed('?account=linked');
    const invited = await listed('?account=invited');
    expect(invited).toContain(pending.employeeId);
    expect(linked).not.toContain(pending.employeeId);
    expect(linked).toContain((await accessOf(member, tenant)).employeeId);
  });
});

describe('inviting in Settings → Team creates the record', () => {
  it('shows the invited person as Invited, with names from the email; accepting links it and takes the profile’s names', async () => {
    const joiner = await signIn('vis-joiner');
    const { employeeId } = await invite(joiner.email);
    expect(employeeId).toBeTruthy();
    const card = await ok('GET', `/people/employees/${employeeId}`, as());
    expect(card).toMatchObject({ account: 'invited', status: 'active', workEmail: joiner.email, firstName: 'Vis Joiner' });
    expect(card.appAccess.invitation).toMatchObject({ email: joiner.email });
    expect(await listed()).toContain(employeeId);
    expect(await rowOf(employeeId!)).toMatchObject({ created_from_invite: true });

    await ok('POST', `/me/invitations/${card.appAccess.invitation.id}/accept`, { token: joiner.token }, 200);
    expect((await accessOf(joiner, tenant)).employeeId).toBe(employeeId);
    expect(await ok('GET', `/people/employees/${employeeId}`, as())).toMatchObject({ account: 'linked', firstName: 'Vis-joiner', lastName: 'Tester', workEmail: joiner.email, userId: joiner.userId });
  });

  it('links an existing active record without an account that has the email, instead of making another', async () => {
    const email = `vis-existing-${randomUUID().slice(0, 8)}@example.test`;
    const existing = (await ok('POST', '/people/employees', { ...as(), body: { firstName: 'Petar', lastName: 'Postojeći', workEmail: email, employmentStartDate: START } })).id as string;
    expect((await invite(email)).employeeId).toBe(existing);
    expect(await ok('GET', `/people/employees/${existing}`, as())).toMatchObject({ account: 'invited', firstName: 'Petar', lastName: 'Postojeći' });
    // Inviting the address again replaces the invitation and keeps the record.
    expect((await invite(email)).employeeId).toBe(existing);
    expect(await rowOf(existing)).toMatchObject({ created_from_invite: false });
  });

  it('an existing member’s address is refused, and no record is left behind', async () => {
    const before = await asTenantSql<{ n: number }>(tenant, `select count(*)::int as n from employees`);
    expect((await call('POST', '/team/invitations', { ...as(), body: { email: member.email, role: 'member' } })).status).toBe(409);
    expect((await asTenantSql<{ n: number }>(tenant, `select count(*)::int as n from employees`))[0]!.n).toBe(before[0]!.n);
  });

  it('withdrawing the invitation deletes the record it made; a record that existed before stays', async () => {
    const made = await invite(`vis-withdraw-${randomUUID().slice(0, 8)}@example.test`);
    await ok('DELETE', `/team/invitations/${made.id}`, as());
    expect(await rowOf(made.employeeId!)).toBeUndefined();
    expect((await call('GET', `/people/employees/${made.employeeId}`, as())).status).toBe(404);

    const email = `vis-kept-${randomUUID().slice(0, 8)}@example.test`;
    const kept = (await ok('POST', '/people/employees', { ...as(), body: { firstName: 'Kept', lastName: 'Record', workEmail: email, employmentStartDate: START } })).id as string;
    const pending = await invite(email);
    await ok('DELETE', `/team/invitations/${pending.id}`, as());
    expect(await rowOf(kept)).toMatchObject({ first_name: 'Kept' });
    expect(await listed()).not.toContain(kept);
  });

  it('an expired invitation’s record is deleted by the people worker', async () => {
    const made = await invite(`vis-expired-${randomUUID().slice(0, 8)}@example.test`);
    await asTenantSql(tenant, `update invitations set expires_at = now() - interval '1 minute' where id = $1`, [made.id]);
    expect(await listed()).not.toContain(made.employeeId);
    await ok('POST', '/dev/people/deactivate-due', { ...as(), body: {} }, 202);
    await eventually(async () => (await rowOf(made.employeeId!)) === undefined, 'the expired invitation’s record to go');
  });
});

describe('work email = sign-in email', () => {
  it('a record linked without a work email gets the sign-in email', async () => {
    const joiner = await signIn('vis-nomail');
    const bare = (await ok('POST', '/people/employees', { ...as(), body: { firstName: 'No', lastName: 'Mail', employmentStartDate: START } })).id as string;
    const { id: invitationId, employeeId: made } = await invite(joiner.email);
    // As if the invitation had been sent from the bare record (the card's old "Invite to Pultly").
    await asTenantSql(tenant, `update invitations set employee_id = $1 where id = $2`, [bare, invitationId]);
    await asTenantSql(tenant, `delete from employees where id = $1`, [made]);
    await ok('POST', `/me/invitations/${invitationId}/accept`, { token: joiner.token }, 200);
    expect((await accessOf(joiner, tenant)).employeeId).toBe(bare);
    expect(await rowOf(bare)).toMatchObject({ work_email: joiner.email, first_name: 'No', last_name: 'Mail' });
  });

  it('follows a changed sign-in email when it was empty or the old address', async () => {
    const mover = await signIn('vis-mover');
    const moverId = await joinAsEmployee(owner, tenant, mover);
    const old = `vis-old-${randomUUID().slice(0, 8)}@example.test`;
    const db = new Client({ connectionString: inject('databaseUrl') });
    await db.connect();
    try {
      // The account had another address before; the provider now says `mover.email`.
      await db.query(`update users set email = $1 where id = $2`, [old, mover.userId]);
      await asTenantSql(tenant, `update employees set work_email = $1 where id = $2`, [old, moverId]);
      const res = await fetch(`${inject('apiUrl')}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: mover.email, password: 'any' }) });
      expect(res.status).toBe(200);
      expect((await db.query(`select email from users where id = $1`, [mover.userId])).rows[0].email).toBe(mover.email);
      expect(await rowOf(moverId)).toMatchObject({ work_email: mover.email });

      // A work email of its own stays.
      await db.query(`update users set email = $1 where id = $2`, [old, mover.userId]);
      await asTenantSql(tenant, `update employees set work_email = 'vis-own-address@example.test' where id = $1`, [moverId]);
      await fetch(`${inject('apiUrl')}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: mover.email, password: 'any' }) });
      expect(await rowOf(moverId)).toMatchObject({ work_email: 'vis-own-address@example.test' });
    } finally {
      await db.end();
    }
  });

  it('the migration fills an empty work email from the sign-in email, unless another record has it', async () => {
    const admin = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL || DEFAULT_MIGRATION_DATABASE_URL });
    await admin.connect();
    try {
      await admin.query('begin');
      const t = randomUUID();
      const [u1, u2] = [randomUUID(), randomUUID()];
      await admin.query(`insert into tenants (id, name, slug) values ($1, 'Backfill', $2)`, [t, `backfill-${t.slice(0, 8)}`]);
      await admin.query(`insert into users (id, auth_subject, email) values ($1, $3, 'Ana@Backfill.test'), ($2, $4, 'taken@backfill.test')`, [u1, u2, `test|${u1}`, `test|${u2}`]);
      await admin.query(`insert into memberships (tenant_id, user_id, role) values ($1, $2, 'owner'), ($1, $3, 'member')`, [t, u1, u2]);
      await admin.query(`select set_config('app.tenant_id', $1, true)`, [t]);
      const { rows } = await admin.query(
        `insert into employees (tenant_id, user_id, first_name, last_name, work_email) values
           ($1, $2, 'Ana', 'Empty', null), ($1, $3, 'Tara', 'Taken', null), ($1, null, 'Other', 'Record', 'taken@backfill.test')
         returning id, first_name`,
        [t, u1, u2],
      );
      const migration = readFileSync(join(process.cwd(), 'drizzle', '0047_employee_created_from_invite.sql'), 'utf8');
      await admin.query(migration.split('--> statement-breakpoint')[1]!);
      await admin.query(`select set_config('app.tenant_id', $1, true)`, [t]);
      const after = await admin.query(`select first_name, work_email from employees where tenant_id = $1 order by first_name`, [t]);
      expect(after.rows).toEqual([
        { first_name: 'Ana', work_email: 'ana@backfill.test' },
        { first_name: 'Other', work_email: 'taken@backfill.test' },
        { first_name: 'Tara', work_email: null },
      ]);
      expect(rows).toHaveLength(3);
    } finally {
      await admin.query('rollback');
      await admin.end();
    }
  });
});
