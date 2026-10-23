/**
 * Contacts (CD-464): a phone is checked by the API (a letter-filled "abc123!!" is refused), and a
 * contact can belong to a company that has no deals, linked to none.
 */
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { call, createTenant, ok, type Session, signIn, testPib } from './helpers';

let owner: Session;
let tenant: string;
let db: Client;
const as = () => ({ token: owner.token, tenant });

beforeAll(async () => {
  owner = await signIn('contacts-owner');
  tenant = await createTenant(owner, 'Contacts');
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
