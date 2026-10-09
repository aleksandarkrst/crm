// The project Report tab and Reports · Workload (CD-261, design Projects Prototype.dc.html
// #project-report and #workload): estimates against logged time by stage and by person, and
// remaining hours per person and week.
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { api, BASE_URL, click, newUserWithWorkspace, steps, useBrowser } from '../lib/harness.mjs';

describe('project report', () => {
  const browser = useBrowser();
  const step = steps(browser, 'project-report');
  let page;
  let project;

  step('sets up a project with a 10 h task and 4 h logged today', async () => {
    page = await browser.person('rhea');
    await newUserWithWorkspace(page, { label: 'project-report', name: 'Rhea Report', workspace: 'Report Projects' });
    const me = (await api(page, '/people/access')).employeeId;
    const company = await api(page, '/crm/companies', { method: 'POST', body: JSON.stringify({ name: 'Kovin Pančevo' }) });
    const [type] = await api(page, '/project-types');
    project = await api(page, '/projects', { method: 'POST', body: JSON.stringify({ name: 'Service contract 2026', code: 'SC-26', projectTypeId: type.id, companyId: company.id, budgetHours: 40 }) });
    const task = await api(page, '/tasks', { method: 'POST', body: JSON.stringify({ projectId: project.id, name: 'Hydraulic leak', stageId: type.stages[0].id, estimateHours: 10, assigneeIds: [me] }) });
    const today = (await api(page, '/timesheet/week')).today;
    await api(page, '/timesheet/cells', { method: 'PUT', body: JSON.stringify({ date: today, taskId: task.id, minutes: 240 }) });
  });

  step('the Report tab: summary, by stage, by person', async () => {
    await page.goto(BASE_URL + '/projects/' + project.id, { waitUntil: 'networkidle0' });
    await click(page, '[data-testid=project-tab-report]');
    await page.waitForSelector('[data-testid=report-summary]');
    const summary = await page.$eval('[data-testid=report-summary]', (el) => el.textContent);
    assert.match(summary, /^0% done by estimate\. 4 of 10 hours logged against a budget of 40 hours; 6 hours remaining\. Nothing is late\./);
    const stage = await page.$eval('[data-testid=report-stage]', (el) => [...el.children].map((c) => c.textContent));
    assert.deepEqual(stage.slice(1, 5), ['0 / 1', '10 h', '4 h', '6 h']);
    const person = await page.$eval('[data-testid=report-person]', (el) => [...el.children].map((c) => c.textContent));
    assert.deepEqual(person.slice(1, 7), ['1', '0', '10 h', '4 h', '6 h', '—']);
  });

  step('Reports · Workload: the remaining 6 h this week, with the project code', async () => {
    await page.goto(BASE_URL + '/workload', { waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-testid=workload-row]');
    const row = await page.$eval('[data-testid=workload-row]', (el) => [...el.children].map((c) => c.textContent));
    assert.equal(row.at(-1), 'SC-26');
    const hours = row.slice(1, 9).filter(Boolean);
    assert.ok(hours.length >= 1, 'some week has hours');
    assert.equal(hours.reduce((a, v) => a + parseInt(v, 10), 0), 6);
  });
});
