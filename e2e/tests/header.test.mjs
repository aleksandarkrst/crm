// The header and sidebar tools: the command palette with Ctrl+K, its search and keyboard
// navigation (CD-63, CD-80), the "+" menu on any screen (CD-66, CD-80) and the account menu. The
// sidebar's module and workspace switcher is in module-switcher.test.mjs (CD-214).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { api, BASE_URL, click, clickButton, createDealInUi, newUserWithWorkspace, RUN, setValue, steps, useBrowser, waitForToastToClear } from '../lib/harness.mjs';

/** The search results as { group, title, selected } rows, in screen order. */
const results = (page) =>
  page.$$eval('[data-testid=search-results] [role=option]', (els) =>
    els.map((el) => ({
      group: el.closest('[data-group]')?.getAttribute('data-group'),
      title: el.querySelector('.search-item-title')?.textContent,
      selected: el.getAttribute('aria-selected') === 'true',
    })),
  );

/** Opens the palette from the header (if it isn't open) and searches. */
async function search(page, query) {
  if (!(await page.$('[data-testid=palette]'))) await click(page, '[data-testid=global-search]');
  await page.waitForSelector('[data-testid=palette-input]');
  await setValue(page, '[data-testid=palette-input]', '');
  await page.type('[data-testid=palette-input]', query);
  await page.waitForSelector('[data-testid=search-results] [role=option]');
  return results(page);
}

describe('command palette, + menu and account menu', () => {
  const browser = useBrowser();
  const step = steps(browser, 'header');
  const firstWorkspace = `Header Studio ${RUN}`;
  let page;
  let northwindId;

  step('sets up a workspace with two deals', async () => {
    page = await browser.person('hana');
    await newUserWithWorkspace(page, { label: 'hana', name: 'Hana Header', workspace: firstWorkspace });
    northwindId = await createDealInUi(page, { company: 'Northwind d.o.o.', contact: 'Ana Marković' });
    // The second deal through the API (the New deal dialog offers existing companies first).
    const funnels = await api(page, '/crm/funnels');
    const company = await api(page, '/crm/companies', { method: 'POST', body: JSON.stringify({ name: 'Bluefin Labs' }) });
    const contact = await api(page, '/crm/contacts', { method: 'POST', body: JSON.stringify({ fullName: 'Petar Petrović', companyId: company.id, email: 'petar@bluefin.test' }) });
    await api(page, '/crm/deals', { method: 'POST', body: JSON.stringify({ title: 'Bluefin Labs', funnelId: funnels[0].id, companyId: company.id, primaryContactId: contact.id }) });
    await page.reload({ waitUntil: 'networkidle0' });
  });

  step('Ctrl+K opens the command palette from any screen, with the actions', async () => {
    await page.goto(BASE_URL + '/products', { waitUntil: 'networkidle0' });
    await page.click('h1');
    await page.keyboard.down('Control');
    await page.keyboard.press('k');
    await page.keyboard.up('Control');
    await page.waitForSelector('[data-testid=palette]');
    const focused = await page.evaluate(() => document.activeElement?.getAttribute('data-testid'));
    assert.equal(focused, 'palette-input');
    const rows = await results(page);
    for (const title of ['Create deal', 'Create contact', 'Create company', 'Create task', 'Create product', 'Pipeline', 'Workspace settings']) {
      assert.ok(rows.some((r) => r.title === title), `${title} in ${JSON.stringify(rows)}`);
    }
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('[data-testid=palette]'));
  });

  step('finds a deal by part of its name and opens it with Enter', async () => {
    const rows = await search(page, 'northw');
    assert.deepEqual(rows[0], { group: 'Deals', title: 'Northwind d.o.o.', selected: true }, JSON.stringify(rows));
    assert.ok(rows.some((r) => r.group === 'Companies' && r.title === 'Northwind d.o.o.'), 'company group lists the company');
    assert.ok(!rows.some((r) => r.title === 'Bluefin Labs'), 'other deals are not listed');
    await page.keyboard.press('Enter');
    await page.waitForFunction((id) => location.pathname === '/deals/' + id, {}, northwindId);
    await page.waitForSelector('[data-testid=mark-lost]');
  });

  step('finds a contact by part of the name (without accents) and opens it with the arrow keys', async () => {
    await waitForToastToClear(page);
    const rows = await search(page, 'markov');
    const target = rows.findIndex((r) => r.group === 'Contacts' && r.title === 'Ana Marković');
    assert.ok(target >= 0, 'contact listed: ' + JSON.stringify(rows));
    assert.ok(!rows.some((r) => r.title === 'Petar Petrović'), 'other contacts are not listed');
    // Contacts are found by email too.
    const byEmail = await search(page, 'petar@blue');
    assert.ok(byEmail.some((r) => r.group === 'Contacts' && r.title === 'Petar Petrović'), 'found by email: ' + JSON.stringify(byEmail));
    await search(page, 'markov');
    for (let i = 0; i < target; i++) await page.keyboard.press('ArrowDown');
    assert.equal((await results(page))[target].selected, true, 'the arrow keys move the selection');
    await page.keyboard.press('Enter');
    // The route changes in a transition: wait for the contact screen itself.
    await page.waitForFunction(() => location.pathname.startsWith('/contacts/'));
    await page.waitForFunction(() => document.querySelector('[data-testid=record-name]')?.value === 'Ana Marković');
    // The header names the screen, not the record.
    assert.equal(await page.$eval('header h1', (el) => el.textContent), 'Contact');
    // A clean contact id in the address, no "%3Ap" (CD-224); an old person-id link redirects to it.
    const clean = await page.evaluate(() => location.pathname);
    assert.match(clean, /^\/contacts\/[0-9a-f-]{36}$/);
    // Ana is the primary contact of the Northwind deal: her old person id is "<deal id>:p".
    await page.goto(`${BASE_URL}/contacts/${encodeURIComponent(northwindId + ':p')}`, { waitUntil: 'networkidle0' });
    await page.waitForFunction((p) => location.pathname === p, {}, clean);
  });

  step('says so when nothing matches, and Escape closes the palette', async () => {
    await click(page, '[data-testid=global-search]');
    await page.type('[data-testid=palette-input]', 'zzqx-nothing');
    await page.waitForFunction(() => document.querySelector('[data-testid=search-results]')?.textContent.includes('Nothing matches'));
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('[data-testid=palette]'));
  });

  step('runs an action from the palette: "product" → Create product', async () => {
    const rows = await search(page, 'product');
    assert.equal(rows[0].title, 'Create product', JSON.stringify(rows));
    await page.keyboard.press('Enter');
    await page.waitForSelector('::-p-text(New product or service)');
    await clickButton(page, 'Cancel');
    await page.waitForFunction(() => !document.querySelector('.modal'));
  });

  step('"Go to" reaches pages of other modules: Org structure (Workforce) and Reports', async () => {
    const rows = await search(page, 'org structure');
    assert.equal(rows[0].title, 'Org structure', JSON.stringify(rows));
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => location.pathname === '/org');
    await page.waitForFunction(() => document.querySelector('[data-testid=module-switcher]')?.getAttribute('data-current-module') === 'workforce');
    const reports = await search(page, 'reports');
    assert.equal(reports[0].title, 'Reports', JSON.stringify(reports));
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => location.pathname.startsWith('/reports/'));
    await page.waitForFunction(() => document.querySelector('[data-testid=module-switcher]')?.getAttribute('data-current-module') === 'crm');
  });

  step('the + menu runs an item by its letter', async () => {
    await click(page, '[data-testid=new-menu]');
    await page.waitForSelector('[data-testid=new-task]');
    await page.keyboard.press('t');
    await page.waitForSelector('input[placeholder="e.g. Send revised scope to procurement"]');
    await clickButton(page, 'Cancel');
    await page.waitForFunction(() => !document.querySelector('.modal'));
  });

  step('"Employee" in the + menu opens Add employee on the Org structure page (CD-224)', async () => {
    await click(page, '[data-testid=new-menu]');
    await click(page, '[data-testid=new-employee]');
    await page.waitForFunction(() => location.pathname === '/org');
    await page.waitForSelector('::-p-text(Department, manager, personal details)');
    assert.ok(!new URL(page.url()).searchParams.has('new'), 'the one-off parameter is gone');
    await clickButton(page, 'Cancel');
    await page.waitForFunction(() => !document.querySelector('.modal'));
    // No departments yet: the chart and the Department filter offer to add one.
    await page.waitForSelector('[data-testid=org-no-departments]');
    await click(page, '[data-testid=org-filter-department]');
    await click(page, '[data-testid=org-filter-add-department]');
    await page.waitForSelector('[data-testid=departments-list]');
    // It opens with the new department's form, not the "Add department" button.
    await page.waitForSelector('.modal input');
    assert.equal(await page.$('.dtp-add-dept'), null);
    await clickButton(page, 'Close');
    await page.waitForFunction(() => !document.querySelector('.modal'));
  });

  step('the account menu opens personal preferences; the bell lists your tasks due', async () => {
    await click(page, '[data-testid=notifications]');
    await page.waitForSelector('[data-testid=notifications-pop]');
    assert.match(await page.$eval('[data-testid=notifications-pop]', (el) => el.innerText), /Nothing overdue or due today|Overdue|Today/);
    await click(page, '[data-testid=account-menu]');
    // Team is a tab of the workspace settings, not in the account menu (CD-223).
    const items = await page.$$eval('.header-right .menu-pop [role=menuitem]', (els) => els.map((el) => el.textContent.trim()));
    assert.deepEqual(items, ['Personal preferences', 'Workspace settings', 'Sign out']);
    await clickButton(page, 'Personal preferences');
    await page.waitForFunction(() => location.pathname === '/profile');
  });

  step('opens the New deal dialog from the Contacts screen', async () => {
    await page.goto(BASE_URL + '/contacts', { waitUntil: 'networkidle0' });
    await click(page, '[data-testid=new-menu]');
    await click(page, '[data-testid=new-deal]');
    await page.waitForSelector('::-p-text(Create & start funnel)');
    assert.equal(new URL(page.url()).pathname, '/contacts', 'still on Contacts');
    await setValue(page, '.modal select', '+ New company…');
    await page.waitForSelector('input[placeholder="Company name"]');
    await page.type('input[placeholder="Company name"]', 'Menu Made d.o.o.');
    await page.type('input[placeholder="Full name"]', 'Mira Menić');
    await clickButton(page, 'Create & start funnel');
    await page.waitForFunction(() => location.pathname.startsWith('/deals/'));
    const dealId = page.url().split('/deals/')[1];
    assert.equal((await api(page, '/crm/deals/' + dealId)).title, 'Menu Made d.o.o.');
  });

  it('throws no uncaught errors in the page', () => {
    assert.deepEqual(browser.errors, []);
  });
});
