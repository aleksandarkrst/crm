// Settings → Project types (CD-272): the default type, adding and renaming a type, adding,
// reordering and deleting stages (the app's confirm; a stage in use can't be deleted, CD-280), and
// deleting a type (its projects move to another type).
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { api, BASE_URL, click, clickButton, confirmInApp, eventually, newUserWithWorkspace, setValue, steps, useBrowser, waitForToastToClear } from '../lib/harness.mjs';

const typeNames = (page) => page.$$eval('[data-testid=project-type]', (els) => els.map((el) => el.innerText.split('\n')[0]));
const stageNames = (page) => page.$$eval('[data-testid=project-stage] input', (els) => els.map((el) => el.value));
const typesNow = (page) => api(page, '/project-types');

/** Types `value` into the input and saves it (Enter). */
async function retype(page, selector, value) {
  await page.click(selector, { count: 3 });
  await page.keyboard.type(value);
  await page.keyboard.press('Enter');
}

describe('project types', () => {
  const browser = useBrowser();
  const step = steps(browser, 'project-types');
  let page;

  step('a new workspace has "Client project" with Planning, In progress and Review', async () => {
    page = await browser.person('pat');
    await newUserWithWorkspace(page, { label: 'ptypes', name: 'Pat Types', workspace: 'Types Co' });
    await page.goto(BASE_URL + '/settings/project-types', { waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-testid=project-type]');
    assert.deepEqual(await typeNames(page), ['Client project']);
    assert.deepEqual(await stageNames(page), ['Planning', 'In progress', 'Review']);
    const preview = await page.$$eval('[data-testid=project-type-preview] .stage-chev', (els) => els.map((el) => el.textContent));
    assert.deepEqual(preview, ['Planning', 'In progress', 'Review']);
  });

  step('adds a type, renames it and adds a stage', async () => {
    await clickButton(page, 'New project type');
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=project-type]').length === 2);
    // The new type is selected: its card shows its name.
    await page.waitForFunction(() => document.querySelector('[data-testid=project-type-card] input.form-input')?.value === 'New project type');
    await retype(page, '[data-testid=project-type-card] input.form-input', 'Website');
    await page.waitForFunction(() => [...document.querySelectorAll('[data-testid=project-type]')].some((el) => el.innerText.startsWith('Website')));
    await clickButton(page, 'New stage');
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=project-stage]').length === 4);
    await retype(page, '[data-testid=project-stage]:nth-of-type(4) input', 'Launch');
    const web = await eventually(async () => (await typesNow(page)).find((t) => t.name === 'Website' && t.stages.at(-1)?.name === 'Launch'));
    assert.ok(web, 'saved');
    assert.deepEqual(
      web.stages.map((s) => s.name),
      ['Planning', 'In progress', 'Review', 'Launch'],
    );
  });

  step('moves a stage up', async () => {
    const rows = await page.$$('[data-testid=project-stage]');
    await (await rows[3].$('button[aria-label="Move up"]')).click();
    await page.waitForFunction(() => [...document.querySelectorAll('[data-testid=project-stage] input')].map((el) => el.value).join() === 'Planning,In progress,Launch,Review');
  });

  step('deletes an empty stage after the app asks', async () => {
    await waitForToastToClear(page);
    const rows = await page.$$('[data-testid=project-stage]');
    await (await rows[1].$('button[aria-label="Delete stage"]')).click();
    assert.equal(await confirmInApp(page), 'Delete In progress?');
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=project-stage]').length === 3);
  });

  step('a stage in use can\'t be deleted: the button is disabled with its reason (CD-280 TC 4)', async () => {
    const web = (await typesNow(page)).find((t) => t.name === 'Website');
    const company = await api(page, '/crm/companies', { method: 'POST', body: JSON.stringify({ name: 'Northwind' }) });
    await api(page, '/projects', { method: 'POST', body: JSON.stringify({ name: 'Northwind site', projectTypeId: web.id, companyId: company.id }) });
    await page.waitForFunction(() => document.querySelector('[data-testid=project-stage]')?.innerText.includes('1 project'));
    const del = await page.$eval('[data-testid=project-stage] button[aria-label="Delete stage"]', (el) => ({ disabled: el.disabled, title: el.title }));
    assert.deepEqual(del, { disabled: true, title: 'In use by 1 project. Move them to another stage first.' });
  });

  step('deletes a type, moving its project to another type', async () => {
    await waitForToastToClear(page);
    await clickButton(page, 'Delete project type');
    await page.waitForSelector('[data-testid=move-projects-to]');
    await click(page, '.modal button::-p-text(Delete project type)');
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=project-type]').length === 1);
    assert.deepEqual(await typeNames(page), ['Client project']);
    const [project] = await api(page, '/projects');
    assert.equal(project.projectTypeName, 'Client project');
    assert.equal(project.stageName, 'Planning');
    await click(page, '[data-testid=project-type]');
  });
});
