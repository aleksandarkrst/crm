/** Deal lines: every change recalculates the deal amount (sum of net line values) in the database. */
import { beforeAll, describe, expect, it } from 'vitest';
import { call, createTenant, firstFunnel, ok, type Session, signIn } from './helpers';

let owner: Session;
let tenant: string;
let funnelId: string;
const as = () => ({ token: owner.token, tenant });
const amountOf = async (dealId: string) => Number((await ok('GET', `/crm/deals/${dealId}`, as())).amount);

beforeAll(async () => {
  owner = await signIn('lines-owner');
  tenant = await createTenant(owner, 'Lines');
  funnelId = (await firstFunnel(owner, tenant)).id;
});

describe('deal amount', () => {
  it('follows the lines as they are added, changed and removed', async () => {
    const deal = await ok('POST', '/crm/deals', { ...as(), body: { title: 'Website', funnelId, amount: 777 } });
    expect(Number(deal.amount)).toBe(777);

    const first = await ok('POST', `/crm/deals/${deal.id}/lines`, { ...as(), body: { quantity: 3, unitPrice: 5000, vatRate: 20 } });
    expect(await amountOf(deal.id)).toBe(15000); // net: VAT is not part of the amount

    const second = await ok('POST', `/crm/deals/${deal.id}/lines`, { ...as(), body: { quantity: '2.5', unitPrice: '100.10' } });
    expect(await amountOf(deal.id)).toBe(15250.25);

    await ok('PATCH', `/crm/deal-lines/${first.id}`, { ...as(), body: { quantity: 1 } });
    expect(await amountOf(deal.id)).toBe(5250.25);

    await ok('PATCH', `/crm/deal-lines/${second.id}`, { ...as(), body: { unitPrice: 0 } });
    expect(await amountOf(deal.id)).toBe(5000);

    await ok('DELETE', `/crm/deal-lines/${first.id}`, as());
    expect(await amountOf(deal.id)).toBe(0);

    await ok('DELETE', `/crm/deal-lines/${second.id}`, as());
    expect(await amountOf(deal.id)).toBe(0);
  });

  it("changing one deal's lines leaves other deals alone", async () => {
    const [d1, d2] = await Promise.all(
      ['One', 'Two'].map((title) => ok('POST', '/crm/deals', { ...as(), body: { title, funnelId } })),
    );
    await ok('POST', `/crm/deals/${d1.id}/lines`, { ...as(), body: { quantity: 1, unitPrice: 100 } });
    const l2 = await ok('POST', `/crm/deals/${d2.id}/lines`, { ...as(), body: { quantity: 4, unitPrice: 50 } });
    await ok('PATCH', `/crm/deal-lines/${l2.id}`, { ...as(), body: { quantity: 5 } });
    expect(await amountOf(d1.id)).toBe(100);
    expect(await amountOf(d2.id)).toBe(250);
  });

  it('rejects invalid values without touching the amount', async () => {
    const deal = await ok('POST', '/crm/deals', { ...as(), body: { title: 'Validation', funnelId } });
    const line = await ok('POST', `/crm/deals/${deal.id}/lines`, { ...as(), body: { quantity: 2, unitPrice: 10 } });
    expect((await call('PATCH', `/crm/deal-lines/${line.id}`, { ...as(), body: { quantity: -1 } })).status).toBe(400);
    expect((await call('PATCH', `/crm/deal-lines/${line.id}`, { ...as(), body: { vatRate: 101 } })).status).toBe(400);
    expect(await amountOf(deal.id)).toBe(20);
  });

  it('a product that is on a deal cannot be deleted from the catalog', async () => {
    const product = await ok('POST', '/crm/products', { ...as(), body: { name: 'Retainer', unitPrice: 1200 } });
    const deal = await ok('POST', '/crm/deals', { ...as(), body: { title: 'Retainer deal', funnelId } });
    const line = await ok('POST', `/crm/deals/${deal.id}/lines`, { ...as(), body: { productId: product.id, quantity: 1, unitPrice: 1200 } });
    expect((await call('DELETE', `/crm/products/${product.id}`, as())).status).toBe(409);
    await ok('DELETE', `/crm/deal-lines/${line.id}`, as());
    await ok('DELETE', `/crm/products/${product.id}`, as());
  });

  it('lines of a deleted deal go with it', async () => {
    const deal = await ok('POST', '/crm/deals', { ...as(), body: { title: 'Short-lived', funnelId } });
    const line = await ok('POST', `/crm/deals/${deal.id}/lines`, { ...as(), body: { quantity: 1, unitPrice: 1 } });
    await ok('DELETE', `/crm/deals/${deal.id}`, as());
    const lines = await ok('GET', '/crm/deal-lines?limit=200', as());
    expect(lines.map((l: { id: string }) => l.id)).not.toContain(line.id);
    expect((await call('PATCH', `/crm/deal-lines/${line.id}`, { ...as(), body: { quantity: 2 } })).status).toBe(404);
  });
});
