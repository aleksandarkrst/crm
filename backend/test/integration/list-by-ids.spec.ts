/**
 * Re-reading just some rows (CD-98): the lists a live update refreshes take `?ids=` (deals,
 * companies, contacts, products) or `?dealIds=` (deal lines and to-dos) and return only those rows,
 * still limited to the caller's workspace.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { call, createTenant, firstFunnel, ok, productLine, saveProducts, type Session, signIn } from './helpers';

let owner: Session;
let outsider: Session;
let tenant: string;
let otherTenant: string;
const mine = { deals: [] as string[], companies: [] as string[], contacts: [] as string[], products: [] as string[] };
let theirDeal: string;

async function seed(s: Session, t: string, n: number, into?: typeof mine) {
  const funnel = await firstFunnel(s, t);
  for (let i = 0; i < n; i++) {
    const company = await ok<{ id: string }>('POST', '/crm/companies', { token: s.token, tenant: t, body: { name: `Co ${i}` } });
    const contact = await ok<{ id: string }>('POST', '/crm/contacts', { token: s.token, tenant: t, body: { fullName: `Person ${i}`, companyId: company.id } });
    const product = await ok<{ id: string }>('POST', '/crm/products', { token: s.token, tenant: t, body: { name: `Product ${i}`, unitPrice: 100 } });
    const deal = await ok<{ id: string }>('POST', '/crm/deals', { token: s.token, tenant: t, body: { title: `Deal ${i}`, funnelId: funnel.id, companyId: company.id } });
    await saveProducts(s, t, deal.id, [productLine(product.id)]);
    await ok('POST', `/crm/deals/${deal.id}/tasks`, { token: s.token, tenant: t, body: { stageId: funnel.stages[0]!.id, label: `To-do ${i}` } }, 201);
    into?.deals.push(deal.id);
    into?.companies.push(company.id);
    into?.contacts.push(contact.id);
    into?.products.push(product.id);
    if (!into) theirDeal = deal.id;
  }
}

beforeAll(async () => {
  [owner, outsider] = await Promise.all([signIn('ids-owner'), signIn('ids-outsider')]);
  tenant = await createTenant(owner, 'Ids');
  otherTenant = await createTenant(outsider, 'Other ids');
  await seed(owner, tenant, 3, mine);
  await seed(outsider, otherTenant, 1);
});

const get = <T>(path: string) => ok<T[]>('GET', path, { token: owner.token, tenant });

describe('?ids= on list endpoints (CD-98)', () => {
  it('returns only the rows asked for', async () => {
    const two = (xs: string[]) => [xs[0]!, xs[2]!];
    expect((await get<{ deal: { id: string } }>(`/crm/deals?ids=${two(mine.deals)}`)).map((r) => r.deal.id).sort()).toEqual(two(mine.deals).sort());
    for (const kind of ['companies', 'contacts', 'products'] as const) {
      const rows = await get<{ id: string }>(`/crm/${kind}?ids=${two(mine[kind])}`);
      expect(rows.map((r) => r.id).sort(), kind).toEqual(two(mine[kind]).sort());
    }
  });

  it('returns deal lines and to-dos of just some deals with ?dealIds=', async () => {
    for (const kind of ['deal-lines', 'deal-tasks'] as const) {
      const rows = await get<{ dealId: string }>(`/crm/${kind}?dealIds=${mine.deals[1]}&limit=200`);
      expect(rows.length, kind).toBeGreaterThan(0);
      expect(new Set(rows.map((r) => r.dealId)), kind).toEqual(new Set([mine.deals[1]]));
    }
  });

  it("never returns another workspace's rows, and skips ids that don't exist", async () => {
    const rows = await get<{ deal: { id: string } }>(`/crm/deals?ids=${mine.deals[0]},${theirDeal},00000000-0000-4000-8000-000000000000`);
    expect(rows.map((r) => r.deal.id)).toEqual([mine.deals[0]]);
    expect(await get(`/crm/deal-lines?dealIds=${theirDeal}`)).toEqual([]);
  });

  it('refuses ids that are not uuids, and more than 200', async () => {
    const bad = (path: string) => call('GET', path, { token: owner.token, tenant });
    expect((await bad('/crm/deals?ids=abc')).status).toBe(400);
    expect((await bad(`/crm/companies?ids=${Array.from({ length: 201 }, () => mine.companies[0]).join(',')}`)).status).toBe(400);
    expect((await bad('/crm/deal-tasks?dealIds=')).status).toBe(400);
  });

  it('without ids the lists are whole, as before', async () => {
    expect((await get('/crm/deals?limit=200')).length).toBe(3);
  });
});
