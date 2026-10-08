// Won deal → project (CD-275): a won deal offers "Create project"; the "New project from deal"
// dialog is prefilled from the deal; creating opens the project, whose stage bar and Complete work;
// the deal then offers "Open project" and its Summary lists the project with its status.
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { api, BASE_URL, click, eventually, newUserWithWorkspace, setValue, steps, useBrowser, waitForToastToClear } from '../lib/harness.mjs';

describe('won deal → project', () => {
  const browser = useBrowser();
  const step = steps(browser, 'won-deal-project');
  let page;
  let dealId;
  let projectId;

  step('sets up a won deal of a company, and an open one', async () => {
    page = await browser.person('wes');
    await newUserWithWorkspace(page, { label: 'wonproj', name: 'Wes Winner', workspace: 'Won Co' });
    const [funnel] = await api(page, '/crm/funnels');
    const company = await api(page, '/crm/companies', { method: 'POST', body: JSON.stringify({ name: 'Northwind Logistics' }) });
    const deal = await api(page, '/crm/deals', { method: 'POST', body: JSON.stringify({ title: 'Website and CRM rollout', funnelId: funnel.id, companyId: company.id }) });
    await api(page, `/crm/deals/${deal.id}/move`, { method: 'POST', body: JSON.stringify({ stageId: funnel.stages.find((s) => s.isWon).id }) });
    dealId = deal.id;
  });

  step('a won deal offers "Create project"; an open deal does not', async () => {
    await page.goto(BASE_URL + '/deals/' + dealId, { waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-testid=won-state]');
    await page.waitForSelector('[data-testid=create-project]');
    assert.equal(await page.$('[data-testid=open-project]'), null);
    assert.equal(await page.$('[data-testid=deal-projects]'), null, 'no Project row yet');
  });

  step('the dialog is prefilled from the deal', async () => {
    await click(page, '[data-testid=create-project]');
    await page.waitForSelector('.modal [data-testid=project-name]');
    assert.equal(await page.$eval('.modal-title', (el) => el.textContent), 'New project from deal');
    const summary = await page.$eval('[data-testid=project-deal-summary]', (el) => el.textContent.replace(/\s+/g, ' '));
    assert.match(summary, /Northwind Logistics ?· ?Website and CRM rollout/);
    assert.equal(await page.$eval('[data-testid=project-name]', (el) => el.value), 'Website and CRM rollout');
    // The project types load with the dialog.
    await page.waitForSelector('[data-testid=project-type] option:checked');
    assert.equal(await page.$eval('[data-testid=project-type] option:checked', (el) => el.textContent), 'Client project');
    assert.equal(await page.$eval('[data-testid=project-lead] option:checked', (el) => el.textContent), 'Wes Winner');
    await page.waitForFunction(() => document.querySelector('[data-testid=project-stages]')?.textContent === 'Planning → In progress → Review');
  });

  step('creating opens the project, linked to the company and the deal', async () => {
    await setValue(page, '[data-testid=project-name]', 'Northwind rollout');
    await click(page, '[data-testid=create-project-submit]');
    await page.waitForFunction(() => location.pathname.startsWith('/projects/'));
    projectId = page.url().split('/projects/')[1];
    await page.waitForFunction(() => document.body.innerText.includes('Project created from Website and CRM rollout'));
    await page.waitForSelector('[data-testid=project-page]');
    assert.equal(await page.$eval('[data-testid=project-title]', (el) => el.value), 'Northwind rollout');
    assert.equal(await page.$eval('[data-testid=project-type-field] option:checked', (el) => el.textContent), 'Client project');
    // The Linked card: the deal's company and the deal.
    assert.equal(await page.$eval('[data-testid=project-company-field] option:checked', (el) => el.textContent), 'Northwind Logistics');
    assert.equal(await page.$eval('[data-testid=project-deal-field] option:checked', (el) => el.textContent), 'Website and CRM rollout');
    const project = await api(page, '/projects/' + projectId);
    assert.equal(project.dealId, dealId);
    assert.equal(project.stageName, 'Planning');
  });

  step('the stage bar moves the project; Complete closes it on the last stage', async () => {
    await waitForToastToClear(page);
    await click(page, '[data-testid=project-stage-bar] button[title="Move to In progress"]');
    await page.waitForFunction(() => document.querySelector('[data-testid=project-stage-bar] .current')?.textContent === 'In progress');
    await waitForToastToClear(page);
    await click(page, '[data-testid=complete-project]');
    const done = await eventually(async () => (await api(page, '/projects/' + projectId)).status === 'completed');
    assert.ok(done, 'completed');
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent === 'Reopen'));
    // Like a won deal on the Won stage (CD-282).
    await page.waitForFunction(() => document.querySelector('[data-testid=project-stage-bar] .current')?.textContent === 'Review');
  });

  step('the deal now offers "Open project" and lists it in the Summary', async () => {
    await click(page, '[data-testid=project-deal-link]');
    await page.waitForFunction(() => location.pathname.startsWith('/deals/'));
    await page.waitForSelector('[data-testid=open-project]');
    assert.equal(await page.$('[data-testid=create-project]'), null);
    const row = await page.waitForSelector('[data-testid=deal-projects]');
    assert.match(await row.evaluate((el) => el.innerText), /Northwind rollout\s*Completed/);
    await click(page, '[data-testid=open-project]');
    await page.waitForFunction((id) => location.pathname === '/projects/' + id, {}, projectId);
  });
});
