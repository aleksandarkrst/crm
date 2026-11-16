// More than two funnels (CD-10) and adding and removing stages (CD-9) in Settings → CRM's funnels
// table and drawer (CD-524).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { api, BASE_URL, click, clickButton, eventually, fillField, newUserWithWorkspace, steps, text, useBrowser, waitForToastToClear, createNew, createReadyCompany, pickDealCompany } from '../lib/harness.mjs';

describe('funnels and stages', () => {
  const browser = useBrowser();
  const step = steps(browser, 'funnels');
  let page;
  let funnel;
  let dealId;

  const funnelNow = async () => (await api(page, '/crm/funnels')).find((f) => f.id === funnel.id);
  /** Opens a funnel in the side drawer from its row's ⋯ menu in Settings → CRM (CD-524). */
  const openFunnel = async (id) => {
    await click(page, `[data-testid=funnel-choice][data-funnel="${id}"] [data-testid=funnel-menu]`);
    await click(page, '[data-testid=funnel-edit]');
    await page.waitForSelector('[data-testid=funnel-card]');
  };
  const stageNames = () => page.$$eval('[data-testid=funnel-card] .gs-stage-name', (els) => els.map((el) => el.textContent));

  step('creates a third funnel in the New funnel drawer', async () => {
    page = await browser.person('fern');
    await newUserWithWorkspace(page, { label: 'funnels', name: 'Fern Tester', workspace: 'Funnels Co' });
    await page.goto(BASE_URL + '/settings/crm', { waitUntil: 'networkidle0' });
    // New funnel opens a draft drawer (CD-524): nothing is created until Create funnel.
    await click(page, '[data-testid=new-funnel]');
    await page.waitForSelector('[data-testid=new-funnel-drawer] [data-testid=new-funnel-name]');
    await click(page, '[data-testid=new-funnel-create]');
    await page.waitForFunction(() => document.querySelector('[data-testid=new-funnel-drawer]')?.textContent.includes('Give the funnel a name.'));
    assert.equal((await api(page, '/crm/funnels')).length, 2, 'nothing created yet');
    await page.type('[data-testid=new-funnel-name]', 'Mid-market — CMO');
    await page.type('[data-testid=new-funnel-drawer] input[aria-label="How they buy"]', 'Marketing lead decides');
    await click(page, '[data-testid=new-funnel-drawer] [role=radio]::-p-text(Default stages)');
    const preview = await page.$$eval('[data-testid=new-funnel-stages] .gs-pst-name', (els) => els.map((el) => el.textContent));
    assert.deepEqual(preview, ['New opportunity', 'Discovery', 'Proposal', 'Won']);
    await click(page, '[data-testid=new-funnel-create]');
    await page.waitForFunction(() => !document.querySelector('[data-testid=new-funnel-drawer]'));
    await page.waitForFunction(() => document.querySelector('.toast')?.textContent.includes('Mid-market — CMO created'));
    funnel = await eventually(async () => (await api(page, '/crm/funnels')).find((f) => f.label === 'Mid-market — CMO'));
    assert.ok(funnel, 'funnel saved');
    assert.equal((await api(page, '/crm/funnels')).length, 3);
    assert.deepEqual(
      funnel.stages.map((s) => s.name),
      ['New opportunity', 'Discovery', 'Proposal', 'Won'],
    );
    // The funnels table lists the new funnel (CD-524).
    await page.waitForSelector(`[data-testid=funnel-choice][data-funnel="${funnel.id}"]`);
  });

  step('renames the funnel', async () => {
    await waitForToastToClear(page);
    await openFunnel(funnel.id);
    assert.equal(await page.$eval('[data-testid=funnel-card] input[aria-label="Funnel name"]', (el) => el.value), 'Mid-market — CMO');
    // The name saves when it is left (CD-524).
    await fillField(page, '[data-testid=funnel-card] input[aria-label="Funnel name"]', 'Mid-market');
    assert.ok(await eventually(async () => (await funnelNow()).label === 'Mid-market'), 'rename saved');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('[data-testid=funnel-card]'));
  });

  step('adds an opportunity to the third funnel with the New opportunity dialog', async () => {
    // Only an opportunity or a client takes an opportunity (CD-360): a complete company, loaded by the page.
    const umbrellaId = await createReadyCompany(page, 'Umbrella Corp', 'Albert Wesker');
    await page.goto(BASE_URL + '/pipeline', { waitUntil: 'networkidle0' });
    await createNew(page, 'deal');
    await clickButton(page, 'Mid-market');
    await pickDealCompany(page, umbrellaId);
    await click(page, '[data-testid=new-deal-sale-transactional]');
    await clickButton(page, 'Create & start funnel');
    await page.waitForFunction(() => location.pathname.startsWith('/deals/'));
    dealId = page.url().split('/deals/')[1];
    const deal = await api(page, '/crm/deals/' + dealId);
    assert.equal(deal.funnelId, funnel.id);
    assert.equal(deal.stageId, funnel.stages[0].id);
  });

  step('the Pipeline and Overview show the third funnel and its opportunity', async () => {
    await page.goto(BASE_URL + '/pipeline', { waitUntil: 'networkidle0' });
    // The Pipeline's funnel select and Overview's Audience select list it.
    await page.select('[data-testid=pipeline-funnel]', funnel.id);
    await page.waitForFunction(() => document.body.innerText.includes('Umbrella Corp'));
    await page.goto(BASE_URL + '/overview', { waitUntil: 'networkidle0' });
    await page.select('[data-testid=overview-funnel]', funnel.id);
    await page.waitForFunction(() => /1 opportunity in view/.test(document.body.innerText));
  });

  step('adds a stage, then removes a stage with the opportunity in it (the opportunity moves)', async () => {
    // Move the deal to Discovery through the API, then remove Discovery in the builder. The advance
    // gate (CD-363) holds it in New opportunity until that stage's to-dos are done.
    const first = (await funnelNow()).stages[0];
    for (const item of first.checklistItems)
      await api(page, `/crm/deals/${dealId}/tasks/playbook`, { method: 'PUT', body: JSON.stringify({ stageId: first.id, checklistItemId: item.id, done: true }) });
    await api(page, `/crm/deals/${dealId}/move`, { method: 'POST', body: JSON.stringify({ stageId: funnel.stages[1].id }) });
    // Settings → CRM lists the funnels in a table (CD-524): its ⋯ menu opens one in the drawer.
    await page.goto(BASE_URL + '/settings/crm', { waitUntil: 'networkidle0' });
    await openFunnel(funnel.id);
    await page.waitForFunction(() => [...document.querySelectorAll('[data-testid=funnel-card] .gs-stage-name')].some((el) => el.textContent === 'Discovery'));

    await click(page, '[data-testid=add-stage]');
    const added = await eventually(async () => (await funnelNow()).stages.map((s) => s.name).join(',') === 'New opportunity,Discovery,Proposal,New stage,Won');
    assert.ok(added, 'stage added before Won');
    await page.waitForFunction(() => [...document.querySelectorAll('[data-testid=funnel-card] .gs-stage-name')].some((el) => el.textContent === 'New stage'));
    assert.deepEqual(await stageNames(), ['New opportunity', 'Discovery', 'Proposal', 'New stage', 'Won']);
    await waitForToastToClear(page);

    // Delete in the Discovery stage's ⋯ menu; the confirm asks where its opportunity goes.
    await click(page, '[data-testid=funnel-card] button[aria-label="Actions for Discovery"]');
    await click(page, '[data-testid=remove-stage]');
    await page.waitForSelector('[data-testid=remove-stage-confirm]');
    assert.match(await page.$eval('[data-testid=remove-stage-confirm]', (el) => el.textContent), /1 opportunity is in this stage/);
    await click(page, '[data-testid=remove-stage-confirm] [role=radio]::-p-text(Proposal)');
    await page.waitForSelector('[data-testid=remove-stage-confirm] [role=radio][aria-checked=true]::-p-text(Proposal)');
    await click(page, '[data-testid=remove-stage-confirm] [data-testid=gs-confirm]');

    const after = await eventually(async () => {
      const f = await funnelNow();
      return f.stages.length === 4 && f;
    });
    assert.deepEqual(
      after.stages.map((s) => s.name),
      ['New opportunity', 'Proposal', 'New stage', 'Won'],
    );
    const deal = await api(page, '/crm/deals/' + dealId);
    assert.equal(deal.stageId, funnel.stages[2].id, 'opportunity moved to Proposal');
    const history = await api(page, '/crm/deal-stage-history?dealId=' + dealId);
    assert.deepEqual(
      history.at(-1) && [history.at(-1).kind, history.at(-1).fromStageId, history.at(-1).toStageId],
      ['moved', funnel.stages[1].id, funnel.stages[2].id],
    );
    assert.ok(!(await text(page)).includes('not supported yet'));
  });

  step('the opportunity screen shows the move on its timeline', async () => {
    await page.goto(BASE_URL + '/deals/' + dealId, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.body.innerText.includes('The stage Discovery was deleted.'));
    assert.match(await text(page), /Moved to Proposal/);
  });

  it('throws no uncaught errors in the page', () => {
    assert.deepEqual(browser.errors, []);
  });
});
