/**
 * Time off in the timesheet (CD-170, spec 14): approved and recorded time off and sick leave
 * become read-only absence lines with the standard day's hours, counted as entered; pending
 * requests show as a hint; task hours can't go on an absence day; the lines go when the time off
 * goes; changes on submitted and approved days are traced and flagged for the approver; the sync
 * is idempotent; a holiday change resyncs.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { call, createTenant, eventually, ok, type Session, signIn, testPib } from './helpers';
import { asTenantSql, joinAsEmployee, START } from './people-helpers';

interface Day {
  date: string;
  status: string;
  minutes: number;
  expectedMinutes: number;
  absence: { kind: string; label: string; minutes: number } | null;
  pendingAbsence: string | null;
  flags: string[];
}
interface Week {
  thisWeek: string;
  days: Day[];
}

let owner: Session, mgr: Session, emp: Session;
let tenant: string, empId: string, mgrId: string, taskId: string, monday: string, next: string;
const as = (s: Session) => ({ token: s.token, tenant });
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const week = (w: string, s: Session = emp) => ok<Week>('GET', `/timesheet/week?week=${w}`, as(s));
const day = async (date: string, s: Session = emp) => (await week(addDays(date, -((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7)), s)).days.find((d) => d.date === date)!;
/** Waits for the worker's sync to put (or take away) the line. */
const settled = (date: string, check: (d: Day) => boolean, what: string) => eventually(async () => ((d) => (check(d) ? d : null))(await day(date)), what);

beforeAll(async () => {
  [owner, mgr, emp] = (await Promise.all(['owner', 'mgr', 'emp'].map((n) => signIn(`tts-${n}`)))) as [Session, Session, Session];
  tenant = await createTenant(owner, 'Time off in the timesheet');
  mgrId = await joinAsEmployee(owner, tenant, mgr);
  empId = await joinAsEmployee(owner, tenant, emp);
  for (const id of [mgrId, empId]) await ok('PATCH', `/people/employees/${id}`, { ...as(owner), body: { employmentStartDate: START, ...(id === empId ? { managerId: mgrId } : {}) } }, 200);
  // No preloaded holidays: every weekday is a full working day in these tests.
  await ok('POST', '/timesheet/holidays/preload', { ...as(owner), body: { country: 'none' } }, 200);
  await asTenantSql(tenant, `delete from public_holidays where source = 'preload'`, []);
  const company = await ok<{ id: string }>('POST', '/crm/companies', { ...as(owner), body: { pib: testPib(), name: 'Hidrogradnja' } });
  const [type] = await ok<{ id: string }[]>('GET', '/project-types', as(owner));
  const project = await ok<{ id: string }>('POST', '/projects', { ...as(owner), body: { name: 'Engine overhaul', projectTypeId: type!.id, companyId: company.id } });
  taskId = (await ok<{ id: string }>('POST', '/tasks', { ...as(owner), body: { projectId: project.id, name: 'Inspect engine', assigneeIds: [empId] } })).id;
  monday = (await ok<Week>('GET', '/timesheet/week', as(emp))).thisWeek;
  next = addDays(monday, 14);
});

describe('lines from time off (spec 14.1, 14.2)', () => {
  it('a pending request is a hint without hours; approved, a read-only line counted as entered; cancelled, gone', async () => {
    const r = await ok<{ id: string }>('POST', '/timeoff/requests', { ...as(emp), body: { type: 'vacation', startDate: next, endDate: addDays(next, 1) } });
    expect(await day(next)).toMatchObject({ absence: null, pendingAbsence: 'Vacation pending', minutes: 0 });
    await ok('POST', `/timeoff/requests/${r.id}/approve`, { ...as(mgr), body: {} }, 200);
    const line = await settled(next, (d) => !!d.absence, 'the vacation line');
    expect(line).toMatchObject({ absence: { kind: 'vacation', label: 'Vacation', minutes: 480 }, pendingAbsence: null, minutes: 480 });
    expect((await day(addDays(next, 1))).absence?.label).toBe('Vacation');
    // The approver sees the same in the approvals week.
    const theirs = await ok<{ week: Week }>('GET', `/timesheet/approvals/${empId}/week?week=${next}`, as(mgr));
    expect(theirs.week.days[0]!.absence?.label).toBe('Vacation');
    await ok('POST', `/timeoff/requests/${r.id}/cancel`, { ...as(emp), body: {} }, 200);
    expect(await settled(next, (d) => !d.absence, 'the line removed')).toMatchObject({ absence: null, minutes: 0 });
  });

  it('recorded leave and sick leave fill this week; no task hours on those days; the sick leave type never shows', async () => {
    const rec = await ok<{ id: string }>('POST', '/timeoff/requests', { ...as(owner), body: { employeeId: empId, type: 'paid_leave', reasonId: (await ok<{ id: string; name: string }[]>('GET', '/timeoff/reasons?kind=paid_leave', as(owner))).find((x) => x.name === 'Marriage')!.id, startDate: monday, endDate: monday, record: { reason: 'Agreed on paper' } } });
    expect(rec.id).toBeTruthy();
    await settled(monday, (d) => d.absence?.label === 'Paid leave: Marriage', 'the paid leave line');
    const types = await ok<{ id: string }[]>('GET', '/timeoff/sick-leave-types', as(owner));
    await ok('POST', '/timeoff/sick-leave', { ...as(owner), body: { employeeId: empId, startDate: addDays(monday, 1), endDate: addDays(monday, 1), typeId: types[0]!.id, confirm: true } });
    const sick = await settled(addDays(monday, 1), (d) => !!d.absence, 'the sick leave line');
    expect(sick.absence).toEqual({ kind: 'sick_leave', label: 'Sick leave', minutes: 480 });
    const refused = await call('PUT', '/timesheet/cells', { ...as(emp), body: { date: addDays(monday, 1), taskId, minutes: 60 } });
    expect(refused.status).toBe(409);
    expect((await call('POST', '/timesheet/entries', { ...as(emp), body: { date: monday, taskId, minutes: 60 } })).status).toBe(409);
    // Other days take task hours as before; an entry can't move onto an absence day.
    await ok('PUT', '/timesheet/cells', { ...as(emp), body: { date: addDays(monday, 2), taskId, minutes: 480 } });
    const moving = await ok<{ id: string }>('POST', '/timesheet/entries', { ...as(emp), body: { date: addDays(monday, 2), taskId, minutes: 15 } });
    expect((await call('PATCH', `/timesheet/entries/${moving.id}`, { ...as(emp), body: { date: addDays(monday, 1) } })).status).toBe(409);
    await ok('DELETE', `/timesheet/entries/${moving.id}`, as(emp));
  });

  it('the sync is idempotent', async () => {
    const run = () => ok<{ changed: number }>('POST', '/dev/timeoff/sync-timesheet', { ...as(owner), body: { employeeId: empId, from: addDays(monday, -7), to: addDays(next, 14) } }, 200);
    await run();
    expect((await run()).changed).toBe(0);
  });
});

describe('submitted and approved days (spec 14.3)', () => {
  it('a change on a submitted day is flagged for the approver; on an approved day traced, with conflict and missing-hours flags', async () => {
    await ok('PUT', '/timesheet/cells', { ...as(emp), body: { date: addDays(monday, 3), taskId, minutes: 480 } });
    await ok('POST', '/timesheet/submit', { ...as(emp), body: { weekStart: monday } });
    const thursday = addDays(monday, 3);
    const wednesday = addDays(monday, 2);
    const types = await ok<{ id: string }[]>('GET', '/timeoff/sick-leave-types', as(owner));
    // Submitted Friday gets sick leave: the approver sees it changed after submission.
    const friday = addDays(monday, 4);
    const fri = await ok<{ id: string }>('POST', '/timeoff/sick-leave', { ...as(owner), body: { employeeId: empId, startDate: friday, endDate: friday, typeId: types[0]!.id, confirm: true } });
    const f = await settled(friday, (d) => !!d.absence, 'Friday line');
    expect(f.flags).toContain('Changed after submission: Sick leave added');
    await ok('POST', '/timesheet/approvals/approve', { ...as(mgr), body: { employeeId: empId, weekStart: monday } });
    // Approved Thursday with task hours gets sick leave through the lock: the hours stay, the conflict is flagged.
    await ok('POST', '/timeoff/sick-leave', { ...as(owner), body: { employeeId: empId, startDate: thursday, endDate: thursday, typeId: types[0]!.id, confirm: true } });
    const t = await settled(thursday, (d) => !!d.absence, 'Thursday line');
    expect(t).toMatchObject({ status: 'approved', minutes: 960 });
    expect(t.flags).toEqual(expect.arrayContaining(['Changed after approval: Sick leave added', 'Conflict: absence and task hours']));
    // Removing an absence from an approved day without task hours leaves it short.
    await ok('POST', `/timeoff/sick-leave/${fri.id}/cancel`, { ...as(owner), body: { reason: 'Wrong day' } }, 200);
    const gone = await settled(friday, (d) => !d.absence, 'Friday line removed');
    expect(gone.flags).toEqual(expect.arrayContaining(['Changed after approval: Sick leave removed', 'Missing hours after absence removed']));
    // The history has the trace, by the time off module.
    const history = await ok<{ events: { date: string; kind: string; actorName: string | null; comment: string | null }[] }>('GET', `/timesheet/approvals/${empId}/history?week=${monday}`, as(mgr));
    expect(history.events.filter((e) => e.kind === 'absence_changed' && e.date === thursday)).toEqual([expect.objectContaining({ actorName: 'Time off', comment: 'Sick leave added' })]);
    expect((await day(wednesday)).flags).toEqual([]);
  });
});

describe('the holiday calendar and the standard day (spec 14.1)', () => {
  it('a new holiday on an absence day takes its line away; deleting it brings the line back', async () => {
    const start = addDays(next, 7);
    const r = await ok<{ id: string }>('POST', '/timeoff/requests', { ...as(emp), body: { type: 'vacation', startDate: start, endDate: addDays(start, 1) } });
    await ok('POST', `/timeoff/requests/${r.id}/approve`, { ...as(mgr), body: {} }, 200);
    await settled(addDays(start, 1), (d) => !!d.absence, 'the vacation line');
    const holiday = await ok<{ id: string }>('POST', '/timesheet/holidays', { ...as(owner), body: { date: addDays(start, 1), name: 'Company day' } });
    await settled(addDays(start, 1), (d) => !d.absence, 'the line removed by the holiday');
    expect((await day(start)).absence?.label).toBe('Vacation');
    await ok('DELETE', `/timesheet/holidays/${holiday.id}`, as(owner));
    await settled(addDays(start, 1), (d) => !!d.absence, 'the line back after the holiday went');
  });

  it('a shorter standard day changes the lines\' hours', async () => {
    const start = addDays(next, 7);
    await ok('PATCH', '/workspace', { ...as(owner), body: { timesheet: { dayMinutes: 420 } } });
    expect((await settled(start, (d) => d.absence?.minutes === 420, 'the 7 h line')).minutes).toBe(420);
    await ok('PATCH', '/workspace', { ...as(owner), body: { timesheet: { dayMinutes: 480 } } });
    await settled(start, (d) => d.absence?.minutes === 480, 'the 8 h line again');
  });
});
