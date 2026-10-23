// Contact dialog and contact page fixes (CD-464): the dialog lists companies (also those without deals),
// links no deal of its own accord, shows inline errors for an empty name and a bad phone or email, and
// the contact page checks the phone and moves the contact to a company that has no deals.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { api, BASE_URL, click, clickButton, createNew, eventually, newUserWithWorkspace, setValue, steps, testPib, useBrowser } from '../lib/harness.mjs';

describe('contact dialog and contact page', () => {
  const browser = useBrowser();
  const step = steps(browser, 'contact-dialog');
  let page;
  let tide;
  let kes;
  let contactId;

  step('sets up two companies without deals, and a deal at a third', async () => {
    page = await browser.person('contacts');
    await newUserWithWorkspace(page, { label: 'contacts', name: 'Cora Contacts', workspace: 'Contacts Co' });
    tide = await api(page, '/crm/companies', { method: 'POST', body: JSON.stringify({ pib: testPib(), name: 'Tide d.o.o.' }) });
    kes = await api(page, '/crm/companies', { method: 'POST', body: JSON.stringify({ pib: testPib(), name: 'TEST-Kes d.o.o.' }) });
    const other = await api(page, '/crm/companies', { method: 'POST', body: JSON.stringify({ pib: testPib(), name: 'Busy Deals d.o.o.' }) });
    const funnels = await api(page, '/crm/funnels');
    await api(page, '/crm/deals', { method: 'POST', body: JSON.stringify({ title: 'Busy deal', funnelId: funnels[0].id, companyId: other.id }) });
  });

  step('an empty form and a bad phone or email show inline errors, and nothing is saved', async () => {
    await page.goto(BASE_URL + '/contacts', { waitUntil: 'networkidle0' });
    await createNew(page, 'contact');
    await page.waitForSelector('.modal input[placeholder="e.g. Ana Marković"]');
    await clickButton(page, 'Add contact');
    await page.waitForSelector('.modal [data-testid=field-error]');
    assert.match(await page.$eval('.modal', (el) => el.innerText), /Enter the contact's full name/);

    await page.type('.modal input[placeholder="e.g. Ana Marković"]', 'Nina Tide');
    await page.type('.modal input[type=tel]', 'abc123!!');
    await page.type('.modal input[type=email]', 'nina@tide');
    await clickButton(page, 'Add contact');
    await page.waitForFunction(() => document.querySelectorAll('.modal [data-testid=field-error]').length === 2);
    const modal = await page.$eval('.modal', (el) => el.innerText);
    assert.match(modal, /Enter a phone number/);
    assert.match(modal, /Enter an email address/);
    assert.ok(!(await api(page, '/crm/contacts')).some((c) => c.fullName === 'Nina Tide'), 'nothing saved');
  });

  step('the dialog fits a phone screen without sideways scrolling', async () => {
    await page.setViewport({ width: 360, height: 780 });
    const overflow = await page.$eval('.modal', (el) => el.scrollWidth - el.clientWidth);
    assert.ok(overflow <= 1, `no sideways scroll (${overflow}px)`);
    await page.setViewport({ width: 1400, height: 1000 });
  });

  step('picks a company without deals and links no deal', async () => {
    await setValue(page, '.modal input[type=tel]', '+381 60 123 4567');
    await setValue(page, '.modal input[type=email]', 'nina@tide.example.com');
    const options = await page.$$eval('[data-testid=new-contact-company] option', (els) => els.map((el) => el.textContent));
    assert.ok(options.includes('Tide d.o.o.') && options.includes('TEST-Kes d.o.o.'), options.join(' | '));
    await page.select('[data-testid=new-contact-company]', tide.id);
    await clickButton(page, 'Add contact');
    await page.waitForFunction(() => !document.querySelector('.modal'));
    const saved = await eventually(async () => (await api(page, '/crm/contacts')).find((c) => c.fullName === 'Nina Tide'));
    assert.equal(saved.companyId, tide.id);
    assert.equal(saved.phone, '+381 60 123 4567');
    contactId = saved.id;
    const rows = await api(page, '/crm/deals');
    assert.ok(!rows.some((r) => r.deal.primaryContactId === contactId || r.contactIds.includes(contactId)), 'on no deal');
  });

  step('the new contact shows no other deal, touch or history', async () => {
    await page.goto(`${BASE_URL}/contacts/${contactId}`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-testid=contact-summary]');
    const body = await page.evaluate(() => document.body.innerText);
    assert.ok(!body.includes('Busy deal'), 'no deal of another company');
    assert.ok(!/Last touch \d+ day/.test(body), 'no last touch');
  });

  step('the contact page refuses a bad phone and keeps the saved one', async () => {
    await setValue(page, 'input[aria-label="Phone"]', 'abc123!!');
    await page.$eval('input[aria-label="Phone"]', (el) => el.blur());
    await page.waitForSelector('[data-testid=contact-summary] [data-testid=field-error]');
    assert.equal(await page.$('a[aria-label="Call Nina Tide"]'), null, 'no Call link for the draft');
    assert.equal((await api(page, '/crm/contacts')).find((c) => c.id === contactId).phone, '+381 60 123 4567');
  });

  step('the Company picker lists companies without deals and moves the contact there', async () => {
    await page.reload({ waitUntil: 'networkidle0' });
    await click(page, '[data-testid=contact-summary] .picker-search');
    await page.waitForSelector('.picker-item');
    const items = await page.$$eval('.picker-item', (els) => els.map((el) => el.innerText.trim()));
    assert.ok(items.some((t) => t.includes('TEST-Kes d.o.o.')), items.join(' | '));
    await page.evaluate(() => [...document.querySelectorAll('.picker-item')].find((el) => el.innerText.includes('TEST-Kes d.o.o.')).click());
    const moved = await eventually(async () => (await api(page, '/crm/contacts')).find((c) => c.id === contactId && c.companyId === kes.id));
    assert.ok(moved, 'moved to TEST-Kes');
    const rows = await api(page, '/crm/deals');
    assert.ok(!rows.some((r) => r.contactIds.includes(contactId)), 'still on no deal');
  });

  it('throws no uncaught errors in the page', () => {
    assert.deepEqual(browser.errors, []);
  });
});
