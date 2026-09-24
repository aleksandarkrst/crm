/** Lists carry the owner's name, and keep it after the owner leaves the workspace. */
import { beforeAll, describe, expect, it } from 'vitest';
import { addMember, createTenant, firstFunnel, ok, type Session, signIn } from './helpers';

let owner: Session;
let seller: Session;
let tenant: string;
const as = () => ({ token: owner.token, tenant });

beforeAll(async () => {
  owner = await signIn('names-owner');
  seller = await signIn('names-seller');
  tenant = await createTenant(owner, 'Owner names');
  await addMember(owner, tenant, seller, 'member');
});

describe('owner names in lists', () => {
  it('deals, companies, contacts and tasks name their owner, also once they were removed from the team', async () => {
    const funnel = await firstFunnel(owner, tenant);
    const company = await ok('POST', '/crm/companies', { ...as(), body: { name: 'Owned Co', ownerUserId: seller.userId } });
    const contact = await ok('POST', '/crm/contacts', { ...as(), body: { fullName: 'Owned Person', companyId: company.id, ownerUserId: seller.userId } });
    // A contact owned by someone else than the deal owner shows their own owner, not the deal's.
    const ownContact = await ok('POST', '/crm/contacts', { ...as(), body: { fullName: 'Owner Person', companyId: company.id } });
    const deal = await ok('POST', '/crm/deals', { ...as(), body: { title: 'Owned deal', funnelId: funnel.id, companyId: company.id, ownerUserId: seller.userId } });
    const task = await ok('POST', `/crm/deals/${deal.id}/tasks`, {
      ...as(),
      body: { stageId: funnel.stages[0]!.id, label: 'Follow up', blocksAdvance: false, assigneeUserId: seller.userId },
    });

    const check = async () => {
      const d = (await ok('GET', '/crm/deals', as())).find((r: { deal: { id: string } }) => r.deal.id === deal.id);
      expect(d.ownerName).toBe(seller.name);
      expect(d.deal.ownerUserId).toBe(seller.userId);
      const c = (await ok('GET', '/crm/companies', as())).find((r: { id: string }) => r.id === company.id);
      expect(c.ownerName).toBe(seller.name);
      const people = await ok('GET', '/crm/contacts', as());
      expect(people.find((r: { id: string }) => r.id === contact.id)).toMatchObject({ ownerUserId: seller.userId, ownerName: seller.name });
      expect(people.find((r: { id: string }) => r.id === ownContact.id)).toMatchObject({ ownerUserId: owner.userId, ownerName: owner.name });
      const t = (await ok('GET', '/crm/deal-tasks', as())).find((r: { id: string }) => r.id === task.id);
      expect(t.assigneeName).toBe(seller.name);
    };
    await check();
    await ok('DELETE', `/team/members/${seller.userId}`, as());
    await check();
  });
});
