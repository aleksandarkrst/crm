/**
 * Notification settings and emails (CD-16): the settings are per user and per workspace; the
 * daily digest has the member's own overdue and due-today tasks and their deals with no next
 * step, by the workspace's date; empty digests are skipped; the "deal assigned to you" email goes
 * out only when someone else assigns the deal, and only to people who want it.
 */
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { addMember, createTenant, eventually, firstFunnel, type Funnel, mailTo, ok, type Session, signIn, waitForMail } from './helpers';

let owner: Session;
let member: Session;
let tenant: string;
const as = (s: Session, t = tenant) => ({ token: s.token, tenant: t });

/** The date `days` from today on the clock of `timeZone`. */
function localDate(timeZone: string, days = 0): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const d = new Date(today + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function deal(s: Session, t: string, funnel: Funnel, title: string, ownerUserId?: string) {
  return ok<{ id: string; stageId: string }>('POST', '/crm/deals', { ...as(s, t), body: { title, funnelId: funnel.id, ...(ownerUserId ? { ownerUserId } : {}) } });
}
async function task(s: Session, t: string, d: { id: string; stageId: string }, label: string, dueDate: string, assigneeUserId: string, done = false) {
  return ok<{ id: string }>('POST', `/crm/deals/${d.id}/tasks`, { ...as(s, t), body: { stageId: d.stageId, label, dueDate, assigneeUserId, done, blocksAdvance: false } });
}

beforeAll(async () => {
  owner = await signIn('notif-owner');
  member = await signIn('notif-member');
  tenant = await createTenant(owner, 'Notify');
  await addMember(owner, tenant, member, 'member');
});

describe('notification settings', () => {
  it('are saved per user and per workspace', async () => {
    const second = await createTenant(owner, 'Notify Two');
    expect(await ok('GET', '/profile', as(owner))).toMatchObject({ dailyDigest: true, notifyDealAssigned: true });

    const saved = await ok('PATCH', '/profile', { ...as(owner), body: { dailyDigest: false, notifyDealAssigned: false } });
    expect(saved).toMatchObject({ dailyDigest: false, notifyDealAssigned: false });
    expect(await ok('GET', '/profile', as(owner))).toMatchObject({ dailyDigest: false, notifyDealAssigned: false });
    // The same user in another workspace, and another user in this one, keep their own.
    expect(await ok('GET', '/profile', as(owner, second))).toMatchObject({ dailyDigest: true, notifyDealAssigned: true });
    expect(await ok('GET', '/profile', as(member))).toMatchObject({ dailyDigest: true, notifyDealAssigned: true });

    await ok('PATCH', '/profile', { ...as(owner), body: { dailyDigest: true, notifyDealAssigned: true } });
  });

  it('reject values that are not booleans', async () => {
    const res = await ok('PATCH', '/profile', { ...as(member), body: { notifyDealAssigned: 'yes' } }, 400);
    expect(JSON.stringify(res)).toMatch(/notifyDealAssigned/);
  });
});

describe('daily digest', () => {
  // Kiritimati is UTC+14 and Pago Pago UTC-11: their calendars are always a day or two apart.
  const EAST = 'Pacific/Kiritimati';
  const WEST = 'Pacific/Pago_Pago';
  let east: string;
  let west: string;

  beforeAll(async () => {
    east = await createTenant(owner, 'Digest East');
    west = await createTenant(owner, 'Digest West');
    await ok('PATCH', '/workspace', { ...as(owner, east), body: { timezone: EAST } });
    await ok('PATCH', '/workspace', { ...as(owner, west), body: { timezone: WEST } });
    await addMember(owner, east, member, 'member');
  });

  it("has the member's overdue and due-today tasks and deals without a next step, by the workspace's date", async () => {
    const funnel = await firstFunnel(owner, east);
    const today = localDate(EAST);
    const busy = await deal(owner, east, funnel, 'Busy deal');
    await task(owner, east, busy, 'Due today', today, owner.userId);
    await task(owner, east, busy, 'Overdue', localDate(EAST, -2), owner.userId);
    await task(owner, east, busy, 'Tomorrow', localDate(EAST, 1), owner.userId);
    await task(owner, east, busy, 'Done already', localDate(EAST, -1), owner.userId, true);
    await task(owner, east, busy, "Member's task", today, member.userId);
    const idle = await deal(owner, east, funnel, 'Idle deal');
    const lost = await deal(owner, east, funnel, 'Lost deal');
    await ok('POST', `/crm/deals/${lost.id}/lost`, { ...as(owner, east), body: { reason: 'Price' } }, 200);
    await deal(owner, east, funnel, "Member's deal", member.userId);

    const digest = await ok('GET', '/notifications/digest', as(owner, east));
    expect(digest.date).toBe(today);
    expect(digest.overdue.map((t: { title: string }) => t.title)).toEqual(['Overdue']);
    expect(digest.dueToday.map((t: { title: string }) => t.title)).toEqual(['Due today']);
    expect(digest.dueToday[0]).toMatchObject({ dealId: busy.id, dealTitle: 'Busy deal', dueDate: today });
    expect(digest.noNextStep.map((d: { id: string }) => d.id)).toEqual([idle.id]);

    const theirs = await ok('GET', '/notifications/digest', as(member, east));
    expect(theirs.dueToday.map((t: { title: string }) => t.title)).toEqual(["Member's task"]);
    expect(theirs.noNextStep.map((d: { title: string }) => d.title)).toEqual(["Member's deal"]);
  });

  it("uses the workspace's time zone for today", async () => {
    const funnel = await firstFunnel(owner, west);
    const d = await deal(owner, west, funnel, 'West deal');
    // East's today is still in the future in the west; west's today is today.
    await task(owner, west, d, 'East today', localDate(EAST), owner.userId);
    await task(owner, west, d, 'West today', localDate(WEST), owner.userId);
    const digest = await ok('GET', '/notifications/digest', as(owner, west));
    expect(digest.date).toBe(localDate(WEST));
    expect(digest.date).not.toBe(localDate(EAST));
    expect(digest.overdue).toEqual([]);
    expect(digest.dueToday.map((t: { title: string }) => t.title)).toEqual(['West today']);
  });

  it('is emailed by the worker with the items and links', async () => {
    await ok('POST', '/dev/digest', as(owner, east), 202);
    const mail = await eventually(async () => (await mailTo(owner, owner.email)).find((m) => m.subject.startsWith('Your day in Digest East')), 'the digest email');
    expect(mail.subject).toMatch(/: 1 overdue, 1 due today, 1 deal without a next step$/);
    expect(mail.text).toContain('Overdue tasks (1)');
    expect(mail.text).toContain('- Due today · Busy deal');
    expect(mail.text).toContain('Idle deal');
    expect(mail.text).toContain('http://app.example.test/deals/');
    expect(mail.text).not.toContain('Tomorrow');
    expect(mail.text).not.toContain("Member's task");
  });

  describe('delivery log', () => {
    let db: Client;
    beforeAll(async () => {
      db = new Client({ connectionString: inject('databaseUrl') });
      await db.connect();
    });
    afterAll(async () => {
      await db?.end();
    });
    async function status(tenantId: string, userId: string): Promise<string | null> {
      await db.query('begin');
      try {
        await db.query(`select set_config('app.tenant_id', $1, true)`, [tenantId]);
        const { rows } = await db.query<{ status: string }>('select status from daily_digests where user_id = $1', [userId]);
        return rows[0]?.status ?? null;
      } finally {
        await db.query('rollback');
      }
    }

    it('skips an empty digest (no email) and records the day, visible only to its workspace', async () => {
      const quiet = await signIn('notif-quiet');
      const quietTenant = await createTenant(quiet, 'Quiet');
      await ok('POST', '/dev/digest', as(quiet, quietTenant), 202);
      expect(await eventually(async () => (await status(quietTenant, quiet.userId)) === 'skipped', 'skipped digest')).toBe(true);
      expect(await mailTo(quiet, quiet.email)).toEqual([]);
      // RLS: another workspace doesn't see the row.
      expect(await status(tenant, quiet.userId)).toBeNull();
    });

    it('records a sent digest', async () => {
      expect(await eventually(async () => (await status(east, owner.userId)) === 'sent', 'sent digest')).toBe(true);
    });
  });
});

describe('deal assigned to you', () => {
  let funnel: Funnel;
  beforeAll(async () => {
    funnel = await firstFunnel(owner, tenant);
  });
  const subjects = async (s: Session) => (await mailTo(s, s.email)).map((m) => m.subject);

  it('emails the new owner when someone else assigns the deal, on create or on change', async () => {
    const created = await deal(owner, tenant, funnel, 'Assigned on create', member.userId);
    const mail = await eventually(async () => (await mailTo(member, member.email)).find((m) => m.subject.endsWith('assigned you Assigned on create')), 'assignment email');
    expect(mail.subject).toBe(`${owner.name} assigned you Assigned on create`);
    expect(mail.text).toContain(`http://app.example.test/deals/${created.id}`);

    const own = await deal(owner, tenant, funnel, 'Reassigned later');
    await ok('PATCH', `/crm/deals/${own.id}`, { ...as(owner), body: { ownerUserId: member.userId } });
    await eventually(async () => (await subjects(member)).includes(`${owner.name} assigned you Reassigned later`), 'reassignment email');
  });

  it("doesn't email when you assign a deal to yourself, re-save the same owner, or turned it off", async () => {
    await deal(member, tenant, funnel, 'My own deal'); // the creator owns it
    const mine = await deal(member, tenant, funnel, 'Mine, saved again', member.userId);
    await ok('PATCH', `/crm/deals/${mine.id}`, { ...as(member), body: { ownerUserId: member.userId } });
    const already = await deal(owner, tenant, funnel, 'Same owner twice', member.userId);
    await ok('PATCH', `/crm/deals/${already.id}`, { ...as(owner), body: { ownerUserId: member.userId, title: 'Same owner twice' } });

    await eventually(async () => (await subjects(member)).includes(`${owner.name} assigned you Same owner twice`), 'first assignment email');

    // The setting is read when the email would be sent, so it stays off until the marker below.
    await ok('PATCH', '/profile', { ...as(member), body: { notifyDealAssigned: false } });
    await deal(owner, tenant, funnel, 'While switched off', member.userId);

    // A marker sent last (to the owner): the worker takes these jobs in order, so once it has
    // arrived, the ones queued before it have run.
    await deal(member, tenant, funnel, 'Marker deal', owner.userId);
    await eventually(async () => (await subjects(owner)).includes(`${member.name} assigned you Marker deal`), 'marker email');
    await ok('PATCH', '/profile', { ...as(member), body: { notifyDealAssigned: true } });
    const got = await subjects(member);
    expect(got.filter((s) => s.endsWith('Same owner twice'))).toHaveLength(1);
    expect(got.some((s) => s.includes('My own deal') || s.includes('Mine, saved again') || s.includes('While switched off'))).toBe(false);
  });

  it('only goes to members of the workspace (the API refuses other owners)', async () => {
    const outsider = await signIn('notif-outsider');
    await ok('POST', '/crm/deals', { ...as(owner), body: { title: 'Outsider', funnelId: funnel.id, ownerUserId: outsider.userId } }, 400);
    await waitForMail(member, member.email); // the suite's mail endpoint still works for anyone signed in
    expect(await mailTo(outsider, outsider.email)).toEqual([]);
  });
});
