/**
 * CD-32: checklist items have stable ids, and playbook to-dos are matched to them by id, so
 * renaming an item in the funnel builder keeps every deal's progress on it.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { addMember, call, createTenant, type Funnel, ok, type Session, signIn, type Stage } from './helpers';

let owner: Session;
let member: Session;
let tenant: string;
let funnel: Funnel;
const as = () => ({ token: owner.token, tenant });

interface Task {
  id: string;
  dealId: string;
  stageId: string;
  label: string;
  checklistItemId: string | null;
  done: boolean;
  note: string | null;
}

const stageNow = async (id: string): Promise<Stage> => {
  const funnels = await ok<Funnel[]>('GET', '/crm/funnels', as());
  return funnels.flatMap((f) => f.stages).find((s) => s.id === id)!;
};
const tasksOf = async (dealId: string): Promise<Task[]> => (await ok<Task[]>('GET', '/crm/deal-tasks?limit=200', as())).filter((t) => t.dealId === dealId);
const setItems = (stageId: string, checklistItems: { id?: string; label: string }[]) =>
  ok<Stage>('PATCH', `/crm/funnels/${funnel.id}/stages/${stageId}`, { ...as(), body: { checklistItems } }, 200);
const tick = (dealId: string, stageId: string, checklistItemId: string, extra: object = {}) =>
  ok<Task>('PUT', `/crm/deals/${dealId}/tasks/playbook`, { ...as(), body: { stageId, checklistItemId, done: true, ...extra } }, 200);
const newDeal = async (title: string) => (await ok('POST', '/crm/deals', { ...as(), body: { title, funnelId: funnel.id } })).id as string;

beforeAll(async () => {
  [owner, member] = await Promise.all([signIn('checklist-owner'), signIn('checklist-member')]);
  tenant = await createTenant(owner, 'Checklist');
  await addMember(owner, tenant, member, 'member');
  funnel = (await ok<Funnel[]>('GET', '/crm/funnels', as())).find((f) => f.key === 'smb')!;
});

describe('checklist items', () => {
  it('every stage lists its checklist as items with ids (the labels-only column is gone, CD-78)', () => {
    for (const stage of funnel.stages) {
      expect(stage.checklistItems.length).toBeGreaterThan(0);
      expect(stage).not.toHaveProperty('checklist');
      for (const item of stage.checklistItems) expect(item.id).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it('renaming an item keeps the ticks and notes of every deal on it', async () => {
    const stage = funnel.stages[1]!;
    const [first, second] = stage.checklistItems;
    const [a, b] = [await newDeal('Rename A'), await newDeal('Rename B')];
    const ticked = await tick(a, stage.id, first!.id, { note: 'Sent on Monday' });
    expect(ticked).toMatchObject({ checklistItemId: first!.id, label: first!.label, done: true, note: 'Sent on Monday' });
    await tick(b, stage.id, first!.id);

    const saved = await setItems(stage.id, [{ id: first!.id, label: 'Intro email sent' }, second!]);
    expect(saved.checklistItems).toEqual([{ id: first!.id, label: 'Intro email sent' }, second]);

    for (const deal of [a, b]) {
      const [task] = await tasksOf(deal);
      expect(task).toMatchObject({ id: deal === a ? ticked.id : expect.any(String), checklistItemId: first!.id, label: 'Intro email sent', done: true });
    }
    expect((await tasksOf(a))[0]!.note).toBe('Sent on Monday');

    // Unticking by id after the rename updates the same row.
    const unticked = await ok<Task>('PUT', `/crm/deals/${a}/tasks/playbook`, { ...as(), body: { stageId: stage.id, checklistItemId: first!.id, done: false } }, 200);
    expect(unticked).toMatchObject({ id: ticked.id, done: false, label: 'Intro email sent' });
  });

  it('swapping two names keeps each to-do with its own item', async () => {
    const stage = funnel.stages[2]!;
    const [x, y] = stage.checklistItems;
    const deal = await newDeal('Swap');
    await tick(deal, stage.id, x!.id, { note: 'x' });
    await tick(deal, stage.id, y!.id, { note: 'y' });
    await setItems(stage.id, [
      { id: x!.id, label: y!.label },
      { id: y!.id, label: x!.label },
    ]);
    const byItem = new Map((await tasksOf(deal)).map((t) => [t.checklistItemId, t]));
    expect(byItem.get(x!.id)).toMatchObject({ label: y!.label, note: 'x' });
    expect(byItem.get(y!.id)).toMatchObject({ label: x!.label, note: 'y' });
  });

  it('new items get ids, and a removed item takes its progress out of view', async () => {
    const stage = funnel.stages[3]!;
    const deal = await newDeal('Add and remove');
    await tick(deal, stage.id, stage.checklistItems[0]!.id);
    const saved = await setItems(stage.id, [stage.checklistItems[1]!, { label: 'Case study attached' }]);
    const added = saved.checklistItems[1]!;
    expect(added).toMatchObject({ label: 'Case study attached', id: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    expect((await tick(deal, stage.id, added.id)).checklistItemId).toBe(added.id);
    // The removed item can't be ticked any more.
    const res = await call('PUT', `/crm/deals/${deal}/tasks/playbook`, { ...as(), body: { stageId: stage.id, checklistItemId: stage.checklistItems[0]!.id, done: true } });
    expect(res.status).toBe(400);
  });

  it('renaming onto the name of a removed item keeps the renamed item’s own state', async () => {
    const stage = funnel.stages[4]!;
    const [gone, kept] = stage.checklistItems;
    const deal = await newDeal('Takeover');
    await tick(deal, stage.id, gone!.id, { note: 'old' });
    await tick(deal, stage.id, kept!.id, { note: 'mine' });
    await setItems(stage.id, [kept!]); // `gone` is removed; its to-do stays, unlinked from the checklist
    await setItems(stage.id, [{ id: kept!.id, label: gone!.label }]);
    const tasks = await tasksOf(deal);
    expect(tasks.find((t) => t.checklistItemId === kept!.id)).toMatchObject({ label: gone!.label, note: 'mine' });
    // The removed item's to-do is kept, unlinked (and hidden); it never takes over the renamed item.
    expect(tasks.find((t) => t.checklistItemId === gone!.id)).toMatchObject({ note: 'old' });
  });

  it('to-dos are ticked by item id only; labels alone are refused (CD-78)', async () => {
    const stage = await stageNow(funnel.stages[0]!.id);
    const item = stage.checklistItems[0]!;
    const deal = await newDeal('By id');
    const byLabel = await call('PUT', `/crm/deals/${deal}/tasks/playbook`, { ...as(), body: { stageId: stage.id, label: item.label, done: true } });
    expect(byLabel.status).toBe(400);
    expect(await tasksOf(deal)).toEqual([]);

    const first = await tick(deal, stage.id, item.id, { note: 'once' });
    const again = await tick(deal, stage.id, item.id, { done: false });
    expect(again).toMatchObject({ id: first.id, checklistItemId: item.id, label: item.label, done: false, note: 'once' });
    expect(await tasksOf(deal)).toHaveLength(1);

    // A labels-only checklist is not accepted any more.
    const res = await call('PATCH', `/crm/funnels/${funnel.id}/stages/${stage.id}`, { ...as(), body: { checklist: [item.label, 'Brand-new check'] } });
    expect(res.status).toBe(400);
  });

  it('validates the checklist and the role', async () => {
    const stage = funnel.stages[5]!;
    const url = `/crm/funnels/${funnel.id}/stages/${stage.id}`;
    const id = stage.checklistItems[0]!.id;
    for (const body of [
      { checklistItems: [{ label: 'Same' }, { label: 'Same' }] },
      { checklistItems: [{ id, label: 'One' }, { id, label: 'Two' }] },
      { checklistItems: [{ id: 'not-a-uuid', label: 'x' }] },
      { checklistItems: [{ label: '' }] },
      { checklistItems: Array.from({ length: 21 }, (_, i) => ({ label: 'Item ' + i })) },
    ]) {
      expect((await call('PATCH', url, { ...as(), body })).status, JSON.stringify(body)).toBe(400);
    }
    expect((await call('PATCH', url, { token: member.token, tenant, body: { checklistItems: [] } })).status).toBe(403);
    const deal = await newDeal('Validation');
    expect((await call('PUT', `/crm/deals/${deal}/tasks/playbook`, { ...as(), body: { stageId: stage.id, done: true } })).status).toBe(400);
  });

  it("another workspace can't tick a to-do by item id on this workspace's deal", async () => {
    const stranger = await signIn('checklist-stranger');
    const otherTenant = await createTenant(stranger, 'Checklist other');
    const stage = funnel.stages[1]!;
    const deal = await newDeal('Private');
    const res = await call('PUT', `/crm/deals/${deal}/tasks/playbook`, { token: stranger.token, tenant: otherTenant, body: { stageId: stage.id, checklistItemId: stage.checklistItems[0]!.id, done: true } });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await tasksOf(deal)).toEqual([]);
  });
});
