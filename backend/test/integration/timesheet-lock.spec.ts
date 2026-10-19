/**
 * Lock approved days (CD-159, spec 9): approval snapshots the day; only Admins unlock, never their
 * own days, with a reason of at least 10 characters; the day goes back as Rejected with the reason,
 * the Late flag stays, the employee and the approver are emailed, and the history (day events and
 * every entry change, written by the database trigger) is readable by the employee, their approvers
 * and Admins, oldest first.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { call, createTenant, eventually, type Mail, mailTo, ok, type Session, signIn, testPib } from './helpers';
import { asTenantSql, joinAsEmployee } from './people-helpers';

interface Day {
  date: string;
  status: string;
  comment: string | null;
  approvedBy: string | null;
  approvedExpectedMinutes: number | null;
  approvedMinutes: number | null;
  reply: string | null;
}
interface Week {
  thisWeek: string;
  status: string;
  late: boolean;
  days: Day[];
}
interface History {
  events: { date: string; kind: string; actorName: string | null; comment: string | null; at: string }[];
  changes: { date: string; action: string; field: string | null; from: unknown; to: unknown; row: string; minutes: number; actorName: string | null; at: string }[];
}

let owner: Session, marko: Session, dragan: Session, peer: Session;
let tenant: string, ownerId: string, draganId: string, monday: string, taskId: string;
const as = (s: Session) => ({ token: s.token, tenant });
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const week = (s: Session = dragan) => ok<Week>('GET', `/timesheet/week?week=${monday}`, as(s));
const unlock = (s: Session, body: Record<string, unknown>) => call<{ week: Week; message?: string }>('POST', '/timesheet/approvals/unlock', { ...as(s), body: { employeeId: draganId, weekStart: monday, ...body } });
const history = (s: Session, id = draganId) => ok<History>('GET', `/timesheet/approvals/${id}/history?week=${monday}`, as(s));

beforeAll(async () => {
  [owner, marko, dragan, peer] = (await Promise.all(['owner', 'marko', 'dragan', 'peer'].map((n) => signIn(`tsl-${n}`)))) as [Session, Session, Session, Session];
  tenant = await createTenant(owner, 'Lock');
  const markoId = await joinAsEmployee(owner, tenant, marko);
  draganId = await joinAsEmployee(owner, tenant, dragan);
  await joinAsEmployee(owner, tenant, peer);
  ownerId = (await ok<{ employeeId: string }>('GET', '/people/access', as(owner))).employeeId;
  await asTenantSql(tenant, 'update employees set manager_id = $2 where id = $1', [draganId, markoId]);
  const company = await ok<{ id: string }>('POST', '/crm/companies', { ...as(owner), body: { pib: testPib(), name: 'Hidrogradnja' } });
  const [type] = await ok<{ id: string }[]>('GET', '/project-types', as(owner));
  const project = await ok<{ id: string }>('POST', '/projects', { ...as(owner), body: { name: 'Engine overhaul', projectTypeId: type!.id, companyId: company.id } });
  taskId = (await ok<{ id: string }>('POST', '/tasks', { ...as(owner), body: { projectId: project.id, name: 'Inspect engine', assigneeIds: [draganId] } })).id;
  monday = (await ok<{ thisWeek: string }>('GET', '/timesheet/week', as(dragan))).thisWeek;
  for (let i = 0; i < 5; i++) await ok('PUT', '/timesheet/cells', { ...as(dragan), body: { date: addDays(monday, i), taskId, minutes: 480 } });
  // Thursday's hours were corrected before submission: the history has that too.
  await ok('PUT', '/timesheet/cells', { ...as(dragan), body: { date: addDays(monday, 3), taskId, minutes: 420, note: 'Left early' } });
  await ok('POST', '/timesheet/submit', { ...as(dragan), body: { weekStart: monday } });
  await ok('POST', '/timesheet/approvals/approve', { ...as(marko), body: { employeeId: draganId, weekStart: monday } });
});

describe('lock approved days (CD-159)', () => {
  it('approval snapshots the day and locks its entries for everyone, the database included', async () => {
    const w = await week();
    expect(w.status).toBe('approved');
    expect(w.days[0]).toMatchObject({ status: 'approved', approvedBy: marko.name, approvedExpectedMinutes: 480, approvedMinutes: 480 });
    expect(w.days[3]).toMatchObject({ approvedMinutes: 420 });
    expect((await call('PUT', '/timesheet/cells', { ...as(dragan), body: { date: monday, taskId, minutes: 240 } })).status).toBe(423);
    await expect(asTenantSql(tenant, `update time_entries set minutes = 240 where employee_id = $1 and work_date = $2`, [draganId, monday])).rejects.toThrow(/approved and locked/);
  });

  it('only Admins unlock, never their own days, with a reason of at least 10 characters', async () => {
    expect((await unlock(marko, { dates: [monday], reason: 'Wrong work order on Monday.' })).status).toBe(403);
    expect((await unlock(dragan, { dates: [monday], reason: 'Wrong work order on Monday.' })).status).toBe(403);
    expect((await unlock(owner, { employeeId: ownerId, dates: [monday], reason: 'Wrong work order on Monday.' })).status).toBe(403);
    expect((await unlock(owner, { dates: [monday], reason: 'Too short' })).status).toBe(400);
    expect((await unlock(owner, { dates: [addDays(monday, 5)], reason: 'Saturday was never approved.' })).body.message).toBe('Only approved days can be unlocked');
    expect((await week()).days[0]!.status).toBe('approved');
  });

  it('unlocks a day: back with the employee as Rejected with the reason, Late unchanged, history, audit and two emails', async () => {
    const before = await week();
    const res = await unlock(owner, { dates: [addDays(monday, 1)], reason: 'Payroll found 2 h on the wrong work order.' });
    expect(res.status).toBe(201);
    const tuesday = res.body.week.days[1]!;
    expect(tuesday).toMatchObject({ status: 'rejected', comment: 'Payroll found 2 h on the wrong work order.', approvedBy: null, approvedExpectedMinutes: null, approvedMinutes: null });
    expect(res.body.week.days[0]!.status).toBe('approved');
    expect(res.body.week.status).toBe('rejected');
    expect(res.body.week.late).toBe(before.late);
    expect((await call('PUT', '/timesheet/cells', { ...as(dragan), body: { date: addDays(monday, 1), taskId, minutes: 360 } })).status).toBe(200);
    const [event] = await asTenantSql<{ comment: string; actor_name: string }>(tenant, `select comment, actor_name from timesheet_day_events where employee_id = $1 and kind = 'unlocked'`, [draganId]);
    expect(event).toMatchObject({ comment: 'Payroll found 2 h on the wrong work order.', actor_name: owner.name });
    const [audit] = await asTenantSql<{ data: { days: string[]; reason: string } }>(tenant, `select data from audit_logs where action = 'timesheet.day_unlocked' and entity_id = $1`, [draganId]);
    expect(audit!.data).toEqual({ weekStart: monday, days: [addDays(monday, 1)], reason: 'Payroll found 2 h on the wrong work order.' });
    for (const [s, link] of [
      [dragan, `/timesheet?week=${monday}`],
      [marko, `/approvals/${draganId}?week=${monday}`],
    ] as const) {
      const mail = await eventually(async () => (await mailTo(owner, s.email)).find((m: Mail) => m.subject.startsWith('Timesheet day unlocked')), `the unlocked email to ${s.name}`);
      expect(mail.text).toContain('Payroll found 2 h on the wrong work order.');
      expect(mail.text).toContain(link);
    }
  });

  it('the history lists every status change and entry change, oldest first, for the employee, the approver and Admins; not for peers', async () => {
    const h = await history(dragan);
    expect(h.events.filter((e) => e.kind === 'submitted')).toHaveLength(5);
    expect(h.events.filter((e) => e.kind === 'approved')).toHaveLength(5);
    expect(h.events.filter((e) => e.kind === 'unlocked')).toEqual([expect.objectContaining({ date: addDays(monday, 1), actorName: owner.name, comment: 'Payroll found 2 h on the wrong work order.' })]);
    expect(h.changes.filter((c) => c.action === 'created')).toHaveLength(5);
    const thursday = h.changes.filter((c) => c.date === addDays(monday, 3) && c.action === 'updated');
    expect(thursday.map((c) => [c.field, c.from, c.to])).toEqual(
      expect.arrayContaining([
        ['minutes', 480, 420],
        ['note', null, 'Left early'],
      ]),
    );
    expect(thursday[0]).toMatchObject({ row: expect.stringMatching(/^T-\d+ Inspect engine$/), actorName: dragan.name });
    const afterUnlock = h.changes.find((c) => c.date === addDays(monday, 1) && c.field === 'minutes');
    expect(afterUnlock).toMatchObject({ from: 480, to: 360 });
    expect(h.events.map((e) => e.at)).toEqual([...h.events.map((e) => e.at)].sort());
    expect((await history(marko)).events.length).toBe(h.events.length);
    expect((await history(owner)).changes.length).toBe(h.changes.length);
    await ok('GET', `/timesheet/approvals/${draganId}/history?week=${monday}`, as(peer), 403);
    // From another workspace Dragan does not exist: neither his history nor an unlock of his days.
    const elsewhere = { token: peer.token, tenant: await createTenant(peer, 'Other lock tenant') };
    await ok('GET', `/timesheet/approvals/${draganId}/history?week=${monday}`, elsewhere, 404);
    expect((await call('POST', '/timesheet/approvals/unlock', { ...elsewhere, body: { employeeId: draganId, weekStart: monday, dates: [monday], reason: 'Trying from another workspace.' } })).status).toBe(404);
    expect((await week()).days[0]!.status).toBe('approved');
  });

  it('the trigger records a direct database change and a deleted entry, with no actor', async () => {
    await asTenantSql(tenant, `update time_entries set minutes = 300 where employee_id = $1 and work_date = $2`, [draganId, addDays(monday, 1)]);
    await ok('PUT', '/timesheet/cells', { ...as(dragan), body: { date: addDays(monday, 1), taskId, minutes: 0 } });
    const h = await history(dragan);
    expect(h.changes.find((c) => c.date === addDays(monday, 1) && c.from === 360 && c.to === 300)).toMatchObject({ actorName: null });
    expect(h.changes.find((c) => c.date === addDays(monday, 1) && c.action === 'deleted')).toMatchObject({ minutes: 300, actorName: dragan.name });
  });
});
