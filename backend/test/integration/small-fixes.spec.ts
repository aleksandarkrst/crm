/**
 * CD-76: contact notes are saved, and a deleted funnel stops being anyone's default funnel.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { addMember, createTenant, type Funnel, ok, type Session, signIn } from './helpers';

let owner: Session;
let member: Session;
let tenant: string;
const as = (s: Session = owner) => ({ token: s.token, tenant });

beforeAll(async () => {
  [owner, member] = await Promise.all([signIn('fixes-owner'), signIn('fixes-member')]);
  tenant = await createTenant(owner, 'Small fixes');
  await addMember(owner, tenant, member, 'member');
});

describe('contact notes', () => {
  it('are saved on create, changed, cleared, and listed', async () => {
    const c = await ok('POST', '/crm/contacts', { ...as(), body: { fullName: 'Noted Person', notes: 'Signs off anything above 5k' } });
    expect(c.notes).toBe('Signs off anything above 5k');
    expect((await ok('PATCH', `/crm/contacts/${c.id}`, { ...as(member), body: { notes: 'Prefers calls' } })).notes).toBe('Prefers calls');
    const listed = (await ok('GET', '/crm/contacts?limit=200', as())).find((x: { id: string }) => x.id === c.id);
    expect(listed.notes).toBe('Prefers calls');
    expect((await ok('PATCH', `/crm/contacts/${c.id}`, { ...as(), body: { notes: '' } })).notes).toBeNull();
  });
});

describe('default funnel', () => {
  it('is cleared for every member when its funnel is deleted', async () => {
    const funnel = await ok<Funnel>('POST', '/crm/funnels', { ...as(), body: { label: 'Short-lived' } });
    for (const s of [owner, member]) await ok('PATCH', '/profile', { ...as(s), body: { defaultFunnelId: funnel.id } });
    const kept = (await ok<Funnel[]>('GET', '/crm/funnels', as()))[0]!;
    expect(kept.id).not.toBe(funnel.id);

    await ok('DELETE', `/crm/funnels/${funnel.id}`, as());
    for (const s of [owner, member]) expect((await ok('GET', '/profile', as(s))).defaultFunnelId).toBeNull();

    // A default funnel that still exists is left alone.
    await ok('PATCH', '/profile', { ...as(member), body: { defaultFunnelId: kept.id } });
    const other = await ok<Funnel>('POST', '/crm/funnels', { ...as(), body: { label: 'Another' } });
    await ok('DELETE', `/crm/funnels/${other.id}`, as());
    expect((await ok('GET', '/profile', as(member))).defaultFunnelId).toBe(kept.id);
  });
});
