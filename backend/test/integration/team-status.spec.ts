/**
 * Today's status (CD-162, spec 15 section 12): managers and Admins only; the status of each
 * employee on a date by the rules and order of 12.2 (a holiday inside a vacation, sick leave over
 * time off, a vacation over a weekend, weekend work); managers see their reports, Admins everyone
 * (decided 17 Oct 2026); pending requests as a note; last week's timesheet
 * for managers above and Admins; the date picker's range.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { call, createTenant, ok, type Session, signIn } from './helpers';
import { addEmployee, asTenantSql, createDepartment, createTeam, joinAsEmployee, showInApp, START } from './people-helpers';

interface Row {
  id: string;
  name: string;
  department: { id: string; name: string } | null;
  team: { id: string; name: string } | null;
  manager: { id: string; name: string } | null;
  status: string;
  label: string;
  detail: string | null;
  note: string | null;
  report: boolean;
  timesheet: { weekStart: string; label: string; late: boolean; notSubmitted: boolean } | null;
}
interface View {
  date: string;
  today: string;
  minDate: string;
  maxDate: string;
  rows: Row[];
}

let owner: Session, mgr: Session, emp: Session, peer: Session;
let tenant: string, mgrId: string, empId: string, peerId: string, futureId: string, today: string, monday: string;
const as = (s: Session) => ({ token: s.token, tenant });
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const mondayOf = (date: string) => addDays(date, -((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7));
const status = (s: Session, date?: string, scope?: 'reports') => ok<View>('GET', `/timesheet/status?${new URLSearchParams({ ...(date ? { date } : {}), ...(scope ? { scope } : {}) })}`, as(s));
const row = async (s: Session, id: string, date?: string) => (await status(s, date)).rows.find((r) => r.id === id);

beforeAll(async () => {
  [owner, mgr, emp, peer] = (await Promise.all(['owner', 'mgr', 'emp', 'peer'].map((n) => signIn(`tst-${n}`)))) as [Session, Session, Session, Session];
  tenant = await createTenant(owner, "Today's status");
  mgrId = await joinAsEmployee(owner, tenant, mgr);
  empId = await joinAsEmployee(owner, tenant, emp);
  peerId = await joinAsEmployee(owner, tenant, peer);
  const sales = await createDepartment(tenant, 'Sales');
  const field = await createTeam(tenant, sales, 'Field sales');
  for (const id of [mgrId, empId, peerId]) await ok('PATCH', `/people/employees/${id}`, { ...as(owner), body: { employmentStartDate: START, ...(id === empId ? { managerId: mgrId, unitId: field } : {}) } }, 200);
  // No preloaded holidays: the tests add their own.
  await ok('POST', '/timesheet/holidays/preload', { ...as(owner), body: { country: 'none' } }, 200);
  await asTenantSql(tenant, `delete from public_holidays where source = 'preload'`, []);
  today = (await status(owner)).today;
  futureId = await addEmployee(owner, tenant, { firstName: 'Nova', lastName: 'Future', employmentStartDate: addDays(today, 200) });
  monday = mondayOf(today);
});

describe('who can open it (spec 12.1, 12.3)', () => {
  it('managers and Admins only; employees without reports get 403', async () => {
    expect((await call('GET', '/timesheet/status', as(emp))).status).toBe(403);
    expect((await call('GET', '/timesheet/status', as(peer))).status).toBe(403);
    const mine = await status(mgr);
    expect(mine.date).toBe(today);
    // Only their direct and indirect reports: not themselves, not anyone else.
    expect(mine.rows.map((r) => r.id)).toEqual([empId]);
    expect((await status(owner)).rows.map((r) => r.id)).toEqual(expect.arrayContaining([mgrId, empId, peerId]));
  });

  it('the date picker reaches 90 days back and 60 ahead', async () => {
    const v = await status(owner);
    expect(v).toMatchObject({ minDate: addDays(today, -90), maxDate: addDays(today, 60) });
    expect((await status(owner, addDays(today, 60))).date).toBe(addDays(today, 60));
    expect((await call('GET', `/timesheet/status?date=${addDays(today, 61)}`, as(owner))).status).toBe(400);
    expect((await call('GET', `/timesheet/status?date=${addDays(today, -91)}`, as(owner))).status).toBe(400);
  });

  it('shows department, team and manager; scope=reports keeps the caller\'s reports', async () => {
    expect(await row(mgr, empId)).toMatchObject({ department: { name: 'Sales' }, team: { name: 'Field sales' }, manager: { id: mgrId }, report: true });
    expect((await status(mgr, undefined, 'reports')).rows.map((r) => r.id)).toEqual([empId]);
  });

  it("future employees: Not employed for Admins, left out for managers they don't report to", async () => {
    expect(await row(owner, futureId)).toMatchObject({ status: 'not_employed', detail: expect.stringMatching(/^Starts /) });
    expect(await row(mgr, futureId)).toBeUndefined();
  });

  it("a report's employment dates apply for their manager: not employed before the start and after the end", async () => {
    const soon = await addEmployee(owner, tenant, { firstName: 'Sanja', lastName: 'Soon', employmentStartDate: addDays(today, 10), managerId: mgrId });
    const leaving = await addEmployee(owner, tenant, { firstName: 'Lena', lastName: 'Leaving', employmentStartDate: START, managerId: mgrId });
    await asTenantSql(tenant, `update employees set employment_end_date = $1 where id = $2`, [addDays(today, 5), leaving]);
    expect(await row(mgr, soon)).toMatchObject({ status: 'not_employed', detail: expect.stringMatching(/^Starts /) });
    // A working day after the start: the Monday three weeks ahead (20 days from a Sunday is a Saturday).
    expect(await row(mgr, soon, addDays(monday, 21))).toMatchObject({ status: 'working' });
    expect(await row(mgr, leaving, addDays(today, 10))).toMatchObject({ status: 'not_employed' });
    expect(await row(owner, leaving, addDays(today, 10))).toMatchObject({ status: 'not_employed' });
    // Not anyone's report: Admins only.
    const other = await addEmployee(owner, tenant, { firstName: 'Olga', lastName: 'Other', employmentStartDate: START });
    expect(await row(owner, other)).toBeDefined();
    expect(await row(mgr, other)).toBeUndefined();
    await asTenantSql(tenant, `update employees set manager_id = null where id = any($1::uuid[])`, [[soon, leaving]]);
  });

  it('deactivated people: shown to Admins, hidden from managers', async () => {
    const gone = await addEmployee(owner, tenant, { firstName: 'Dejan', lastName: 'Deactivated', employmentStartDate: START, managerId: mgrId });
    await asTenantSql(tenant, `update employees set deactivated_at = now() - interval '2 days', employment_end_date = $1 where id = $2`, [addDays(today, -2), gone]);
    expect(await row(owner, gone)).toMatchObject({ status: 'not_employed' });
    expect(await row(owner, gone, addDays(today, -5))).toMatchObject({ status: expect.any(String) });
    expect(await row(mgr, gone)).toBeUndefined();
    expect(await row(mgr, gone, addDays(today, -5))).toBeUndefined();
  });

  it("leaves out records the app doesn't show: no account, no pending invitation (CD-226, CD-336)", async () => {
    const [hidden] = await asTenantSql<{ id: string }>(tenant, `insert into employees (tenant_id, first_name, last_name, employment_start_date) values ($1, 'Pera', 'Peric', '2024-01-01') returning id`, [tenant]);
    expect(await row(owner, hidden!.id)).toBeUndefined();
    await showInApp(tenant, hidden!.id);
    expect(await row(owner, hidden!.id)).toBeDefined();
  });

  it('another workspace sees none of these people', async () => {
    const stranger = await signIn('tst-stranger');
    const theirs = await createTenant(stranger, 'Elsewhere');
    const view = await ok<View>('GET', '/timesheet/status', { token: stranger.token, tenant: theirs });
    expect(view.rows.map((r) => r.id)).not.toEqual(expect.arrayContaining([mgrId]));
    expect(view.rows.filter((r) => [mgrId, empId, peerId, futureId].includes(r.id))).toEqual([]);
    // And this workspace's id with the stranger's token is refused.
    expect((await call('GET', '/timesheet/status', { token: stranger.token, tenant })).status).toBe(403);
  });
});

describe('the rules in order (spec 12.2)', () => {
  // A two-week vacation from next week's Monday, with a holiday on its Wednesday.
  let start: string;
  beforeAll(async () => {
    start = addDays(monday, 7);
    await ok('POST', '/timesheet/holidays', { ...as(owner), body: { date: addDays(start, 2), name: 'Company day' } });
    await ok('POST', '/timeoff/requests', { ...as(owner), body: { employeeId: empId, type: 'vacation', startDate: start, endDate: addDays(start, 11), record: { reason: 'Agreed on paper' } } });
  });

  it('time off shows its type and the day back; a holiday inside it is a public holiday; its weekend is still time off', async () => {
    expect(await row(owner, empId, start)).toMatchObject({ status: 'time_off', label: 'Vacation', detail: expect.stringMatching(/^Back on Mon /) });
    expect(await row(owner, empId, addDays(start, 2))).toMatchObject({ status: 'public_holiday', detail: 'Company day' });
    expect(await row(owner, empId, addDays(start, 5))).toMatchObject({ status: 'time_off', label: 'Vacation' });
    // Everyone else: the holiday for all, the weekend a non-working day.
    expect(await row(owner, peerId, addDays(start, 2))).toMatchObject({ status: 'public_holiday' });
    expect(await row(owner, peerId, addDays(start, 5))).toMatchObject({ status: 'non_working', label: 'Not a working day' });
    expect(await row(owner, peerId, start)).toMatchObject({ status: 'working', detail: null });
  });

  it('sick leave wins over the time off it interrupts, and never names its type', async () => {
    const types = await ok<{ id: string }[]>('GET', '/timeoff/sick-leave-types', as(owner));
    await ok('POST', '/timeoff/sick-leave', { ...as(owner), body: { employeeId: empId, startDate: addDays(start, 8), endDate: addDays(start, 9), typeId: types[0]!.id, confirm: true } });
    const sick = await row(owner, empId, addDays(start, 8));
    expect(sick).toMatchObject({ status: 'sick_leave', label: 'Sick leave', detail: expect.stringMatching(/^Until Wed /) });
    expect(await row(owner, empId, addDays(start, 7))).toMatchObject({ status: 'time_off' });
  });

  it("a manager sees their reports' absences with the exact type; others' only Admins see", async () => {
    await ok('POST', '/timeoff/requests', { ...as(owner), body: { employeeId: peerId, type: 'vacation', startDate: start, endDate: start, record: { reason: 'Agreed on paper' } } });
    expect(await row(mgr, empId, start)).toMatchObject({ status: 'time_off', label: 'Vacation' });
    expect(await row(mgr, peerId, start)).toBeUndefined();
    expect(await row(owner, peerId, start)).toMatchObject({ status: 'time_off', label: 'Vacation' });
  });

  it("a pending request is a note, and doesn't change the status", async () => {
    const later = addDays(start, 21);
    await ok('POST', '/timeoff/requests', { ...as(emp), body: { type: 'vacation', startDate: later, endDate: later } });
    await ok('POST', '/timeoff/requests', { ...as(peer), body: { type: 'vacation', startDate: later, endDate: later } });
    expect(await row(mgr, empId, later)).toMatchObject({ status: 'working', note: 'Vacation requested' });
    expect(await row(owner, peerId, later)).toMatchObject({ note: 'Vacation requested' });
  });

  it('hours on a non-working day are weekend work', async () => {
    const company = await ok<{ id: string }>('POST', '/crm/companies', { ...as(owner), body: { name: 'Hidrogradnja' } });
    const [type] = await ok<{ id: string }[]>('GET', '/project-types', as(owner));
    const project = await ok<{ id: string }>('POST', '/projects', { ...as(owner), body: { name: 'Engine overhaul', projectTypeId: type!.id, companyId: company.id } });
    const task = await ok<{ id: string }>('POST', '/tasks', { ...as(owner), body: { projectId: project.id, name: 'Inspect engine', assigneeIds: [peerId] } });
    const saturday = addDays(monday, -2);
    expect(await row(owner, peerId, saturday)).toMatchObject({ status: 'non_working' });
    await ok('PUT', '/timesheet/cells', { ...as(peer), body: { date: saturday, taskId: task.id, minutes: 120 } });
    expect(await row(owner, peerId, saturday)).toMatchObject({ status: 'working', detail: 'Weekend work' });
  });
});

describe('the timesheet column (spec 12.3)', () => {
  it("last week's status for the employee's managers and Admins only", async () => {
    const mine = await status(mgr);
    const lastWeek = addDays(monday, -7);
    expect(mine.rows.find((r) => r.id === empId)!.timesheet).toMatchObject({ weekStart: lastWeek, label: expect.any(String) });
    expect((await row(owner, peerId))!.timesheet).toMatchObject({ weekStart: lastWeek });
  });
});
