/**
 * Automatic company status (CD-358): Lead until identity, address and a qualified contact are in,
 * then Opportunity; Client once an opportunity is won; Past client when its last project is
 * completed; Not interested when every opportunity was lost. A person can only set it back, and
 * the automation then leaves it there until "Back to automatic". The changes are the history.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { addMember, call, createTenant, eventually, type Funnel, ok, type Session, signIn, testPib } from './helpers';
import { asTenantSql } from './people-helpers';

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
// Only an opportunity or a client takes an opportunity (CD-360).
const readyCompany = async (name: string) => {
  const c = await newCompany(name, identity);
  await qualifiedContact(c.id);
  return c;
};
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
    // A postal code is five digits (CD-478); spaces are dropped.
    expect((await call('PATCH', `/crm/companies/${c.id}`, { ...as(), body: { postalCode: 'abc' } })).status).toBe(400);
    expect(await ok('PATCH', `/crm/companies/${c.id}`, { ...as(), body: { postalCode: '11 000' } })).toMatchObject({ postalCode: '11000' });
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
    const c = await readyCompany('Kestrel Logistics');
    const deal = await newDeal(c.id);
    expect((await company(c.id)).status).toBe('opportunity');
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
    const c = await readyCompany('Sava Retail');
    const deal = await newDeal(c.id);
    await ok('POST', `/crm/deals/${deal.id}/lost`, { ...as(), body: { reason: 'Price' } }, 200);
    expect((await company(c.id)).status).toBe('not_interested');
    await ok('POST', `/crm/deals/${deal.id}/reopen`, as(), 200);
    expect((await company(c.id)).status).toBe('opportunity');
  });
});

describe('setting the status by hand', () => {
  let id: string;

  beforeAll(async () => {
    const c = await readyCompany('Orchard Dental');
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

  it('sets it back; it holds while the facts stay, and the automation takes over when they change (CD-478)', async () => {
    const set = await ok<Company>('PATCH', `/crm/companies/${id}/status`, { ...as(), body: { status: 'opportunity' } });
    expect(set).toMatchObject({ status: 'opportunity', statusSetManually: true });
    expect((await history(id))[0]).toMatchObject({ from: 'client', to: 'opportunity', reason: 'manual' });

    // An edit that changes nothing behind the status keeps it.
    await ok('PATCH', `/crm/companies/${id}`, { ...as(), body: { notes: 'Called back in spring' } });
    expect((await company(id)).status).toBe('opportunity');

    // Another won opportunity is a new fact: the automation takes over again.
    await ok('POST', `/crm/deals/${(await newDeal(id, 'Another')).id}/move`, { ...as(), body: { stageId: wonStage().id } }, 200);
    expect(await company(id)).toMatchObject({ status: 'client', statusSetManually: false });
    expect((await history(id))[0]).toMatchObject({ from: 'opportunity', to: 'client', reason: 'automatic' });
  });

  it('a hand-set status is released by a readiness change, and one set before CD-478 holds against the facts of today', async () => {
    const c = await readyCompany('Bistro Lane');
    await ok('PATCH', `/crm/companies/${c.id}/status`, { ...as(), body: { status: 'lead' } });
    await ok('PATCH', `/crm/companies/${c.id}`, { ...as(), body: { mb: null } });
    expect(await company(c.id)).toMatchObject({ status: 'lead', statusSetManually: false });

    // Set by hand before the facts were recorded: an edit keeps it, and records the facts quietly.
    const old = await readyCompany('Old Hand');
    await asTenantSql(tenant, `update companies set status = 'lead', status_set_manually = true where id = $1`, [old.id]);
    await ok('PATCH', `/crm/companies/${old.id}`, { ...as(), body: { notes: 'Edited after the release' } });
    expect(await company(old.id)).toMatchObject({ status: 'lead', statusSetManually: true });
    // The row that records the facts (lead → lead) isn't shown as a change.
    expect((await history(old.id)).some((r) => r.from === r.to)).toBe(false);
    // From now on the automation watches it: a readiness change releases it.
    await ok('PATCH', `/crm/companies/${old.id}`, { ...as(), body: { mb: null } });
    expect(await company(old.id)).toMatchObject({ status: 'lead', statusSetManually: false });
  });

  it('setting the status it already has by itself changes nothing (the app closes the opportunities first)', async () => {
    const c = await readyCompany('Linden Foods');
    await ok('POST', `/crm/deals/${(await newDeal(c.id)).id}/lost`, { ...as(), body: { reason: 'No decision', note: 'Closed when the company was set to Not interested' } }, 200);
    expect(await ok<Company>('PATCH', `/crm/companies/${c.id}/status`, { ...as(), body: { status: 'not_interested' } })).toMatchObject({ status: 'not_interested', statusSetManually: false });
    expect((await history(c.id))[0]).toMatchObject({ to: 'not_interested', reason: 'automatic' });
  });

  it('Not interested closes its open opportunities in the same step, and is set by hand (CD-478 QA TC8)', async () => {
    const c = await readyCompany('Aspen Clinic');
    const open = await newDeal(c.id);
    const set = await ok<Company>('PATCH', `/crm/companies/${c.id}/status`, { ...as(), body: { status: 'not_interested', closeOpen: { reason: 'Timing' } } });
    expect(set).toMatchObject({ status: 'not_interested', statusSetManually: true });
    const changes = await history(c.id);
    expect(changes[0]).toMatchObject({ from: 'opportunity', to: 'not_interested', reason: 'manual', actorUserId: owner.userId });
    expect(changes.some((r) => r.to === 'not_interested' && r.reason === 'automatic')).toBe(false);
    expect(await ok('GET', `/crm/deals/${open.id}`, as())).toMatchObject({ outcome: 'lost', lostReason: 'Timing', lostNote: 'Closed when the company was set to Not interested' });
    const timeline = await ok<{ title: string }[]>('GET', `/crm/deals/${open.id}/activities`, as());
    expect(timeline.map((a) => a.title)).toContain('Marked as lost: Timing');

    // A client keeps its won opportunity; only the open ones close.
    const won = await readyCompany('Birch Studio');
    await ok('POST', `/crm/deals/${(await newDeal(won.id)).id}/move`, { ...as(), body: { stageId: wonStage().id } }, 200);
    const second = await newDeal(won.id, 'Second site');
    expect(await ok<Company>('PATCH', `/crm/companies/${won.id}/status`, { ...as(), body: { status: 'not_interested', closeOpen: { reason: 'Price' } } })).toMatchObject({ status: 'not_interested', statusSetManually: true });
    expect(await ok('GET', `/crm/deals/${second.id}`, as())).toMatchObject({ outcome: 'lost' });

    // Only Not interested closes them.
    expect((await call('PATCH', `/crm/companies/${won.id}/status`, { ...as(), body: { status: 'lead', closeOpen: { reason: 'Price' } } })).status).toBe(400);
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
    expect(await names('status=not_interested,past_client')).toEqual(['Aspen Clinic', 'Birch Studio', 'Linden Foods', 'Seller Co']);
    expect(await names('outcome=won')).toEqual(['Birch Studio', 'Kestrel Logistics', 'Orchard Dental']);
    expect(await names('outcome=lost')).toEqual(['Aspen Clinic', 'Linden Foods']);
    expect((await call('GET', '/crm/companies?status=customer', as())).status).toBe(400);
  });
});
