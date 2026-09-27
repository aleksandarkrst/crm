// The session ending mid-work (CD-88): an edit made after the token stopped working is neither
// reset nor lost. The "Your session ended" dialog opens, and signing in again saves the edit.
// The token is made invalid in localStorage (dev sign-in), which the API answers with 401 like an
// expired one; dev mode has no refresh token, so the renewal fails and the dialog is the way back.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { api, clickButton, createDealInUi, eventually, newUserWithWorkspace, setValue, sleep, steps, text, useBrowser } from '../lib/harness.mjs';

describe('the session ends mid-work', () => {
  const browser = useBrowser();
  const step = steps(browser, 'session-expiry');
  let page;
  let dealId;

  step('sets up a deal', async () => {
    page = await browser.person('sam');
    await newUserWithWorkspace(page, { label: 'sam', name: 'Sam Session', workspace: 'Session Co' });
    dealId = await createDealInUi(page, { company: 'Longday d.o.o.', contact: 'Ana Anić' });
    await page.waitForSelector('[data-testid=deal-title]');
  });

  step('an edit after the session ended waits and opens the sign-in dialog, without resetting', async () => {
    await page.evaluate(() => localStorage.setItem('crm.devToken', 'expired.token.value'));
    await setValue(page, '[data-testid=deal-title]', 'Typed after the session ended');

    await page.waitForFunction(() => document.body.innerText.includes('Your session ended'));
    await sleep(1_000); // a reset would land by now
    assert.equal(await page.$eval('[data-testid=deal-title]', (el) => el.value), 'Typed after the session ended');
    assert.doesNotMatch(await text(page), /Not saved/);
  });

  step('signing in again saves the waiting edit', async () => {
    await clickButton(page, 'Sign in again');
    await page.waitForFunction(() => !document.body.innerText.includes('Your session ended'));
    const saved = await eventually(async () => (await api(page, '/crm/deals/' + dealId)).title === 'Typed after the session ended');
    assert.ok(saved, 'the edit made while signed out reached the database');
    assert.equal(await page.$eval('[data-testid=deal-title]', (el) => el.value), 'Typed after the session ended');
  });

  step('edits after that save normally', async () => {
    await setValue(page, '[data-testid=deal-title]', 'Back to normal');
    const saved = await eventually(async () => (await api(page, '/crm/deals/' + dealId)).title === 'Back to normal');
    assert.ok(saved, 'title saved');
    assert.doesNotMatch(await text(page), /Your session ended/);
  });

  it('throws no uncaught errors in the pages', () => {
    assert.deepEqual(browser.errors, []);
  });
});
