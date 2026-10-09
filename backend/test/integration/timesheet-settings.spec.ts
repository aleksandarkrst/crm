/**
 * Timesheet settings and holidays (CD-153): only owners and admins change them (403 for members and
 * managers), validation, the audit log; the standard working day, the time format and the daily
 * maximum taking effect in the Timesheet and on time entries; public holidays (one per date, copy
 * from last year, isolation) lowering Expected and moving the deadline; and auto submit at the
 * deadline (Late and Auto-submitted, weeks without hours and rejected days left alone, once).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { addMember, call, createTenant, ok, type Session, signIn } from './helpers';
import { accessOf, asTenantSql } from './people-helpers';

interface Day {
  date: string;
  status: string;
  expectedMinutes: number;
  holiday: { name: string; minutes: number } | null;
}
interface Week {
  weekStart: string;
  thisWeek: string;
  deadline: { date: string; time: string };
  settings: { dayMinutes: number; maxDayMinutes: number; timeFormat: string };
  late: boolean;
  autoSubmitted: boolean;
  days: Day[];
}
interface Holiday {
  id: string;
  date: string;
  name: string;
  minutes: number | null;
}

let owner: Session;
let ana: Session;
let marko: Session;
let tenant: string;
let other: string;
let anaId: string;
let markoId: string;
let taskId: string;
let monday: string;

const as = (s: Session = owner, t = tenant) => ({ token: s.token, tenant: t });
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const setTimesheet = (timesheet: Record<string, unknown>, s: Session = owner) => call('PATCH', '/workspace', { ...as(s), body: { timesheet } });
const week = (s: Session = ana, start?: string) => ok<Week>('GET', `/timesheet/week${start ? `?week=${start}` : ''}`, as(s));

beforeAll(async () => {
  [owner, ana, marko] = await Promise.all([signIn('tss-owner'), signIn('tss-ana'), signIn('tss-marko')]);
  tenant = await createTenant(owner, 'Timesheet settings');
  other = await createTenant(owner, 'Timesheet settings other');
  await addMember(owner, tenant, ana, 'member');
  await addMember(owner, tenant, marko, 'member');
  anaId = (await accessOf(ana, tenant)).employeeId;
  markoId = (await accessOf(marko, tenant)).employeeId;
  // Marko manages Ana: a manager still can't change the settings.
  await ok('POST', '/people/reporting-lines', { ...as(), body: { employeeIds: [anaId], managerId: markoId } }, 200);
  const company = await ok<{ id: string }>('POST', '/crm/companies', { ...as(), body: { name: 'Kovin Pančevo' } });
  const [type] = await ok<{ id: string }[]>('GET', '/project-types', as());
  const project = await ok<{ id: string }>('POST', '/projects', { ...as(), body: { name: 'Service contract 2026', projectTypeId: type!.id, companyId: company.id } });
  taskId = (await ok<{ id: string }>('POST', '/tasks', { ...as(), body: { projectId: project.id, name: 'Parts price list', assigneeIds: [anaId, markoId] } })).id;
  monday = (await week()).thisWeek;
});

describe('the settings', () => {
  it('start at 8 h Monday to Friday, 7.50, 12 h a day, due Friday 17:00 the same week, no auto submit', async () => {
    const w = await ok<{ timesheet: Record<string, unknown> }>('GET', '/workspace', as(ana));
    expect(w.timesheet).toEqual({
      dayMinutes: 480,
      dayStart: '08:00',
      dayEnd: '16:00',
      workingDays: [1, 2, 3, 4, 5],
      timeFormat: 'decimal',
      maxDayHours: 12,
      deadlineWeekday: 5,
      deadlineTime: '17:00',
      deadlineWeek: 'same',
      autoSubmit: false,
    });
  });

  it('members and managers get 403; owners change them and the audit log says so (AC 6)', async () => {
    expect((await setTimesheet({ maxDayHours: 10 }, ana)).status).toBe(403);
    expect((await setTimesheet({ maxDayHours: 10 }, marko)).status).toBe(403);
    const res = await setTimesheet({ maxDayHours: 10, timeFormat: 'clock' });
    expect(res.status).toBe(200);
    expect(res.body.timesheet).toMatchObject({ maxDayHours: 10, timeFormat: 'clock' });
    const [audit] = await asTenantSql<{ data: { timesheet: Record<string, unknown> } }>(tenant, `select data from audit_logs where action = 'workspace.updated' order by created_at desc limit 1`);
    expect(audit!.data.timesheet).toEqual({ maxDayHours: 10, timeFormat: 'clock' });
  });

  it('refuses what makes no sense', async () => {
    expect((await setTimesheet({ maxDayHours: 25 })).status).toBe(400);
    expect((await setTimesheet({ maxDayHours: 0 })).status).toBe(400);
    expect((await setTimesheet({ workingDays: [] })).status).toBe(400);
    expect((await setTimesheet({ workingDays: [1, 1] })).status).toBe(400);
    expect((await setTimesheet({ dayMinutes: 470 })).status).toBe(400);
    expect((await setTimesheet({ dayStart: '17:00' })).status).toBe(400);
    expect((await setTimesheet({ deadlineTime: '25:00' })).status).toBe(400);
  });

  it('take effect: the standard day and working days drive Expected; the format and maximum show and apply (AC 1, 2, 3)', async () => {
    await ok('PATCH', '/workspace', { ...as(), body: { timesheet: { dayMinutes: 450, workingDays: [1, 2, 3, 4, 5, 6], maxDayHours: 2 } } });
    const w = await week();
    expect(w.days.map((d) => d.expectedMinutes)).toEqual([450, 450, 450, 450, 450, 450, 0]);
    expect(w.settings).toEqual({ dayMinutes: 450, maxDayMinutes: 120, timeFormat: 'clock' });
    const cell = await call('PUT', '/timesheet/cells', { ...as(ana), body: { date: monday, taskId, minutes: 135 } });
    expect(cell.status).toBe(400);
    expect(JSON.stringify(cell.body)).toContain('Maximum 2 h per day');
    expect((await call('POST', '/timesheet/entries', { ...as(ana), body: { taskId, date: monday, minutes: 135 } })).status).toBe(400);
    await ok('PATCH', '/workspace', { ...as(), body: { timesheet: { dayMinutes: 480, workingDays: [1, 2, 3, 4, 5], maxDayHours: 12, timeFormat: 'decimal' } } });
  });
});

describe('public holidays', () => {
  it('owners and admins add, edit and remove them; members read them; one per date (AC 7)', async () => {
    const year = Number(monday.slice(0, 4));
    expect((await call('POST', '/timesheet/holidays', { ...as(ana), body: { date: `${year}-05-01`, name: 'Labour Day' } })).status).toBe(403);
    const h = await ok<Holiday>('POST', '/timesheet/holidays', { ...as(), body: { date: `${year}-05-01`, name: 'Labour Day' } });
    expect(h).toMatchObject({ date: `${year}-05-01`, name: 'Labour Day', minutes: null });
    const dup = await call('POST', '/timesheet/holidays', { ...as(), body: { date: `${year}-05-01`, name: 'Again' } });
    expect(dup.status).toBe(409);
    expect((await ok<Holiday[]>('GET', `/timesheet/holidays?year=${year}`, as(ana))).map((x) => x.name)).toContain('Labour Day');
    expect((await call('PATCH', `/timesheet/holidays/${h.id}`, { ...as(ana), body: { name: 'x' } })).status).toBe(403);
    expect(await ok<Holiday>('PATCH', `/timesheet/holidays/${h.id}`, { ...as(), body: { name: 'Labour Day (1)', minutes: 240 } })).toMatchObject({ name: 'Labour Day (1)', minutes: 240 });
    expect((await call('DELETE', `/timesheet/holidays/${h.id}`, as(ana))).status).toBe(403);
    await ok('DELETE', `/timesheet/holidays/${h.id}`, as(), 204);
    expect((await call('POST', '/timesheet/holidays', { ...as(), body: { date: `${year}-05-02`, name: 'x', minutes: 10 } })).status).toBe(400);
  });

  it('Copy from last year copies only dates the year has none on', async () => {
    await ok('POST', '/timesheet/holidays', { ...as(), body: { date: '2030-01-01', name: 'New Year' } });
    await ok('POST', '/timesheet/holidays', { ...as(), body: { date: '2030-01-07', name: 'Orthodox Christmas' } });
    await ok('POST', '/timesheet/holidays', { ...as(), body: { date: '2031-01-01', name: 'Already there' } });
    const res = await ok<{ copied: number; holidays: Holiday[] }>('POST', '/timesheet/holidays/copy', { ...as(), body: { year: 2031 } }, 200);
    expect(res.copied).toBe(1);
    expect(res.holidays.map((x) => [x.date, x.name])).toEqual([
      ['2031-01-01', 'Already there'],
      ['2031-01-07', 'Orthodox Christmas'],
    ]);
  });

  it("another workspace never sees them (RLS)", async () => {
    expect(await ok<Holiday[]>('GET', '/timesheet/holidays?year=2030', as(owner, other))).toEqual([]);
    const [{ n }] = (await asTenantSql<{ n: number }>(other, `select count(*)::int as n from public_holidays`)) as [{ n: number }];
    expect(n).toBe(0);
  });

  it('show in the Timesheet and lower Expected; a deadline on one moves on (AC 4, 8)', async () => {
    const wed = addDays(monday, 2);
    const thu = addDays(monday, 3);
    const fri = addDays(monday, 4);
    const created = await Promise.all([
      ok<Holiday>('POST', '/timesheet/holidays', { ...as(), body: { date: wed, name: 'Statehood Day' } }),
      ok<Holiday>('POST', '/timesheet/holidays', { ...as(), body: { date: thu, name: 'Half day', minutes: 240 } }),
      ok<Holiday>('POST', '/timesheet/holidays', { ...as(), body: { date: fri, name: 'Long weekend' } }),
    ]);
    const w = await week();
    expect(w.days[2]).toMatchObject({ holiday: { name: 'Statehood Day', minutes: 480 }, expectedMinutes: 0 });
    expect(w.days[3]).toMatchObject({ holiday: { name: 'Half day', minutes: 240 }, expectedMinutes: 240 });
    // Friday is a holiday: the deadline moves past the weekend to Monday.
    expect(w.deadline).toEqual({ date: addDays(monday, 7), time: '17:00' });
    for (const h of created) await ok('DELETE', `/timesheet/holidays/${h.id}`, as(), 204);
    expect((await week()).deadline).toEqual({ date: fri, time: '17:00' });
  });
});

describe('auto submit at the deadline (AC 5)', () => {
  it('submits draft days of weeks with hours, flags them Late and Auto-submitted, leaves the rest, once', async () => {
    const next = addDays(monday, 7);
    // Next week's hours (written straight: the API takes hours up to the end of this week).
    await asTenantSql(tenant, `insert into time_entries (tenant_id, employee_id, task_id, work_date, minutes) values ($1, $2, $3, $4, 480), ($1, $2, $3, $5, 240)`, [tenant, anaId, taskId, next, addDays(next, 1)]);
    await asTenantSql(tenant, `insert into timesheet_days (tenant_id, employee_id, work_date, status) values ($1, $2, $3, 'rejected')`, [tenant, anaId, addDays(next, 1)]);
    // Off: nothing happens.
    const tick = (now: string) => ok<{ submitted: number }>('POST', '/dev/timesheet/deadline-tick', { ...as(), body: { now } }, 200);
    const afterDeadline = `${addDays(next, 7)}T10:00:00.000Z`;
    expect((await tick(afterDeadline)).submitted).toBe(0);
    await ok('PATCH', '/workspace', { ...as(), body: { timesheet: { autoSubmit: true } } });
    expect((await tick(afterDeadline)).submitted).toBeGreaterThanOrEqual(1);
    const w = await week(ana, next);
    expect(w).toMatchObject({ late: true, autoSubmitted: true });
    expect(w.days.map((d) => d.status)).toEqual(['submitted', 'rejected', 'submitted', 'submitted', 'submitted', 'draft', 'draft']);
    // Marko had no hours: left alone.
    const m = await week(marko, next);
    expect(m).toMatchObject({ late: false, autoSubmitted: false });
    expect(m.days.every((d) => d.status === 'draft')).toBe(true);
    // Run twice (or after downtime): once.
    expect((await tick(afterDeadline)).submitted).toBe(0);
    await ok('PATCH', '/workspace', { ...as(), body: { timesheet: { autoSubmit: false } } });
  });

  it('the next deadline for the settings page', async () => {
    const due = await ok<{ weekNumber: number; date: string; time: string }>('GET', '/timesheet/deadline', as(ana));
    expect(due.time).toBe('17:00');
    expect(due.date >= monday).toBe(true);
  });
});
