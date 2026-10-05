// Meeting participants (CD-131): a colleague and a brand-new contact (made from the picker,
// without leaving the dialog) join a meeting; the colleague gets the invitation email with an .ics;
// when the organizer leaves the workspace the meeting shows "Organizer left" and an owner picks a
// new one.
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { api, BASE_URL, click, email, eventually, newUserWithWorkspace, RUN, setValue, steps, text, useBrowser } from '../lib/harness.mjs';

/** Signs a user in through the dev login from Node (no browser needed for them). */
async function devUser(label, name) {
  const res = await fetch(BASE_URL + '/api/auth/dev-login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: email(label), name }) });
  if (!res.ok) throw new Error('dev-login ' + res.status);
  const { accessToken } = await res.json();
  const me = await (await fetch(BASE_URL + '/api/me', { headers: { authorization: 'Bearer ' + accessToken } })).json();
  return { token: accessToken, email: email(label), id: me.user.id };
}

describe('meeting participants', () => {
  const browser = useBrowser();
  const step = steps(browser, 'meeting-participants');
  let page;
  let me;
  let nina;
  let company;
  let meetingId;
  const COMPANY = `Kestrel Foods ${RUN}`;
  const TITLE = `Meeting with ${COMPANY}`;
  // Two days from now at a whole hour, in the future whatever the time zone.
  const START = new Date(Math.ceil((Date.now() + 2 * 86_400_000) / 3_600_000) * 3_600_000).toISOString();

  step('an owner and a colleague share a workspace with a customer company', async () => {
    page = await browser.person('olga');
    await newUserWithWorkspace(page, { label: 'mp-olga', name: 'Olga Organizer', workspace: 'Participants Co' });
    me = (await api(page, '/me')).user;
    nina = await devUser('mp-nina', 'Nina Colleague');
    const { token } = await api(page, '/team/invitations', { method: 'POST', body: JSON.stringify({ email: nina.email, role: 'member' }) });
    const res = await fetch(`${BASE_URL}/api/invitations/${token}/accept`, { method: 'POST', headers: { authorization: 'Bearer ' + nina.token } });
    assert.equal(res.status, 200, 'accepted');
    company = await api(page, '/crm/companies', { method: 'POST', body: JSON.stringify({ name: COMPANY }) });
  });

  step('adds a colleague and a new contact made from the picker, then saves', async () => {
    await page.goto(`${BASE_URL}/calendar?new=1&companyId=${company.id}&type=online&start=${encodeURIComponent(START)}`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('.modal [data-testid=meeting-form]');
    await page.waitForFunction((title) => document.querySelector('[data-testid=meeting-title]').value === title, {}, TITLE);
    await setValue(page, '[data-testid=meeting-add-internal]', nina.id);
    await page.waitForFunction(() => document.querySelector('[data-testid=meeting-internal]').innerText.includes('Nina Colleague'));

    // "Add new contact" in the contact picker: the name typed in the search comes along.
    await click(page, '.meeting-picker .picker-search');
    await page.type('.meeting-picker .picker-search', 'Zora Newcontact');
    await click(page, '[data-testid=meeting-new-contact]');
    await page.waitForSelector('[data-testid=meeting-new-contact-form]');
    assert.equal(await page.$eval('[data-testid=new-contact-name]', (el) => el.value), 'Zora Newcontact');
    await page.type('[data-testid=new-contact-email]', 'zora@kestrel.example.com');
    await click(page, '[data-testid=new-contact-save]');
    await page.waitForFunction(() => document.querySelector('[data-testid=meeting-external]').innerText.includes('Zora Newcontact'), { timeout: 10_000 });
    assert.equal(await page.$('[data-testid=meeting-new-contact-form]'), null, 'the small form closed');

    await click(page, '[data-testid=meeting-save]');
    await page.waitForFunction(() => !document.querySelector('.modal [data-testid=meeting-form]'), { timeout: 10_000 });
    const saved = await eventually(async () => (await api(page, `/crm/meetings?companyId=${company.id}`)).meetings[0]);
    assert.ok(saved, 'the meeting was saved');
    meetingId = saved.id;
    assert.deepEqual(
      saved.participants.map((p) => [p.kind, p.name]),
      [
        ['internal', 'Olga Organizer'],
        ['internal', 'Nina Colleague'],
        ['external', 'Zora Newcontact'],
      ],
    );
    const contacts = await api(page, `/crm/contacts?companyId=${company.id}`);
    const list = Array.isArray(contacts) ? contacts : (contacts.contacts ?? contacts.items ?? []);
    assert.ok(list.some((c) => c.fullName === 'Zora Newcontact'), 'the contact belongs to the meeting company');
  });

  step('the colleague gets the invitation email with an .ics; the customer and the organizer get nothing', async () => {
    const mail = await eventually(async () => (await api(page, `/dev/mail?to=${encodeURIComponent(nina.email)}`)).find((m) => m.subject === `You were added to a meeting: ${TITLE}`), { timeout: 20_000 });
    assert.ok(mail, 'invitation email');
    assert.ok(mail.text.includes(`/meetings/${meetingId}`), 'links the meeting');
    assert.equal(mail.attachments?.[0]?.filename, 'meeting.ics');
    assert.match(mail.attachments[0].contentType, /^text\/calendar; charset=utf-8; method=REQUEST$/);
    const ics = mail.attachments[0].content.replace(/\r\n /g, '');
    assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
    assert.match(ics, new RegExp(`UID:meeting-${meetingId}@pultly\\.com\\r\\n`));
    assert.match(ics, /METHOD:REQUEST\r\n/);
    assert.deepEqual(await api(page, `/dev/mail?to=${encodeURIComponent('zora@kestrel.example.com')}`), []);
    assert.equal((await api(page, `/dev/mail?to=${encodeURIComponent(me.email)}`)).filter((m) => m.subject.endsWith(TITLE)).length, 0);
  });

  step('when the organizer leaves, the meeting shows "Organizer left" and an owner picks a new one', async () => {
    const theirs = await api(page, '/crm/meetings', {
      method: 'POST',
      body: JSON.stringify({ title: `Nina's review ${RUN}`, type: 'online', startsAt: START, endsAt: new Date(Date.parse(START) + 3_600_000).toISOString(), companyId: company.id, organizerUserId: nina.id }),
    });
    await api(page, `/team/members/${nina.id}`, { method: 'DELETE' });
    const left = await eventually(async () => (await api(page, `/crm/meetings/${theirs.id}`)).organizerUserId === null, { timeout: 20_000 });
    assert.ok(left, 'the organizer was cleared');

    await page.goto(`${BASE_URL}/meetings/${theirs.id}`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-testid=meeting-organizer-left]');
    await click(page, '[data-testid=meeting-pick-organizer]');
    await setValue(page, '[data-testid=new-organizer]', me.id);
    await click(page, '[data-testid=new-organizer-save]');
    await page.waitForFunction(() => !document.querySelector('[data-testid=meeting-organizer-left]'), { timeout: 10_000 });
    assert.ok((await page.$eval('[data-testid=meeting-details]', (el) => el.innerText)).includes('Olga Organizer'));
    assert.equal((await api(page, `/crm/meetings/${theirs.id}`)).organizerUserId, me.id);

    // The first meeting (still to come) lost Nina; the page says nothing about a former member.
    const first = await api(page, `/crm/meetings/${meetingId}`);
    assert.deepEqual(
      first.participants.filter((p) => p.kind === 'internal').map((p) => p.name),
      ['Olga Organizer'],
    );
    assert.ok(!(await text(page)).includes('Organizer left'));
  });
});
