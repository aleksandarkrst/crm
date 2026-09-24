/**
 * Custom fields (CD-15): owners and admins define fields per record type, everyone fills values,
 * values are validated against the definition, deleting a field hides it, and nothing crosses
 * workspaces.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { addMember, call, createTenant, firstFunnel, type Json, ok, type Session, signIn } from './helpers';

let owner: Session;
let admin: Session;
let member: Session;
let tenant: string;
let funnelId: string;
const as = (s: Session = owner) => ({ token: s.token, tenant });
const field = (body: Json, s: Session = owner) => ok('POST', '/crm/custom-fields', { ...as(s), body });

beforeAll(async () => {
  owner = await signIn('cf-owner');
  admin = await signIn('cf-admin');
  member = await signIn('cf-member');
  tenant = await createTenant(owner, 'Custom Fields');
  await addMember(owner, tenant, admin, 'admin');
  await addMember(owner, tenant, member, 'member');
  funnelId = (await firstFunnel(owner, tenant)).id;
});

describe('field definitions', () => {
  it('owners and admins create, rename, reorder and delete fields; members only read them', async () => {
    const a = await field({ entity: 'company', label: 'Tier', type: 'select', options: [{ label: 'Gold' }, { label: 'Silver' }] });
    const b = await field({ entity: 'company', label: 'Founded', type: 'number' }, admin);
    expect(a).toMatchObject({ entity: 'company', label: 'Tier', type: 'select', required: false, position: 0 });
    expect(a.options.map((o: Json) => o.label)).toEqual(['Gold', 'Silver']);
    expect(b.position).toBe(1);

    expect((await call('POST', '/crm/custom-fields', { ...as(member), body: { entity: 'company', label: 'Nope', type: 'text' } })).status).toBe(403);
    expect((await call('PATCH', `/crm/custom-fields/${a.id}`, { ...as(member), body: { label: 'Nope' } })).status).toBe(403);
    expect((await call('DELETE', `/crm/custom-fields/${a.id}`, as(member))).status).toBe(403);
    expect((await call('PUT', '/crm/custom-fields/order', { ...as(member), body: { entity: 'company', fieldIds: [b.id, a.id] } })).status).toBe(403);

    const listed = await ok('GET', '/crm/custom-fields?entity=company', as(member));
    expect(listed.map((f: Json) => f.label)).toEqual(['Tier', 'Founded']);

    const reordered = await ok('PUT', '/crm/custom-fields/order', { ...as(), body: { entity: 'company', fieldIds: [b.id, a.id] } });
    expect(reordered.map((f: Json) => f.label)).toEqual(['Founded', 'Tier']);
    expect((await call('PUT', '/crm/custom-fields/order', { ...as(), body: { entity: 'company', fieldIds: [b.id] } })).status).toBe(400);

    await ok('DELETE', `/crm/custom-fields/${b.id}`, as(admin));
    expect((await ok('GET', '/crm/custom-fields?entity=company', as())).map((f: Json) => f.label)).toEqual(['Tier']);
    expect((await call('PATCH', `/crm/custom-fields/${b.id}`, { ...as(), body: { label: 'Back' } })).status).toBe(404);
  });

  it('rejects bad definitions and duplicate names per record type', async () => {
    expect((await call('POST', '/crm/custom-fields', { ...as(), body: { entity: 'deal', label: 'Pick', type: 'select' } })).status).toBe(400);
    expect((await call('POST', '/crm/custom-fields', { ...as(), body: { entity: 'deal', label: 'X', type: 'color' } })).status).toBe(400);
    expect((await call('POST', '/crm/custom-fields', { ...as(), body: { entity: 'lead', label: 'X', type: 'text' } })).status).toBe(400);
    await field({ entity: 'deal', label: 'Region', type: 'text' });
    expect((await call('POST', '/crm/custom-fields', { ...as(), body: { entity: 'deal', label: 'region', type: 'number' } })).status).toBe(409);
    // The same name on another record type is fine.
    await field({ entity: 'contact', label: 'Region', type: 'text' });
  });

  it('a deleted field frees its name', async () => {
    const f = await field({ entity: 'contact', label: 'Temp', type: 'text' });
    await ok('DELETE', `/crm/custom-fields/${f.id}`, as());
    await field({ entity: 'contact', label: 'Temp', type: 'text' });
  });
});

describe('values', () => {
  let text: Json, num: Json, date: Json, pick: Json, check: Json, url: Json;
  beforeAll(async () => {
    text = await field({ entity: 'deal', label: 'PO number', type: 'text' });
    num = await field({ entity: 'deal', label: 'Seats', type: 'number' });
    date = await field({ entity: 'deal', label: 'Renewal', type: 'date' });
    pick = await field({ entity: 'deal', label: 'Priority', type: 'select', options: [{ label: 'High' }, { label: 'Low' }] });
    check = await field({ entity: 'deal', label: 'Signed NDA', type: 'checkbox' });
    url = await field({ entity: 'deal', label: 'Brief', type: 'url' });
  });

  it('stores values of every type, and members can fill them', async () => {
    const high = pick.options[0].id;
    const deal = await ok('POST', '/crm/deals', {
      ...as(),
      body: { title: 'Custom', funnelId, customFields: { [text.id]: ' PO-7 ', [num.id]: '12.5', [date.id]: '2026-12-31', [pick.id]: high, [check.id]: true, [url.id]: 'example.com/brief' } },
    });
    expect(deal.customFields).toEqual({ [text.id]: 'PO-7', [num.id]: 12.5, [date.id]: '2026-12-31', [pick.id]: high, [check.id]: true, [url.id]: 'https://example.com/brief' });

    // A member changes one value; the others are kept. null clears one.
    const updated = await ok('PATCH', `/crm/deals/${deal.id}`, { ...as(member), body: { customFields: { [num.id]: 3, [text.id]: null } } });
    expect(updated.customFields[num.id]).toBe(3);
    expect(updated.customFields).not.toHaveProperty(text.id);
    expect(updated.customFields[pick.id]).toBe(high);
    // Other fields of the deal can be patched without touching the values.
    const renamed = await ok('PATCH', `/crm/deals/${deal.id}`, { ...as(), body: { title: 'Renamed' } });
    expect(renamed.customFields[num.id]).toBe(3);
    // The list returns them too.
    const rows = await ok('GET', '/crm/deals', as());
    expect(rows.find((r: Json) => r.deal.id === deal.id).deal.customFields[date.id]).toBe('2026-12-31');
  });

  it('rejects values that do not fit the field', async () => {
    const deal = await ok('POST', '/crm/deals', { ...as(), body: { title: 'Strict', funnelId } });
    const bad = async (id: string, value: unknown) => (await call('PATCH', `/crm/deals/${deal.id}`, { ...as(), body: { customFields: { [id]: value } } })).status;
    expect(await bad(num.id, 'twelve')).toBe(400);
    expect(await bad(date.id, '31.12.2026')).toBe(400);
    expect(await bad(date.id, '2026-02-30')).toBe(400);
    expect(await bad(pick.id, 'Medium')).toBe(400);
    expect(await bad(check.id, 'yes')).toBe(400);
    expect(await bad(url.id, 'not a url')).toBe(400);
    expect(await bad(url.id, 'javascript:alert(1)')).toBe(400);
    expect(await bad(text.id, 42)).toBe(400);
    expect(await bad('00000000-0000-4000-8000-000000000000', 'x')).toBe(400);
    // A select value can also be given by the option's label.
    const byLabel = await ok('PATCH', `/crm/deals/${deal.id}`, { ...as(), body: { customFields: { [pick.id]: 'low' } } });
    expect(byLabel.customFields[pick.id]).toBe(pick.options[1].id);
  });

  it('a required field must be filled in a create form and cannot be cleared', async () => {
    const req = await field({ entity: 'contact', label: 'Language', type: 'text', required: true });
    // A create that sends custom fields (a form) must include it.
    const missing = await call('POST', '/crm/contacts', { ...as(), body: { fullName: 'No Lang', customFields: {} } });
    expect(missing.status).toBe(400);
    expect(JSON.stringify(missing.body)).toContain('Language is required');
    const c = await ok('POST', '/crm/contacts', { ...as(), body: { fullName: 'Lang', customFields: { [req.id]: 'Serbian' } } });
    expect((await call('PATCH', `/crm/contacts/${c.id}`, { ...as(), body: { customFields: { [req.id]: '' } } })).status).toBe(400);
    // Creates that don't send custom fields (quick add, the CSV import) still work.
    await ok('POST', '/crm/contacts', { ...as(), body: { fullName: 'Quick add' } });
    await ok('PATCH', `/crm/custom-fields/${req.id}`, { ...as(), body: { required: false } });
  });

  it('renaming a field or an option keeps the values; a used option cannot be removed', async () => {
    const co = await ok('POST', '/crm/companies', { ...as(), body: { name: 'Keeper' } });
    const tier = await field({ entity: 'company', label: 'Segment', type: 'select', options: [{ label: 'A' }, { label: 'B' }] });
    const [a, b] = tier.options;
    await ok('PATCH', `/crm/companies/${co.id}`, { ...as(), body: { customFields: { [tier.id]: a.id } } });
    const renamed = await ok('PATCH', `/crm/custom-fields/${tier.id}`, { ...as(), body: { label: 'Customer segment', options: [{ id: a.id, label: 'Enterprise' }, { id: b.id, label: 'B' }] } });
    expect(renamed.label).toBe('Customer segment');
    expect((await ok('GET', `/crm/companies/${co.id}`, as())).customFields[tier.id]).toBe(a.id);
    const refused = await call('PATCH', `/crm/custom-fields/${tier.id}`, { ...as(), body: { options: [{ id: b.id, label: 'B' }] } });
    expect(refused.status).toBe(409);
    expect(JSON.stringify(refused.body)).toContain('Enterprise');
    // An unused option can go, and new ones get ids.
    const trimmed = await ok('PATCH', `/crm/custom-fields/${tier.id}`, { ...as(), body: { options: [{ id: a.id, label: 'Enterprise' }, { label: 'SMB' }] } });
    expect(trimmed.options).toHaveLength(2);
    expect(trimmed.options[1].id).toMatch(/^[0-9a-f-]{36}$/);
    // The type can't change (the only key sent is unknown, so there is nothing to update).
    expect((await call('PATCH', `/crm/custom-fields/${tier.id}`, { ...as(), body: { type: 'text' } })).status).toBe(400);
  });

  it('a deleted field keeps its values hidden in the record but no longer accepts writes', async () => {
    const f = await field({ entity: 'company', label: 'Legacy id', type: 'text' });
    const co = await ok('POST', '/crm/companies', { ...as(), body: { name: 'Legacy', customFields: { [f.id]: 'L-1' } } });
    await ok('DELETE', `/crm/custom-fields/${f.id}`, as());
    expect((await call('PATCH', `/crm/companies/${co.id}`, { ...as(), body: { customFields: { [f.id]: 'L-2' } } })).status).toBe(400);
    expect((await ok('GET', `/crm/companies/${co.id}`, as())).customFields[f.id]).toBe('L-1');
  });
});

describe('tenant isolation', () => {
  it("another workspace sees none of the fields and can't write them", async () => {
    const other = await signIn('cf-other');
    const otherTenant = await createTenant(other, 'Other Fields');
    const mine = await field({ entity: 'deal', label: 'Secret', type: 'text' });
    expect(await ok('GET', '/crm/custom-fields', { token: other.token, tenant: otherTenant })).toEqual([]);
    expect((await call('PATCH', `/crm/custom-fields/${mine.id}`, { token: other.token, tenant: otherTenant, body: { label: 'Mine now' } })).status).toBe(404);
    expect((await call('DELETE', `/crm/custom-fields/${mine.id}`, { token: other.token, tenant: otherTenant })).status).toBe(404);
    const theirFunnel = (await firstFunnel(other, otherTenant)).id;
    const res = await call('POST', '/crm/deals', { token: other.token, tenant: otherTenant, body: { title: 'Sneaky', funnelId: theirFunnel, customFields: { [mine.id]: 'x' } } });
    expect(res.status).toBe(400);
    // Non-members get 403.
    expect((await call('GET', '/crm/custom-fields', { token: other.token, tenant })).status).toBe(403);
  });
});
