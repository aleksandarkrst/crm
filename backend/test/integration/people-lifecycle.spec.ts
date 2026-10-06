/**
 * An employee's app access and leaving (milestone 13, CD-140, spec 4.6–4.8): Invite to Pultly from
 * the card (the API; CD-226 took the button and "Invite selected" out), the invitation's conflicts, a changed work email withdrawing it, Link to
 * member (merging the automatic record) and Unlink, Deactivate now and on a future date (the daily
 * job in the workspace's time zone), reassignments, guards, Reactivate, Delete (only once
 * deactivated, CD-225) and who may do what. `hr` holds a leftover Administration row, which gives
 * nothing since CD-225 (only Admins do HR work).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { call, createTenant, eventually, ok, type Session, signIn } from './helpers';
import { accessOf, addEmployee, asTenantSql, createDepartment, createTeam, grantRole, joinAsEmployee, START } from './people-helpers';

let owner: Session;
let member: Session;
let hr: Session;
let tenant: string;
let memberEmployee: string;
let hrEmployee: string;
const as = (s: Session = owner) => ({ token: s.token, tenant });
/** A record shown in the app (with a pending invitation, CD-226). */
const create = (body: Record<string, unknown>) => addEmployee(owner, tenant, body);
/** A record without an account or invitation (not shown in the app since CD-226), to invite or link. */
const rawCreate = async (body: Record<string, unknown>) => (await ok('POST', '/people/employees', { ...as(), body: { employmentStartDate: START, ...body } })).id as string;
const card = (id: string, s: Session = owner) => ok('GET', `/people/employees/${id}`, as(s));
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (date: string, days: number) => iso(new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000));
/** Today in the workspace's time zone (Europe/Belgrade unless a test changes it). */
const todayIn = (timeZone: string) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const membersOf = async () => ((await ok('GET', '/team', as())).members as { userId: string; employeeId: string | null }[]);

beforeAll(async () => {
  [owner, member, hr] = (await Promise.all([signIn('life-owner'), signIn('life-member'), signIn('life-hr')])) as [Session, Session, Session];
  tenant = await createTenant(owner, 'Lifecycle');
  memberEmployee = await joinAsEmployee(owner, tenant, member);
  hrEmployee = await joinAsEmployee(owner, tenant, hr);
  await grantRole(tenant, hrEmployee, 'administration');
});

describe('Invite to Pultly (spec 4.7)', () => {
  it('links the accepted account to the record it was sent from', async () => {
    const joiner = await signIn('life-invitee');
    const id = await rawCreate({ firstName: 'Ivana', lastName: 'Ilić', workEmail: joiner.email });
    const { invitation, token, card: after } = await ok('POST', `/people/employees/${id}/invite`, { ...as(), body: { role: 'member' } });
    expect(invitation).toMatchObject({ email: joiner.email, role: 'member', employeeId: id });
    expect(after.account).toBe('invited');
    expect(after.appAccess.invitation).toMatchObject({ id: invitation.id, email: joiner.email, hasLink: true });
    // It is a normal invitation: listed in Settings → Team.
    expect((await ok('GET', '/team', as())).invitations.map((i: { id: string }) => i.id)).toContain(invitation.id);

    await ok('POST', `/invitations/${token}/accept`, { token: joiner.token }, 200);
    expect((await accessOf(joiner, tenant)).employeeId).toBe(id);
    const linked = await card(id);
    expect(linked).toMatchObject({ account: 'linked', userId: joiner.userId, firstName: 'Ivana' });
    expect(linked.appAccess).toMatchObject({ signInEmail: joiner.email, workspaceRole: 'member', invitation: null });
    // Settings → Team links the member to the card.
    expect((await membersOf()).find((m) => m.userId === joiner.userId)?.employeeId).toBe(id);
  });

  it('needs a work email, an active record without an account, and an Admin', async () => {
    const noEmail = await rawCreate({ firstName: 'Bez', lastName: 'Emaila' });
    expect((await call('POST', `/people/employees/${noEmail}/invite`, { ...as(), body: {} })).status).toBe(400);
    expect((await call('POST', `/people/employees/${memberEmployee}/invite`, { ...as(), body: {} })).status).toBe(409);
    const target = await rawCreate({ firstName: 'Pera', lastName: 'Perić', workEmail: 'pera-invite@example.test' });
    // A member can't invite, with a leftover Administration row neither.
    expect((await call('POST', `/people/employees/${target}/invite`, { ...as(hr), body: {} })).status).toBe(403);
    expect((await call('POST', `/people/employees/${target}/invite`, { ...as(member), body: {} })).status).toBe(403);
  });

  it("refuses an email that already has an account linked elsewhere, and offers linking for an automatic record", async () => {
    // The prober's own record is automatic (made when they joined): link instead.
    const prober = await signIn('life-prober');
    const proberEmployee = await joinAsEmployee(owner, tenant, prober);
    const target = await rawCreate({ firstName: 'Treća', lastName: 'Kartica' });
    // Work emails are unique, so point the target at the prober's sign-in email after freeing it.
    await asTenantSql(tenant, `update employees set work_email = null where id = $1`, [proberEmployee]);
    await ok('PATCH', `/people/employees/${target}`, { ...as(), body: { workEmail: prober.email } });
    const linkInstead = await call('POST', `/people/employees/${target}/invite`, { ...as(), body: {} });
    expect(linkInstead.status).toBe(409);
    expect(linkInstead.body).toMatchObject({ code: 'link_instead', userId: prober.userId });

    // Once the prober's record holds data (a unit), it is "linked to <name>".
    const department = await createDepartment(tenant, 'Life dept');
    await ok('PATCH', `/people/employees/${proberEmployee}`, { ...as(), body: { unitId: department } });
    const elsewhere = await call('POST', `/people/employees/${target}/invite`, { ...as(), body: {} });
    expect(elsewhere.status).toBe(409);
    expect(elsewhere.body).toMatchObject({ code: 'linked_elsewhere' });
    expect(elsewhere.body.message).toContain(`${prober.email} already has an account linked to`);
  });

  it('changing the work email withdraws a pending invitation', async () => {
    const joiner = await signIn('life-moved');
    const id = await rawCreate({ firstName: 'Mila', lastName: 'Mirić', workEmail: joiner.email });
    const { token } = await ok('POST', `/people/employees/${id}/invite`, { ...as(), body: {} });
    const after = await ok('PATCH', `/people/employees/${id}`, { ...as(), body: { workEmail: `new-${joiner.email}` } });
    expect(after.account).toBe('none');
    expect(after.appAccess.invitation).toBeNull();
    expect((await call('POST', `/invitations/${token}/accept`, { token: joiner.token })).status).toBe(410);
    // Another field leaves it alone.
    await ok('POST', `/people/employees/${id}/invite`, { ...as(), body: {} });
    expect((await ok('PATCH', `/people/employees/${id}`, { ...as(), body: { jobTitle: 'Engineer' } })).account).toBe('invited');
  });
});

describe('Link to member and Unlink (spec 4.6)', () => {
  it('merges the automatic record into the chosen one; unlinking gives the member a new automatic record', async () => {
    const joiner = await signIn('life-link');
    const automatic = await joinAsEmployee(owner, tenant, joiner);
    const real = await rawCreate({ firstName: 'Stvarni', lastName: 'Zapis', jobTitle: 'Technician' });

    const candidates = await ok('GET', `/people/employees/${real}/link-candidates`, as());
    expect(candidates.find((c: { userId: string }) => c.userId === joiner.userId)).toMatchObject({ employeeId: automatic, mergeable: true, blockers: [] });
    expect((await call('GET', `/people/employees/${real}/link-candidates`, as(hr))).status).toBe(403);
    expect((await call('POST', `/people/employees/${real}/link`, { ...as(hr), body: { userId: joiner.userId } })).status).toBe(403);

    const linked = await ok('POST', `/people/employees/${real}/link`, { ...as(), body: { userId: joiner.userId } }, 200);
    expect(linked).toMatchObject({ account: 'linked', userId: joiner.userId, jobTitle: 'Technician' });
    expect((await call('GET', `/people/employees/${automatic}`, as())).status).toBe(404);
    expect((await accessOf(joiner, tenant)).employeeId).toBe(real);

    const unlinked = await ok('POST', `/people/employees/${real}/unlink`, as(), 200);
    expect(unlinked).toMatchObject({ account: 'none', userId: null, jobTitle: 'Technician' });
    const fresh = (await accessOf(joiner, tenant)).employeeId;
    expect(fresh).toBeTruthy();
    expect(fresh).not.toBe(real);
    // A record that was linked once can't be deleted.
    expect((await call('DELETE', `/people/employees/${real}`, as())).status).toBe(409);
  });

  it('refuses to merge a record that holds data of its own', async () => {
    const joiner = await signIn('life-busy');
    const own = await joinAsEmployee(owner, tenant, joiner);
    await ok('PATCH', `/people/employees/${own}`, { ...as(), body: { managerId: memberEmployee } });
    const target = await rawCreate({ firstName: 'Ciljni', lastName: 'Zapis' });
    const candidates = await ok('GET', `/people/employees/${target}/link-candidates`, as());
    expect(candidates.find((c: { userId: string }) => c.userId === joiner.userId)).toMatchObject({ mergeable: false, blockers: ['a manager'] });
    const refused = await call('POST', `/people/employees/${target}/link`, { ...as(), body: { userId: joiner.userId } });
    expect(refused.status).toBe(409);
    expect(refused.body.message).toContain("can't be merged");
    expect((await accessOf(joiner, tenant)).employeeId).toBe(own);
  });
});

describe('Deactivate and reactivate (spec 4.8)', () => {
  it('with a past last working day: inactive now, reports moved, lead replaced, membership gone', async () => {
    const leaver = await signIn('life-leaver');
    const boss = await create({ firstName: 'Šef', lastName: 'Odeljenja' });
    const leaving = await joinAsEmployee(owner, tenant, leaver);
    await ok('PATCH', `/people/employees/${leaving}`, { ...as(), body: { managerId: boss } });
    const report = await create({ firstName: 'Direktni', lastName: 'Izveštaj', managerId: leaving });
    const department = await createDepartment(tenant, 'Leaving dept');
    const team = await createTeam(tenant, department, 'Leaving team');
    await asTenantSql(tenant, `update org_units set lead_employee_id = $1 where id = $2`, [leaving, team]);
    await asTenantSql(tenant, `update employees set unit_id = $2 where id = $1`, [leaving, team]);
    const before = await card(leaving);
    expect(before.permissions).toMatchObject({ canDeactivate: true, canReactivate: false });

    // A manager for the direct report is required; a loop is refused.
    const lastDay = addDays(todayIn('Europe/Belgrade'), -1);
    expect((await call('POST', `/people/employees/${leaving}/deactivate`, { ...as(), body: { lastWorkingDay: lastDay } })).status).toBe(400);
    const loop = await call('POST', `/people/employees/${leaving}/deactivate`, { ...as(), body: { lastWorkingDay: lastDay, reportsManagerId: report } });
    // The report chosen as the new manager goes to the skip level instead: no loop, allowed.
    expect(loop.status).toBe(200);
    expect(loop.body).toMatchObject({ status: 'inactive', account: 'none', userId: null });
    expect(loop.body.employment).toMatchObject({ endDate: lastDay, leavingReason: null });
    expect((await card(report)).manager.id).toBe(boss);
    const units = await ok('GET', '/people/org-units', as());
    expect(units.find((u: { id: string }) => u.id === team).leadEmployeeId).toBeNull();
    // Access ended.
    expect((await membersOf()).some((m) => m.userId === leaver.userId)).toBe(false);
    expect((await call('GET', '/people/access', { token: leaver.token, tenant })).status).toBe(403);
    // Hidden from members, visible to Admins.
    expect((await call('GET', `/people/employees/${leaving}`, as(member))).status).toBe(404);
    expect((await call('GET', `/people/employees/${leaving}`, as(hr))).status).toBe(404);
    expect((await card(leaving)).status).toBe('inactive');
    // Not again.
    expect((await call('POST', `/people/employees/${leaving}/deactivate`, { ...as(), body: { lastWorkingDay: lastDay } })).status).toBe(409);
  });

  it('moves the reports to the chosen manager and the lead to the chosen replacement', async () => {
    const leaving = await create({ firstName: 'Odlazi', lastName: 'Sada' });
    const r1 = await create({ firstName: 'Prvi', lastName: 'Izveštaj', managerId: leaving });
    const r2 = await create({ firstName: 'Drugi', lastName: 'Izveštaj', managerId: leaving });
    const successor = await create({ firstName: 'Naslednik', lastName: 'Novi' });
    const department = await createDepartment(tenant, 'Succession dept');
    const team = await createTeam(tenant, department, 'Succession team');
    await asTenantSql(tenant, `update org_units set lead_employee_id = $1 where id = $2`, [leaving, team]);
    const done = await ok(
      'POST',
      `/people/employees/${leaving}/deactivate`,
      { ...as(), body: { lastWorkingDay: todayIn('Europe/Belgrade'), reason: 'resigned', reportsManagerId: successor, unitLeads: [{ unitId: team, employeeId: successor }] } },
      200,
    );
    expect(done.status).toBe('inactive');
    expect(done.employment.leavingReason).toBe('resigned');
    expect((await card(r1)).manager.id).toBe(successor);
    expect((await card(r2)).manager.id).toBe(successor);
    expect((await ok('GET', '/people/org-units', as())).find((u: { id: string }) => u.id === team).leadEmployeeId).toBe(successor);
    // The new lead joined the unit (CD-226).
    expect((await card(successor)).unitId).toBe(team);
    // History records it (who left, when).
    const { entries } = await ok('GET', `/people/history?entityType=employee&entityId=${leaving}`, as());
    expect(entries.map((e: { field: string | null }) => e.field)).toEqual(expect.arrayContaining(['deactivatedAt', 'employmentEndDate', 'leavingReason']));
  });

  it('refuses a loop: the new manager may not sit under one of the reports', async () => {
    const leaving = await create({ firstName: 'Petlja', lastName: 'Vođa' });
    const report = await create({ firstName: 'Petlja', lastName: 'Izveštaj', managerId: leaving });
    const below = await create({ firstName: 'Petlja', lastName: 'Ispod', managerId: report });
    const res = await call('POST', `/people/employees/${leaving}/deactivate`, { ...as(), body: { lastWorkingDay: todayIn('Europe/Belgrade'), reportsManagerId: below } });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('reporting_loop');
    expect((await card(leaving)).status).toBe('active');
  });

  it('a future last working day: "Leaving" until the daily job applies it after midnight in the workspace time zone', async () => {
    const zone = 'Asia/Tokyo';
    await ok('PATCH', '/workspace', { ...as(), body: { timezone: zone } });
    try {
      const today = todayIn(zone);
      const lastDay = addDays(today, 3);
      const nextLastDay = addDays(today, 4);
      const leaver = await signIn('life-future');
      const leaving = await joinAsEmployee(owner, tenant, leaver);
      const later = await create({ firstName: 'Kasnije', lastName: 'Odlazi' });
      const report = await create({ firstName: 'Ostaje', lastName: 'Ovde', managerId: leaving });
      const heir = await create({ firstName: 'Novi', lastName: 'Šef' });

      const scheduled = await ok('POST', `/people/employees/${leaving}/deactivate`, { ...as(), body: { lastWorkingDay: lastDay, reason: 'contract_ended', reportsManagerId: heir } }, 200);
      expect(scheduled).toMatchObject({ status: 'leaving', account: 'linked' });
      expect(scheduled.employment).toMatchObject({ endDate: lastDay, deactivatedAt: null });
      expect(scheduled.permissions.canReactivate).toBe(true);
      await ok('POST', `/people/employees/${later}/deactivate`, { ...as(), body: { lastWorkingDay: nextLastDay } }, 200);
      // Until then the person keeps access and their reports.
      expect((await accessOf(leaver, tenant)).directReportIds).toEqual([report]);
      // A colleague without HR rights still sees them as active.
      expect((await card(leaving, member)).status).toBe('active');

      // 00:10 in Tokyo the day after the last working day is still that day in UTC: the job must
      // use the workspace's zone. The other person's last day isn't over yet.
      const now = new Date(`${addDays(lastDay, 1)}T00:10:00+09:00`).toISOString();
      await ok('POST', '/dev/people/deactivate-due', { ...as(), body: { now } }, 202);
      await eventually(async () => (await card(leaving)).status === 'inactive', 'the scheduled deactivation');
      expect((await card(report)).manager.id).toBe(heir);
      expect((await card(later)).status).toBe('leaving');
      expect((await membersOf()).some((m) => m.userId === leaver.userId)).toBe(false);
      expect((await card(leaving)).employment).toMatchObject({ endDate: lastDay, leavingReason: 'contract_ended' });

      // Reactivate on someone leaving cancels it.
      const cancelled = await ok('POST', `/people/employees/${later}/reactivate`, { ...as(), body: {} }, 200);
      expect(cancelled.status).toBe('active');
      expect(cancelled.employment.endDate).toBeNull();
    } finally {
      await ok('PATCH', '/workspace', { ...as(), body: { timezone: 'Europe/Belgrade' } });
    }
  });

  it('reactivating a rehire needs a new start date and leaves them without an account', async () => {
    const leaving = await create({ firstName: 'Povratak', lastName: 'Kući', workEmail: 'rehire-life@example.test' });
    const restart = addDays(todayIn('Europe/Belgrade'), 7);
    await ok('POST', `/people/employees/${leaving}/deactivate`, { ...as(), body: { lastWorkingDay: todayIn('Europe/Belgrade') } }, 200);
    expect((await call('POST', `/people/employees/${leaving}/invite`, { ...as(), body: {} })).status).toBe(409);
    expect((await call('POST', `/people/employees/${leaving}/reactivate`, { ...as(), body: {} })).status).toBe(400);
    expect((await call('POST', `/people/employees/${leaving}/reactivate`, { ...as(member), body: { employmentStartDate: restart } })).status).toBe(403);
    expect((await call('POST', `/people/employees/${leaving}/reactivate`, { ...as(hr), body: { employmentStartDate: restart } })).status).toBe(403);
    const back = await ok('POST', `/people/employees/${leaving}/reactivate`, { ...as(), body: { employmentStartDate: restart } }, 200);
    expect(back).toMatchObject({ status: 'active', account: 'none', workEmail: 'rehire-life@example.test' });
    expect(back.employment).toMatchObject({ startDate: restart, endDate: null, deactivatedAt: null, leavingReason: null });
  });

  it('guards: the last owner, the only Admin, the 90-day limit and who may deactivate', async () => {
    const ownerEmployee = (await accessOf(owner, tenant)).employeeId;
    const today = todayIn('Europe/Belgrade');
    // The owner is the only Admin.
    const self = await call('POST', `/people/employees/${ownerEmployee}/deactivate`, { ...as(), body: { lastWorkingDay: today, reportsManagerId: null } });
    expect(self.status).toBe(409);
    expect(self.body.message).toContain('only Admin');
    const someone = await create({ firstName: 'Neko', lastName: 'Treći' });
    expect((await call('POST', `/people/employees/${someone}/deactivate`, { ...as(), body: { lastWorkingDay: addDays(today, -91) } })).status).toBe(400);
    // Only Admins deactivate: a member, with a leftover Administration row too, gets 403, and nobody's own card offers it but an Admin's.
    expect((await call('POST', `/people/employees/${someone}/deactivate`, { ...as(member), body: { lastWorkingDay: today } })).status).toBe(403);
    expect((await call('POST', `/people/employees/${hrEmployee}/deactivate`, { ...as(hr), body: { lastWorkingDay: today } })).status).toBe(403);
    expect((await card(hrEmployee, hr)).permissions.canDeactivate).toBe(false);
    expect((await card(someone, member)).permissions).toMatchObject({ canDeactivate: false, canInvite: false, canLink: false, canDelete: false });

    // Another Admin may not remove the last owner either.
    await ok('PATCH', `/team/members/${hr.userId}`, { ...as(), body: { role: 'admin' } }, 200);
    try {
      const last = await call('POST', `/people/employees/${ownerEmployee}/deactivate`, { ...as(hr), body: { lastWorkingDay: today, reportsManagerId: null } });
      expect(last.status).toBe(409);
      expect(last.body.message).toContain('Make someone else an owner first');
      // A future date is checked the same way when it is scheduled.
      expect((await call('POST', `/people/employees/${ownerEmployee}/deactivate`, { ...as(hr), body: { lastWorkingDay: addDays(today, 10), reportsManagerId: null } })).status).toBe(409);
      // With another Admin left, an Admin's own card offers it.
      expect((await card(hrEmployee, hr)).permissions.canDeactivate).toBe(true);
    } finally {
      await ok('PATCH', `/team/members/${hr.userId}`, { ...as(), body: { role: 'member' } }, 200);
    }
  });
});

describe('Delete (spec 4.8, CD-225)', () => {
  it('only an Admin, only once deactivated, former app users included; history keeps a "deleted" row', async () => {
    const today = todayIn('Europe/Belgrade');
    const wrong = await create({ firstName: 'Pogrešan', lastName: 'Red' });
    expect((await card(wrong)).permissions.canDelete).toBe(false);
    const active = await call('DELETE', `/people/employees/${wrong}`, as());
    expect(active.status).toBe(409);
    expect(active.body.message).toBe('Pogrešan Red is still active. Deactivate first, then delete.');
    await ok('POST', `/people/employees/${wrong}/deactivate`, { ...as(), body: { lastWorkingDay: today } }, 200);
    expect((await card(wrong)).permissions.canDelete).toBe(true);
    expect((await call('DELETE', `/people/employees/${wrong}`, as(hr))).status).toBe(403);
    expect((await call('DELETE', `/people/employees/${wrong}`, as(member))).status).toBe(403);
    await ok('DELETE', `/people/employees/${wrong}`, as());
    expect((await call('GET', `/people/employees/${wrong}`, as())).status).toBe(404);

    // A former app user: deactivating ended their membership, then the record can go too.
    expect((await card(memberEmployee)).permissions.canDelete).toBe(false);
    expect((await call('DELETE', `/people/employees/${memberEmployee}`, as())).status).toBe(409);
    const leaver = await signIn('life-delete');
    const leaverEmployee = await joinAsEmployee(owner, tenant, leaver);
    await ok('POST', `/people/employees/${leaverEmployee}/deactivate`, { ...as(), body: { lastWorkingDay: today } }, 200);
    await ok('DELETE', `/people/employees/${leaverEmployee}`, as());
    expect((await call('GET', `/people/employees/${leaverEmployee}`, as())).status).toBe(404);
    const history = await ok('GET', `/people/history?entityType=employee&entityId=${leaverEmployee}`, as());
    expect(history.entries[0]).toMatchObject({ action: 'deleted' });
  });
});
