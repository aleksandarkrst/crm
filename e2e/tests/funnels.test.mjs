// More than two funnels (CD-10) and adding and removing stages (CD-9) in the funnel builder.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { api, BASE_URL, clickButton, eventually, newUserWithWorkspace, setValue, steps, text, useBrowser, waitForToastToClear } from '../lib/harness.mjs';

describe('funnels and stages', () => {
  const browser = useBrowser();
  const step = steps(browser, 'funnels');
  let page;
  let funnel;
  let dealId;

  /** Picks an option by its text in the first <select> that has it. */
  const pickOption = (label) =>
    page.evaluate((label) => {
      const select = [...document.querySelectorAll('select')].find((el) => [...el.options].some((o) => o.textContent === label));
      if (!select) return false;
      const value = [...select.options].find((o) => o.textContent === label).value;
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, value);
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }, label);
  const funnelNow = async () => (await api(page, '/crm/funnels')).find((f) => f.id === funnel.id);

  step('creates a third funnel in the funnel builder', async () => {
    page = await browser.person('fern');
    await newUserWithWorkspace(page, { label: 'funnels', name: 'Fern Tester', workspace: 'Funnels Co' });
    await page.goto(BASE_URL + '/settings/funnel', { waitUntil: 'networkidle0' });
    await clickButton(page, 'New funnel');
    await page.waitForSelector('input[placeholder="e.g. Mid-market — marketing lead decides"]');
    await page.type('input[placeholder="e.g. Mid-market — marketing lead decides"]', 'Mid-market — CMO');
    await page.type('textarea[placeholder="Who decides, how long it takes, what slows it down"]', 'Marketing lead decides');
    await clickButton(page, 'Default stages');
    await clickButton(page, 'Create funnel');
    funnel = await eventually(async () => (await api(page, '/crm/funnels')).find((f) => f.label === 'Mid-market — CMO'));
    assert.ok(funnel, 'funnel saved');
    assert.equal((await api(page, '/crm/funnels')).length, 3);
    assert.deepEqual(
      funnel.stages.map((s) => s.name),
      ['New deal', 'Discovery', 'Proposal', 'Won'],
    );
    // The builder opens the new funnel.
    await page.waitForFunction(() => [...document.querySelectorAll('input.form-input')].some((i) => i.value === 'Mid-market — CMO'));
  });

  step('renames the funnel', async () => {
    await waitForToastToClear(page);
    const found = await page.evaluate(() => {
      const input = [...document.querySelectorAll('input.form-input')].find((i) => i.value === 'Mid-market — CMO');
      input?.setAttribute('data-e2e', 'funnel-name');
      return !!input;
    });
    assert.ok(found);
    await setValue(page, 'input[data-e2e=funnel-name]', 'Mid-market');
    assert.ok(await eventually(async () => (await funnelNow()).label === 'Mid-market'), 'rename saved');
  });

  step('adds a deal to the third funnel with the New deal dialog', async () => {
    await page.goto(BASE_URL + '/pipeline', { waitUntil: 'networkidle0' });
    await clickButton(page, 'New deal');
    await clickButton(page, 'Mid-market');
    await page.type('input[placeholder="Company name"]', 'Umbrella Corp');
    await page.type('input[placeholder="Full name"]', 'Albert Wesker');
    await clickButton(page, 'Create & start funnel');
    await page.waitForFunction(() => location.pathname.startsWith('/deals/'));
    dealId = page.url().split('/deals/')[1];
    const deal = await api(page, '/crm/deals/' + dealId);
    assert.equal(deal.funnelId, funnel.id);
    assert.equal(deal.stageId, funnel.stages[0].id);
  });

  step('the Pipeline and Overview show the third funnel and its deal', async () => {
    await page.goto(BASE_URL + '/pipeline', { waitUntil: 'networkidle0' });
    assert.ok(await pickOption('Mid-market'), 'funnel switcher lists it');
    await page.waitForFunction(() => document.body.innerText.includes('Umbrella Corp'));
    await page.goto(BASE_URL + '/overview', { waitUntil: 'networkidle0' });
    assert.ok(await pickOption('Mid-market'), 'audience filter lists it');
    await page.waitForFunction(() => /1 deal in view/.test(document.body.innerText));
  });

  step('adds a stage, then removes a stage with the deal in it (the deal moves)', async () => {
    // Move the deal to Discovery through the API, then remove Discovery in the builder.
    await api(page, `/crm/deals/${dealId}/move`, { method: 'POST', body: JSON.stringify({ stageId: funnel.stages[1].id }) });
    await page.goto(BASE_URL + '/settings/funnel', { waitUntil: 'networkidle0' });
    assert.ok(await pickOption('Mid-market'), 'builder switches funnel');
    await page.waitForFunction(() => [...document.querySelectorAll('input.ghost')].some((i) => i.value === 'Discovery'));

    await clickButton(page, '+ Add stage to this funnel');
    const added = await eventually(async () => (await funnelNow()).stages.map((s) => s.name).join(',') === 'New deal,Discovery,Proposal,New stage,Won');
    assert.ok(added, 'stage added before Won');
    await page.waitForFunction(() => [...document.querySelectorAll('input.ghost')].some((i) => i.value === 'New stage'));
    await waitForToastToClear(page);

    // "Remove" on the Discovery card.
    await page.evaluate(() => {
      const input = [...document.querySelectorAll('input.ghost')].find((i) => i.value === 'Discovery');
      let card = input;
      while (card && !card.classList.contains('card')) card = card.parentElement;
      [...card.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Remove').click();
    });
    await page.waitForFunction(() => [...document.querySelectorAll('label')].some((l) => l.textContent.includes('Move its 1 deal to')));
    await page.evaluate(() => {
      const label = [...document.querySelectorAll('label')].find((l) => l.textContent.includes('Move its 1 deal to'));
      label.querySelector('select').setAttribute('data-e2e', 'move-to');
    });
    await setValue(page, 'select[data-e2e=move-to]', funnel.stages[2].id);
    await clickButton(page, 'Remove stage');

    const after = await eventually(async () => {
      const f = await funnelNow();
      return f.stages.length === 4 && f;
    });
    assert.deepEqual(
      after.stages.map((s) => s.name),
      ['New deal', 'Proposal', 'New stage', 'Won'],
    );
    const deal = await api(page, '/crm/deals/' + dealId);
    assert.equal(deal.stageId, funnel.stages[2].id, 'deal moved to Proposal');
    const history = await api(page, '/crm/deal-stage-history?dealId=' + dealId);
    assert.deepEqual(
      history.at(-1) && [history.at(-1).kind, history.at(-1).fromStageId, history.at(-1).toStageId],
      ['moved', funnel.stages[1].id, funnel.stages[2].id],
    );
    assert.ok(!(await text(page)).includes('not supported yet'));
  });

  step('the deal screen shows the move on its timeline', async () => {
    await page.goto(BASE_URL + '/deals/' + dealId, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.body.innerText.includes('The stage Discovery was deleted.'));
    assert.match(await text(page), /Moved to Proposal/);
  });

  it('throws no uncaught errors in the page', () => {
    assert.deepEqual(browser.errors, []);
  });
});
