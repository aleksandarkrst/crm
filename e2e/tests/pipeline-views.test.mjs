// Pipeline views (CD-274): the Kanban / Table toggle, the table grouped by stage with the same
// filters as the board, the remembered view, the funnel select's pencil and the New deal button.
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { api, BASE_URL, newUserWithWorkspace, steps, useBrowser } from '../lib/harness.mjs';

/** Picks an option in the Pipeline filter bar's select that offers `option`. */
const pick = (page, option) =>
  page.evaluate((option) => {
    const select = [...document.querySelectorAll('select')].find((el) => [...el.options].some((o) => o.value === option));
    if (!select) return false;
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, option);
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }, option);

const tableRows = (page) => page.$$eval('[data-testid=pipeline-table-row]', (els) => els.map((el) => ({ text: el.innerText, lost: el.hasAttribute('data-lost') })));

describe('pipeline views', () => {
  const browser = useBrowser();
  const step = steps(browser, 'pipeline-views');
  let page;
  let funnel;

  step('sets up a workspace with deals in two stages, one of them lost', async () => {
    page = await browser.person('vic');
    await newUserWithWorkspace(page, { label: 'views', name: 'Vic Viewer', workspace: 'Views Co' });
    [funnel] = await api(page, '/crm/funnels');
    const deal = async (name, stageIdx) => {
      const company = await api(page, '/crm/companies', { method: 'POST', body: JSON.stringify({ name }) });
      const d = await api(page, '/crm/deals', { method: 'POST', body: JSON.stringify({ title: name + ' rollout', funnelId: funnel.id, companyId: company.id }) });
      if (stageIdx) await api(page, `/crm/deals/${d.id}/move`, { method: 'POST', body: JSON.stringify({ stageId: funnel.stages[stageIdx].id }) });
      return d;
    };
    await deal('Alpha Ltd', 0);
    await deal('Beta Ltd', 1);
    const gone = await deal('Gamma Ltd', 0);
    await api(page, `/crm/deals/${gone.id}/lost`, { method: 'POST', body: JSON.stringify({ reason: 'No budget' }) });
  });

  step('starts on the board, with the funnel select and New deal in the bar', async () => {
    await page.goto(BASE_URL + '/pipeline', { waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-testid=pipeline-view-board][aria-pressed=true]');
    assert.equal(await page.$('[data-testid=pipeline-table]'), null);
    assert.equal(await page.$eval('[data-testid=pipeline-funnel]', (el) => el.value), funnel.id);
    assert.ok(await page.$$eval('.filter-actions .btn-primary', (bs) => bs.some((b) => b.textContent.trim() === 'New deal')));
  });

  step('the table groups the deals by stage and a row opens the deal', async () => {
    await page.click('[data-testid=pipeline-view-table]');
    await page.waitForSelector('[data-testid=pipeline-table]');
    const bands = await page.$$eval('.pipeline-table-band', (els) => els.map((el) => el.innerText.split('\n')[0]));
    assert.deepEqual(bands, [funnel.stages[0].name, funnel.stages[1].name]);
    const rows = await tableRows(page);
    assert.equal(rows.length, 2, 'the lost deal is hidden like on the board');
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

  step('the board filters apply to the table, with an empty state', async () => {
    assert.ok(await pick(page, 'Include lost deals'));
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=pipeline-table-row]').length === 3);
    const lost = (await tableRows(page)).find((r) => r.text.includes('Gamma Ltd'));
    assert.ok(lost.lost);
    assert.match(lost.text, /Lost · No budget/);

    assert.ok(await pick(page, 'Lost deals only'));
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=pipeline-table-row]').length === 1);
    assert.ok(await pick(page, 'Open & won deals'));
    const band = await page.evaluate(() => {
      const el = [...document.querySelectorAll('select')].find((s) => s.options[0]?.value === 'Value');
      return el.options[el.options.length - 1].value;
    });
    assert.ok(await pick(page, band));
    await page.waitForFunction(() => document.querySelector('.pipeline-table-empty')?.textContent === 'No deals match these filters.');
  });

  step('the pencil opens the Funnel builder', async () => {
    await page.click('[data-testid=pipeline-edit-funnel]');
    await page.waitForFunction(() => location.pathname === '/settings/funnel');
  });
});
