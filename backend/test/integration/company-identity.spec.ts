/**
 * Company identity (CD-357): the PIB is the company's ID. It is required and checked by the API,
 * unique in a workspace (a 409 that names the existing company), free across workspaces, and once
 * set it can be changed but never cleared. The other identity fields are checked too, recorded in
 * the company's history and searchable by PIB.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { call, createTenant, type Json, ok, type Session, signIn, testPibs } from './helpers';

let owner: Session;
let outsider: Session;
let tenant: string;
let otherTenant: string;
const as = (s: Session = owner, t = tenant) => ({ token: s.token, tenant: t });

beforeAll(async () => {
  owner = await signIn('ident-owner');
  outsider = await signIn('ident-outsider');
  tenant = await createTenant(owner, 'Identity');
  otherTenant = await createTenant(outsider, 'Identity elsewhere');
});

describe('creating a company', () => {
  it('needs a PIB with a valid check digit (400 without one or with a bad one)', async () => {
    const missing = await call('POST', '/crm/companies', { ...as(), body: { name: 'No PIB d.o.o.' } });
    expect(missing.status).toBe(400);
    expect(JSON.stringify(missing.body)).toContain('PIB is required');
    const bad = await call('POST', '/crm/companies', { ...as(), body: { name: 'Bad PIB d.o.o.', pib: '104052136' } });
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.body)).toContain('PIB is 9 digits with a valid check digit');
    expect((await call('POST', '/crm/companies', { ...as(), body: { name: 'Short PIB d.o.o.', pib: '10405213' } })).status).toBe(400);
  });

  it('checks MB, activity code and ownership, and saves every identity field', async () => {
    const [pib] = testPibs(1);
    expect((await call('POST', '/crm/companies', { ...as(), body: { name: 'Bad MB', pib, mb: '20084694' } })).status).toBe(400);
    expect((await call('POST', '/crm/companies', { ...as(), body: { name: 'Bad code', pib, activityCode: '62' } })).status).toBe(400);
    expect((await call('POST', '/crm/companies', { ...as(), body: { name: 'Bad ownership', pib, ownershipType: 'mixed' } })).status).toBe(400);
    const co = await ok('POST', '/crm/companies', {
      ...as(),
      body: { name: 'Vega Logistika d.o.o.', pib, mb: '20084693', activityCode: '4941', ownershipType: 'private', address: 'Bulevar 10', city: 'Novi Sad', postalCode: '21000' },
    });
    expect(co).toMatchObject({ pib, mb: '20084693', activityCode: '4941', ownershipType: 'private', address: 'Bulevar 10', city: 'Novi Sad', postalCode: '21000' });
  });

  it('refuses a PIB the workspace already has (409 naming the company); another workspace may use it', async () => {
    const [pib] = testPibs(1);
    const first = await ok('POST', '/crm/companies', { ...as(), body: { name: 'Original d.o.o.', pib } });
    const dup = await call<Json>('POST', '/crm/companies', { ...as(), body: { name: 'Copy d.o.o.', pib } });
    expect(dup.status).toBe(409);
    expect(dup.body).toMatchObject({ message: 'A company with this PIB already exists: Original d.o.o.', existingCompanyId: first.id });
    await ok('POST', '/crm/companies', { ...as(outsider, otherTenant), body: { name: 'Same firm elsewhere', pib } });
  });
});

describe('changing a company', () => {
  it('may change the PIB but never clear it, nor take one another company has', async () => {
    const [mine, theirs, next] = testPibs(3);
    const co = await ok('POST', '/crm/companies', { ...as(), body: { name: 'Changer d.o.o.', pib: mine } });
    const other = await ok('POST', '/crm/companies', { ...as(), body: { name: 'Holder d.o.o.', pib: theirs } });
    expect((await call('PATCH', `/crm/companies/${co.id}`, { ...as(), body: { pib: null } })).status).toBe(400);
    expect((await call('PATCH', `/crm/companies/${co.id}`, { ...as(), body: { pib: '' } })).status).toBe(400);
    const taken = await call<Json>('PATCH', `/crm/companies/${co.id}`, { ...as(), body: { pib: theirs } });
    expect(taken.status).toBe(409);
    expect(taken.body).toMatchObject({ existingCompanyId: other.id });
    // Its own PIB again is fine (not a conflict with itself), and so is a new one.
    await ok('PATCH', `/crm/companies/${co.id}`, { ...as(), body: { pib: mine, city: 'Niš' } });
    expect(await ok('PATCH', `/crm/companies/${co.id}`, { ...as(), body: { pib: next } })).toMatchObject({ pib: next, city: 'Niš' });
    // Clearing an optional identity field is allowed.
    expect(await ok('PATCH', `/crm/companies/${co.id}`, { ...as(), body: { city: '' } })).toMatchObject({ city: null });
  });

  it('records identity changes in the history and finds the company by PIB', async () => {
    const [pib, next] = testPibs(2);
    const co = await ok('POST', '/crm/companies', { ...as(), body: { name: 'Historian d.o.o.', pib } });
    await ok('PATCH', `/crm/companies/${co.id}`, { ...as(), body: { pib: next, activityCode: '6201' } });
    const history = await ok<Json>('GET', `/crm/history?entityType=company&entityId=${co.id}`, as());
    const fields = JSON.stringify(history);
    expect(fields).toContain('"pib"');
    expect(fields).toContain('"activityCode"');
    const found = await ok<Json[]>('GET', `/crm/companies?q=${next}`, as());
    expect(found.map((c) => c.id)).toEqual([co.id]);
  });
});
