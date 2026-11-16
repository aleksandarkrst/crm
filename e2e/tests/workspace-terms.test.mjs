// What a workspace calls projects and tasks (CD-143): Settings → Projects → Names (a modal). An admin
// renames Project and Task; the sidebar, pages, buttons and dialogs use the new names, another tab
// gets them without a reload; invalid names show a field error; "Reset" brings back
// Project and Task.
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { api, BASE_URL, click, eventually, newUserWithWorkspace, steps, useBrowser } from '../lib/harness.mjs';

const navLabels = (page) => page.$$eval('.nav-item', (els) => els.map((el) => el.textContent.trim()));

/** Settings → Projects → Names: a summary row whose Edit opens the Names modal (CD-524). */
async function openNames(page) {
  await page.goto(BASE_URL + '/settings/projects', { waitUntil: 'networkidle0' });
  await click(page, '[data-testid=names-summary] button');
  await page.waitForSelector('[data-testid=names-modal] [data-testid=term-task]');
}

/** Retypes a name and leaves the field with Enter (each name saves when it is left). */
async function retype(page, key, value) {
  await page.$eval(`[data-testid=term-${key}]`, (el) => el.select());
  await page.type(`[data-testid=term-${key}]`, value);
  await page.keyboard.press('Enter');
}

describe('workspace terms', () => {
  const browser = useBrowser();
  const step = steps(browser, 'workspace-terms');
  let page;
  let other;

  step('sets up a workspace; a second tab shows the Projects module', async () => {
    page = await browser.person('tess');
    await newUserWithWorkspace(page, { label: 'terms', name: 'Tess Terms', workspace: 'Terms Co' });
    other = await page.browserContext().newPage();
    await other.setViewport({ width: 1400, height: 1100 });
    await other.goto(BASE_URL + '/tasks', { waitUntil: 'networkidle0' });
    await other.waitForFunction(() => [...document.querySelectorAll('.nav-item')].some((el) => el.textContent.trim() === 'Tasks'));
    // Back to the first tab: a background tab doesn't paint, so waits that poll on animation frames there never end.
    await page.bringToFront();
  });

  step('a task name that repeats a project name shows a field error and saves nothing', async () => {
    await openNames(page);
    await retype(page, 'task', 'project');
    await page.waitForSelector('[data-testid=term-task-error]');
    assert.equal((await api(page, '/workspace')).terms.task, 'Task');
  });

  step('renames Project to Job and Task to Activity; every label follows, in the other tab too', async () => {
    // Each field saves (all four names together) when it is left: wait for one save before the next field.
    for (const [key, value] of [['project', 'Job'], ['projects', 'Jobs'], ['task', 'Activity'], ['tasks', 'Activities']]) {
      await retype(page, key, value);
      assert.ok(await eventually(async () => (await api(page, '/workspace')).terms[key] === value), `${key} saved`);
    }
    const saved = (await api(page, '/workspace')).terms;
    assert.deepEqual(saved, { project: 'Job', projects: 'Jobs', task: 'Activity', tasks: 'Activities' });

    // The other tab, without a reload (the live hint). It is in the background: poll on a timer, not on frames.
    await other.waitForFunction(() => {
      const labels = [...document.querySelectorAll('.nav-item')].map((el) => el.textContent.trim());
      return labels.includes('Jobs') && labels.includes('Activities');
    }, { polling: 250 });
    await other.waitForFunction(() => document.body.innerText.includes('New activity'), { polling: 250 });

    await page.goto(BASE_URL + '/projects', { waitUntil: 'networkidle0' });
    assert.ok((await navLabels(page)).includes('Jobs'));
    await page.waitForFunction(() => document.body.innerText.includes('New job'));
    await click(page, '[data-testid=projects-view-list]');
    await page.waitForFunction(() => document.querySelector('[data-testid=projects-list] .table-head')?.textContent.includes('Job type'));
  });

  step('Reset brings back Project and Task', async () => {
    await openNames(page);
    await click(page, '[data-testid=reset-terms]');
    await page.waitForFunction(() => document.querySelector('[data-testid=term-project]')?.value === 'Project' && document.querySelector('[data-testid=term-task]')?.value === 'Task');
    assert.ok(await eventually(async () => (await api(page, '/workspace')).terms.task === 'Task'), 'reset saved');
    assert.deepEqual((await api(page, '/workspace')).terms, { project: 'Project', projects: 'Projects', task: 'Task', tasks: 'Tasks' });
    await other.waitForFunction(() => [...document.querySelectorAll('.nav-item')].some((el) => el.textContent.trim() === 'Tasks'), { polling: 250 });
  });
});
