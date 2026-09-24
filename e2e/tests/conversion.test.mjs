// Stage conversion on Overview (CD-62): an honest empty state until enough deals moved, then
// stage-to-stage conversion, win rate and time to proposal from the stage history, within the
// Overview filters.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { api, BASE_URL, clickButton, eventually, newUserWithWorkspace, steps, useBrowser } from '../lib/harness.mjs';

const card = (page) => page.$eval('[data-testid=stage-conversion]', (el) => el.innerText);
/** The conversion row of a stage: [rate, "advanced/reached"]. */
const row = (page, stage) =>
  page.$eval(`[data-testid=stage-conversion] [data-stage="${stage}"]`, (el) => {
    const cells = [...el.children].map((c) => c.innerText.trim());
    return [cells[2], cells[3]];
  });

/** Sets the Overview filter chip that offers `option`. */
const pickFilter = (page, option) =>
  page.evaluate((option) => {
    const select = [...document.querySelectorAll('select')].find((el) => [...el.options].some((o) => o.value === option || o.textContent === option));
    if (!select) return false;
    const value = [...select.options].find((o) => o.value === option || o.textContent === option).value;
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }, option);

describe('stage conversion on Overview', () => {
  const browser = useBrowser();
  const step = steps(browser, 'conversion');
  let page;
  let funnels;

  step('shows the empty state while no deal has moved', async () => {
    page = await browser.person('cora');
    await newUserWithWorkspace(page, { label: 'conversion', name: 'Cora Tester', workspace: 'Conversion Co' });
    funnels = await api(page, '/crm/funnels');
    const smb = funnels.find((f) => f.key === 'smb');
    await api(page, '/crm/deals', { method: 'POST', body: JSON.stringify({ title: 'Idle', funnelId: smb.id }) });
    await page.goto(BASE_URL + '/overview', { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.querySelector('[data-testid=stage-conversion]')?.innerText.includes('so far'));
    assert.match(await card(page), /Conversion rates appear once at least 5 deals in view have moved between stages \(0 so far\)/);
  });

  step('moves deals through the SMB funnel (one won, one lost)', async () => {
    const smb = funnels.find((f) => f.key === 'smb');
    const st = smb.stages; // New deal, First touch, Discovery call, Proposal, Negotiation, Won
    // How far each deal moves, one stage at a time; "Idle" above stays in New deal.
    const plan = [
      { title: 'Winner', to: 5 },
      { title: 'Lost at proposal', to: 3, lost: 'Price' },
      { title: 'At discovery', to: 2 },
      { title: 'At first touch', to: 1 },
      { title: 'At proposal', to: 3 },
    ];
    for (const d of plan) {
      const deal = await api(page, '/crm/deals', { method: 'POST', body: JSON.stringify({ title: d.title, funnelId: smb.id }) });
      for (let k = 1; k <= d.to; k++) await api(page, `/crm/deals/${deal.id}/move`, { method: 'POST', body: JSON.stringify({ stageId: st[k].id }) });
      if (d.lost) await api(page, `/crm/deals/${deal.id}/lost`, { method: 'POST', body: JSON.stringify({ reason: d.lost }) });
    }
    const history = await api(page, '/crm/deal-stage-history?limit=200');
    assert.equal(history.filter((h) => h.kind === 'moved').length, 5 + 3 + 2 + 1 + 3);
  });

  step('shows conversion, win rate and time to proposal', async () => {
    await page.goto(BASE_URL + '/overview', { waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-testid=stage-conversion] [data-stage]');
    // 6 deals entered New deal and 5 moved on; 5 → 4 → 3 → 1 → 1 after that.
    assert.deepEqual(await row(page, 'New deal'), ['83%', '5/6']);
    assert.deepEqual(await row(page, 'First touch'), ['80%', '4/5']);
    assert.deepEqual(await row(page, 'Discovery call'), ['75%', '3/4']);
    assert.deepEqual(await row(page, 'Proposal'), ['33%', '1/3']);
    assert.deepEqual(await row(page, 'Negotiation'), ['100%', '1/1']);
    const text = await card(page);
    assert.match(text, /Win rate\s+50%\s+1 won · 1 lost/i);
    assert.match(text, /To proposal[\s\S]*3 deals/i);
    assert.match(text, /Deals that moved\s+5\s+of 6 deals in view/i);
  });

  step('respects the Overview filters', async () => {
    const ent = funnels.find((f) => f.key === 'ent');
    assert.ok(await pickFilter(page, ent.label), 'audience chip found');
    await page.waitForFunction(() => document.querySelector('[data-testid=stage-conversion]').innerText.includes('(0 so far)'));
    await clickButton(page, 'Clear filters');
    const back = await eventually(async () => (await card(page)).includes('83%'));
    assert.ok(back, 'numbers are back once the filter is cleared');
  });

  it('throws no uncaught errors in the page', () => {
    assert.deepEqual(browser.errors, []);
  });
});
