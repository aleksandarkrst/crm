/**
 * Time from the task and work order pages (CD-276): entries written through /api/timesheet/entries
 * show on the task's Time card, the work order's Track time card and in the weekly timesheet; who
 * sees whose entries; Edit and Delete only on the person's own entries on Draft or Rejected days;
 * Start → End on work orders; the daily maximum; and the locks (a completed work order, a closed
 * project: 423).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { addMember, call, createTenant, ok, type Session, signIn } from './helpers';
import { accessOf, asTenantSql } from './people-helpers';

interface Entry {
  id: string;
  employeeId: string;
  name: string;
  date: string;
  minutes: number;
  note: string | null;
  startTime: string | null;
  endTime: string | null;
  dayStatus: string;
  mine: boolean;
  canChange: boolean;
}
interface Card {
  loggedMinutes: number;
  estimateMinutes?: number | null;
  plannedMinutes?: number;
  entries: Entry[];
  canLog: boolean;
  lock: { kind: string; title: string; text: string } | null;
}

let owner: Session;
let ana: Session;
let marko: Session;
let petar: Session;
let tenant: string;
let anaId: string;
let markoId: string;
let companyId: string;
let projectId: string;
let monday: string;

const as = (s: Session) => ({ token: s.token, tenant });
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const taskCard = (id: string, s: Session) => ok<Card>('GET', `/tasks/${id}/time`, as(s));
const orderCard = (id: string, s: Session) => ok<Card>('GET', `/work-orders/${id}/time`, as(s));
const log = (s: Session, body: Record<string, unknown>) => call<Entry>('POST', '/timesheet/entries', { ...as(s), body });

beforeAll(async () => {
  [owner, ana, marko, petar] = await Promise.all([signIn('tc-owner'), signIn('tc-ana'), signIn('tc-marko'), signIn('tc-petar')]);
  tenant = await createTenant(owner, 'Time cards');
  for (const s of [ana, marko, petar]) await addMember(owner, tenant, s, 'member');
  anaId = (await accessOf(ana, tenant)).employeeId;
  markoId = (await accessOf(marko, tenant)).employeeId;
  const petarId = (await accessOf(petar, tenant)).employeeId;
  await ok('POST', '/people/reporting-lines', { ...as(owner), body: { employeeIds: [markoId], managerId: petarId } }, 200);
  for (const id of [anaId, markoId]) await ok('PATCH', `/people/employees/${id}`, { ...as(owner), body: { workType: 'both' } });
  companyId = (await ok<{ id: string }>('POST', '/crm/companies', { ...as(owner), body: { name: 'Hidrogradnja' } })).id;
  const [type] = await ok<{ id: string }[]>('GET', '/project-types', as(owner));
  projectId = (await ok<{ id: string }>('POST', '/projects', { ...as(owner), body: { name: 'Engine overhaul, CAT 336', projectTypeId: type!.id, companyId, leadUserId: owner.userId } })).id;
  monday = (await ok<{ thisWeek: string }>('GET', '/timesheet/week', as(ana))).thisWeek;
});

describe('the task Time card', () => {
  let task: string;

  beforeAll(async () => {
    task = (await ok<{ id: string }>('POST', '/tasks', { ...as(owner), body: { projectId, name: 'Dismantle and inspect engine', assigneeIds: [anaId, markoId], estimateHours: 10 } })).id;
  });

  it('an entry logged here shows on the card and in the timesheet cell (AC 1)', async () => {
    const res = await log(ana, { taskId: task, date: monday, minutes: 120, note: 'Cylinder head off' });
    expect(res.status).toBe(201);
    const card = await taskCard(task, ana);
    expect(card).toMatchObject({ loggedMinutes: 120, estimateMinutes: 600, canLog: true, lock: null });
    expect(card.entries).toEqual([expect.objectContaining({ id: res.body.id, minutes: 120, note: 'Cylinder head off', mine: true, canChange: true, dayStatus: 'draft' })]);
    const week = await ok<{ rows: { id: string; cells: Record<string, { minutes: number }> }[] }>('GET', '/timesheet/week', as(ana));
    expect(week.rows.find((r) => r.id === task)!.cells[monday]!.minutes).toBe(120);
  });

  it("shows others' entries only to the lead, owners and admins and the person's managers", async () => {
    await ok('POST', '/timesheet/entries', { ...as(marko), body: { taskId: task, date: monday, minutes: 60 } });
    const anaSees = await taskCard(task, ana);
    expect(anaSees.loggedMinutes).toBe(180);
    expect(anaSees.entries.map((e) => e.employeeId)).toEqual([anaId]);
    expect((await taskCard(task, owner)).entries.map((e) => e.employeeId).sort()).toEqual([anaId, markoId].sort());
    const petarSees = await taskCard(task, petar);
    expect(petarSees.entries.map((e) => e.employeeId)).toEqual([markoId]);
    expect(petarSees.entries[0]).toMatchObject({ mine: false, canChange: false });
    expect(petarSees.canLog).toBe(false);
  });

  it('edits and deletes only your own entries', async () => {
    const [mine] = (await taskCard(task, ana)).entries;
    const updated = await ok<Entry>('PATCH', `/timesheet/entries/${mine!.id}`, { ...as(ana), body: { minutes: 180, note: 'Gaskets ordered', date: addDays(monday, 1) } });
    expect(updated).toMatchObject({ minutes: 180, note: 'Gaskets ordered', date: addDays(monday, 1) });
    const [markos] = (await taskCard(task, owner)).entries.filter((e) => e.employeeId === markoId);
    expect((await call('PATCH', `/timesheet/entries/${markos!.id}`, { ...as(ana), body: { minutes: 30 } })).status).toBe(404);
    expect((await call('DELETE', `/timesheet/entries/${markos!.id}`, as(ana))).status).toBe(404);
    expect((await call('PATCH', `/timesheet/entries/${mine!.id}`, { ...as(ana), body: {} })).status).toBe(400);
  });

  it('a submitted or approved day hides Edit and Delete; a rejected one shows them again (AC 2)', async () => {
    const day = addDays(monday, 1);
    const [mine] = (await taskCard(task, ana)).entries;
    await asTenantSql(tenant, `insert into timesheet_days (tenant_id, employee_id, work_date, status) values ($1, $2, $3, 'submitted')`, [tenant, anaId, day]);
    expect((await taskCard(task, ana)).entries[0]).toMatchObject({ dayStatus: 'submitted', canChange: false });
    expect((await call('PATCH', `/timesheet/entries/${mine!.id}`, { ...as(ana), body: { minutes: 60 } })).status).toBe(409);
    await asTenantSql(tenant, `update timesheet_days set status = 'approved' where employee_id = $1 and work_date = $2`, [anaId, day]);
    expect((await taskCard(task, ana)).entries[0]).toMatchObject({ dayStatus: 'approved', canChange: false });
    expect((await call('DELETE', `/timesheet/entries/${mine!.id}`, as(ana))).status).toBe(423);
    // Moving an entry onto a locked day is refused too.
    const other = await ok<Entry>('POST', '/timesheet/entries', { ...as(ana), body: { taskId: task, date: monday, minutes: 30 } });
    expect((await call('PATCH', `/timesheet/entries/${other.id}`, { ...as(ana), body: { date: day } })).status).toBe(423);
    await asTenantSql(tenant, `update timesheet_days set status = 'rejected' where employee_id = $1 and work_date = $2`, [anaId, day]);
    expect((await taskCard(task, ana)).entries.find((e) => e.id === mine!.id)).toMatchObject({ dayStatus: 'rejected', canChange: true });
    await ok('PATCH', `/timesheet/entries/${mine!.id}`, { ...as(ana), body: { minutes: 120 } });
    await ok('DELETE', `/timesheet/entries/${other.id}`, as(ana), 204);
  });

  it('refuses more than 12 h on one day, and someone not on the task', async () => {
    const day = addDays(monday, 2);
    await ok('POST', '/timesheet/entries', { ...as(ana), body: { taskId: task, date: day, minutes: 600 } });
    const over = await log(ana, { taskId: task, date: day, minutes: 135 });
    expect(over.status).toBe(400);
    expect(JSON.stringify(over.body)).toContain('Maximum 12 h per day');
    expect((await log(petar, { taskId: task, date: day, minutes: 60 })).status).toBe(403);
    expect((await log(ana, { taskId: task, date: addDays(monday, 7), minutes: 60 })).status).toBe(400);
    expect((await log(ana, { taskId: task, date: day })).status).toBe(400);
  });

  it('a closed project locks the card: no new entries (423) and the hint says when (AC 3)', async () => {
    const [type] = await ok<{ id: string }[]>('GET', '/project-types', as(owner));
    const closing = (await ok<{ id: string }>('POST', '/projects', { ...as(owner), body: { name: 'Excavator fleet audit', projectTypeId: type!.id, companyId, leadUserId: owner.userId } })).id;
    const t = (await ok<{ id: string }>('POST', '/tasks', { ...as(owner), body: { projectId: closing, name: 'Final test run', assigneeIds: [anaId] } })).id;
    await ok('POST', '/timesheet/entries', { ...as(ana), body: { taskId: t, date: monday, minutes: 240 } });
    await ok('PATCH', `/projects/${closing}`, { ...as(owner), body: { status: 'completed' } });
    const card = await taskCard(t, ana);
    expect(card.canLog).toBe(false);
    expect(card.lock?.kind).toBe('project_closed');
    expect(card.lock?.title).toMatch(/^Hidrogradnja › Excavator fleet audit was completed on \w{3} \d{1,2} \w{3}\.$/);
    expect(card.entries[0]).toMatchObject({ minutes: 240, canChange: false });
    const refused = await log(ana, { taskId: t, date: monday, minutes: 60 });
    expect(refused.status).toBe(423);
    expect((await call('DELETE', `/timesheet/entries/${card.entries[0]!.id}`, as(ana))).status).toBe(423);
  });
});

describe('the work order Track time card', () => {
  let order: string;

  beforeAll(async () => {
    order = (await ok<{ id: string }>('POST', '/work-orders', { ...as(owner), body: { title: 'Hydraulic leak, CAT 320', companyId, technicianIds: [anaId], durationHours: 4 } })).id;
  });

  it('logs Start → End; the hours are the duration and show in the timesheet', async () => {
    const res = await log(ana, { workOrderId: order, date: monday, startTime: '08:00', endTime: '10:30', note: 'Replaced the pressure hose' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ minutes: 150, startTime: '08:00', endTime: '10:30' });
    const card = await orderCard(order, ana);
    expect(card).toMatchObject({ loggedMinutes: 150, plannedMinutes: 240, canLog: true, lock: null });
    expect((await log(ana, { workOrderId: order, date: monday, startTime: '10:30', endTime: '10:00' })).status).toBe(400);
    expect((await log(ana, { workOrderId: order, date: monday, startTime: '10:30' })).status).toBe(400);
    // Changing the hours in the timesheet moves the end.
    await ok('PUT', '/timesheet/cells', { ...as(ana), body: { date: monday, workOrderId: order, minutes: 180 } });
    expect((await orderCard(order, ana)).entries[0]).toMatchObject({ minutes: 180, startTime: '08:00', endTime: '11:00' });
    // And changing Start → End changes the hours.
    const updated = await ok<Entry>('PATCH', `/timesheet/entries/${res.body.id}`, { ...as(ana), body: { startTime: '09:00', endTime: '12:15' } });
    expect(updated.minutes).toBe(195);
  });

  it("only technicians log; others don't see the entries but see the total", async () => {
    expect((await log(marko, { workOrderId: order, date: monday, minutes: 60 })).status).toBe(403);
    const markoSees = await orderCard(order, marko);
    expect(markoSees).toMatchObject({ canLog: false, entries: [], loggedMinutes: 195 });
    expect((await orderCard(order, owner)).entries).toHaveLength(1);
  });

  it('a completed work order takes no new time (423) and locks its entries', async () => {
    await ok('PATCH', `/work-orders/${order}`, { ...as(owner), body: { status: 'completed' } });
    const card = await orderCard(order, ana);
    expect(card).toMatchObject({ canLog: false, lock: { kind: 'completed' } });
    expect(card.entries[0]!.canChange).toBe(false);
    expect((await log(ana, { workOrderId: order, date: monday, minutes: 60 })).status).toBe(423);
    expect((await call('PATCH', `/timesheet/entries/${card.entries[0]!.id}`, { ...as(ana), body: { note: 'late note' } })).status).toBe(423);
  });
});
