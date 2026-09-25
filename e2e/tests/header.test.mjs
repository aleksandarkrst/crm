// The header and sidebar tools: global search with Ctrl+K and keyboard navigation (CD-63), the
// "New" menu on any screen (CD-66) and the workspace switcher in the sidebar (CD-23).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { api, BASE_URL, click, clickButton, createDealInUi, newUserWithWorkspace, RUN, setValue, steps, text, useBrowser, waitForToastToClear } from '../lib/harness.mjs';

/** The search results as { group, title, selected } rows, in screen order. */
const results = (page) =>
  page.$$eval('[data-testid=search-results] [role=option]', (els) =>
    els.map((el) => ({
      group: el.closest('[data-group]')?.getAttribute('data-group'),
      title: el.querySelector('.search-item-title')?.textContent,
      selected: el.getAttribute('aria-selected') === 'true',
    })),
  );

async function search(page, query) {
  await page.$eval('[data-testid=global-search]', (el) => {
    el.focus();
    el.select();
  });
  await page.keyboard.press('Backspace');
  await page.type('[data-testid=global-search]', query);
  await page.waitForSelector('[data-testid=search-results] [role=option]');
  return results(page);
}

describe('header search, New menu and workspace switcher', () => {
  const browser = useBrowser();
  const step = steps(browser, 'header');
  const firstWorkspace = `Header Studio ${RUN}`;
  const secondWorkspace = `Second Studio ${RUN}`;
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

  step('Ctrl+K focuses the search box from any screen', async () => {
    await page.goto(BASE_URL + '/products', { waitUntil: 'networkidle0' });
    await page.click('h1');
    await page.keyboard.down('Control');
    await page.keyboard.press('k');
    await page.keyboard.up('Control');
    const focused = await page.evaluate(() => document.activeElement?.getAttribute('data-testid'));
    assert.equal(focused, 'global-search');
  });

  step('finds a deal by part of its name and opens it with Enter', async () => {
    await page.type('[data-testid=global-search]', 'northw');
    await page.waitForSelector('[data-testid=search-results] [role=option]');
    const rows = await results(page);
    assert.deepEqual(rows[0], { group: 'deal', title: 'Northwind d.o.o.', selected: true }, JSON.stringify(rows));
    assert.ok(rows.some((r) => r.group === 'company' && r.title === 'Northwind d.o.o.'), 'company group lists the company');
    assert.ok(!rows.some((r) => r.title === 'Bluefin Labs'), 'other deals are not listed');
    await page.keyboard.press('Enter');
    await page.waitForFunction((id) => location.pathname === '/deals/' + id, {}, northwindId);
    await page.waitForSelector('[data-testid=mark-lost]');
  });

  step('finds a contact by part of the name (without accents) and opens it with the arrow keys', async () => {
    await waitForToastToClear(page);
    const rows = await search(page, 'markov');
    const target = rows.findIndex((r) => r.group === 'contact' && r.title === 'Ana Marković');
    assert.ok(target >= 0, 'contact listed: ' + JSON.stringify(rows));
    assert.ok(!rows.some((r) => r.title === 'Petar Petrović'), 'other contacts are not listed');
    // Contacts are found by email too.
    const byEmail = await search(page, 'petar@blue');
    assert.ok(byEmail.some((r) => r.group === 'contact' && r.title === 'Petar Petrović'), 'found by email: ' + JSON.stringify(byEmail));
    await search(page, 'markov');
    for (let i = 0; i < target; i++) await page.keyboard.press('ArrowDown');
    assert.equal((await results(page))[target].selected, true, 'the arrow keys move the selection');
    await page.keyboard.press('Enter');
    // The route changes in a transition: wait for the contact screen itself.
    await page.waitForFunction(() => location.pathname.startsWith('/contacts/'));
    await page.waitForSelector('button::-p-text(Delete contact)');
    assert.match(await page.$eval('header', (el) => el.querySelector('input.ghost')?.value ?? el.textContent), /Ana Marković/);
  });

  step('says so when nothing matches, and Escape closes the results', async () => {
    await page.type('[data-testid=global-search]', 'zzqx-nothing');
    await page.waitForFunction(() => document.querySelector('[data-testid=search-results]')?.textContent.includes('No deals, companies or contacts match'));
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('[data-testid=search-results]'));
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

  step('the sidebar switcher lists the workspace and creates a second one', async () => {
    await waitForToastToClear(page);
    await click(page, '[data-testid=workspace-switcher]');
    await page.waitForSelector('[data-testid=workspace-menu]');
    const items = await page.$$eval('[data-testid=workspace-menu] [role=menuitemradio]', (els) => els.map((el) => ({ name: el.querySelector('.ws-name').textContent, current: el.getAttribute('aria-checked') === 'true' })));
    assert.deepEqual(items, [{ name: firstWorkspace, current: true }]);
    await clickButton(page, '+ New workspace');
    await page.type('input[placeholder="Workspace name"]', secondWorkspace);
    await clickButton(page, 'Create workspace');
    await page.waitForFunction((name) => document.querySelector('[data-testid=workspace-switcher]')?.title.includes(name), {}, secondWorkspace);
    const me = await api(page, '/me');
    assert.equal(me.tenants.length, 2);
    await page.goto(BASE_URL + '/pipeline', { waitUntil: 'networkidle0' });
    assert.ok(!(await text(page)).includes('Northwind'), 'the new workspace is empty');
  });

  step('switches back to the first workspace from the sidebar', async () => {
    await click(page, '[data-testid=workspace-switcher]');
    const items = await page.$$eval('[data-testid=workspace-menu] [role=menuitemradio]', (els) => els.map((el) => ({ name: el.querySelector('.ws-name').textContent, current: el.getAttribute('aria-checked') === 'true' })));
    assert.deepEqual(
      items.sort((a, b) => a.name.localeCompare(b.name)),
      [
        { name: firstWorkspace, current: false },
        { name: secondWorkspace, current: true },
      ].sort((a, b) => a.name.localeCompare(b.name)),
    );
    await click(page, `[data-testid=workspace-menu] [role=menuitemradio]::-p-text(${firstWorkspace})`);
    await page.waitForFunction((name) => document.querySelector('[data-testid=workspace-switcher]')?.title.includes(name), {}, firstWorkspace);
    await page.goto(BASE_URL + '/pipeline', { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.body.innerText.includes('Northwind d.o.o.'));
  });

  it('throws no uncaught errors in the page', () => {
    assert.deepEqual(browser.errors, []);
  });
});
