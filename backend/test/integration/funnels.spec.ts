/**
 * Funnels and stages (CD-10, CD-9): creating, renaming and deleting funnels; adding, reordering and
 * deleting stages, with the deals of a deleted stage moved and their stage history written.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { addMember, call, createTenant, type Funnel, ok, type Session, signIn } from './helpers';

let owner: Session;
let admin: Session;
let member: Session;
let stranger: Session;
let tenant: string;
let otherTenant: string;
const as = (s: Session = owner) => ({ token: s.token, tenant });

const funnelsNow = () => ok<Funnel[]>('GET', '/crm/funnels', as());
const funnelNow = async (id: string) => (await funnelsNow()).find((f) => f.id === id)!;
const newFunnel = (body: object, s: Session = owner) => ok<Funnel>('POST', '/crm/funnels', { ...as(s), body });
const newDeal = async (funnelId: string, title = 'Deal') => ok('POST', '/crm/deals', { ...as(), body: { title, funnelId } });
const history = async (dealId: string) =>
  (await ok<{ kind: string; fromStageId: string | null; toStageId: string; outcome: string; changedByUserId: string | null }[]>('GET', `/crm/deal-stage-history?dealId=${dealId}`, as())).map((r) => [
    r.kind,
    r.fromStageId,
    r.toStageId,
    r.outcome,
    r.changedByUserId,
  ]);

beforeAll(async () => {
  [owner, admin, member, stranger] = await Promise.all([signIn('funnels-owner'), signIn('funnels-admin'), signIn('funnels-member'), signIn('funnels-stranger')]);
  [tenant, otherTenant] = await Promise.all([createTenant(owner, 'Funnels'), createTenant(stranger, 'Funnels other')]);
  await addMember(owner, tenant, admin, 'admin');
  await addMember(owner, tenant, member, 'member');
});

describe('creating and renaming funnels', () => {
  it('creates a third funnel with a small default set of stages, and takes deals', async () => {
    const f = await newFunnel({ label: 'Mid-market — CMO', note: 'Marketing lead decides' });
    expect(f).toMatchObject({ label: 'Mid-market — CMO', note: 'Marketing lead decides', key: 'mid-market-cmo' });
    expect(f.stages.map((s) => s.name)).toEqual(['New deal', 'Discovery', 'Proposal', 'Won']);
    expect(f.stages.filter((s) => s.isWon).map((s) => s.name)).toEqual(['Won']);
    expect(f.stages.map((s) => s.position)).toEqual([0, 1, 2, 3]);
    const funnels = await funnelsNow();
    expect(funnels).toHaveLength(3);
    expect(funnels.at(-1)!.id).toBe(f.id);

    const deal = await newDeal(f.id, 'Third funnel deal');
    expect(deal).toMatchObject({ funnelId: f.id, stageId: f.stages[0]!.id, outcome: 'open' });
    const moved = await ok('POST', `/crm/deals/${deal.id}/move`, { ...as(), body: { stageId: f.stages[3]!.id } }, 200);
    expect(moved.outcome).toBe('won');
  });

  it('copies the stages of another funnel, with new stage and checklist ids', async () => {
    const ent = (await funnelsNow()).find((f) => f.key === 'ent')!;
    const copy = await newFunnel({ label: 'Enterprise copy', copyFromFunnelId: ent.id }, admin);
    expect(copy.stages.map((s) => [s.key, s.name, s.checklistItems.map((i) => i.label), s.isWon])).toEqual(ent.stages.map((s) => [s.key, s.name, s.checklistItems.map((i) => i.label), s.isWon]));
    const ids = new Set(ent.stages.flatMap((s) => [s.id, ...s.checklistItems.map((i) => i.id)]));
    for (const s of copy.stages) {
      expect(ids.has(s.id)).toBe(false);
      for (const i of s.checklistItems) expect(ids.has(i.id)).toBe(false);
    }
    // Two funnels with the same label get different keys.
    expect((await newFunnel({ label: 'Enterprise copy' })).key).toBe('enterprise-copy-2');
  });

  it('renames a funnel and changes its note', async () => {
    const f = await newFunnel({ label: 'Rename me' });
    const renamed = await ok<Funnel>('PATCH', `/crm/funnels/${f.id}`, { ...as(admin), body: { label: 'Renamed', note: 'How they buy' } }, 200);
    expect(renamed).toMatchObject({ id: f.id, label: 'Renamed', note: 'How they buy', key: 'rename-me' });
  });

  it('validates the input', async () => {
    for (const body of [{}, { label: '' }, { label: 'x'.repeat(101) }, { label: 'Ok', copyFromFunnelId: 'nope' }]) {
      expect((await call('POST', '/crm/funnels', { ...as(), body })).status, JSON.stringify(body)).toBe(400);
    }
    expect((await call('POST', '/crm/funnels', { ...as(), body: { label: 'Ok', copyFromFunnelId: '00000000-0000-4000-8000-000000000000' } })).status).toBe(400);
    const f = (await funnelsNow())[0]!;
    expect((await call('PATCH', `/crm/funnels/${f.id}`, { ...as(), body: {} })).status).toBe(400);
    expect((await call('PATCH', `/crm/funnels/${f.id}`, { ...as(), body: { label: '  ' } })).status).toBe(400);
  });

  it('only owners and admins change funnels; members read them', async () => {
    const f = (await funnelsNow())[0]!;
    expect((await call('GET', '/crm/funnels', as(member))).status).toBe(200);
    expect((await call('POST', '/crm/funnels', { ...as(member), body: { label: 'Nope' } })).status).toBe(403);
    expect((await call('PATCH', `/crm/funnels/${f.id}`, { ...as(member), body: { label: 'Nope' } })).status).toBe(403);
    expect((await call('DELETE', `/crm/funnels/${f.id}`, as(member))).status).toBe(403);
    expect((await call('POST', `/crm/funnels/${f.id}/stages`, { ...as(member), body: { name: 'Nope' } })).status).toBe(403);
    expect((await call('PUT', `/crm/funnels/${f.id}/stages/order`, { ...as(member), body: { stageIds: f.stages.map((s) => s.id) } })).status).toBe(403);
    expect((await call('DELETE', `/crm/funnels/${f.id}/stages/${f.stages[1]!.id}`, as(member))).status).toBe(403);
    expect((await funnelNow(f.id)).stages).toHaveLength(f.stages.length);
  });
});

describe('deleting funnels', () => {
  it('deletes a funnel without deals', async () => {
    const f = await newFunnel({ label: 'Short-lived' });
    await ok('DELETE', `/crm/funnels/${f.id}`, as(admin));
    expect((await funnelsNow()).some((x) => x.id === f.id)).toBe(false);
  });

  it('refuses a funnel with deals, or one deals have passed through', async () => {
    const f = await newFunnel({ label: 'Has deals' });
    const deal = await newDeal(f.id);
    const res = await call('DELETE', `/crm/funnels/${f.id}`, as());
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/1 deal/);
    // Moved to another funnel: its history still points at this one.
    const smb = (await funnelsNow()).find((x) => x.key === 'smb')!;
    await ok('PATCH', `/crm/deals/${deal.id}`, { ...as(), body: { funnelId: smb.id } }, 200);
    expect((await call('DELETE', `/crm/funnels/${f.id}`, as())).status).toBe(409);
    expect((await funnelsNow()).some((x) => x.id === f.id)).toBe(true);
  });

  it('keeps the last funnel', async () => {
    const solo = await signIn('funnels-solo');
    const t = await createTenant(solo, 'Solo');
    const funnels = await ok<Funnel[]>('GET', '/crm/funnels', { token: solo.token, tenant: t });
    await ok('DELETE', `/crm/funnels/${funnels[0]!.id}`, { token: solo.token, tenant: t });
    const res = await call('DELETE', `/crm/funnels/${funnels[1]!.id}`, { token: solo.token, tenant: t });
    expect(res.status).toBe(409);
  });
});

describe('adding and reordering stages', () => {
  it('adds a stage before the won stage by default, or at a position', async () => {
    const f = await newFunnel({ label: 'Stages' });
    const after = await ok<Funnel>('POST', `/crm/funnels/${f.id}/stages`, { ...as(admin), body: { name: 'Negotiation', checklistItems: [{ label: 'Terms agreed' }] } });
    expect(after.stages.map((s) => s.name)).toEqual(['New deal', 'Discovery', 'Proposal', 'Negotiation', 'Won']);
    const added = after.stages[3]!;
    expect(added).toMatchObject({ key: 'negotiation', activity: 'Negotiation', channel: 'EM', winProbability: 25, isWon: false });
    expect(added.checklistItems.map((i) => i.label)).toEqual(['Terms agreed']);
    expect(added.checklistItems[0]!.id).toMatch(/^[0-9a-f-]{36}$/);

    const first = await ok<Funnel>('POST', `/crm/funnels/${f.id}/stages`, { ...as(), body: { name: 'Research', position: 0, channel: 'RS', winProbability: 5 } });
    expect(first.stages.map((s) => s.name)).toEqual(['Research', 'New deal', 'Discovery', 'Proposal', 'Negotiation', 'Won']);
    expect(first.stages.map((s) => s.position)).toEqual([0, 1, 2, 3, 4, 5]);
    // New deals start in the (new) first stage.
    expect((await newDeal(f.id)).stageId).toBe(first.stages[0]!.id);

    // A second stage with the same name gets its own key.
    const again = await ok<Funnel>('POST', `/crm/funnels/${f.id}/stages`, { ...as(), body: { name: 'Research', position: 99 } });
    expect(again.stages.at(-1)).toMatchObject({ name: 'Research', key: 'research-2' });
  });

  it('validates new stages', async () => {
    const f = (await funnelsNow())[0]!;
    for (const body of [{}, { name: '' }, { name: 'x', position: -1 }, { name: 'x', winProbability: 101 }, { name: 'x', channel: 'XX' }, { name: 'x', checklistItems: [{ label: 'a' }, { label: 'a' }] }]) {
      expect((await call('POST', `/crm/funnels/${f.id}/stages`, { ...as(), body })).status, JSON.stringify(body)).toBe(400);
    }
    expect((await call('POST', `/crm/funnels/00000000-0000-4000-8000-000000000000/stages`, { ...as(), body: { name: 'x' } })).status).toBe(404);
  });

  it('reorders stages; deals keep their stage', async () => {
    const f = await newFunnel({ label: 'Reorder' });
    const deal = await newDeal(f.id);
    const ids = f.stages.map((s) => s.id);
    const order = [ids[1]!, ids[0]!, ids[2]!, ids[3]!];
    const after = await ok<Funnel>('PUT', `/crm/funnels/${f.id}/stages/order`, { ...as(admin), body: { stageIds: order } }, 200);
    expect(after.stages.map((s) => s.id)).toEqual(order);
    expect(after.stages.map((s) => s.position)).toEqual([0, 1, 2, 3]);
    expect((await ok('GET', `/crm/deals/${deal.id}`, as())).stageId).toBe(ids[0]);

    for (const stageIds of [order.slice(1), [...order, order[0]], [...order.slice(1), '00000000-0000-4000-8000-000000000000'], []]) {
      expect((await call('PUT', `/crm/funnels/${f.id}/stages/order`, { ...as(), body: { stageIds } })).status, JSON.stringify(stageIds)).toBe(400);
    }
  });
});

describe('deleting stages', () => {
  it('moves the deals to the chosen stage, recording the moves by the actor', async () => {
    const f = await newFunnel({ label: 'Delete with deals' });
    const [first, discovery, proposal] = f.stages;
    const open = await newDeal(f.id, 'Open one');
    const lost = await newDeal(f.id, 'Lost one');
    for (const d of [open, lost]) await ok('POST', `/crm/deals/${d.id}/move`, { ...as(), body: { stageId: discovery!.id } }, 200);
    await ok('POST', `/crm/deals/${lost.id}/lost`, { ...as(), body: { reason: 'Timing' } }, 200);

    const missing = await call('DELETE', `/crm/funnels/${f.id}/stages/${discovery!.id}`, as(admin));
    expect(missing.status).toBe(400);
    expect(missing.body.message).toMatch(/2 deals/);
    expect((await call('DELETE', `/crm/funnels/${f.id}/stages/${discovery!.id}?moveDealsTo=${discovery!.id}`, as())).status).toBe(400);
    const smb = (await funnelsNow()).find((x) => x.key === 'smb')!;
    expect((await call('DELETE', `/crm/funnels/${f.id}/stages/${discovery!.id}?moveDealsTo=${smb.stages[1]!.id}`, as())).status).toBe(400);
    expect((await call('DELETE', `/crm/funnels/${f.id}/stages/${discovery!.id}?moveDealsTo=nope`, as())).status).toBe(400);

    const after = await ok<Funnel>('DELETE', `/crm/funnels/${f.id}/stages/${discovery!.id}?moveDealsTo=${proposal!.id}`, as(admin), 200);
    expect(after.stages.map((s) => s.name)).toEqual(['New deal', 'Proposal', 'Won']);
    expect(after.stages.map((s) => s.position)).toEqual([0, 1, 2]);

    expect(await ok('GET', `/crm/deals/${open.id}`, as())).toMatchObject({ stageId: proposal!.id, outcome: 'open' });
    expect(await ok('GET', `/crm/deals/${lost.id}`, as())).toMatchObject({ stageId: proposal!.id, outcome: 'lost', lostReason: 'Timing' });
    expect((await history(open.id)).at(-1)).toEqual(['moved', discovery!.id, proposal!.id, 'open', admin.userId]);
    expect((await history(lost.id)).at(-1)).toEqual(['moved', discovery!.id, proposal!.id, 'lost', admin.userId]);
    // The earlier history still points at the deleted stage.
    expect((await history(open.id))[1]).toEqual(['moved', first!.id, discovery!.id, 'open', owner.userId]);
    const timeline = await ok<{ title: string; detail: string | null }[]>('GET', `/crm/deals/${open.id}/activities`, as());
    expect(timeline[0]).toMatchObject({ title: 'Moved to Proposal', detail: 'The stage Discovery was deleted.' });

    // A deleted stage takes no deals.
    expect((await call('POST', `/crm/deals/${open.id}/move`, { ...as(), body: { stageId: discovery!.id } })).status).toBe(400);
    expect((await call('PATCH', `/crm/funnels/${f.id}/stages/${discovery!.id}`, { ...as(), body: { name: 'Back?' } })).status).toBe(404);
    // Its key is free again.
    const readded = await ok<Funnel>('POST', `/crm/funnels/${f.id}/stages`, { ...as(), body: { name: 'Discovery', position: 1 } });
    expect(readded.stages[1]).toMatchObject({ key: 'discovery', name: 'Discovery' });
  });

  it('moving deals into the won stage wins them, but lost deals stay out of it', async () => {
    const f = await newFunnel({ label: 'Delete into won' });
    const [, discovery, proposal, won] = f.stages;
    const open = await newDeal(f.id);
    const lost = await newDeal(f.id);
    await ok('POST', `/crm/deals/${open.id}/move`, { ...as(), body: { stageId: proposal!.id } }, 200);
    await ok('POST', `/crm/deals/${lost.id}/move`, { ...as(), body: { stageId: discovery!.id } }, 200);
    await ok('POST', `/crm/deals/${lost.id}/lost`, { ...as(), body: { reason: 'Price' } }, 200);

    await ok('DELETE', `/crm/funnels/${f.id}/stages/${proposal!.id}?moveDealsTo=${won!.id}`, as(), 200);
    const deal = await ok('GET', `/crm/deals/${open.id}`, as());
    expect(deal).toMatchObject({ stageId: won!.id, outcome: 'won' });
    expect(deal.closedAt).not.toBeNull();
    expect((await history(open.id)).at(-1)).toEqual(['moved', proposal!.id, won!.id, 'won', owner.userId]);

    const res = await call('DELETE', `/crm/funnels/${f.id}/stages/${discovery!.id}?moveDealsTo=${won!.id}`, as());
    expect(res.status).toBe(409);
    expect((await funnelNow(f.id)).stages.some((s) => s.id === discovery!.id)).toBe(true);
    expect((await ok('GET', `/crm/deals/${lost.id}`, as())).stageId).toBe(discovery!.id);
  });

  it("won't delete the only won stage or the last stage", async () => {
    const f = await newFunnel({ label: 'Keep won' });
    const won = f.stages.find((s) => s.isWon)!;
    const res = await call('DELETE', `/crm/funnels/${f.id}/stages/${won.id}`, as());
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/won stage/);
    for (const s of f.stages.filter((x) => !x.isWon)) await ok('DELETE', `/crm/funnels/${f.id}/stages/${s.id}`, as(), 200);
    const left = await funnelNow(f.id);
    expect(left.stages.map((s) => s.id)).toEqual([won.id]);
    expect((await call('DELETE', `/crm/funnels/${f.id}/stages/${won.id}`, as())).status).toBe(409);
    // New deals now start in the won stage, the funnel's only one.
    expect((await newDeal(f.id)).outcome).toBe('won');
  });

  it('keeps tasks from the "New task" dialog, moving them to the target stage', async () => {
    const f = await newFunnel({ label: 'Tasks follow' });
    const [first, discovery] = f.stages;
    const deal = await newDeal(f.id);
    await ok('POST', `/crm/deals/${deal.id}/move`, { ...as(), body: { stageId: discovery!.id } }, 200);
    const task = await ok('POST', `/crm/deals/${deal.id}/tasks`, { ...as(), body: { stageId: discovery!.id, label: 'Call back', blocksAdvance: false } });
    await ok('POST', `/crm/deals/${deal.id}/tasks`, { ...as(), body: { stageId: discovery!.id, label: 'Stage to-do' } });
    await ok('DELETE', `/crm/funnels/${f.id}/stages/${discovery!.id}?moveDealsTo=${first!.id}`, as(), 200);
    const tasks = (await ok<{ id: string; dealId: string; stageId: string; label: string }[]>('GET', '/crm/deal-tasks?limit=200', as())).filter((t) => t.dealId === deal.id);
    expect(tasks.map((t) => [t.id, t.stageId])).toEqual([[task.id, first!.id]]);
  });
});

describe('tenant isolation', () => {
  it("another workspace can't see, change or delete this workspace's funnels and stages", async () => {
    const f = await newFunnel({ label: 'Private funnel' });
    const them = { token: stranger.token, tenant: otherTenant };
    expect((await ok<Funnel[]>('GET', '/crm/funnels', them)).some((x) => x.id === f.id)).toBe(false);
    expect((await call('PATCH', `/crm/funnels/${f.id}`, { ...them, body: { label: 'Hacked' } })).status).toBe(404);
    expect((await call('DELETE', `/crm/funnels/${f.id}`, them)).status).toBe(404);
    expect((await call('POST', `/crm/funnels/${f.id}/stages`, { ...them, body: { name: 'Hacked' } })).status).toBe(404);
    expect((await call('PUT', `/crm/funnels/${f.id}/stages/order`, { ...them, body: { stageIds: f.stages.map((s) => s.id) } })).status).toBe(404);
    expect((await call('DELETE', `/crm/funnels/${f.id}/stages/${f.stages[1]!.id}`, them)).status).toBe(404);
    expect((await call('POST', '/crm/funnels', { ...them, body: { label: 'Copy', copyFromFunnelId: f.id } })).status).toBe(400);
    // Their stage can't be a move target here either.
    const theirs = (await ok<Funnel[]>('GET', '/crm/funnels', them))[0]!;
    expect((await call('DELETE', `/crm/funnels/${f.id}/stages/${f.stages[1]!.id}?moveDealsTo=${theirs.stages[0]!.id}`, as())).status).toBe(400);
    expect(await funnelNow(f.id)).toMatchObject({ label: 'Private funnel' });
    expect((await funnelNow(f.id)).stages).toHaveLength(4);
    // A non-member gets 403 on this tenant.
    expect((await call('POST', '/crm/funnels', { token: stranger.token, tenant, body: { label: 'x' } })).status).toBe(403);
  });
});
