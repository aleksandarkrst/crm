// A task's checklist, files and comments (CD-270, design v2 §4): items added with Add and Enter,
// "N of M", ticking and removing; "New file" on the task, shown in the project's Documents tab as
// "Linked to: T-1"; a comment posted and deleted, with the empty texts.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe } from 'node:test';
import { api, BASE_URL, click, newUserWithWorkspace, steps, useBrowser, waitForToastToClear } from '../lib/harness.mjs';

describe('task notes', () => {
  const browser = useBrowser();
  const step = steps(browser, 'task-notes');
  let page;
  let project;
  let task;

  step('sets up a task', async () => {
    page = await browser.person('nora');
    await newUserWithWorkspace(page, { label: 'notes', name: 'Nora Notes', workspace: 'Notes Co' });
    const company = await api(page, '/crm/companies', { method: 'POST', body: JSON.stringify({ name: 'Northwind' }) });
    const [type] = await api(page, '/project-types');
    project = await api(page, '/projects', { method: 'POST', body: JSON.stringify({ name: 'Fit-out', projectTypeId: type.id, companyId: company.id }) });
    task = await api(page, '/tasks', { method: 'POST', body: JSON.stringify({ projectId: project.id, name: 'Survey' }) });
    await page.goto(BASE_URL + '/tasks/' + task.id, { waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-testid=task-checklist]');
  });

  step('the checklist: Enter and Add, "N of M", tick, remove', async () => {
    await page.type('[data-testid=checklist-input]', 'Measure the roof');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=checklist-item]').length === 1);
    await page.type('[data-testid=checklist-input]', 'Photograph the units');
    await click(page, '[data-testid=checklist-add]');
    await page.waitForFunction(() => document.querySelector('[data-testid=checklist-count]')?.textContent === '0 of 2');
    await click(page, '[data-testid=checklist-item] [role=checkbox]');
    await page.waitForFunction(() => document.querySelector('[data-testid=checklist-count]')?.textContent === '1 of 2');
    assert.equal(await page.$eval('[data-testid=checklist-item] input', (el) => getComputedStyle(el).textDecorationLine), 'line-through');
    await click(page, '[data-testid=checklist-item]:last-child button[aria-label^=Remove]');
    await page.waitForFunction(() => document.querySelector('[data-testid=checklist-count]')?.textContent === '1 of 1');
    assert.deepEqual((await api(page, `/tasks/${task.id}/checklist`)).map((i) => [i.text, i.done]), [['Measure the roof', true]]);
  });

  step('"New file" adds a file to the task, and the Documents tab links it to T-1', async () => {
    assert.match(await page.$eval('[data-testid=task-files]', (el) => el.textContent), /Files you add here also appear in the project's Documents tab\./);
    const path = join(tmpdir(), `survey-${Date.now()}.pdf`);
    await writeFile(path, '%PDF-1.4 survey');
    await waitForToastToClear(page);
    const input = await page.waitForSelector('[data-testid=task-file-input]');
    await input.uploadFile(path);
    await page.waitForSelector('[data-testid=task-file]');
    assert.match(await page.$eval('[data-testid=task-file] .file-tile', (el) => el.textContent), /PDF/);
    await page.goto(BASE_URL + '/projects/' + project.id, { waitUntil: 'networkidle0' });
    await click(page, '[data-testid=project-tab-documents]');
    await page.waitForSelector('[data-testid=file-task-link]');
    assert.equal(await page.$eval('[data-testid=file-task-link]', (el) => el.textContent), 'T-1');
  });

  step('comments: the empty text, post one, delete it', async () => {
    await page.goto(BASE_URL + '/tasks/' + task.id, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.querySelector('[data-testid=task-comments]')?.textContent.includes('No comments yet. Comments are visible to everyone on the project team.'));
    await page.type('[data-testid=comment-input]', 'Roof access is booked for Tuesday.');
    await click(page, '[data-testid=comment-send]');
    await page.waitForSelector('[data-testid=task-comment]');
    assert.match(await page.$eval('[data-testid=task-comment]', (el) => el.textContent), /Nora Notes.*Roof access is booked for Tuesday\./);
    await click(page, '[data-testid=task-comment] button[aria-label="Delete comment"]');
    await page.waitForFunction(() => !document.querySelector('[data-testid=task-comment]'));
  });
});
