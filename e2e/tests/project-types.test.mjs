// Settings → Projects → Project types (CD-272; a table with an editor modal since CD-524): the
// default type, adding and renaming a type, adding, reordering and deleting stages (saved with the
// type; a stage in use can't be deleted, CD-280), and deleting a type (its projects move to another
// type).
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { api, BASE_URL, click, clickButton, eventually, newUserWithWorkspace, setValue, steps, useBrowser, waitForToastToClear, testPib } from '../lib/harness.mjs';

const CARD = '[data-testid=project-type-card]';
const typeNames = (page) => page.$$eval('[data-testid=project-type] td:first-child b', (els) => els.map((el) => el.textContent));
const tableStages = (page) => page.$$eval('[data-testid=project-type-stages]', (els) => els.map((el) => el.textContent));
const editorStages = (page) => page.$$eval(`${CARD} [data-testid=project-stage] input`, (els) => els.map((el) => el.value));
const typesNow = (page) => api(page, '/project-types');

/** Opens a type's editor from its row's ⋯ menu. */
async function editType(page, id) {
  await click(page, `[data-testid=project-type][data-type="${id}"] [data-testid=project-type-menu]`);
  await click(page, '[data-testid=project-type-edit]');
  await page.waitForSelector(`${CARD} [data-testid=project-stage]`);
}

/** Saves the editor (Save, or "Add project type" for a new one) and waits for it to close. */
async function saveEditor(page) {
  await click(page, `${CARD} .gs-sheet-actions .gs-btn.primary`);
  await page.waitForFunction((card) => !document.querySelector(card), {}, CARD);
}

describe('project types', () => {
  const browser = useBrowser();
  const step = steps(browser, 'project-types');
  let page;
  let web;

  step('a new workspace has "Client project" with Planning, In progress and Review', async () => {
    page = await browser.person('pat');
    await newUserWithWorkspace(page, { label: 'ptypes', name: 'Pat Types', workspace: 'Types Co' });
    await page.goto(BASE_URL + '/settings/projects', { waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-testid=project-type]');
    assert.deepEqual(await typeNames(page), ['Client project']);
    // The stages column lists them, Complete last (the stage preview is gone, CD-524).
    assert.deepEqual(await tableStages(page), ['Planning, In progress, Review, Complete']);
  });

  step('adds a type, renames it and adds a stage', async () => {
    await clickButton(page, 'New project type');
    await page.waitForSelector(CARD);
    assert.deepEqual(await editorStages(page), ['Planning', 'In progress']);
    await setValue(page, `${CARD} input[placeholder="e.g. Installation"]`, 'Web');
    await saveEditor(page);
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=project-type]').length === 2);
    web = await eventually(async () => (await typesNow(page)).find((t) => t.name === 'Web'));
    assert.ok(web, 'added');

    await waitForToastToClear(page);
    await editType(page, web.id);
    await setValue(page, `${CARD} input[placeholder="e.g. Installation"]`, 'Website');
    await clickButton(page, '+ Add stage');
    await page.waitForFunction((card) => document.querySelectorAll(`${card} [data-testid=project-stage]`).length === 3, {}, CARD);
    await setValue(page, `${CARD} [data-testid=project-stage]:nth-of-type(3) input`, 'Launch');
    await saveEditor(page);
    const saved = await eventually(async () => (await typesNow(page)).find((t) => t.id === web.id && t.name === 'Website' && t.stages.at(-1)?.name === 'Launch'));
    assert.ok(saved, 'saved');
    assert.deepEqual(
      saved.stages.map((s) => s.name),
      ['Planning', 'In progress', 'Launch'],
    );
    await page.waitForFunction(() => [...document.querySelectorAll('[data-testid=project-type] td:first-child b')].some((el) => el.textContent === 'Website'));
  });

  step('moves a stage up', async () => {
    await waitForToastToClear(page);
    await editType(page, web.id);
    const rows = await page.$$(`${CARD} [data-testid=project-stage]`);
    await (await rows[2].$('button[aria-label="Move up"]')).click();
    await page.waitForFunction((card) => [...document.querySelectorAll(`${card} [data-testid=project-stage] input`)].map((el) => el.value).join() === 'Planning,Launch,In progress', {}, CARD);
    await saveEditor(page);
    assert.ok(await eventually(async () => (await typesNow(page)).find((t) => t.id === web.id).stages.map((s) => s.name).join() === 'Planning,Launch,In progress'), 'order saved');
  });

  step('deletes an empty stage, saved with the type', async () => {
    // The editor removes it at once and saves it with Save (CD-524): no confirm of its own.
    await waitForToastToClear(page);
    await editType(page, web.id);
    const rows = await page.$$(`${CARD} [data-testid=project-stage]`);
    await (await rows[1].$('button[aria-label="Delete stage"]')).click();
    assert.deepEqual(await editorStages(page), ['Planning', 'In progress']);
    await saveEditor(page);
    assert.ok(await eventually(async () => (await typesNow(page)).find((t) => t.id === web.id).stages.map((s) => s.name).join() === 'Planning,In progress'), 'stage deleted');
  });

  step("a stage in use can't be deleted: the button is disabled with its reason (CD-280 TC 4)", async () => {
    const company = await api(page, '/crm/companies', { method: 'POST', body: JSON.stringify({ pib: testPib(), name: 'Northwind' }) });
    await api(page, '/projects', { method: 'POST', body: JSON.stringify({ name: 'Northwind site', projectTypeId: web.id, companyId: company.id }) });
    await page.reload({ waitUntil: 'networkidle0' });
    await editType(page, web.id);
    const del = await page.$eval(`${CARD} [data-testid=project-stage] button[aria-label="Delete stage"]`, (el) => ({ disabled: el.disabled, title: el.title }));
    assert.deepEqual(del, { disabled: true, title: 'In use by 1 project. Move them to another stage first.' });
    await page.keyboard.press('Escape');
    await page.waitForFunction((card) => !document.querySelector(card), {}, CARD);
  });

  step('deletes a type, moving its project to another type', async () => {
    await click(page, `[data-testid=project-type][data-type="${web.id}"] [data-testid=project-type-menu]`);
    await click(page, '[data-testid=project-type-delete]');
    await page.waitForSelector('[data-testid=delete-type-confirm]');
    // Its project goes to the type picked in "Move the project to" (the other type, preselected).
    assert.equal(await page.$eval('[data-testid=delete-type-confirm] [role=radio][aria-checked=true]', (el) => el.textContent), 'Client project');
    await click(page, '[data-testid=delete-type-confirm] [data-testid=gs-confirm]');
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=project-type]').length === 1);
    assert.deepEqual(await typeNames(page), ['Client project']);
    const [project] = await api(page, '/projects');
    assert.equal(project.projectTypeName, 'Client project');
    assert.equal(project.stageName, 'Planning');
  });
});
