/**
 * Lost deals (CD-60): mark lost with a reason, reopen, the outcome in lists, the timeline and the
 * stage history rows (CD-61) they write.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { call, createTenant, type Funnel, ok, type Session, signIn } from './helpers';

let owner: Session;
let other: Session;
let tenant: string;
let otherTenant: string;
let smb: Funnel;
let ent: Funnel;
const as = () => ({ token: owner.token, tenant });

const newDeal = async (title: string) => ok('POST', '/crm/deals', { ...as(), body: { title, funnelId: smb.id } });
const history = async (dealId: string) =>
  (await ok<{ kind: string; fromStageId: string | null; toStageId: string; outcome: string; changedByUserId: string }[]>('GET', `/crm/deal-stage-history?dealId=${dealId}`, as())).map(
    (r) => [r.kind, r.fromStageId, r.toStageId, r.outcome],
  );
const activityTitles = async (dealId: string) => (await ok<{ title: string; detail: string | null }[]>('GET', `/crm/deals/${dealId}/activities`, as())).map((a) => a.title);

beforeAll(async () => {
  [owner, other] = await Promise.all([signIn('lost-owner'), signIn('lost-other')]);
  [tenant, otherTenant] = await Promise.all([createTenant(owner, 'Lost deals'), createTenant(other, 'Lost other')]);
  const funnels = await ok<Funnel[]>('GET', '/crm/funnels', as());
  smb = funnels.find((f) => f.key === 'smb')!;
  ent = funnels.find((f) => f.key === 'ent')!;
});

describe('marking a deal as lost', () => {
  it('stores the reason, note and date, keeps the stage, logs it and records a history row', async () => {
    const deal = await newDeal('Lost on price');
    expect(deal.outcome).toBe('open');
    const stage = smb.stages[2]!;
    await ok('POST', `/crm/deals/${deal.id}/move`, { ...as(), body: { stageId: stage.id } }, 200);

    const lost = await ok('POST', `/crm/deals/${deal.id}/lost`, { ...as(), body: { reason: 'Price', note: 'Went with a cheaper studio' } }, 200);
    expect(lost).toMatchObject({ outcome: 'lost', lostReason: 'Price', lostNote: 'Went with a cheaper studio', stageId: stage.id });
    expect(Date.parse(lost.lostAt)).toBeGreaterThan(Date.now() - 60_000);

    expect(await ok('GET', `/crm/deals/${deal.id}`, as())).toMatchObject({ outcome: 'lost', lostReason: 'Price' });
    const row = (await ok('GET', '/crm/deals', as())).find((r: { deal: { id: string } }) => r.deal.id === deal.id);
    expect(row.deal).toMatchObject({ outcome: 'lost', lostReason: 'Price', lostNote: 'Went with a cheaper studio' });

    const activities = await ok<{ title: string; detail: string | null; channel: string }[]>('GET', `/crm/deals/${deal.id}/activities`, as());
    expect(activities[0]).toMatchObject({ title: 'Marked as lost: Price', detail: 'Went with a cheaper studio', channel: 'NT' });

    expect(await history(deal.id)).toEqual([
      ['created', null, smb.stages[0]!.id, 'open'],
      ['moved', smb.stages[0]!.id, stage.id, 'open'],
      ['lost', stage.id, stage.id, 'lost'],
    ]);
  });

  it('the note is optional', async () => {
    const deal = await newDeal('Lost, no note');
    const lost = await ok('POST', `/crm/deals/${deal.id}/lost`, { ...as(), body: { reason: 'No decision', note: '' } }, 200);
    expect(lost).toMatchObject({ outcome: 'lost', lostReason: 'No decision', lostNote: null });
  });

  it('only accepts a reason from the pick list', async () => {
    const deal = await newDeal('Validation');
    for (const body of [{}, { reason: 'Bad vibes' }, { reason: '' }, { reason: 'price' }, { reason: 'Other', note: 'x'.repeat(1001) }]) {
      const res = await call('POST', `/crm/deals/${deal.id}/lost`, { ...as(), body });
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect((await ok('GET', `/crm/deals/${deal.id}`, as())).outcome).toBe('open');
    expect(await history(deal.id)).toHaveLength(1);
    for (const reason of ['Price', 'Timing', 'Chose a competitor', 'No budget', 'No decision', 'Other']) {
      const d = await newDeal(`Reason ${reason}`);
      expect((await ok('POST', `/crm/deals/${d.id}/lost`, { ...as(), body: { reason } }, 200)).lostReason).toBe(reason);
    }
  });

  it('refuses a deal that is already lost, and a won deal', async () => {
    const deal = await newDeal('Twice');
    await ok('POST', `/crm/deals/${deal.id}/lost`, { ...as(), body: { reason: 'Timing' } }, 200);
    expect((await call('POST', `/crm/deals/${deal.id}/lost`, { ...as(), body: { reason: 'Price' } })).status).toBe(409);
    expect((await ok('GET', `/crm/deals/${deal.id}`, as())).lostReason).toBe('Timing');

    const won = await newDeal('Won deal');
    const wonStage = smb.stages[smb.stages.length - 1]!;
    expect((await ok('POST', `/crm/deals/${won.id}/move`, { ...as(), body: { stageId: wonStage.id } }, 200)).outcome).toBe('won');
    const res = await call('POST', `/crm/deals/${won.id}/lost`, { ...as(), body: { reason: 'Price' } });
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/won stage/);
  });

  it("a lost deal can't be moved or switched to another funnel until it is reopened", async () => {
    const deal = await newDeal('Frozen');
    await ok('POST', `/crm/deals/${deal.id}/lost`, { ...as(), body: { reason: 'No budget' } }, 200);
    expect((await call('POST', `/crm/deals/${deal.id}/move`, { ...as(), body: { stageId: smb.stages[1]!.id } })).status).toBe(409);
    expect((await call('PATCH', `/crm/deals/${deal.id}`, { ...as(), body: { funnelId: ent.id } })).status).toBe(409);
    // Other fields can still be edited.
    expect((await ok('PATCH', `/crm/deals/${deal.id}`, { ...as(), body: { title: 'Frozen, renamed' } })).outcome).toBe('lost');
    const after = await ok('GET', `/crm/deals/${deal.id}`, as());
    expect(after).toMatchObject({ stageId: smb.stages[0]!.id, funnelId: smb.id, title: 'Frozen, renamed' });
  });

  it('filters the deal list by outcome', async () => {
    const lostIds = (await ok('GET', '/crm/deals?outcome=lost&limit=200', as())).map((r: { deal: { id: string; outcome: string } }) => r.deal.outcome);
    expect(lostIds.length).toBeGreaterThan(0);
    expect(new Set(lostIds)).toEqual(new Set(['lost']));
    const won = (await ok('GET', '/crm/deals?outcome=won', as())).map((r: { deal: { title: string; outcome: string } }) => [r.deal.title, r.deal.outcome]);
    expect(won).toEqual([['Won deal', 'won']]);
    const open = (await ok('GET', '/crm/deals?outcome=open&limit=200', as())).map((r: { deal: { outcome: string } }) => r.deal.outcome);
    expect(new Set(open)).toEqual(new Set(['open']));
    expect((await call('GET', '/crm/deals?outcome=closed', as())).status).toBe(400);
  });
});

describe('reopening a lost deal', () => {
  it('clears the reason, keeps the stage, logs it and records a history row', async () => {
    const deal = await newDeal('Comeback');
    const stage = smb.stages[1]!;
    await ok('POST', `/crm/deals/${deal.id}/move`, { ...as(), body: { stageId: stage.id } }, 200);
    await ok('POST', `/crm/deals/${deal.id}/lost`, { ...as(), body: { reason: 'Chose a competitor', note: 'Picked Acme' } }, 200);

    const reopened = await ok('POST', `/crm/deals/${deal.id}/reopen`, as(), 200);
    expect(reopened).toMatchObject({ outcome: 'open', lostAt: null, lostReason: null, lostNote: null, stageId: stage.id });
    expect((await activityTitles(deal.id)).slice(0, 2)).toEqual(['Reopened', 'Marked as lost: Chose a competitor']);
    expect(await history(deal.id)).toEqual([
      ['created', null, smb.stages[0]!.id, 'open'],
      ['moved', smb.stages[0]!.id, stage.id, 'open'],
      ['lost', stage.id, stage.id, 'lost'],
      ['reopened', stage.id, stage.id, 'open'],
    ]);

    // Open again: it moves normally, and can be lost again.
    await ok('POST', `/crm/deals/${deal.id}/move`, { ...as(), body: { stageId: smb.stages[2]!.id } }, 200);
    expect((await ok('POST', `/crm/deals/${deal.id}/lost`, { ...as(), body: { reason: 'Timing' } }, 200)).lostNote).toBeNull();
  });

  it('refuses a deal that is not lost', async () => {
    const deal = await newDeal('Never lost');
    const res = await call('POST', `/crm/deals/${deal.id}/reopen`, as());
    expect(res.status).toBe(409);
    expect(await history(deal.id)).toHaveLength(1);
  });

  it("another tenant can't mark lost or reopen this tenant's deals", async () => {
    const deal = await newDeal('Private');
    const asOther = { token: other.token, tenant: otherTenant };
    expect((await call('POST', `/crm/deals/${deal.id}/lost`, { ...asOther, body: { reason: 'Price' } })).status).toBe(404);
    expect((await call('POST', `/crm/deals/${deal.id}/reopen`, asOther)).status).toBe(404);
    expect((await call('POST', `/crm/deals/${deal.id}/lost`, { token: other.token, tenant, body: { reason: 'Price' } })).status).toBe(403);
    expect((await ok('GET', `/crm/deals/${deal.id}`, as())).outcome).toBe('open');
  });
});
