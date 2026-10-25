// Pipeline views (CD-274): the Kanban / Table toggle, the table with the same filters as the
// board (the filter row, CD-366), the remembered view, the funnel select's pencil and New opportunity.
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { api, BASE_URL, newUserWithWorkspace, steps, text, useBrowser, testPib } from '../lib/harness.mjs';
import { addFilter, chips, chipText, clearFilters, closePopover, pickOption, setOp, setRange, typeText } from '../lib/filters.mjs';

const tableRows = (page) => page.$$eval('[data-testid=pipeline-table-row]', (els) => els.map((el) => ({ text: el.innerText, lost: el.hasAttribute('data-lost') })));

describe('pipeline views', () => {
  const browser = useBrowser();
  const step = steps(browser, 'pipeline-views');
  let page;
  let funnel;

  step('sets up a workspace with opportunities in two stages, one of them lost', async () => {
    page = await browser.person('vic');
    await newUserWithWorkspace(page, { label: 'views', name: 'Vic Viewer', workspace: 'Views Co' });
    [funnel] = await api(page, '/crm/funnels');
    const deal = async (name, stageIdx) => {
      const company = await api(page, '/crm/companies', { method: 'POST', body: JSON.stringify({ pib: testPib(), name }) });
      const d = await api(page, '/crm/deals', { method: 'POST', body: JSON.stringify({ title: name + ' rollout', funnelId: funnel.id, companyId: company.id }) });
      if (stageIdx) await api(page, `/crm/deals/${d.id}/move`, { method: 'POST', body: JSON.stringify({ stageId: funnel.stages[stageIdx].id }) });
      return d;
    };
    await deal('Alpha Ltd', 0);
    await deal('Beta Ltd', 1);
    const gone = await deal('Gamma Ltd', 0);
    await api(page, `/crm/deals/${gone.id}/lost`, { method: 'POST', body: JSON.stringify({ reason: 'No budget' }) });
  });

  step('starts on the board, with the Funnel, Salesperson and Status chips and New opportunity in the bar', async () => {
    await page.goto(BASE_URL + '/pipeline', { waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-testid=pipeline-view-board][aria-pressed=true]');
    assert.equal(await page.$('[data-testid=pipeline-table]'), null);
    // The funnel is the select next to the view toggle, not a chip (CD-366).
    assert.equal(await page.$eval('[data-testid=pipeline-funnel]', (el) => el.value), funnel.id);
    assert.deepEqual(await chips(page), ['owner', 'status']);
    assert.equal(await chipText(page, 'owner'), 'Salesperson Me');
    assert.equal(await chipText(page, 'status'), 'Status Open, Won');
    assert.ok(await page.$$eval('.filter-actions .btn-primary', (bs) => bs.some((b) => b.textContent.trim() === 'New opportunity')));
  });

  step('the table is a flat list in stage order, sortable by a column, and a row opens the opportunity', async () => {
    await page.click('[data-testid=pipeline-view-table]');
    await page.waitForSelector('[data-testid=pipeline-table]');
    assert.equal(await page.$('.pipeline-table-band'), null, 'no stage bands (CD-318)');
    let rows = await tableRows(page);
    assert.deepEqual(rows.map((r) => r.text.split('\n')[0]), ['Alpha Ltd', 'Beta Ltd']);
    // Sorting by Deal: a second click on the header sorts descending, a third goes back.
    await page.click('[data-testid=pipeline-table] .sort-btn');
    await page.click('[data-testid=pipeline-table] .sort-btn');
    rows = await tableRows(page);
    assert.deepEqual(rows.map((r) => r.text.split('\n')[0]), ['Beta Ltd', 'Alpha Ltd']);
    await page.click('[data-testid=pipeline-table] .sort-btn');
    rows = await tableRows(page);
    assert.equal(rows.length, 2, 'the lost opportunity is hidden like on the board');
    assert.match(rows[0].text, /Alpha Ltd/);
    assert.match(rows[0].text, /Alpha Ltd rollout/);
    assert.match(rows[0].text, /Vic Viewer/, 'owner column');
    await page.click('[data-testid=pipeline-table-row]');
    await page.waitForFunction(() => location.pathname.startsWith('/deals/'));
  });

  step('remembers the table after a reload', async () => {
    await page.goto(BASE_URL + '/pipeline', { waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-testid=pipeline-table]');
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-testid=pipeline-view-table][aria-pressed=true]');
  });

  step('the filter row applies to the table: Lost is a Status value', async () => {
    await pickOption(page, 'status', '__lost');
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=pipeline-table-row]').length === 3);
    const lost = (await tableRows(page)).find((r) => r.text.includes('Gamma Ltd'));
    assert.ok(lost.lost);
    assert.match(lost.text, /Lost · No budget/);
    assert.doesNotMatch(await text(page), /lost hidden/);
  });

  step('combines Status is not, an added text filter and the salesperson, and remembers them', async () => {
    // Status "is not" Lost: the ticks stay, the operator turns them around.
    await pickOption(page, 'status', '__group');
    await pickOption(page, 'status', '__won');
    await setOp(page, 'status', 'isnot');
    await closePopover(page);
    assert.equal(await chipText(page, 'status'), 'Status is not Lost');
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=pipeline-table-row]').length === 2);
    await addFilter(page, 'title');
    await typeText(page, 'title', 'beta');
    await closePopover(page);
    assert.equal(await chipText(page, 'title'), 'Opportunity name contains “beta”');
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=pipeline-table-row]').length === 1);
    assert.match((await tableRows(page))[0].text, /Beta Ltd/);
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-testid=pipeline-table-row]');
    assert.deepEqual(await chips(page), ['owner', 'status', 'title']);
    assert.equal((await tableRows(page)).length, 1);
  });

  step('shows the no-results card, and Clear filters keeps the funnel', async () => {
    await addFilter(page, 'value');
    await setRange(page, 'value', { min: '1' });
    await closePopover(page);
    await page.waitForSelector('[data-testid=filter-empty]');
    assert.match(await page.$eval('[data-testid=filter-empty]', (el) => el.innerText), /No opportunities match these filters[\s\S]*Change or clear a filter to see more/);
    await clearFilters(page);
    // The funnel is the select next to the view toggle, not a chip (CD-366).
    assert.equal(await page.$eval('[data-testid=pipeline-funnel]', (el) => el.value), funnel.id);
    assert.deepEqual(await chips(page), ['owner', 'status']);
    assert.equal(await chipText(page, 'owner'), 'Salesperson Any');
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=pipeline-table-row]').length === 3);
  });

  step('the pencil opens the Funnel builder', async () => {
    await page.click('[data-testid=pipeline-edit-funnel]');
    await page.waitForFunction(() => location.pathname === '/settings/funnel');
  });
});
