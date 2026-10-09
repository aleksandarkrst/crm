/**
 * Approval mode (CD-156): only owners and admins change it (403 for others) and the audit log has
 * it; Whole week offers only Submit week (a single day is refused); Day by day submits one day, the
 * week shows the mix ("Partly submitted"), and switching the mode keeps every day's status.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { addMember, call, createTenant, ok, type Session, signIn } from './helpers';
import { accessOf, asTenantSql } from './people-helpers';

interface Week {
  thisWeek: string;
  status: string;
  statusLabel: string;
  submittable: string[];
  settings: { approvalMode: string };
  days: { date: string; status: string }[];
  rows: { id: string }[];
}

let owner: Session;
let ana: Session;
let tenant: string;
let taskId: string;
let emptyTaskId: string;
let monday: string;

const as = (s: Session = owner) => ({ token: s.token, tenant });
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const setMode = (approvalMode: string, s: Session = owner) => call('PATCH', '/workspace', { ...as(s), body: { timesheet: { approvalMode } } });
const week = () => ok<Week>('GET', '/timesheet/week', as(ana));
const submit = (body: Record<string, unknown>) => call<Week>('POST', '/timesheet/submit', { ...as(ana), body });

beforeAll(async () => {
  [owner, ana] = await Promise.all([signIn('tam-owner'), signIn('tam-ana')]);
  tenant = await createTenant(owner, 'Approval mode');
  await addMember(owner, tenant, ana, 'member');
  const anaId = (await accessOf(ana, tenant)).employeeId;
  const company = await ok<{ id: string }>('POST', '/crm/companies', { ...as(), body: { name: 'Hidrogradnja' } });
  const [type] = await ok<{ id: string }[]>('GET', '/project-types', as());
  const project = await ok<{ id: string }>('POST', '/projects', { ...as(), body: { name: 'Engine overhaul', projectTypeId: type!.id, companyId: company.id } });
  taskId = (await ok<{ id: string }>('POST', '/tasks', { ...as(), body: { projectId: project.id, name: 'Inspect engine', assigneeIds: [anaId] } })).id;
  emptyTaskId = (await ok<{ id: string }>('POST', '/tasks', { ...as(), body: { projectId: project.id, name: 'Not started yet', assigneeIds: [anaId] } })).id;
  monday = (await week()).thisWeek;
  await ok('PUT', '/timesheet/cells', { ...as(ana), body: { date: monday, taskId, minutes: 480 } });
  await ok('POST', '/timesheet/rows', { ...as(ana), body: { weekStart: monday, taskId: emptyTaskId } });
});

describe('approval mode', () => {
  it('is Whole week by default; only owners and admins change it, and the audit log has it (AC 3)', async () => {
    expect((await week()).settings.approvalMode).toBe('week');
    expect((await setMode('day', ana)).status).toBe(403);
    expect((await setMode('daily')).status).toBe(400);
    const res = await setMode('day');
    expect(res.status).toBe(200);
    expect(res.body.timesheet.approvalMode).toBe('day');
    const [audit] = await asTenantSql<{ data: { timesheet: Record<string, unknown> } }>(tenant, `select data from audit_logs where action = 'workspace.updated' order by created_at desc limit 1`);
    expect(audit!.data.timesheet).toEqual({ approvalMode: 'day' });
    await setMode('week');
  });

  it('Whole week: a single day is refused, only the week can be submitted (AC 2)', async () => {
    const refused = await submit({ weekStart: monday, date: monday });
    expect(refused.status).toBe(400);
    expect(JSON.stringify(refused.body)).toContain('approves whole weeks');
  });

  it('Day by day: one day is submitted, the week shows the mix, the rest stays editable (AC 2)', async () => {
    await setMode('day');
    expect((await submit({ weekStart: addDays(monday, 7), date: addDays(monday, 7) })).status).toBe(400);
    expect((await submit({ weekStart: monday, date: addDays(monday, 7) })).status).toBe(400);
    expect((await submit({ weekStart: monday, date: addDays(monday, 5) })).status).toBe(400);
    const res = await submit({ weekStart: monday, date: monday });
    expect(res.status).toBe(201);
    const w = res.body;
    expect(w.days.map((d) => d.status)).toEqual(['submitted', 'draft', 'draft', 'draft', 'draft', 'draft', 'draft']);
    expect(w).toMatchObject({ status: 'partly_submitted', statusLabel: 'Partly submitted (1 of 5 days)' });
    // The week isn't done: its empty row stays.
    expect(w.rows.map((r) => r.id).sort()).toEqual([taskId, emptyTaskId].sort());
    // Tuesday is still Draft and takes hours.
    await ok('PUT', '/timesheet/cells', { ...as(ana), body: { date: addDays(monday, 1), taskId, minutes: 240 } });
    expect((await call('PUT', '/timesheet/cells', { ...as(ana), body: { date: monday, taskId, minutes: 60 } })).status).toBe(409);
  });

  it('switching the mode keeps every day status; Submit week then sends the rest (AC 1)', async () => {
    await setMode('week');
    const w = await week();
    expect(w.days[0]!.status).toBe('submitted');
    expect(w.submittable).not.toContain(monday);
    const all = await submit({ weekStart: monday });
    expect(all.status).toBe(201);
    expect(all.body.days.slice(0, 5).every((d) => d.status === 'submitted')).toBe(true);
    expect(all.body.status).toBe('submitted');
    // Submit week drops rows still without hours.
    expect(all.body.rows.map((r) => r.id)).toEqual([taskId]);
  });
});
