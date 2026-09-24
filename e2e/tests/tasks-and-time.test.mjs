// Overdue tasks and the Today badge (CD-67), editing a task (CD-27), every channel in the task
// dialog (CD-28), the workspace currency and fiscal year (CD-73), and "1 lead" (CD-74).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { api, BASE_URL, clickButton, eventually, newUserWithWorkspace, setValue, steps, text, useBrowser, waitForToastToClear } from '../lib/harness.mjs';

/** An ISO date `days` from today in a time zone (new workspaces use Europe/Belgrade). */
function isoDay(days, tz = 'Europe/Belgrade') {
  const d = new Date(Date.now() + days * 86_400_000);
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

/** Sets the <select> that has an option with this value (the filter chips have no labels). */
const pickOption = (page, value) =>
  page.evaluate((value) => {
    const el = [...document.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.value === value));
    if (!el) return false;
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, value);
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }, value);

describe('tasks: overdue, editing and channels', () => {
  const browser = useBrowser();
  const step = steps(browser, 'tasks');
  let page;
  let deal;
  let task;

  step('sets up a deal with a task that was due three days ago', async () => {
    page = await browser.person('tara');
    await newUserWithWorkspace(page, { label: 'tasks', name: 'Tara Tester', workspace: 'Tasks Co' });
    const funnels = await api(page, '/crm/funnels');
    const smb = funnels.find((f) => f.key === 'smb');
    deal = await api(page, '/crm/deals', { method: 'POST', body: JSON.stringify({ title: 'Overdue Ltd', funnelId: smb.id }) });
    task = await api(page, `/crm/deals/${deal.id}/tasks`, {
      method: 'POST',
      body: JSON.stringify({ stageId: smb.stages[0].id, label: 'Chase the signed NDA', blocksAdvance: false, channel: 'EM', dueDate: isoDay(-3) }),
    });
  });

  step('Today shows it under Overdue, and the sidebar counts it', async () => {
    await page.goto(BASE_URL + '/today', { waitUntil: 'networkidle0' });
    const overdue = await page.waitForSelector('[data-group="Overdue"]');
    assert.match(await overdue.evaluate((el) => el.innerText), /Chase the signed NDA/);
    const badge = await page.waitForSelector('[data-testid="nav-badge"]');
    assert.equal(await badge.evaluate((el) => el.textContent.trim()), '1');
    const todayGroup = await page.$eval('[data-group="Today"]', (el) => el.innerText);
    assert.ok(!todayGroup.includes('Chase the signed NDA'), 'not also under Today');
  });

  step('the deal screen highlights the overdue task', async () => {
    await page.goto(BASE_URL + '/deals/' + deal.id, { waitUntil: 'networkidle0' });
    await page.waitForSelector(`[data-lead-task="${task.id}"][data-overdue]`);
    assert.match(await page.$eval(`[data-lead-task="${task.id}"]`, (el) => el.innerText), /Overdue · due/);
  });

  step('the task dialog offers all seven channels, Call and Note included', async () => {
    await page.goto(BASE_URL + '/today', { waitUntil: 'networkidle0' });
    await waitForToastToClear(page).catch(() => {});
    await clickButton(page, 'New task');
    await page.waitForSelector('input[placeholder="e.g. Send revised scope to procurement"]');
    const labels = await page.evaluate(() => {
      const sel = [...document.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.value === 'EM'));
      return [...sel.options].map((o) => o.textContent);
    });
    assert.deepEqual(labels, ['Research task', 'Email', 'LinkedIn message', 'WhatsApp message', 'Meeting', 'Call', 'Note']);
    await clickButton(page, 'Cancel');
  });

  step("edits the task's title and due date, and they survive a reload", async () => {
    const row = await page.waitForSelector(`[data-task="${task.id}"]`);
    await (await row.$('button[title="Edit this task"]')).click();
    await page.waitForSelector('::-p-text(Edit task)');
    const titleInput = 'input[placeholder="e.g. Send revised scope to procurement"]';
    await setValue(page, titleInput, 'Chase the countersigned NDA');
    await setValue(page, '.overlay input[type=date], input[type=date]', isoDay(5));
    await clickButton(page, 'Save task');
    const saved = await eventually(async () => {
      const t = (await api(page, '/crm/deal-tasks')).find((x) => x.id === task.id);
      return t?.label === 'Chase the countersigned NDA' && t.dueDate === isoDay(5) && t;
    });
    assert.ok(saved, 'title and due date saved');
    await page.reload({ waitUntil: 'networkidle0' });
    const next = await page.waitForSelector('[data-group="Next up"]');
    assert.match(await next.evaluate((el) => el.innerText), /Chase the countersigned NDA/);
    assert.equal(await page.$('[data-testid="nav-badge"]'), null, 'no overdue badge any more');
  });

  it('throws no uncaught errors in the page', () => {
    assert.deepEqual(browser.errors, []);
  });
});

describe('workspace currency, fiscal year and counters', () => {
  const browser = useBrowser();
  const step = steps(browser, 'workspace-money');
  let page;
  let smb;

  step('a workspace in USD with one deal', async () => {
    page = await browser.person('uma');
    await newUserWithWorkspace(page, { label: 'usd', name: 'Uma Tester', workspace: 'Dollar Co' });
    await api(page, '/workspace', { method: 'PATCH', body: JSON.stringify({ currency: 'USD', fiscalYearStartMonth: 4 }) });
    smb = (await api(page, '/crm/funnels')).find((f) => f.key === 'smb');
    const deal = await api(page, '/crm/deals', { method: 'POST', body: JSON.stringify({ title: 'Yankee Doodle', funnelId: smb.id, amount: 12000 }) });
    assert.equal(deal.currency, 'USD');
  });

  step('Pipeline says "1 lead" and totals in dollars', async () => {
    await page.goto(BASE_URL + '/pipeline', { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.body.innerText.includes('1 lead · $12,000 open'));
    assert.ok(!(await text(page)).includes('€'), 'no euro sign anywhere on the board');
  });

  step('Overview shows dollar totals', async () => {
    await page.goto(BASE_URL + '/overview', { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.body.innerText.includes('$12k'));
  });

  step('the closing-date filter uses the fiscal year starting in April', async () => {
    // This fiscal year runs from 1 April to 31 March.
    const today = isoDay(0);
    const [y, m] = today.split('-').map(Number);
    const fyStart = m >= 4 ? y : y - 1;
    const lastDay = `${fyStart + 1}-03-31`; // in this fiscal year (outside the calendar year when after March)
    const dayBefore = `${fyStart}-03-31`; // the last day of the previous fiscal year
    for (const [title, closeDate] of [
      ['Fiscal in', lastDay],
      ['Fiscal out', dayBefore],
    ])
      await api(page, '/crm/deals', { method: 'POST', body: JSON.stringify({ title, funnelId: smb.id, closeDate }) });
    await page.reload({ waitUntil: 'networkidle0' });
    const labels = await page.evaluate(() => [...document.querySelectorAll('option')].map((o) => o.textContent));
    assert.ok(labels.includes('Closing this fiscal year') && labels.includes('Closing this fiscal quarter'), 'fiscal labels shown');
    assert.ok(await pickOption(page, 'Closing this year'), 'date filter found');
    await page.waitForFunction(() => document.body.innerText.includes('1 deal in view · closing this fiscal year'));
  });

  it('throws no uncaught errors in the page', () => {
    assert.deepEqual(browser.errors, []);
  });
});
