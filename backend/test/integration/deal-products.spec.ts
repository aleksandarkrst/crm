/**
 * Products and deals (CD-83): products have no currency and bill once or every period for their
 * cycles; a deal saves its products, currency, tax mode, discounts and installments together, and
 * its amount is the contract value without tax.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { call, createTenant, firstFunnel, type Json, ok, productLine, saveProducts, type Session, signIn } from './helpers';

let owner: Session;
let member: Session;
let tenant: string;
let funnelId: string;
const as = (s: Session = owner) => ({ token: s.token, tenant });
const newDeal = async (title: string, extra: Record<string, unknown> = {}) => (await ok('POST', '/crm/deals', { ...as(), body: { title, funnelId, ...extra } })).id as string;
const dealOf = async (id: string) => ok('GET', `/crm/deals/${id}`, as());
const linesOf = async (dealId: string) => (await ok<Json[]>('GET', '/crm/deal-lines?limit=200', as())).filter((l) => l.dealId === dealId);
const product = async (body: Record<string, unknown>) => ok('POST', '/crm/products', { ...as(), body: { unitPrice: 100, ...body } });

beforeAll(async () => {
  owner = await signIn('products-owner');
  tenant = await createTenant(owner, 'Deal Products');
  funnelId = (await firstFunnel(owner, tenant)).id;
});

describe('products', () => {
  it('have a unit price, unit, quantity, tax, billing frequency and cycles, and no currency', async () => {
    const p = await product({ name: 'Automation', description: 'Workflow setup', unit: 'hour', unitPrice: 40, quantity: 10, vatRate: 20, billingFrequency: 'monthly', billingCycles: 4 });
    expect(p).toMatchObject({ name: 'Automation', description: 'Workflow setup', unit: 'hour', unitPrice: '40.00', quantity: '10.00', vatRate: '20.00', billingFrequency: 'monthly', billingCycles: 4 });
    expect(p).not.toHaveProperty('currency');
    // Renews until canceled: no cycles.
    expect((await ok('PATCH', `/crm/products/${p.id}`, { ...as(), body: { billingCycles: null } })).billingCycles).toBeNull();
    // A one-time product has no cycles, whatever is sent.
    expect((await ok('PATCH', `/crm/products/${p.id}`, { ...as(), body: { billingFrequency: 'one_time', billingCycles: 3 } })).billingCycles).toBeNull();
    const defaults = await product({ name: 'Plain' });
    expect(defaults).toMatchObject({ quantity: '1.00', vatRate: '20.00', billingFrequency: 'one_time', billingCycles: null, unit: null, description: null });
  });

  it('refuse invalid values', async () => {
    for (const body of [{ name: '' }, { name: 'x', billingFrequency: 'daily' }, { name: 'x', billingCycles: 0 }, { name: 'x', vatRate: 101 }, { name: 'x', quantity: -1 }, { name: 'x', currency: 'USD' }]) {
      const res = await call('POST', '/crm/products', { ...as(), body });
      // An unknown field (currency) is dropped, not refused.
      if ('currency' in body) expect(res.status, JSON.stringify(body)).toBe(201);
      else expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });

  it('on a deal cannot be deleted from the catalog', async () => {
    const p = await product({ name: 'Retainer' });
    const deal = await newDeal('Retainer deal');
    await saveProducts(owner, tenant, deal, [productLine(p.id)]);
    expect((await call('DELETE', `/crm/products/${p.id}`, as())).status).toBe(409);
    await saveProducts(owner, tenant, deal, []);
    await ok('DELETE', `/crm/products/${p.id}`, as());
  });
});

describe('saving a deal’s products', () => {
  it('sets the amount to the contract value without tax, recurring products for all their cycles', async () => {
    const setup = await product({ name: 'Setup' });
    const plan = await product({ name: 'Plan', billingFrequency: 'monthly' });
    const deal = await newDeal('Contract', { amount: 777 });
    const { totals } = await saveProducts(owner, tenant, deal, [
      productLine(setup.id, { quantity: 2, unitPrice: 500, discountKind: 'percent', discountValue: 10, startDate: '2026-11-01' }),
      productLine(plan.id, { unitPrice: 40, billingFrequency: 'monthly', billingCycles: 4, startDate: '2026-11-01' }),
    ]);
    // 2 × 500 less 10% = 900; 40 × 4 cycles = 160.
    expect(totals).toMatchObject({ subtotal: 1060, tax: 212, total: 1272, mrr: 40, arr: 480 });
    expect(Number((await dealOf(deal)).amount)).toBe(1060);

    // Until canceled counts one year.
    const [one, two] = await linesOf(deal);
    await saveProducts(owner, tenant, deal, [{ ...productLine(setup.id), id: one.id, quantity: 2, unitPrice: 500, discountValue: 10 }, { ...productLine(plan.id), id: two.id, unitPrice: 40, billingFrequency: 'monthly', billingCycles: null }]);
    expect(Number((await dealOf(deal)).amount)).toBe(900 + 480);
  });

  it('keeps lines by id, adds new ones, removes the rest, in the order sent', async () => {
    const a = await product({ name: 'A' });
    const b = await product({ name: 'B' });
    const deal = await newDeal('Order');
    const { lines } = await saveProducts(owner, tenant, deal, [productLine(a.id, { description: 'first' }), productLine(b.id)]);
    expect(lines.map((l: Json) => [l.productId, l.position, l.description])).toEqual([[a.id, 0, 'first'], [b.id, 1, null]]);
    const again = await saveProducts(owner, tenant, deal, [{ ...productLine(b.id), id: lines[1].id, quantity: 3 }, productLine(a.id)]);
    expect(again.lines[0]).toMatchObject({ id: lines[1].id, productId: b.id, quantity: '3.00', position: 0 });
    expect(again.lines[1].id).not.toBe(lines[0].id);
    expect(await linesOf(deal)).toHaveLength(2);
    expect((await saveProducts(owner, tenant, deal, [])).lines).toEqual([]);
    expect(Number((await dealOf(deal)).amount)).toBe(0);
  });

  it('reads prices with the tax mode, and applies deal discounts to one-time products only', async () => {
    const p = await product({ name: 'Mode' });
    const deal = await newDeal('Tax modes');
    expect((await saveProducts(owner, tenant, deal, [productLine(p.id, { unitPrice: 120 })], { taxMode: 'inclusive' })).totals).toMatchObject({ subtotal: 100, tax: 20, total: 120 });
    expect((await dealOf(deal)).taxMode).toBe('inclusive');
    expect((await saveProducts(owner, tenant, deal, [productLine(p.id)], { taxMode: 'none' })).totals).toMatchObject({ subtotal: 100, tax: 0 });

    const saved = await saveProducts(
      owner,
      tenant,
      deal,
      [productLine(p.id, { unitPrice: 1000 }), productLine(p.id, { unitPrice: 50, billingFrequency: 'monthly', billingCycles: 2 })],
      { discounts: [{ label: 'Loyalty', kind: 'percent', value: 10 }, { kind: 'amount', value: 50 }] },
    );
    expect(saved.totals).toMatchObject({ discount: 150, subtotal: 950 });
    const d = await dealOf(deal);
    expect(d.discounts).toEqual([expect.objectContaining({ label: 'Loyalty', kind: 'percent', value: 10, id: expect.any(String) }), expect.objectContaining({ label: '', kind: 'amount', value: 50 })]);
    expect(Number(d.amount)).toBe(950);
  });

  it('allows installments only when every product is one-time', async () => {
    const p = await product({ name: 'Project' });
    const deal = await newDeal('Installments');
    const installments = [
      { description: 'On signature', date: '2026-10-01', amount: 60 },
      { description: 'On delivery', date: '2026-11-01', amount: 60 },
    ];
    await saveProducts(owner, tenant, deal, [productLine(p.id)], { installments });
    expect((await dealOf(deal)).installments).toEqual(installments.map((i) => ({ ...i, id: expect.any(String) })));
    const refused = await call('PUT', `/crm/deals/${deal}/products`, { ...as(), body: { taxMode: 'exclusive', lines: [productLine(p.id), productLine(p.id, { billingFrequency: 'weekly' })], installments } });
    expect(refused.status).toBe(400);
    expect(refused.body.message).toContain('Installments are for deals with one-time products only');
    // Nothing of the refused save was kept.
    expect(await linesOf(deal)).toHaveLength(1);
  });

  it('changes the deal currency with any product: prices keep their numbers', async () => {
    const p = await product({ name: 'Any currency', unitPrice: 5000 });
    const deal = await newDeal('Euro deal', { currency: 'EUR' });
    await saveProducts(owner, tenant, deal, [productLine(p.id, { unitPrice: 5000 })], { currency: 'rsd' });
    expect(await dealOf(deal)).toMatchObject({ currency: 'RSD', amount: '5000.00' });
    // And on the deal itself too.
    expect((await ok('PATCH', `/crm/deals/${deal}`, { ...as(), body: { currency: 'USD' } })).currency).toBe('USD');
    expect((await call('PUT', `/crm/deals/${deal}/products`, { ...as(), body: { taxMode: 'exclusive', lines: [], currency: 'XYZ' } })).status).toBe(400);
  });

  it('refuses invalid lines without changing anything', async () => {
    const p = await product({ name: 'Valid' });
    const deal = await newDeal('Validation');
    await saveProducts(owner, tenant, deal, [productLine(p.id, { quantity: 2, unitPrice: 10 })]);
    for (const bad of [{ quantity: -1 }, { vatRate: 101 }, { discountKind: 'percent', discountValue: 120 }, { billingFrequency: 'daily' }, { billingCycles: 0, billingFrequency: 'monthly' }, { productId: 'nope' }]) {
      const res = await call('PUT', `/crm/deals/${deal}/products`, { ...as(), body: { taxMode: 'exclusive', lines: [productLine(p.id, bad)] } });
      expect(res.status, JSON.stringify(bad)).toBe(400);
    }
    expect((await call('PUT', `/crm/deals/${deal}/products`, { ...as(), body: { taxMode: 'gross', lines: [] } })).status).toBe(400);
    expect(Number((await dealOf(deal)).amount)).toBe(20);
    expect((await call('PUT', `/crm/deals/00000000-0000-4000-8000-000000000000/products`, { ...as(), body: { taxMode: 'exclusive', lines: [] } })).status).toBe(404);
  });

  it('members can price deals too', async () => {
    member = await signIn('products-member');
    const { token } = await ok('POST', '/team/invitations', { ...as(), body: { email: member.email, role: 'member' } });
    await ok('POST', `/invitations/${token}/accept`, { token: member.token }, 200);
    const p = await product({ name: 'Member priced' });
    const deal = await newDeal('Member deal');
    await saveProducts(member, tenant, deal, [productLine(p.id, { unitPrice: 30 })]);
    expect(Number((await dealOf(deal)).amount)).toBe(30);
  });

  it('lines of a deleted deal go with it', async () => {
    const p = await product({ name: 'Short' });
    const deal = await newDeal('Short-lived');
    await saveProducts(owner, tenant, deal, [productLine(p.id)]);
    await ok('DELETE', `/crm/deals/${deal}`, as());
    expect(await linesOf(deal)).toEqual([]);
  });
});
