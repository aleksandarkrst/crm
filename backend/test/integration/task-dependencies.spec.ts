/**
 * Task dependencies (CD-269): "Waits for" a task of the same project, no loops, the Dependencies
 * lists (Waits for / Blocks) on the task, deleting or moving clears them, and the history names them.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { addMember, call, createTenant, ok, type Session, signIn } from './helpers';

interface Brief {
  id: string;
  number: number;
  name: string;
  status: string;
}
interface Task {
  id: string;
  number: number;
  waitsForTaskId: string | null;
  waitsFor: { id: string; number: number; status: string } | null;
  dependencies: { waitsFor: Brief | null; blocks: Brief[] };
}

let owner: Session;
let member: Session;
let tenant: string;
let projectA: string;
let projectB: string;
const as = (s: Session = owner) => ({ token: s.token, tenant });
const newTask = (name: string, projectId = projectA) => ok<Task>('POST', '/tasks', { ...as(), body: { projectId, name } });
const waitFor = (id: string, waitsForTaskId: string | null) => call<Task>('PATCH', `/tasks/${id}`, { ...as(), body: { waitsForTaskId } });

beforeAll(async () => {
  [owner, member] = await Promise.all([signIn('deps-owner'), signIn('deps-member')]);
  tenant = await createTenant(owner, 'Dependencies');
  await addMember(owner, tenant, member, 'member');
  const company = await ok('POST', '/crm/companies', { ...as(), body: { name: 'Warehouse Co' } });
  const [type] = await ok<{ id: string }[]>('GET', '/project-types', as());
  projectA = (await ok<{ id: string }>('POST', '/projects', { ...as(), body: { name: 'AC fit-out', projectTypeId: type!.id, companyId: company.id } })).id;
  projectB = (await ok<{ id: string }>('POST', '/projects', { ...as(), body: { name: 'Booking site', projectTypeId: type!.id, companyId: company.id } })).id;
});

describe('waits for / blocks', () => {
  it('a task waits for another of the same project; both sides list it', async () => {
    const survey = await newTask('Survey');
    const install = await newTask('Install');
    const t = (await waitFor(install.id, survey.id)).body;
    expect(t.waitsFor).toMatchObject({ id: survey.id, number: survey.number, status: 'todo' });
    expect(t.dependencies.waitsFor).toMatchObject({ id: survey.id, name: 'Survey' });
    const s = await ok<Task>('GET', `/tasks/${survey.id}`, as());
    expect(s.dependencies.blocks.map((b) => b.name)).toEqual(['Install']);
    expect(s.dependencies.waitsFor).toBeNull();
    // The history names it.
    const history = await ok<{ entries: { field: string | null; newLabel: string | null }[] }>('GET', `/tasks/${install.id}/history`, as());
    expect(history.entries.find((e) => e.field === 'waitsForTaskId')?.newLabel).toBe(`T-${survey.number} · Survey`);
  });

  it('refuses itself, another project and a loop', async () => {
    const a = await newTask('A');
    const b = await newTask('B');
    const c = await newTask('C');
    const other = await newTask('Elsewhere', projectB);
    expect((await waitFor(a.id, a.id)).status).toBe(400);
    expect((await waitFor(a.id, other.id)).status).toBe(400);
    expect((await waitFor(b.id, a.id)).status).toBe(200);
    expect((await waitFor(c.id, b.id)).status).toBe(200);
    // a ← b ← c: a can't wait for b or c.
    const loop = await waitFor(a.id, c.id);
    expect([loop.status, (loop.body as unknown as { message: string }).message]).toEqual([400, 'That task already waits for this one']);
    expect((await waitFor(a.id, b.id)).status).toBe(400);
    // Clearing works.
    expect((await waitFor(c.id, null)).body.waitsForTaskId).toBeNull();
  });

  it('deleting the task it waits for, or moving either one, clears the dependency', async () => {
    const first = await newTask('First');
    const second = await newTask('Second');
    await waitFor(second.id, first.id);
    await ok('DELETE', `/tasks/${first.id}`, as(), 204);
    expect((await ok<Task>('GET', `/tasks/${second.id}`, as())).waitsForTaskId).toBeNull();

    const x = await newTask('X');
    const y = await newTask('Y');
    await waitFor(y.id, x.id);
    await ok('PATCH', `/tasks/${x.id}`, { ...as(), body: { projectId: projectB } }, 200);
    expect((await ok<Task>('GET', `/tasks/${y.id}`, as())).waitsForTaskId).toBeNull();
  });

  it('lists show the dependency in brief, without the other task\'s name', async () => {
    const p = await newTask('Permit');
    const lift = await newTask('Lift');
    await waitFor(lift.id, p.id);
    const row = (await ok<Task[]>('GET', `/tasks?projectId=${projectA}`, as())).find((t) => t.id === lift.id)!;
    expect(row.waitsFor).toEqual({ id: p.id, number: p.number, status: 'todo', dueDate: null });
    expect(row).not.toHaveProperty('dependencies');
  });
});
