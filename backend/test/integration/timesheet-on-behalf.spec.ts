/**
 * Admin entries on behalf of an employee (CD-317, spec 9.4): only Admins open another employee's
 * timesheet (members and managers get 403), edit Draft or Rejected days under the employee's own
 * rules, and submit or resubmit them; each action is in the history "on behalf"; the week and the
 * Approvals list carry the marker; the Admin who entered the days cannot approve them (another
 * approver can); submitting on behalf after the deadline marks the week Late like the employee's
 * own submission would. Checked per approval mode.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { call, createTenant, ok, type Session, signIn } from './helpers';
import { addEmployee, asTenantSql, joinAsEmployee } from './people-helpers';

interface Week {
  thisWeek: string;
  status: string;
  late: boolean;
  onBehalf: boolean;
  employee: { id: string; name: string } | null;
  submittable: string[];
  resubmittable: string[];
  days: { date: string; status: string; minutes: number; editable: boolean }[];
}
interface Approver {
  week: Week;
  right: string | null;
  enteredByMe: string[];
}
interface History {
  events: { date: string; kind: string; actorName: string | null; onBehalf: boolean }[];
  changes: { date: string; action: string; actorName: string | null; onBehalf: boolean }[];
}

let owner: Session, marko: Session, dragan: Session, peer: Session;
let tenant: string, markoId: string, draganId: string, nobodyId: string, taskId: string, monday: string, lastWeek: string;
const as = (s: Session) => ({ token: s.token, tenant });
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const weekOf = (s: Session, employeeId: string, week = monday) => call<Week & { message?: string }>('GET', `/timesheet/week?week=${week}&employeeId=${employeeId}`, as(s));
const cell = (s: Session, employeeId: string, date: string, minutes: number) => call<Week & { message?: string }>('PUT', '/timesheet/cells', { ...as(s), body: { date, taskId, minutes, employeeId } });
const submit = (s: Session, employeeId: string, weekStart: string, date?: string) => call<Week & { message?: string }>('POST', '/timesheet/submit', { ...as(s), body: { weekStart, employeeId, ...(date ? { date } : {}) } });
const approve = (s: Session, employeeId: string, dates?: string[]) => call<Approver & { message?: string }>('POST', '/timesheet/approvals/approve', { ...as(s), body: { employeeId, weekStart: monday, ...(dates ? { dates } : {}) } });
const setMode = (approvalMode: 'week' | 'day') => ok('PATCH', '/workspace', { ...as(owner), body: { timesheet: { approvalMode } } });
const events = (employeeId: string, kind: string) => asTenantSql<{ work_date: string; actor_name: string; actor_user_id: string }>(tenant, `select work_date::text, actor_name, actor_user_id from timesheet_day_events where employee_id = $1 and kind = $2 order by work_date`, [employeeId, kind]);

beforeAll(async () => {
  [owner, marko, dragan, peer] = (await Promise.all(['owner', 'marko', 'dragan', 'peer'].map((n) => signIn(`tsb-${n}`)))) as [Session, Session, Session, Session];
  tenant = await createTenant(owner, 'On behalf');
  markoId = await joinAsEmployee(owner, tenant, marko);
  draganId = await joinAsEmployee(owner, tenant, dragan);
  await joinAsEmployee(owner, tenant, peer);
  // Nobody has no app account: only an Admin can enter their time.
  nobodyId = await addEmployee(owner, tenant, { firstName: 'Nobody', lastName: 'Offline', jobTitle: 'Technician' });
  await asTenantSql(tenant, 'update employees set manager_id = $2, timesheet_required = true where id = any($1::uuid[])', [[draganId, nobodyId], markoId]);
  const company = await ok<{ id: string }>('POST', '/crm/companies', { ...as(owner), body: { name: 'Hidrogradnja' } });
  const [type] = await ok<{ id: string }[]>('GET', '/project-types', as(owner));
  const project = await ok<{ id: string }>('POST', '/projects', { ...as(owner), body: { name: 'Engine overhaul', projectTypeId: type!.id, companyId: company.id } });
  taskId = (await ok<{ id: string }>('POST', '/tasks', { ...as(owner), body: { projectId: project.id, name: 'Inspect engine', assigneeIds: [draganId, nobodyId] } })).id;
  monday = (await ok<{ thisWeek: string }>('GET', '/timesheet/week', as(dragan))).thisWeek;
  lastWeek = addDays(monday, -7);
});

describe('entering time on behalf (CD-317)', () => {
  it("only Admins open someone else's timesheet; a member or manager gets 403, an unknown employee 404", async () => {
    expect((await weekOf(peer, draganId)).status).toBe(403);
    expect((await weekOf(marko, draganId)).status).toBe(403);
    expect((await cell(marko, draganId, monday, 480)).status).toBe(403);
    expect((await weekOf(owner, '00000000-0000-4000-8000-000000000000')).status).toBe(404);
    // Another workspace's employee does not exist here, for an Admin either.
    const other = await createTenant(peer, 'Other on-behalf tenant');
    const stranger = await addEmployee(peer, other, { firstName: 'Else', lastName: 'Where' });
    expect((await weekOf(owner, stranger)).status).toBe(404);
    expect((await cell(owner, stranger, monday, 480)).status).toBe(404);
    const w = await weekOf(owner, nobodyId);
    expect(w.status).toBe(200);
    expect(w.body.employee).toMatchObject({ id: nobodyId, name: 'Nobody Offline' });
    expect((await weekOf(dragan, draganId)).status).toBe(200);
  });

  it("edits follow the employee's own rules and are in the history as the Admin's, on behalf", async () => {
    for (let i = 0; i < 5; i++) expect((await cell(owner, nobodyId, addDays(monday, i), 480)).status).toBe(200);
    expect((await cell(owner, nobodyId, addDays(monday, 7), 480)).status).toBe(400);
    expect((await cell(owner, nobodyId, monday, 1440)).status).toBe(400);
    const items = await ok<{ id: string }[]>('GET', `/timesheet/loggable?employeeId=${nobodyId}`, as(owner));
    expect(items.map((i) => i.id)).toContain(taskId);
    const h = await ok<History>('GET', `/timesheet/approvals/${nobodyId}/history?week=${monday}`, as(owner));
    expect(h.changes.filter((c) => c.action === 'created')).toHaveLength(5);
    expect(h.changes[0]).toMatchObject({ actorName: owner.name, onBehalf: true });
  });

  it('Whole week: the Admin submits on behalf, the week and the list carry the marker, and only another approver approves', async () => {
    const res = await submit(owner, nobodyId, monday);
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('submitted');
    expect(res.body.onBehalf).toBe(true);
    expect((await events(nobodyId, 'submitted'))[0]).toMatchObject({ actor_name: owner.name, actor_user_id: owner.userId });
    const [audit] = await asTenantSql<{ data: { onBehalf: boolean } }>(tenant, `select data from audit_logs where action = 'timesheet.submitted' and entity_id = $1`, [nobodyId]);
    expect(audit!.data.onBehalf).toBe(true);
    const list = await ok<{ rows: { employee: { id: string }; onBehalf: boolean; waiting: number }[] }>('GET', `/timesheet/approvals?week=${monday}`, as(owner));
    expect(list.rows.find((r) => r.employee.id === nobodyId)).toMatchObject({ onBehalf: true, waiting: 5 });
    const view = await ok<Approver>('GET', `/timesheet/approvals/${nobodyId}/week?week=${monday}`, as(owner));
    expect(view.enteredByMe).toHaveLength(5);
    expect(view.week.onBehalf).toBe(true);
    const h = await ok<History>('GET', `/timesheet/approvals/${nobodyId}/history?week=${monday}`, as(marko));
    expect(h.events.filter((e) => e.kind === 'submitted').every((e) => e.onBehalf && e.actorName === owner.name)).toBe(true);
    const refused = await approve(owner, nobodyId);
    expect(refused.status).toBe(403);
    expect(refused.body.message).toMatch(/on behalf of Nobody Offline; another approver must approve/);
    expect((await ok<Approver>('GET', `/timesheet/approvals/${nobodyId}/week?week=${monday}`, as(marko))).enteredByMe).toEqual([]);
    const ok1 = await approve(marko, nobodyId);
    expect(ok1.status).toBe(201);
    expect(ok1.body.week.status).toBe('approved');
  });

  it('Day by day: the Admin submits one day on behalf and can still approve the days the employee submitted', async () => {
    for (let i = 0; i < 2; i++) await ok('PUT', '/timesheet/cells', { ...as(dragan), body: { date: addDays(monday, i), taskId, minutes: 480 } });
    await setMode('day');
    try {
      await ok('POST', '/timesheet/submit', { ...as(dragan), body: { weekStart: monday, date: monday } });
      const tuesday = addDays(monday, 1);
      const res = await submit(owner, draganId, monday, tuesday);
      expect(res.status).toBe(201);
      expect(res.body.days[1]!.status).toBe('submitted');
      expect((await events(draganId, 'submitted')).map((e) => [e.work_date, e.actor_user_id])).toEqual([
        [monday, dragan.userId],
        [tuesday, owner.userId],
      ]);
      const view = await ok<Approver>('GET', `/timesheet/approvals/${draganId}/week?week=${monday}`, as(owner));
      expect(view.enteredByMe).toEqual([tuesday]);
      expect((await approve(owner, draganId, [tuesday])).status).toBe(403);
      expect((await approve(owner, draganId)).status).toBe(403);
      expect((await approve(owner, draganId, [monday])).status).toBe(201);
      expect((await approve(marko, draganId, [tuesday])).status).toBe(201);
      // Hours the Admin entered count even when the employee submits the day himself (spec 9.4: "entered").
      const wednesday = addDays(monday, 2);
      expect((await cell(owner, draganId, wednesday, 480)).status).toBe(200);
      await ok('POST', '/timesheet/submit', { ...as(dragan), body: { weekStart: monday, date: wednesday } });
      expect((await ok<Approver>('GET', `/timesheet/approvals/${draganId}/week?week=${monday}`, as(owner))).enteredByMe).toEqual([tuesday, wednesday]);
      expect((await approve(owner, draganId, [wednesday])).status).toBe(403);
      // Returned and resubmitted on behalf: the resubmission is on behalf too, and Dragan sees the marker on his own week.
      await ok('POST', '/timesheet/approvals/return', { ...as(marko), body: { employeeId: draganId, weekStart: monday, dates: [wednesday], comment: 'Wednesday needs a note.' } });
      expect((await cell(owner, draganId, wednesday, 420)).status).toBe(200);
      const back = await call<Week>('POST', '/timesheet/resubmit', { ...as(owner), body: { weekStart: monday, date: addDays(monday, 2), employeeId: draganId, reply: 'Fixed by the office.' } });
      expect(back.status).toBe(201);
      expect(back.body.days[2]!.status).toBe('submitted');
      expect((await events(draganId, 'resubmitted'))[0]).toMatchObject({ actor_user_id: owner.userId });
      expect((await ok<Week>('GET', `/timesheet/week?week=${monday}`, as(dragan))).onBehalf).toBe(true);
    } finally {
      await setMode('week');
    }
  });

  it('submitting on behalf after the deadline marks the week Late, as the employee\'s own late submission would', async () => {
    for (let i = 0; i < 5; i++) expect((await cell(owner, nobodyId, addDays(lastWeek, i), 480)).status).toBe(200);
    const res = await submit(owner, nobodyId, lastWeek);
    expect(res.status).toBe(201);
    expect(res.body.late).toBe(true);
    expect(res.body.onBehalf).toBe(true);
    const [audit] = await asTenantSql<{ data: { late: boolean; onBehalf: boolean } }>(tenant, `select data from audit_logs where action = 'timesheet.submitted' and entity_id = $1 and data ->> 'weekStart' = $2`, [nobodyId, lastWeek]);
    expect(audit!.data).toMatchObject({ late: true, onBehalf: true });
    // The employee card's late weeks say so too (CD-336).
    const card = await ok<{ recent: { weekStart: string; onBehalf: boolean }[] }>('GET', `/timesheet/employees/${nobodyId}/late`, as(owner));
    expect(card.recent.find((w) => w.weekStart === lastWeek)).toMatchObject({ onBehalf: true });
  });
});
