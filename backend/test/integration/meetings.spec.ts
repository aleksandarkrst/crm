/**
 * Meetings (CD-130): create, read, filter and change meetings; validation (AC 6); who may change
 * and delete them; status changes; the deal timeline and last contact; deleting companies, deals
 * and contacts; tenant isolation; change history; live updates; the daily digest sections.
 */
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { addMember, call, createTenant, firstFunnel, type Funnel, type Json, ok, type Session, signIn } from './helpers';

let owner: Session;
let admin: Session;
let ana: Session; // member who takes part
let bo: Session; // member who doesn't
let outsider: Session;
let tenant: string;
let otherTenant: string;
let funnel: Funnel;
const as = (s: Session, headers?: Record<string, string>) => ({ token: s.token, tenant, headers });

const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();

const company = (name: string) => ok('POST', '/crm/companies', { ...as(owner), body: { name } });
const deal = (title: string, companyId: string | null) => ok('POST', '/crm/deals', { ...as(owner), body: { title, funnelId: funnel.id, companyId } });
const contact = (fullName: string, companyId: string, email: string | null = null) => ok('POST', '/crm/contacts', { ...as(owner), body: { fullName, companyId, email } });

/** A meeting body with every required field; `over` replaces some. */
const body = (companyId: string, over: Record<string, unknown> = {}) => ({
  title: 'Quarterly review',
  type: 'visit',
  startsAt: '2026-11-10T09:00:00.000Z',
  endsAt: '2026-11-10T10:00:00.000Z',
  companyId,
  ...over,
});
const create = (s: Session, companyId: string, over: Record<string, unknown> = {}) => ok('POST', '/crm/meetings', { ...as(s), body: body(companyId, over) });
const list = async (query: string, s = owner) => ok<{ meetings: Json[]; more: boolean }>('GET', `/crm/meetings?${query}`, as(s));
const titles = (r: { meetings: Json[] }) => r.meetings.map((m: Json) => m.title);

beforeAll(async () => {
  owner = await signIn('meet-owner');
  admin = await signIn('meet-admin');
  ana = await signIn('meet-ana');
  bo = await signIn('meet-bo');
  outsider = await signIn('meet-outsider');
  tenant = await createTenant(owner, 'Meetings');
  otherTenant = await createTenant(outsider, 'Meetings other');
  await addMember(owner, tenant, admin, 'admin');
  await addMember(owner, tenant, ana, 'member');
  await addMember(owner, tenant, bo, 'member');
  funnel = await firstFunnel(owner, tenant);
});

describe('creating and reading meetings', () => {
  it('creates a planned meeting organized by the caller, with participants and the deal timeline entry', async () => {
    const acme = await company('Acme Meet');
    const d = await deal('Acme renewal', acme.id);
    const c1 = await contact('Carla Client', acme.id, 'carla@example.test');
    const m = await create(bo, acme.id, {
      dealId: d.id,
      location: 'Acme HQ',
      agenda: 'Pricing\nRoadmap',
      internalUserIds: [ana.userId, ana.userId],
      externalContactIds: [c1.id, c1.id],
    });
    expect(m).toMatchObject({
      title: 'Quarterly review',
      type: 'visit',
      startsAt: '2026-11-10T09:00:00.000Z',
      endsAt: '2026-11-10T10:00:00.000Z',
      location: 'Acme HQ',
      agenda: 'Pricing\nRoadmap',
      companyId: acme.id,
      companyName: 'Acme Meet',
      dealId: d.id,
      dealTitle: 'Acme renewal',
      dealOwnerUserId: owner.userId,
      organizerUserId: bo.userId,
      organizerName: bo.name,
      status: 'planned',
      cancelReason: null,
      heldAt: null,
      notClosed: false,
      internalMinutes: 'missing',
      externalDelivery: 'not_sent',
      createdByUserId: bo.userId,
    });
    // The organizer comes first; nobody twice.
    expect(m.participants.map((p: Json) => [p.kind, p.userId ?? p.contactId, p.name, p.deleted])).toEqual([
      ['internal', bo.userId, bo.name, false],
      ['internal', ana.userId, ana.name, false],
      ['external', c1.id, 'Carla Client', false],
    ]);
    expect(m.participants[2].email).toBe('carla@example.test');
    expect(await ok('GET', `/crm/meetings/${m.id}`, as(ana))).toEqual(m);

    // "Meeting scheduled" on the deal, with the time in the workspace zone (Europe/Belgrade); no contact yet.
    const activities = await ok('GET', `/crm/deals/${d.id}/activities`, as(owner));
    expect(activities).toEqual(
      expect.arrayContaining([expect.objectContaining({ channel: 'MT', title: 'Meeting scheduled · Quarterly review', detail: 'Tue 10 Nov 2026, 10:00–11:00 · Acme HQ' })]),
    );
    expect((await ok('GET', `/crm/deals/${d.id}`, as(owner))).lastContactAt).toBeNull();
  });

  it('lets the organizer be someone else, and keeps them a participant', async () => {
    const co = await company('Organizer Co');
    const m = await create(owner, co.id, { organizerUserId: ana.userId });
    expect(m.organizerUserId).toBe(ana.userId);
    expect(m.participants.map((p: Json) => p.userId)).toEqual([ana.userId]);
    const changed = await ok('PATCH', `/crm/meetings/${m.id}`, { ...as(owner), body: { internalUserIds: [bo.userId] } });
    expect(changed.participants.map((p: Json) => p.userId)).toEqual([ana.userId, bo.userId]);
    const replaced = await ok('PATCH', `/crm/meetings/${m.id}`, { ...as(owner), body: { organizerUserId: owner.userId, internalUserIds: [] } });
    expect(replaced.participants.map((p: Json) => p.userId)).toEqual([owner.userId]);
  });
});

describe('validation (AC 6)', () => {
  let acme: Json;
  let other: Json;
  let otherDeal: Json;
  beforeAll(async () => {
    acme = await company('Validation Co');
    other = await company('Validation Other');
    otherDeal = await deal('Other deal', other.id);
  });

  const refused = async (over: Record<string, unknown>, drop: string[] = []) => {
    const b: Record<string, unknown> = body(acme.id, over);
    for (const k of drop) delete b[k];
    const res = await call('POST', '/crm/meetings', { ...as(owner), body: b });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    return res.body;
  };

  it('refuses a meeting without its required fields or with bad values', async () => {
    for (const field of ['title', 'type', 'startsAt', 'endsAt', 'companyId']) await refused({}, [field]);
    await refused({ title: '   ' });
    await refused({ title: 'x'.repeat(201) });
    await refused({ type: 'lunch' });
    await refused({ startsAt: 'tomorrow' });
    await refused({ location: 'x'.repeat(301) });
    await refused({ agenda: 'x'.repeat(5001) });
    expect((await call('POST', '/crm/meetings', { ...as(owner), body: body(acme.id, { title: 'x'.repeat(200), location: 'x'.repeat(300), agenda: 'x'.repeat(5000) }) })).status).toBe(201);
  });

  it('refuses an end that is not after the start, also when only one of them changes', async () => {
    await refused({ endsAt: '2026-11-10T09:00:00.000Z' });
    await refused({ endsAt: '2026-11-10T08:00:00.000Z' });
    const m = await create(owner, acme.id);
    expect((await call('PATCH', `/crm/meetings/${m.id}`, { ...as(owner), body: { endsAt: '2026-11-10T08:59:00.000Z' } })).status).toBe(400);
    expect((await call('PATCH', `/crm/meetings/${m.id}`, { ...as(owner), body: { startsAt: '2026-11-10T10:00:00.000Z' } })).status).toBe(400);
  });

  it("refuses a deal of another company, an unknown company, people outside the workspace and unknown contacts", async () => {
    expect((await refused({ dealId: otherDeal.id })).message).toMatch(/another company/);
    await refused({ companyId: '00000000-0000-4000-8000-000000000000' });
    expect((await refused({ organizerUserId: outsider.userId })).message).toMatch(/organizer must be a member/);
    expect((await refused({ internalUserIds: [outsider.userId] })).message).toMatch(/members of this workspace/);
    await refused({ externalContactIds: ['00000000-0000-4000-8000-000000000000'] });
    // Moving a meeting to another company with the old company's deal is refused too.
    const d = await deal('Validation deal', acme.id);
    const m = await create(owner, acme.id, { dealId: d.id });
    expect((await call('PATCH', `/crm/meetings/${m.id}`, { ...as(owner), body: { companyId: other.id } })).status).toBe(400);
    const moved = await ok('PATCH', `/crm/meetings/${m.id}`, { ...as(owner), body: { companyId: other.id, dealId: otherDeal.id } });
    expect(moved).toMatchObject({ companyId: other.id, companyName: 'Validation Other', dealId: otherDeal.id });
    expect((await call('PATCH', `/crm/meetings/${m.id}`, { ...as(owner), body: {} })).status).toBe(400);
  });
});

describe('listing and filters', () => {
  let co: Json;
  let co2: Json;
  let d: Json;
  let c: Json;
  const ids: Record<string, string> = {};
  beforeAll(async () => {
    co = await company('Filter Co');
    co2 = await company('Filter Co 2');
    d = await deal('Filter deal', co.id);
    c = await contact('Filter Contact', co.id);
    ids.morning = (await create(owner, co.id, { title: 'Morning', startsAt: '2026-11-10T09:00:00Z', endsAt: '2026-11-10T10:00:00Z', dealId: d.id })).id;
    // 23:30 to 01:30 in Belgrade (CET): on both days.
    ids.late = (await create(ana, co.id, { title: 'Late', type: 'online', startsAt: '2026-11-10T22:30:00Z', endsAt: '2026-11-11T00:30:00Z', externalContactIds: [c.id] })).id;
    ids.next = (await create(owner, co.id, { title: 'Next day', type: 'phone', startsAt: '2026-11-11T12:00:00Z', endsAt: '2026-11-11T12:30:00Z', internalUserIds: [ana.userId] })).id;
    ids.other = (await create(owner, co2.id, { title: 'Other company', startsAt: '2026-11-10T09:00:00Z', endsAt: '2026-11-10T10:00:00Z' })).id;
    const old = Date.now() - 72 * HOUR;
    ids.stale = (await create(owner, co.id, { title: 'Stale', startsAt: iso(old), endsAt: iso(old + HOUR) })).id;
    const recent = Date.now() - 3 * HOUR;
    ids.recent = (await create(owner, co.id, { title: 'Recent', startsAt: iso(recent), endsAt: iso(recent + HOUR) })).id;
    ids.cancelled = (await create(owner, co.id, { title: 'Cancelled', startsAt: '2026-11-10T13:00:00Z', endsAt: '2026-11-10T14:00:00Z' })).id;
    await ok('POST', `/crm/meetings/${ids.cancelled}/cancel`, { ...as(owner), body: { reason: 'Customer ill' } }, 200);
  });

  it('returns the meetings overlapping a day in the workspace zone, including one crossing midnight', async () => {
    // 10 November in Belgrade: 2026-11-09T23:00Z to 2026-11-10T23:00Z.
    const tenth = await list(`from=2026-11-09T23:00:00Z&to=2026-11-10T23:00:00Z&companyId=${co.id}`);
    expect(titles(tenth)).toEqual(['Morning', 'Cancelled', 'Late']);
    const eleventh = await list(`from=2026-11-10T23:00:00Z&to=2026-11-11T23:00:00Z&companyId=${co.id}`);
    expect(titles(eleventh)).toEqual(['Late', 'Next day']);
    // [from, to): a meeting ending exactly at `from` or starting exactly at `to` is outside.
    expect(titles(await list(`from=2026-11-10T10:00:00Z&to=2026-11-10T13:00:00Z&companyId=${co.id}`))).toEqual([]);
    expect(titles(await list(`from=2026-11-10T22:00:00Z&to=2026-11-11T12:00:00Z&companyId=${co.id}&sort=desc`))).toEqual(['Late']);
  });

  it('filters by person, company, deal, contact, type and status', async () => {
    const range = 'from=2026-11-01T00:00:00Z&to=2026-12-01T00:00:00Z';
    expect(titles(await list(`${range}&companyId=${co.id}&userId=${ana.userId}`))).toEqual(['Late', 'Next day']);
    expect(titles(await list(`${range}&companyId=${co.id}&userId=${owner.userId}`))).toEqual(['Morning', 'Cancelled', 'Next day']);
    expect(titles(await list(`${range}&companyId=${co2.id}`))).toEqual(['Other company']);
    expect(titles(await list(`dealId=${d.id}`))).toEqual(['Morning']);
    expect(titles(await list(`contactId=${c.id}`))).toEqual(['Late']);
    expect(titles(await list(`${range}&companyId=${co.id}&type=online,phone`))).toEqual(['Late', 'Next day']);
    expect(titles(await list(`${range}&companyId=${co.id}&status=cancelled`))).toEqual(['Cancelled']);
    expect(titles(await list(`${range}&companyId=${co.id}&status=planned,held&sort=desc`))).toEqual(['Next day', 'Late', 'Morning']);
    expect((await call('GET', `/crm/meetings?${range}&type=lunch`, as(owner))).status).toBe(400);
  });

  it('flags and filters "Not closed" meetings', async () => {
    const res = await list(`companyId=${co.id}&notClosed=1`);
    expect(titles(res)).toEqual(['Stale']);
    expect(res.meetings[0].notClosed).toBe(true);
    const recent = await ok('GET', `/crm/meetings/${ids.recent}`, as(owner));
    expect(recent.notClosed).toBe(false);
  });

  it('reads meetings by id (live updates), pages with `more`, and needs a period or a filter', async () => {
    expect(titles(await list(`ids=${ids.late},${ids.morning},00000000-0000-4000-8000-000000000000`))).toEqual(['Morning', 'Late']);
    const page = await list(`companyId=${co.id}&limit=2`);
    expect(page.meetings).toHaveLength(2);
    expect(page.more).toBe(true);
    const rest = await list(`companyId=${co.id}&limit=50&offset=2`);
    expect(rest.more).toBe(false);
    expect((await call('GET', '/crm/meetings', as(owner))).status).toBe(400);
    expect((await call('GET', '/crm/meetings?from=2026-11-11T00:00:00Z&to=2026-11-10T00:00:00Z', as(owner))).status).toBe(400);
    expect((await call('GET', '/crm/meetings?companyId=x', as(owner))).status).toBe(400);
  });
});

describe('who may change and delete meetings', () => {
  it('lets the organizer, internal participants, admins and owners change a meeting; other members only see it', async () => {
    const co = await company('Permissions Co');
    const m = await create(owner, co.id, { internalUserIds: [ana.userId] });
    expect((await ok('GET', `/crm/meetings/${m.id}`, as(bo))).id).toBe(m.id);
    expect((await call('PATCH', `/crm/meetings/${m.id}`, { ...as(bo), body: { title: 'Bo was here' } })).status).toBe(403);
    expect((await call('POST', `/crm/meetings/${m.id}/cancel`, { ...as(bo) })).status).toBe(403);
    expect((await ok('PATCH', `/crm/meetings/${m.id}`, { ...as(ana), body: { title: 'Ana edits' } })).title).toBe('Ana edits');
    expect((await ok('PATCH', `/crm/meetings/${m.id}`, { ...as(admin), body: { title: 'Admin edits' } })).title).toBe('Admin edits');

    // Only admins and owners delete; members can't, not even the organizer.
    const own = await create(bo, co.id);
    expect((await call('DELETE', `/crm/meetings/${own.id}`, as(bo))).status).toBe(403);
    await ok('DELETE', `/crm/meetings/${own.id}`, as(admin));
    expect((await call('GET', `/crm/meetings/${own.id}`, as(owner))).status).toBe(404);
    await ok('DELETE', `/crm/meetings/${m.id}`, as(owner));
    expect((await call('DELETE', `/crm/meetings/${m.id}`, as(owner))).status).toBe(404);
  });
});

describe('status changes', () => {
  it('marks as held after the start only; cancels, undoes and restores; a cancelled meeting is read-only', async () => {
    const co = await company('Status Co');
    const d = await deal('Status deal', co.id);
    const future = await create(owner, co.id, { title: 'Future', startsAt: iso(Date.now() + 2 * HOUR), endsAt: iso(Date.now() + 3 * HOUR), dealId: d.id });
    const tooEarly = await call('POST', `/crm/meetings/${future.id}/held`, as(owner));
    expect(tooEarly.status).toBe(409);
    expect(tooEarly.body.message).toMatch(/before it starts/);

    const start = Date.now() - 2 * HOUR;
    const past = await create(owner, co.id, { title: 'Past visit', startsAt: iso(start), endsAt: iso(start + HOUR), dealId: d.id, internalUserIds: [ana.userId] });
    const held = await ok('POST', `/crm/meetings/${past.id}/held`, as(ana), 200);
    expect(held.status).toBe('held');
    expect(held.heldAt).not.toBeNull();
    expect((await call('POST', `/crm/meetings/${past.id}/held`, as(owner))).status).toBe(409);
    expect((await call('POST', `/crm/meetings/${past.id}/cancel`, as(owner))).status).toBe(409);
    // A held meeting can still be corrected.
    expect((await ok('PATCH', `/crm/meetings/${past.id}`, { ...as(owner), body: { type: 'office' } })).type).toBe('office');

    // Held: on the timeline at the meeting's start, and the deal's last contact.
    const activities = await ok('GET', `/crm/deals/${d.id}/activities`, as(owner));
    const heldEntry = activities.find((a: Json) => a.title === 'Meeting held · Past visit');
    expect(heldEntry).toMatchObject({ channel: 'MT' });
    expect(new Date(heldEntry.occurredAt).getTime()).toBe(new Date(past.startsAt).getTime());
    expect(new Date((await ok('GET', `/crm/deals/${d.id}`, as(owner))).lastContactAt).getTime()).toBe(new Date(past.startsAt).getTime());

    const undone = await ok('POST', `/crm/meetings/${past.id}/undo-held`, as(owner), 200);
    expect(undone).toMatchObject({ status: 'planned', heldAt: null });
    expect((await call('POST', `/crm/meetings/${past.id}/undo-held`, as(owner))).status).toBe(409);

    const cancelled = await ok('POST', `/crm/meetings/${future.id}/cancel`, { ...as(owner), body: { reason: 'They postponed' } }, 200);
    expect(cancelled).toMatchObject({ status: 'cancelled', cancelReason: 'They postponed' });
    expect(cancelled.cancelledAt).not.toBeNull();
    const edit = await call('PATCH', `/crm/meetings/${future.id}`, { ...as(owner), body: { title: 'Nope' } });
    expect(edit.status).toBe(409);
    expect(edit.body.message).toMatch(/Restore it/);
    expect((await call('POST', `/crm/meetings/${future.id}/held`, as(owner))).status).toBe(409);
    const timeline = await ok('GET', `/crm/deals/${d.id}/activities`, as(owner));
    expect(timeline.find((a: Json) => a.title === 'Meeting cancelled · Future')?.detail).toMatch(/Reason: They postponed$/);

    const restored = await ok('POST', `/crm/meetings/${future.id}/restore`, as(owner), 200);
    expect(restored).toMatchObject({ status: 'planned', cancelReason: null, cancelledAt: null });
    expect((await call('POST', `/crm/meetings/${future.id}/restore`, as(owner))).status).toBe(409);
    // Cancelling without a body is fine.
    expect((await ok('POST', `/crm/meetings/${future.id}/cancel`, as(owner), 200)).cancelReason).toBeNull();
  });
});

describe('related records', () => {
  it('refuses to delete a company with meetings; deleting the deal or a contact keeps the meeting', async () => {
    const co = await company('Delete Co');
    const d = await deal('Delete deal', co.id);
    const c = await contact('Dana Deleted', co.id, 'dana@example.test');
    const m = await create(owner, co.id, { dealId: d.id, externalContactIds: [c.id] });

    await ok('DELETE', `/crm/contacts/${c.id}`, as(owner));
    const afterContact = await ok('GET', `/crm/meetings/${m.id}`, as(owner));
    expect(afterContact.participants.find((p: Json) => p.kind === 'external')).toMatchObject({ contactId: null, name: 'Dana Deleted', deleted: true, email: 'dana@example.test' });

    await ok('DELETE', `/crm/deals/${d.id}`, as(owner));
    expect(await ok('GET', `/crm/meetings/${m.id}`, as(owner))).toMatchObject({ dealId: null, dealTitle: null, dealOwnerUserId: null });

    const refused = await call('DELETE', `/crm/companies/${co.id}`, as(owner));
    expect(refused.status).toBe(409);
    expect(refused.body.message).toBe('Delete Co has 1 meeting. Delete them or move them to another company first.');
    await ok('DELETE', `/crm/meetings/${m.id}`, as(owner));
    await ok('DELETE', `/crm/companies/${co.id}`, as(owner));
  });
});

describe('tenant isolation', () => {
  it("never shows or links another workspace's meetings", async () => {
    const co = await company('Isolation Co');
    const m = await create(owner, co.id);
    expect((await call('GET', `/crm/meetings/${m.id}`, { token: outsider.token, tenant })).status).toBe(403);
    expect((await call('GET', `/crm/meetings/${m.id}`, { token: outsider.token, tenant: otherTenant })).status).toBe(404);
    const theirs = await ok<{ meetings: Json[] }>('GET', `/crm/meetings?ids=${m.id}`, { token: outsider.token, tenant: otherTenant });
    expect(theirs.meetings).toEqual([]);
    expect((await call('POST', '/crm/meetings', { token: outsider.token, tenant: otherTenant, body: body(co.id) })).status).toBe(400);
    expect((await call('PATCH', `/crm/meetings/${m.id}`, { token: outsider.token, tenant: otherTenant, body: { title: 'Mine now' } })).status).toBe(404);
    expect((await call('DELETE', `/crm/meetings/${m.id}`, { token: outsider.token, tenant: otherTenant })).status).toBe(404);
  });
});

describe('change history and conflicts', () => {
  it('records creation, field changes with readable names, and people added and removed', async () => {
    const co = await company('History Meet Co');
    const d = await deal('History meet deal', co.id);
    const m = await create(owner, co.id, { title: 'History meeting' });
    await ok('PATCH', `/crm/meetings/${m.id}`, { ...as(owner), body: { title: 'History meeting v2', dealId: d.id, organizerUserId: ana.userId, startsAt: '2026-11-10T08:30:00Z' } });
    await ok('PATCH', `/crm/meetings/${m.id}`, { ...as(ana), body: { internalUserIds: [bo.userId] } });
    await ok('POST', `/crm/meetings/${m.id}/cancel`, as(ana), 200);

    const { entries } = await ok('GET', `/crm/history?entityType=meeting&entityId=${m.id}`, as(bo));
    const find = (action: string, field?: string) => entries.find((e: Json) => e.action === action && (field === undefined || e.field === field));
    expect(find('created')).toMatchObject({ label: 'History meeting', actor: { userId: owner.userId, name: owner.name } });
    expect(find('updated', 'title')).toMatchObject({ oldValue: 'History meeting', newValue: 'History meeting v2' });
    expect(find('updated', 'dealId')).toMatchObject({ oldValue: null, newValue: d.id, newLabel: 'History meet deal' });
    expect(find('updated', 'organizerUserId')).toMatchObject({ oldLabel: owner.name, newLabel: ana.name });
    expect(new Date(find('updated', 'startsAt').newValue).toISOString()).toBe('2026-11-10T08:30:00.000Z');
    expect(find('updated', 'status')).toMatchObject({ oldValue: 'planned', newValue: 'cancelled', actor: { userId: ana.userId, name: ana.name } });
    expect(entries.filter((e: Json) => e.action === 'participant_added').map((e: Json) => e.label).sort()).toEqual([ana.name, bo.name].sort());
    // The owner was dropped when ana replaced the members (ana stays as the organizer).
    expect(find('participant_removed')).toMatchObject({ label: owner.name, field: 'participants' });
  });

  it('refuses an edit based on an older version when someone changed the same field (If-Match)', async () => {
    const co = await company('Conflict Meet Co');
    const m = await create(owner, co.id, { internalUserIds: [ana.userId] });
    await ok('PATCH', `/crm/meetings/${m.id}`, { ...as(ana), body: { title: 'Ana’s title' } });
    const res = await call('PATCH', `/crm/meetings/${m.id}`, { ...as(owner, { 'if-match': `"${m.updatedAt}"` }), body: { title: 'Owner’s title' } });
    expect(res.status).toBe(409);
    expect(res.body.message).toBe(`${ana.name} changed this meeting while you were editing. Your change to the title wasn't saved.`);
    // Another field merges; the same start time sent again isn't a conflict.
    await ok('PATCH', `/crm/meetings/${m.id}`, { ...as(ana), body: { startsAt: '2026-11-10T08:00:00Z' } });
    const merged = await ok('PATCH', `/crm/meetings/${m.id}`, { ...as(owner, { 'if-match': `"${m.updatedAt}"` }), body: { location: 'Room 4', startsAt: '2026-11-10T08:00:00.000Z' } });
    expect(merged).toMatchObject({ title: 'Ana’s title', location: 'Room 4' });
  });
});

describe('live updates', () => {
  const aborts: AbortController[] = [];
  afterAll(() => aborts.forEach((a) => a.abort()));

  it('tells other members about new and changed meetings, people changes included', async () => {
    const abort = new AbortController();
    aborts.push(abort);
    const res = await fetch(`${inject('apiUrl')}/api/events`, { headers: { authorization: `Bearer ${bo.token}`, 'x-tenant-id': tenant }, signal: abort.signal });
    expect(res.status).toBe(200);
    const events: Json[] = [];
    let ready = false;
    void (async () => {
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) return;
          buffer += decoder.decode(value, { stream: true });
          let end: number;
          while ((end = buffer.indexOf('\n\n')) >= 0) {
            const block = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            const type = /^event: (.*)$/m.exec(block)?.[1];
            const data = /^data: (.*)$/m.exec(block)?.[1];
            if (type === 'ready') ready = true;
            if (type === 'change' && data) events.push(JSON.parse(data));
          }
        }
      } catch {
        // aborted
      }
    })();
    const waitFor = async (predicate: (e: Json) => boolean) => {
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        if (events.some(predicate)) return;
        await new Promise((r) => setTimeout(r, 50));
      }
      throw new Error(`No matching event; got ${JSON.stringify(events)}`);
    };
    const until = Date.now() + 5_000;
    while (!ready && Date.now() < until) await new Promise((r) => setTimeout(r, 20));
    expect(ready).toBe(true);

    const co = await company('Live Meet Co');
    const m = await create(owner, co.id);
    await waitFor((e) => e.type === 'meeting' && e.op === 'insert' && e.ids?.includes(m.id));
    events.length = 0;
    // Only the people change: the participant rows report their meeting.
    await ok('PATCH', `/crm/meetings/${m.id}`, { ...as(owner, { 'x-client-id': 'tab-meet-owner' }), body: { internalUserIds: [ana.userId] } });
    await waitFor((e) => e.type === 'meeting' && e.op === 'insert' && e.ids?.includes(m.id) && e.client === 'tab-meet-owner');
    await ok('DELETE', `/crm/meetings/${m.id}`, as(owner));
    await waitFor((e) => e.type === 'meeting' && e.op === 'delete' && e.ids?.includes(m.id));
  });
});

describe('daily digest', () => {
  it("lists today's meetings and the organizer's not closed ones; a planned meeting ahead is a next step", async () => {
    const co = await company('Digest Meet Co');
    const withMeeting = await deal('Deal with a meeting ahead', co.id);
    const without = await deal('Deal without a next step', co.id);
    await create(owner, co.id, { title: 'Ahead', dealId: withMeeting.id, startsAt: iso(Date.now() + 48 * HOUR), endsAt: iso(Date.now() + 49 * HOUR) });
    const now = Date.now() - 60_000; // started a minute ago: today, unless the test runs right after midnight
    const today = await create(ana, co.id, { title: 'Today with owner', startsAt: iso(now), endsAt: iso(now + HOUR), internalUserIds: [owner.userId] });
    const old = Date.now() - 72 * HOUR;
    const stale = await create(owner, co.id, { title: 'Never closed', startsAt: iso(old), endsAt: iso(old + HOUR) });
    const cancelledToday = await create(owner, co.id, { title: 'Cancelled today', startsAt: iso(now), endsAt: iso(now + HOUR) });
    await ok('POST', `/crm/meetings/${cancelledToday.id}/cancel`, as(owner), 200);

    const digest = await ok('GET', '/notifications/digest', as(owner));
    expect(digest.timeZone).toBe('Europe/Belgrade');
    expect(digest.meetingsToday.map((m: Json) => m.id)).toContain(today.id);
    expect(digest.meetingsToday.map((m: Json) => m.id)).not.toContain(cancelledToday.id);
    expect(digest.notClosed.map((m: Json) => m.id)).toContain(stale.id);
    expect(digest.notClosed.map((m: Json) => m.id)).not.toContain(today.id);
    const noNextStep = digest.noNextStep.map((d: Json) => d.id);
    expect(noNextStep).toContain(without.id);
    expect(noNextStep).not.toContain(withMeeting.id);

    // Not closed is the organizer's list only.
    const anas = await ok('GET', '/notifications/digest', as(ana));
    expect(anas.notClosed.map((m: Json) => m.id)).not.toContain(stale.id);
    expect(anas.meetingsToday.map((m: Json) => m.id)).toContain(today.id);
  });
});
