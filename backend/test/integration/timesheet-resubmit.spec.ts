/**
 * Resubmitting returned days (CD-158, spec 5.3 T5, 5.6): the employee sees the comment, only the
 * Rejected days are editable and go back to Submitted together (or one at a time in Day by day
 * mode), the Late flag never changes, the approver is emailed and sees the Resubmitted marker with
 * the reply, and a new return clears the reply.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { call, createTenant, eventually, type Mail, mailTo, ok, type Session, signIn } from './helpers';
import { asTenantSql, joinAsEmployee } from './people-helpers';

interface Day {
  date: string;
  status: string;
  editable: boolean;
  comment: string | null;
  returnedBy: string | null;
  resubmittedAt: string | null;
  reply: string | null;
}
interface Week {
  thisWeek: string;
  status: string;
  late: boolean;
  submittable: string[];
  resubmittable: string[];
  days: Day[];
  rows: { id: string }[];
}

let owner: Session, marko: Session, dragan: Session, peer: Session;
let tenant: string, draganId: string, monday: string, taskId: string;
const as = (s: Session) => ({ token: s.token, tenant });
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const week = (s: Session = dragan) => ok<Week>('GET', `/timesheet/week?week=${monday}`, as(s));
const resubmit = (s: Session, body: Record<string, unknown>) => call<Week>('POST', '/timesheet/resubmit', { ...as(s), body: { weekStart: monday, ...body } });
const sendBack = (dates: string[], comment: string) => ok('POST', '/timesheet/approvals/return', { ...as(marko), body: { employeeId: draganId, weekStart: monday, dates, comment } });
const setMode = (approvalMode: 'week' | 'day') => ok('PATCH', '/workspace', { ...as(owner), body: { timesheet: { approvalMode } } });

beforeAll(async () => {
  [owner, marko, dragan, peer] = (await Promise.all(['owner', 'marko', 'dragan', 'peer'].map((n) => signIn(`tsr-${n}`)))) as [Session, Session, Session, Session];
  tenant = await createTenant(owner, 'Resubmit');
  const markoId = await joinAsEmployee(owner, tenant, marko);
  draganId = await joinAsEmployee(owner, tenant, dragan);
  await joinAsEmployee(owner, tenant, peer);
  await asTenantSql(tenant, 'update employees set manager_id = $2 where id = $1', [draganId, markoId]);
  const company = await ok<{ id: string }>('POST', '/crm/companies', { ...as(owner), body: { name: 'Hidrogradnja' } });
  const [type] = await ok<{ id: string }[]>('GET', '/project-types', as(owner));
  const project = await ok<{ id: string }>('POST', '/projects', { ...as(owner), body: { name: 'Engine overhaul', projectTypeId: type!.id, companyId: company.id } });
  taskId = (await ok<{ id: string }>('POST', '/tasks', { ...as(owner), body: { projectId: project.id, name: 'Inspect engine', assigneeIds: [draganId] } })).id;
  monday = (await ok<{ thisWeek: string }>('GET', '/timesheet/week', as(dragan))).thisWeek;
  for (let i = 0; i < 5; i++) await ok('PUT', '/timesheet/cells', { ...as(dragan), body: { date: addDays(monday, i), taskId, minutes: 480 } });
  await ok('POST', '/timesheet/submit', { ...as(dragan), body: { weekStart: monday } });
  await sendBack([addDays(monday, 1), addDays(monday, 2)], 'Tuesday and Wednesday need the work order, not the task.');
});

describe('resubmitting returned days (CD-158)', () => {
  it('the employee sees the comment and can edit only the rejected days', async () => {
    const w = await week();
    expect(w.status).toBe('rejected');
    expect(w.resubmittable).toEqual([addDays(monday, 1), addDays(monday, 2)]);
    expect(w.submittable).toEqual([]);
    expect(w.days[1]).toMatchObject({ status: 'rejected', editable: true, comment: 'Tuesday and Wednesday need the work order, not the task.', returnedBy: marko.name });
    expect(w.days[0]).toMatchObject({ status: 'submitted', editable: false, comment: null });
    expect((await call('PUT', '/timesheet/cells', { ...as(dragan), body: { date: addDays(monday, 1), taskId, minutes: 420 } })).status).toBe(200);
    expect((await call('PUT', '/timesheet/cells', { ...as(dragan), body: { date: monday, taskId, minutes: 420 } })).status).toBe(409);
  });

  it('refuses a single day in Whole week mode, someone with nothing rejected, and never touches other days', async () => {
    expect((await resubmit(dragan, { date: addDays(monday, 1) })).status).toBe(400);
    expect((await resubmit(peer, {})).body.message).toBe('Nothing to resubmit in this week');
    expect((await call('POST', '/timesheet/submit', { ...as(dragan), body: { weekStart: monday } })).status).toBe(400);
  });

  it('resubmits exactly the rejected days with a reply: Submitted again, Late unchanged, history, audit and the approver email', async () => {
    const before = await week();
    const res = await resubmit(dragan, { reply: 'Moved both days to the work order.' });
    expect(res.status).toBe(201);
    const w = res.body;
    expect(w.days.map((d) => d.status)).toEqual(['submitted', 'submitted', 'submitted', 'submitted', 'submitted', 'draft', 'draft']);
    expect(w.status).toBe('submitted');
    expect(w.late).toBe(before.late);
    expect(w.resubmittable).toEqual([]);
    expect(w.days[1]).toMatchObject({ reply: 'Moved both days to the work order.', comment: 'Tuesday and Wednesday need the work order, not the task.' });
    expect(w.days[1]!.resubmittedAt).toBeTruthy();
    expect(w.days[0]).toMatchObject({ resubmittedAt: null, reply: null });
    const events = await asTenantSql<{ work_date: string; comment: string; actor_name: string }>(tenant, `select work_date::text, comment, actor_name from timesheet_day_events where employee_id = $1 and kind = 'resubmitted' order by work_date`, [draganId]);
    expect(events.map((e) => e.work_date)).toEqual([addDays(monday, 1), addDays(monday, 2)]);
    expect(events[0]).toMatchObject({ comment: 'Moved both days to the work order.', actor_name: dragan.name });
    const [audit] = await asTenantSql<{ data: { days: string[]; reply: string } }>(tenant, `select data from audit_logs where action = 'timesheet.resubmitted' and entity_id = $1`, [draganId]);
    expect(audit!.data).toMatchObject({ reply: 'Moved both days to the work order.' });
    expect(audit!.data.days).toHaveLength(2);
    const mail = await eventually(async () => (await mailTo(owner, marko.email)).find((m: Mail) => m.subject === `${dragan.name} resubmitted 2 days of week ${weekNumber(monday)}`), 'the resubmitted email');
    expect(mail.text).toContain('Moved both days to the work order.');
    expect(mail.text).toContain(`/approvals/${draganId}?week=${monday}`);
  });

  it('the approver sees the Resubmitted marker and the reply, and the list counts it', async () => {
    const view = await ok<{ week: Week }>('GET', `/timesheet/approvals/${draganId}/week?week=${monday}`, as(marko));
    expect(view.week.days[1]).toMatchObject({ status: 'submitted', reply: 'Moved both days to the work order.' });
    const list = await ok<{ rows: { employee: { id: string }; waiting: number; resubmitted: number; returned: number }[] }>('GET', `/timesheet/approvals?week=${monday}`, as(marko));
    expect(list.rows.find((r) => r.employee.id === draganId)).toMatchObject({ waiting: 5, resubmitted: 2, returned: 0 });
  });

  it('a new return clears the reply; Day by day resubmits one day at a time; approval then locks it', async () => {
    await sendBack([addDays(monday, 1)], 'Still on the task.');
    let w = await week();
    expect(w.days[1]).toMatchObject({ status: 'rejected', comment: 'Still on the task.', reply: null, resubmittedAt: null });
    expect(w.days[2]).toMatchObject({ status: 'submitted', reply: 'Moved both days to the work order.' });
    await setMode('day');
    try {
      expect((await resubmit(dragan, { date: monday })).body.message).toBe('That day is not rejected');
      const res = await resubmit(dragan, { date: addDays(monday, 1) });
      expect(res.status).toBe(201);
      w = res.body;
      expect(w.days[1]).toMatchObject({ status: 'submitted', reply: null });
      expect(w.days[1]!.resubmittedAt).toBeTruthy();
      const approved = await ok<{ week: Week }>('POST', '/timesheet/approvals/approve', { ...as(marko), body: { employeeId: draganId, weekStart: monday, dates: [addDays(monday, 1)] } });
      expect(approved.week.days[1]!.status).toBe('approved');
      expect((await resubmit(dragan, { date: addDays(monday, 1) })).status).toBe(400);
    } finally {
      await setMode('week');
    }
  });
});

const weekNumber = (date: string) => {
  const d = new Date(`${date}T00:00:00Z`);
  const thursday = new Date(d.getTime() + 3 * 86_400_000);
  const jan1 = new Date(`${thursday.getUTCFullYear()}-01-01T00:00:00Z`);
  return Math.floor((thursday.getTime() - jan1.getTime()) / 86_400_000 / 7) + 1;
};
