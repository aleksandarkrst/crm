/**
 * Pipeline entry (CD-360): only a company that is an opportunity or a client can take an
 * opportunity. A lead is a 409 with what it misses, on create, on a company change and as an
 * import row error; the sale type is saved and filters the list.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { call, createTenant, type Funnel, ok, readyCompany, type Session, signIn, testPib } from './helpers';

let owner: Session;
let tenant: string;
let funnel: Funnel;
const as = () => ({ token: owner.token, tenant });
const deal = (companyId: string, extra: Record<string, unknown> = {}) => call<{ id: string; saleType: string | null; message: string; blockers: string[] }>('POST', '/crm/deals', { ...as(), body: { title: 'Fleet', funnelId: funnel.id, companyId, ...extra } });

beforeAll(async () => {
  owner = await signIn('entry-owner');
  tenant = await createTenant(owner, 'Pipeline entry');
  funnel = (await ok<Funnel[]>('GET', '/crm/funnels', as()))[0]!;
});

describe('creating an opportunity', () => {
  it('refuses a lead with what it misses, and needs a company', async () => {
    const lead = await ok<{ id: string }>('POST', '/crm/companies', { ...as(), body: { name: 'Vega Logistika', pib: testPib() } });
    const refused = await deal(lead.id);
    expect(refused.status).toBe(409);
    expect(refused.body.message).toContain('Vega Logistika is still a lead');
    expect(refused.body.blockers).toContain('Matični broj');
    expect((await call('POST', '/crm/deals', { ...as(), body: { title: 'No company', funnelId: funnel.id } })).status).toBe(400);
  });

  it('takes an opportunity company, with its sale type', async () => {
    const ready = await readyCompany(owner, tenant, 'Vega Trans');
    const created = await deal(ready.id, { saleType: 'capital' });
    expect(created.status).toBe(201);
    expect(created.body.saleType).toBe('capital');
    expect((await deal(ready.id, { saleType: 'leasing' })).status).toBe(400);
  });

  it('takes a client, whatever its data', async () => {
    // A client: it won an opportunity, then lost its matični broj (a client stays a client).
    const c = await readyCompany(owner, tenant, 'Vektor Energo');
    const first = await deal(c.id);
    await ok('POST', `/crm/deals/${first.body.id}/move`, { ...as(), body: { stageId: funnel.stages.find((s) => s.isWon)!.id } }, 200);
    await ok('PATCH', `/crm/companies/${c.id}`, { ...as(), body: { mb: null } });
    expect((await ok<{ status: string }>('GET', `/crm/companies/${c.id}`, as())).status).toBe('client');
    expect((await deal(c.id, { saleType: 'transactional' })).status).toBe(201);
  });

  it('refuses a company set back to Lead by hand, saying so', async () => {
    const c = await readyCompany(owner, tenant, 'Set back Co');
    await ok('PATCH', `/crm/companies/${c.id}/status`, { ...as(), body: { status: 'lead' } });
    const refused = await deal(c.id);
    expect(refused.status).toBe(409);
    expect(refused.body.blockers).toEqual([]);
    expect(refused.body.message).toContain('set back to Lead by hand');
  });
});

describe('changing the company of an opportunity', () => {
  it('refuses a lead, takes an opportunity', async () => {
    const [a, b] = [await readyCompany(owner, tenant, 'Alpha'), await readyCompany(owner, tenant, 'Bravo')];
    const lead = await ok<{ id: string }>('POST', '/crm/companies', { ...as(), body: { name: 'Charlie', pib: testPib() } });
    const d = (await deal(a.id)).body;
    expect((await call('PATCH', `/crm/deals/${d.id}`, { ...as(), body: { companyId: lead.id } })).status).toBe(409);
    expect((await call('PATCH', `/crm/deals/${d.id}`, { ...as(), body: { companyId: b.id } })).status).toBe(200);
    // The same company again is no change, whatever its status now.
    await ok('PATCH', `/crm/companies/${b.id}/status`, { ...as(), body: { status: 'lead' } });
    expect((await call('PATCH', `/crm/deals/${d.id}`, { ...as(), body: { companyId: b.id, title: 'Renamed' } })).status).toBe(200);
  });
});

describe('the sale type', () => {
  it('is saved, can be changed and filters the list', async () => {
    const c = await readyCompany(owner, tenant, 'Filter Co');
    const capital = (await deal(c.id, { saleType: 'capital', title: 'Line' })).body;
    const transactional = (await deal(c.id, { saleType: 'transactional', title: 'Parts' })).body;
    await ok('PATCH', `/crm/deals/${transactional.id}`, { ...as(), body: { saleType: 'capital' } });
    await ok('PATCH', `/crm/deals/${transactional.id}`, { ...as(), body: { saleType: 'transactional' } });
    const ids = async (q: string) => (await ok<{ deal: { id: string } }[]>('GET', `/crm/deals?${q}&limit=200`, as())).map((r) => r.deal.id);
    expect(await ids('saleType=capital')).toContain(capital.id);
    expect(await ids('saleType=capital')).not.toContain(transactional.id);
    expect(await ids('saleType=transactional')).toContain(transactional.id);
    expect(await ids('saleType=transactional')).not.toContain(capital.id);
  });
});

describe('importing opportunities', () => {
  it('a row whose company is a lead, or unknown, is a row error in the preview', async () => {
    await readyCompany(owner, tenant, 'Import Ready');
    await ok('POST', '/crm/companies', { ...as(), body: { name: 'Import Lead', pib: testPib() } });
    const csv = ['Opportunity,Company', 'Ready one,Import Ready', 'Lead one,Import Lead', 'Unknown one,Nobody Ltd', 'No company,'].join('\n');
    const preview = await ok<{ rows: { line: number; status: string; messages?: string[]; reason?: string }[] }>('POST', '/crm/import/deals/preview', {
      ...as(),
      body: { csv },
    }, 200);
    const byLine = Object.fromEntries(preview.rows.map((r) => [r.line, r]));
    expect(byLine[2]!.status).toBe('create');
    expect(byLine[3]!.status).toBe('invalid');
    expect((byLine[3]!.messages ?? []).join(' ')).toContain('Import Lead is still a lead');
    expect(byLine[4]!.status).toBe('invalid');
    expect(byLine[5]!.status).toBe('invalid');
    expect((byLine[5]!.messages ?? []).join(' ')).toContain('an opportunity needs a company');
  });
});
