// Design v2 gaps (CD-263): the Projects board card's progress, next open tasks and "N open tasks";
// the list's Progress and Tasks columns; the project's Work orders under its Plan; work orders in
// Ctrl/⌘K; "Add starter tasks from the products" when a project starts from a deal.
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { api, BASE_URL, click, newUserWithWorkspace, steps, useBrowser } from '../lib/harness.mjs';

describe('projects design v2', () => {
  const browser = useBrowser();
  const step = steps(browser, 'projects-design-v2');
  let page;
  let company;
  let project;
  let order;
  let dealId;

  step('sets up a project with a done task, an open one and a work order', async () => {
    page = await browser.person('vera');
    await newUserWithWorkspace(page, { label: 'design-v2', name: 'Vera Vee', workspace: 'Vee Co' });
    const [type] = await api(page, '/project-types');
    company = await api(page, '/crm/companies', { method: 'POST', body: JSON.stringify({ name: 'Northwind' }) });
    project = await api(page, '/projects', { method: 'POST', body: JSON.stringify({ name: 'Service 2026', projectTypeId: type.id, companyId: company.id }) });
    const task = (body) => api(page, '/tasks', { method: 'POST', body: JSON.stringify({ projectId: project.id, ...body }) });
    const done = await task({ name: 'Site survey' });
    await api(page, '/tasks/' + done.id, { method: 'PATCH', body: JSON.stringify({ status: 'done' }) });
    await task({ name: 'Order the units', dueDate: '2026-11-04' });
    order = await api(page, '/work-orders', { method: 'POST', body: JSON.stringify({ title: 'Install the units', companyId: company.id, projectId: project.id }) });
  });

  step('the board card shows progress, the next open task and "1 open task"', async () => {
    await page.goto(BASE_URL + '/projects', { waitUntil: 'networkidle0' });
    const card = await page.waitForSelector('[data-testid=project-card]');
    await page.waitForFunction(() => document.querySelector('[data-testid=project-card] [data-testid=project-progress]')?.textContent.includes('50%'));
    assert.match(await card.$eval('[data-testid=project-card-next]', (el) => el.textContent), /Order the units/);
    assert.doesNotMatch(await card.$eval('[data-testid=project-card-next]', (el) => el.textContent), /Site survey/);
    assert.match(await card.$eval('[data-testid=project-card-foot]', (el) => el.textContent), /^1 open task/);
  });

  step('the list has Progress and Tasks', async () => {
    await click(page, '[data-testid=projects-view-list]');
    const row = await page.waitForSelector('[data-testid=projects-row]');
    const text = await row.evaluate((el) => el.innerText);
    assert.match(text, /50%/);
    assert.match(text, /1 open/);
  });

  step("the Plan tab lists the project's work orders, with New work order", async () => {
    await page.goto(BASE_URL + '/projects/' + project.id, { waitUntil: 'networkidle0' });
    await click(page, '[data-testid=project-tab-plan]');
    const row = await page.waitForSelector(`[data-testid=project-work-order-row][data-work-order="WO-${order.number}"]`);
    assert.match(await row.evaluate((el) => el.innerText), /Install the units[\s\S]*Assign later[\s\S]*Unscheduled/);
    await click(page, '[data-testid=project-new-work-order]');
    await page.waitForFunction(() => document.querySelector('.modal')?.innerText.includes('Service 2026'));
    await page.keyboard.press('Escape');
  });

  step('Ctrl/⌘K finds the work order', async () => {
    await page.keyboard.down('Control');
    await page.keyboard.press('k');
    await page.keyboard.up('Control');
    await page.waitForSelector('[data-testid=palette-input]');
    await page.type('[data-testid=palette-input]', `WO-${order.number}`);
    await page.waitForFunction(() => document.querySelector('[data-group="Work orders"]')?.innerText.includes('Install the units'));
    await page.keyboard.press('Enter');
    await page.waitForFunction((id) => location.pathname === '/work-orders/' + id, {}, order.id);
  });

  step('a project from a won deal can start with a task per product', async () => {
    const [funnel] = await api(page, '/crm/funnels');
    const deal = await api(page, '/crm/deals', { method: 'POST', body: JSON.stringify({ title: 'AC rollout', funnelId: funnel.id, companyId: company.id }) });
    dealId = deal.id;
    const product = await api(page, '/crm/products', { method: 'POST', body: JSON.stringify({ name: 'Installation work', unit: 'h', unitPrice: 50 }) });
    const line = { productId: product.id, quantity: 8, unitPrice: 50, vatRate: 20, discountKind: 'percent', discountValue: 0, billingFrequency: 'one_time', billingCycles: null, startDate: null };
    await api(page, `/crm/deals/${dealId}/products`, { method: 'PUT', body: JSON.stringify({ taxMode: 'exclusive', lines: [line] }) });
    await api(page, `/crm/deals/${dealId}/move`, { method: 'POST', body: JSON.stringify({ stageId: funnel.stages.find((s) => s.isWon).id }) });

    await page.goto(BASE_URL + '/deals/' + dealId, { waitUntil: 'networkidle0' });
    await click(page, '[data-testid=create-project]');
    await click(page, '[data-testid=starter-tasks] [role=switch]');
    await click(page, '[data-testid=create-project-submit]');
    await page.waitForFunction(() => /^\/projects\/[0-9a-f-]+$/.test(location.pathname));
    const projectId = page.url().split('/projects/')[1];
    const tasks = await api(page, '/tasks?projectId=' + projectId);
    assert.deepEqual(
      tasks.map((t) => [t.name, t.estimateHours]),
      [['Installation work', 8]],
    );
  });
});
