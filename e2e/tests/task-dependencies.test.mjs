// Task dependencies (CD-269, design v2 §2 and §4): "Waits for" in Details, the Dependencies card
// (Waits for / Blocks, empty texts), the kanban card's "waits for" line, the Plan table's Depends on
// column, and the Gantt with an arrow and "Starts before T-1 is due".
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { api, BASE_URL, click, setValue, steps, useBrowser, newUserWithWorkspace, waitForToastToClear } from '../lib/harness.mjs';

describe('task dependencies', () => {
  const browser = useBrowser();
  const step = steps(browser, 'task-dependencies');
  let page;
  let project;
  let survey;
  let install;

  step('sets up two dated tasks of a project', async () => {
    page = await browser.person('dora');
    await newUserWithWorkspace(page, { label: 'deps', name: 'Dora Deps', workspace: 'Deps Co' });
    const company = await api(page, '/crm/companies', { method: 'POST', body: JSON.stringify({ name: 'Warehouse Co' }) });
    const [type] = await api(page, '/project-types');
    project = await api(page, '/projects', { method: 'POST', body: JSON.stringify({ name: 'AC fit-out', projectTypeId: type.id, companyId: company.id }) });
    const task = (body) => api(page, '/tasks', { method: 'POST', body: JSON.stringify({ projectId: project.id, ...body }) });
    survey = await task({ name: 'Survey', startDate: '2026-10-10', dueDate: '2026-10-12' });
    install = await task({ name: 'Install units', startDate: '2026-10-11', dueDate: '2026-10-15' });
  });

  step('"Waits for" in Details fills both sides of the Dependencies card', async () => {
    await page.goto(BASE_URL + '/tasks/' + install.id, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.querySelector('[data-testid=deps-waits-for]')?.textContent === 'Nothing. This task can start any time.');
    await page.waitForSelector(`[data-testid=task-waits-for] option[value="${survey.id}"]`);
    await setValue(page, '[data-testid=task-waits-for]', survey.id);
    await page.waitForFunction(() => document.querySelector('[data-testid=deps-waits-for]')?.textContent.includes('T-1Survey'));
    assert.equal((await api(page, '/tasks/' + install.id)).waitsForTaskId, survey.id);
    // The other side: Survey blocks Install; a row opens it.
    await click(page, '[data-testid=deps-waits-for] [data-testid=dep-row]');
    await page.waitForFunction((id) => location.pathname === '/tasks/' + id, {}, survey.id);
    await page.waitForFunction(() => document.querySelector('[data-testid=deps-blocks]')?.textContent.includes('T-2Install units'));
    assert.equal(await page.$eval('[data-testid=deps-waits-for]', (el) => el.textContent), 'Nothing. This task can start any time.');
  });

  step('the kanban card says "waits for T-1" in amber while it is open', async () => {
    await page.goto(BASE_URL + '/tasks', { waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-task="T-2"] [data-testid=card-waits]');
    assert.match(await page.$eval('[data-task="T-2"] [data-testid=card-waits]', (el) => el.textContent), /waits for T-1$/);
    assert.equal(await page.$eval('[data-task="T-2"] [data-testid=card-waits]', (el) => getComputedStyle(el).color), 'rgb(180, 83, 27)');
  });

  step('the Plan table shows Depends on; the Gantt draws the arrow and the early start', async () => {
    await page.goto(BASE_URL + '/projects/' + project.id, { waitUntil: 'networkidle0' });
    await click(page, '[data-testid=project-tab-plan]');
    await page.waitForSelector('[data-testid=plan-row]');
    assert.deepEqual(await page.$$eval('[data-testid=plan-depends]', (els) => els.map((el) => el.textContent.trim())), ['—', 'T-1']);
    await waitForToastToClear(page);
    await click(page, '[data-testid=plan-view-gantt]');
    await page.waitForSelector('[data-testid=plan-gantt]');
    assert.equal((await page.$$('[data-testid=gantt-bar]')).length, 2);
    assert.equal((await page.$$('[data-testid=gantt-arrow]')).length, 1);
    assert.equal(await page.$eval('[data-task="T-2"] [data-testid=gantt-warning]', (el) => el.textContent), 'Starts before T-1 is due (12 Oct)');
    assert.equal(await page.$('[data-task="T-1"] [data-testid=gantt-warning]'), null);
  });
});
