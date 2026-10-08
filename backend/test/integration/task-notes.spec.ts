/**
 * A task's checklist, comments and files (CD-270): who reads and who changes them (as for the task:
 * 404 when hidden, 403 when read-only), the checklist's order and ticks, comments oldest first and
 * deleted by their author or an admin, and files added to a task that also belong to the project.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { addMember, call, createTenant, ok, type Session, signIn } from './helpers';
import { accessOf } from './people-helpers';

interface Item {
  id: string;
  text: string;
  done: boolean;
}
interface Comment {
  id: string;
  body: string;
  authorName: string | null;
}

let owner: Session;
let lead: Session;
let ana: Session;
let petar: Session;
let marko: Session;
let stranger: Session;
let tenant: string;
let projectId: string;
let taskId: string;
const as = (s: Session = owner) => ({ token: s.token, tenant });

async function upload(s: Session, name: string, body: Record<string, string>) {
  const form = new FormData();
  form.append('file', new Blob(['report'], { type: 'text/plain' }), name);
  for (const [k, v] of Object.entries(body)) form.append(k, v);
  const res = await fetch(`${inject('apiUrl')}/api/projects/${projectId}/files`, { method: 'POST', headers: { authorization: `Bearer ${s.token}`, 'x-tenant-id': tenant }, body: form });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

beforeAll(async () => {
  [owner, lead, ana, marko, petar, stranger] = await Promise.all([signIn('notes-owner'), signIn('notes-lead'), signIn('notes-ana'), signIn('notes-marko'), signIn('notes-petar'), signIn('notes-stranger')]);
  tenant = await createTenant(owner, 'Task notes');
  const emp: Record<string, string> = {};
  for (const [name, s] of [['lead', lead], ['ana', ana], ['marko', marko], ['petar', petar], ['stranger', stranger]] as const) {
    await addMember(owner, tenant, s, 'member');
    emp[name] = (await accessOf(s, tenant)).employeeId;
  }
  // Ana reports to Marko, Marko to Petar: Petar only reads Ana's task.
  await ok('POST', '/people/reporting-lines', { ...as(), body: { employeeIds: [emp.ana], managerId: emp.marko } }, 200);
  await ok('POST', '/people/reporting-lines', { ...as(), body: { employeeIds: [emp.marko], managerId: emp.petar } }, 200);
  const company = await ok('POST', '/crm/companies', { ...as(), body: { name: 'Northwind' } });
  const [type] = await ok<{ id: string }[]>('GET', '/project-types', as());
  projectId = (await ok<{ id: string }>('POST', '/projects', { ...as(), body: { name: 'Fit-out', projectTypeId: type!.id, companyId: company.id, leadUserId: lead.userId } })).id;
  taskId = (await ok<{ id: string }>('POST', '/tasks', { ...as(lead), body: { projectId, name: 'Survey', assigneeIds: [emp.ana!] } })).id;
});

describe('checklist', () => {
  it('adds in order, ticks, edits and deletes; Enter-sized limits', async () => {
    await ok('POST', `/tasks/${taskId}/checklist`, { ...as(ana), body: { text: 'Measure the roof' } });
    let items = await ok<Item[]>('POST', `/tasks/${taskId}/checklist`, { ...as(ana), body: { text: 'Photograph the units' } });
    expect(items.map((i) => i.text)).toEqual(['Measure the roof', 'Photograph the units']);
    items = await ok<Item[]>('PATCH', `/tasks/${taskId}/checklist/${items[0]!.id}`, { ...as(ana), body: { done: true } }, 200);
    expect(items.map((i) => i.done)).toEqual([true, false]);
    items = await ok<Item[]>('PATCH', `/tasks/${taskId}/checklist/${items[1]!.id}`, { ...as(lead), body: { text: 'Photograph every unit' } }, 200);
    expect(items[1]!.text).toBe('Photograph every unit');
    expect((await call('POST', `/tasks/${taskId}/checklist`, { ...as(ana), body: { text: '  ' } })).status).toBe(400);
    items = await ok<Item[]>('DELETE', `/tasks/${taskId}/checklist/${items[0]!.id}`, as(ana), 200);
    expect(items.map((i) => i.text)).toEqual(['Photograph every unit']);
  });

  it('reads as the task does: the indirect manager reads (403 on changes), a stranger gets 404', async () => {
    expect((await ok<Item[]>('GET', `/tasks/${taskId}/checklist`, as(petar))).length).toBe(1);
    expect((await call('POST', `/tasks/${taskId}/checklist`, { ...as(petar), body: { text: 'Mine' } })).status).toBe(403);
    expect((await call('GET', `/tasks/${taskId}/checklist`, as(stranger))).status).toBe(404);
  });
});

describe('comments', () => {
  it('oldest first with the author; the author or an admin deletes, others get 403', async () => {
    await ok('POST', `/tasks/${taskId}/comments`, { ...as(ana), body: { body: 'Roof access is booked for Tuesday.' } });
    const list = await ok<Comment[]>('POST', `/tasks/${taskId}/comments`, { ...as(marko), body: { body: 'Thanks, I will join.' } });
    expect(list.map((c) => [c.authorName, c.body])).toEqual([
      [ana.name, 'Roof access is booked for Tuesday.'],
      [marko.name, 'Thanks, I will join.'],
    ]);
    expect((await call('DELETE', `/tasks/${taskId}/comments/${list[0]!.id}`, as(marko))).status).toBe(403);
    expect((await ok<Comment[]>('DELETE', `/tasks/${taskId}/comments/${list[0]!.id}`, as(ana), 200)).length).toBe(1);
    expect((await ok<Comment[]>('DELETE', `/tasks/${taskId}/comments/${list[1]!.id}`, as(owner), 200)).length).toBe(0);
    expect((await call('POST', `/tasks/${taskId}/comments`, { ...as(petar), body: { body: 'Read only' } })).status).toBe(403);
    expect((await call('GET', `/tasks/${taskId}/comments`, as(stranger))).status).toBe(404);
  });
});

describe('files', () => {
  it('a file added to a task belongs to the project too, says which task, and stays when the task goes', async () => {
    const added = await upload(ana, 'survey.txt', { taskId });
    expect(added.status).toBe(201);
    const t = await ok<{ number: number }>('GET', `/tasks/${taskId}`, as());
    const files = await ok<{ id: string; taskId: string | null; taskNumber: number | null }[]>('GET', `/projects/${projectId}/files`, as());
    expect(files.find((f) => f.id === added.body.id)).toMatchObject({ taskId, taskNumber: t.number });
    // Another project's task is refused.
    const company = await ok('POST', '/crm/companies', { ...as(), body: { name: 'Other' } });
    const [type] = await ok<{ id: string }[]>('GET', '/project-types', as());
    const other = await ok<{ id: string }>('POST', '/projects', { ...as(), body: { name: 'Other job', projectTypeId: type!.id, companyId: company.id } });
    const otherTask = await ok<{ id: string }>('POST', '/tasks', { ...as(), body: { projectId: other.id, name: 'Elsewhere' } });
    expect((await upload(ana, 'wrong.txt', { taskId: otherTask.id })).status).toBe(400);

    const temp = await ok<{ id: string }>('POST', '/tasks', { ...as(lead), body: { projectId, name: 'Temporary' } });
    const kept = await upload(lead, 'kept.txt', { taskId: temp.id });
    await ok('DELETE', `/tasks/${temp.id}`, as(lead), 204);
    const after = await ok<{ id: string; taskId: string | null }[]>('GET', `/projects/${projectId}/files`, as());
    expect(after.find((f) => f.id === kept.body.id)?.taskId).toBeNull();
  });
});
