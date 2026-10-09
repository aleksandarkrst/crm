// My timesheet (CD-152, design Timesheet.dc.html#cd-152): Workforce → Timesheet, adding a task and a
// work order, typing 7,5 and 7:20 (rounded to 7:15), arrows moving between cells, the note
// popover (Shift+Enter), the 12 h daily maximum, the totals, Copy last week, Submit week (the
// "no hours" confirmation) with read-only days and Recall, and the hours on the task page (AC 2).
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { api, BASE_URL, click, confirmInApp, eventually, newUserWithWorkspace, steps, useBrowser, waitForToastToClear } from '../lib/harness.mjs';

const addDays = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

describe('timesheet', () => {
  const browser = useBrowser();
  const step = steps(browser, 'timesheet');
  let page;
  let me;
  let task;
  let order;
  let monday;
  const cell = (id, date) => `[data-testid=ts-cell][data-row="${id}"][data-date="${date}"]`;
  const value = (id, date) => page.$eval(cell(id, date), (el) => el.value);
  const week = (start) => api(page, `/timesheet/week${start ? `?week=${start}` : ''}`);
  const typeInto = async (selector, text) => {
    await page.$eval(selector, (el) => el.focus());
    await page.keyboard.type(text);
  };

  step('sets up a task and a work order to log time on', async () => {
    page = await browser.person('tess');
    await newUserWithWorkspace(page, { label: 'timesheet', name: 'Tess Hours', workspace: 'Hours Co' });
    const access = await api(page, '/people/access');
    me = access.employeeId;
    await api(page, '/people/employees/' + me, { method: 'PATCH', body: JSON.stringify({ workType: 'both' }) });
    const company = await api(page, '/crm/companies', { method: 'POST', body: JSON.stringify({ name: 'Kovin Pančevo' }) });
    const [type] = await api(page, '/project-types');
    const project = await api(page, '/projects', { method: 'POST', body: JSON.stringify({ name: 'Service contract 2026', projectTypeId: type.id, companyId: company.id }) });
    task = await api(page, '/tasks', { method: 'POST', body: JSON.stringify({ projectId: project.id, name: 'Update the spare parts price list', assigneeIds: [me] }) });
    order = await api(page, '/work-orders', { method: 'POST', body: JSON.stringify({ title: 'Hydraulic leak, CAT 320', companyId: company.id, projectId: project.id, technicianIds: [me] }) });
    monday = (await week()).thisWeek;
  });

  step('opens from the Workforce sidebar: this week, not submitted, due Friday 17:00', async () => {
    await page.goto(BASE_URL + '/org', { waitUntil: 'networkidle0' });
    await click(page, 'nav a[href="/timesheet"]');
    await page.waitForSelector('[data-testid=ts-grid]');
    assert.match(await page.$eval('[data-testid=ts-week-label]', (el) => el.textContent), /^Week \d+ · /);
    assert.equal(await page.$eval('[data-testid=ts-status]', (el) => el.textContent), 'Not submitted');
    assert.match(await page.$eval('.ts-toolbar', (el) => el.textContent), /Submit by Fri \d+ \w{3}, 17:00/);
    assert.equal((await page.$$('[data-testid=ts-row]')).length, 0);
  });

  step('+ Add task or work order lists what you can log on', async () => {
    await click(page, '[data-testid=ts-add-row]');
    await page.waitForSelector('.picker-item::-p-text(Update the spare parts price list)');
    await page.type('.ts-add-picker .picker-search', 'spare');
    await click(page, '.picker-item::-p-text(Update the spare parts price list)');
    await page.waitForSelector(cell(task.id, monday));
    assert.match(await page.$eval(`[data-testid=ts-row][data-row="${task.id}"] [data-testid=ts-row-sub]`, (el) => el.textContent), /Kovin Pančevo › Service contract 2026 · no limit/);
  });

  step('typing 7,5 and 7:20 saves 7.5 and 7.25 h; arrows move between cells', async () => {
    await typeInto(cell(task.id, monday), '7,5');
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.date), addDays(monday, 1));
    await page.keyboard.type('7:20');
    await page.keyboard.press('Tab');
    await eventually(async () => (await week()).rows[0]?.cells[addDays(monday, 1)]?.minutes === 435);
    const w = await week();
    assert.equal(w.rows[0].cells[monday].minutes, 450);
    assert.equal(await value(task.id, monday), '7.5');
    assert.equal(await value(task.id, addDays(monday, 1)), '7.25');
    await page.waitForFunction(() => document.querySelector('[data-testid=ts-total-entered] .ts-total')?.textContent === '14.75');
    assert.equal(await page.$eval(`[data-testid=ts-row][data-row="${task.id}"] [data-testid=ts-row-total]`, (el) => el.textContent), '14.75');
    assert.equal(await page.$eval('[data-testid=ts-status]', (el) => el.textContent), 'Draft');
  });

  step('Shift+Enter opens the note: hours and a note for the approver', async () => {
    await page.$eval(cell(task.id, monday), (el) => el.focus());
    await page.keyboard.down('Shift');
    await page.keyboard.press('Enter');
    await page.keyboard.up('Shift');
    await page.waitForSelector('[data-testid=ts-note]');
    assert.match(await page.$eval('[data-testid=ts-note]', (el) => el.textContent), /T-\d+ · Mon \d+ \w{3}/);
    assert.equal(await page.$eval('[data-testid=ts-note-hours]', (el) => el.value), '7.50');
    await page.type('[data-testid=ts-note-text]', 'Waited for the seal kit');
    await click(page, '[data-testid=ts-note-save]');
    await page.waitForFunction(() => !document.querySelector('[data-testid=ts-note]'));
    assert.equal((await week()).rows[0].cells[monday].note, 'Waited for the seal kit');
    await page.waitForSelector(`${cell(task.id, monday)} ~ .ts-note-mark`);
  });

  step('more than 12 h on one day is refused', async () => {
    await api(page, '/timesheet/rows', { method: 'POST', body: JSON.stringify({ weekStart: monday, workOrderId: order.id }) });
    await page.waitForSelector(cell(order.id, monday));
    await typeInto(cell(order.id, monday), '5');
    await page.keyboard.press('Tab');
    await page.waitForSelector('.toast::-p-text(Maximum 12 h per day)');
    await page.waitForSelector(`${cell(order.id, monday)}.error`);
    assert.equal((await week()).rows.find((r) => r.id === order.id).cells[monday], undefined);
    await waitForToastToClear(page);
    await page.$eval(cell(order.id, monday), (el) => el.focus());
    await page.keyboard.press('Backspace');
    await page.keyboard.type('4.5');
    await page.keyboard.press('Tab');
    await eventually(async () => (await week()).rows.find((r) => r.id === order.id).cells[monday]?.minutes === 270);
  });

  step('Copy last week copies hours into empty cells and never overwrites', async () => {
    const last = addDays(monday, -7);
    await api(page, '/timesheet/cells', { method: 'PUT', body: JSON.stringify({ date: addDays(last, 1), taskId: task.id, minutes: 120 }) });
    await api(page, '/timesheet/cells', { method: 'PUT', body: JSON.stringify({ date: addDays(last, 2), taskId: task.id, minutes: 180 }) });
    await page.reload({ waitUntil: 'networkidle0' });
    await click(page, '[data-testid=ts-copy]');
    await page.waitForSelector('.modal-title::-p-text(Copy week)');
    await click(page, '[data-testid=ts-copy-hours]');
    await click(page, '[data-testid=ts-copy-go]');
    await page.waitForFunction(() => !document.querySelector('.modal'));
    const w = await week();
    const row = w.rows.find((r) => r.id === task.id);
    // Tuesday already had 7.25 h; Wednesday was empty.
    assert.equal(row.cells[addDays(monday, 1)].minutes, 435);
    assert.equal(row.cells[addDays(monday, 2)].minutes, 180);
    await waitForToastToClear(page);
  });

  step('Submit week asks about days without hours, then the days are read-only; Recall reopens them', async () => {
    await click(page, '[data-testid=ts-submit]');
    const title = await confirmInApp(page);
    assert.match(title, /has no hours|have no hours/);
    await page.waitForFunction(() => document.querySelector('[data-testid=ts-status]')?.textContent === 'Submitted');
    assert.ok(await page.$eval(cell(task.id, monday), (el) => el.readOnly && el.classList.contains('submitted')));
    await waitForToastToClear(page);
    await click(page, '[data-testid=ts-menu]');
    await click(page, '[data-testid=ts-recall]');
    await page.waitForFunction(() => document.querySelector('[data-testid=ts-status]')?.textContent === 'Draft');
    assert.ok(await page.$eval(cell(task.id, monday), (el) => !el.readOnly));
  });

  step("the task page counts the timesheet's hours, last week's too", async () => {
    await page.goto(BASE_URL + '/tasks/' + task.id, { waitUntil: 'networkidle0' });
    await page.waitForFunction((id) => /22\.75 h/.test(document.querySelector(`[data-testid=hours-row][data-employee="${id}"]`)?.textContent ?? ''), {}, me);
  });
});
