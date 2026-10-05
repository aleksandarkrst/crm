/**
 * Workspace settings (GET/PATCH /workspace), the user's own profile (GET/PATCH /profile) and the
 * deal's discovery fields: role rules, validation, tenant isolation and "only your own profile".
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { addMember, call, createTenant, firstFunnel, type Funnel, ok, type Session, signIn } from './helpers';

let owner: Session;
let admin: Session;
let member: Session;
let outsider: Session; // owner of another tenant
let tenant: string;
let otherTenant: string;
let funnel: Funnel;
let otherFunnel: Funnel;

beforeAll(async () => {
  [owner, admin, member, outsider] = await Promise.all([signIn('settings-owner'), signIn('settings-admin'), signIn('settings-member'), signIn('settings-outsider')]);
  tenant = await createTenant(owner, 'Settings');
  otherTenant = await createTenant(outsider, 'Other Settings');
  await addMember(owner, tenant, admin, 'admin');
  await addMember(owner, tenant, member, 'member');
  funnel = await firstFunnel(owner, tenant);
  otherFunnel = await firstFunnel(outsider, otherTenant);
});

const as = (s: Session, t = tenant) => ({ token: s.token, tenant: t });

describe('workspace settings', () => {
  it('start with defaults every member can read', async () => {
    const ws = await ok('GET', '/workspace', as(member));
    expect(ws).toMatchObject({ id: tenant, currency: 'EUR', timezone: 'Europe/Belgrade', fiscalYearStartMonth: 1, customerEmailLanguage: 'en' });
    expect(ws.name).toContain('Settings');
  });

  it('owners and admins can change them, and the new name shows in GET /me', async () => {
    const name = `Renamed ${Date.now()}`;
    const ws = await ok('PATCH', '/workspace', { ...as(owner), body: { name, currency: 'rsd', timezone: 'Europe/London', fiscalYearStartMonth: 4 } });
    expect(ws).toMatchObject({ name, currency: 'RSD', timezone: 'Europe/London', fiscalYearStartMonth: 4 });
    expect(await ok('GET', '/workspace', as(member))).toMatchObject({ name, currency: 'RSD', timezone: 'Europe/London', fiscalYearStartMonth: 4 });
    const me = await ok('GET', '/me', { token: member.token });
    expect(me.tenants.find((t: { id: string }) => t.id === tenant).name).toBe(name);

    expect(await ok('PATCH', '/workspace', { ...as(admin), body: { timezone: 'UTC' } })).toMatchObject({ timezone: 'UTC', currency: 'RSD' });
  });

  it('owners and admins set the language of customer emails (CD-208)', async () => {
    expect(await ok('PATCH', '/workspace', { ...as(admin), body: { customerEmailLanguage: 'sr' } })).toMatchObject({ customerEmailLanguage: 'sr', currency: 'RSD' });
    expect(await ok('GET', '/workspace', as(member))).toMatchObject({ customerEmailLanguage: 'sr' });
    expect((await call('PATCH', '/workspace', { ...as(member), body: { customerEmailLanguage: 'en' } })).status).toBe(403);
    expect(await ok('PATCH', '/workspace', { ...as(owner), body: { customerEmailLanguage: 'en' } })).toMatchObject({ customerEmailLanguage: 'en' });
  });

  it("members can't change them", async () => {
    const res = await call('PATCH', '/workspace', { ...as(member), body: { name: 'Hijacked' } });
    expect(res.status).toBe(403);
    expect((await ok('GET', '/workspace', as(member))).name).not.toBe('Hijacked');
  });

  it.each([
    ['an unknown time zone', { timezone: 'Mars/Olympus_Mons' }],
    ['an offset instead of a time zone', { timezone: '+01:00' }],
    ['an unknown currency', { currency: 'EUROS' }],
    ['a made-up currency code', { currency: 'XYZ' }],
    ['month 0', { fiscalYearStartMonth: 0 }],
    ['month 13', { fiscalYearStartMonth: 13 }],
    ['a fractional month', { fiscalYearStartMonth: 1.5 }],
    ['an empty name', { name: '   ' }],
    ['a name over 100 characters', { name: 'x'.repeat(101) }],
    ['an unsupported customer email language', { customerEmailLanguage: 'de' }],
    ['an empty body', {}],
  ])('rejects %s with 400', async (_label, body) => {
    const res = await call('PATCH', '/workspace', { ...as(owner), body });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
  });

  it("can't be read or changed in another tenant", async () => {
    expect((await call('GET', '/workspace', as(owner, otherTenant))).status).toBe(403);
    expect((await call('PATCH', '/workspace', { ...as(owner, otherTenant), body: { name: 'Taken over' } })).status).toBe(403);
    // The other tenant's own view is untouched by changes here.
    expect(await ok('GET', '/workspace', as(outsider, otherTenant))).toMatchObject({ id: otherTenant, currency: 'EUR', fiscalYearStartMonth: 1, customerEmailLanguage: 'en' });
  });
});

describe('profile settings', () => {
  it('start with defaults and the name from sign-in', async () => {
    const p = await ok('GET', '/profile', as(member));
    expect(p).toMatchObject({
      userId: member.userId,
      email: member.email,
      displayName: member.name,
      jobTitle: null,
      language: 'en',
      dateFormat: 'DD.MM.YYYY',
      startPage: 'pipeline',
      defaultFunnelId: null,
      dailyDigest: true,
    });
  });

  it('saves your own settings', async () => {
    const body = { displayName: 'Mia Member', jobTitle: 'Account manager', phone: '+381 60 000 000', language: 'sr', dateFormat: 'YYYY-MM-DD', startPage: 'today', defaultFunnelId: funnel.id, dailyDigest: false };
    const p = await ok('PATCH', '/profile', { ...as(member), body });
    expect(p).toMatchObject(body);
    expect(await ok('GET', '/profile', as(member))).toMatchObject(body);
    // The new name is what the rest of the app shows.
    expect((await ok('GET', '/me', { token: member.token })).user.displayName).toBe('Mia Member');
    const team = await ok('GET', '/team', as(owner));
    expect(team.members.find((m: { userId: string }) => m.userId === member.userId).displayName).toBe('Mia Member');
  });

  it('keeps a name set in the profile when the user signs in again', async () => {
    const again = await ok<{ accessToken: string }>('POST', '/auth/dev-login', { body: { email: member.email, name: 'Token Name' } }, 200);
    // Saving the profile drops the cached user, so the next request signs in with the new token's name.
    await ok('PATCH', '/profile', { ...as(member), body: { dailyDigest: false } });
    expect((await ok('GET', '/me', { token: again.accessToken })).user.displayName).toBe('Mia Member');
    expect((await ok('GET', '/profile', { token: again.accessToken, tenant })).displayName).toBe('Mia Member');
  });

  it('empty text clears a field', async () => {
    expect(await ok('PATCH', '/profile', { ...as(member), body: { jobTitle: '', phone: '' } })).toMatchObject({ jobTitle: null, phone: null });
  });

  it('only changes your own profile', async () => {
    const before = await ok('GET', '/profile', as(owner));
    await ok('PATCH', '/profile', { ...as(admin), body: { displayName: 'Ada Admin', startPage: 'contacts' } });
    expect(await ok('GET', '/profile', as(owner))).toEqual(before);
    // There is no way to address someone else: unknown fields such as a user id are ignored.
    await ok('PATCH', '/profile', { ...as(admin), body: { userId: owner.userId, jobTitle: 'Not the owner' } });
    expect((await ok('GET', '/profile', as(owner))).jobTitle).toBe(before.jobTitle);
    expect((await ok('GET', '/profile', as(admin))).jobTitle).toBe('Not the owner');
  });

  it('keeps workspace-specific settings per workspace', async () => {
    // The outsider joins this tenant too; their settings in their own tenant don't change.
    await addMember(owner, tenant, outsider, 'member');
    await ok('PATCH', '/profile', { ...as(outsider), body: { defaultFunnelId: funnel.id, dailyDigest: false, jobTitle: 'Consultant' } });
    const own = await ok('GET', '/profile', as(outsider, otherTenant));
    expect(own).toMatchObject({ defaultFunnelId: null, dailyDigest: true, jobTitle: 'Consultant' });
  });

  it("rejects another tenant's funnel as the default funnel", async () => {
    const res = await call('PATCH', '/profile', { ...as(member), body: { defaultFunnelId: otherFunnel.id } });
    expect(res.status).toBe(400);
    expect((await ok('GET', '/profile', as(member))).defaultFunnelId).toBe(funnel.id);
  });

  it.each([
    ['an unknown language', { language: 'xx' }],
    ['an unknown date format', { dateFormat: 'D/M/Y' }],
    ['an unknown start page', { startPage: 'settings' }],
    ['an empty name', { displayName: '' }],
    ['a long job title', { jobTitle: 'x'.repeat(101) }],
    ['a non-boolean digest', { dailyDigest: 'yes' }],
    ['an empty body', {}],
  ])('rejects %s with 400', async (_label, body) => {
    const res = await call('PATCH', '/profile', { ...as(member), body });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
  });

  it("requires membership of the workspace named in X-Tenant-Id", async () => {
    expect((await call('GET', '/profile', as(member, otherTenant))).status).toBe(403);
    expect((await call('PATCH', '/profile', { ...as(member, otherTenant), body: { jobTitle: 'x' } })).status).toBe(403);
  });
});

describe('deal discovery fields', () => {
  it('are saved on create and update, and returned by get and list', async () => {
    const deal = await ok('POST', '/crm/deals', {
      ...as(member),
      body: { title: 'Discovery deal', funnelId: funnel.id, headline: 'One story', need: 'a repositioning.', discoveryDate: '2026-09-03' },
    });
    expect(deal).toMatchObject({ headline: 'One story', need: 'a repositioning.', constraint: null, decisionMaker: null, discoveryDate: '2026-09-03' });

    const patched = await ok('PATCH', `/crm/deals/${deal.id}`, { ...as(member), body: { constraint: 'three approvals', decisionMaker: 'the CMO', need: '' } });
    expect(patched).toMatchObject({ headline: 'One story', need: null, constraint: 'three approvals', decisionMaker: 'the CMO', discoveryDate: '2026-09-03' });

    expect(await ok('GET', `/crm/deals/${deal.id}`, as(owner))).toMatchObject({ constraint: 'three approvals', decisionMaker: 'the CMO' });
    const rows = await ok('GET', '/crm/deals?limit=200', as(owner));
    expect(rows.find((r: { deal: { id: string } }) => r.deal.id === deal.id).deal).toMatchObject({ headline: 'One story', discoveryDate: '2026-09-03' });
  });

  it.each([
    ['a headline over 200 characters', { headline: 'x'.repeat(201) }],
    ['a need over 1000 characters', { need: 'x'.repeat(1001) }],
    ['a constraint over 500 characters', { constraint: 'x'.repeat(501) }],
    ['a decision maker over 200 characters', { decisionMaker: 'x'.repeat(201) }],
    ['a date that is not a date', { discoveryDate: '3 Sep' }],
  ])('rejects %s with 400', async (_label, body) => {
    const deal = await ok('POST', '/crm/deals', { ...as(member), body: { title: 'Validated deal', funnelId: funnel.id } });
    expect((await call('PATCH', `/crm/deals/${deal.id}`, { ...as(member), body })).status).toBe(400);
  });

  it("can't be changed from another tenant", async () => {
    const deal = await ok('POST', '/crm/deals', { ...as(owner), body: { title: 'Private deal', funnelId: funnel.id, need: 'secret' } });
    expect((await call('PATCH', `/crm/deals/${deal.id}`, { ...as(outsider, otherTenant), body: { need: 'leaked' } })).status).toBe(404);
    expect((await ok('GET', `/crm/deals/${deal.id}`, as(owner))).need).toBe('secret');
  });
});
