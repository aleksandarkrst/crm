// Emails (CD-7, CD-16): the Team tab shows that an invitation email was sent, can resend it and copy
// its link; the Notifications tab saves your own settings and they survive a reload.
// Needs the worker running against the same database, with the log mail driver (the default).
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { api, BASE_URL, clickButton, email, eventually, newUserWithWorkspace, steps, text, useBrowser, waitForToastToClear } from '../lib/harness.mjs';

/** The status line under a pending invitation in the Team tab. */
const inviteStatus = (page, address) =>
  page.evaluate((address) => document.querySelector(`[data-invite-email="${address}"] .invite-email-status`)?.textContent ?? null, address);

/** Clicks a button with this label in the invitation's cell. */
const clickInInvite = (page, address, label) =>
  page.evaluate(
    (address, label) => {
      const button = [...(document.querySelector(`[data-invite-email="${address}"]`)?.querySelectorAll('button') ?? [])].find((b) => b.textContent.trim() === label);
      button?.click();
      return !!button && !button.disabled;
    },
    address,
    label,
  );

const isOn = (page, id) => page.$eval(`[data-notification="${id}"] .switch`, (el) => el.getAttribute('aria-checked') === 'true');

describe('emails: invitations and notification settings', () => {
  const browser = useBrowser();
  const step = steps(browser, 'notifications');
  let page;
  const invitee = email('emailed');

  step('the owner sets up a workspace', async () => {
    page = await browser.person('owner');
    await newUserWithWorkspace(page, { label: 'mail-owner', name: 'Mona Mailer', workspace: 'Mail Co' });
  });

  let link;
  step('inviting someone emails them the link, and the Team tab says it was sent', async () => {
    await page.goto(BASE_URL + '/settings/team', { waitUntil: 'networkidle0' });
    await clickButton(page, 'Invite member');
    await page.type('input[placeholder="name@company.com"]', invitee);
    await clickButton(page, 'Send invitation');
    const input = await page.waitForSelector('input[readonly]');
    link = await input.evaluate((el) => el.value);
    assert.match(await text(page), /We are emailing an invitation to/);
    await clickButton(page, 'Done');

    // The worker sends it; the tab polls until it has.
    await page.waitForFunction((address) => document.querySelector(`[data-invite-email="${address}"] .invite-email-status`)?.textContent.startsWith('Email sent'), { timeout: 20_000 }, invitee);
    const mails = await api(page, `/dev/mail?to=${encodeURIComponent(invitee)}`);
    assert.equal(mails.length, 1);
    assert.match(mails[0].subject, /^Mona Mailer invited you to Mail Co on Cadence$/);
    assert.ok(mails[0].text.includes('/invite/' + link.split('/invite/')[1]), 'the email carries the same link');
  });

  step('Resend emails it again', async () => {
    await waitForToastToClear(page).catch(() => {});
    assert.ok(await clickInInvite(page, invitee, 'Resend'), 'Resend button');
    await page.waitForFunction(() => document.querySelector('.toast')?.textContent.includes('again'));
    const mails = await eventually(async () => {
      const list = await api(page, `/dev/mail?to=${encodeURIComponent(invitee)}`);
      return list.length === 2 && list;
    }, { timeout: 20_000 });
    assert.ok(mails, 'second email');
    await page.waitForFunction((address) => document.querySelector(`[data-invite-email="${address}"] .invite-email-status`)?.textContent.startsWith('Email sent'), { timeout: 20_000 }, invitee);
  });

  step('Copy link gives the same link as the email', async () => {
    await waitForToastToClear(page).catch(() => {});
    assert.ok(await clickInInvite(page, invitee, 'Copy link'), 'Copy link button');
    // Headless Chrome may refuse the clipboard; the toast then shows the link instead.
    await page.waitForFunction(() => /Invite link (copied|: )/.test(document.querySelector('.toast')?.textContent ?? ''));
    const team = await api(page, '/team');
    const invitation = team.invitations.find((i) => i.email === invitee);
    const { token } = await api(page, `/team/invitations/${invitation.id}/link`);
    assert.equal(link, BASE_URL + '/invite/' + token);
    assert.equal(await inviteStatus(page, invitee).then((s) => s?.startsWith('Email sent')), true);
  });

  step('the Notifications tab has the two emails we send, the rest marked coming soon', async () => {
    await page.goto(BASE_URL + '/settings/notifications', { waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-notification="digest"] .switch');
    assert.equal(await isOn(page, 'digest'), true);
    assert.equal(await isOn(page, 'assigned'), true);
    const body = await text(page);
    assert.ok(body.includes('Daily digest email') && body.includes('Deal assigned to you'), 'real settings listed');
    assert.equal((body.match(/Coming soon/gi) ?? []).length, 2, 'two coming-soon rows');
    assert.equal(await page.$('[data-notification="weekly"] .switch'), null, 'no switch for weekly report');
  });

  step('switching them off saves, and survives a reload', async () => {
    await page.click('[data-notification="assigned"] .switch');
    await page.click('[data-notification="digest"] .switch');
    const saved = await eventually(async () => {
      const p = await api(page, '/profile');
      return p.notifyDealAssigned === false && p.dailyDigest === false && p;
    });
    assert.ok(saved, 'saved to the profile');
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-notification="digest"] .switch');
    assert.equal(await isOn(page, 'digest'), false);
    assert.equal(await isOn(page, 'assigned'), false);
  });

  step('the profile shows the same daily digest setting', async () => {
    await page.goto(BASE_URL + '/profile', { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.body.innerText.includes('Daily digest email'));
    assert.equal(await page.$eval('.switch', (el) => el.classList.contains('on')), false);
  });
});
