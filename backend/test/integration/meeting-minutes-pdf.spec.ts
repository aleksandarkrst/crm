/**
 * The external minutes as a PDF (CD-378): the send attaches it as "Minutes <title> <date>.pdf",
 * the send log downloads exactly that file (also after a retry and after a later send), "Download
 * PDF" before any send, who may download, and the workspace logo (owners and admins set it; PNG or
 * JPG up to 1 MB; per workspace).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { PULTLY_MARK_PNG } from '../../src/modules/crm/meetings/minutes-pdf-mark';
import { addMember, call, createTenant, eventually, type Json, mailTo, ok, readyCompany, type Session, signIn, firstFunnel } from './helpers';

let owner: Session;
let ana: Session;
let bo: Session;
let outsider: Session;
let tenant: string;
let otherTenant: string;
let companyId: string;
let dealId: string;
let jovan: Json;
let bounce: Json;
const as = (s: Session, t = tenant) => ({ token: s.token, tenant: t });

const HOUR = 3_600_000;
const RUN = Date.now().toString(36);

/** Binary and multipart calls, which helpers.call (JSON only) doesn't do. */
async function raw(method: string, path: string, s: Session, opts: { tenant?: string; form?: FormData } = {}) {
  const res = await fetch(`${inject('apiUrl')}/api${path}`, { method, headers: { authorization: `Bearer ${s.token}`, 'x-tenant-id': opts.tenant ?? tenant }, body: opts.form });
  const bytes = Buffer.from(await res.arrayBuffer());
  let json: Json = null;
  try {
    json = JSON.parse(bytes.toString('utf8'));
  } catch {
    // binary
  }
  return { status: res.status, bytes, json, headers: res.headers };
}
const logoForm = (bytes: Buffer, type = 'image/png', name = 'logo.png') => {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(bytes)], { type }), name);
  return form;
};

/** A held meeting with Ana inside and Jovan (and a refused address) outside. */
async function heldMeeting(title: string) {
  const m = await ok('POST', '/crm/meetings', {
    ...as(owner),
    body: { title, type: 'visit', startsAt: new Date(Date.now() - 2 * HOUR).toISOString(), endsAt: new Date(Date.now() - HOUR).toISOString(), location: 'Bulevar 1', companyId, dealId, internalUserIds: [ana.userId], externalContactIds: [jovan.id, bounce.id] },
  });
  await ok('POST', `/crm/meetings/${m.id}/held`, as(owner), 200);
  return m;
}
const send = (id: string, body: Record<string, unknown>) => ok('POST', `/crm/meetings/${id}/minutes/send`, { ...as(owner), body: { subject: 'Minutes', body: 'Thank you.', toContactIds: [jovan.id], ccUserIds: [], ...body } }, 202);
const sends = (id: string) => ok('GET', `/crm/meetings/${id}/minutes/sends`, as(owner));
const settled = (id: string, sendId: string) =>
  eventually(async () => {
    const found = (await sends(id)).find((x: Json) => x.id === sendId);
    return found && found.status !== 'queued' ? found : null;
  }, 'the send to settle', 30_000);
const fileName = (headers: Headers) => decodeURIComponent(/filename\*=UTF-8''([^;]+)/.exec(headers.get('content-disposition') ?? '')?.[1] ?? '');

beforeAll(async () => {
  [owner, ana, bo, outsider] = await Promise.all([signIn('mpdf-owner'), signIn('mpdf-ana'), signIn('mpdf-bo'), signIn('mpdf-outsider')]);
  [tenant, otherTenant] = await Promise.all([createTenant(owner, 'Minutes PDF'), createTenant(outsider, 'Minutes PDF other')]);
  await addMember(owner, tenant, ana, 'member');
  await addMember(owner, tenant, bo, 'member');
  const funnel = await firstFunnel(owner, tenant);
  companyId = (await readyCompany(owner, tenant, 'PDF Customer')).id;
  dealId = (await ok('POST', '/crm/deals', { ...as(owner), body: { title: 'PDF deal', funnelId: funnel.id, companyId } })).id;
  jovan = await ok('POST', '/crm/contacts', { ...as(owner), body: { fullName: 'Jovan Jovanović', companyId, email: `jovan-pdf-${RUN}@customer.example.test` } });
  bounce = await ok('POST', '/crm/contacts', { ...as(owner), body: { fullName: 'Bounce Person', companyId, email: `bounce-pdf-${RUN}@nowhere.invalid` } });
});

describe('the PDF of a send', () => {
  it('is attached to the email, and the send log downloads exactly that file', async () => {
    const m = await heldMeeting('Kickoff / phase 1');
    const subject = `PDF attached ${RUN}`;
    const sent = await send(m.id, { subject });
    const date = new Date(m.startsAt).toLocaleDateString('sv-SE', { timeZone: 'Europe/Belgrade' });
    const name = `Minutes Kickoff phase 1 ${date}.pdf`;
    expect(sent.pdfFileName).toBe(name);

    const mail = await eventually(async () => (await mailTo(owner, jovan.email)).find((x: Json) => x.subject === subject) as Json, 'the minutes email');
    expect(mail.attachments).toHaveLength(1);
    expect(mail.attachments[0]).toMatchObject({ filename: name, contentType: 'application/pdf', encoding: 'base64' });
    const attached = Buffer.from(mail.attachments[0].content, 'base64');
    expect(attached.subarray(0, 5).toString()).toBe('%PDF-');

    const download = await raw('GET', `/crm/meetings/${m.id}/minutes/sends/${sent.id}/pdf`, owner);
    expect(download.status).toBe(200);
    expect(download.headers.get('content-type')).toBe('application/pdf');
    expect(fileName(download.headers)).toBe(name);
    expect(download.bytes.equals(attached)).toBe(true);
  });

  it('stays the same file after a retry and after a later send with new text', async () => {
    const m = await heldMeeting('Retry keeps the file');
    const first = await send(m.id, { subject: `First ${RUN}`, body: 'Version 1', toContactIds: [jovan.id, bounce.id] });
    const failed = await settled(m.id, first.id);
    expect(failed.status).toBe('failed');
    const before = (await raw('GET', `/crm/meetings/${m.id}/minutes/sends/${first.id}/pdf`, owner)).bytes;

    await ok('POST', `/crm/meetings/${m.id}/minutes/sends/${first.id}/retry`, as(owner), 202);
    await settled(m.id, first.id);
    expect((await raw('GET', `/crm/meetings/${m.id}/minutes/sends/${first.id}/pdf`, owner)).bytes.equals(before)).toBe(true);

    const second = await send(m.id, { subject: `Second ${RUN}`, body: 'Version 2, longer and different' });
    const later = (await raw('GET', `/crm/meetings/${m.id}/minutes/sends/${second.id}/pdf`, owner)).bytes;
    expect(later.equals(before)).toBe(false);
    expect((await raw('GET', `/crm/meetings/${m.id}/minutes/sends/${first.id}/pdf`, owner)).bytes.equals(before)).toBe(true);
    expect((await sends(m.id)).map((x: Json) => !!x.pdfFileName)).toEqual([true, true]);
  });

  it('is read by members of the workspace only', async () => {
    const m = await heldMeeting('Who reads it');
    const sent = await send(m.id, { subject: `Readers ${RUN}` });
    const path = `/crm/meetings/${m.id}/minutes/sends/${sent.id}/pdf`;
    // Bo isn't at the meeting, but every member reads meetings.
    expect((await raw('GET', path, bo)).status).toBe(200);
    expect((await raw('GET', path, outsider)).status).toBe(403);
    expect((await raw('GET', path, outsider, { tenant: otherTenant })).status).toBe(404);
    expect((await raw('GET', `/crm/meetings/${m.id}/minutes/external/pdf`, outsider, { tenant: otherTenant })).status).toBe(404);
    expect((await raw('GET', `/crm/meetings/${m.id}/minutes/sends/${crypto.randomUUID()}/pdf`, owner)).status).toBe(404);
  });
});

describe('"Download PDF" before sending', () => {
  it('renders the saved text, for any member', async () => {
    const m = await heldMeeting('Draft check');
    await ok('GET', `/crm/meetings/${m.id}/minutes/external`, as(ana));
    await ok('PUT', `/crm/meetings/${m.id}/minutes/external`, { ...as(ana), body: { subject: 'Draft', body: 'Only saved text goes in.' } });
    const res = await raw('GET', `/crm/meetings/${m.id}/minutes/external/pdf`, bo);
    expect(res.status).toBe(200);
    expect(res.bytes.subarray(0, 5).toString()).toBe('%PDF-');
    expect(fileName(res.headers)).toMatch(/^Minutes Draft check \d{4}-\d{2}-\d{2}\.pdf$/);
    expect(await sends(m.id)).toEqual([]);
  });
});

describe('the workspace logo', () => {
  it('is set, replaced and removed by owners and admins, and goes in the PDF header', async () => {
    const m = await heldMeeting('Logo header');
    const without = (await raw('GET', `/crm/meetings/${m.id}/minutes/external/pdf`, owner)).bytes;
    expect((await raw('GET', '/workspace/logo', owner)).status).toBe(404);

    expect((await raw('PUT', '/workspace/logo', ana, { form: logoForm(PULTLY_MARK_PNG) })).status).toBe(403);
    const set = await raw('PUT', '/workspace/logo', owner, { form: logoForm(PULTLY_MARK_PNG) });
    expect(set.status).toBe(200);
    expect(set.json.logoUpdatedAt).toBeTruthy();
    const image = await raw('GET', '/workspace/logo', bo);
    expect(image.status).toBe(200);
    expect(image.headers.get('content-type')).toBe('image/png');
    expect(image.bytes.equals(PULTLY_MARK_PNG)).toBe(true);

    const withLogo = (await raw('GET', `/crm/meetings/${m.id}/minutes/external/pdf`, owner)).bytes;
    expect(withLogo.length).toBeGreaterThan(without.length);

    // Another workspace never sees it.
    expect((await raw('GET', '/workspace/logo', outsider, { tenant: otherTenant })).status).toBe(404);

    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(10)]);
    const replaced = await raw('PUT', '/workspace/logo', owner, { form: logoForm(PULTLY_MARK_PNG, 'image/png', 'again.png') });
    expect(replaced.status).toBe(200);
    expect(replaced.json.logoUpdatedAt).not.toBe(set.json.logoUpdatedAt);

    expect((await raw('DELETE', '/workspace/logo', bo)).status).toBe(403);
    const removed = await raw('DELETE', '/workspace/logo', owner);
    expect(removed.status).toBe(200);
    expect(removed.json.logoUpdatedAt).toBeNull();
    expect((await raw('GET', '/workspace/logo', owner)).status).toBe(404);
    // A JPEG that can't be decoded is refused rather than breaking the minutes later.
    expect((await raw('PUT', '/workspace/logo', owner, { form: logoForm(jpeg, 'image/jpeg', 'broken.jpg') })).json.message).toMatch(/can't be read/);
  });

  it('refuses other files and files over 1 MB with a clear message', async () => {
    const gif = await raw('PUT', '/workspace/logo', owner, { form: logoForm(Buffer.from('GIF89a-not-a-logo'), 'image/png', 'logo.png') });
    expect(gif.status).toBe(400);
    expect(gif.json.message).toBe('The logo must be a PNG or JPG image.');
    const big = await raw('PUT', '/workspace/logo', owner, { form: logoForm(Buffer.concat([PULTLY_MARK_PNG, Buffer.alloc(1024 * 1024)])) });
    expect(big.status).toBe(400);
    expect(big.json.message).toBe('The logo can be at most 1 MB. Choose a smaller image.');
    expect((await raw('PUT', '/workspace/logo', owner)).json.message).toBe('Choose a PNG or JPG image');
    expect((await call('GET', '/workspace', as(owner))).body.logoUpdatedAt).toBeNull();
  });
});
