// External minutes sent by email (CD-133): a meeting is marked as held, the text for the customer
// (prefilled from the template) is rewritten and saves itself, the preview shows exactly who gets
// it (a contact without an email can't be picked), Send sends it, the tab says "Minutes sent to …",
// the customer's email (reply-to the sender) is in the dev outbox, the History tab has the send
// log, and the meeting can no longer be set back to planned or deleted.
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { api, BASE_URL, click, eventually, newUserWithWorkspace, RUN, setValue, steps, useBrowser } from '../lib/harness.mjs';

describe('external minutes by email', () => {
  const browser = useBrowser();
  const step = steps(browser, 'meeting-minutes-email');
  let page;
  let me;
  let meeting;
  let jovan;
  const CUSTOMER = `jovan-${RUN}@customer.example.com`;
  const SUBJECT = `Minutes: Pilot review ${RUN}`;
  const BODY = 'Thank you for the meeting.\n- We start the **pilot** in November';

  step('sets up a meeting that took place, with a customer contact with and one without an email', async () => {
    page = await browser.person('erin');
    await newUserWithWorkspace(page, { label: 'mme-erin', name: 'Erin Sender', workspace: 'Minutes Email Co' });
    me = (await api(page, '/me')).user;
    const company = await api(page, '/crm/companies', { method: 'POST', body: JSON.stringify({ name: `Initech ${RUN}` }) });
    const funnels = await api(page, '/crm/funnels');
    const deal = await api(page, '/crm/deals', { method: 'POST', body: JSON.stringify({ title: 'Initech pilot', funnelId: funnels[0].id, companyId: company.id }) });
    jovan = await api(page, '/crm/contacts', { method: 'POST', body: JSON.stringify({ fullName: 'Jovan Customer', companyId: company.id, email: CUSTOMER }) });
    const noMail = await api(page, '/crm/contacts', { method: 'POST', body: JSON.stringify({ fullName: 'Nora Nomail', companyId: company.id }) });
    const start = Date.now() - 2 * 3_600_000;
    meeting = await api(page, '/crm/meetings', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Pilot review',
        type: 'visit',
        startsAt: new Date(start).toISOString(),
        endsAt: new Date(start + 3_600_000).toISOString(),
        companyId: company.id,
        dealId: deal.id,
        externalContactIds: [jovan.id, noMail.id],
      }),
    });
  });

  step('explains that sending waits for the meeting to be held, then marks it as held', async () => {
    await page.goto(`${BASE_URL}/meetings/${meeting.id}`, { waitUntil: 'networkidle0' });
    await click(page, '[data-testid=meeting-tab-external]');
    await page.waitForSelector('[data-testid=external-not-held]');
    assert.equal(await page.$eval('[data-testid=external-send]', (el) => el.disabled), true, 'no sending before held');
    await click(page, '[data-testid=meeting-held]');
    await page.waitForSelector('[data-testid=meeting-undo-held]', { timeout: 10_000 });
    await page.waitForSelector('[data-testid=external-recipients]', { timeout: 10_000 });
  });

  step('the text starts from the template and saves itself after editing', async () => {
    // The template is filled in once the meeting is held (CD-211): the open tab reads it again.
    await page.waitForFunction(() => document.querySelector('[data-testid=external-subject]')?.value.startsWith('Minutes: '), { timeout: 10_000 });
    const subject = await page.$eval('[data-testid=external-subject]', (el) => el.value);
    assert.match(subject, /^Minutes: Pilot review, /);
    await page.waitForSelector('[data-testid=external-body-view]');
    assert.match(await page.$eval('[data-testid=external-body-view]', (el) => el.innerText), /Initech/);

    await setValue(page, '[data-testid=external-subject]', SUBJECT);
    await click(page, '[data-testid=external-body-view]');
    await page.waitForSelector('textarea[data-testid=external-body]');
    await setValue(page, 'textarea[data-testid=external-body]', BODY);
    await page.waitForFunction(() => document.querySelector('[data-testid=external-save-state]')?.textContent === 'Saved', { timeout: 10_000 });
    let last;
    const stored = await eventually(async () => {
      last = await api(page, `/crm/meetings/${meeting.id}/minutes/external`);
      return last.subject === SUBJECT && last.body === BODY && last;
    }).catch(() => null);
    assert.ok(stored, `the text was saved (stored: ${JSON.stringify({ subject: last?.subject, body: last?.body })})`);
    assert.equal(await page.$eval('[data-testid=external-subject]', (el) => el.value), SUBJECT, 'the editor keeps the text');
  });

  step('the preview shows the exact email; only people with an email can be picked', async () => {
    const people = await page.$$eval('[data-testid=external-to]', (els) => els.map((el) => [el.innerText.trim(), el.querySelector('input').checked, el.querySelector('input').disabled]));
    assert.deepEqual(people, [
      [`Jovan Customer · ${CUSTOMER}`, true, false],
      ['Nora Nomail · No email', false, true],
    ]);
    await click(page, '[data-testid=external-send]');
    await page.waitForSelector('[data-testid=preview-head]', { timeout: 10_000 });
    assert.equal(await page.$eval('[data-testid=preview-to]', (el) => el.textContent), `Jovan Customer <${CUSTOMER}>`);
    assert.equal(await page.$eval('[data-testid=preview-reply-to]', (el) => el.textContent), me.email);
    assert.match(await page.$eval('[data-testid=preview-from]', (el) => el.textContent), /^"Erin Sender" </);
    assert.equal(await page.$eval('[data-testid=preview-subject]', (el) => el.textContent), SUBJECT);
    assert.equal(await page.$('[data-testid=preview-cc]'), null, 'nobody copied');
    const html = await page.$eval('[data-testid=preview-body]', (el) => el.getAttribute('srcdoc'));
    assert.match(html, /<strong>pilot<\/strong>/);
  });

  step('sends: the tab says who got it, the customer has the email, the meeting stays held', async () => {
    await click(page, '[data-testid=preview-send]');
    await page.waitForFunction(() => !document.querySelector('[data-testid=preview-head]'), { timeout: 10_000 });
    await page.waitForFunction(() => /Minutes sent to Jovan Customer on /.test(document.querySelector('[data-testid=external-last-send]')?.innerText ?? ''), { timeout: 10_000 });

    const mail = await eventually(async () => (await api(page, `/dev/mail?to=${encodeURIComponent(CUSTOMER)}`)).find((m) => m.subject === SUBJECT), { timeout: 20_000 });
    assert.ok(mail, 'the customer got the email');
    assert.equal(mail.replyTo, me.email);
    assert.match(mail.text, /We start the pilot in November/);
    assert.match(mail.text, /Reply to this email to reach Erin Sender directly/);

    await page.waitForFunction(() => document.querySelector('[data-testid=send-status]')?.dataset.status === 'sent', { timeout: 20_000 });
    assert.equal(await page.$('[data-testid=meeting-undo-held]'), null, 'no Undo held after sending');
    assert.equal(await page.$('[data-testid=meeting-menu]'), null, 'no Delete after sending');
    assert.equal((await api(page, `/crm/meetings/${meeting.id}`)).externalDelivery, 'sent');

    await click(page, '[data-testid=meeting-tab-history]');
    await page.waitForSelector('[data-testid=send-log-item]', { timeout: 10_000 });
    assert.equal(await page.$eval('[data-testid=send-log-subject]', (el) => el.textContent), SUBJECT);
    assert.equal(await page.$eval('[data-testid=send-log-body]', (el) => el.textContent), BODY);
  });
});
