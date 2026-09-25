// Two members of one workspace in two browser contexts (CD-20, CD-69): a change made by one shows
// up for the other without a reload; editing the same field at the same time tells the second
// person plainly that their change wasn't saved and shows the current value; the deal's
// "Changes" view lists who changed what.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { api, BASE_URL, clickButton, createWorkspace, email, eventually, setValue, signIn, sleep, steps, text, useBrowser } from '../lib/harness.mjs';

describe('live updates, conflicts and change history', () => {
  const browser = useBrowser();
  const step = steps(browser, 'live');
  let olivia;
  let ana;
  let dealId;
  const TITLE = '[data-testid=deal-title]';

  /** Opens the deal and waits until the page's live-update stream is connected. */
  async function openDeal(page) {
    await page.goto(`${BASE_URL}/deals/${dealId}`, { waitUntil: 'networkidle0' });
    await page.waitForSelector(TITLE);
    await page.waitForFunction(() => document.documentElement.dataset.live === 'on', { timeout: 10_000 });
  }
  const titleOf = (page) => page.$eval(TITLE, (el) => el.value);

  step('the owner sets up a workspace with a deal and a colleague joins', async () => {
    olivia = await browser.person('olivia');
    await olivia.goto(BASE_URL, { waitUntil: 'networkidle0' });
    await signIn(olivia, email('live-olivia'), 'Olivia Owner');
    await createWorkspace(olivia, 'Live Co');
    const funnels = await api(olivia, '/crm/funnels');
    dealId = (await api(olivia, '/crm/deals', { method: 'POST', body: JSON.stringify({ title: 'Harbor refit', funnelId: funnels[0].id }) })).id;
    const { token } = await api(olivia, '/team/invitations', { method: 'POST', body: JSON.stringify({ email: email('live-ana'), role: 'member' }) });

    ana = await browser.person('ana');
    await ana.goto(`${BASE_URL}/invite/${token}`, { waitUntil: 'networkidle0' });
    await signIn(ana, email('live-ana'), 'Ana Member');
    await clickButton(ana, 'Accept and join');
    await ana.waitForSelector('button::-p-text(New deal)');
  });

  step("one person's change appears for the other without a reload", async () => {
    await openDeal(olivia);
    await openDeal(ana);
    await ana.evaluate(() => (window.__notReloaded = true));

    await setValue(olivia, TITLE, 'Harbor refit phase 2');
    await ana.waitForFunction((sel) => document.querySelector(sel)?.value === 'Harbor refit phase 2', { timeout: 10_000 }, TITLE);
    // A new deal shows up on the other person's pipeline too.
    const funnels = await api(olivia, '/crm/funnels');
    const company = await api(olivia, '/crm/companies', { method: 'POST', body: JSON.stringify({ name: 'Lighthouse Lamps Ltd' }) });
    await api(olivia, '/crm/deals', { method: 'POST', body: JSON.stringify({ title: 'Lighthouse lamps', funnelId: funnels[0].id, companyId: company.id }) });
    // In-app navigation (no reload), as a click in the sidebar does.
    await ana.evaluate(() => {
      history.pushState({}, '', '/pipeline');
      dispatchEvent(new PopStateEvent('popstate'));
    });
    await ana.waitForFunction(() => document.body.innerText.includes('Lighthouse Lamps Ltd'), { timeout: 10_000 });
    assert.equal(await ana.evaluate(() => window.__notReloaded), true, 'the page was not reloaded');
  });

  step('editing the same field at the same time: the later change is refused and explained', async () => {
    await openDeal(olivia);
    await openDeal(ana);
    // Both type into the title; each save goes out after a short pause, Olivia's first.
    await setValue(olivia, TITLE, 'Harbor refit (Olivia)');
    await sleep(150);
    await setValue(ana, TITLE, 'Harbor refit (Ana)');

    const toast = await ana.waitForSelector('.toast::-p-text(changed this deal while you were editing)', { timeout: 10_000 });
    const message = await toast.evaluate((el) => el.textContent);
    assert.equal(message, "Olivia Owner changed this deal while you were editing. Your change to the title wasn't saved. It now says “Harbor refit (Olivia)”.");
    // Ana's screen shows the current value, and the database kept Olivia's.
    const shown = await eventually(async () => (await titleOf(ana)) === 'Harbor refit (Olivia)');
    assert.ok(shown, `Ana sees the saved title, not "${await titleOf(ana)}"`);
    assert.equal((await api(olivia, `/crm/deals/${dealId}`)).title, 'Harbor refit (Olivia)');
  });

  step('the deal lists its changes: who, which field, old and new value', async () => {
    const funnels = await api(olivia, '/crm/funnels');
    await api(olivia, `/crm/deals/${dealId}/move`, { method: 'POST', body: JSON.stringify({ stageId: funnels[0].stages[1].id }) });
    await openDeal(ana);
    await ana.click('[data-testid="history-changes"]');
    await ana.waitForSelector('[data-testid="change-row"]');
    await ana.waitForFunction(() => document.querySelector('[data-testid="change-history"]')?.innerText.includes('Stage:'), { timeout: 10_000 });
    const body = await ana.$eval('[data-testid="change-history"]', (el) => el.innerText);
    assert.ok(body.includes('Title: “Harbor refit phase 2” → “Harbor refit (Olivia)”'), body);
    assert.ok(body.includes(`Stage: ${funnels[0].stages[0].name} → ${funnels[0].stages[1].name}`), body);
    assert.ok(body.includes('Created the deal “Harbor refit”'), body);
    assert.ok(body.includes('Olivia Owner'), 'names who changed it');
    assert.ok(!(await text(ana)).includes('Ana Member changed'), 'Ana made no change');
  });

  it('throws no uncaught errors in the pages', () => {
    assert.deepEqual(browser.errors, []);
  });
});
