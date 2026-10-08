/**
 * Project tasks (CD-146): numbering, who sees a task (404 for everyone else) and who may change it,
 * assigning people (no duplicates, removed people kept), On hold, moving, deleting, the loggable
 * list behind canLogTime, the "Assigned to a task" email and history.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { addMember, call, createTenant, eventually, mailTo, ok, type Session, signIn, waitForMail } from './helpers';
import { accessOf, addEmployee } from './people-helpers';

interface Assignee {
  employeeId: string;
  name: string;
  active: boolean;
  hasAccount: boolean;
}
interface Task {
  id: string;
  number: number;
  name: string;
  projectId: string;
  stageId: string | null;
  stageName: string | null;
  status: string;
  onHoldReason: string | null;
  assignees: Assignee[];
  access: 'act' | 'read';
  canManage: boolean;
}

let owner: Session;
let lead: Session;
let ana: Session;
let marko: Session;
let petar: Session;
let jovan: Session;
let teammate: Session;
let tenant: string;
let otherTenant: string;
const emp: Record<string, string> = {};
let projectA: { id: string; stageId: string; projectTypeId: string };
let projectB: { id: string; stageId: string };
let noAccount: string;

const as = (s: Session = owner) => ({ token: s.token, tenant });
const newTask = (s: Session, body: Record<string, unknown>) => ok<Task>('POST', '/tasks', { ...as(s), body: { projectId: projectA.id, ...body } });
const taskOf = (s: Session, id: string) => call<Task>('GET', `/tasks/${id}`, as(s));
const loggable = async (s: Session) => (await ok<{ id: string }[]>('GET', '/tasks/loggable', as(s))).map((t) => t.id);

beforeAll(async () => {
  [owner, lead, ana, marko, petar, jovan, teammate] = await Promise.all([
    signIn('tasks-owner'),
    signIn('tasks-lead'),
    signIn('tasks-ana'),
    signIn('tasks-marko'),
    signIn('tasks-petar'),
    signIn('tasks-jovan'),
    signIn('tasks-teammate'),
  ]);
  [tenant, otherTenant] = await Promise.all([createTenant(owner, 'Tasks'), createTenant(jovan, 'Tasks other')]);
  for (const [name, s] of Object.entries({ lead, ana, marko, petar, jovan, teammate })) {
    await addMember(owner, tenant, s, 'member');
    emp[name] = (await accessOf(s, tenant)).employeeId;
  }
  // Ana reports to Marko, Marko to Petar.
  await ok('POST', '/people/reporting-lines', { ...as(), body: { employeeIds: [emp.ana], managerId: emp.marko } }, 200);
  await ok('POST', '/people/reporting-lines', { ...as(), body: { employeeIds: [emp.marko], managerId: emp.petar } }, 200);
  noAccount = await addEmployee(owner, tenant, { firstName: 'Noah', lastName: 'Noaccount' });

  const company = await ok('POST', '/crm/companies', { ...as(), body: { name: 'Northwind Logistics' } });
  const types = await ok<{ id: string; stages: { id: string }[] }[]>('GET', '/project-types', as());
  projectA = await ok('POST', '/projects', { ...as(), body: { name: 'Warehouse AC fit-out', projectTypeId: types[0]!.id, companyId: company.id, leadUserId: lead.userId } });
  projectB = await ok('POST', '/projects', { ...as(), body: { name: 'Booking website', projectTypeId: types[0]!.id, companyId: company.id, leadUserId: lead.userId } });
  await ok('POST', `/projects/${projectA.id}/members`, { ...as(), body: { employeeIds: [emp.teammate] } });
});

describe('creating and numbering', () => {
  it('numbers tasks per workspace and never reuses a number (TC 1)', async () => {
    const t1 = await newTask(lead, { name: 'Survey report' });
    const t2 = await newTask(lead, { name: 'Unit sizing' });
    const t3 = await newTask(lead, { name: 'Homepage', projectId: projectB.id });
    expect([t1.number, t2.number, t3.number]).toEqual([1, 2, 3]);
    await ok('DELETE', `/tasks/${t3.id}`, as(lead), 204);
    expect((await newTask(lead, { name: 'After a delete' })).number).toBe(4);
  });

  it('starts To do at the project stage; the team, lead and admins create, others get 403', async () => {
    const t = await newTask(teammate, { name: 'Order units' });
    expect([t.status, t.stageId, t.access]).toEqual(['todo', projectA.stageId, 'act']);
    expect((await call('POST', '/tasks', { ...as(jovan), body: { projectId: projectA.id, name: 'Nope' } })).status).toBe(403);
    expect((await call('POST', '/tasks', { ...as(marko), body: { projectId: projectA.id, name: 'Nope' } })).status).toBe(403);
    await newTask(owner, { name: 'By an owner' });
  });

  it('checks the fields: estimate in quarter hours, due not before start, a stage of the type', async () => {
    expect((await call('POST', '/tasks', { ...as(lead), body: { projectId: projectA.id, name: 'X', estimateHours: 7.3 } })).status).toBe(400);
    expect((await call('POST', '/tasks', { ...as(lead), body: { projectId: projectA.id, name: 'X', estimateHours: 0 } })).status).toBe(400);
    expect((await call('POST', '/tasks', { ...as(lead), body: { projectId: projectA.id, name: 'X', startDate: '2026-10-10', dueDate: '2026-10-09' } })).status).toBe(400);
    const web = await ok<{ stages: { id: string }[] }[]>('POST', '/project-types', { ...as(), body: { name: 'Website', stages: ['Discovery'] } });
    const otherStage = web.find((t) => t.stages.length === 1)!.stages[0]!.id;
    expect((await call('POST', '/tasks', { ...as(lead), body: { projectId: projectA.id, name: 'X', stageId: otherStage } })).status).toBe(400);
    const t = await newTask(lead, { name: 'Commissioning', estimateHours: 6.25, startDate: '2026-10-10', dueDate: '2026-10-12' });
    expect(t).toMatchObject({ estimateHours: 6.25, startDate: '2026-10-10', dueDate: '2026-10-12' });
  });
});

describe('who sees and changes a task', () => {
  let task: Task;
  beforeAll(async () => {
    task = await newTask(lead, { name: 'Install units', assigneeIds: [emp.ana] });
  });

  it('is hidden from people outside the rules: 404, and missing from lists and search (TC 2)', async () => {
    expect((await taskOf(jovan, task.id)).status).toBe(404);
    expect((await ok<Task[]>('GET', '/tasks', as(jovan))).map((t) => t.id)).not.toContain(task.id);
    expect((await ok<Task[]>('GET', '/tasks?q=install', as(jovan))).map((t) => t.id)).not.toContain(task.id);
    expect((await ok<Task[]>('GET', `/tasks?q=T-${task.number}`, as(ana))).map((t) => t.id)).toEqual([task.id]);
    // Another workspace never sees it.
    expect((await call('GET', `/tasks/${task.id}`, { token: jovan.token, tenant: otherTenant })).status).toBe(404);
  });

  it('the direct manager acts; the indirect one reads; read-only edits get 403 (TC 3, TC 4)', async () => {
    expect((await ok<Task>('GET', `/tasks/${task.id}`, as(marko))).access).toBe('act');
    const read = await ok<Task>('GET', `/tasks/${task.id}`, as(petar));
    expect([read.access, read.canManage]).toEqual(['read', false]);
    expect((await call('PATCH', `/tasks/${task.id}`, { ...as(petar), body: { name: 'Mine' } })).status).toBe(403);
    // Marko assigns his direct report, not someone else.
    expect((await call('POST', `/tasks/${task.id}/assignees`, { ...as(marko), body: { employeeIds: [emp.jovan] } })).status).toBe(403);
  });

  it('the team sees every task of the project; the lead manages', async () => {
    expect((await ok<Task[]>('GET', `/tasks?projectId=${projectA.id}`, as(teammate))).map((t) => t.id)).toContain(task.id);
    expect((await ok<Task>('GET', `/tasks/${task.id}`, as(lead))).canManage).toBe(true);
    expect((await ok<Task>('GET', `/tasks/${task.id}`, as(teammate))).canManage).toBe(false);
  });
});

describe('assigning people', () => {
  it('emails someone assigned by another person, with the task and project (TC 8)', async () => {
    const t = await newTask(lead, { name: 'Pressure test', dueDate: '2026-10-20', assigneeIds: [emp.ana] });
    const subject = `Assigned to a task: T-${t.number} Pressure test`;
    const mail = await eventually(async () => (await mailTo(owner, ana.email)).find((m) => m.subject === subject), subject);
    expect(mail.text).toContain('Warehouse AC fit-out');
    expect(mail.text).toContain('Northwind Logistics');
    expect(mail.text).toContain('Due 20 Oct 2026');
    expect(mail.text).toContain(`/tasks/${t.id}`);
  });

  it('sends nothing to yourself, to people without an account, or with "Task assignments" off (TC 7, TC 8)', async () => {
    const own = await newTask(teammate, { name: 'Own task', assigneeIds: [emp.teammate] });
    expect(own.assignees.map((a) => a.employeeId)).toEqual([emp.teammate]);
    const nobody = await newTask(lead, { name: 'For Noah', assigneeIds: [noAccount] });
    expect(nobody.assignees[0]).toMatchObject({ name: 'Noah Noaccount', hasAccount: false });

    await ok('PATCH', '/profile', { ...as(ana), body: { notifyTaskAssigned: false } }, 200);
    await newTask(lead, { name: 'Quiet one', assigneeIds: [emp.ana] });
    // A later email to someone else: the jobs before it have run by then.
    const jovanBefore = (await mailTo(owner, jovan.email)).length;
    await newTask(owner, { name: 'Marker', assigneeIds: [emp.jovan] });
    await waitForMail(owner, jovan.email, jovanBefore + 1);
    expect((await mailTo(owner, ana.email)).some((m) => m.subject.endsWith('Quiet one'))).toBe(false);
    expect(await mailTo(owner, teammate.email)).toEqual([]);
    await ok('PATCH', '/profile', { ...as(ana), body: { notifyTaskAssigned: true } }, 200);
  });

  it('refuses the same person twice (TC 6); removing keeps the row; adding again brings it back', async () => {
    const t = await newTask(lead, { name: 'Electrical check', assigneeIds: [emp.ana] });
    expect((await call('POST', `/tasks/${t.id}/assignees`, { ...as(lead), body: { employeeIds: [emp.ana] } })).status).toBe(409);
    let after = await ok<Task>('DELETE', `/tasks/${t.id}/assignees/${emp.ana}`, as(marko), 200);
    expect(after.assignees).toMatchObject([{ employeeId: emp.ana, active: false }]);
    expect((await call('DELETE', `/tasks/${t.id}/assignees/${emp.ana}`, as(lead))).status).toBe(404);
    // With none of his reports on it any more, Marko no longer sees the task.
    expect((await taskOf(marko, t.id)).status).toBe(404);
    after = await ok<Task>('POST', `/tasks/${t.id}/assignees`, { ...as(lead), body: { employeeIds: [emp.ana] } }, 201);
    expect(after.assignees).toMatchObject([{ employeeId: emp.ana, active: true }]);
    const history = await ok<{ entries: { action: string; label: string }[] }>('GET', `/tasks/${t.id}/history`, as(lead));
    expect(history.entries.slice(0, 2).map((e) => [e.action, e.label])).toEqual([
      ['participant_added', ana.name],
      ['participant_removed', ana.name],
    ]);
  });
});

describe('canLogTime through the loggable list (TC 5)', () => {
  it('lists active assignments on open tasks of open projects only', async () => {
    const t = await newTask(lead, { name: 'Log here', assigneeIds: [emp.ana] });
    expect(await loggable(ana)).toContain(t.id);
    expect(await loggable(jovan)).not.toContain(t.id);

    await ok('PATCH', `/tasks/${t.id}`, { ...as(ana), body: { status: 'done' } }, 200);
    expect(await loggable(ana)).not.toContain(t.id);
    await ok('PATCH', `/tasks/${t.id}`, { ...as(ana), body: { status: 'in_progress' } }, 200);
    expect(await loggable(ana)).toContain(t.id);

    await ok('DELETE', `/tasks/${t.id}/assignees/${emp.ana}`, as(lead), 200);
    expect(await loggable(ana)).not.toContain(t.id);
    // A late joiner gets it straight away.
    await ok('POST', `/tasks/${t.id}/assignees`, { ...as(lead), body: { employeeIds: [emp.ana] } }, 201);
    expect(await loggable(ana)).toContain(t.id);

    const closed = await ok<{ id: string }>('POST', '/projects', { ...as(), body: { name: 'Closed one', projectTypeId: projectA.projectTypeId, companyId: (await ok('GET', `/projects/${projectA.id}`, as())).companyId, leadUserId: lead.userId } });
    const c = await newTask(lead, { name: 'In a closed project', projectId: closed.id, assigneeIds: [emp.ana] });
    expect(await loggable(ana)).toContain(c.id);
    await ok('PATCH', `/projects/${closed.id}`, { ...as(), body: { status: 'completed' } }, 200);
    expect(await loggable(ana)).not.toContain(c.id);
  });
});

describe('status, moving and deleting', () => {
  it('On hold needs a reason; leaving it clears the reason (TC 10)', async () => {
    const t = await newTask(lead, { name: 'Lift permit' });
    expect((await call('PATCH', `/tasks/${t.id}`, { ...as(lead), body: { status: 'on_hold' } })).status).toBe(400);
    const held = await ok<Task>('PATCH', `/tasks/${t.id}`, { ...as(lead), body: { status: 'on_hold', onHoldReason: 'Waiting for the client' } }, 200);
    expect([held.status, held.onHoldReason]).toEqual(['on_hold', 'Waiting for the client']);
    // The reason can change while on hold, and only then.
    await ok('PATCH', `/tasks/${t.id}`, { ...as(lead), body: { onHoldReason: 'Waiting for access or keys' } }, 200);
    const back = await ok<Task>('PATCH', `/tasks/${t.id}`, { ...as(lead), body: { status: 'in_progress' } }, 200);
    expect([back.status, back.onHoldReason]).toEqual(['in_progress', null]);
    expect((await call('PATCH', `/tasks/${t.id}`, { ...as(lead), body: { onHoldReason: 'Why' } })).status).toBe(400);
    const history = await ok<{ entries: { field: string | null; newValue: unknown }[] }>('GET', `/tasks/${t.id}/history`, as(lead));
    expect(history.entries.filter((e) => e.field === 'status').map((e) => e.newValue)).toEqual(['in_progress', 'on_hold']);
  });

  it('the lead of both projects moves a task, to the other project\'s stage; others get 403 (TC 9)', async () => {
    const t = await newTask(teammate, { name: 'Move me' });
    expect((await call('PATCH', `/tasks/${t.id}`, { ...as(teammate), body: { projectId: projectB.id } })).status).toBe(403);
    const moved = await ok<Task>('PATCH', `/tasks/${t.id}`, { ...as(lead), body: { projectId: projectB.id } }, 200);
    expect([moved.projectId, moved.stageId]).toEqual([projectB.id, projectB.stageId]);
    const history = await ok<{ entries: { field: string | null; oldLabel: string | null; newLabel: string | null }[] }>('GET', `/tasks/${t.id}/history`, as(lead));
    expect(history.entries.find((e) => e.field === 'projectId')).toMatchObject({ oldLabel: 'Warehouse AC fit-out', newLabel: 'Booking website' });
  });

  it('follows the project to its new stage when the project changes type', async () => {
    const t = await newTask(lead, { name: 'Follow the type' });
    const types = await ok<{ id: string; name: string; stages: { id: string }[] }[]>('GET', '/project-types', as());
    const web = types.find((x) => x.name === 'Website')!;
    await ok('PATCH', `/projects/${projectA.id}`, { ...as(), body: { projectTypeId: web.id } }, 200);
    expect((await ok<Task>('GET', `/tasks/${t.id}`, as(lead))).stageId).toBe(web.stages[0]!.id);
    await ok('PATCH', `/projects/${projectA.id}`, { ...as(), body: { projectTypeId: projectA.projectTypeId } }, 200);
  });

  it('the lead and admins delete; the team gets 403; then it is gone', async () => {
    const t = await newTask(teammate, { name: 'Delete me' });
    expect((await call('DELETE', `/tasks/${t.id}`, as(teammate))).status).toBe(403);
    await ok('DELETE', `/tasks/${t.id}`, as(lead), 204);
    expect((await taskOf(lead, t.id)).status).toBe(404);
  });
});
