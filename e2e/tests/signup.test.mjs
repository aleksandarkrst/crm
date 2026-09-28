// Creating an account with email (CD-114): a signed-out visitor sees only sign-in, goes to
// "Create account", confirms the address through the emailed link and chooses a password, then
// lands signed in. The link works once; a broken link explains itself and offers a new email.
// "Forgot password?" works the same way: an emailed link, a new password, signed in.
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { api, BASE_URL, click, clickButton, email, eventually, newUserWithWorkspace, steps, text, useBrowser } from '../lib/harness.mjs';

describe('create account with email', () => {
  const browser = useBrowser();
  const step = steps(browser, 'signup');
  let visitor;
  let reader; // reads the dev outbox, which needs a signed-in user
  let link;
  const address = email('newcomer');

  step('a signed-out visitor sees sign-in with a way to create an account, and no CRM', async () => {
    visitor = await browser.person('visitor');
    await visitor.goto(BASE_URL + '/pipeline', { waitUntil: 'networkidle0' });
    const page = await text(visitor);
    assert.match(page, /Sign in to Cadence/);
    assert.match(page, /New to Cadence\?\s*Create account/);
    assert.equal(await visitor.$('[data-testid=new-menu]'), null);
  });

  step('Create account asks for the email, then says to check it', async () => {
    await clickButton(visitor, 'Create account');
    await visitor.waitForFunction(() => document.body.innerText.includes('Create your Cadence account'));
    assert.equal(new URL(visitor.url()).pathname, '/signup');
    await visitor.type('input[type=email]', address);
    await clickButton(visitor, 'Continue with email');
    await visitor.waitForFunction(() => document.body.innerText.includes('Check your email'));
    assert.match(await text(visitor), new RegExp(`We sent a link to ${address.replace(/[.]/g, '\\.')}`));
    // Resending waits a minute.
    const resend = await visitor.waitForSelector('button::-p-text(Resend email)');
    assert.equal(await resend.evaluate((b) => b.disabled), true);
  });

  step('the email carries a confirmation link', async () => {
    reader = await browser.person('reader');
    await newUserWithWorkspace(reader, { label: 'signup-reader', name: 'Rita Reader', workspace: 'Reader Co' });
    const mails = await eventually(async () => {
      const list = await api(reader, `/dev/mail?to=${encodeURIComponent(address)}`);
      return list.length > 0 && list;
    }, { timeout: 20_000 });
    assert.ok(mails, 'confirmation email');
    assert.equal(mails[0].subject, 'Confirm your email to create your Cadence account');
    link = /(https?:\/\/\S+\/signup\/verify#[A-Za-z0-9_-]+)/.exec(mails[0].text)?.[1];
    assert.ok(link, mails[0].text);
  });

  step('the link leads to choosing a password, then into the new account', async () => {
    await visitor.goto(BASE_URL + '/signup/verify' + link.slice(link.indexOf('#')), { waitUntil: 'networkidle0' });
    await visitor.waitForFunction(() => document.body.innerText.includes('Choose your password'));
    assert.match(await text(visitor), new RegExp(address.replace(/[.]/g, '\\.')));
    const [password, confirm] = await visitor.$$('input[type=password]');
    await password.type('a long enough password');
    await confirm.type('a different password');
    await click(visitor, 'button[type=submit]');
    await visitor.waitForFunction(() => document.body.innerText.includes("The two passwords don't match."));
    await confirm.click({ count: 3 });
    await confirm.type('a long enough password');
    await click(visitor, 'button[type=submit]');
    // Signed in as the new account, which has no workspace yet.
    await visitor.waitForFunction(() => document.body.innerText.includes('Create your workspace'), { timeout: 20_000 });
    assert.match(await text(visitor), new RegExp(`Signed in as ${address.replace(/[.]/g, '\\.')}`));
  });

  step('the link works only once', async () => {
    await visitor.goto(BASE_URL + '/signup/verify' + link.slice(link.indexOf('#')), { waitUntil: 'networkidle0' });
    await visitor.waitForFunction(() => document.body.innerText.includes('This link was already used'));
    assert.ok(await visitor.$('button::-p-text(Sign in)'));
  });

  step('a broken link explains itself and offers a new email', async () => {
    const stranger = await browser.person('stranger');
    await stranger.goto(BASE_URL + '/signup/verify#' + 'x'.repeat(43), { waitUntil: 'networkidle0' });
    await stranger.waitForFunction(() => document.body.innerText.includes("This link doesn't work"));
    await clickButton(stranger, 'Send a new email');
    await stranger.waitForFunction(() => document.body.innerText.includes('Create your Cadence account'));
  });

  step('forgot password: an emailed link sets a new password and signs in', async () => {
    const forgetful = await browser.person('forgetful');
    await forgetful.goto(BASE_URL + '/forgot-password', { waitUntil: 'networkidle0' });
    await forgetful.waitForFunction(() => document.body.innerText.includes('Reset your password'));
    await forgetful.type('input[type=email]', address);
    await clickButton(forgetful, 'Send reset link');
    await forgetful.waitForFunction(() => document.body.innerText.includes('Check your email'));
    const mail = await eventually(async () => (await api(reader, `/dev/mail?to=${encodeURIComponent(address)}`)).find((m) => m.subject === 'Reset your Cadence password'), { timeout: 20_000 });
    assert.ok(mail, 'reset email');
    const reset = /(https?:\/\/\S+\/reset-password#[A-Za-z0-9_-]+)/.exec(mail.text)?.[1];
    assert.ok(reset, mail.text);
    await forgetful.goto(BASE_URL + '/reset-password' + reset.slice(reset.indexOf('#')), { waitUntil: 'networkidle0' });
    await forgetful.waitForFunction(() => document.body.innerText.includes('Choose a new password'));
    const [password, confirm] = await forgetful.$$('input[type=password]');
    await password.type('another long password');
    await confirm.type('another long password');
    await click(forgetful, 'button[type=submit]');
    await forgetful.waitForFunction(() => document.body.innerText.includes('Create your workspace'), { timeout: 20_000 });
    assert.match(await text(forgetful), new RegExp(`Signed in as ${address.replace(/[.]/g, '\\.')}`));
  });
});
