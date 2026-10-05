/**
 * External minutes sent by email (CD-133, CD-208): the template on the first read only, "Copy from
 * internal minutes", saving with conflicts, who may send and when (held only), recipients (external
 * participants with an email; members as CC; nothing typed), the email the worker sends (from the
 * sender's name, reply-to the sender), per-recipient failure and retry, the deal timeline, undo held
 * and delete refused after a send, the internal minutes never in the email, and Serbian chrome.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { addMember, call, createTenant, eventually, firstFunnel, type Funnel, type Json, mailTo, ok, type Session, signIn } from './helpers';

let owner: Session;
let ana: Session;
let bo: Session;
let tenant: string;
let funnel: Funnel;
let companyId: string;
let dealId: string;
let jovan: Json;
let mara: Json;
let noMail: Json;
let bounce: Json;
let stranger: Json;
const as = (s: Session) => ({ token: s.token, tenant });

const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();
const RUN = Date.now().toString(36);

const ext = (id: string) => `/crm/meetings/${id}/minutes/external`;
/** A meeting that ended an hour ago with Ana inside and the customer's people outside; held unless `planned`. */
async function meeting(title: string, { planned = false, contacts }: { planned?: boolean; contacts?: string[] } = {}) {
  const m = await ok('POST', '/crm/meetings', {
    ...as(owner),
    body: {
      title,
      type: 'visit',
      startsAt: iso(Date.now() - 2 * HOUR),
      endsAt: iso(Date.now() - HOUR),
      location: 'Bulevar 1',
      companyId,
      dealId,
      internalUserIds: [ana.userId],
      externalContactIds: contacts ?? [jovan.id, mara.id, noMail.id, bounce.id],
    },
  });
  if (!planned) await ok('POST', `/crm/meetings/${m.id}/held`, as(owner), 200);
  return m;
}
const request = (body: Record<string, unknown>) => ({ subject: 'Minutes', body: 'Thank you for the meeting.', toContactIds: [jovan.id], ccUserIds: [], ...body });
const send = (s: Session, id: string, body: Record<string, unknown> = {}) => call('POST', `/crm/meetings/${id}/minutes/send`, { ...as(s), body: request(body) });
const sends = (id: string) => ok('GET', `/crm/meetings/${id}/minutes/sends`, as(owner));
/** The newest email to `to` with this subject, once the worker sent it. */
const mailWith = (to: string, subject: string) => eventually(async () => (await mailTo(owner, to)).find((m: Json) => m.subject === subject) as Json, `"${subject}" to ${to}`);
/** Waits until no recipient of the meeting's newest send is queued. */
const settled = (id: string) => eventually(async () => {
  const [latest] = await sends(id);
  return latest && latest.status !== 'queued' ? latest : null;
}, 'the send to settle', 30_000);

beforeAll(async () => {
  owner = await signIn('mme-owner');
  ana = await signIn('mme-ana');
  bo = await signIn('mme-bo');
  tenant = await createTenant(owner, 'Minutes email');
  await addMember(owner, tenant, ana, 'member');
  await addMember(owner, tenant, bo, 'member');
  funnel = await firstFunnel(owner, tenant);
  companyId = (await ok('POST', '/crm/companies', { ...as(owner), body: { name: 'Customer Co' } })).id;
  dealId = (await ok('POST', '/crm/deals', { ...as(owner), body: { title: 'Customer deal', funnelId: funnel.id, companyId } })).id;
  const contact = (fullName: string, email: string | null) => ok('POST', '/crm/contacts', { ...as(owner), body: { fullName, companyId, email } });
  jovan = await contact('Jovan Jovanović', `jovan-${RUN}@customer.example.test`);
  mara = await contact('Mara Marić', `mara-${RUN}@customer.example.test`);
  noMail = await contact('No Mail', null);
  bounce = await contact('Bounce Person', `bounce-${RUN}@nowhere.invalid`);
  stranger = await contact('Not Invited', `stranger-${RUN}@customer.example.test`);
});

describe('the external text', () => {
  it('is prefilled from the template on the first read only; "Copy from internal minutes" reads them as they are now', async () => {
    const m = await meeting('Template review');
    await ok('PUT', `/crm/meetings/${m.id}/minutes/internal`, {
      ...as(ana),
      body: { agreements: 'Pilot in Belgrade', nextSteps: [{ id: crypto.randomUUID(), text: 'Send the offer', ownerUserId: bo.userId, dueDate: null }] },
    });
    // A read-only viewer (Bo isn't at the meeting) doesn't fill it in (CD-211).
    expect(await ok('GET', ext(m.id), as(bo))).toMatchObject({ prefilled: false, subject: '', body: '', updatedAt: null });
    const first = await ok('GET', ext(m.id), as(ana));
    expect(first.prefilled).toBe(true);
    expect(first.subject).toMatch(/^Minutes: Template review, \d+ \w{3} \d{4}$/);
    expect(first.body).toContain('**Template review**');
    const side = (prefix: string) => first.body.split('\n').find((l: string) => l.startsWith(prefix)) ?? '';
    const customers = side('- Customer Co: ');
    for (const name of ['Jovan Jovanović', 'Mara Marić', 'No Mail', 'Bounce Person']) expect(customers).toContain(name);
    expect(side('- Minutes email ')).toContain(`${owner.name}, ${ana.name}`);
    expect(first.body).toContain('**Agreements**\nPilot in Belgrade');
    // Next steps without their (internal) owners.
    expect(first.body).toContain('**Next steps**\n- Send the offer');
    expect(first.body).not.toContain(bo.name);
    expect(first).toMatchObject({ lastSend: null, changedSinceLastSend: false, language: 'en' });

    await ok('PUT', `/crm/meetings/${m.id}/minutes/internal`, { ...as(ana), body: { agreements: 'Pilot in Novi Sad' } });
    const again = await ok('GET', ext(m.id), as(owner));
    expect(again.body).toBe(first.body);
    expect(again.body).not.toContain('Novi Sad');
    const copy = await ok('POST', `/crm/meetings/${m.id}/minutes/external/copy-internal`, as(ana), 200);
    expect(copy.body).toContain('Pilot in Novi Sad');
    expect((await ok('GET', ext(m.id), as(owner))).body).toBe(first.body);
  });

  it('is filled in only once the meeting is held (CD-211)', async () => {
    const m = await meeting('Too early', { planned: true });
    expect(await ok('GET', ext(m.id), as(owner))).toMatchObject({ prefilled: false, subject: '', body: '' });
    await ok('POST', `/crm/meetings/${m.id}/held`, as(owner), 200);
    const held = await ok('GET', ext(m.id), as(ana));
    expect(held.prefilled).toBe(true);
    expect(held.body).toContain('**Too early**');
  });

  it('is saved by the people who may change the meeting, with conflicts caught', async () => {
    const m = await meeting('Saving text');
    const base = await ok('GET', ext(m.id), as(ana));
    expect((await call('PUT', ext(m.id), { ...as(bo), body: { body: 'Bo' } })).status).toBe(403);
    const saved = await ok('PUT', ext(m.id), { ...as(ana), body: { subject: 'Our minutes', body: 'Ana wrote this' }, headers: { 'if-match': `"${base.updatedAt}"` } });
    expect(saved).toMatchObject({ subject: 'Our minutes', body: 'Ana wrote this', updatedByName: ana.name });
    const stale = await call('PUT', ext(m.id), { ...as(owner), body: { body: 'Owner overwrites' }, headers: { 'if-match': `"${base.updatedAt}"` } });
    expect(stale.status).toBe(409);
    expect(stale.body.message).toContain(`${ana.name} changed the external minutes`);
    expect((await ok('GET', ext(m.id), as(owner))).body).toBe('Ana wrote this');
  });
});

describe('sending', () => {
  it('only for a held meeting, by the people who may change it, to its external participants with an email', async () => {
    const planned = await meeting('Not held yet', { planned: true });
    const early = await send(owner, planned.id);
    expect(early.status).toBe(409);
    expect(early.body.message).toMatch(/held/);

    const m = await meeting('Recipients check');
    expect((await send(bo, m.id)).status).toBe(403);
    const cases: Record<string, unknown>[] = [
      { toContactIds: [noMail.id] }, // no email
      { toContactIds: [stranger.id] }, // not a participant
      { toContactIds: [] }, // nobody
      { toContactIds: ['someone@example.test'] }, // typed address
      { to: ['someone@example.test'] }, // typed address, another field
      { ccUserIds: [crypto.randomUUID()] }, // not a member
      { subject: '  ' },
    ];
    for (const c of cases) {
      const res = await send(owner, m.id, c);
      expect(res.status, JSON.stringify(c)).toBe(400);
      expect((await call('POST', `/crm/meetings/${m.id}/minutes/preview`, { ...as(owner), body: request(c) })).status, JSON.stringify(c)).toBe(400);
    }
    expect((await call('POST', `/crm/meetings/${m.id}/minutes/send`, { ...as(owner), body: request({ toContactIds: [noMail.id] }) })).body.message).toContain('No Mail has no email address');
    expect(await sends(m.id)).toEqual([]);
  });

  it('previews the exact email, sends it in the background with reply-to the sender, logs it and writes the timeline', async () => {
    const m = await meeting('Quarterly review');
    const before = await ok('GET', `/crm/deals/${dealId}`, as(owner));
    const subject = `Minutes: Quarterly review ${RUN}`;
    const body = 'We agreed on:\n- a **pilot**\n- pricing by Friday';
    const preview = await ok('POST', `/crm/meetings/${m.id}/minutes/preview`, { ...as(ana), body: request({ subject, body, toContactIds: [jovan.id, mara.id], ccUserIds: [bo.userId] }) }, 200);
    expect(preview.from).toBe(`"${ana.name}" <no-reply@localhost>`);
    expect(preview.replyTo).toBe(ana.email);
    expect(preview.to).toEqual([
      { name: 'Jovan Jovanović', email: jovan.email },
      { name: 'Mara Marić', email: mara.email },
    ]);
    expect(preview.cc).toEqual([{ name: bo.name, email: bo.email }]);
    expect(preview.subject).toBe(subject);
    expect(preview.html).toContain('<strong>pilot</strong>');
    expect(preview.text).toContain('Meeting minutes');

    const res = await send(ana, m.id, { subject, body, toContactIds: [jovan.id, mara.id], ccUserIds: [bo.userId] });
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ subject, body, senderName: ana.name, senderEmail: ana.email, language: 'en' });
    expect(res.body.recipients.map((r: Json) => [r.kind, r.email, r.status])).toEqual([
      ['to', jovan.email, 'queued'],
      ['to', mara.email, 'queued'],
      ['cc', bo.email, 'queued'],
    ]);

    const mail = await mailWith(jovan.email, subject);
    expect(mail).toMatchObject({ to: [jovan.email, mara.email], cc: [bo.email], replyTo: ana.email, from: `"${ana.name}" <no-reply@localhost>` });
    expect(mail.text).toBe(preview.text);
    expect(mail.html).toBe(preview.html);
    expect((await mailTo(owner, bo.email)).some((x: Json) => x.subject === subject)).toBe(true);

    const done = await settled(m.id);
    expect(done.status).toBe('sent');
    expect(done.recipients.every((r: Json) => r.status === 'sent' && r.sentAt)).toBe(true);
    expect((await ok('GET', `/crm/meetings/${m.id}`, as(owner))).externalDelivery).toBe('sent');
    const text = await ok('GET', ext(m.id), as(owner));
    expect(text.lastSend.id).toBe(res.body.id);

    const timeline = await ok('GET', `/crm/deals/${dealId}/activities`, as(owner));
    const entry = timeline.find((a: Json) => a.title === 'Minutes sent · Quarterly review');
    expect(entry).toMatchObject({ channel: 'EM' });
    expect(entry.detail).toContain(`Jovan Jovanović (${jovan.email})`);
    expect(entry.detail).toContain(`Cc: ${bo.name}`);
    const after = await ok('GET', `/crm/deals/${dealId}`, as(owner));
    expect(new Date(after.lastContactAt).getTime()).toBeGreaterThan(before.lastContactAt ? new Date(before.lastContactAt).getTime() : 0);
  });

  it('tracks failure per recipient and retries only the failed ones', async () => {
    const m = await meeting('Partly failing');
    const subject = `Partly failing ${RUN}`;
    const res = await send(owner, m.id, { subject, toContactIds: [jovan.id, bounce.id] });
    expect(res.status).toBe(202);
    await mailWith(jovan.email, subject);
    const first = await settled(m.id);
    expect(first.status).toBe('failed');
    const failed = first.recipients.find((r: Json) => r.email === bounce.email);
    expect(failed).toMatchObject({ status: 'failed', error: expect.stringMatching(/refused/) });
    expect(first.recipients.find((r: Json) => r.email === jovan.email).status).toBe('sent');
    expect((await ok('GET', `/crm/meetings/${m.id}`, as(owner))).externalDelivery).toBe('failed');

    const retried = await ok('POST', `/crm/meetings/${m.id}/minutes/sends/${first.id}/retry`, as(owner), 202);
    expect(retried.recipients.map((r: Json) => r.status).sort()).toEqual(['queued', 'sent']);
    const second = await settled(m.id);
    expect(second.recipients.find((r: Json) => r.email === bounce.email).status).toBe('failed');
    // Jovan got it once: the retry went only to the failed address.
    expect((await mailTo(owner, jovan.email)).filter((x: Json) => x.subject === subject)).toHaveLength(1);

    // Everyone refused: the whole send fails after its retries, with the reason.
    const all = await send(owner, m.id, { subject: `All refused ${RUN}`, toContactIds: [bounce.id] });
    expect(all.status).toBe(202);
    const gone = await settled(m.id);
    expect(gone.id).toBe(all.body.id);
    expect(gone.recipients[0]).toMatchObject({ status: 'failed', error: expect.stringMatching(/Mailbox unavailable/) });

    const ok2 = await send(owner, m.id, { subject: `Fine now ${RUN}`, toContactIds: [jovan.id] });
    const fine = await settled(m.id);
    expect(fine.id).toBe(ok2.body.id);
    const nothing = await call('POST', `/crm/meetings/${m.id}/minutes/sends/${fine.id}/retry`, as(owner));
    expect(nothing.status).toBe(409);
    expect((await sends(m.id)).map((s: Json) => s.subject)).toEqual([`Fine now ${RUN}`, `All refused ${RUN}`, subject]);
  });

  it('keeps a sent meeting held and undeletable; the text stays editable and says when it changed', async () => {
    const m = await meeting('Kept meeting');
    await ok('PUT', ext(m.id), { ...as(owner), body: { subject: 'Kept', body: 'Version 1' } });
    await send(owner, m.id, { subject: 'Kept', body: 'Version 1' });
    const undo = await call('POST', `/crm/meetings/${m.id}/undo-held`, as(owner));
    expect(undo.status).toBe(409);
    expect(undo.body.message).toBe('Minutes were sent to the customer, so this meeting stays held.');
    const del = await call('DELETE', `/crm/meetings/${m.id}`, as(owner));
    expect(del.status).toBe(409);
    expect((await ok('GET', `/crm/meetings/${m.id}`, as(owner))).status).toBe('held');

    expect((await ok('GET', ext(m.id), as(owner))).changedSinceLastSend).toBe(false);
    await ok('PUT', ext(m.id), { ...as(owner), body: { body: 'Version 2' } });
    expect((await ok('GET', ext(m.id), as(owner))).changedSinceLastSend).toBe(true);
  });
});

describe('the internal minutes never reach the customer (spec 6.2, AC 7.3.4)', () => {
  it('leaves a marker written only in the internal minutes out of the preview and the email', async () => {
    const MARKER = `INTERNAL-ONLY-${RUN}`;
    const m = await meeting('Marker meeting');
    // The external text exists before the internal minutes get the marker (the template copies agreements once).
    const text = await ok('GET', ext(m.id), as(owner));
    await ok('PUT', `/crm/meetings/${m.id}/minutes/internal`, {
      ...as(ana),
      body: { summary: `Summary ${MARKER}`, agreements: `Agreements ${MARKER}`, nextSteps: [{ id: crypto.randomUUID(), text: `Step ${MARKER}`, ownerUserId: null, dueDate: null }] },
    });
    const subject = `Marker check ${RUN}`;
    const preview = await ok('POST', `/crm/meetings/${m.id}/minutes/preview`, { ...as(owner), body: request({ subject, body: text.body, ccUserIds: [ana.userId] }) }, 200);
    expect(JSON.stringify(preview)).not.toContain(MARKER);
    await send(owner, m.id, { subject, body: text.body, ccUserIds: [ana.userId] });
    const mail = await mailWith(jovan.email, subject);
    for (const part of [JSON.stringify(mail.to), JSON.stringify(mail.cc), mail.subject, mail.text, mail.html]) expect(part).not.toContain(MARKER);
    expect(JSON.stringify(await sends(m.id))).not.toContain(MARKER);
  });
});

describe('customer email language (CD-208)', () => {
  it('writes the chrome in Serbian when the workspace chose it', async () => {
    await ok('PATCH', '/workspace', { ...as(owner), body: { customerEmailLanguage: 'sr' } });
    try {
      const m = await meeting('Sastanak');
      const text = await ok('GET', ext(m.id), as(owner));
      expect(text.language).toBe('sr');
      expect(text.subject).toMatch(/^Zapisnik: Sastanak, \d+\. \d+\. \d{4}\.$/);
      expect(text.body).toContain('Učesnici:');
      const subject = `Zapisnik ${RUN}`;
      const res = await send(owner, m.id, { subject, body: 'Hvala na sastanku.' });
      expect(res.body.language).toBe('sr');
      const mail = await mailWith(jovan.email, subject);
      expect(mail.text).toContain('Zapisnik sa sastanka');
      expect(mail.text).toContain(`Poslao/la: ${owner.name}`);
      expect(mail.text).toContain('Odgovorite na ovu poruku');
      expect(mail.text).not.toContain('Reply to this email');
    } finally {
      await ok('PATCH', '/workspace', { ...as(owner), body: { customerEmailLanguage: 'en' } });
    }
  });
});
