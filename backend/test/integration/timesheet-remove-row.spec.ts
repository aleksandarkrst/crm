/**
 * The row's X (CD-354): a row goes from the week with the person's hours on it; hours on a
 * submitted day keep it until the week is recalled; nobody else's hours are touched.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { addMember, call, createTenant, ok, type Session, signIn, testPib } from './helpers';
import { accessOf } from './people-helpers';

interface Week {
  thisWeek: string;
  today: string;
  rows: { kind: string; id: string; minutes: number }[];
}

let owner: Session, ana: Session;
let tenant: string, anaId: string, taskId: string, otherTaskId: string, monday: string, today: string;
const as = (s: Session = owner) => ({ token: s.token, tenant });
const week = (s: Session = ana) => ok<Week>('GET', '/timesheet/week', as(s));
const remove = (id: string) => call<Week>('POST', '/timesheet/rows/remove', { ...as(ana), body: { weekStart: monday, taskId: id } });

beforeAll(async () => {
  [owner, ana] = await Promise.all([signIn('trr-owner'), signIn('trr-ana')]);
  tenant = await createTenant(owner, 'Remove a row');
  await addMember(owner, tenant, ana, 'member');
  anaId = (await accessOf(ana, tenant)).employeeId;
  const company = await ok<{ id: string }>('POST', '/crm/companies', { ...as(), body: { pib: testPib(), name: 'Kovin Pančevo' } });
  const [type] = await ok<{ id: string }[]>('GET', '/project-types', as());
  const project = await ok<{ id: string }>('POST', '/projects', { ...as(), body: { name: 'Service contract 2026', projectTypeId: type!.id, companyId: company.id } });
  taskId = (await ok<{ id: string }>('POST', '/tasks', { ...as(), body: { projectId: project.id, name: 'Survey', assigneeIds: [anaId] } })).id;
  otherTaskId = (await ok<{ id: string }>('POST', '/tasks', { ...as(), body: { projectId: project.id, name: 'Report', assigneeIds: [anaId] } })).id;
  const w = await week();
  monday = w.thisWeek;
  today = w.today;
});

describe("the row's X (CD-354)", () => {
  it('removes an empty row added to the week', async () => {
    await ok('POST', '/timesheet/rows', { ...as(ana), body: { weekStart: monday, taskId } });
    expect((await week()).rows.map((r) => r.id)).toContain(taskId);
    const res = await remove(taskId);
    expect(res.status).toBe(200);
    expect(res.body.rows.map((r) => r.id)).not.toContain(taskId);
  });

  it("removes a row with hours and only that row's hours", async () => {
    await ok('PUT', '/timesheet/cells', { ...as(ana), body: { date: today, taskId, minutes: 120 } });
    await ok('PUT', '/timesheet/cells', { ...as(ana), body: { date: today, taskId: otherTaskId, minutes: 60 } });
    const res = await remove(taskId);
    expect(res.status).toBe(200);
    expect(res.body.rows.map((r) => r.id)).toEqual([otherTaskId]);
    expect(res.body.rows[0]!.minutes).toBe(60);
  });

  it("a member can't remove someone else's row; an Admin on their behalf removes only theirs", async () => {
    const res = await call('POST', '/timesheet/rows/remove', { ...as(ana), body: { weekStart: monday, taskId: otherTaskId, employeeId: (await accessOf(owner, tenant)).employeeId } });
    expect(res.status).toBe(403);
    await ok('POST', '/timesheet/rows', { ...as(owner), body: { weekStart: monday, taskId, employeeId: anaId } });
    const onBehalf = await call<Week>('POST', '/timesheet/rows/remove', { ...as(owner), body: { weekStart: monday, taskId, employeeId: anaId } });
    expect(onBehalf.status).toBe(200);
    expect((await week()).rows.map((r) => r.id)).toEqual([otherTaskId]);
  });

  it("another workspace can't touch these rows", async () => {
    const stranger = await signIn('trr-stranger');
    const theirs = await createTenant(stranger, 'Elsewhere');
    const res = await call<Week>('POST', '/timesheet/rows/remove', { token: stranger.token, tenant: theirs, body: { weekStart: monday, taskId: otherTaskId } });
    expect(res.status).toBe(200);
    expect((await week()).rows.map((r) => r.id)).toEqual([otherTaskId]);
    expect((await week()).rows[0]!.minutes).toBe(60);
  });

  it('keeps a row with hours on a submitted day', async () => {
    await ok('POST', '/timesheet/submit', { ...as(ana), body: { weekStart: monday } });
    const res = await remove(otherTaskId);
    expect(res.status).toBe(409);
    expect((await week()).rows.map((r) => r.id)).toContain(otherTaskId);
  });
});
