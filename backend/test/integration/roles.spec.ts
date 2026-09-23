/**
 * Role rules enforced by the guard (@RequireTenant) and TeamService: members vs admins on delete
 * endpoints and team management, what admins can't do to owners, and last-owner protection.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { addMember, call, createTenant, firstFunnel, type Funnel, ok, type Session, signIn } from './helpers';

let owner: Session;
let admin: Session;
let member: Session;
let tenant: string;
let funnel: Funnel;
const as = (s: Session) => ({ token: s.token, tenant });

beforeAll(async () => {
  [owner, admin, member] = await Promise.all([signIn('roles-owner'), signIn('roles-admin'), signIn('roles-member')]);
  tenant = await createTenant(owner, 'Roles');
  await addMember(owner, tenant, admin, 'admin');
  await addMember(owner, tenant, member, 'member');
  funnel = await firstFunnel(owner, tenant);
});

/** Fresh rows to try deleting. */
async function makeRows(by: Session) {
  const company = await ok('POST', '/crm/companies', { ...as(by), body: { name: 'Doomed Co' } });
  const contact = await ok('POST', '/crm/contacts', { ...as(by), body: { fullName: 'Doomed Person' } });
  const product = await ok('POST', '/crm/products', { ...as(by), body: { name: 'Doomed Product' } });
  const deal = await ok('POST', '/crm/deals', { ...as(by), body: { title: 'Doomed Deal', funnelId: funnel.id } });
  return {
    deal: `/crm/deals/${deal.id}`,
    company: `/crm/companies/${company.id}`,
    contact: `/crm/contacts/${contact.id}`,
    product: `/crm/products/${product.id}`,
  };
}

describe('authentication and membership', () => {
  it('requires a bearer token', async () => {
    expect((await call('GET', '/me')).status).toBe(401);
    expect((await call('GET', '/crm/deals', { tenant })).status).toBe(401);
    expect((await call('GET', '/crm/deals', { token: 'not-a-token', tenant })).status).toBe(401);
  });

  it('requires a valid X-Tenant-Id the user belongs to', async () => {
    const outsider = await signIn('roles-outsider');
    expect((await call('GET', '/crm/deals', { token: owner.token })).status).toBe(403);
    expect((await call('GET', '/crm/deals', { token: owner.token, tenant: 'nope' })).status).toBe(403);
    expect((await call('GET', '/crm/deals', { token: outsider.token, tenant })).status).toBe(403);
  });
});

describe('members', () => {
  it('can work with deals, companies, contacts and products', async () => {
    const rows = await makeRows(member);
    const edits: [string, object][] = [
      [rows.deal, { title: 'Renamed deal' }],
      [rows.company, { name: 'Renamed Co' }],
      [rows.contact, { fullName: 'Renamed Person' }],
      [rows.product, { name: 'Renamed Product' }],
    ];
    for (const [path, body] of edits) expect((await call('PATCH', path, { ...as(member), body })).status, path).toBe(200);
    expect((await call('GET', '/team', as(member))).status).toBe(200);
  });

  it("can't delete deals, companies, contacts or products", async () => {
    const rows = await makeRows(owner);
    for (const path of Object.values(rows)) {
      expect((await call('DELETE', path, as(member))).status, path).toBe(403);
    }
    // Still there.
    expect((await call('GET', rows.deal, as(owner))).status).toBe(200);
    expect((await call('GET', rows.company, as(owner))).status).toBe(200);
  });

  it("can't edit the funnel playbook", async () => {
    const stage = funnel.stages[0]!;
    expect((await call('PATCH', `/crm/funnels/${funnel.id}/stages/${stage.id}`, { ...as(member), body: { activity: 'Changed' } })).status).toBe(403);
  });

  it("can't manage the team", async () => {
    const invite = await ok('POST', '/team/invitations', { ...as(owner), body: { email: `pending-${Date.now()}@example.test` } });
    expect((await call('POST', '/team/invitations', { ...as(member), body: { email: 'someone@example.test' } })).status).toBe(403);
    expect((await call('DELETE', `/team/invitations/${invite.invitation.id}`, as(member))).status).toBe(403);
    expect((await call('PATCH', `/team/members/${admin.userId}`, { ...as(member), body: { role: 'member' } })).status).toBe(403);
    expect((await call('PATCH', `/team/members/${member.userId}`, { ...as(member), body: { role: 'admin' } })).status).toBe(403);
    expect((await call('DELETE', `/team/members/${admin.userId}`, as(member))).status).toBe(403);
    const team = await ok('GET', '/team', as(owner));
    expect(team.members.find((m: { userId: string }) => m.userId === member.userId).role).toBe('member');
    expect(team.members.find((m: { userId: string }) => m.userId === admin.userId).role).toBe('admin');
  });
});

describe('admins', () => {
  it('can delete deals, companies, contacts and products', async () => {
    const rows = await makeRows(member);
    for (const path of Object.values(rows)) expect((await call('DELETE', path, as(admin))).status, path).toBe(204);
    for (const path of [rows.deal, rows.company, rows.contact]) expect((await call('GET', path, as(admin))).status, path).toBe(404);
    const products = await ok('GET', '/crm/products', as(admin));
    expect(products.map((p: { id: string }) => `/crm/products/${p.id}`)).not.toContain(rows.product);
  });

  it('can edit the funnel playbook', async () => {
    const stage = funnel.stages[0]!;
    const updated = await ok('PATCH', `/crm/funnels/${funnel.id}/stages/${stage.id}`, { ...as(admin), body: { activity: 'Call within a day' } });
    expect(updated.activity).toBe('Call within a day');
  });

  it('can invite and change the roles of non-owners', async () => {
    expect((await call('POST', '/team/invitations', { ...as(admin), body: { email: `admin-invite-${Date.now()}@example.test`, role: 'admin' } })).status).toBe(201);
    expect(await ok('PATCH', `/team/members/${member.userId}`, { ...as(admin), body: { role: 'admin' } })).toEqual({ userId: member.userId, role: 'admin' });
    expect(await ok('PATCH', `/team/members/${member.userId}`, { ...as(admin), body: { role: 'member' } })).toEqual({ userId: member.userId, role: 'member' });
  });

  it("can't invite owners, make owners, demote or remove an owner", async () => {
    // Invitations can only grant admin or member.
    expect((await call('POST', '/team/invitations', { ...as(admin), body: { email: 'x@example.test', role: 'owner' } })).status).toBe(400);
    expect((await call('PATCH', `/team/members/${member.userId}`, { ...as(admin), body: { role: 'owner' } })).status).toBe(403);
    expect((await call('PATCH', `/team/members/${admin.userId}`, { ...as(admin), body: { role: 'owner' } })).status).toBe(403);
    expect((await call('PATCH', `/team/members/${owner.userId}`, { ...as(admin), body: { role: 'admin' } })).status).toBe(403);
    expect((await call('DELETE', `/team/members/${owner.userId}`, as(admin))).status).toBe(403);
    const team = await ok('GET', '/team', as(owner));
    expect(team.members.find((m: { userId: string }) => m.userId === owner.userId).role).toBe('owner');
  });

  it('get 404 for someone who is not a member', async () => {
    const stranger = await signIn('roles-stranger');
    expect((await call('PATCH', `/team/members/${stranger.userId}`, { ...as(admin), body: { role: 'admin' } })).status).toBe(404);
    expect((await call('DELETE', `/team/members/${stranger.userId}`, as(admin))).status).toBe(404);
  });
});

describe('owners', () => {
  it('keep at least one owner: the only owner can neither step down nor leave', async () => {
    expect((await call('PATCH', `/team/members/${owner.userId}`, { ...as(owner), body: { role: 'admin' } })).status).toBe(409);
    expect((await call('DELETE', `/team/members/${owner.userId}`, as(owner))).status).toBe(409);
    expect((await ok('GET', '/me', { token: owner.token })).tenants.map((t: { id: string }) => t.id)).toContain(tenant);
  });

  it('can hand over ownership, after which the old owner may leave', async () => {
    const [second, successor] = await Promise.all([signIn('roles-second'), signIn('roles-successor')]);
    const t = await createTenant(owner, 'Handover');
    await addMember(owner, t, second, 'admin');
    await addMember(owner, t, successor, 'member');

    // Two owners: either may step down.
    await ok('PATCH', `/team/members/${second.userId}`, { token: owner.token, tenant: t, body: { role: 'owner' } });
    await ok('PATCH', `/team/members/${second.userId}`, { token: second.token, tenant: t, body: { role: 'admin' } });
    // Back to one owner, who can't step down.
    expect((await call('PATCH', `/team/members/${owner.userId}`, { token: owner.token, tenant: t, body: { role: 'member' } })).status).toBe(409);

    await ok('PATCH', `/team/members/${successor.userId}`, { token: owner.token, tenant: t, body: { role: 'owner' } });
    await ok('DELETE', `/team/members/${owner.userId}`, { token: owner.token, tenant: t });
    expect((await ok('GET', '/me', { token: owner.token })).tenants.map((x: { id: string }) => x.id)).not.toContain(t);
    expect((await call('GET', '/crm/deals', { token: owner.token, tenant: t })).status).toBe(403);

    // The successor is now the only owner and is protected the same way.
    expect((await call('DELETE', `/team/members/${successor.userId}`, { token: successor.token, tenant: t })).status).toBe(409);
    // An owner can remove another owner-less member (the admin).
    await ok('DELETE', `/team/members/${second.userId}`, { token: successor.token, tenant: t });
    const team = await ok('GET', '/team', { token: successor.token, tenant: t });
    expect(team.members.map((m: { userId: string; role: string }) => [m.userId, m.role])).toEqual([[successor.userId, 'owner']]);
  });
});

describe('leaving', () => {
  it('any member may remove themselves', async () => {
    const leaver = await signIn('roles-leaver');
    await addMember(owner, tenant, leaver, 'member');
    await ok('DELETE', `/team/members/${leaver.userId}`, as(leaver));
    expect((await ok('GET', '/me', { token: leaver.token })).tenants).toEqual([]);
    expect((await call('GET', '/crm/deals', as(leaver))).status).toBe(403);
  });
});
