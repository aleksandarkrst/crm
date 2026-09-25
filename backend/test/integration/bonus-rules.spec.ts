/** Sales bonus rules (CD-17): stored per salesperson, owners and admins only (members get 403). */
import { beforeAll, describe, expect, it } from 'vitest';
import { addMember, call, createTenant, ok, type Session, signIn } from './helpers';

let owner: Session;
let admin: Session;
let member: Session;
let tenant: string;
const as = (s: Session = owner) => ({ token: s.token, tenant });

beforeAll(async () => {
  owner = await signIn('bonus-owner');
  admin = await signIn('bonus-admin');
  member = await signIn('bonus-member');
  tenant = await createTenant(owner, 'Bonuses');
  await addMember(owner, tenant, admin, 'admin');
  await addMember(owner, tenant, member, 'member');
});

describe('sales bonus rules', () => {
  it('start empty, with the default trigger', async () => {
    expect(await ok('GET', '/crm/bonus-rules', as())).toEqual({ trigger: 'On contract signed', rules: [] });
  });

  it('owners and admins set, read and remove rules; they are stored', async () => {
    const after = await ok('PUT', `/crm/bonus-rules/${member.userId}`, { ...as(admin), body: { rate: 5, floor: '10000', fixed: 250 } }, 200);
    expect(after.rules).toEqual([expect.objectContaining({ userId: member.userId, rate: '5.00', floor: '10000.00', fixed: '250.00' })]);
    await ok('PUT', `/crm/bonus-rules/${member.userId}`, { ...as(), body: { rate: 7.5, floor: 0, fixed: '' } }, 200);
    await ok('PATCH', '/crm/bonus-rules', { ...as(), body: { trigger: 'When fully billed' } });
    const read = await ok('GET', '/crm/bonus-rules', as(admin));
    expect(read.trigger).toBe('When fully billed');
    expect(read.rules).toEqual([expect.objectContaining({ userId: member.userId, rate: '7.50', floor: '0.00', fixed: '0.00' })]);
    await ok('DELETE', `/crm/bonus-rules/${member.userId}`, as());
    expect((await ok('GET', '/crm/bonus-rules', as())).rules).toEqual([]);
  });

  it('members get 403 for reading and changing them', async () => {
    await ok('PUT', `/crm/bonus-rules/${owner.userId}`, { ...as(), body: { rate: 3, floor: 0, fixed: 0 } }, 200);
    expect((await call('GET', '/crm/bonus-rules', as(member))).status).toBe(403);
    expect((await call('PATCH', '/crm/bonus-rules', { ...as(member), body: { trigger: 'On contract signed' } })).status).toBe(403);
    expect((await call('PUT', `/crm/bonus-rules/${member.userId}`, { ...as(member), body: { rate: 99, floor: 0, fixed: 0 } })).status).toBe(403);
    expect((await call('DELETE', `/crm/bonus-rules/${owner.userId}`, as(member))).status).toBe(403);
    // The workspace settings members can read carry no bonus data.
    const ws = await ok('GET', '/workspace', as(member));
    for (const k of ['trigger', 'rules', 'rate', 'bonusTrigger']) expect(ws).not.toHaveProperty(k);
  });

  it('rejects bad values and people outside the workspace', async () => {
    expect((await call('PUT', `/crm/bonus-rules/${member.userId}`, { ...as(), body: { rate: 101, floor: 0, fixed: 0 } })).status).toBe(400);
    expect((await call('PUT', `/crm/bonus-rules/${member.userId}`, { ...as(), body: { rate: -1, floor: 0, fixed: 0 } })).status).toBe(400);
    expect((await call('PATCH', '/crm/bonus-rules', { ...as(), body: { trigger: 'Whenever' } })).status).toBe(400);
    const stranger = await signIn('bonus-stranger');
    expect((await call('PUT', `/crm/bonus-rules/${stranger.userId}`, { ...as(), body: { rate: 1, floor: 0, fixed: 0 } })).status).toBe(400);
  });

  it('are isolated per workspace', async () => {
    const other = await signIn('bonus-other');
    const otherTenant = await createTenant(other, 'Other Bonuses');
    expect(await ok('GET', '/crm/bonus-rules', { token: other.token, tenant: otherTenant })).toEqual({ trigger: 'On contract signed', rules: [] });
    expect((await call('GET', '/crm/bonus-rules', { token: other.token, tenant })).status).toBe(403);
  });
});
