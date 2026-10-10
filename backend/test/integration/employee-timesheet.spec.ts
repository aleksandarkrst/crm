import { beforeAll, describe, expect, it } from 'vitest';
import { createTenant, ok, type Session, signIn } from './helpers';
import { asTenantSql, joinAsEmployee } from './people-helpers';

interface Summary {
  applicable: boolean;
  from: string;
  lateCount: number;
  autoSubmittedCount: number;
  returnedWeekCount: number;
  recent: { weekStart: string; autoSubmitted: boolean; firstSubmittedAt: string | null; detail: string }[];
  lastWeek: { weekStart: string; status: string; late: boolean };
}
let owner: Session, employee: Session, manager: Session, senior: Session, peer: Session;
let tenant: string, employeeId: string, managerId: string, seniorId: string, monday: string;
const as = (s: Session) => ({ token: s.token, tenant });
const summary = (s: Session, id = employeeId) => ok<Summary>('GET', `/timesheet/employees/${id}/late`, as(s));
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  [owner, employee, manager, senior, peer] = await Promise.all([
    signIn('employee-late-owner'), signIn('employee-late-employee'), signIn('employee-late-manager'),
    signIn('employee-late-senior'), signIn('employee-late-peer'),
  ]);
  tenant = await createTenant(owner, 'Employee late summary');
  employeeId = await joinAsEmployee(owner, tenant, employee);
  managerId = await joinAsEmployee(owner, tenant, manager);
  seniorId = await joinAsEmployee(owner, tenant, senior);
  await joinAsEmployee(owner, tenant, peer);
  await asTenantSql(tenant, 'update employees set manager_id = $2 where id = $1', [employeeId, managerId]);
  await asTenantSql(tenant, 'update employees set manager_id = $2 where id = $1', [managerId, seniorId]);
  monday = (await ok<{ thisWeek: string }>('GET', '/timesheet/week', as(employee))).thisWeek;
  // Seven recent flags, one older than twelve months, and one on-time week.
  for (const n of [1, 2, 3, 4, 5, 6, 7, 60]) {
    const start = addDays(monday, -7 * n);
    await asTenantSql(tenant, `insert into timesheet_weeks (tenant_id, employee_id, week_start, late_at, auto_submitted_at)
      values ($1, $2, $3, $4, $5)`, [tenant, employeeId, start, `${addDays(start, 5)}T19:00:00Z`, n === 2 ? `${addDays(start, 5)}T19:00:00Z` : null]);
    await asTenantSql(tenant, `insert into timesheet_days (tenant_id, employee_id, work_date, status, first_submitted_at)
      values ($1, $2, $3, 'rejected', $4), ($1, $2, $5, 'rejected', $4)`, [tenant, employeeId, start, `${addDays(start, 5)}T19:00:00Z`, addDays(start, 1)]);
  }
  await asTenantSql(tenant, 'insert into timesheet_weeks (tenant_id, employee_id, week_start) values ($1, $2, $3)', [tenant, employeeId, addDays(monday, -56)]);
});

describe('employee timesheet summary (CD-161)', () => {
  it('counts flagged weeks once, includes auto submission, excludes old and on-time weeks, returns five latest', async () => {
    const result = await summary(employee);
    expect(result).toMatchObject({ applicable: true, lateCount: 7, autoSubmittedCount: 1, returnedWeekCount: 7 });
    expect(result.recent.map((w) => w.weekStart)).toEqual([1, 2, 3, 4, 5].map((n) => addDays(monday, -7 * n)));
    expect(result.recent[1]).toMatchObject({ autoSubmitted: true, detail: 'Auto-submitted' });
    expect(result.recent[0]!.firstSubmittedAt).toBeTruthy();
    expect(result.lastWeek).toMatchObject({ weekStart: addDays(monday, -7), status: 'rejected', late: true });
  });
  it('allows the employee, direct manager, indirect manager and owner; refuses peers', async () => {
    for (const s of [employee, manager, senior, owner]) expect((await summary(s)).lateCount).toBe(7);
    await ok('GET', `/timesheet/employees/${employeeId}/late`, as(peer), 403);
  });
  it('does not expose another tenant employee or their flags', async () => {
    const other = await createTenant(peer, 'Other summary tenant');
    await ok('GET', `/timesheet/employees/${employeeId}/late`, { token: peer.token, tenant: other }, 404);
    expect((await summary(owner)).lateCount).toBe(7);
  });
  it('reports Not applicable when timesheet is not required', async () => {
    await asTenantSql(tenant, 'update employees set timesheet_required = false where id = $1', [managerId]);
    expect(await summary(manager, managerId)).toEqual({ applicable: false });
  });
  it('returns zero for a required employee with no history', async () => {
    expect(await summary(senior, seniorId)).toMatchObject({ applicable: true, lateCount: 0, autoSubmittedCount: 0, returnedWeekCount: 0, recent: [] });
  });
  it('recounts returned weeks after returned days are resubmitted without clearing Late history', async () => {
    await asTenantSql(tenant, `update timesheet_days set status = 'submitted' where employee_id = $1 and work_date between $2::date and $2::date + 6`, [employeeId, addDays(monday, -7)]);
    expect(await summary(owner)).toMatchObject({ lateCount: 7, returnedWeekCount: 6 });
  });
  it('measures the late submission even when an earlier day was first submitted on time', async () => {
    const last = addDays(monday, -7);
    await asTenantSql(tenant, 'update timesheet_days set first_submitted_at = $2 where employee_id = $1 and work_date = $3', [employeeId, `${last}T10:00:00Z`, last]);
    const result = await summary(owner);
    expect(result.recent[0]!.firstSubmittedAt).toBe(`${last}T10:00:00.000Z`);
    expect(result.recent[0]!.detail).toMatch(/^1 day \d+ h late$/);
  });
  it('includes the first Monday inside the calendar window and excludes the preceding Monday', async () => {
    const from = (await summary(owner)).from;
    const day = new Date(`${from}T00:00:00Z`).getUTCDay();
    const firstMonday = addDays(from, (8 - day) % 7);
    for (const start of [firstMonday, addDays(firstMonday, -7)]) {
      await asTenantSql(tenant, `insert into timesheet_weeks (tenant_id, employee_id, week_start, late_at) values ($1, $2, $3, now())`, [tenant, employeeId, start]);
    }
    expect((await summary(owner)).lateCount).toBe(8);
  });
});
