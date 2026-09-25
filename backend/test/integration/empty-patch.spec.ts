/** An update with no fields is a client error (400 with a clear message), never a 500. */
import { beforeAll, describe, expect, it } from 'vitest';
import { addMember, call, createTenant, firstFunnel, type Funnel, ok, type Session, signIn } from './helpers';

let owner: Session;
let member: Session;
let tenant: string;
let funnel: Funnel;
const as = () => ({ token: owner.token, tenant });
const ids: Record<string, string> = {};

beforeAll(async () => {
  owner = await signIn('patch-owner');
  member = await signIn('patch-member');
  tenant = await createTenant(owner, 'Empty patch');
  await addMember(owner, tenant, member, 'member');
  funnel = await firstFunnel(owner, tenant);
  const company = await ok('POST', '/crm/companies', { ...as(), body: { name: 'Acme' } });
  const contact = await ok('POST', '/crm/contacts', { ...as(), body: { fullName: 'Ann Buyer', companyId: company.id } });
  const product = await ok('POST', '/crm/products', { ...as(), body: { name: 'Audit', unitPrice: 100 } });
  const deal = await ok('POST', '/crm/deals', { ...as(), body: { title: 'Deal', funnelId: funnel.id, companyId: company.id } });
  const task = await ok('POST', `/crm/deals/${deal.id}/tasks`, { ...as(), body: { stageId: funnel.stages[0]!.id, label: 'Call back' } });
  Object.assign(ids, { company: company.id, contact: contact.id, product: product.id, deal: deal.id, task: task.id });
});

const endpoints = () => [
  ['deal', `/crm/deals/${ids.deal}`],
  ['company', `/crm/companies/${ids.company}`],
  ['contact', `/crm/contacts/${ids.contact}`],
  ['product', `/crm/products/${ids.product}`],
  ['deal task', `/crm/deal-tasks/${ids.task}`],
  ['funnel stage', `/crm/funnels/${funnel.id}/stages/${funnel.stages[0]!.id}`],
];

describe('PATCH with nothing to change', () => {
  it('returns 400 with a clear message on every update endpoint', async () => {
    for (const [name, path] of endpoints()) {
      const res = await call('PATCH', path!, { ...as(), body: {} });
      expect(res.status, `${name}: ${JSON.stringify(res.body)}`).toBe(400);
      expect(JSON.stringify(res.body), name).toContain('Nothing to update');
    }
    // The member endpoint's only field (role) is required, so it says that instead.
    const res = await call('PATCH', `/team/members/${member.userId}`, { ...as(), body: {} });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('role');
  });

  it('treats unknown fields as nothing to change', async () => {
    for (const [name, path] of endpoints()) {
      const res = await call('PATCH', path!, { ...as(), body: { notAField: 1 } });
      expect(res.status, `${name}: ${JSON.stringify(res.body)}`).toBe(400);
    }
  });

  it('still accepts a real change, including an explicit null', async () => {
    expect((await ok('PATCH', `/crm/deals/${ids.deal}`, { ...as(), body: { closeDate: null } })).closeDate).toBeNull();
    expect((await ok('PATCH', `/crm/companies/${ids.company}`, { ...as(), body: { industry: 'Retail' } })).industry).toBe('Retail');
    expect((await ok('PATCH', `/crm/deal-tasks/${ids.task}`, { ...as(), body: { done: true } })).done).toBe(true);
  });

  it('re-sending the deal\'s current funnel is a no-op, not a 500', async () => {
    const before = await ok('GET', `/crm/deals/${ids.deal}`, as());
    const after = await ok('PATCH', `/crm/deals/${ids.deal}`, { ...as(), body: { funnelId: funnel.id } });
    expect(after.stageId).toBe(before.stageId);
  });
});
