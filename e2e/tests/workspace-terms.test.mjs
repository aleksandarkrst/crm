// What a workspace calls projects and tasks (CD-143): Settings → Project hierarchy → Names. An admin
// renames Project and Task; the sidebar, pages, buttons and dialogs use the new names, another tab
// gets them without a reload; invalid names show a field error; "Reset to defaults" brings back
// Project and Task.
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { api, BASE_URL, click, eventually, newUserWithWorkspace, steps, useBrowser } from '../lib/harness.mjs';

const navLabels = (page) => page.$$eval('.nav-item', (els) => els.map((el) => el.textContent.trim()));

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
    await page.goto(BASE_URL + '/settings/project-hierarchy', { waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-testid=project-terms]');
    await page.$eval('[data-testid=term-task]', (el) => el.select());
    await page.type('[data-testid=term-task]', 'project');
    await click(page, '[data-testid=save-terms]');
    await page.waitForSelector('[data-testid=term-task-error]');
    assert.equal((await api(page, '/workspace')).terms.task, 'Task');
  });

  step('renames Project to Job and Task to Activity; every label follows, in the other tab too', async () => {
    for (const [key, value] of [['project', 'Job'], ['projects', 'Jobs'], ['task', 'Activity'], ['tasks', 'Activities']]) {
      await page.$eval(`[data-testid=term-${key}]`, (el) => el.select());
      await page.type(`[data-testid=term-${key}]`, value);
    }
    await click(page, '[data-testid=save-terms]');
    // Title stays "Project hierarchy" on this route; inputs already show Job/Activity from typing, so
    // wait until the API has the saved terms (not the draft values).
    const saved = await eventually(async () => {
      const terms = (await api(page, '/workspace')).terms;
      return terms.project === 'Job' && terms.task === 'Activity' && terms;
    });
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

  step('Reset to defaults brings back Project and Task', async () => {
    await page.goto(BASE_URL + '/settings/project-hierarchy', { waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-testid=project-terms]');
    await click(page, '[data-testid=reset-terms]');
    await page.waitForFunction(() => document.querySelector('[data-testid=term-project]')?.value === 'Project' && document.querySelector('[data-testid=term-task]')?.value === 'Task');
    assert.deepEqual((await api(page, '/workspace')).terms, { project: 'Project', projects: 'Projects', task: 'Task', tasks: 'Tasks' });
    await other.waitForFunction(() => [...document.querySelectorAll('.nav-item')].some((el) => el.textContent.trim() === 'Tasks'), { polling: 250 });
  });
});
