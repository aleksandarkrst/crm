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

  it('takes two opportunities for one company at once, and opposite moves between two companies', async () => {
    // Both lock the company row; a shared lock that both then upgrade would deadlock one of them.
    const c = await readyCompany(owner, tenant, 'Parallel Co');
    const [a, b] = await Promise.all([deal(c.id), deal(c.id)]);
    expect([a.status, b.status]).toEqual([201, 201]);
    const d = await readyCompany(owner, tenant, 'Parallel Two');
    const onD = await deal(d.id);
    const moves = await Promise.all([
      call('PATCH', `/crm/deals/${a.body.id}`, { ...as(), body: { companyId: d.id } }),
      call('PATCH', `/crm/deals/${onD.body.id}`, { ...as(), body: { companyId: c.id } }),
    ]);
    expect(moves.map((m) => m.status)).toEqual([200, 200]);
  });
});

describe('companies that are neither a lead nor complete, and other workspaces', () => {
  it('refuses a Not interested company until it is complete (set back from Lead by hand)', async () => {
    const lead = await ok<{ id: string }>('POST', '/crm/companies', { ...as(), body: { name: 'Quiet Co', pib: testPib() } });
    await ok('PATCH', `/crm/companies/${lead.id}/status`, { ...as(), body: { status: 'not_interested' } });
    const refused = await deal(lead.id);
    expect(refused.status).toBe(409);
    expect(refused.body.message).toContain("Quiet Co is Not interested and isn't complete");
    // Complete, it may try again.
    const ready = await readyCompany(owner, tenant, 'Second chance Co');
    await ok('PATCH', `/crm/companies/${ready.id}/status`, { ...as(), body: { status: 'not_interested' } });
    expect((await deal(ready.id)).status).toBe(201);
  });

  it("refuses another workspace's company on create and on a company change, and a missing opportunity", async () => {
    const other = await signIn('entry-other');
    const otherTenant = await createTenant(other, 'Pipeline entry other');
    const theirs = await readyCompany(other, otherTenant, 'Their Co');
    expect((await deal(theirs.id)).status).toBe(400);
    // Their lead too: a 400 that says nothing about it (no blockers), not a 409 with its gaps.
    const theirLead = await ok<{ id: string }>('POST', '/crm/companies', { token: other.token, tenant: otherTenant, body: { name: 'Their Lead', pib: testPib() } });
    const refused = await deal(theirLead.id);
    expect(refused.status).toBe(400);
    expect(refused.body.message).toBe('Pick a company of this workspace');
    expect(refused.body.blockers).toBeUndefined();
    const mine = (await deal((await readyCompany(owner, tenant, 'Mine Co')).id)).body;
    expect((await call('PATCH', `/crm/deals/${mine.id}`, { ...as(), body: { companyId: theirs.id } })).status).toBe(400);
    expect((await call('PATCH', `/crm/deals/00000000-0000-4000-8000-000000000000`, { ...as(), body: { companyId: theirs.id } })).status).toBe(404);
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
    // It can be cleared again.
    const cleared = (await deal(c.id, { saleType: 'capital', title: 'Cleared' })).body;
    expect((await ok<{ saleType: string | null }>('PATCH', `/crm/deals/${cleared.id}`, { ...as(), body: { saleType: null } })).saleType).toBeNull();
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
    const quietPib = testPib();
    const quiet = await ok<{ id: string }>('POST', '/crm/companies', { ...as(), body: { name: 'Import Quiet', pib: quietPib } });
    await ok('PATCH', `/crm/companies/${quiet.id}/status`, { ...as(), body: { status: 'not_interested' } });
    // The last row names it by its PIB written with spaces, under another name.
    const spaced = `${quietPib.slice(0, 3)} ${quietPib.slice(3, 6)} ${quietPib.slice(6)}`;
    const csv = ['Opportunity,Company,PIB', 'Ready one,Import Ready,', 'Lead one,Import Lead,', 'Unknown one,Nobody Ltd,', 'No company,,', 'Quiet one,Import Quiet,', `Spaced one,Quiet Renamed,${spaced}`].join('\n');
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
    expect(byLine[5]!.messages).toContain('Company is required');
    // An incomplete Not interested company is refused like a lead.
    expect(byLine[6]!.status).toBe('invalid');
    expect((byLine[6]!.messages ?? []).join(' ')).toContain("Import Quiet is Not interested and isn't complete");
    expect(byLine[7]!.status).toBe('invalid');
    expect((byLine[7]!.messages ?? []).join(' ')).toContain("Import Quiet is Not interested and isn't complete");
  });
});
