// CD-32: renaming a checklist item in the funnel builder keeps the tick a deal already has on it.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { api, BASE_URL, createDealInUi, eventually, newUserWithWorkspace, setValue, steps, useBrowser, waitForToastToClear } from '../lib/harness.mjs';

describe('renaming a checklist item', () => {
  const browser = useBrowser();
  const step = steps(browser, 'checklist-rename');
  let page;
  let dealId;

  /** The to-do row (the element holding its "Mark done" button) for a to-do label. */
  const todoRow = (label) =>
    page.evaluateHandle((label) => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === label);
      let row = btn;
      while (row && !row.querySelector('button[title="Mark done"]')) row = row.parentElement;
      return row;
    }, label);

  step('ticks a playbook to-do on a new deal', async () => {
    page = await browser.person('rhea');
    await newUserWithWorkspace(page, { label: 'rename', name: 'Rhea Tester', workspace: 'Rename Co' });
    dealId = await createDealInUi(page, { company: 'Globex', contact: 'Hank Scorpio' });
    await waitForToastToClear(page);
    const row = await todoRow('Website + socials reviewed');
    await (await row.$('button[title="Mark done"]')).click();
    const saved = await eventually(async () => (await api(page, '/crm/deal-tasks')).find((t) => t.dealId === dealId && t.label === 'Website + socials reviewed' && t.done));
    assert.ok(saved, 'tick saved');
    assert.ok(saved.checklistItemId, 'linked to the checklist item');
  });

  step('renames the item in the funnel builder', async () => {
    await page.goto(BASE_URL + '/settings/funnel', { waitUntil: 'networkidle0' });
    const found = await page.evaluate(() => {
      const input = [...document.querySelectorAll('.gate-chip input')].find((i) => i.value === 'Website + socials reviewed');
      if (input) input.setAttribute('data-e2e', 'rename-me');
      return !!input;
    });
    assert.ok(found, 'checklist item shown in the builder');
    await setValue(page, 'input[data-e2e=rename-me]', 'Socials checked');
    const stage = await eventually(async () => {
      const funnels = await api(page, '/crm/funnels');
      return funnels.flatMap((f) => f.stages).find((s) => s.checklistItems.some((i) => i.label === 'Socials checked'));
    });
    assert.ok(stage, 'rename saved');
  });

  step('the deal still has the tick, under the new name, after a reload', async () => {
    await page.goto(BASE_URL + '/deals/' + dealId, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.body.innerText.includes('Socials checked'));
    const status = await (await todoRow('Socials checked')).evaluate((el) => el.innerText);
    assert.match(status, /Done .* by Rhea/);
    const tasks = (await api(page, '/crm/deal-tasks')).filter((t) => t.dealId === dealId);
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].label, 'Socials checked');
    assert.equal(tasks[0].done, true);
  });

  it('throws no uncaught errors in the page', () => {
    assert.deepEqual(browser.errors, []);
  });
});
