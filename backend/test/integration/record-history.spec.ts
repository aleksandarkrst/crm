/**
 * Change history (CD-69): who changed which field of a deal, company or contact, when, from what
 * to what; readable names; members can read it; isolated per tenant.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { addMember, call, createTenant, type Funnel, firstFunnel, ok, type Session, signIn } from './helpers';

let owner: Session;
let seller: Session;
let outsider: Session;
let tenant: string;
let otherTenant: string;
let funnel: Funnel;
const asOwner = () => ({ token: owner.token, tenant });
const asSeller = () => ({ token: seller.token, tenant });

interface Entry {
  action: string;
  field: string | null;
  oldValue: unknown;
  newValue: unknown;
  oldLabel: string | null;
  newLabel: string | null;
  label: string | null;
  actor: { userId: string | null; name: string } | null;
  changedAt: string;
}
const history = async (type: string, id: string, opts = asOwner(), query = '') =>
  ok<{ entries: Entry[]; more: boolean }>('GET', `/crm/history?entityType=${type}&entityId=${id}${query}`, opts);

beforeAll(async () => {
  owner = await signIn('history-owner');
  seller = await signIn('history-seller');
  outsider = await signIn('history-outsider');
  tenant = await createTenant(owner, 'History');
  otherTenant = await createTenant(outsider, 'History other');
  await addMember(owner, tenant, seller, 'member');
  funnel = await firstFunnel(owner, tenant);
});

describe('deal history', () => {
  it('records creation, field changes, stage and owner changes, lost and reopen, and deal lines', async () => {
    const product = await ok('POST', '/crm/products', { ...asOwner(), body: { name: 'History Widget', unitPrice: 1200 } });
    const deal = await ok('POST', '/crm/deals', { ...asOwner(), body: { title: 'History deal', funnelId: funnel.id } });
    await ok('PATCH', `/crm/deals/${deal.id}`, { ...asSeller(), body: { title: 'History deal v2', closeDate: '2026-11-30' } });
    await ok('PATCH', `/crm/deals/${deal.id}`, { ...asOwner(), body: { ownerUserId: seller.userId } });
    await ok('POST', `/crm/deals/${deal.id}/move`, { ...asSeller(), body: { stageId: funnel.stages[1]!.id } }, 200);
    const line = await ok('POST', `/crm/deals/${deal.id}/lines`, { ...asSeller(), body: { productId: product.id, quantity: 2, unitPrice: 1200 } });
    await ok('PATCH', `/crm/deal-lines/${line.id}`, { ...asSeller(), body: { quantity: 3 } });
    await ok('DELETE', `/crm/deal-lines/${line.id}`, asSeller());
    await ok('POST', `/crm/deals/${deal.id}/lost`, { ...asSeller(), body: { reason: 'Timing', note: 'Next year' } }, 200);
    await ok('POST', `/crm/deals/${deal.id}/reopen`, asOwner(), 200);

    // Members read it; newest first.
    const { entries } = await history('deal', deal.id, asSeller());
    const times = entries.map((e) => Date.parse(e.changedAt));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    const find = (action: string, field?: string) => entries.filter((e) => e.action === action && (field === undefined || e.field === field));

    expect(find('created')).toEqual([expect.objectContaining({ label: 'History deal', actor: { userId: owner.userId, name: owner.name } })]);
    expect(find('updated', 'title')[0]).toMatchObject({ oldValue: 'History deal', newValue: 'History deal v2', actor: { userId: seller.userId, name: seller.name } });
    expect(find('updated', 'closeDate')[0]).toMatchObject({ oldValue: null, newValue: '2026-11-30' });
    expect(find('updated', 'ownerUserId')[0]).toMatchObject({ oldValue: owner.userId, newValue: seller.userId, oldLabel: owner.name, newLabel: seller.name, actor: { name: owner.name } });
    expect(find('updated', 'stageId')[0]).toMatchObject({ oldLabel: funnel.stages[0]!.name, newLabel: funnel.stages[1]!.name, actor: { name: seller.name } });
    expect(find('line_added')[0]).toMatchObject({ label: 'History Widget', newValue: expect.objectContaining({ quantity: 2, productName: 'History Widget' }) });
    expect(find('line_changed')[0]).toMatchObject({ label: 'History Widget', oldValue: expect.objectContaining({ quantity: 2 }), newValue: { quantity: 3 } });
    expect(find('line_removed')[0]).toMatchObject({ label: 'History Widget', oldValue: expect.objectContaining({ quantity: 3 }) });
    // The amount follows the lines: 0 → 2,400 → 3,600 → 0.
    expect(find('updated', 'amount').map((e) => [Number(e.oldValue), Number(e.newValue)])).toEqual([
      [3600, 0],
      [2400, 3600],
      [0, 2400],
    ]);
    // Lost with its reason, then reopened (reason cleared) by the owner.
    const reasons = find('updated', 'lostReason');
    expect(reasons.map((e) => [e.oldValue, e.newValue, e.actor?.name])).toEqual([
      ['Timing', null, owner.name],
      [null, 'Timing', seller.name],
    ]);
    expect(find('updated', 'lostNote')[1]).toMatchObject({ newValue: 'Next year' });
  });

  it('pages the list and keeps entries by people who left, as "Former member"', async () => {
    const deal = await ok('POST', '/crm/deals', { ...asSeller(), body: { title: 'Paged deal', funnelId: funnel.id } });
    for (let i = 1; i <= 4; i++) await ok('PATCH', `/crm/deals/${deal.id}`, { ...asSeller(), body: { source: `Source ${i}` } });
    const first = await history('deal', deal.id, asOwner(), '&limit=3');
    expect(first.entries).toHaveLength(3);
    expect(first.more).toBe(true);
    const rest = await history('deal', deal.id, asOwner(), '&limit=3&offset=3');
    expect(rest.entries).toHaveLength(2);
    expect(rest.more).toBe(false);

    const leaver = await signIn('history-leaver');
    await addMember(owner, tenant, leaver, 'member');
    await ok('PATCH', `/crm/deals/${deal.id}`, { token: leaver.token, tenant, body: { title: 'Changed by a leaver' } });
    await ok('DELETE', `/team/members/${leaver.userId}`, asOwner());
    const { entries } = await history('deal', deal.id);
    expect(entries[0]).toMatchObject({ field: 'title', newValue: 'Changed by a leaver', actor: { userId: null, name: 'Former member' } });
  });
});

describe('company and contact history', () => {
  it('records their creation and field changes, with company names for ids', async () => {
    const company = await ok('POST', '/crm/companies', { ...asOwner(), body: { name: 'History Co' } });
    await ok('PATCH', `/crm/companies/${company.id}`, { ...asSeller(), body: { industry: 'Logistics', name: 'History Company' } });
    const c = await history('company', company.id);
    expect(c.entries.map((e) => [e.action, e.field])).toEqual(expect.arrayContaining([['created', null], ['updated', 'industry'], ['updated', 'name']]));
    expect(c.entries.find((e) => e.field === 'name')).toMatchObject({ oldValue: 'History Co', newValue: 'History Company', actor: { name: seller.name } });

    const contact = await ok('POST', '/crm/contacts', { ...asOwner(), body: { fullName: 'History Person' } });
    await ok('PATCH', `/crm/contacts/${contact.id}`, { ...asSeller(), body: { companyId: company.id, jobTitle: 'CFO' } });
    const p = await history('contact', contact.id, asSeller());
    expect(p.entries.find((e) => e.field === 'companyId')).toMatchObject({ oldValue: null, newValue: company.id, newLabel: 'History Company' });
    expect(p.entries.find((e) => e.field === 'jobTitle')).toMatchObject({ newValue: 'CFO' });
  });
});

describe('tenant isolation', () => {
  it("never shows another workspace's history", async () => {
    const deal = await ok('POST', '/crm/deals', { ...asOwner(), body: { title: 'Private deal', funnelId: funnel.id } });
    expect((await history('deal', deal.id)).entries.length).toBeGreaterThan(0);
    // Asking in your own workspace for another workspace's record finds nothing.
    const other = await history('deal', deal.id, { token: outsider.token, tenant: otherTenant });
    expect(other.entries).toEqual([]);
    // And you can't ask in a workspace you don't belong to.
    expect((await call('GET', `/crm/history?entityType=deal&entityId=${deal.id}`, { token: outsider.token, tenant })).status).toBe(403);
  });

  it('validates the query', async () => {
    expect((await call('GET', '/crm/history?entityType=invoice&entityId=00000000-0000-4000-8000-000000000000', asOwner())).status).toBe(400);
  });
});
