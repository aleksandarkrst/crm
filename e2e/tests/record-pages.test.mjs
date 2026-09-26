// CD-80: company and contact pages like the deal page: the header names the screen, the record
// has its own header with owner, "+ Deal" (starting from this company or contact) and Delete in
// the menu, and sections for its details, deals, contacts, tasks and history.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { api, BASE_URL, click, clickButton, eventually, newUserWithWorkspace, setByLabel, steps, text, useBrowser } from '../lib/harness.mjs';

describe('company and contact pages', () => {
  const browser = useBrowser();
  const step = steps(browser, 'record-pages');
  let page;
  let company;
  let contact;
  let empty;
  let unowned;

  step('sets up a company with a contact and a deal, and an empty company', async () => {
    page = await browser.person('rhea');
    await newUserWithWorkspace(page, { label: 'records', name: 'Rhea Records', workspace: 'Records Co' });
    const funnels = await api(page, '/crm/funnels');
    company = await api(page, '/crm/companies', { method: 'POST', body: JSON.stringify({ name: 'Umbrella d.o.o.', industry: 'Pharmaceuticals', hq: 'Niš' }) });
    contact = await api(page, '/crm/contacts', { method: 'POST', body: JSON.stringify({ fullName: 'Alice Abernathy', companyId: company.id, email: 'alice@umbrella.test', jobTitle: 'COO' }) });
    await api(page, '/crm/deals', { method: 'POST', body: JSON.stringify({ title: 'Umbrella rollout', funnelId: funnels[0].id, companyId: company.id, primaryContactId: contact.id }) });
    empty = await api(page, '/crm/companies', { method: 'POST', body: JSON.stringify({ name: 'Empty Shell d.o.o.' }) });
    unowned = await api(page, '/crm/companies', { method: 'POST', body: JSON.stringify({ name: 'Nobody Owns d.o.o.', ownerUserId: null }) });
    await api(page, '/crm/deals', { method: 'POST', body: JSON.stringify({ title: 'Unowned company deal', funnelId: funnels[0].id, companyId: unowned.id }) });
    await page.reload({ waitUntil: 'networkidle0' });
  });

  step('the company page: screen name in the header, the record below, its deals and contacts', async () => {
    await page.goto(`${BASE_URL}/companies/${company.id}`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.querySelector('[data-testid=record-name]')?.value === 'Umbrella d.o.o.');
    assert.equal(await page.$eval('header h1', (el) => el.textContent), 'Company');
    assert.match(await page.$eval('[data-testid=record-deals]', (el) => el.innerText), /Open deals \(1\)[\s\S]*Umbrella rollout/);
    assert.match(await page.$eval('[data-testid=company-contacts]', (el) => el.innerText), /Alice Abernathy/);
    assert.ok(!(await text(page)).includes('Delete company'), 'Delete is in the menu');
    assert.ok(await setByLabel(page, 'HQ', 'Beograd'), 'HQ field found');
    assert.ok(await eventually(async () => (await api(page, '/crm/companies/' + company.id)).hq === 'Beograd'), 'HQ saved');
  });

  step('"+ Deal" starts the New deal dialog with this company', async () => {
    await click(page, '[data-testid=record-new-deal]');
    await page.waitForSelector('::-p-text(Create & start funnel)');
    const picked = await page.$eval('.modal select', (el) => el.value);
    assert.equal(picked, company.id);
    await clickButton(page, 'Cancel');
    await page.waitForFunction(() => !document.querySelector('.modal'));
  });

  step('the contact page: header, summary, company and deals', async () => {
    await page.goto(`${BASE_URL}/contacts/${contact.id}`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.querySelector('[data-testid=record-name]')?.value === 'Alice Abernathy');
    assert.equal(await page.$eval('header h1', (el) => el.textContent), 'Contact');
    assert.match(await page.$eval('[data-testid=contact-company]', (el) => el.innerText), /Umbrella d\.o\.o\./);
    assert.match(await page.$eval('[data-testid=record-deals]', (el) => el.innerText), /Umbrella rollout/);
    assert.ok(await setByLabel(page, 'Role', 'Chief Operating Officer'), 'Role field found');
    assert.ok(await eventually(async () => (await api(page, '/crm/contacts/' + contact.id)).jobTitle === 'Chief Operating Officer'), 'role saved');
  });

  step('a company without an owner shows "No owner", not the owner of its deal', async () => {
    await page.goto(`${BASE_URL}/companies/${unowned.id}`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.querySelector('[data-testid=record-name]')?.value === 'Nobody Owns d.o.o.');
    assert.equal(await page.$eval('select[aria-label="Owner"]', (el) => el.value), '');
    assert.equal(await page.$eval('select[aria-label="Owner"]', (el) => el.selectedOptions[0].textContent), 'No owner');
  });

  step('"Add a contact" on a company without deals adds the contact to that company', async () => {
    await page.goto(`${BASE_URL}/companies/${empty.id}`, { waitUntil: 'networkidle0' });
    await click(page, 'button[aria-label="Add a contact"]');
    await page.waitForSelector('.modal input[placeholder="e.g. Ana Marković"]');
    assert.equal(await page.$eval('.modal input[readonly]', (el) => el.value), 'Empty Shell d.o.o.');
    await page.type('.modal input[placeholder="e.g. Ana Marković"]', 'Nora Newhire');
    await clickButton(page, 'Add contact');
    await page.waitForFunction(() => !document.querySelector('.modal'));
    const added = await eventually(async () => (await api(page, '/crm/contacts')).find((c) => c.fullName === 'Nora Newhire'));
    assert.equal(added?.companyId, empty.id);
    await page.waitForFunction(() => document.querySelector('[data-testid=company-contacts]')?.innerText.includes('Nora Newhire'));
  });

  step('the owner deletes an empty company from the menu', async () => {
    await page.goto(`${BASE_URL}/companies/${empty.id}`, { waitUntil: 'networkidle0' });
    await click(page, 'button[aria-label="More actions"]');
    await clickButton(page, 'Delete company');
    await page.waitForFunction(() => location.pathname === '/companies');
    assert.ok(await eventually(async () => !(await api(page, '/crm/companies')).some((c) => c.id === empty.id)), 'company deleted');
  });

  it('throws no uncaught errors in the page', () => {
    assert.deepEqual(browser.errors, []);
  });
});
