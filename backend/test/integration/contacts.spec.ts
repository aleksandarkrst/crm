/**
 * Contacts (CD-464): a phone is checked by the API (a letter-filled "abc123!!" is refused), and a
 * contact can belong to a company that has no deals, linked to none.
 */
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { addMember, call, createTenant, ok, type Session, signIn, testPib } from './helpers';

let owner: Session;
let member: Session;
let tenant: string;
let db: Client;
const as = () => ({ token: owner.token, tenant });

beforeAll(async () => {
  [owner, member] = await Promise.all([signIn('contacts-owner'), signIn('contacts-member')]);
  tenant = await createTenant(owner, 'Contacts');
  await addMember(owner, tenant, member, 'member');
  db = new Client({ connectionString: inject('databaseUrl') });
  await db.connect();
});
afterAll(async () => {
  await db?.end();
});

describe('contact phone', () => {
  it('refuses an invalid phone on create and update, with a plain message', async () => {
    const bad = await call<{ message: string | string[] }>('POST', '/crm/contacts', { ...as(), body: { fullName: 'Bad Phone', phone: 'abc123!!' } });
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.body)).toContain('Enter a phone number');

    const contact = await ok<{ id: string; phone: string | null }>('POST', '/crm/contacts', { ...as(), body: { fullName: 'Good Phone', phone: '+381 60 123 4567' } });
    expect(contact.phone).toBe('+381 60 123 4567');
    expect((await call('PATCH', `/crm/contacts/${contact.id}`, { ...as(), body: { phone: '123' } })).status).toBe(400);
    expect(await ok('PATCH', `/crm/contacts/${contact.id}`, { ...as(), body: { phone: '021/456-789 ext. 12' } }, 200)).toMatchObject({ phone: '021/456-789 ext. 12' });
    expect(await ok('PATCH', `/crm/contacts/${contact.id}`, { ...as(), body: { phone: '' } }, 200)).toMatchObject({ phone: null });
  });

  it('a contact saved before the check, with a phone it now refuses, still saves its other fields', async () => {
    const contact = await ok<{ id: string }>('POST', '/crm/contacts', { ...as(), body: { fullName: 'Old Phone' } });
    await db.query('begin');
    await db.query(`select set_config('app.tenant_id', $1, true)`, [tenant]);
    await db.query(`update contacts set phone = '060 111 222 / 011 333 444 (mobile)' where id = $1`, [contact.id]);
    await db.query('commit');
    expect(await ok('PATCH', `/crm/contacts/${contact.id}`, { ...as(), body: { jobTitle: 'Buyer' } }, 200)).toMatchObject({
      jobTitle: 'Buyer',
      phone: '060 111 222 / 011 333 444 (mobile)',
    });
  });
});

describe('a company without deals', () => {
  it('takes a new contact, and the contact is on no deal', async () => {
    const company = await ok<{ id: string }>('POST', '/crm/companies', { ...as(), body: { pib: testPib(), name: 'Tide d.o.o.' } });
    const contact = await ok<{ id: string; companyId: string | null }>('POST', '/crm/contacts', { ...as(), body: { fullName: 'Nina Tide', companyId: company.id } });
    expect(contact.companyId).toBe(company.id);
    const deals = await ok<{ deal: { id: string; primaryContactId: string | null }; contactIds: string[] }[]>('GET', '/crm/deals', as());
    expect(deals.filter((r) => r.deal.primaryContactId === contact.id || r.contactIds.includes(contact.id))).toEqual([]);
  });
});

describe('details and personal details (CD-361)', () => {
  const asMember = () => ({ token: member.token, tenant });
  const details = { orgUnit: 'Procurement', source: 'Referral', influence: 'Signs off on budgets over 10k', birthday: '1985-04-12', spouseName: 'Marko', children: 'Ana (7)', pets: 'Dog Rex' };

  it("saves them, and a member who doesn't own the contact reads and edits them too", async () => {
    const contact = await ok<{ id: string; ownerUserId: string }>('POST', '/crm/contacts', { ...as(), body: { fullName: 'Petra Personal', ...details } });
    expect(contact).toMatchObject(details);
    expect(contact.ownerUserId).toBe(owner.userId);

    const seen = (await ok<Record<string, unknown>[]>('GET', '/crm/contacts', asMember())).find((c) => c.id === contact.id);
    expect(seen).toMatchObject(details);
    expect(await ok('PATCH', `/crm/contacts/${contact.id}`, { ...asMember(), body: { pets: 'Dog Rex, cat Maza', birthday: '' } }, 200)).toMatchObject({ pets: 'Dog Rex, cat Maza', birthday: null });
  });

  it('a new contact has no role in the decision until one is picked; null clears it again', async () => {
    const contact = await ok<{ id: string; buyerRole: string | null }>('POST', '/crm/contacts', { ...as(), body: { fullName: 'Nora Norole' } });
    expect(contact.buyerRole).toBeNull();
    expect(await ok('PATCH', `/crm/contacts/${contact.id}`, { ...as(), body: { buyerRole: 'Champion' } }, 200)).toMatchObject({ buyerRole: 'Champion' });
    expect(await ok('PATCH', `/crm/contacts/${contact.id}`, { ...as(), body: { buyerRole: null } }, 200)).toMatchObject({ buyerRole: null });
  });

  it('records them in the change history', async () => {
    const contact = await ok<{ id: string }>('POST', '/crm/contacts', { ...as(), body: { fullName: 'Hugo History' } });
    await ok('PATCH', `/crm/contacts/${contact.id}`, { ...as(), body: { orgUnit: 'Finance', spouseName: 'Iva' } }, 200);
    const { entries } = await ok<{ entries: { field: string | null }[] }>('GET', `/crm/history?entityType=contact&entityId=${contact.id}`, as());
    expect(entries.map((e) => e.field)).toEqual(expect.arrayContaining(['orgUnit', 'spouseName']));
  });
});
