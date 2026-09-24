/**
 * Optimistic concurrency (CD-20): an update that names the version it edited (If-Match: updatedAt)
 * gets 409 when someone changed the same field since; other fields merge; no If-Match stays
 * last-write-wins.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { addMember, call, createTenant, firstFunnel, ok, type Session, signIn } from './helpers';

let owner: Session;
let ana: Session;
let tenant: string;
let funnelId: string;
const asOwner = (headers?: Record<string, string>) => ({ token: owner.token, tenant, headers });
const asAna = (headers?: Record<string, string>) => ({ token: ana.token, tenant, headers });
const ifMatch = (updatedAt: string) => ({ 'if-match': `"${updatedAt}"` });

beforeAll(async () => {
  owner = await signIn('conflict-owner');
  ana = await signIn('conflict-ana');
  tenant = await createTenant(owner, 'Conflicts');
  await addMember(owner, tenant, ana, 'member');
  funnelId = (await firstFunnel(owner, tenant)).id;
});

const newDeal = (title: string) => ok('POST', '/crm/deals', { ...asOwner(), body: { title, funnelId, source: 'Referral' } });

describe('conflicting updates', () => {
  it('rejects a change to a field someone else changed since, names them and returns the current value', async () => {
    const deal = await newDeal('Conflict deal');
    const changed = await ok('PATCH', `/crm/deals/${deal.id}`, { ...asAna(), body: { title: 'Ana’s title' } });
    expect(new Date(changed.updatedAt).getTime()).toBeGreaterThan(new Date(deal.updatedAt).getTime());

    const res = await call('PATCH', `/crm/deals/${deal.id}`, { ...asOwner(ifMatch(deal.updatedAt)), body: { title: 'Owner’s title' } });
    expect(res.status).toBe(409);
    expect(res.body.message).toBe(`${ana.name} changed this deal while you were editing. Your change to the title wasn't saved.`);
    expect(res.body.conflicts).toEqual([expect.objectContaining({ field: 'title', value: 'Ana’s title', changedBy: ana.name })]);
    expect(res.body.current).toMatchObject({ id: deal.id, title: 'Ana’s title' });

    const now = await ok('GET', `/crm/deals/${deal.id}`, asOwner());
    expect(now.title).toBe('Ana’s title');
    // With the current version, the change goes through.
    await ok('PATCH', `/crm/deals/${deal.id}`, { ...asOwner(ifMatch(now.updatedAt)), body: { title: 'Owner’s title' } });
  });

  it('merges changes to other fields and accepts the same value', async () => {
    const deal = await newDeal('Merge deal');
    await ok('PATCH', `/crm/deals/${deal.id}`, { ...asAna(), body: { title: 'Renamed by Ana' } });
    const merged = await ok('PATCH', `/crm/deals/${deal.id}`, { ...asOwner(ifMatch(deal.updatedAt)), body: { source: 'Inbound' } });
    expect(merged).toMatchObject({ title: 'Renamed by Ana', source: 'Inbound' });
    // Sending the value it already has isn't a conflict either.
    await ok('PATCH', `/crm/deals/${deal.id}`, { ...asOwner(ifMatch(deal.updatedAt)), body: { title: 'Renamed by Ana' } });
  });

  it('never conflicts with earlier changes of the same browser tab (X-Client-Id)', async () => {
    const deal = await newDeal('Typing deal');
    const tab = { 'x-client-id': 'tab-conflict-test-1' };
    // Two saves of the same field sent before the first answer came back: both carry the old version.
    await ok('PATCH', `/crm/deals/${deal.id}`, { ...asOwner({ ...tab, ...ifMatch(deal.updatedAt) }), body: { title: 'Typ' } });
    await ok('PATCH', `/crm/deals/${deal.id}`, { ...asOwner({ ...tab, ...ifMatch(deal.updatedAt) }), body: { title: 'Typing' } });
    // Another tab of the same user does conflict, and is told so.
    const res = await call('PATCH', `/crm/deals/${deal.id}`, { ...asOwner({ 'x-client-id': 'tab-conflict-test-2', ...ifMatch(deal.updatedAt) }), body: { title: 'Other tab' } });
    expect(res.status).toBe(409);
    expect(res.body.message).toBe("You changed this deal in another window while you were editing. Your change to the title wasn't saved.");
  });

  it('keeps last-write-wins for clients that send no version, and rejects a malformed one', async () => {
    const deal = await newDeal('Legacy deal');
    await ok('PATCH', `/crm/deals/${deal.id}`, { ...asAna(), body: { title: 'First' } });
    const res = await ok('PATCH', `/crm/deals/${deal.id}`, { ...asOwner(), body: { title: 'Second' } });
    expect(res.title).toBe('Second');
    expect((await call('PATCH', `/crm/deals/${deal.id}`, { ...asOwner({ 'if-match': 'yesterday' }), body: { title: 'x' } })).status).toBe(400);
  });

  it('names every conflicting field, with readable values for ids (the owner)', async () => {
    const deal = await newDeal('Owner deal');
    await ok('PATCH', `/crm/deals/${deal.id}`, { ...asAna(), body: { ownerUserId: ana.userId, closeDate: '2026-12-01' } });
    const res = await call('PATCH', `/crm/deals/${deal.id}`, { ...asOwner(ifMatch(deal.updatedAt)), body: { ownerUserId: owner.userId, closeDate: '2027-01-15' } });
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/Your change to the (owner and the closing date|closing date and the owner) wasn't saved\.$/);
    expect(res.body.conflicts).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'ownerUserId', value: ana.userId, label: ana.name }), expect.objectContaining({ field: 'closeDate', value: '2026-12-01' })]),
    );
  });

  it('applies to companies and contacts too', async () => {
    const company = await ok('POST', '/crm/companies', { ...asOwner(), body: { name: 'Conflict Co' } });
    await ok('PATCH', `/crm/companies/${company.id}`, { ...asAna(), body: { industry: 'Retail' } });
    const c409 = await call('PATCH', `/crm/companies/${company.id}`, { ...asOwner(ifMatch(company.updatedAt)), body: { industry: 'Finance' } });
    expect(c409.status).toBe(409);
    expect(c409.body.message).toBe(`${ana.name} changed this company while you were editing. Your change to the industry wasn't saved.`);
    await ok('PATCH', `/crm/companies/${company.id}`, { ...asOwner(ifMatch(company.updatedAt)), body: { hq: 'Belgrade' } });

    const contact = await ok('POST', '/crm/contacts', { ...asOwner(), body: { fullName: 'Conflict Person' } });
    await ok('PATCH', `/crm/contacts/${contact.id}`, { ...asAna(), body: { email: 'ana-set@example.test' } });
    const p409 = await call('PATCH', `/crm/contacts/${contact.id}`, { ...asOwner(ifMatch(contact.updatedAt)), body: { email: 'owner-set@example.test' } });
    expect(p409.status).toBe(409);
    expect(p409.body.message).toBe(`${ana.name} changed this contact while you were editing. Your change to the email wasn't saved.`);
  });
});
