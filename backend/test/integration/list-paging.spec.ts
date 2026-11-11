/**
 * Paging through a list returns every row once (CD-502): the lists the app reads page by page
 * (`limit` and `offset`) sort by a name, and many rows can share one ("TEST-CD468" × 146 on
 * staging). Without a unique last sort key the database may order equal rows differently per
 * page, so a row came back on two pages and another on none; the Contacts list then kept stale rows.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { createTenant, ok, READY_IDENTITY, type Session, signIn, testPibs } from './helpers';

const N = 23;
const PAGE = 5;
let owner: Session;
let tenant: string;
const ids = { contacts: [] as string[], companies: [] as string[], products: [] as string[] };

beforeAll(async () => {
  owner = await signIn('paging-owner');
  tenant = await createTenant(owner, 'Paging');
  const as = { token: owner.token, tenant };
  const pibs = testPibs(N);
  for (let i = 0; i < N; i++) {
    ids.companies.push((await ok<{ id: string }>('POST', '/crm/companies', { ...as, body: { pib: pibs[i], name: 'Same name', ...READY_IDENTITY } })).id);
    ids.contacts.push((await ok<{ id: string }>('POST', '/crm/contacts', { ...as, body: { fullName: 'Same name', jobTitle: 'QA', buyerRole: 'Influencer', ownerUserId: owner.userId } })).id);
    ids.products.push((await ok<{ id: string }>('POST', '/crm/products', { ...as, body: { name: 'Same name', unitPrice: 10 } })).id);
  }
}, 120_000);

/** Every row of a list, read `PAGE` at a time as the app does (200 at a time there). */
async function pages(kind: keyof typeof ids): Promise<string[]> {
  const out: string[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const rows = await ok<{ id: string }[]>('GET', `/crm/${kind}?limit=${PAGE}&offset=${offset}`, { token: owner.token, tenant });
    out.push(...rows.map((r) => r.id));
    if (rows.length < PAGE) return out;
  }
}

describe('paged lists with equal names (CD-502)', () => {
  for (const kind of ['contacts', 'companies', 'products'] as const) {
    it(`${kind}: every row once`, async () => {
      const seen = await pages(kind);
      const mine = seen.filter((id) => ids[kind].includes(id));
      expect(new Set(mine).size, 'no row on two pages').toBe(mine.length);
      expect([...mine].sort(), 'no row missing').toEqual([...ids[kind]].sort());
    });
  }
});
