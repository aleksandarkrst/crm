// First run (CD-68): a new workspace shows the getting-started checklist and helpful empty
// states; sample data loads and is removed again exactly; the checklist hides per user and is
// not shown to members.
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { api, BASE_URL, click, clickButton, email, eventually, newUserWithWorkspace, signIn, steps, text, useBrowser, waitForToastToClear } from '../lib/harness.mjs';

describe('first-run onboarding', () => {
  const browser = useBrowser();
  const step = steps(browser, 'onboarding');
  let page;

  const emptyTitle = () => page.evaluate(() => document.querySelector('[data-testid=empty-state] .empty-block-title')?.textContent ?? null);
  const stepsDone = () => page.$$eval('[data-testid=getting-started] li', (lis) => Object.fromEntries(lis.map((li) => [li.dataset.step, li.dataset.done === 'true'])));

  step('a new workspace shows the checklist with nothing done', async () => {
    page = await browser.person('nora');
    await newUserWithWorkspace(page, { label: 'onboard', name: 'Nora Owner', workspace: 'Fresh Co' });
    await page.waitForSelector('[data-testid=getting-started]');
    assert.deepEqual(await stepsDone(), { funnel: false, products: false, deals: false, invite: false });
    assert.match(await text(page), /0 of 4 done/);
  });

  step('each main screen has an empty state with the action that fills it', async () => {
    const screens = [
      ['/pipeline', 'No deals yet', 'New deal'],
      ['/companies', 'No companies yet', 'Add company'],
      ['/contacts', 'No contacts yet', 'New contact'],
      ['/products', 'No products or services yet', 'New product'],
      ['/today', 'Nothing to do yet', 'New deal'],
      ['/overview', 'Nothing to measure yet', 'New deal'],
    ];
    for (const [path, title, action] of screens) {
      await page.goto(BASE_URL + path, { waitUntil: 'networkidle0' });
      await page.waitForSelector('[data-testid=empty-state]');
      assert.equal(await emptyTitle(), title, path);
      const hasAction = await page.$$eval('[data-testid=empty-state] button', (bs, action) => bs.some((b) => b.textContent.trim() === action), action);
      assert.ok(hasAction, `${path}: ${action}`);
    }
    // The action works: "New product" from the empty state opens the dialog.
    await page.goto(BASE_URL + '/products', { waitUntil: 'networkidle0' });
    await click(page, '[data-testid=empty-state] button.btn-primary');
    await page.waitForFunction(() => document.querySelector('.modal')?.innerText.includes('product'));
    await clickButton(page, 'Cancel');
  });

  step('loads sample data from the checklist', async () => {
    await page.goto(BASE_URL + '/pipeline', { waitUntil: 'networkidle0' });
    await click(page, '[data-testid=getting-started] [data-testid=load-sample-data]');
    await page.waitForSelector('[data-testid=remove-sample-data]', { timeout: 15_000 });
    await page.waitForFunction(() => document.body.innerText.includes('Kestrel Logistics'));
    assert.equal(await page.$('[data-testid=empty-state]'), null, 'the pipeline is no longer empty');
    // Sample records don't tick the checklist: it is about the workspace's own setup.
    assert.deepEqual(await stepsDone(), { funnel: false, products: false, deals: false, invite: false });
    const deals = await api(page, '/crm/deals');
    assert.equal(deals.length, 6);
    await page.goto(BASE_URL + '/today', { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.body.innerText.includes('Send pricing for three depots'));
  });

  step('real work ticks the checklist, and removing sample data keeps it', async () => {
    await waitForToastToClear(page);
    const funnels = await api(page, '/crm/funnels');
    await api(page, '/crm/deals', { method: 'POST', body: JSON.stringify({ title: 'My own deal', funnelId: funnels[0].id }) });
    await page.goto(BASE_URL + '/pipeline', { waitUntil: 'networkidle0' });
    assert.equal((await stepsDone()).deals, true);

    await click(page, '[data-testid=getting-started] [data-testid=remove-sample-data]');
    await page.waitForSelector('[data-testid=load-sample-data]', { timeout: 15_000 });
    const left = await eventually(async () => {
      const d = await api(page, '/crm/deals');
      return d.length === 1 && d;
    });
    assert.ok(left, 'only the real deal is left');
    assert.equal(left[0].deal.title, 'My own deal');
    assert.equal((await api(page, '/crm/companies')).length, 0);
    assert.equal((await api(page, '/crm/contacts')).length, 0);
  });

  step('hiding the checklist is remembered, and it can be shown again from settings', async () => {
    await clickButton(page, 'Hide');
    await page.waitForFunction(() => !document.querySelector('[data-testid=getting-started]'));
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('button::-p-text(New deal)');
    assert.equal(await page.$('[data-testid=getting-started]'), null);
    await page.goto(BASE_URL + '/settings/workspace', { waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-testid=sample-data-card]');
    await clickButton(page, 'Show the getting-started checklist');
    await eventually(async () => !(await api(page, '/onboarding')).dismissed);
    await page.goto(BASE_URL + '/pipeline', { waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-testid=getting-started]');
  });

  step('members see neither the checklist nor sample data buttons', async () => {
    const { token } = await api(page, '/team/invitations', { method: 'POST', body: JSON.stringify({ email: email('onboard-member'), role: 'member' }) });
    const member = await browser.person('mo');
    await member.goto(`${BASE_URL}/invite/${token}`, { waitUntil: 'networkidle0' });
    await signIn(member, email('onboard-member'), 'Mo Member');
    await clickButton(member, 'Accept and join');
    await member.waitForSelector('button::-p-text(New deal)');
    await member.goto(BASE_URL + '/companies', { waitUntil: 'networkidle0' });
    await member.waitForSelector('[data-testid=empty-state]');
    assert.equal(await member.$('[data-testid=getting-started]'), null);
    assert.equal(await member.$('button::-p-text(load sample data)'), null);
  });
});
