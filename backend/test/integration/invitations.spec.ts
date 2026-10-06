/**
 * Invitations: only the invited email can accept, a link works once, withdrawn and replaced
 * invitations stop working, and one tenant can't touch another tenant's invitations.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { call, createTenant, ok, type Session, signIn } from './helpers';

let owner: Session;
let tenant: string;
const as = () => ({ token: owner.token, tenant });

async function invite(email: string, role: 'admin' | 'member' = 'member') {
  return ok<{ token: string; invitation: { id: string; email: string; role: string } }>('POST', '/team/invitations', { ...as(), body: { email, role } });
}
const pendingIds = async () => (await ok('GET', '/team', as())).invitations.map((i: { id: string }) => i.id);

beforeAll(async () => {
  owner = await signIn('inv-owner');
  tenant = await createTenant(owner, 'Invites');
});

describe('accepting', () => {
  it('shows what the link is for, then lets only the invited email join, once', async () => {
    const [invitee, other] = await Promise.all([signIn('inv-invitee'), signIn('inv-other')]);
    const { token, invitation } = await invite(invitee.email, 'admin');
    expect(invitation).toMatchObject({ email: invitee.email, role: 'admin' });
    expect(await pendingIds()).toContain(invitation.id);

    const preview = await ok('GET', `/invitations/${token}`, { token: other.token });
    expect(preview).toMatchObject({ email: invitee.email, role: 'admin', invitedBy: owner.name });
    expect(preview.tenantName).toMatch(/^Invites /);

    // Someone else holding the link can't use it, and that doesn't burn the invitation.
    expect((await call('POST', `/invitations/${token}/accept`, { token: other.token })).status).toBe(403);
    expect((await ok('GET', '/me', { token: other.token })).tenants).toEqual([]);
    expect(await pendingIds()).toContain(invitation.id);

    const joined = await ok('POST', `/invitations/${token}/accept`, { token: invitee.token }, 200);
    expect(joined).toMatchObject({ id: tenant, role: 'admin' });
    expect((await ok('GET', '/me', { token: invitee.token })).tenants.map((t: { id: string; role: string }) => [t.id, t.role])).toEqual([[tenant, 'admin']]);
    // The workspace list counts the members, the new one included (the sidebar switcher, CD-214).
    expect((await ok('GET', '/me', { token: invitee.token })).tenants[0].memberCount).toBe(2);
    expect((await call('GET', '/crm/deals', { token: invitee.token, tenant })).status).toBe(200);

    // Single use.
    expect((await call('POST', `/invitations/${token}/accept`, { token: invitee.token })).status).toBe(410);
    expect((await call('GET', `/invitations/${token}`, { token: invitee.token })).status).toBe(410);
    expect(await pendingIds()).not.toContain(invitation.id);
    const team = await ok('GET', '/team', as());
    expect(team.members.find((m: { userId: string }) => m.userId === invitee.userId)?.role).toBe('admin');
  });

  it('matches the email case-insensitively', async () => {
    const invitee = await signIn('inv-case');
    const { token, invitation } = await invite(invitee.email.toUpperCase());
    expect(invitation.email).toBe(invitee.email);
    expect((await call('POST', `/invitations/${token}/accept`, { token: invitee.token })).status).toBe(200);
  });

  it('requires signing in', async () => {
    const { token } = await invite(`anon-${Date.now()}@example.test`);
    expect((await call('GET', `/invitations/${token}`)).status).toBe(401);
    expect((await call('POST', `/invitations/${token}/accept`)).status).toBe(401);
  });

  it('rejects malformed and unknown tokens', async () => {
    expect((await call('POST', '/invitations/short/accept', { token: owner.token })).status).toBe(400);
    expect((await call('POST', `/invitations/${'x'.repeat(43)}/accept`, { token: owner.token })).status).toBe(404);
  });

  it("won't invite someone who is already a member", async () => {
    expect((await call('POST', '/team/invitations', { ...as(), body: { email: owner.email } })).status).toBe(409);
  });
});

describe('functional roles on the invitation (CD-224)', () => {
  it("gives the ticked Administration and Payroll roles to the new member's employee record on acceptance", async () => {
    const invitee = await signIn('inv-roles');
    const { token, invitation } = await ok('POST', '/team/invitations', { ...as(), body: { email: invitee.email, role: 'member', roles: ['administration', 'payroll'] } });
    expect(invitation.assignedRoles).toEqual(['administration', 'payroll']);
    expect((await ok('GET', '/team', as())).invitations.find((i: { id: string }) => i.id === invitation.id).assignedRoles).toEqual(['administration', 'payroll']);

    await ok('POST', `/invitations/${token}/accept`, { token: invitee.token }, 200);
    const access = await ok('GET', '/people/access', { token: invitee.token, tenant });
    expect(access.roles).toEqual(expect.arrayContaining(['administration', 'payroll']));
    // The employee history says the inviting owner gave the roles.
    const history = await ok('GET', `/people/history?entityType=employee&entityId=${access.employeeId}`, as());
    const change = history.entries.find((e: { field: string | null }) => e.field === 'roles');
    expect(change).toMatchObject({ newValue: ['administration', 'payroll'] });
    expect(change.actor?.userId).toBe(owner.userId);
  });

  it('an invitation without roles gives none, and unknown roles are refused', async () => {
    const invitee = await signIn('inv-noroles');
    const { token } = await invite(invitee.email);
    await ok('POST', `/invitations/${token}/accept`, { token: invitee.token }, 200);
    const access = await ok('GET', '/people/access', { token: invitee.token, tenant });
    expect(access.roles).not.toContain('administration');
    expect(access.roles).not.toContain('payroll');
    expect((await call('POST', '/team/invitations', { ...as(), body: { email: `bad-role-${Date.now()}@example.test`, roles: ['admin'] } })).status).toBe(400);
  });
});

describe('withdrawing and replacing', () => {
  it('a withdrawn invitation can no longer be accepted', async () => {
    const invitee = await signIn('inv-revoked');
    const { token, invitation } = await invite(invitee.email);
    await ok('DELETE', `/team/invitations/${invitation.id}`, as());
    expect(await pendingIds()).not.toContain(invitation.id);
    expect((await call('POST', `/invitations/${token}/accept`, { token: invitee.token })).status).toBe(410);
    expect((await ok('GET', '/me', { token: invitee.token })).tenants).toEqual([]);
    // Already withdrawn.
    expect((await call('DELETE', `/team/invitations/${invitation.id}`, as())).status).toBe(404);
  });

  it('an accepted invitation can no longer be withdrawn', async () => {
    const invitee = await signIn('inv-accepted');
    const { token, invitation } = await invite(invitee.email);
    await ok('POST', `/invitations/${token}/accept`, { token: invitee.token }, 200);
    expect((await call('DELETE', `/team/invitations/${invitation.id}`, as())).status).toBe(404);
  });

  it('inviting the same email again replaces the pending invitation', async () => {
    const invitee = await signIn('inv-again');
    const first = await invite(invitee.email);
    const second = await invite(invitee.email, 'admin');
    const pending = await pendingIds();
    expect(pending).not.toContain(first.invitation.id);
    expect(pending).toContain(second.invitation.id);
    expect((await call('POST', `/invitations/${first.token}/accept`, { token: invitee.token })).status).toBe(410);
    expect(await ok('POST', `/invitations/${second.token}/accept`, { token: invitee.token }, 200)).toMatchObject({ role: 'admin' });
  });

  it("another tenant can't see or withdraw this tenant's invitations", async () => {
    const other = await signIn('inv-othertenant');
    const otherTenant = await createTenant(other, 'Elsewhere');
    const { invitation } = await invite(`kept-${Date.now()}@example.test`);
    expect((await ok('GET', '/team', { token: other.token, tenant: otherTenant })).invitations).toEqual([]);
    expect((await call('DELETE', `/team/invitations/${invitation.id}`, { token: other.token, tenant: otherTenant })).status).toBe(404);
    expect((await call('DELETE', `/team/invitations/${invitation.id}`, { token: other.token, tenant })).status).toBe(403);
    expect(await pendingIds()).toContain(invitation.id);
  });
});
