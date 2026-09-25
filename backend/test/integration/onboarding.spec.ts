/**
 * CD-68: the getting-started checklist (steps derived from the workspace's own records, dismissal
 * per user) and sample data that is loaded and removed again exactly, for owners and admins only.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { addMember, call, createTenant, type Funnel, type Json, ok, type Session, signIn } from './helpers';

let owner: Session;
let admin: Session;
let member: Session;
let outsider: Session;
let tenant: string;
let otherTenant: string;
const as = (s: Session = owner, t = tenant) => ({ token: s.token, tenant: t });

const state = (s: Session = owner, t = tenant) => ok('GET', '/onboarding', as(s, t));
const done = (st: Json) => Object.fromEntries(st.steps.map((x: Json) => [x.key, x.done]));
const list = (path: string, s: Session = owner, t = tenant) => ok<Json[]>('GET', `${path}${path.includes('?') ? '&' : '?'}limit=200`, as(s, t));

beforeAll(async () => {
  [owner, admin, member, outsider] = await Promise.all([signIn('onboard-owner'), signIn('onboard-admin'), signIn('onboard-member'), signIn('onboard-outsider')]);
  [tenant, otherTenant] = await Promise.all([createTenant(owner, 'Onboarding'), createTenant(outsider, 'Onboarding other')]);
});

describe('the checklist', () => {
  it('starts with nothing done in a new workspace', async () => {
    const st = await state();
    expect(st).toMatchObject({ complete: false, dismissed: false, sampleData: { loaded: false, counts: { company: 0, contact: 0, product: 0, deal: 0 } } });
    expect(done(st)).toEqual({ funnel: false, products: false, deals: false, invite: false });
  });

  it('is for owners and admins: members and outsiders get 403 on every route', async () => {
    await addMember(owner, tenant, admin, 'admin');
    await addMember(owner, tenant, member, 'member');
    for (const [method, path, body] of [
      ['GET', '/onboarding', undefined],
      ['PUT', '/onboarding/dismissed', { dismissed: true }],
      ['POST', '/onboarding/sample-data', undefined],
      ['DELETE', '/onboarding/sample-data', undefined],
    ] as const) {
      expect((await call(method, path, { ...as(member), body })).status, `${method} ${path}`).toBe(403);
      expect((await call(method, path, { token: outsider.token, tenant, body })).status, `${method} ${path}`).toBe(403);
    }
  });

  it('is dismissed per user, and can be shown again', async () => {
    expect((await ok('PUT', '/onboarding/dismissed', { ...as(admin), body: { dismissed: true } })).dismissed).toBe(true);
    expect((await state(admin)).dismissed).toBe(true);
    expect((await state(owner)).dismissed).toBe(false);
    expect((await ok('PUT', '/onboarding/dismissed', { ...as(admin), body: { dismissed: false } })).dismissed).toBe(false);
    expect((await call('PUT', '/onboarding/dismissed', { ...as(admin), body: {} })).status).toBe(400);
  });

  it('ticks each step from real records', async () => {
    // The invitations above (accepted) count for "invite a colleague".
    expect(done(await state()).invite).toBe(true);
    const funnel = (await ok<Funnel[]>('GET', '/crm/funnels', as()))[0]!;
    await ok('PATCH', `/crm/funnels/${funnel.id}/stages/${funnel.stages[0]!.id}`, { ...as(), body: { activity: 'Call' } });
    await ok('POST', '/crm/products', { ...as(), body: { name: 'Real product', unitPrice: 10 } });
    expect(done(await state())).toEqual({ funnel: true, products: true, deals: false, invite: true });
    await ok('POST', '/crm/deals', { ...as(), body: { title: 'Real deal', funnelId: funnel.id } });
    const st = await state();
    expect(st.complete).toBe(true);
    expect(done(st)).toEqual({ funnel: true, products: true, deals: true, invite: true });
  });

  it('counts a pending invitation as inviting a colleague', async () => {
    expect(done(await state(outsider, otherTenant)).invite).toBe(false);
    await ok('POST', '/team/invitations', { ...as(outsider, otherTenant), body: { email: `invitee-${Date.now()}@example.test`, role: 'member' } });
    expect(done(await state(outsider, otherTenant)).invite).toBe(true);
  });
});

describe('sample data', () => {
  let t: string;
  const asT = (s: Session = owner) => as(s, t);

  beforeAll(async () => {
    t = await createTenant(owner, 'Sample');
  });

  it('loads a small, realistic set, marked as sample, and it does not tick the checklist', async () => {
    const st = await ok('POST', '/onboarding/sample-data', asT());
    expect(st.sampleData).toEqual({ loaded: true, counts: { company: 4, contact: 5, product: 3, deal: 6 } });
    expect(done(st)).toMatchObject({ products: false, deals: false });

    const deals = await list('/crm/deals', owner, t);
    expect(deals).toHaveLength(6);
    for (const r of deals) {
      expect(r.deal.source).toBe('Sample data');
      expect(r.companyName).toBeTruthy();
      expect(r.contactName).toBeTruthy();
      expect(r.deal.ownerUserId).toBe(owner.userId);
    }
    expect(deals.map((r) => r.deal.outcome).sort()).toEqual(['lost', 'open', 'open', 'open', 'open', 'won']);
    // Amounts are the sum of the deal lines, like any deal.
    const lines = await list('/crm/deal-lines', owner, t);
    for (const r of deals) {
      const sum = lines.filter((l) => l.dealId === r.deal.id).reduce((a, l) => a + Number(l.quantity) * Number(l.unitPrice), 0);
      expect(Number(r.deal.amount)).toBe(sum);
    }
    const tasks = (await list('/crm/deal-tasks', owner, t)).filter((x) => x.dueDate);
    expect(tasks).toHaveLength(4);
    expect(tasks.every((x) => x.assigneeUserId === owner.userId && !x.blocksAdvance)).toBe(true);
    // "Due today" is today in the workspace's time zone (Europe/Belgrade by default), not in UTC.
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Belgrade' }).format(new Date());
    expect(tasks.find((x) => x.label === 'Call Nikola about the pilot scope')?.dueDate).toBe(today);
    const history = await list('/crm/deal-stage-history', owner, t);
    expect(new Set(history.map((h) => h.dealId)).size).toBe(6);
    expect(await list('/crm/companies', owner, t)).toHaveLength(4);
    expect(await list('/crm/contacts', owner, t)).toHaveLength(5);
    expect(await list('/crm/products', owner, t)).toHaveLength(3);
  });

  it('refuses to load twice', async () => {
    expect((await call('POST', '/onboarding/sample-data', asT())).status).toBe(409);
    expect(await list('/crm/deals', owner, t)).toHaveLength(6);
  });

  it("is invisible to another workspace, which can't remove it", async () => {
    expect((await state(outsider, otherTenant)).sampleData.loaded).toBe(false);
    const res = await ok('DELETE', '/onboarding/sample-data', as(outsider, otherTenant), 200);
    expect(res.removed).toEqual({ company: 0, contact: 0, product: 0, deal: 0 });
    expect(await list('/crm/deals', owner, t)).toHaveLength(6);
  });

  it('removes exactly the sample records; real records, and sample ones they use, stay', async () => {
    const funnel = (await ok<Funnel[]>('GET', '/crm/funnels', asT()))[0]!;
    const sampleCompany = (await list('/crm/companies', owner, t)).find((c) => c.name === 'Tidewater Foods')!;
    const realCompany = await ok('POST', '/crm/companies', { ...asT(), body: { name: 'Real Co' } });
    const realContact = await ok('POST', '/crm/contacts', { ...asT(), body: { fullName: 'Real Person', companyId: realCompany.id } });
    const realDeal = await ok('POST', '/crm/deals', { ...asT(), body: { title: 'Real deal at a sample company', funnelId: funnel.id, companyId: sampleCompany.id } });
    const realProduct = await ok('POST', '/crm/products', { ...asT(), body: { name: 'Real product', unitPrice: 5 } });

    const res = await ok('DELETE', '/onboarding/sample-data', asT(owner), 200);
    expect(res.removed).toEqual({ company: 3, contact: 5, product: 3, deal: 6 });
    expect(res.kept).toEqual({ company: 1, contact: 0, product: 0, deal: 0 });
    expect(res.state.sampleData).toEqual({ loaded: false, counts: { company: 0, contact: 0, product: 0, deal: 0 } });

    expect((await list('/crm/deals', owner, t)).map((r) => r.deal.id)).toEqual([realDeal.id]);
    expect((await list('/crm/companies', owner, t)).map((c) => c.id).sort()).toEqual([realCompany.id, sampleCompany.id].sort());
    expect((await list('/crm/contacts', owner, t)).map((c) => c.id)).toEqual([realContact.id]);
    expect((await list('/crm/products', owner, t)).map((p) => p.id)).toEqual([realProduct.id]);
    expect(await list('/crm/deal-tasks', owner, t)).toEqual([]);
    expect((await list('/crm/deal-stage-history', owner, t)).every((h) => h.dealId === realDeal.id)).toBe(true);
    // Removing again is a no-op; loading again works.
    expect((await ok('DELETE', '/onboarding/sample-data', asT(), 200)).removed).toEqual({ company: 0, contact: 0, product: 0, deal: 0 });
    expect((await ok('POST', '/onboarding/sample-data', asT(owner))).sampleData.counts.deal).toBe(6);
  });

  it('can be loaded and removed by an admin', async () => {
    const t2 = await createTenant(owner, 'Sample admin');
    await addMember(owner, t2, admin, 'admin');
    expect((await ok('POST', '/onboarding/sample-data', as(admin, t2))).sampleData.loaded).toBe(true);
    expect((await ok('DELETE', '/onboarding/sample-data', as(admin, t2), 200)).removed.deal).toBe(6);
  });
});
