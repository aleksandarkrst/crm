/**
 * Product prices have a currency (CD-77). A deal line can only use a product in the deal's
 * currency, and a deal's currency can only change while its lines agree with the new one.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { call, createTenant, firstFunnel, type Json, ok, type Session, signIn } from './helpers';

let owner: Session;
let tenant: string;
let funnelId: string;
const as = () => ({ token: owner.token, tenant });

beforeAll(async () => {
  owner = await signIn('product-currency');
  tenant = await createTenant(owner, 'Product Currency');
  funnelId = (await firstFunnel(owner, tenant)).id;
});

describe('product currency', () => {
  it('new products take the workspace currency unless given one', async () => {
    const eur = await ok('POST', '/crm/products', { ...as(), body: { name: 'Audit', unitPrice: 100 } });
    expect(eur.currency).toBe('EUR');
    const usd = await ok('POST', '/crm/products', { ...as(), body: { name: 'Audit US', unitPrice: 120, currency: 'usd' } });
    expect(usd.currency).toBe('USD');
    expect((await call('POST', '/crm/products', { ...as(), body: { name: 'Bad', currency: 'XYZ' } })).status).toBe(400);
    const listed = await ok('GET', '/crm/products', as());
    expect(listed.find((p: Json) => p.id === usd.id).currency).toBe('USD');
  });

  it("refuses a product in another currency than the deal's", async () => {
    const eur = await ok('POST', '/crm/products', { ...as(), body: { name: 'Design EUR', unitPrice: 1000, currency: 'EUR' } });
    const usd = await ok('POST', '/crm/products', { ...as(), body: { name: 'Design USD', unitPrice: 1000, currency: 'USD' } });
    const deal = await ok('POST', '/crm/deals', { ...as(), body: { title: 'Euro deal', funnelId, currency: 'EUR' } });
    const refused = await call('POST', `/crm/deals/${deal.id}/lines`, { ...as(), body: { productId: usd.id, unitPrice: 1000 } });
    expect(refused.status).toBe(409);
    expect(refused.body.message).toContain('Design USD is priced in USD, but this deal is in EUR');
    const line = await ok('POST', `/crm/deals/${deal.id}/lines`, { ...as(), body: { productId: eur.id, unitPrice: 1000 } });
    // Switching the line to the USD product is refused too, and the amount is unchanged.
    expect((await call('PATCH', `/crm/deal-lines/${line.id}`, { ...as(), body: { productId: usd.id } })).status).toBe(409);
    expect((await ok('GET', `/crm/deals/${deal.id}`, as())).amount).toBe('1000.00');
  });

  it("a product on deals can't move to a currency those deals aren't in", async () => {
    const p = await ok('POST', '/crm/products', { ...as(), body: { name: 'Retainer', unitPrice: 500, currency: 'EUR' } });
    const deal = await ok('POST', '/crm/deals', { ...as(), body: { title: 'Retained', funnelId, currency: 'EUR' } });
    await ok('POST', `/crm/deals/${deal.id}/lines`, { ...as(), body: { productId: p.id } });
    const refused = await call('PATCH', `/crm/products/${p.id}`, { ...as(), body: { currency: 'GBP' } });
    expect(refused.status).toBe(409);
    expect(refused.body.message).toContain('Retained');
    // An unused product can change freely.
    const free = await ok('POST', '/crm/products', { ...as(), body: { name: 'Unused', currency: 'EUR' } });
    expect((await ok('PATCH', `/crm/products/${free.id}`, { ...as(), body: { currency: 'GBP' } })).currency).toBe('GBP');
  });
});

describe("changing a deal's currency", () => {
  it('works while no line uses a product in another currency', async () => {
    const empty = await ok('POST', '/crm/deals', { ...as(), body: { title: 'No lines', funnelId, currency: 'EUR', amount: 5000 } });
    const moved = await ok('PATCH', `/crm/deals/${empty.id}`, { ...as(), body: { currency: 'USD' } });
    expect(moved).toMatchObject({ currency: 'USD', amount: '5000.00' });

    // Lines without a product don't stand in the way.
    const loose = await ok('POST', '/crm/deals', { ...as(), body: { title: 'Loose line', funnelId, currency: 'EUR' } });
    await ok('POST', `/crm/deals/${loose.id}/lines`, { ...as(), body: { productId: null, unitPrice: 300 } });
    expect((await ok('PATCH', `/crm/deals/${loose.id}`, { ...as(), body: { currency: 'CHF' } })).currency).toBe('CHF');
  });

  it('is refused while lines use products in the old currency, with a message naming them', async () => {
    const p = await ok('POST', '/crm/products', { ...as(), body: { name: 'Workshop', unitPrice: 800, currency: 'EUR' } });
    const deal = await ok('POST', '/crm/deals', { ...as(), body: { title: 'Priced', funnelId, currency: 'EUR' } });
    const line = await ok('POST', `/crm/deals/${deal.id}/lines`, { ...as(), body: { productId: p.id, unitPrice: 800 } });
    const refused = await call('PATCH', `/crm/deals/${deal.id}`, { ...as(), body: { currency: 'USD' } });
    expect(refused.status).toBe(409);
    expect(refused.body.message).toContain('Workshop (EUR)');
    expect((await ok('GET', `/crm/deals/${deal.id}`, as())).currency).toBe('EUR');
    // Re-sending the current currency is fine; removing the line unblocks the change.
    await ok('PATCH', `/crm/deals/${deal.id}`, { ...as(), body: { currency: 'EUR' } });
    await ok('DELETE', `/crm/deal-lines/${line.id}`, as());
    expect((await ok('PATCH', `/crm/deals/${deal.id}`, { ...as(), body: { currency: 'USD' } })).currency).toBe('USD');
  });

  it("another workspace's product can't be put on a deal", async () => {
    const other = await signIn('product-currency-other');
    const otherTenant = await createTenant(other, 'Other Products');
    const theirs = await ok('POST', '/crm/products', { token: other.token, tenant: otherTenant, body: { name: 'Theirs' } });
    const deal = await ok('POST', '/crm/deals', { ...as(), body: { title: 'Mine', funnelId } });
    expect((await call('POST', `/crm/deals/${deal.id}/lines`, { ...as(), body: { productId: theirs.id } })).status).toBe(404);
  });
});
