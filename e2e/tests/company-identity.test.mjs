// Company identity (CD-357, CD-533): New company is a glass dialog. The name, PIB, Matični broj and
// Šifra delatnosti are required (the IDs checked as they are typed); industry, ownership and a contact
// (one already in the workspace, or a new one by name) are optional. It creates a lead and opens it.
// A PIB the workspace already has names that company with a link to it, and the list shows the lead
// with its readiness.
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { api, BASE_URL, click, newUserWithWorkspace, steps, testPib, useBrowser } from '../lib/harness.mjs';

describe('company identity', () => {
  const browser = useBrowser();
  const step = steps(browser, 'company identity');
  let page;
  const pib = testPib();
  const otherPib = testPib();
  const alerts = () => page.$$eval('[data-testid=new-company-dialog] [role=alert]', (els) => els.map((el) => el.textContent).join(' | '));
  const pick = async (testId, label) => {
    await click(page, `[data-testid=${testId}]`);
    await page.waitForSelector('[role=listbox] [role=option]');
    await page.$$eval('[role=listbox] [role=option]', (els, label) => els.find((el) => el.textContent.trim() === label).click(), label);
  };

  step('sets up a workspace', async () => {
    page = await browser.person('ida');
    await newUserWithWorkspace(page, { label: 'company-identity', name: 'Ida Identity', workspace: 'Identity Co' });
  });

  step('the empty list offers the first company', async () => {
    await page.goto(BASE_URL + '/companies', { waitUntil: 'networkidle0' });
    assert.match(await page.$eval('[data-testid=companies-empty]', (el) => el.innerText), /No companies yet\. Add the first one\./);
  });

  step('New company needs the name, PIB, MB and activity code, then creates a lead with a new contact', async () => {
    await click(page, '[data-testid=companies-new]');
    await page.waitForSelector('[data-testid=new-company-dialog]');
    assert.match(await page.$eval('[data-testid=new-company-dialog]', (el) => el.innerText), /all seven checks are done: name, PIB, MB, address, activity code, owner and a contact with a role in the decision/);
    assert.ok(await page.$eval('[data-testid=new-company-create]', (el) => el.disabled), 'Create company waits for a name');
    await page.type('[data-testid=new-company-name]', 'Vega Logistika d.o.o.');
    await page.type('[data-testid=new-company-pib]', '10405213');
    await click(page, '[data-testid=new-company-create]');
    const first = await alerts();
    assert.match(first, /9 digits; this one has 8/);
    assert.match(first, /The Matični broj is required/);
    assert.match(first, /The Šifra delatnosti is required/);
    await page.$eval('[data-testid=new-company-pib]', (el) => el.select());
    await page.type('[data-testid=new-company-pib]', pib);
    await page.type('[data-testid=new-company-mb]', '20000007');
    await page.type('[data-testid=new-company-activity-code]', '4941');
    await pick('new-company-ownership', 'Private');
    await pick('new-company-contact', '+ New contact');
    await page.type('[data-testid=new-company-contact-name]', 'Marko Petrović');
    await click(page, '[data-testid=new-company-create]');
    await page.waitForFunction(() => /^\/companies\/[0-9a-f-]+$/.test(location.pathname));
    await page.waitForFunction(() => /Vega Logistika d\.o\.o\. created as a lead/.test(document.querySelector('.toast')?.textContent ?? ''));
    await page.waitForSelector('[data-testid=company-identity]');
    assert.equal(await page.$eval('[data-testid=company-identity] input[aria-label="Company ID (PIB)"]', (el) => el.value), pib);
    const made = (await api(page, '/crm/companies')).find((c) => c.name === 'Vega Logistika d.o.o.');
    assert.deepEqual([made.mb, made.activityCode, made.ownershipType], ['20000007', '4941', 'private']);
    const contacts = await api(page, '/crm/contacts');
    assert.deepEqual(contacts.map((c) => [c.fullName, c.companyId]), [['Marko Petrović', made.id]]);
  });

  step('the list shows the lead with its readiness and what it misses', async () => {
    await page.goto(BASE_URL + '/companies', { waitUntil: 'networkidle0' });
    const row = await page.$eval('[data-testid=company-row]', (el) => el.innerText);
    // Name, PIB, MB, activity code and owner are in: 5 of 7. No address, and the contact has no role yet.
    assert.match(row, /Vega Logistika d\.o\.o\.[\s\S]*Lead\s+5 of 7 ready[\s\S]*Ida Identity/);
    assert.match(row, /No activity yet\s+Incomplete record, no address or contact/);
  });

  step('the same PIB again names the existing company and opens it', async () => {
    await click(page, '[data-testid=companies-new]');
    await page.type('[data-testid=new-company-name]', 'Vega Copy');
    await page.type('[data-testid=new-company-pib]', pib);
    await page.waitForSelector('[data-testid=new-company-pib-taken]');
    assert.match(await page.$eval('[data-testid=new-company-pib-taken]', (el) => el.textContent), /This PIB belongs to Vega Logistika d\.o\.o\.\s*Open it/);
    await click(page, '[data-testid=new-company-pib-taken] button');
    await page.waitForFunction(() => /^\/companies\/[0-9a-f-]+$/.test(location.pathname));
    assert.equal((await api(page, '/crm/companies')).length, 1, 'no second company');
  });

  step('an existing contact picked in the dialog moves to the new company', async () => {
    await page.goto(BASE_URL + '/companies', { waitUntil: 'networkidle0' });
    await click(page, '[data-testid=companies-new]');
    await page.type('[data-testid=new-company-name]', 'Brightline Studio');
    await page.type('[data-testid=new-company-pib]', otherPib);
    await page.type('[data-testid=new-company-mb]', '20010134');
    await page.type('[data-testid=new-company-activity-code]', '7410');
    await pick('new-company-contact', 'Marko Petrović, Vega Logistika d.o.o.');
    assert.match(await page.$eval('[data-testid=new-company-dialog]', (el) => el.innerText), /This contact moves from Vega Logistika d\.o\.o\. to the new company\./);
    await click(page, '[data-testid=new-company-create]');
    await page.waitForFunction(() => /Brightline Studio created as a lead/.test(document.querySelector('.toast')?.textContent ?? ''));
    const made = (await api(page, '/crm/companies')).find((c) => c.name === 'Brightline Studio');
    assert.equal((await api(page, '/crm/contacts')).find((c) => c.fullName === 'Marko Petrović').companyId, made.id);
  });
});
