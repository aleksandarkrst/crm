/**
 * The weekly timesheet (CD-152): the week a member sees, adding rows, entering hours on tasks and
 * work orders (the same rows the task's People and hours card counts), the daily maximum, Copy last
 * week, Submit week and Recall, and the lock trigger on time entries (submitted and approved days,
 * completed work orders, closed projects), deletes refused once time is logged, and tenant isolation.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { addMember, call, createTenant, ok, type Session, signIn } from './helpers';
import { accessOf, asTenantSql } from './people-helpers';

interface Cell {
  minutes: number;
  note: string | null;
  entries: number;
}
interface Row {
  key: string;
  kind: 'task' | 'work_order';
  id: string;
  code: string;
  name: string;
  path: string;
  lockedReason: string | null;
  edit: 'any' | 'existing' | 'none';
  limit: { limitMinutes: number; loggedMinutes: number } | null;
  cells: Record<string, Cell>;
  minutes: number;
}
interface Day {
  date: string;
  status: string;
  expectedMinutes: number;
  minutes: number;
  required: boolean;
  editable: boolean;
}
interface Week {
  weekStart: string;
  thisWeek: string;
  label: string;
  deadline: { date: string; time: string };
  employee: { id: string; name: string } | null;
  status: string;
  statusLabel: string;
  submittable: string[];
  canRecall: boolean;
  days: Day[];
  rows: Row[];
}

let owner: Session;
let ana: Session;
let marko: Session;
let tenant: string;
let other: string;
let anaId: string;
let markoId: string;
let projectId: string;
let companyId: string;
let monday: string;

const as = (s: Session = ana) => ({ token: s.token, tenant });
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const week = (s: Session = ana, start?: string) => ok<Week>('GET', `/timesheet/week${start ? `?week=${start}` : ''}`, as(s));
const setCell = (body: Record<string, unknown>, s: Session = ana) => call<Week>('PUT', '/timesheet/cells', { ...as(s), body });
const cell = (w: Week, id: string, date: string) => w.rows.find((r) => r.id === id)?.cells[date];
const newTask = async (name: string, assignees: string[] = [anaId], project = projectId) =>
  (await ok<{ id: string; number: number }>('POST', '/tasks', { ...as(owner), body: { projectId: project, name, assigneeIds: assignees } })).id;
const newWorkOrder = async (title: string, technicianIds: string[] = [anaId]) =>
  (await ok<{ id: string }>('POST', '/work-orders', { ...as(owner), body: { title, companyId, projectId, technicianIds } })).id;

beforeAll(async () => {
  [owner, ana, marko] = await Promise.all([signIn('ts-owner'), signIn('ts-ana'), signIn('ts-marko')]);
  tenant = await createTenant(owner, 'Timesheet');
  other = await createTenant(owner, 'Timesheet other');
  await addMember(owner, tenant, ana, 'member');
  await addMember(owner, tenant, marko, 'member');
  anaId = (await accessOf(ana, tenant)).employeeId;
  markoId = (await accessOf(marko, tenant)).employeeId;
  // Work orders need Service (or Both) technicians (CD-268).
  await ok('PATCH', `/people/employees/${anaId}`, { ...as(owner), body: { workType: 'both' } });
  companyId = (await ok<{ id: string }>('POST', '/crm/companies', { ...as(owner), body: { name: 'Kovin Pančevo' } })).id;
  const [type] = await ok<{ id: string }[]>('GET', '/project-types', as(owner));
  projectId = (await ok<{ id: string }>('POST', '/projects', { ...as(owner), body: { name: 'Service contract 2026', projectTypeId: type!.id, companyId, leadUserId: owner.userId } })).id;
  monday = (await week()).thisWeek;
});

describe('the week', () => {
  it('shows this week by default: Monday to Sunday, 8 h expected on weekdays, due Friday 17:00', async () => {
    const w = await week();
    expect(w.weekStart).toBe(monday);
    expect(w.employee?.id).toBe(anaId);
    expect(w.days.map((d) => d.expectedMinutes)).toEqual([480, 480, 480, 480, 480, 0, 0]);
    expect(w.deadline).toEqual({ date: addDays(monday, 4), time: '17:00' });
    expect(w.label).toMatch(/^Week \d+ · /);
    expect(w.status).toBe('not_submitted');
    expect(w.rows).toEqual([]);
  });

  it('refuses a week that does not start on a Monday', async () => {
    expect((await call('GET', `/timesheet/week?week=${addDays(monday, 1)}`, as())).status).toBe(400);
  });
});

describe('rows and hours', () => {
  let task: string;
  let order: string;

  beforeAll(async () => {
    task = await newTask('Update the spare parts price list');
    order = await newWorkOrder('Hydraulic leak, CAT 320');
  });

  it('offers only tasks you are assigned to and work orders you are on', async () => {
    const markoTask = await newTask('Not for Ana', [markoId]);
    const items = await ok<{ kind: string; id: string; code: string; path: string }[]>('GET', '/timesheet/loggable', as());
    const ids = items.map((i) => i.id);
    expect(ids).toContain(task);
    expect(ids).toContain(order);
    expect(ids).not.toContain(markoTask);
    expect(items.find((i) => i.id === task)!.path).toBe('Kovin Pančevo › Service contract 2026');
    expect(items.find((i) => i.id === order)!.code).toMatch(/^WO-\d+$/);
    // Adding a task you aren't on is refused.
    expect((await call('POST', '/timesheet/rows', { ...as(), body: { weekStart: monday, taskId: markoTask } })).status).toBe(403);
  });

  it('adds an empty row, then hours on it show in the timesheet and on the task', async () => {
    let w = await ok<Week>('POST', '/timesheet/rows', { ...as(), body: { weekStart: monday, taskId: task } });
    expect(w.rows.map((r) => r.id)).toEqual([task]);
    expect(w.rows[0]!.minutes).toBe(0);
    w = await ok<Week>('PUT', '/timesheet/cells', { ...as(), body: { date: monday, taskId: task, minutes: 450, note: 'Waited for the seal kit' } });
    expect(cell(w, task, monday)).toEqual({ minutes: 450, note: 'Waited for the seal kit', entries: 1 });
    expect(w.days[0]!.minutes).toBe(450);
    expect(w.status).toBe('draft');
    // The task's People and hours card counts the same entry (AC 2).
    const hours = await ok<{ rows: { employeeId: string; logged: number }[] }>('GET', `/tasks/${task}/hours`, as(owner));
    expect(hours.rows.find((r) => r.employeeId === anaId)!.logged).toBe(7.5);
    // Changing the hours keeps the note; clearing it removes the entry.
    w = await ok<Week>('PUT', '/timesheet/cells', { ...as(), body: { date: monday, taskId: task, minutes: 480 } });
    expect(cell(w, task, monday)).toEqual({ minutes: 480, note: 'Waited for the seal kit', entries: 1 });
    w = await ok<Week>('PUT', '/timesheet/cells', { ...as(), body: { date: addDays(monday, 1), workOrderId: order, minutes: 120 } });
    expect(w.rows.map((r) => r.kind)).toEqual(['task', 'work_order']);
    w = await ok<Week>('PUT', '/timesheet/cells', { ...as(), body: { date: addDays(monday, 1), workOrderId: order, minutes: 0 } });
    expect(cell(w, order, addDays(monday, 1))).toBeUndefined();
  });

  it('refuses more than 12 h on one day, wrong steps, and days after this week', async () => {
    const day = addDays(monday, 2);
    await ok('PUT', '/timesheet/cells', { ...as(), body: { date: day, taskId: task, minutes: 600 } });
    const over = await setCell({ date: day, workOrderId: order, minutes: 135 });
    expect(over.status).toBe(400);
    expect(JSON.stringify(over.body)).toContain('Maximum 12 h per day');
    await ok('PUT', '/timesheet/cells', { ...as(), body: { date: day, workOrderId: order, minutes: 120 } });
    expect((await setCell({ date: day, taskId: task, minutes: 10 })).status).toBe(400);
    expect((await setCell({ date: addDays(monday, 7), taskId: task, minutes: 60 })).status).toBe(400);
    expect((await setCell({ date: day, taskId: task, workOrderId: order, minutes: 60 })).status).toBe(400);
    // Clean up for the next tests.
    await ok('PUT', '/timesheet/cells', { ...as(), body: { date: day, taskId: task, minutes: 0 } });
    await ok('PUT', '/timesheet/cells', { ...as(), body: { date: day, workOrderId: order, minutes: 0 } });
  });

  it("refuses hours on a task you aren't assigned to, but lets you correct hours already there", async () => {
    const t = await newTask('Assigned, then removed');
    await ok('PUT', '/timesheet/cells', { ...as(), body: { date: monday, taskId: t, minutes: 60 } });
    await ok('DELETE', `/tasks/${t}/assignees/${anaId}`, as(owner), 200);
    const w = await week();
    expect(w.rows.find((r) => r.id === t)).toMatchObject({ lockedReason: 'Not assigned to you any more', edit: 'existing' });
    await ok('PUT', '/timesheet/cells', { ...as(), body: { date: monday, taskId: t, minutes: 30 } });
    expect((await setCell({ date: addDays(monday, 1), taskId: t, minutes: 30 })).status).toBe(403);
    await ok('PUT', '/timesheet/cells', { ...as(), body: { date: monday, taskId: t, minutes: 0 } });
  });

  it('shows the hour limit and your hours on the task', async () => {
    const t = await newTask('Limited');
    await ok('PATCH', `/tasks/${t}/assignees/${anaId}`, { ...as(owner), body: { hourLimit: 6 } });
    const w = await ok<Week>('PUT', '/timesheet/cells', { ...as(), body: { date: monday, taskId: t, minutes: 120 } });
    expect(w.rows.find((r) => r.id === t)!.limit).toEqual({ limitMinutes: 360, loggedMinutes: 120 });
    await ok('PUT', '/timesheet/cells', { ...as(), body: { date: monday, taskId: t, minutes: 0 } });
  });

  it("a member without hours doesn't see Ana's", async () => {
    const w = await week(marko);
    expect(w.employee?.id).toBe(markoId);
    expect(w.rows).toEqual([]);
  });
});

describe('Copy last week', () => {
  it('copies rows, or rows and hours into empty cells, and skips what is closed', async () => {
    const lastMonday = addDays(monday, -7);
    const t = await newTask('Repeating work');
    const wo = await newWorkOrder('Done last week');
    // Last week's hours: past weeks stay editable while their days are Draft.
    await ok('PUT', '/timesheet/cells', { ...as(), body: { date: lastMonday, taskId: t, minutes: 240 } });
    await ok('PUT', '/timesheet/cells', { ...as(), body: { date: addDays(lastMonday, 1), taskId: t, minutes: 300 } });
    await ok('PUT', '/timesheet/cells', { ...as(), body: { date: lastMonday, workOrderId: wo, minutes: 60 } });
    await ok('PATCH', `/work-orders/${wo}`, { ...as(owner), body: { status: 'completed' } });
    // This week already has Tuesday's hours on that task: never overwritten.
    await ok('PUT', '/timesheet/cells', { ...as(), body: { date: addDays(monday, 1), taskId: t, minutes: 60 } });

    const preview = await ok<{ rows: number; skipped: { label: string; reason: string }[] }>('GET', `/timesheet/copy?weekStart=${monday}`, as());
    expect(preview.skipped).toEqual([{ label: expect.stringMatching(/^WO-\d+$/), reason: 'is completed' }]);

    const copied = await ok<{ week: Week; copiedCells: number }>('POST', '/timesheet/copy', { ...as(), body: { weekStart: monday, mode: 'hours' } });
    expect(cell(copied.week, t, monday)!.minutes).toBe(240);
    expect(cell(copied.week, t, addDays(monday, 1))!.minutes).toBe(60);
    expect(copied.week.rows.some((r) => r.id === wo)).toBe(false);
    // Copying again adds nothing: the cells aren't empty any more.
    const again = await ok<{ copiedCells: number }>('POST', '/timesheet/copy', { ...as(), body: { weekStart: monday, mode: 'hours' } });
    expect(again.copiedCells).toBe(0);
    await ok('PUT', '/timesheet/cells', { ...as(), body: { date: monday, taskId: t, minutes: 0 } });
    await ok('PUT', '/timesheet/cells', { ...as(), body: { date: addDays(monday, 1), taskId: t, minutes: 0 } });
  });
});

describe('submit, recall and the lock', () => {
  let task: string;

  beforeAll(async () => {
    task = await newTask('Submitted work', [markoId]);
  });

  it('Submit week submits the required days; a submitted day refuses changes until recalled', async () => {
    await ok('PUT', '/timesheet/cells', { ...as(marko), body: { date: monday, taskId: task, minutes: 480 } });
    // An empty row goes when the week is submitted.
    const empty = await newTask('Added but never used', [markoId]);
    await ok('POST', '/timesheet/rows', { ...as(marko), body: { weekStart: monday, taskId: empty } });
    let w = await ok<Week>('POST', '/timesheet/submit', { ...as(marko), body: { weekStart: monday } }, 201);
    expect(w.days.slice(0, 5).map((d) => d.status)).toEqual(['submitted', 'submitted', 'submitted', 'submitted', 'submitted']);
    expect(w.days.slice(5).map((d) => d.status)).toEqual(['draft', 'draft']);
    expect(w.status).toBe('submitted');
    expect(w.rows.map((r) => r.id)).toEqual([task]);
    expect(w.days[0]!.editable).toBe(false);

    const refused = await setCell({ date: monday, taskId: task, minutes: 60 }, marko);
    expect(refused.status).toBe(409);
    expect(JSON.stringify(refused.body)).toContain('This day is submitted');
    expect((await call('POST', '/timesheet/submit', { ...as(marko), body: { weekStart: monday } })).status).toBe(400);

    w = await ok<Week>('POST', '/timesheet/recall', { ...as(marko), body: { weekStart: monday } }, 201);
    expect(w.days.every((d) => d.status === 'draft')).toBe(true);
    await ok('PUT', '/timesheet/cells', { ...as(marko), body: { date: monday, taskId: task, minutes: 420 } });
  });

  it('refuses a week that has not started', async () => {
    expect((await call('POST', '/timesheet/submit', { ...as(marko), body: { weekStart: addDays(monday, 7) } })).status).toBe(400);
  });

  it('an approved day is locked (423), also for the database itself', async () => {
    const day = addDays(monday, 2);
    await ok('PUT', '/timesheet/cells', { ...as(marko), body: { date: day, taskId: task, minutes: 240 } });
    await asTenantSql(tenant, `insert into timesheet_days (tenant_id, employee_id, work_date, status) values ($1, $2, $3, 'approved')`, [tenant, markoId, day]);
    const refused = await setCell({ date: day, taskId: task, minutes: 60 }, marko);
    expect(refused.status).toBe(423);
    expect(JSON.stringify(refused.body)).toContain('Day is approved and locked');
    await expect(asTenantSql(tenant, `delete from time_entries where employee_id = $1 and work_date = $2`, [markoId, day])).rejects.toThrow(/approved and locked/);
    const hours = await ok<{ rows: { employeeId: string; logged: number; approved: number }[] }>('GET', `/tasks/${task}/hours`, as(owner));
    expect(hours.rows.find((r) => r.employeeId === markoId)).toMatchObject({ logged: 11, approved: 4 });
  });

  it('a completed work order and a closed project take no new time (423)', async () => {
    const wo = await newWorkOrder('Finished job');
    await ok('PATCH', `/work-orders/${wo}`, { ...as(owner), body: { status: 'completed' } });
    const refused = await setCell({ date: monday, workOrderId: wo, minutes: 60 });
    expect(refused.status).toBe(423);

    const [type] = await ok<{ id: string }[]>('GET', '/project-types', as(owner));
    const closed = (await ok<{ id: string }>('POST', '/projects', { ...as(owner), body: { name: 'Engine overhaul, CAT 336', projectTypeId: type!.id, companyId, leadUserId: owner.userId } })).id;
    const t = await newTask('Reassemble and torque', [anaId], closed);
    await ok('PUT', '/timesheet/cells', { ...as(), body: { date: addDays(monday, 3), taskId: t, minutes: 240 } });
    await ok('PATCH', `/projects/${closed}`, { ...as(owner), body: { status: 'completed' } });
    const locked = await setCell({ date: addDays(monday, 3), taskId: t, minutes: 300 });
    expect(locked.status).toBe(423);
    expect(JSON.stringify(locked.body)).toContain('Project is closed');
    expect((await week()).rows.find((r) => r.id === t)).toMatchObject({ lockedReason: 'Project closed', edit: 'none' });
    // Not in the picker any more.
    const items = await ok<{ id: string }[]>('GET', '/timesheet/loggable', as());
    expect(items.map((i) => i.id)).not.toContain(t);
  });

  it('a task, work order or project with logged time is kept (409)', async () => {
    const t = await newTask('Has time', [anaId]);
    await ok('PUT', '/timesheet/cells', { ...as(), body: { date: addDays(monday, 4), taskId: t, minutes: 60 } });
    const task409 = await call('DELETE', `/tasks/${t}`, as(owner));
    expect(task409.status).toBe(409);
    expect(JSON.stringify(task409.body)).toContain('Mark it done instead');
    const project409 = await call('DELETE', `/projects/${projectId}`, as(owner));
    expect(project409.status).toBe(409);
    expect(JSON.stringify(project409.body)).toContain('This project has logged hours');
    const wo = await newWorkOrder('Has time too');
    await ok('PUT', '/timesheet/cells', { ...as(), body: { date: addDays(monday, 4), workOrderId: wo, minutes: 60 } });
    const wo409 = await call('DELETE', `/work-orders/${wo}`, as(owner));
    expect(wo409.status).toBe(409);
    expect(JSON.stringify(wo409.body)).toContain('Complete it instead');
  });
});

describe('tenant isolation', () => {
  it("another workspace sees none of this workspace's time", async () => {
    const rows = await asTenantSql<{ n: number }>(other, `select count(*)::int as n from time_entries`);
    expect(rows[0]!.n).toBe(0);
    const own = await asTenantSql<{ n: number }>(tenant, `select count(*)::int as n from time_entries`);
    expect(own[0]!.n).toBeGreaterThan(0);
  });
});
