/**
 * The advance gate (CD-363): forward moves refused with the reasons while a stage's to-dos are open
 * or its documentation isn't marked complete; backward moves free; Won only from the last stage in a
 * gated funnel; "documentation complete" with who and when; late days; Remind the owner; the digest.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { addMember, call, createTenant, type Funnel, ok, type Session, signIn } from './helpers';
import { asTenantSql } from './people-helpers';

let owner: Session;
let seller: Session;
let tenant: string;
let funnel: Funnel;
const asOwner = () => ({ token: owner.token, tenant });
const asSeller = () => ({ token: seller.token, tenant });
const stage = (i: number) => funnel.stages.filter((s) => !s.isWon).sort((a, b) => a.position - b.position)[i]!;
const won = () => funnel.stages.find((s) => s.isWon)!;

const newDeal = (title: string) => ok<{ id: string }>('POST', '/crm/deals', { ...asOwner(), body: { title, funnelId: funnel.id, ownerUserId: owner.userId } });
const move = (dealId: string, stageId: string) => call<{ message: string; blockers?: string[] }>('POST', `/crm/deals/${dealId}/move`, { ...asSeller(), body: { stageId } });
const tickAll = async (dealId: string, i: number) => {
  for (const item of stage(i).checklistItems) await ok('PUT', `/crm/deals/${dealId}/tasks/playbook`, { ...asSeller(), body: { stageId: stage(i).id, checklistItemId: item.id, done: true } });
};
const editStage = (i: number, body: Record<string, unknown>) => ok('PATCH', `/crm/funnels/${funnel.id}/stages/${stage(i).id}`, { ...asOwner(), body });

beforeAll(async () => {
  [owner, seller] = await Promise.all([signIn('gate-owner'), signIn('gate-seller')]);
  tenant = await createTenant(owner, 'Stage gate', { gated: true });
  await addMember(owner, tenant, seller, 'member');
  funnel = (await ok<Funnel[]>('GET', '/crm/funnels', asOwner()))[0]!;
});

describe('the to-do gate', () => {
  it('a new workspace\'s stages need their to-dos done (new stages start with the gate on)', async () => {
    const fresh = (await ok<Funnel[]>('GET', '/crm/funnels', asOwner()))[0]!;
    expect(fresh.stages.filter((s) => !s.isWon).every((s) => s.gateTodos && !s.gateDocsComplete)).toBe(true);
  });

  it('refuses a forward move with open to-dos, with the reasons; ticking them lets it through', async () => {
    const deal = await newDeal('Gate · to-dos');
    const refused = await move(deal.id, stage(1).id);
    expect(refused.status).toBe(409);
    const n = stage(0).checklistItems.length;
    expect(refused.body.blockers).toEqual([`${n} ${n === 1 ? 'to-do' : 'to-dos'} open in ${stage(0).name}`]);
    expect(refused.body.message).toContain(`can't move to ${stage(1).name} yet`);

    await tickAll(deal.id, 0);
    // An open off-playbook to-do of the stage still blocks; a "New task" task never does.
    const extra = await ok<{ id: string }>('POST', `/crm/deals/${deal.id}/tasks`, { ...asSeller(), body: { stageId: stage(0).id, label: 'Send NDA' } });
    await ok('POST', `/crm/deals/${deal.id}/tasks`, { ...asSeller(), body: { stageId: stage(0).id, label: 'Call back', blocksAdvance: false } });
    expect((await move(deal.id, stage(1).id)).body.blockers).toEqual([`1 to-do open in ${stage(0).name}`]);
    await ok('PATCH', `/crm/deal-tasks/${extra.id}`, { ...asSeller(), body: { done: true } });

    expect((await move(deal.id, stage(1).id)).status).toBe(200);
  });

  it('moves backward freely, with open to-dos in the stage it leaves', async () => {
    const deal = await newDeal('Gate · backward');
    await tickAll(deal.id, 0);
    expect((await move(deal.id, stage(1).id)).status).toBe(200);
    expect((await move(deal.id, stage(0).id)).status).toBe(200);
  });

  it('with the switch off, open to-dos don\'t block', async () => {
    await editStage(2, { gateTodos: false });
    const deal = await newDeal('Gate · switch off');
    await tickAll(deal.id, 0);
    await tickAll(deal.id, 1);
    expect((await move(deal.id, stage(1).id)).status).toBe(200);
    expect((await move(deal.id, stage(2).id)).status).toBe(200);
    expect((await move(deal.id, stage(3).id)).status).toBe(200);
    await editStage(2, { gateTodos: true });
  });
});

describe('the documentation gate', () => {
  it('needs documentation marked complete, which records who and when', async () => {
    await editStage(0, { gateTodos: false, gateDocsComplete: true });
    const deal = await newDeal('Gate · documentation');
    expect((await move(deal.id, stage(1).id)).body.blockers).toEqual([`Documentation isn't marked complete in ${stage(0).name}`]);

    const before = Date.now();
    const state = await ok<{ docsComplete: boolean; docsCompleteByUserId: string; docsCompleteAt: string }>('PUT', `/crm/deals/${deal.id}/stages/${stage(0).id}/docs-complete`, {
      ...asSeller(),
      body: { complete: true },
    });
    expect(state).toMatchObject({ docsComplete: true, docsCompleteByUserId: seller.userId });
    expect(Date.parse(state.docsCompleteAt)).toBeGreaterThanOrEqual(before - 1000);
    const read = await ok<{ stageStates: { stageId: string; docsComplete: boolean; docsCompleteByUserId: string }[] }>('GET', `/crm/deals/${deal.id}`, asOwner());
    expect(read.stageStates).toEqual([expect.objectContaining({ stageId: stage(0).id, docsComplete: true, docsCompleteByUserId: seller.userId })]);
    const log = await ok<{ title: string }[]>('GET', `/crm/deals/${deal.id}/activities`, asOwner());
    expect(log[0]!.title).toBe(`Documentation marked complete in ${stage(0).name}`);

    expect((await move(deal.id, stage(1).id)).status).toBe(200);

    // Unticking clears who and when.
    expect(await ok('PUT', `/crm/deals/${deal.id}/stages/${stage(0).id}/docs-complete`, { ...asSeller(), body: { complete: false } })).toMatchObject({
      docsComplete: false,
      docsCompleteByUserId: null,
      docsCompleteAt: null,
    });
    await editStage(0, { gateTodos: true, gateDocsComplete: false });
  });
});

describe('winning in a gated funnel', () => {
  it('is only possible from the last stage before Won', async () => {
    const deal = await newDeal('Gate · win early');
    await tickAll(deal.id, 0);
    const last = funnel.stages.filter((s) => !s.isWon).sort((a, b) => a.position - b.position).at(-1)!;
    const refused = await move(deal.id, won().id);
    expect(refused.status).toBe(409);
    expect(refused.body.blockers?.[0]).toBe(`Win it from ${last.name}, the last stage before Won`);
  });

  it('is free in a funnel without gates', async () => {
    const free = await createTenant(owner, 'Stage gate free');
    const f = (await ok<Funnel[]>('GET', '/crm/funnels', { token: owner.token, tenant: free }))[0]!;
    const deal = await ok<{ id: string }>('POST', '/crm/deals', { token: owner.token, tenant: free, body: { title: 'Win any time', funnelId: f.id } });
    expect((await call('POST', `/crm/deals/${deal.id}/move`, { token: owner.token, tenant: free, body: { stageId: f.stages.find((s) => s.isWon)!.id } })).status).toBe(200);
  });
});

describe('late, the stage owner, Remind the owner and the digest', () => {
  let dealId: string;

  beforeAll(async () => {
    await ok('PATCH', `/crm/funnels/${funnel.id}`, { ...asOwner(), body: { targetDays: 2 } });
    await editStage(0, { ownerUserId: seller.userId });
    dealId = (await newDeal('Gate · late')).id;
    await asTenantSql(tenant, `update deals set stage_entered_at = now() - interval '5 days' where id = $1`, [dealId]);
  });

  it('is late by the days past the funnel default, or the stage target when it has one', async () => {
    expect((await ok<{ stageLateDays: number }>('GET', `/crm/deals/${dealId}`, asOwner())).stageLateDays).toBe(3);
    const rows = await ok<{ deal: { id: string; stageLateDays: number } }[]>('GET', '/crm/deals', asOwner());
    expect(rows.find((r) => r.deal.id === dealId)!.deal.stageLateDays).toBe(3);
    await editStage(0, { targetDays: 4 });
    expect((await ok<{ stageLateDays: number }>('GET', `/crm/deals/${dealId}`, asOwner())).stageLateDays).toBe(1);
    await editStage(0, { targetDays: 10 });
    expect((await ok<{ stageLateDays: number }>('GET', `/crm/deals/${dealId}`, asOwner())).stageLateDays).toBe(0);
    await editStage(0, { targetDays: null });
  });

  it('lists the late opportunity in the stage owner\'s digest, not the opportunity owner\'s', async () => {
    const theirs = await ok<{ lateInStage: { id: string; lateDays: number }[] }>('GET', '/notifications/digest', asSeller());
    expect(theirs.lateInStage).toEqual([expect.objectContaining({ id: dealId, lateDays: 3 })]);
    const mine = await ok<{ lateInStage: { id: string }[] }>('GET', '/notifications/digest', asOwner());
    expect(mine.lateInStage.map((d) => d.id)).not.toContain(dealId);
  });

  it('reminds the stage owner, and refuses to remind yourself', async () => {
    expect(await ok('POST', `/crm/deals/${dealId}/remind-stage-owner`, asOwner(), 202)).toEqual({ recipientUserId: seller.userId });
    expect((await call('POST', `/crm/deals/${dealId}/remind-stage-owner`, asSeller())).status).toBe(400);
    const log = await ok<{ title: string }[]>('GET', `/crm/deals/${dealId}/activities`, asOwner());
    expect(log[0]!.title).toBe(`Reminded the owner of ${stage(0).name}`);
  });

  it('refuses a stage owner who isn\'t a member', async () => {
    const outsider = await signIn('gate-outsider');
    expect((await call('PATCH', `/crm/funnels/${funnel.id}/stages/${stage(1).id}`, { ...asOwner(), body: { ownerUserId: outsider.userId } })).status).toBe(400);
    // A new stage too; a member is fine.
    expect((await call('POST', `/crm/funnels/${funnel.id}/stages`, { ...asOwner(), body: { name: 'Outsider stage', ownerUserId: outsider.userId } })).status).toBe(400);
    const after = await ok<Funnel>('POST', `/crm/funnels/${funnel.id}/stages`, { ...asOwner(), body: { name: 'Seller stage', ownerUserId: seller.userId } });
    expect(after.stages.find((s) => s.name === 'Seller stage')!.ownerUserId).toBe(seller.userId);
  });
});
