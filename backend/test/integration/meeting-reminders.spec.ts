/**
 * Meeting reminders (CD-376): the defaults a person added to a meeting gets (1 hour; 1 day and
 * 1 hour for a customer visit), each person's own list (at most 5, nobody else's shown), the tick
 * that emails each reminder once to its owner only, cancelled and moved meetings, reminders saved
 * after their time, a member who left, and tenant isolation of meeting_reminders. The tick runs
 * through the dev trigger at a chosen `now` (POST /dev/meetings/reminders-tick).
 */
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { addMember, call, createTenant, eventually, firstFunnel, type Json, mailTo, ok, readyCompany, type Session, signIn } from './helpers';

let owner: Session;
let ana: Session;
let bo: Session;
let tenant: string;
let companyId: string;
let dealId: string;
const as = (s: Session) => ({ token: s.token, tenant });

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const iso = (ms: number) => new Date(ms).toISOString();
/**
 * A start on a whole minute, three days ahead or more, so the worker's own tick (real time) never
 * finds it due. Each meeting gets its own 30 days: the tick covers the whole workspace, and a
 * reminder is at most 4 weeks before, so a tick for one meeting never finds another one's due.
 */
let slot = 0;
const start = () => Math.ceil((Date.now() + (3 + 30 * slot++) * DAY) / MINUTE) * MINUTE;

const create = (s: Session, title: string, startsAt: number, over: Record<string, unknown> = {}) =>
  ok('POST', '/crm/meetings', { ...as(s), body: { title, type: 'online', startsAt: iso(startsAt), endsAt: iso(startsAt + HOUR), companyId, dealId, ...over } });
const get = (s: Session, id: string) => ok('GET', `/crm/meetings/${id}`, as(s));
const setReminders = (s: Session, id: string, reminders: unknown[]) => call('PUT', `/crm/meetings/${id}/reminders`, { ...as(s), body: { reminders } });
const tick = async (at: number): Promise<number> => (await ok('POST', '/dev/meetings/reminders-tick', { ...as(owner), body: { now: iso(at) } }, 200)).queued;
const reminderMails = async (s: Session, title: string) => (await mailTo(s, s.email)).filter((m: Json) => m.subject.startsWith(`Reminder: ${title} @`));
const waitForReminders = (s: Session, title: string, count = 1) =>
  eventually(async () => {
    const mails = await reminderMails(s, title);
    return mails.length >= count ? mails : null;
  }, `${count} reminder(s) of "${title}" to ${s.email}`);

const hour = { amount: 1, unit: 'hours' };
const day = { amount: 1, unit: 'days' };

beforeAll(async () => {
  owner = await signIn('mr-owner');
  ana = await signIn('mr-ana');
  bo = await signIn('mr-bo');
  tenant = await createTenant(owner, 'Reminders');
  await addMember(owner, tenant, ana, 'member');
  await addMember(owner, tenant, bo, 'member');
  companyId = (await readyCompany(owner, tenant, 'Reminders Co')).id;
  const funnel = await firstFunnel(owner, tenant);
  dealId = (await ok('POST', '/crm/deals', { ...as(owner), body: { title: 'Reminders renewal', funnelId: funnel.id, companyId } })).id;
});

describe('my reminders', () => {
  it('start at 1 hour before for the organizer and each person added, and at 1 day and 1 hour for a customer visit', async () => {
    const online = await create(owner, 'Default online', start(), { internalUserIds: [ana.userId] });
    expect(online.myReminders).toEqual([hour]);
    expect((await get(ana, online.id)).myReminders).toEqual([hour]);
    // Bo isn't on it: no reminders of his own.
    expect((await get(bo, online.id)).myReminders).toEqual([]);

    const visit = await create(owner, 'Default visit', start(), { type: 'visit' });
    expect(visit.myReminders).toEqual([day, hour]);
    const joined = await ok('PATCH', `/crm/meetings/${visit.id}`, { ...as(owner), body: { internalUserIds: [bo.userId] } }, 200);
    expect(joined.myReminders).toEqual([day, hour]); // the owner's own, unchanged
    expect((await get(bo, visit.id)).myReminders).toEqual([day, hour]);
  });

  it('can be added, changed and removed, up to 5, and each person sees only their own', async () => {
    const m = await create(owner, 'Own lists', start(), { internalUserIds: [ana.userId] });
    const five = [{ amount: 2, unit: 'days' }, day, { amount: 2, unit: 'hours' }, hour, { amount: 10, unit: 'minutes' }];
    const saved = await setReminders(ana, m.id, five);
    expect(saved.status).toBe(200);
    expect(saved.body.myReminders).toEqual(five);
    expect((await get(owner, m.id)).myReminders).toEqual([hour]);

    const six = await setReminders(ana, m.id, [...five, { amount: 5, unit: 'minutes' }]);
    expect(six.status).toBe(400);
    expect(six.body.message).toContain('at most 5 reminders');
    const same = await setReminders(ana, m.id, [hour, { amount: 60, unit: 'minutes' }]);
    expect(same.status).toBe(400);

    // Changed to 30 minutes, one removed: the list is replaced.
    expect((await setReminders(ana, m.id, [{ amount: 30, unit: 'minutes' }, day])).body.myReminders).toEqual([day, { amount: 30, unit: 'minutes' }]);
    expect((await setReminders(ana, m.id, [])).body.myReminders).toEqual([]);
    expect((await get(owner, m.id)).myReminders).toEqual([hour]);
  });

  it('are only for the people on a planned meeting', async () => {
    const m = await create(ana, 'Not yours', start());
    // The owner can change the meeting, but isn't on it.
    expect((await setReminders(owner, m.id, [hour])).status).toBe(403);
    expect((await setReminders(bo, m.id, [hour])).status).toBe(403);
    await ok('POST', `/crm/meetings/${m.id}/cancel`, { ...as(ana), body: {} }, 200);
    expect((await setReminders(ana, m.id, [hour])).status).toBe(409);
    expect((await call('PUT', `/crm/meetings/00000000-0000-4000-8000-000000000000/reminders`, { ...as(ana), body: { reminders: [] } })).status).toBe(404);
  });
});

describe('the reminder emails', () => {
  it('go once to their owner at their time, and a second tick sends nothing new', async () => {
    const at = start();
    const m = await create(owner, 'Weekly sync', at, { internalUserIds: [ana.userId, bo.userId], location: 'Bulevar 1, Beograd', agenda: 'Pricing' });
    await setReminders(bo, m.id, [{ amount: 30, unit: 'minutes' }]);

    expect(await tick(at - HOUR - MINUTE)).toBe(0);
    // An hour before: the owner's and Ana's 1-hour reminders; Bo's is at 30 minutes.
    expect(await tick(at - HOUR)).toBe(2);
    expect(await tick(at - HOUR + 30_000)).toBe(0);
    const toAna: Json = (await waitForReminders(ana, 'Weekly sync'))[0];
    expect(toAna.text).toContain('Location: Bulevar 1, Beograd');
    expect(toAna.text).toContain('Agenda:\nPricing');
    expect(toAna.text).toContain(`http://app.example.test/meetings/${m.id}`);
    expect(toAna.attachments ?? []).toEqual([]);
    await waitForReminders(owner, 'Weekly sync');

    expect(await tick(at - 30 * MINUTE)).toBe(1);
    await waitForReminders(bo, 'Weekly sync');
    expect(await tick(at - 10 * MINUTE)).toBe(0);
    // Each got their own one only.
    for (const s of [owner, ana, bo]) expect(await reminderMails(s, 'Weekly sync'), s.email).toHaveLength(1);
  });

  it('a cancelled meeting sends nothing', async () => {
    const at = start();
    const m = await create(owner, 'Called off', at, { internalUserIds: [ana.userId] });
    await ok('POST', `/crm/meetings/${m.id}/cancel`, { ...as(owner), body: {} }, 200);
    expect(await tick(at - HOUR)).toBe(0);
  });

  it('a moved meeting reminds again from its new start, sent reminders too', async () => {
    const at = start();
    const m = await create(owner, 'Moved review', at);
    expect(await tick(at - HOUR)).toBe(1);
    await waitForReminders(owner, 'Moved review');

    const later = at + DAY;
    await ok('PATCH', `/crm/meetings/${m.id}`, { ...as(owner), body: { startsAt: iso(later), endsAt: iso(later + HOUR) } }, 200);
    expect(await tick(later - HOUR - MINUTE)).toBe(0);
    expect(await tick(later - HOUR)).toBe(1);
    await waitForReminders(owner, 'Moved review', 2);
    expect(await tick(later - HOUR + MINUTE)).toBe(0);
  });

  it('a reminder whose time has passed when it is saved is not sent', async () => {
    // The meeting starts in 20 minutes (real time): its default 1-hour reminder is already past.
    const at = Math.ceil((Date.now() + 20 * MINUTE) / MINUTE) * MINUTE;
    const m = await create(owner, 'Starting soon', at);
    expect(m.myReminders).toEqual([hour]);
    expect(await tick(Date.now())).toBe(0);
    // A 2-hour one added now is past too; a 10-minute one goes at its time.
    await setReminders(owner, m.id, [{ amount: 2, unit: 'hours' }, { amount: 10, unit: 'minutes' }]);
    expect(await tick(Date.now())).toBe(0);
    expect(await tick(at - 10 * MINUTE)).toBe(1);
  });

  it("a person who left the workspace isn't reminded", async () => {
    const carl = await signIn('mr-carl');
    await addMember(owner, tenant, carl, 'member');
    const at = start();
    const m = await create(owner, 'Carl leaves', at, { internalUserIds: [carl.userId] });
    expect((await get(carl, m.id)).myReminders).toEqual([hour]);
    await setReminders(owner, m.id, []);
    await ok('DELETE', `/team/members/${carl.userId}`, as(owner));
    expect(await tick(at - HOUR)).toBe(0);
  });
});

describe('meeting_reminders in SQL, as the runtime role', () => {
  let db: Client;
  let otherTenant: string;
  let meetingId: string;

  beforeAll(async () => {
    db = new Client({ connectionString: inject('databaseUrl') });
    await db.connect();
    const outsider = await signIn('mr-outsider');
    otherTenant = await createTenant(outsider, 'Reminders other');
    meetingId = (await create(owner, 'Isolated', start())).id;
  });
  afterAll(async () => {
    await db?.end();
  });

  async function asTenant<T>(tenantId: string | null, fn: () => Promise<T>): Promise<T> {
    await db.query('begin');
    try {
      if (tenantId) await db.query(`select set_config('app.tenant_id', $1, true)`, [tenantId]);
      return await fn();
    } finally {
      await db.query('rollback');
    }
  }
  const sqlError = (p: Promise<unknown>) =>
    p.then(
      () => null,
      (err: { code?: string }) => err.code,
    );

  it('shows rows only to their own workspace', async () => {
    expect(await asTenant(null, async () => (await db.query(`select count(*)::int as n from meeting_reminders`)).rows[0].n)).toBe(0);
    expect(await asTenant(tenant, async () => (await db.query(`select count(*)::int as n from meeting_reminders where meeting_id = $1`, [meetingId])).rows[0].n)).toBe(1);
    expect(await asTenant(otherTenant, async () => (await db.query(`select count(*)::int as n from meeting_reminders where tenant_id = $1`, [tenant])).rows[0].n)).toBe(0);
    expect(await asTenant(otherTenant, async () => (await db.query(`update meeting_reminders set minutes_before = 5, unit = 'minutes' where meeting_id = $1`, [meetingId])).rowCount)).toBe(0);
  });

  it("refuses rows planted in another workspace and references to another workspace's meeting", async () => {
    const plant = `insert into meeting_reminders (tenant_id, meeting_id, user_id, minutes_before, unit) values ($1, $2, $3, 15, 'minutes')`;
    expect(await asTenant(otherTenant, () => sqlError(db.query(plant, [tenant, meetingId, owner.userId])))).toBe('42501');
    expect(await asTenant(otherTenant, () => sqlError(db.query(plant, [otherTenant, meetingId, owner.userId])))).toBe('23503');
  });
});
