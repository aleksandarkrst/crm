/**
 * CD-115: onboarding after the first sign-up. A new user sets up (or joins) a workspace, says who
 * they are and, as the workspace's owner, may invite the team or skip it. Progress is stored per
 * user, so it resumes after a refresh; invitations waiting for the address are offered, so an
 * invited person joins that workspace instead of creating another.
 */
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { call, createTenant, type Json, ok, type Session, signIn } from './helpers';

const onboarding = (s: Session) => ok('GET', '/me/onboarding', { token: s.token });
const steps = (st: Json) => Object.fromEntries(st.steps.map((x: Json) => [x.key, x.done]));

describe('a new user who creates a workspace', () => {
  let owner: Session;
  beforeAll(async () => {
    owner = await signIn('onb-new-owner');
  });

  it('starts with every step ahead, in order, and only inviting the team can be skipped', async () => {
    const me = await ok('GET', '/me', { token: owner.token });
    expect(me.onboarding).toMatchObject({ required: true, completedAt: null, invitations: [] });
    expect(me.onboarding.steps).toEqual([
      { key: 'workspace', done: false, skippable: false },
      { key: 'profile', done: false, skippable: false },
      { key: 'team', done: false, skippable: true },
    ]);
  });

  it('keeps each finished step, so a new session resumes at the next one', async () => {
    const tenant = await ok('POST', '/tenants', { token: owner.token, body: { name: 'Onboarding Co', currency: 'USD', timezone: 'America/New_York' } });
    const workspace = await ok('GET', '/workspace', { token: owner.token, tenant: tenant.id });
    expect(workspace).toMatchObject({ currency: 'USD', timezone: 'America/New_York' });
    expect(steps(await onboarding(owner))).toEqual({ workspace: true, profile: false, team: false });

    expect((await call('PUT', '/me/onboarding/profile', { token: owner.token, body: { name: '  ' } })).status).toBe(400);
    const st = await ok('PUT', '/me/onboarding/profile', { token: owner.token, body: { name: 'Olga Owner', jobTitle: 'Founder' } });
    expect(st).toMatchObject({ required: true });
    expect(steps(st)).toEqual({ workspace: true, profile: true, team: false });
    // Saving it again changes nothing about the progress.
    expect(steps(await ok('PUT', '/me/onboarding/profile', { token: owner.token, body: { name: 'Olga Owner', jobTitle: 'Founder' } }))).toEqual(steps(st));
    expect(steps(await onboarding(owner))).toEqual({ workspace: true, profile: true, team: false });

    const me = await ok('GET', '/me', { token: owner.token });
    expect(me.user.displayName).toBe('Olga Owner');
    const profile = await ok('GET', '/profile', { token: owner.token, tenant: tenant.id });
    expect(profile).toMatchObject({ displayName: 'Olga Owner', jobTitle: 'Founder' });
  });

  it('is complete once the team step is done or skipped, and stays complete', async () => {
    const st = await ok('POST', '/me/onboarding/team', { token: owner.token }, 200);
    expect(st).toMatchObject({ required: false, steps: [] });
    expect(st.completedAt).toBeTruthy();
    expect((await ok('GET', '/me', { token: owner.token })).onboarding.required).toBe(false);
    // A second workspace later doesn't bring onboarding back.
    await createTenant(owner, 'Second workspace');
    expect((await onboarding(owner)).required).toBe(false);
  });
});

describe('an invited user', () => {
  let owner: Session;
  let invitee: Session;
  let stranger: Session;
  let tenant: string;
  let invitationId: string;

  beforeAll(async () => {
    [owner, invitee, stranger] = await Promise.all([signIn('onb-inv-owner'), signIn('onb-invitee'), signIn('onb-stranger')]);
    tenant = await createTenant(owner, 'Inviting Co');
    await ok('POST', '/team/invitations', { token: owner.token, tenant, body: { email: invitee.email, role: 'admin' } });
  });

  it('sees the invitation waiting for their address, and no team step', async () => {
    const st = await onboarding(invitee);
    expect(st.invitations).toHaveLength(1);
    expect(st.invitations[0]).toMatchObject({ tenantName: expect.stringContaining('Inviting Co'), role: 'admin', invitedBy: owner.name });
    expect(st.steps.map((x: Json) => x.key)).toEqual(['workspace', 'profile']);
    invitationId = st.invitations[0].id;
    // Nobody else sees it.
    expect((await onboarding(stranger)).invitations).toEqual([]);
  });

  it("can't be taken by anyone else, even with its id", async () => {
    expect((await call('POST', `/me/invitations/${invitationId}/accept`, { token: stranger.token })).status).toBe(404);
    expect((await call('POST', `/me/invitations/${randomUUID()}/accept`, { token: invitee.token })).status).toBe(404);
    expect((await call('POST', '/me/invitations/not-a-uuid/accept', { token: invitee.token })).status).toBe(400);
    expect((await call('POST', `/me/invitations/${invitationId}/accept`, {})).status).toBe(401);
  });

  it('joins the intended workspace without the link, then finishes with their name', async () => {
    const joined = await ok('POST', `/me/invitations/${invitationId}/accept`, { token: invitee.token }, 200);
    expect(joined).toMatchObject({ id: tenant, role: 'admin' });
    const me = await ok('GET', '/me', { token: invitee.token });
    expect(me.tenants.map((t: Json) => t.id)).toEqual([tenant]);
    expect(me.onboarding.invitations).toEqual([]);
    expect(steps(me.onboarding)).toEqual({ workspace: true, profile: false });
    // The invitation is used up.
    expect((await call('POST', `/me/invitations/${invitationId}/accept`, { token: invitee.token })).status).toBe(410);

    const st = await ok('PUT', '/me/onboarding/profile', { token: invitee.token, body: { name: 'Ivan Invitee' } });
    expect(st.required).toBe(false);
    const team = await ok('GET', '/team', { token: owner.token, tenant });
    expect(team.members.find((m: Json) => m.userId === invitee.userId)).toMatchObject({ displayName: 'Ivan Invitee', role: 'admin' });
  });

  it('offers only invitations that can still be used', async () => {
    const later = await signIn('onb-later');
    const { invitation: { id } } = await ok('POST', '/team/invitations', { token: owner.token, tenant, body: { email: later.email, role: 'member' } });
    expect((await onboarding(later)).invitations).toHaveLength(1);
    await ok('DELETE', `/team/invitations/${id}`, { token: owner.token, tenant });
    expect((await onboarding(later)).invitations).toEqual([]);
    // Without an invitation waiting, the new user is headed for creating a workspace, team step included.
    expect((await onboarding(later)).steps.map((x: Json) => x.key)).toEqual(['workspace', 'profile', 'team']);
  });
});
