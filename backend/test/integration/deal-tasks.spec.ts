/** Tasks from the "New task" dialog leave a trail on the deal's timeline: added, then removed. */
import { beforeAll, describe, expect, it } from 'vitest';
import { createTenant, firstFunnel, type Funnel, ok, type Session, signIn } from './helpers';

let owner: Session;
let tenant: string;
let funnel: Funnel;
const as = () => ({ token: owner.token, tenant });
const titles = async (dealId: string): Promise<string[]> => (await ok('GET', `/crm/deals/${dealId}/activities`, as())).map((a: { title: string }) => a.title);

beforeAll(async () => {
  owner = await signIn('tasks-owner');
  tenant = await createTenant(owner, 'Tasks');
  funnel = await firstFunnel(owner, tenant);
});

describe('deleting a task', () => {
  it('logs "Task removed" and keeps the "Task added" entry', async () => {
    const deal = await ok('POST', '/crm/deals', { ...as(), body: { title: 'Timeline', funnelId: funnel.id } });
    const task = await ok('POST', `/crm/deals/${deal.id}/tasks`, {
      ...as(),
      body: { stageId: funnel.stages[0]!.id, label: 'Send the offer', blocksAdvance: false, dueDate: '2030-01-15' },
    });
    expect(await titles(deal.id)).toContain('Task added: Send the offer');

    await ok('DELETE', `/crm/deal-tasks/${task.id}`, as());
    const after = await titles(deal.id);
    expect(after).toContain('Task added: Send the offer');
    expect(after).toContain('Task removed: Send the offer');
    expect(after.filter((t) => t === 'Task removed: Send the offer')).toHaveLength(1);
    expect((await ok('GET', '/crm/deal-tasks', as())).some((t: { id: string }) => t.id === task.id)).toBe(false);
  });

  it('logs nothing for stage to-dos (they never logged "Task added")', async () => {
    const deal = await ok('POST', '/crm/deals', { ...as(), body: { title: 'Quiet', funnelId: funnel.id } });
    const todo = await ok('POST', `/crm/deals/${deal.id}/tasks`, { ...as(), body: { stageId: funnel.stages[0]!.id, label: 'Check budget' } });
    const before = await titles(deal.id);
    await ok('DELETE', `/crm/deal-tasks/${todo.id}`, as());
    expect(await titles(deal.id)).toEqual(before);
  });
});
