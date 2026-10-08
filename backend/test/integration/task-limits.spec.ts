/**
 * Several people on one task (CD-147): hour limits per person (validation, who sets them, history),
 * the People and hours totals with stand-in hours (task_time_fixtures until milestone 15), what an
 * assignee and a manager see, the 50-person cap and the loggable list of a late joiner.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { addMember, call, createTenant, ok, type Session, signIn } from './helpers';
import { accessOf, addEmployee, asTenantSql } from './people-helpers';

interface HoursRow {
  employeeId: string;
  name: string;
  active: boolean;
  hourLimit: number | null;
  visible: boolean;
  logged: number | null;
  approved: number | null;
  remaining: number | null;
  level: string | null;
  over: boolean;
}
interface Hours {
  rows: HoursRow[];
  total: { logged: number; approved: number; taskLimit: number | null; remaining: number | null; someWithoutLimit: boolean };
}

let owner: Session;
let lead: Session;
let ana: Session;
let marko: Session;
let petar: Session;
let jovan: Session;
let tenant: string;
type Name = 'lead' | 'ana' | 'marko' | 'petar' | 'jovan';
const emp = {} as Record<Name, string>;
let projectId: string;

const as = (s: Session = owner) => ({ token: s.token, tenant });
const newTask = (name: string, body: Record<string, unknown> = {}) => ok<{ id: string; number: number }>('POST', '/tasks', { ...as(lead), body: { projectId, name, ...body } });
const hoursOf = (taskId: string, s: Session = lead) => ok<Hours>('GET', `/tasks/${taskId}/hours`, as(s));
const row = (h: Hours, name: Name) => h.rows.find((r) => r.employeeId === emp[name])!;
/** Stand-in hours until milestone 15's time entries. */
const logged = (taskId: string, who: Name, hours: number, approved = false) =>
  asTenantSql(tenant, `insert into task_time_fixtures (tenant_id, task_id, employee_id, hours, approved) values ($1, $2, $3, $4, $5)`, [tenant, taskId, emp[who], hours, approved]);

beforeAll(async () => {
  [owner, lead, ana, marko, petar, jovan] = await Promise.all([signIn('limits-owner'), signIn('limits-lead'), signIn('limits-ana'), signIn('limits-marko'), signIn('limits-petar'), signIn('limits-jovan')]);
  tenant = await createTenant(owner, 'Limits');
  for (const [name, s] of Object.entries({ lead, ana, marko, petar, jovan }) as [Name, Session][]) {
    await addMember(owner, tenant, s, 'member');
    emp[name] = (await accessOf(s, tenant)).employeeId;
  }
  // Marko reports to Petar.
  await ok('POST', '/people/reporting-lines', { ...as(), body: { employeeIds: [emp.marko], managerId: emp.petar } }, 200);
  const company = await ok('POST', '/crm/companies', { ...as(), body: { name: 'Delta Engines' } });
  const [type] = await ok<{ id: string }[]>('GET', '/project-types', as());
  projectId = (await ok<{ id: string }>('POST', '/projects', { ...as(), body: { name: 'Engine overhaul', projectTypeId: type!.id, companyId: company.id, leadUserId: lead.userId } })).id;
});

describe('hour limits and totals', () => {
  let task: { id: string };
  beforeAll(async () => {
    task = await newTask('Overhaul engine 2');
    await ok('POST', `/tasks/${task.id}/assignees`, { ...as(lead), body: { employeeIds: [emp.ana, emp.marko], hourLimits: { [emp.ana]: 8, [emp.marko]: 6 } } });
  });

  it('sums each person, with approved hours, the task limit and remaining (TC 1, TC 2)', async () => {
    await logged(task.id, 'ana', 3, true);
    await logged(task.id, 'ana', 2);
    await logged(task.id, 'marko', 4);
    const h = await hoursOf(task.id);
    expect([row(h, 'ana').logged, row(h, 'ana').approved, row(h, 'marko').logged]).toEqual([5, 3, 4]);
    expect(h.total).toEqual({ logged: 9, approved: 3, taskLimit: 14, remaining: 5, someWithoutLimit: false });
  });

  it('an assignee sees their own hours and the others by name; a manager sees everyone (TC 7, TC 8)', async () => {
    const own = await hoursOf(task.id, ana);
    expect([row(own, 'ana').visible, row(own, 'ana').logged]).toEqual([true, 5]);
    expect([row(own, 'marko').visible, row(own, 'marko').logged, row(own, 'marko').name]).toEqual([false, null, marko.name]);
    expect(own.total.logged).toBe(9);
    const boss = await hoursOf(task.id, petar);
    expect([row(boss, 'ana').logged, row(boss, 'marko').logged]).toEqual([5, 4]);
  });

  it('the lead changes a limit inline, also below the hours logged, and history records it (TC 10, TC 14)', async () => {
    await ok('PATCH', `/tasks/${task.id}/assignees/${emp.marko}`, { ...as(lead), body: { hourLimit: 10 } }, 200);
    expect((await hoursOf(task.id)).total.taskLimit).toBe(18);
    await ok('PATCH', `/tasks/${task.id}/assignees/${emp.marko}`, { ...as(lead), body: { hourLimit: 3 } }, 200);
    const m = row(await hoursOf(task.id), 'marko');
    expect([m.hourLimit, m.remaining, m.over, m.level]).toEqual([3, -1, true, 'red']);
    const history = await ok<{ entries: { field: string | null; oldValue: unknown; newValue: unknown; label: string | null }[] }>('GET', `/tasks/${task.id}/history`, as(lead));
    expect(history.entries.filter((e) => e.field === 'hourLimit').map((e) => [e.label, e.oldValue, e.newValue])).toEqual([
      [marko.name, 10, 3],
      [marko.name, 6, 10],
    ]);
    // Only the lead, owners and admins set limits.
    expect((await call('PATCH', `/tasks/${task.id}/assignees/${emp.ana}`, { ...as(ana), body: { hourLimit: 20 } })).status).toBe(403);
  });

  it('accepts quarter hours from 0.25 to 9,999 and refuses the rest (TC 13)', async () => {
    for (const v of [0.25, 8, 9999]) await ok('PATCH', `/tasks/${task.id}/assignees/${emp.ana}`, { ...as(lead), body: { hourLimit: v } }, 200);
    for (const v of [0, 0.1, 10000, 7.3]) expect((await call('PATCH', `/tasks/${task.id}/assignees/${emp.ana}`, { ...as(lead), body: { hourLimit: v } })).status, String(v)).toBe(400);
    await ok('PATCH', `/tasks/${task.id}/assignees/${emp.ana}`, { ...as(lead), body: { hourLimit: 8 } }, 200);
  });

  it('keeps a removed person in the rows and the total (TC 3); someone without a limit drops the task limit (TC 4)', async () => {
    await ok('DELETE', `/tasks/${task.id}/assignees/${emp.marko}`, as(lead), 200);
    let h = await hoursOf(task.id);
    expect(row(h, 'marko').active).toBe(false);
    expect(h.total.logged).toBe(9);
    await ok('POST', `/tasks/${task.id}/assignees`, { ...as(lead), body: { employeeIds: [emp.jovan] } });
    h = await hoursOf(task.id);
    expect(h.total).toMatchObject({ taskLimit: null, remaining: null, someWithoutLimit: true });
  });

  it('only the lead, owners and admins assign with a limit', async () => {
    const t = await newTask('Assign with limits');
    await ok('POST', `/projects/${projectId}/members`, { ...as(), body: { employeeIds: [emp.ana] } });
    expect((await call('POST', `/tasks/${t.id}/assignees`, { ...as(ana), body: { employeeIds: [emp.ana], hourLimits: { [emp.ana]: 4 } } })).status).toBe(403);
    await ok('POST', `/tasks/${t.id}/assignees`, { ...as(ana), body: { employeeIds: [emp.ana] } });
  });
});

describe('the cap and late joiners', () => {
  it('refuses a 51st person (TC 11)', async () => {
    const t = await newTask('Big job');
    const people: string[] = [];
    for (let i = 0; i < 51; i += 17) {
      people.push(...(await Promise.all(Array.from({ length: Math.min(17, 51 - i) }, (_, k) => addEmployee(owner, tenant, { firstName: 'Crew', lastName: `Member ${i + k}` })))));
    }
    await ok('POST', `/tasks/${t.id}/assignees`, { ...as(lead), body: { employeeIds: people.slice(0, 50) } });
    const r = await call('POST', `/tasks/${t.id}/assignees`, { ...as(lead), body: { employeeIds: [people[50]] } });
    expect([r.status, (r.body as { message: string }).message]).toEqual([400, 'At most 50 people on one task']);
  });

  it('someone added to an In progress task can log time on it at once (TC 12)', async () => {
    const t = await newTask('Running job');
    await ok('PATCH', `/tasks/${t.id}`, { ...as(lead), body: { status: 'in_progress' } }, 200);
    await ok('POST', `/tasks/${t.id}/assignees`, { ...as(lead), body: { employeeIds: [emp.jovan], hourLimits: { [emp.jovan]: 4 } } });
    expect((await ok<{ id: string }[]>('GET', '/tasks/loggable', as(jovan))).map((x) => x.id)).toContain(t.id);
  });
});
