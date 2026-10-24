// Stage conversion on Overview (CD-62): an honest empty state until enough deals moved, then
// stage-to-stage conversion, win rate and time to proposal from the stage history, within the
// Overview filters.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { api, BASE_URL, click, eventually, newUserWithWorkspace, steps, text, useBrowser } from '../lib/harness.mjs';
import { chipText, clearFilters, closePopover, openChip, pickOption } from '../lib/filters.mjs';

const card = (page) => page.$eval('[data-testid=stage-conversion]', (el) => el.innerText);
/** The conversion row of a stage: [rate, "advanced/reached"]. */
const row = (page, stage) =>
  page.$eval(`[data-testid=stage-conversion] [data-stage="${stage}"]`, (el) => {
    const cells = [...el.children].map((c) => c.innerText.trim());
    return [cells[2], cells[3]];
  });

describe('stage conversion on Overview', () => {
  const browser = useBrowser();
  const step = steps(browser, 'conversion');
  let page;
  let funnels;

  step('shows the empty state while no opportunity has moved', async () => {
    page = await browser.person('cora');
    await newUserWithWorkspace(page, { label: 'conversion', name: 'Cora Tester', workspace: 'Conversion Co' });
    funnels = await api(page, '/crm/funnels');
    const smb = funnels.find((f) => f.key === 'smb');
    await api(page, '/crm/deals', { method: 'POST', body: JSON.stringify({ title: 'Idle', funnelId: smb.id }) });
    await page.goto(BASE_URL + '/overview', { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.querySelector('[data-testid=stage-conversion]')?.innerText.includes('so far'));
    assert.match(await card(page), /Conversion rates appear once at least 5 opportunities in view have moved between stages \(0 so far\)/);
  });

  step('moves opportunities through the SMB funnel (one won, one lost)', async () => {
    const smb = funnels.find((f) => f.key === 'smb');
    const st = smb.stages; // New opportunity, First touch, Discovery call, Proposal, Negotiation, Won
    // How far each deal moves, one stage at a time; "Idle" above stays in New opportunity.
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
    // 6 deals entered New opportunity and 5 moved on; 5 → 4 → 3 → 1 → 1 after that.
    assert.deepEqual(await row(page, 'New opportunity'), ['83%', '5/6']);
    assert.deepEqual(await row(page, 'First touch'), ['80%', '4/5']);
    assert.deepEqual(await row(page, 'Discovery call'), ['75%', '3/4']);
    assert.deepEqual(await row(page, 'Proposal'), ['33%', '1/3']);
    assert.deepEqual(await row(page, 'Negotiation'), ['100%', '1/1']);
    const text = await card(page);
    assert.match(text, /Win rate\s+50%\s+1 won · 1 lost/i);
    assert.match(text, /To proposal[\s\S]*3 opportunities/i);
    assert.match(text, /Opportunities that moved\s+5\s+of 6 opportunities in view/i);
  });

  step('respects the Overview filters: Funnel, Salesperson and Closing date together; Clear filters keeps the funnel', async () => {
    const ent = funnels.find((f) => f.key === 'ent');
    const smb = funnels.find((f) => f.key === 'smb');
    assert.equal(await chipText(page, 'owner'), 'Salesperson Any');
    assert.equal(await chipText(page, 'close'), 'Closing date Any');
    await pickOption(page, 'funnel', ent.id);
    await page.waitForFunction(() => document.querySelector('[data-testid=stage-conversion]').innerText.includes('(0 so far)'));
    await pickOption(page, 'funnel', smb.id);
    await closePopover(page);
    assert.ok(await eventually(async () => (await card(page)).includes('83%')), 'back on the SMB funnel');
    // Me (first in the list), then a closing date: these opportunities have none, so none match.
    await openChip(page, 'owner');
    await click(page, '[data-testid="filter-pop-owner"] [data-testid="filter-option"]');
    await closePopover(page);
    assert.equal(await chipText(page, 'owner'), 'Salesperson Me');
    await pickOption(page, 'close', 'today');
    await closePopover(page);
    await page.waitForFunction(() => document.querySelector('[data-testid=stage-conversion]').innerText.includes('(0 so far)'));
    assert.match(await text(page), /6 without a closing date hidden/);
    await clearFilters(page);
    assert.equal(await chipText(page, 'funnel'), 'Funnel ' + smb.label);
    assert.equal(await chipText(page, 'close'), 'Closing date Any');
    assert.ok(await eventually(async () => (await card(page)).includes('83%')), 'numbers are back once the filters are cleared');
  });

  it('throws no uncaught errors in the page', () => {
    assert.deepEqual(browser.errors, []);
  });
});
