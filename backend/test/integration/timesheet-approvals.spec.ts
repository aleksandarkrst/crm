/**
 * Approvals (CD-157): the list a manager and an Admin see, who may approve (the manager; an Admin as
 * an override, recorded; never oneself, never an indirect report), Approve week in Whole week mode
 * (only once every required day is submitted), Return with a required comment (the days go back,
 * the employee is emailed, the comment shows on their week), Day by day approvals of chosen days,
 * conflicts when the week changed, the history rows, and the new table's isolation.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { call, createTenant, eventually, type Mail, mailTo, ok, type Session, signIn, testPib } from './helpers';
import { accessOf, asTenantSql, joinAsEmployee, showInApp } from './people-helpers';

interface Row {
  employee: { id: string; name: string };
  right: string | null;
  status: string;
  waiting: number;
  returned: number;
  approvable: boolean;
  missing: string[];
  days: { date: string; status: string }[];
}
interface Approvals {
  weekStart: string;
  thisWeek: string;
  approvalMode: string;
  rows: Row[];
}
interface Week {
  thisWeek: string;
  status: string;
  days: { date: string; status: string; comment: string | null; returnedBy: string | null; approvedBy: string | null; editable: boolean }[];
}

let owner: Session, senior: Session, marko: Session, dragan: Session, bojan: Session, vesna: Session, peer: Session;
let tenant: string, seniorId: string, markoId: string, draganId: string, bojanId: string, vesnaId: string, monday: string;
const as = (s: Session) => ({ token: s.token, tenant });
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const list = (s: Session, week = monday) => ok<Approvals>('GET', `/timesheet/approvals?week=${week}`, as(s));
const rowOf = async (s: Session, id: string) => (await list(s)).rows.find((r) => r.employee.id === id);
const approve = (s: Session, employeeId: string, dates?: string[]) => call('POST', '/timesheet/approvals/approve', { ...as(s), body: { employeeId, weekStart: monday, ...(dates ? { dates } : {}) } });
const sendBack = (s: Session, employeeId: string, comment: string | undefined, dates?: string[]) =>
  call('POST', '/timesheet/approvals/return', { ...as(s), body: { employeeId, weekStart: monday, ...(comment !== undefined ? { comment } : {}), ...(dates ? { dates } : {}) } });
const week = (s: Session) => ok<Week>('GET', `/timesheet/week?week=${monday}`, as(s));
const setMode = (approvalMode: 'week' | 'day') => ok('PATCH', '/workspace', { ...as(owner), body: { timesheet: { approvalMode } } });
const events = (employeeId: string, kind: string) =>
  asTenantSql<{ work_date: string; actor_name: string; comment: string | null; approval_mode: string }>(tenant, `select work_date::text, actor_name, comment, approval_mode from timesheet_day_events where employee_id = $1 and kind = $2 order by work_date`, [employeeId, kind]);

beforeAll(async () => {
  [owner, senior, marko, dragan, bojan, vesna, peer] = (await Promise.all(['owner', 'senior', 'marko', 'dragan', 'bojan', 'vesna', 'peer'].map((n) => signIn(`tsa-${n}`)))) as [Session, Session, Session, Session, Session, Session, Session];
  tenant = await createTenant(owner, 'Approvals');
  [seniorId, markoId, draganId, bojanId, vesnaId] = (await Promise.all([senior, marko, dragan, bojan, vesna].map((s) => joinAsEmployee(owner, tenant, s)))) as [string, string, string, string, string];
  await joinAsEmployee(owner, tenant, peer);
  // Senior → Marko → Dragan, Bojan and Vesna. The owner is an Admin without a manager.
  await asTenantSql(tenant, 'update employees set manager_id = $2 where id = any($1::uuid[])', [[draganId, bojanId, vesnaId], markoId]);
  await asTenantSql(tenant, 'update employees set manager_id = $2 where id = $1', [markoId, seniorId]);
  const company = await ok<{ id: string }>('POST', '/crm/companies', { ...as(owner), body: { pib: testPib(), name: 'Hidrogradnja' } });
  const [type] = await ok<{ id: string }[]>('GET', '/project-types', as(owner));
  const project = await ok<{ id: string }>('POST', '/projects', { ...as(owner), body: { name: 'Engine overhaul', projectTypeId: type!.id, companyId: company.id } });
  const task = await ok<{ id: string }>('POST', '/tasks', { ...as(owner), body: { projectId: project.id, name: 'Inspect engine', assigneeIds: [draganId, bojanId, vesnaId] } });
  monday = (await ok<{ thisWeek: string }>('GET', '/timesheet/week', as(dragan))).thisWeek;
  for (const s of [dragan, bojan, vesna]) for (let i = 0; i < 5; i++) await ok('PUT', '/timesheet/cells', { ...as(s), body: { date: addDays(monday, i), taskId: task.id, minutes: 480 } });
  await ok('POST', '/timesheet/submit', { ...as(dragan), body: { weekStart: monday } });
});

describe('the Approvals list', () => {
  it('shows a manager their direct reports to approve and indirect reports read-only; others see nobody', async () => {
    const forMarko = await list(marko);
    expect(forMarko.rows.map((r) => r.employee.id).sort()).toEqual([bojanId, draganId, vesnaId].sort());
    expect(forMarko.rows.find((r) => r.employee.id === draganId)).toMatchObject({ right: 'approver', status: 'submitted', waiting: 5, approvable: true, missing: [] });
    expect(forMarko.rows.find((r) => r.employee.id === bojanId)).toMatchObject({ right: 'approver', status: 'draft', waiting: 0, approvable: false });
    expect(forMarko.rows.find((r) => r.employee.id === bojanId)!.missing).toHaveLength(5);
    const forSenior = await list(senior);
    expect(forSenior.rows.find((r) => r.employee.id === draganId)!.right).toBeNull();
    expect(forSenior.rows.find((r) => r.employee.id === markoId)!.right).toBe('approver');
    expect((await list(peer)).rows).toEqual([]);
  });
  it('shows an Admin everyone: an override where the manager can act, the approver where nobody else can, nothing on their own row', async () => {
    const rows = (await list(owner)).rows;
    expect(rows.find((r) => r.employee.id === draganId)!.right).toBe('override');
    expect(rows.find((r) => r.employee.id === seniorId)!.right).toBe('approver');
    const me = (await accessOf(owner, tenant)).employeeId;
    expect(rows.find((r) => r.employee.id === me)!.right).toBeNull();
  });

  it("leaves out records the app doesn't show: no account, no pending invitation (CD-226, CD-336)", async () => {
    const [hidden] = await asTenantSql<{ id: string }>(tenant, `insert into employees (tenant_id, first_name, last_name, employment_start_date) values ($1, 'Pera', 'Peric', '2024-01-01') returning id`, [tenant]);
    expect((await list(owner)).rows.map((r) => r.employee.id)).not.toContain(hidden!.id);
    await showInApp(tenant, hidden!.id);
    expect((await list(owner)).rows.map((r) => r.employee.id)).toContain(hidden!.id);
    await asTenantSql(tenant, `delete from invitations where employee_id = $1`, [hidden!.id]);
    await asTenantSql(tenant, `delete from employees where id = $1`, [hidden!.id]);
  });
  it('defaults to the latest week whose deadline passed and reads one person week for those allowed', async () => {
    const latest = await ok<Approvals>('GET', '/timesheet/approvals', as(marko));
    expect([latest.thisWeek, addDays(latest.thisWeek, -7)]).toContain(latest.weekStart);
    expect((await ok<{ right: string }>('GET', `/timesheet/approvals/${draganId}/week?week=${monday}`, as(marko))).right).toBe('approver');
    expect((await ok<{ right: string | null }>('GET', `/timesheet/approvals/${draganId}/week?week=${monday}`, as(senior))).right).toBeNull();
    await ok('GET', `/timesheet/approvals/${draganId}/week?week=${monday}`, as(peer), 403);
    await ok('GET', `/timesheet/approvals/00000000-0000-4000-8000-000000000000/week?week=${monday}`, as(owner), 404);
  });
});

describe('Whole week mode', () => {
  it('refuses a peer, an indirect manager, the employee themselves and a selection of days', async () => {
    expect((await approve(peer, draganId)).status).toBe(403);
    expect((await approve(senior, draganId)).status).toBe(403);
    expect((await approve(dragan, draganId)).status).toBe(403);
    expect((await approve(marko, markoId)).status).toBe(403);
    expect((await approve(marko, draganId, [monday])).status).toBe(400);
  });
  it('refuses Approve week while a required day is Draft', async () => {
    const res = await approve(marko, bojanId);
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Approve the week once every required day is submitted');
  });
  it("approves Dragan's week: every day Approved and locked, with history and the audit log", async () => {
    const res = await approve(marko, draganId);
    expect(res.status).toBe(201);
    expect(res.body.week.status).toBe('approved');
    expect(res.body.week.days.filter((d: { status: string }) => d.status === 'approved')).toHaveLength(5);
    expect(res.body.week.days[0]).toMatchObject({ approvedBy: marko.name, editable: false });
    expect((await approve(marko, draganId)).body.message).toBe('Nothing to approve');
    const locked = await call('PUT', '/timesheet/cells', { ...as(dragan), body: { date: monday, taskId: (await ok<{ rows: { id: string }[] }>('GET', `/timesheet/week?week=${monday}`, as(dragan))).rows[0]!.id, minutes: 240 } });
    expect(locked.status).toBe(423);
    expect(await events(draganId, 'approved')).toHaveLength(5);
    expect((await events(draganId, 'approved'))[0]).toMatchObject({ actor_name: marko.name, approval_mode: 'week' });
    expect(await events(draganId, 'submitted')).toHaveLength(5);
    const [audit] = await asTenantSql<{ data: { days: string[]; override: boolean } }>(tenant, `select data from audit_logs where action = 'timesheet.approved' and entity_id = $1`, [draganId]);
    expect(audit!.data).toMatchObject({ override: false });
    expect(audit!.data.days).toHaveLength(5);
    expect(await rowOf(marko, draganId)).toMatchObject({ status: 'approved', waiting: 0, approvable: false });
  });
  it('returns chosen days with a required comment: they go back to the employee, who is emailed and sees the comment', async () => {
    await ok('POST', '/timesheet/submit', { ...as(bojan), body: { weekStart: monday } });
    expect((await sendBack(marko, bojanId, undefined, [addDays(monday, 1)])).status).toBe(400);
    expect((await sendBack(marko, bojanId, '   ', [addDays(monday, 1)])).status).toBe(400);
    const res = await sendBack(marko, bojanId, 'The customer signed 5 h on the work sheet. Please check.', [addDays(monday, 1)]);
    expect(res.status).toBe(201);
    expect(res.body.week.status).toBe('rejected');
    const his = await week(bojan);
    expect(his.days[1]).toMatchObject({ status: 'rejected', comment: 'The customer signed 5 h on the work sheet. Please check.', returnedBy: marko.name, editable: true });
    expect(his.days[0]).toMatchObject({ status: 'submitted', comment: null, editable: false });
    expect((await events(bojanId, 'returned'))[0]).toMatchObject({ work_date: addDays(monday, 1), comment: 'The customer signed 5 h on the work sheet. Please check.' });
    const mail = await eventually(async () => (await mailTo(owner, bojan.email)).find((m: Mail) => m.subject.startsWith('Your timesheet for week') && m.subject.endsWith('was returned')), 'the returned email');
    expect(mail.text).toContain('The customer signed 5 h on the work sheet.');
    expect(mail.text).toContain(`${marko.name} returned`);
    // A returned day blocks Approve week; the rest of the week can still be returned as a whole.
    expect((await approve(marko, bojanId)).status).toBe(400);
    expect((await sendBack(marko, bojanId, 'Please redo the week.')).body.week.days.filter((d: { status: string }) => d.status === 'rejected')).toHaveLength(5);
    expect(await rowOf(marko, bojanId)).toMatchObject({ returned: 5, waiting: 0 });
  });
});

describe('Day by day mode', () => {
  it('approves and returns chosen days; a day no longer Submitted is a conflict; an Admin override is recorded', async () => {
    await setMode('day');
    try {
      await ok('POST', '/timesheet/submit', { ...as(vesna), body: { weekStart: monday, date: monday } });
      await ok('POST', '/timesheet/submit', { ...as(vesna), body: { weekStart: monday, date: addDays(monday, 1) } });
      expect(await rowOf(marko, vesnaId)).toMatchObject({ waiting: 2, approvable: true });
      const first = await approve(marko, vesnaId, [monday]);
      expect(first.status).toBe(201);
      expect(first.body.week.days.map((d: { status: string }) => d.status).slice(0, 3)).toEqual(['approved', 'submitted', 'draft']);
      expect(first.body.week.status).toBe('partly_submitted');
      expect((await approve(marko, vesnaId, [monday])).status).toBe(409);
      expect((await approve(marko, vesnaId, [addDays(monday, 2)])).status).toBe(409);
      const back = await sendBack(owner, vesnaId, 'Wrong work order on Tuesday.', [addDays(monday, 1)]);
      expect(back.status).toBe(201);
      expect(back.body.right).toBe('override');
      expect(back.body.week.days[1]).toMatchObject({ status: 'rejected', returnedBy: owner.name });
      const [audit] = await asTenantSql<{ data: { override: boolean; comment: string } }>(tenant, `select data from audit_logs where action = 'timesheet.returned' and entity_id = $1`, [vesnaId]);
      expect(audit!.data).toMatchObject({ override: true, comment: 'Wrong work order on Tuesday.' });
      expect((await events(vesnaId, 'returned'))[0]).toMatchObject({ actor_name: owner.name, approval_mode: 'day' });
      // Approve all waiting days when none is waiting.
      expect((await approve(marko, vesnaId)).body.message).toBe('Nothing to approve');
    } finally {
      await setMode('week');
    }
  });
});

describe('the history table', () => {
  it('is append-only and invisible to another workspace', async () => {
    const [row] = await asTenantSql<{ id: string }>(tenant, `select id from timesheet_day_events where employee_id = $1 limit 1`, [draganId]);
    await expect(asTenantSql(tenant, `update timesheet_day_events set comment = 'x' where id = $1`, [row!.id])).rejects.toThrow(/cannot be changed/);
    const other = await createTenant(peer, 'Other approvals tenant');
    expect((await asTenantSql<{ n: number }>(other, `select count(*)::int as n from timesheet_day_events`))[0]!.n).toBe(0);
    await expect(asTenantSql(other, `insert into timesheet_day_events (tenant_id, employee_id, work_date, kind, approval_mode) values ($1, $2, $3, 'approved', 'week')`, [tenant, draganId, monday])).rejects.toThrow();
    // Every approvals endpoint from the other workspace: nobody listed, Dragan not found.
    const elsewhere = { token: peer.token, tenant: other };
    expect((await ok<Approvals>('GET', `/timesheet/approvals?week=${monday}`, elsewhere)).rows.map((r) => r.employee.id)).not.toContain(draganId);
    await ok('GET', `/timesheet/approvals/${draganId}/week?week=${monday}`, elsewhere, 404);
    expect((await call('POST', '/timesheet/approvals/approve', { ...elsewhere, body: { employeeId: draganId, weekStart: monday } })).status).toBe(404);
    expect((await call('POST', '/timesheet/approvals/return', { ...elsewhere, body: { employeeId: draganId, weekStart: monday, comment: 'x' } })).status).toBe(404);
  });
});
