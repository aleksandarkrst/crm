/**
 * Late status (CD-155, spec 5.5): a week whose required day goes in for the first time after the
 * deadline is Late (Submit week and a single day alike), and stays so; recalling and resubmitting
 * days first submitted on time never makes it Late; the week says when the deadline passed and
 * which days would make it Late.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { addMember, createTenant, ok, type Session, signIn } from './helpers';
import { accessOf, asTenantSql } from './people-helpers';

interface Week {
  thisWeek: string;
  late: boolean;
  deadlinePassed: boolean;
  submittable: string[];
  lateIfSubmitted: string[];
  days: { date: string; status: string }[];
}

let owner: Session;
let ana: Session;
let marko: Session;
let tenant: string;
let taskId: string;
let monday: string;

const as = (s: Session = owner) => ({ token: s.token, tenant });
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const week = (s: Session, start?: string) => ok<Week>('GET', `/timesheet/week${start ? `?week=${start}` : ''}`, as(s));
const deadline = (timesheet: Record<string, unknown>) => ok('PATCH', '/workspace', { ...as(), body: { timesheet } });
const log = (s: Session, date: string, minutes = 480) => ok('PUT', '/timesheet/cells', { ...as(s), body: { date, taskId, minutes } });

beforeAll(async () => {
  [owner, ana, marko] = await Promise.all([signIn('late-owner'), signIn('late-ana'), signIn('late-marko')]);
  tenant = await createTenant(owner, 'Late');
  await addMember(owner, tenant, ana, 'member');
  await addMember(owner, tenant, marko, 'member');
  const ids = [(await accessOf(ana, tenant)).employeeId, (await accessOf(marko, tenant)).employeeId];
  const company = await ok<{ id: string }>('POST', '/crm/companies', { ...as(), body: { name: 'Kovin Pančevo' } });
  const [type] = await ok<{ id: string }[]>('GET', '/project-types', as());
  const project = await ok<{ id: string }>('POST', '/projects', { ...as(), body: { name: 'Service contract 2026', projectTypeId: type!.id, companyId: company.id } });
  taskId = (await ok<{ id: string }>('POST', '/tasks', { ...as(), body: { projectId: project.id, name: 'Hydraulic leak', assigneeIds: ids } })).id;
  monday = (await week(ana)).thisWeek;
});

describe('late status', () => {
  it('a week first submitted after its deadline is Late, and stays Late (AC 1, 2)', async () => {
    const last = addDays(monday, -7);
    await log(ana, last);
    const before = await week(ana, last);
    expect(before).toMatchObject({ deadlinePassed: true, late: false });
    expect(before.lateIfSubmitted).toEqual(before.submittable);
    const after = await ok<Week>('POST', '/timesheet/submit', { ...as(ana), body: { weekStart: last } }, 201);
    expect(after).toMatchObject({ late: true, lateIfSubmitted: [] });
    // Recall and resubmit: still Late, never cleared.
    await ok('POST', '/timesheet/recall', { ...as(ana), body: { weekStart: last } }, 201);
    expect((await week(ana, last)).late).toBe(true);
    expect((await week(ana, last)).lateIfSubmitted).toEqual([]);
    await ok('POST', '/timesheet/submit', { ...as(ana), body: { weekStart: last } }, 201);
    expect((await week(ana, last)).late).toBe(true);
  });

  it('one day submitted late (day by day) makes the week Late too', async () => {
    const last = addDays(monday, -7);
    await deadline({ approvalMode: 'day' });
    await log(marko, last);
    const w = await ok<Week>('POST', '/timesheet/submit', { ...as(marko), body: { weekStart: last, date: last } }, 201);
    expect(w.late).toBe(true);
    expect(w.days[0]!.status).toBe('submitted');
    expect(w.days[1]!.status).toBe('draft');
    await deadline({ approvalMode: 'week' });
  });

  it('on time is not Late; recalling and resubmitting after the deadline keeps it so; a day never submitted before does make it Late (AC 1, 2)', async () => {
    // A deadline that hasn't come yet: next Sunday 23:59.
    await deadline({ deadlineWeekday: 7, deadlineTime: '23:59', deadlineWeek: 'next' });
    await log(marko, monday);
    const onTime = await ok<Week>('POST', '/timesheet/submit', { ...as(marko), body: { weekStart: monday } }, 201);
    expect(onTime).toMatchObject({ late: false, deadlinePassed: false });
    await ok('POST', '/timesheet/recall', { ...as(marko), body: { weekStart: monday } }, 201);
    // The deadline moves to this Monday 00:00, which has passed: the recalled days went in on time.
    await deadline({ deadlineWeekday: 1, deadlineTime: '00:00', deadlineWeek: 'same' });
    const recalled = await week(marko);
    expect(recalled).toMatchObject({ deadlinePassed: true, lateIfSubmitted: [] });
    expect((await ok<Week>('POST', '/timesheet/submit', { ...as(marko), body: { weekStart: monday } }, 201)).late).toBe(false);
    // Sunday gets hours: a required day that never went in.
    await log(marko, addDays(monday, 6), 120);
    const w = await week(marko);
    expect(w.lateIfSubmitted).toEqual([addDays(monday, 6)]);
    expect((await ok<Week>('POST', '/timesheet/submit', { ...as(marko), body: { weekStart: monday } }, 201)).late).toBe(true);
    await deadline({ deadlineWeekday: 5, deadlineTime: '17:00', deadlineWeek: 'same' });
  });

  it('the audit log says which submissions were late', async () => {
    const rows = await asTenantSql<{ data: { late: boolean } }>(tenant, `select data from audit_logs where action = 'timesheet.submitted' order by created_at`);
    // Ana late, her resubmit not; Marko's single day late; his on-time week and its resubmit not; his Sunday late.
    expect(rows.map((r) => r.data.late)).toEqual([true, false, true, false, false, true]);
  });
});
