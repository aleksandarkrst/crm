/**
 * Deleting a company (CD-534): its contacts go with it (the Delete dialog says so), a deal of another
 * company loses them as its primary contact, and a company with an opportunity or a project is
 * refused (409) so nothing loses its customer. Members can't delete (permissions-matrix.spec.ts).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { addMember, call, createTenant, firstFunnel, type Funnel, ok, readyCompany, type Session, signIn, testPib } from './helpers';

let owner: Session;
let admin: Session;
let tenant: string;
let funnel: Funnel;
const as = (s: Session = owner) => ({ token: s.token, tenant });

interface Contact {
  id: string;
  companyId: string | null;
}

beforeAll(async () => {
  [owner, admin] = await Promise.all([signIn('delete-owner'), signIn('delete-admin')]);
  tenant = await createTenant(owner, 'Company delete');
  await addMember(owner, tenant, admin, 'admin');
  funnel = await firstFunnel(owner, tenant);
});

describe('deleting a company', () => {
  it('deletes its contacts with it; a deal elsewhere loses them as its primary contact', async () => {
    const gone = await ok<{ id: string; name: string }>('POST', '/crm/companies', { ...as(), body: { pib: testPib(), name: 'Gone d.o.o.' } });
    const ana = await ok<Contact>('POST', '/crm/contacts', { ...as(), body: { fullName: 'Ana Gone', companyId: gone.id, buyerRole: 'User' } });
    const boris = await ok<Contact>('POST', '/crm/contacts', { ...as(), body: { fullName: 'Boris Gone', companyId: gone.id } });
    // Ana is the primary contact and Boris the sponsor and power sponsor (CD-362) of another
    // company's opportunity (consultants, say): the deal stays and loses them (the sponsor
    // foreign keys are ON DELETE SET NULL since 0117, the primary contact is cleared here).
    const other = await readyCompany(owner, tenant, 'Stays d.o.o.');
    const deal = await ok<{ id: string }>('POST', '/crm/deals', { ...as(), body: { title: 'Stays deal', funnelId: funnel.id, companyId: other.id, primaryContactId: ana.id } });
    await ok('PATCH', `/crm/deals/${deal.id}`, { ...as(), body: { sponsorContactId: boris.id, powerSponsorContactId: boris.id } });

    await ok('DELETE', `/crm/companies/${gone.id}`, as(admin), 204);
    expect((await call('GET', `/crm/companies/${gone.id}`, as())).status).toBe(404);
    const left = await ok<Contact[]>('GET', '/crm/contacts?limit=200', as());
    expect(left.some((c) => c.id === ana.id || c.id === boris.id)).toBe(false);
    expect(left.some((c) => c.id === other.contactId)).toBe(true);
    expect(await ok<{ primaryContactId: string | null; sponsorContactId: string | null; powerSponsorContactId: string | null }>('GET', `/crm/deals/${deal.id}`, as())).toMatchObject({ primaryContactId: null, sponsorContactId: null, powerSponsorContactId: null });
  });

  it('is refused with an opportunity or a project, naming why', async () => {
    const busy = await readyCompany(owner, tenant, 'Busy d.o.o.');
    await ok('POST', '/crm/deals', { ...as(), body: { title: 'Busy deal', funnelId: funnel.id, companyId: busy.id } });
    const withDeal = await call<{ message: string }>('DELETE', `/crm/companies/${busy.id}`, as());
    expect(withDeal.status).toBe(409);
    expect(withDeal.body.message).toBe('Busy d.o.o. has 1 opportunity. Delete them or move them to another company first.');

    const client = await readyCompany(owner, tenant, 'Client d.o.o.');
    const [type] = await ok<{ id: string }[]>('GET', '/project-types', as());
    await ok('POST', '/projects', { ...as(), body: { name: 'Rollout', projectTypeId: type!.id, companyId: client.id } });
    const withProject = await call<{ message: string }>('DELETE', `/crm/companies/${client.id}`, as());
    expect(withProject.status).toBe(409);
    expect(withProject.body.message).toContain('1 project');
    // Both still exist, contacts included.
    expect((await ok<Contact[]>('GET', `/crm/contacts?companyId=${client.id}`, as())).map((c) => c.id)).toEqual([client.contactId]);
  });
});
