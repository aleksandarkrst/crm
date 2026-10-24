/**
 * Automatic company status (CD-358): Lead until identity, address and a qualified contact are in,
 * then Opportunity; Client once an opportunity is won; Past client when its last project is
 * completed; Not interested when every opportunity was lost. A person can only set it back, and
 * the automation then leaves it there until "Back to automatic". The changes are the history.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { addMember, call, createTenant, eventually, type Funnel, ok, type Session, signIn, testPib } from './helpers';

let owner: Session;
let seller: Session;
let tenant: string;
let funnel: Funnel;
const as = (s: Session = owner) => ({ token: s.token, tenant });

interface Company {
  id: string;
  status: string;
  statusSetManually: boolean;
}
interface Change {
  from: string;
  to: string;
  reason: string;
  actorUserId: string;
}
const identity = { mb: '20084693', activityCode: '4941', address: 'Bulevar 10', city: 'Novi Sad', postalCode: '21000' };
const company = async (id: string) => ok<Company>('GET', `/crm/companies/${id}`, as());
const newCompany = (name: string, extra: Record<string, unknown> = {}) => ok<Company>('POST', '/crm/companies', { ...as(), body: { name, pib: testPib(), ...extra } });
const qualifiedContact = (companyId: string) =>
  ok<{ id: string }>('POST', '/crm/contacts', { ...as(), body: { companyId, fullName: 'Jelena Savić', jobTitle: 'Head of operations', buyerRole: 'Champion', ownerUserId: owner.userId } });
const newDeal = (companyId: string, title = 'Fleet licences') => ok<{ id: string }>('POST', '/crm/deals', { ...as(), body: { title, companyId, funnelId: funnel.id } });
const wonStage = () => funnel.stages.find((s) => s.isWon)!;
const history = (id: string) => ok<Change[]>('GET', `/crm/companies/${id}/status-history`, as());

beforeAll(async () => {
  [owner, seller] = await Promise.all([signIn('status-owner'), signIn('status-seller')]);
  tenant = await createTenant(owner, 'Company status');
  await addMember(owner, tenant, seller, 'member');
  funnel = (await ok<Funnel[]>('GET', '/crm/funnels', as()))[0]!;
});

describe('Lead → Opportunity, by itself', () => {
  it('stays a lead until identity, address and a qualified contact are in', async () => {
    const c = await newCompany('Vega Logistika');
    expect(c).toMatchObject({ status: 'lead', statusSetManually: false });

    await ok('PATCH', `/crm/companies/${c.id}`, { ...as(), body: identity });
    expect((await company(c.id)).status).toBe('lead');

    // A contact without an owner doesn't count; giving it one does.
    const contact = await ok<{ id: string }>('POST', '/crm/contacts', { ...as(), body: { companyId: c.id, fullName: 'Nikola Ilić', jobTitle: 'Managing director', buyerRole: 'Decision maker', ownerUserId: null } });
    expect((await company(c.id)).status).toBe('lead');
    await ok('PATCH', `/crm/contacts/${contact.id}`, { ...as(), body: { ownerUserId: seller.userId } });
    expect((await company(c.id)).status).toBe('opportunity');
    expect((await history(c.id))[0]).toMatchObject({ from: 'lead', to: 'opportunity', reason: 'automatic', actorUserId: owner.userId });

    // Clearing a field takes it back.
    await ok('PATCH', `/crm/companies/${c.id}`, { ...as(), body: { postalCode: null } });
    expect((await company(c.id)).status).toBe('lead');
    // The name isn't one of the checks: a company can't be saved without one.
    expect((await call('PATCH', `/crm/companies/${c.id}`, { ...as(), body: { name: '   ' } })).status).toBe(400);
  });

  it('follows a contact that moves to another company', async () => {
    const [a, b] = [await newCompany('Delta A', identity), await newCompany('Delta B', identity)];
    const contact = await qualifiedContact(a.id);
    expect((await company(a.id)).status).toBe('opportunity');
    await ok('PATCH', `/crm/contacts/${contact.id}`, { ...as(), body: { companyId: b.id } });
    expect((await company(a.id)).status).toBe('lead');
    expect((await company(b.id)).status).toBe('opportunity');
    await ok('DELETE', `/crm/contacts/${contact.id}`, as(), 204);
    expect((await company(b.id)).status).toBe('lead');
  });
});

describe('Client, Past client, Not interested', () => {
  it('a won opportunity makes a client; its completed project a past client', async () => {
    const c = await newCompany('Kestrel Logistics');
    const deal = await newDeal(c.id);
    expect((await company(c.id)).status).toBe('lead');
    await ok('POST', `/crm/deals/${deal.id}/move`, { ...as(), body: { stageId: wonStage().id } }, 200);
    expect((await company(c.id)).status).toBe('client');

    const [type] = await ok<{ id: string }[]>('GET', '/project-types', as());
    const project = await ok<{ id: string }>('POST', '/projects', { ...as(), body: { name: 'Fleet rollout', projectTypeId: type!.id, companyId: c.id } });
    await ok('PATCH', `/projects/${project.id}`, { ...as(), body: { status: 'completed' } });
    // Projects tell the CRM worker (projects.company-projects-changed).
    await eventually(async () => (await company(c.id)).status === 'past_client', 'past client after the last project is completed');

    // A new open opportunity makes it a client again.
    await newDeal(c.id, 'Second site');
    expect((await company(c.id)).status).toBe('client');
  });

  it('every opportunity lost is Not interested; reopening one takes it back', async () => {
    const c = await newCompany('Sava Retail');
    const deal = await newDeal(c.id);
    await ok('POST', `/crm/deals/${deal.id}/lost`, { ...as(), body: { reason: 'Price' } }, 200);
    expect((await company(c.id)).status).toBe('not_interested');
    await ok('POST', `/crm/deals/${deal.id}/reopen`, as(), 200);
    expect((await company(c.id)).status).toBe('lead');
  });
});

describe('setting the status by hand', () => {
  let id: string;

  beforeAll(async () => {
    const c = await newCompany('Orchard Dental');
    id = c.id;
    await ok('POST', `/crm/deals/${(await newDeal(id)).id}/move`, { ...as(), body: { stageId: wonStage().id } }, 200);
    expect((await company(id)).status).toBe('client');
  });

  it('refuses a move forward, with what is missing for Opportunity', async () => {
    const lead = await newCompany('Ferma Organik');
    const refused = await call<{ message: string; blockers: string[] }>('PATCH', `/crm/companies/${lead.id}/status`, { ...as(), body: { status: 'opportunity' } });
    expect(refused.status).toBe(409);
    expect(refused.body.blockers).toContain('Matični broj');
  });

  it('sets it back, and the automation leaves it there until Back to automatic', async () => {
    const set = await ok<Company>('PATCH', `/crm/companies/${id}/status`, { ...as(), body: { status: 'opportunity' } });
    expect(set).toMatchObject({ status: 'opportunity', statusSetManually: true });
    expect((await history(id))[0]).toMatchObject({ from: 'client', to: 'opportunity', reason: 'manual' });

    // Another won opportunity doesn't raise it.
    await ok('POST', `/crm/deals/${(await newDeal(id, 'Another')).id}/move`, { ...as(), body: { stageId: wonStage().id } }, 200);
    expect((await company(id)).status).toBe('opportunity');

    const back = await ok<Company>('PATCH', `/crm/companies/${id}/status`, { ...as(), body: { status: null } });
    expect(back).toMatchObject({ status: 'client', statusSetManually: false });
    expect((await history(id))[0]).toMatchObject({ from: 'opportunity', to: 'client', reason: 'automatic' });
  });

  it('is for owners, admins and the company owner only', async () => {
    expect((await call('PATCH', `/crm/companies/${id}/status`, { ...as(seller), body: { status: 'lead' } })).status).toBe(403);
    const theirs = await ok<Company>('POST', '/crm/companies', { ...as(seller), body: { name: 'Seller Co', pib: testPib() } });
    expect((await call('PATCH', `/crm/companies/${theirs.id}/status`, { ...as(seller), body: { status: 'not_interested' } })).status).toBe(200);
  });
});

describe('the companies list', () => {
  it('filters by status, and by won or lost opportunities', async () => {
    const names = async (query: string) => (await ok<{ name: string }[]>('GET', `/crm/companies?${query}&limit=200`, as())).map((c) => c.name).sort();
    expect(await names('status=client')).toEqual(['Kestrel Logistics', 'Orchard Dental']);
    expect(await names('status=not_interested,past_client')).toEqual(['Seller Co']);
    expect(await names('outcome=won')).toEqual(['Kestrel Logistics', 'Orchard Dental']);
    expect(await names('outcome=lost')).toEqual([]);
    expect((await call('GET', '/crm/companies?status=customer', as())).status).toBe(400);
  });
});
