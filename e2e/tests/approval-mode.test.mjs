// Approval mode (CD-156): Settings → Workforce → Approvals' two choices; Whole week offers only
// Submit week, Day by day a Submit under each day; submitting one day shows "Partly submitted",
// and switching back keeps that day Submitted.
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { api, BASE_URL, click, eventually, newUserWithWorkspace, steps, useBrowser, waitForToastToClear } from '../lib/harness.mjs';

describe('approval mode', () => {
  const browser = useBrowser();
  const step = steps(browser, 'approval-mode');
  let page;
  let monday;
  const mode = async () => (await api(page, '/workspace')).timesheet.approvalMode;

  step('sets up a day of hours', async () => {
    page = await browser.person('ada');
    await newUserWithWorkspace(page, { label: 'approval-mode', name: 'Ada Days', workspace: 'Days Co' });
    const me = (await api(page, '/people/access')).employeeId;
    const company = await api(page, '/crm/companies', { method: 'POST', body: JSON.stringify({ name: 'Hidrogradnja' }) });
    const [type] = await api(page, '/project-types');
    const project = await api(page, '/projects', { method: 'POST', body: JSON.stringify({ name: 'Engine overhaul', projectTypeId: type.id, companyId: company.id }) });
    const task = await api(page, '/tasks', { method: 'POST', body: JSON.stringify({ projectId: project.id, name: 'Inspect engine', assigneeIds: [me] }) });
    monday = (await api(page, '/timesheet/week')).thisWeek;
    await api(page, '/timesheet/cells', { method: 'PUT', body: JSON.stringify({ date: monday, taskId: task.id, minutes: 480 }) });
  });

  step('Whole week (the default) offers no single-day Submit', async () => {
    await page.goto(BASE_URL + '/timesheet', { waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-testid=ts-grid]');
    assert.equal(await page.$('[data-testid=ts-submit-day]'), null);
  });

  step('Settings → Approvals: Day by day', async () => {
    await page.goto(BASE_URL + '/settings/approvals', { waitUntil: 'networkidle0' });
    assert.ok(await page.$eval('[data-testid=approval-mode-week]', (el) => el.classList.contains('on')));
    await click(page, '[data-testid=approval-mode-day]');
    assert.ok(await eventually(async () => (await mode()) === 'day'));
    assert.match(await page.$eval('[data-testid=approval-mode]', (el) => el.textContent), /Changing the mode never changes a day's status/);
  });

  step('Day by day: Submit under Monday submits only Monday', async () => {
    await page.goto(BASE_URL + '/timesheet', { waitUntil: 'networkidle0' });
    await click(page, `[data-testid=ts-day][data-date="${monday}"] [data-testid=ts-submit-day]`);
    await page.waitForFunction(() => /^Partly submitted \(1 of \d days\)$/.test(document.querySelector('[data-testid=ts-status]')?.textContent ?? ''));
    assert.match(await page.$eval(`[data-testid=ts-day][data-date="${monday}"]`, (el) => el.textContent), /Submitted/);
    await waitForToastToClear(page);
  });

  step('back to Whole week: Monday stays Submitted and only Submit week is offered', async () => {
    await api(page, '/workspace', { method: 'PATCH', body: JSON.stringify({ timesheet: { approvalMode: 'week' } }) });
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-testid=ts-grid]');
    assert.equal(await page.$('[data-testid=ts-submit-day]'), null);
    assert.equal(await page.$eval(`[data-testid=ts-day][data-date="${monday}"]`, (el) => el.dataset.status), 'submitted');
  });
});
