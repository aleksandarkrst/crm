// Time on the task and work order pages (CD-276): the task's Time card (Log time, the entry in
// the timesheet too, Edit and Delete, no Edit or Delete on a submitted day, the closed-project
// lock) and the work order's Track time card (Start → End entries that follow each other, edited
// with Done, and no add row once Completed).
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { api, BASE_URL, click, eventually, newUserWithWorkspace, setValue, steps, useBrowser, waitForToastToClear } from '../lib/harness.mjs';

describe('time cards', () => {
  const browser = useBrowser();
  const step = steps(browser, 'time-cards');
  let page;
  let me;
  let project;
  let task;
  let order;
  let today;
  const card = '[data-testid=time-card]';
  const logged = () => page.$eval(`${card} [data-testid=time-logged]`, (el) => el.textContent);
  const toast = (text) => page.waitForSelector(`.toast::-p-text(${text})`);
  const logTime = async (hours, note) => {
    await setValue(page, '[data-testid=time-add-hours]', hours);
    await setValue(page, '[data-testid=time-add-note]', note);
    await click(page, '[data-testid=time-add-log]');
  };

  step('sets up a task and a scheduled work order', async () => {
    page = await browser.person('tina');
    await newUserWithWorkspace(page, { label: 'time-cards', name: 'Tina Field', workspace: 'Field Co' });
    me = (await api(page, '/people/access')).employeeId;
    await api(page, '/people/employees/' + me, { method: 'PATCH', body: JSON.stringify({ workType: 'both' }) });
    const company = await api(page, '/crm/companies', { method: 'POST', body: JSON.stringify({ name: 'Hidrogradnja' }) });
    const [type] = await api(page, '/project-types');
    project = await api(page, '/projects', { method: 'POST', body: JSON.stringify({ name: 'Engine overhaul, CAT 336', projectTypeId: type.id, companyId: company.id }) });
    task = await api(page, '/tasks', { method: 'POST', body: JSON.stringify({ projectId: project.id, name: 'Dismantle and inspect engine', assigneeIds: [me], estimateHours: 4 }) });
    today = (await api(page, '/timesheet/week')).today;
    order = await api(page, '/work-orders', {
      method: 'POST',
      body: JSON.stringify({ title: 'Hydraulic leak, CAT 320', companyId: company.id, technicianIds: [me], scheduledDate: today, scheduledStart: '09:00', durationHours: 2 }),
    });
  });

  step('Log time on the task page; the entry is in the timesheet too', async () => {
    await page.goto(BASE_URL + '/tasks/' + task.id, { waitUntil: 'networkidle0' });
    await page.waitForSelector(`${card} [data-testid=time-logged]`);
    assert.equal(await logged(), '0 hof 4 h logged');
    await logTime('2', 'Cylinder head off');
    await toast(`2 h logged on T-${task.number}.`);
    await page.waitForFunction(() => document.querySelector('[data-testid=time-logged]')?.textContent === '2 hof 4 h logged');
    assert.equal(await page.$eval('[data-testid=time-line]', (el) => el.textContent), '2 h left on the estimate');
    assert.match(await page.$eval('[data-testid=time-entry]', (el) => el.textContent), /Cylinder head off.*Tina Field.*2 h/);
    const week = await api(page, '/timesheet/week');
    assert.equal(week.rows.find((r) => r.id === task.id).cells[today].minutes, 120);
    await waitForToastToClear(page);
  });

  step('Edit changes the hours; over the estimate shows red', async () => {
    await click(page, '[data-testid=time-entry-edit]');
    await setValue(page, '[data-testid=time-edit-hours]', '5');
    await click(page, '[data-testid=time-edit-save]');
    await toast('Time entry updated · 5 h');
    await page.waitForFunction(() => document.querySelector('[data-testid=time-line]')?.textContent === '1 h over the estimate');
    await waitForToastToClear(page);
  });

  step('a submitted day shows Submitted instead of Edit and Delete', async () => {
    await api(page, '/timesheet/submit', { method: 'POST', body: JSON.stringify({ weekStart: (await api(page, '/timesheet/week')).weekStart }) });
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-testid=time-entry-status]::-p-text(Submitted)');
    assert.equal(await page.$('[data-testid=time-entry-edit]'), null);
    await api(page, '/timesheet/recall', { method: 'POST', body: JSON.stringify({ weekStart: (await api(page, '/timesheet/week')).weekStart }) });
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-testid=time-entry-edit]');
  });

  step('Delete removes it', async () => {
    await click(page, '[data-testid=time-entry-delete]');
    await toast(`5 h removed from T-${task.number}.`);
    await page.waitForFunction(() => !document.querySelector('[data-testid=time-entry]'));
    await waitForToastToClear(page);
  });

  step('Track time on the work order: entries follow each other from its start', async () => {
    await page.goto(BASE_URL + '/work-orders/' + order.id, { waitUntil: 'networkidle0' });
    await page.waitForSelector(`${card} [data-testid=time-logged]`);
    assert.equal(await logged(), '0 hof 2 h planned');
    await logTime('1.5', 'Replaced the pressure hose');
    await toast(`1.5 h logged on WO-${order.number}.`);
    await waitForToastToClear(page);
    await logTime('1', '');
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=time-entry]').length === 2);
    const entries = await page.$$eval('[data-testid=time-entry]', (els) => els.map((el) => el.textContent));
    assert.match(entries[0], /10:30 → 11:30/);
    assert.match(entries[1], /09:00 → 10:30/);
    assert.equal(await page.$eval('[data-testid=time-line]', (el) => el.textContent), '0.5 h over the planned time');
    await waitForToastToClear(page);
  });

  step('an entry is edited as Start → End with Done', async () => {
    await click(page, '[data-testid=time-entry] [data-testid=time-entry-edit]');
    await setValue(page, '[data-testid=time-edit-end]', '12:00');
    await click(page, '[data-testid=time-edit-save]');
    await toast('Time entry updated');
    await eventually(async () => (await api(page, `/work-orders/${order.id}/time`)).loggedMinutes === 180);
    await waitForToastToClear(page);
  });

  step('a completed work order has no add row', async () => {
    await api(page, '/work-orders/' + order.id, { method: 'PATCH', body: JSON.stringify({ status: 'completed' }) });
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-testid=time-lock]::-p-text(This work order is completed.)');
    assert.equal(await page.$('[data-testid=time-add]'), null);
    assert.equal(await page.$('[data-testid=time-entry-edit]'), null);
  });

  step('a closed project disables the add row and says when it was completed', async () => {
    await api(page, '/tasks', { method: 'POST', body: JSON.stringify({ projectId: project.id, name: 'Final test run', assigneeIds: [me] }) }).then(async (t) => {
      await api(page, '/projects/' + project.id, { method: 'PATCH', body: JSON.stringify({ status: 'completed' }) });
      await page.goto(BASE_URL + '/tasks/' + t.id, { waitUntil: 'networkidle0' });
    });
    await page.waitForSelector('[data-testid=time-lock]');
    assert.match(await page.$eval('[data-testid=time-lock]', (el) => el.textContent), /Hidrogradnja › Engine overhaul, CAT 336 was completed on \w{3} \d+ \w{3}\.Time can't be logged/);
    assert.ok(await page.$eval('[data-testid=time-add-log]', (el) => el.disabled));
  });
});
