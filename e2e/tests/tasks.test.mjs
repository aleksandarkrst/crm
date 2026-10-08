// Tasks (CD-283, design v2 §2–4): the Tasks sidebar item, New task from the Tasks page, "+" and a
// project's Plan tab, the kanban (drag to change the status; On hold asks why), the table (status
// inline, the view remembered), the task page (name, status bar, Mark done / Reopen, the On hold box,
// assignees, estimate, history), the project's Plan tab and "Coming up", Ctrl/⌘K, the "Task
// assignments" setting and the task page at 375 px.
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { api, BASE_URL, click, eventually, newUserWithWorkspace, setValue, steps, useBrowser, waitForToastToClear } from '../lib/harness.mjs';

/** HTML5 drag and drop, as the browser fires it (Puppeteer's mouse doesn't start a native drag). */
async function htmlDrag(page, from, to) {
  await page.evaluate(
    (f, t) => {
      const src = document.querySelector(f);
      const dst = document.querySelector(t);
      const dataTransfer = new DataTransfer();
      src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }));
      dst.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer }));
      dst.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
      src.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer }));
    },
    from,
    to,
  );
}
const card = (id) => `[data-testid=task-card][data-task="${id}"]`;
const column = (name) => `[data-testid=task-column][data-column="${name}"]`;
const inColumn = (page, name, id) => page.waitForFunction((c, k) => !!document.querySelector(c)?.querySelector(k), {}, column(name), card(id));

describe('tasks', () => {
  const browser = useBrowser();
  const step = steps(browser, 'tasks');
  let page;
  let project;
  let firstId;
  let me;

  step('sets up a project of a company', async () => {
    page = await browser.person('tara');
    await newUserWithWorkspace(page, { label: 'tasks', name: 'Tara Tasks', workspace: 'Tasks Co' });
    const company = await api(page, '/crm/companies', { method: 'POST', body: JSON.stringify({ name: 'Northwind' }) });
    const [type] = await api(page, '/project-types');
    me = (await api(page, '/people/access')).employeeId;
    project = await api(page, '/projects', { method: 'POST', body: JSON.stringify({ name: 'Warehouse fit-out', projectTypeId: type.id, companyId: company.id }) });
  });

  step('the Projects sidebar has Tasks; New task adds one to the To do column', async () => {
    await page.goto(BASE_URL + '/tasks', { waitUntil: 'networkidle0' });
    await page.waitForSelector('a[href="/tasks"]');
    await page.waitForSelector('[data-testid=task-board]');
    assert.deepEqual(await page.$$eval('[data-testid=task-column]', (els) => els.map((el) => el.getAttribute('data-column'))), ['To do', 'In progress', 'On hold', 'Done']);
    await click(page, 'button::-p-text(New task)');
    await page.waitForSelector('[data-testid=task-name]');
    await page.type('[data-testid=task-name]', 'Survey report');
    await page.waitForSelector(`[data-testid=task-project] option[value="${project.id}"]`);
    await setValue(page, '[data-testid=task-project]', project.id);
    // The picker: the project team first (empty), then others; Tara is one of the others.
    await page.waitForSelector('[data-testid=assign-list] label');
    await click(page, `[data-testid=assign-list] label[data-employee="${me}"] input`);
    await setValue(page, '[data-testid=task-due-input]', '2026-10-20');
    await page.type('[data-testid=task-estimate-input]', '7.3');
    await page.waitForFunction(() => document.querySelector('[data-testid=create-task-submit]')?.disabled);
    await page.$eval('[data-testid=task-estimate-input]', (el) => (el.value = ''));
    await page.type('[data-testid=task-estimate-input]', '2.5');
    await click(page, '[data-testid=create-task-submit]');
    await page.waitForSelector(card('T-1'));
    await inColumn(page, 'To do', 'T-1');
    const [task] = await api(page, '/tasks');
    firstId = task.id;
    assert.equal(task.estimateHours, 2.5);
    assert.deepEqual(
      task.assignees.map((a) => a.name),
      ['Tara Tasks'],
    );
  });

  step('dragging a card changes its status; On hold asks why first', async () => {
    await waitForToastToClear(page);
    await htmlDrag(page, card('T-1'), column('In progress'));
    await inColumn(page, 'In progress', 'T-1');
    assert.equal((await api(page, '/tasks/' + firstId)).status, 'in_progress');
    await htmlDrag(page, card('T-1'), column('On hold'));
    await page.waitForSelector('[data-testid=hold-reasons]');
    assert.ok(await page.$eval('[data-testid=confirm-hold]', (el) => el.disabled), 'Put on hold waits for a reason');
    await click(page, '[data-testid=hold-reasons] button::-p-text(Waiting for the client)');
    await click(page, '[data-testid=confirm-hold]');
    await inColumn(page, 'On hold', 'T-1');
    await page.waitForFunction((c) => document.querySelector(c)?.textContent.includes('Waiting for the client'), {}, card('T-1'));
    assert.equal((await api(page, '/tasks/' + firstId)).onHoldReason, 'Waiting for the client');
  });

  step('the table sets the status inline, and the view is remembered', async () => {
    await click(page, '[data-testid=tasks-view-table]');
    await page.waitForSelector('[data-testid=tasks-row]');
    await setValue(page, '[data-testid=task-status-select]', 'in_progress');
    await eventually(async () => (await api(page, '/tasks/' + firstId)).status === 'in_progress');
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-testid=tasks-table]');
    await click(page, '[data-testid=tasks-view-kanban]');
  });

  step('the task page: name, status bar, Mark done / Reopen, On hold box, history', async () => {
    await page.goto(BASE_URL + '/tasks/' + firstId, { waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-testid=task-page]');
    assert.match(await page.$eval('.deal-crumb', (el) => el.textContent), /Tasks→Warehouse fit-out→T-1/);
    assert.match(await page.$eval('[data-testid=task-meta]', (el) => el.textContent), /Tara Tasks · Due 20 Oct/);
    await page.$eval('[data-testid=task-title]', (el) => el.select());
    await page.type('[data-testid=task-title]', 'Survey report and unit sizing');
    await page.keyboard.press('Enter');
    await eventually(async () => (await api(page, '/tasks/' + firstId)).name === 'Survey report and unit sizing');

    await waitForToastToClear(page);
    await click(page, '[data-testid=mark-done]');
    await page.waitForSelector('[data-testid=reopen-task]');
    await click(page, '[data-testid=reopen-task]');
    await page.waitForSelector('[data-testid=mark-done]');
    await click(page, '[data-testid=task-status-bar] button[title="Move to On hold"]');
    await click(page, '[data-testid=hold-reasons] button::-p-text(Assignee unavailable)');
    await click(page, '[data-testid=confirm-hold]');
    await page.waitForSelector('[data-testid=hold-box]');
    await page.waitForFunction(() => [...document.querySelectorAll('[data-testid=change-row]')].some((r) => r.textContent.includes('Name: “Survey report” → “Survey report and unit sizing”')));
  });

  step('assignees: take someone off and add them back from the picker', async () => {
    await waitForToastToClear(page);
    await click(page, '[data-testid=task-assignees] button[aria-label="Take Tara Tasks off the task"]');
    await page.waitForFunction(() => !document.querySelector('[data-testid=task-assignees] .person-chip'));
    await click(page, '[data-testid=add-assignee]');
    await page.waitForSelector('[data-testid=assign-list] label');
    await click(page, `[data-testid=assign-list] label[data-employee="${me}"] input`);
    await click(page, '[data-testid=assign-submit]');
    await page.waitForSelector('[data-testid=task-assignees] .person-chip');
    await page.waitForFunction(() => document.body.innerText.includes("You're on T-1"));
  });

  step("the project's Plan tab: New task with the project fixed, bands by stage; Overview's Coming up", async () => {
    await page.goto(BASE_URL + '/projects/' + project.id, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.querySelector('[data-testid=coming-up]')?.textContent.includes('T-1 · Survey report and unit sizing'));
    await click(page, '[data-testid=project-tab-plan]');
    await page.waitForSelector('[data-testid=plan-row]');
    await click(page, '[data-testid=plan-new-task]');
    await page.waitForSelector('[data-testid=task-project-fixed]');
    await page.waitForFunction(() => document.querySelector('[data-testid=task-project-fixed]')?.value === 'Warehouse fit-out · Northwind');
    await page.type('[data-testid=task-name]', 'Order units');
    await click(page, '[data-testid=create-task-submit]');
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=plan-row]').length === 2);
    assert.match(await page.$eval('[data-testid=project-tab-plan]', (el) => el.textContent), /Plan · 2/);
    assert.deepEqual(await page.$$eval('[data-testid=plan-band]', (els) => els.map((el) => el.getAttribute('data-stage'))), ['Planning']);
    // Kanban by stage: drag to In progress (the stage).
    await click(page, '[data-testid=plan-view-kanban]');
    await setValue(page, '[data-testid=plan-columns]', 'stage');
    await page.waitForSelector(column('Review'));
    await waitForToastToClear(page);
    await htmlDrag(page, card('T-2'), column('In progress'));
    await inColumn(page, 'In progress', 'T-2');
    const t2 = (await api(page, '/tasks?projectId=' + project.id)).find((t) => t.number === 2);
    assert.equal(t2.stageName, 'In progress');
  });

  step('"+" in Projects offers Task (K); Ctrl/⌘K finds a task by its ID', async () => {
    await page.goto(BASE_URL + '/tasks', { waitUntil: 'networkidle0' });
    await click(page, '[data-testid=new-menu]');
    assert.deepEqual(await page.$$eval('.new-menu-pop [role=menuitem]', (els) => els.map((el) => el.getAttribute('data-testid'))), ['new-project', 'new-project-task']);
    await page.keyboard.press('k');
    await page.waitForSelector('[data-testid=task-project]');
    await click(page, 'button::-p-text(Cancel)');
    await page.keyboard.down('Control');
    await page.keyboard.press('k');
    await page.keyboard.up('Control');
    await page.waitForSelector('[data-testid=palette-input]');
    await page.type('[data-testid=palette-input]', 'T-2');
    await page.waitForFunction(() => document.querySelector('[data-group=Tasks]')?.textContent.includes('T-2 · Order units'));
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => location.pathname.startsWith('/tasks/') && !!document.querySelector('[data-testid=task-page]'));
  });

  step('Settings → Notifications has "Task assignments"', async () => {
    await page.goto(BASE_URL + '/settings/notifications', { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.body.innerText.includes('Task assignments'));
  });

  step('the task page fits a 375 px screen', async () => {
    await page.setViewport({ width: 375, height: 800 });
    await page.goto(BASE_URL + '/tasks/' + firstId, { waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-testid=task-details]');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'no sideways scrolling');
    await page.setViewport({ width: 1280, height: 860 });
  });
});
