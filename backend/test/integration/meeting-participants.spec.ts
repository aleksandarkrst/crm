/**
 * Meeting participants (CD-131): the emails with an .ics to internal participants (added by
 * someone else, time or place changed, cancelled), never to the person who made the change and
 * never when they turned "Meeting invitations" off; editing people on held meetings; deleting a
 * contact (off future planned meetings only); a member leaving the workspace (off future planned
 * meetings, "Organizer left" until an admin picks one); the calendar and contact filters.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { addMember, call, createTenant, eventually, firstFunnel, type Json, mailTo, ok, type Session, signIn } from './helpers';

let owner: Session;
let admin: Session;
let ana: Session;
let bo: Session;
let tenant: string;
let companyId: string;
let dealId: string; // a meeting needs a deal (CD-213)
const as = (s: Session) => ({ token: s.token, tenant });

const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();
const future = (hours: number) => iso(Date.now() + hours * HOUR);

const create = (s: Session, title: string, over: Record<string, unknown> = {}) =>
  ok('POST', '/crm/meetings', { ...as(s), body: { title, type: 'online', startsAt: future(48), endsAt: future(49), companyId, dealId, ...over } });
const patch = (s: Session, id: string, body: Record<string, unknown>) => ok('PATCH', `/crm/meetings/${id}`, { ...as(s), body }, 200);
const get = (s: Session, id: string) => ok('GET', `/crm/meetings/${id}`, as(s));

/** The emails to a person whose subject ends with ": <title>". */
const mailsAbout = async (s: Session, title: string) => (await mailTo(s, s.email)).filter((m: Json) => m.subject.endsWith(`: ${title}`));
const waitForSubject = (s: Session, subject: string) =>
  eventually(async () => (await mailTo(s, s.email)).find((m: Json) => m.subject === subject) as Json, `"${subject}" to ${s.email}`);
/** The .ics of an email, with folded lines joined. */
const icsOf = (mail: Json): string[] => {
  const file = (mail.attachments ?? []).find((a: Json) => a.filename.endsWith('.ics'));
  expect(file, `an .ics on "${mail.subject}"`).toBeTruthy();
  return String(file.content).replace(/\r\n /g, '').split('\r\n');
};

beforeAll(async () => {
  owner = await signIn('mp-owner');
  admin = await signIn('mp-admin');
  ana = await signIn('mp-ana');
  bo = await signIn('mp-bo');
  tenant = await createTenant(owner, 'Participants');
  await addMember(owner, tenant, admin, 'admin');
  await addMember(owner, tenant, ana, 'member');
  await addMember(owner, tenant, bo, 'member');
  companyId = (await ok('POST', '/crm/companies', { ...as(owner), body: { name: 'Participants Co' } })).id;
  const funnel = await firstFunnel(owner, tenant);
  dealId = (await ok('POST', '/crm/deals', { ...as(owner), body: { title: 'Participants deal', funnelId: funnel.id, companyId } })).id;
});

describe('emails to internal participants', () => {
  it('invites the members someone else added, with a request .ics, but not the person who added them', async () => {
    const m = await create(owner, 'Kickoff call', { internalUserIds: [ana.userId, bo.userId], location: 'https://meet.example.test/abc' });
    for (const who of [ana, bo]) {
      const mail = await waitForSubject(who, 'You were added to a meeting: Kickoff call');
      expect(mail.text).toContain(`${owner.name} added you to Kickoff call with Participants Co`);
      expect(mail.text).toContain(`http://app.example.test/meetings/${m.id}`);
      const file = mail.attachments[0];
      expect(file).toMatchObject({ filename: 'meeting.ics', contentType: 'text/calendar; charset=utf-8; method=REQUEST' });
      const ics = icsOf(mail);
      expect(ics).toEqual(expect.arrayContaining(['METHOD:REQUEST', `UID:meeting-${m.id}@pultly.com`, 'SEQUENCE:0', 'STATUS:CONFIRMED', 'SUMMARY:Kickoff call']));
      expect(ics).toContain(`DTSTART:${m.startsAt.replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`);
      expect(ics.find((l) => l.startsWith('ATTENDEE'))).toContain(`mailto:${who.email}`);
    }
    // Ana adds herself to another meeting: no email to her; Bo, added by her, gets one.
    const other = await create(owner, 'Self added');
    await patch(owner, other.id, { internalUserIds: [ana.userId] });
    await patch(ana, other.id, { internalUserIds: [ana.userId, bo.userId] });
    await waitForSubject(bo, 'You were added to a meeting: Self added');
    const toAna = await mailsAbout(ana, 'Self added');
    expect(toAna.map((x: Json) => x.subject)).toEqual(['You were added to a meeting: Self added']); // from the owner, once
    expect(await mailsAbout(owner, 'Kickoff call')).toEqual([]);
  });

  it('sends nothing to someone who turned "Meeting invitations" off (read at send time)', async () => {
    await ok('PATCH', '/profile', { ...as(bo), body: { notifyMeetingInvites: false } });
    await create(owner, 'While Bo is off', { internalUserIds: [bo.userId] });
    // A marker queued after it: once it arrived, the job before it has run.
    await create(owner, 'Marker for Bo', { internalUserIds: [ana.userId] });
    await waitForSubject(ana, 'You were added to a meeting: Marker for Bo');
    await ok('PATCH', '/profile', { ...as(bo), body: { notifyMeetingInvites: true } });
    expect(await mailsAbout(bo, 'While Bo is off')).toEqual([]);
  });

  it('emails an update with a higher sequence when a planned meeting moves, but not for other changes', async () => {
    const m = await create(owner, 'Moving review', { internalUserIds: [ana.userId, bo.userId] });
    await waitForSubject(ana, 'You were added to a meeting: Moving review');
    await waitForSubject(bo, 'You were added to a meeting: Moving review');

    await patch(owner, m.id, { agenda: 'Only the agenda' });
    await patch(ana, m.id, { startsAt: future(72), endsAt: future(73) });
    const toBo = await waitForSubject(bo, 'Meeting changed: Moving review');
    expect(icsOf(toBo)).toEqual(expect.arrayContaining(['METHOD:REQUEST', 'SEQUENCE:1', `UID:meeting-${m.id}@pultly.com`]));
    await waitForSubject(owner, 'Meeting changed: Moving review');

    await patch(owner, m.id, { location: 'Room 2' });
    // Ana moved it herself, so the owner's change of place is the only update she gets.
    const toAna = await waitForSubject(ana, 'Meeting changed: Moving review');
    expect(icsOf(toAna)).toEqual(expect.arrayContaining(['SEQUENCE:2', 'LOCATION:Room 2']));
    expect((await mailsAbout(ana, 'Moving review')).map((x: Json) => x.subject)).toEqual(['Meeting changed: Moving review', 'You were added to a meeting: Moving review']);
    // Bo got both updates, and nothing for the agenda alone.
    const second = await eventually(async () => {
      const updates = (await mailsAbout(bo, 'Moving review')).filter((x: Json) => x.subject.startsWith('Meeting changed'));
      return updates.length >= 2 ? updates[0] : null;
    }, 'the second update to Bo');
    expect(icsOf(second)).toContain('SEQUENCE:2');
    expect(await mailsAbout(bo, 'Moving review')).toHaveLength(3);
  });

  it('emails a cancellation that cancels the calendar event, to everyone but the person who cancelled', async () => {
    const m = await create(owner, 'Cancelled sync', { internalUserIds: [ana.userId, bo.userId] });
    await waitForSubject(bo, 'You were added to a meeting: Cancelled sync');
    await ok('POST', `/crm/meetings/${m.id}/cancel`, { ...as(ana), body: { reason: 'Customer asked' } }, 200);
    for (const who of [owner, bo]) {
      const mail = await waitForSubject(who, 'Meeting cancelled: Cancelled sync');
      expect(mail.attachments[0].contentType).toBe('text/calendar; charset=utf-8; method=CANCEL');
      expect(icsOf(mail)).toEqual(expect.arrayContaining(['METHOD:CANCEL', 'STATUS:CANCELLED', 'SEQUENCE:1', `UID:meeting-${m.id}@pultly.com`]));
    }
    expect((await mailsAbout(ana, 'Cancelled sync')).map((x: Json) => x.subject)).toEqual(['You were added to a meeting: Cancelled sync']);
  });
});

describe('participants', () => {
  it('can be added and removed on held meetings, and show on the calendar and contact filters', async () => {
    const c1 = await ok('POST', '/crm/contacts', { ...as(owner), body: { fullName: 'Held Contact', companyId } });
    const m = await create(owner, 'Held one', { startsAt: iso(Date.now() - 3 * HOUR), endsAt: iso(Date.now() - 2 * HOUR) });
    await ok('POST', `/crm/meetings/${m.id}/held`, as(owner), 200);
    const held = await patch(owner, m.id, { internalUserIds: [bo.userId], externalContactIds: [c1.id] });
    expect(held.participants.map((p: Json) => p.userId ?? p.contactId)).toEqual([owner.userId, bo.userId, c1.id]);
    const window = `from=${iso(Date.now() - 10 * HOUR)}&to=${future(1)}`;
    expect((await ok('GET', `/crm/meetings?${window}&userId=${bo.userId}`, as(bo))).meetings.map((x: Json) => x.id)).toContain(m.id);
    expect((await ok('GET', `/crm/meetings?contactId=${c1.id}`, as(bo))).meetings.map((x: Json) => x.id)).toEqual([m.id]);
    const removed = await patch(owner, m.id, { internalUserIds: [], externalContactIds: [] });
    expect(removed.participants.map((p: Json) => p.userId)).toEqual([owner.userId]);
    expect((await ok('GET', `/crm/meetings?${window}&userId=${bo.userId}`, as(bo))).meetings.map((x: Json) => x.id)).not.toContain(m.id);
  });

  it('deleting a contact takes them off future planned meetings and keeps them, as deleted, on held ones', async () => {
    const c = await ok('POST', '/crm/contacts', { ...as(owner), body: { fullName: 'Gone Contact', companyId, email: 'gone@example.test' } });
    const upcoming = await create(owner, 'Upcoming with contact', { externalContactIds: [c.id] });
    const held = await create(owner, 'Held with contact', { externalContactIds: [c.id], startsAt: iso(Date.now() - 5 * HOUR), endsAt: iso(Date.now() - 4 * HOUR) });
    await ok('POST', `/crm/meetings/${held.id}/held`, as(owner), 200);
    const cancelled = await create(owner, 'Cancelled with contact', { externalContactIds: [c.id] });
    await ok('POST', `/crm/meetings/${cancelled.id}/cancel`, as(owner), 200);

    await ok('DELETE', `/crm/contacts/${c.id}`, as(owner));
    expect((await get(owner, upcoming.id)).participants.filter((p: Json) => p.kind === 'external')).toEqual([]);
    expect((await get(owner, held.id)).participants.find((p: Json) => p.kind === 'external')).toMatchObject({ contactId: null, name: 'Gone Contact', deleted: true });
    expect((await get(owner, cancelled.id)).participants.find((p: Json) => p.kind === 'external')).toMatchObject({ name: 'Gone Contact', deleted: true });
  });

  it('a member who leaves comes off future planned meetings; their meetings show "Organizer left" until an admin picks one', async () => {
    const carl = await signIn('mp-carl');
    await addMember(owner, tenant, carl, 'member');
    const organized = await create(carl, 'Carl organizes', { internalUserIds: [ana.userId] });
    const joins = await create(owner, 'Carl joins', { internalUserIds: [carl.userId] });
    const past = await create(carl, 'Carl was there', { startsAt: iso(Date.now() - 6 * HOUR), endsAt: iso(Date.now() - 5 * HOUR) });
    await ok('POST', `/crm/meetings/${past.id}/held`, as(carl), 200);

    await ok('DELETE', `/team/members/${carl.userId}`, as(owner));
    const left = await eventually(async () => {
      const m = await get(owner, organized.id);
      return m.organizerUserId === null ? m : null;
    }, 'the organizer to be cleared');
    expect(left).toMatchObject({ organizerUserId: null, organizerName: null });
    expect(left.participants.map((p: Json) => p.userId)).toEqual([ana.userId]);
    expect((await get(owner, joins.id)).participants.map((p: Json) => p.userId)).toEqual([owner.userId]);
    const kept = await get(owner, past.id);
    expect(kept.organizerUserId).toBe(carl.userId);
    expect(kept.participants.find((p: Json) => p.userId === carl.userId)).toMatchObject({ deleted: true, name: carl.name });

    // Members can't pick the new organizer (spec 5.3; CD-211), but can still edit the meeting.
    const refused = await call('PATCH', `/crm/meetings/${organized.id}`, { token: ana.token, tenant, body: { organizerUserId: ana.userId } });
    expect(refused.status).toBe(403);
    expect(refused.body.message).toContain('Only admins and owners can change the organizer');
    expect(await patch(ana, organized.id, { location: 'Room 2' })).toMatchObject({ organizerUserId: null, location: 'Room 2' });
    // An admin picks the new organizer, who is told they were added.
    const fixed = await patch(admin, organized.id, { organizerUserId: bo.userId });
    expect(fixed).toMatchObject({ organizerUserId: bo.userId, organizerName: bo.name });
    expect(fixed.participants.map((p: Json) => p.userId).sort()).toEqual([ana.userId, bo.userId].sort());
    await waitForSubject(bo, 'You were added to a meeting: Carl organizes');
  });
});
