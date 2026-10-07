// Projects (CD-234, CD-144 TC 1, 5, 16): create from a company page, the company's Projects card,
// the "+" menu ("Deal task" T, "Project" J), the Projects board and list, the project page (health,
// cancel with a reason, reopen, another company clears the deal), Ctrl/⌘K, the workspace setting
// and delete.
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { api, BASE_URL, click, clickButton, confirmInApp, eventually, newUserWithWorkspace, setValue, steps, useBrowser, waitForToastToClear } from '../lib/harness.mjs';

describe('projects', () => {
  const browser = useBrowser();
  const step = steps(browser, 'projects');
  let page;
  let acme;
  let beta;
  let dealId;
  let projectId;

  step('sets up two companies and a won deal of the first', async () => {
    page = await browser.person('pia');
    await newUserWithWorkspace(page, { label: 'projects', name: 'Pia Projects', workspace: 'Projects Co' });
    const [funnel] = await api(page, '/crm/funnels');
    acme = await api(page, '/crm/companies', { method: 'POST', body: JSON.stringify({ name: 'Acme' }) });
    beta = await api(page, '/crm/companies', { method: 'POST', body: JSON.stringify({ name: 'Beta' }) });
    const deal = await api(page, '/crm/deals', { method: 'POST', body: JSON.stringify({ title: 'Acme service deal', funnelId: funnel.id, companyId: acme.id }) });
    await api(page, `/crm/deals/${deal.id}/move`, { method: 'POST', body: JSON.stringify({ stageId: funnel.stages.find((s) => s.isWon).id }) });
    dealId = deal.id;
  });

  step('the company page has an empty Projects card; "+" starts a project for it (TC 1)', async () => {
    await page.goto(BASE_URL + '/companies/' + acme.id, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.querySelector('[data-testid=company-projects]')?.innerText.includes('No projects for this company yet.'));
    await click(page, '[data-testid=company-add-project]');
    await page.waitForSelector('[data-testid=project-company-fixed]');
    assert.equal(await page.$eval('[data-testid=project-company-fixed]', (el) => el.value), 'Acme');
    // The deal picker offers the won deal.
    const deals = await page.$$eval('[data-testid=project-deal] option', (els) => els.map((el) => el.textContent));
    assert.deepEqual(deals, ['No deal', 'Acme service deal']);
    await page.type('[data-testid=project-name]', 'Service 2026');
    await page.type('[data-testid=project-code]', 'SRV-26');
    await setValue(page, '[data-testid=project-deal]', dealId);
    await page.waitForSelector('[data-testid=project-type] option:checked');
    await click(page, '[data-testid=create-project-submit]');
    await page.waitForFunction(() => location.pathname.startsWith('/projects/'));
    projectId = page.url().split('/projects/')[1];
    await page.waitForSelector('[data-testid=project-page]');
    const p = await api(page, '/projects/' + projectId);
    assert.equal(p.companyName, 'Acme');
    assert.equal(p.code, 'SRV-26');
    assert.equal(p.dealId, dealId);

    await page.goto(BASE_URL + '/companies/' + acme.id, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.querySelector('[data-testid=company-project]')?.innerText.includes('SRV-26 · Service 2026'));
  });

  step('the "+" menu has "Deal task" (T) and "Project" (J); J opens New project (TC 16)', async () => {
    await page.goto(BASE_URL + '/pipeline', { waitUntil: 'networkidle0' });
    await click(page, '[data-testid=new-menu]');
    const items = await page.$$eval('.new-menu-pop [role=menuitem]', (els) => els.map((el) => el.innerText.replace(/\s+/g, ' ').trim()));
    assert.ok(items.some((t) => /^Deal task/.test(t) && /\bT$/.test(t)), items.join(' | '));
    assert.ok(items.some((t) => /^Project/.test(t) && /\bJ$/.test(t)), items.join(' | '));
    await page.keyboard.press('j');
    await page.waitForSelector('[data-testid=project-company]');
    assert.equal(await page.$eval('.modal-title', (el) => el.textContent), 'New project');
    await clickButton(page, 'Cancel');
    await page.waitForFunction(() => !document.querySelector('.modal'));
  });

  step('the Projects board shows it in its stage, and the list too', async () => {
    await page.goto(BASE_URL + '/projects', { waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-testid=projects-board]');
    await page.waitForFunction(() => document.querySelector('[data-testid=projects-column][data-stage=Planning]')?.innerText.includes('Service 2026'));
    await click(page, '[data-testid=projects-view-list]');
    const row = await page.waitForSelector('[data-testid=projects-row]');
    assert.match(await row.evaluate((el) => el.innerText), /SRV-26 · Service 2026/);
  });

  step('Ctrl/⌘K finds the project by its code', async () => {
    await page.keyboard.down('Control');
    await page.keyboard.press('k');
    await page.keyboard.up('Control');
    await page.waitForSelector('[data-testid=palette-input]');
    await page.type('[data-testid=palette-input]', 'srv-26');
    await page.waitForFunction(() => document.querySelector('[data-group=Projects]')?.innerText.includes('Service 2026'));
    await page.keyboard.press('Enter');
    await page.waitForFunction((id) => location.pathname === '/projects/' + id, {}, projectId);
  });

  step('the project page: health, cancel with a reason, reopen', async () => {
    await page.waitForSelector('[data-testid=project-health]');
    await setValue(page, '[data-testid=project-health]', 'at_risk');
    assert.ok(await eventually(async () => (await api(page, '/projects/' + projectId)).health === 'at_risk'));
    await waitForToastToClear(page).catch(() => {});
    await click(page, '[data-testid=cancel-project]');
    await page.waitForSelector('[data-testid=cancel-reasons]');
    assert.ok(await page.$eval('[data-testid=confirm-cancel-project]', (el) => el.disabled), 'needs a reason');
    await clickButton(page, 'Budget cut');
    await click(page, '[data-testid=confirm-cancel-project]');
    await page.waitForSelector('[data-testid=reopen-project]');
    const cancelled = await api(page, '/projects/' + projectId);
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(cancelled.cancelReason, 'Budget cut');
    await click(page, '[data-testid=reopen-project]');
    await page.waitForSelector('[data-testid=complete-project]');
    assert.equal((await api(page, '/projects/' + projectId)).status, 'open');
  });

  step('another company clears the deal, after a confirmation (TC 5)', async () => {
    await setValue(page, '[data-testid=project-company-field]', beta.id);
    assert.equal(await confirmInApp(page), 'Move Service 2026 to Beta?');
    const moved = await eventually(async () => {
      const p = await api(page, '/projects/' + projectId);
      return p.companyId === beta.id && p;
    });
    assert.ok(moved, 'moved');
    assert.equal(moved.dealId, null);
  });

  step('Settings → Workspace has "Create a project when a deal is won"', async () => {
    await page.goto(BASE_URL + '/settings/workspace', { waitUntil: 'networkidle0' });
    await click(page, '[data-testid=auto-create-projects] [role=switch]');
    assert.ok(await eventually(async () => (await api(page, '/workspace')).autoCreateProjects === true));
  });

  step('an owner deletes the project', async () => {
    await page.goto(BASE_URL + '/projects/' + projectId, { waitUntil: 'networkidle0' });
    await click(page, 'button[aria-label="More actions"]');
    await click(page, '[data-testid=delete-project]');
    assert.equal(await confirmInApp(page), 'Delete Service 2026?');
    await page.waitForFunction(() => location.pathname === '/projects');
    assert.deepEqual(await api(page, '/projects'), []);
  });
});
