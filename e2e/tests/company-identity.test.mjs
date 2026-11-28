// Company identity (CD-357, CD-533): New company is a glass dialog. The name, PIB, Matični broj and
// Šifra delatnosti are required (the IDs checked as they are typed); industry, ownership and a contact
// (one already in the workspace, or a new one by name) are optional. It creates a lead and opens it.
// A PIB the workspace already has names that company with a link to it, and the list shows the lead
// with its readiness.
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { api, BASE_URL, click, newUserWithWorkspace, steps, testPib, text, useBrowser } from '../lib/harness.mjs';

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
    // The contact opens in a sheet over the dialog; Add takes it back to the dialog, picked.
    await page.waitForSelector('[data-testid=new-company-contact-sheet]');
    await page.type('[data-testid=new-contact-name]', 'Marko Petrović');
    await page.type('[data-testid=new-contact-job-title]', 'Fleet Manager');
    await pick('new-contact-buyer-role', 'Decision maker');
    await click(page, '[data-testid=new-contact-add]');
    await page.waitForFunction(() => !document.querySelector('[data-testid=new-company-contact-sheet]'));
    assert.equal(await page.$eval('[data-testid=new-company-contact]', (el) => el.textContent.trim()), 'Marko Petrović (new)');
    await click(page, '[data-testid=new-company-create]');
    await page.waitForFunction(() => /^\/companies\/[0-9a-f-]+$/.test(location.pathname));
    await page.waitForFunction(() => /Vega Logistika d\.o\.o\. created as a lead/.test(document.querySelector('.toast')?.textContent ?? ''));
    await page.waitForSelector('[data-testid=company-identity]');
    assert.equal(await page.$eval('[data-testid=company-identity] input[aria-label="PIB"]', (el) => el.value), pib);
    const made = (await api(page, '/crm/companies')).find((c) => c.name === 'Vega Logistika d.o.o.');
    assert.deepEqual([made.mb, made.activityCode, made.ownershipType], ['20000007', '4941', 'private']);
    const contacts = await api(page, '/crm/contacts');
    assert.deepEqual(contacts.map((c) => [c.fullName, c.jobTitle, c.buyerRole, c.companyId]), [['Marko Petrović', 'Fleet Manager', 'Decision maker', made.id]]);
  });

  step('the list shows the lead with its readiness and what it misses', async () => {
    await page.goto(BASE_URL + '/companies', { waitUntil: 'networkidle0' });
    const row = await page.$eval('[data-testid=company-row]', (el) => el.innerText);
    // Name, PIB, MB, activity code, owner and a contact with a role are in: 6 of 7. Only the address is missing.
    assert.match(row, /Vega Logistika d\.o\.o\.[\s\S]*Lead\s+6 of 7 ready[\s\S]*Ida Identity/);
    assert.match(row, /No activity yet\s+Incomplete record, no address/);
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

  /** The Companies list's rows by company name: the row's text and its cells (Company, Status, Owner, Open, Lifetime, Contacts, Last activity). */
  const listRows = async () => {
    await page.goto(BASE_URL + '/companies', { waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-testid=company-row]');
    const rows = await page.$$eval('[data-testid=company-row]', (els) => els.map((el) => ({ name: el.querySelector('.cl-co b')?.innerText.trim(), text: el.innerText, cells: [...el.querySelectorAll('td')].map((td) => td.innerText.trim()) })));
    return Object.fromEntries(rows.map((r) => [r.name, r]));
  };

  let vegaId;
  let vegaDealId;
  step('Vega becomes an opportunity with Marko as its primary contact', async () => {
    // The address completes the seven checks (CD-358); an opportunity names Marko as its primary contact (QA 4e's case).
    vegaId = (await api(page, '/crm/companies')).find((c) => c.name === 'Vega Logistika d.o.o.').id;
    const marko = (await api(page, '/crm/contacts')).find((c) => c.fullName === 'Marko Petrović');
    await api(page, `/crm/companies/${vegaId}`, { method: 'PATCH', body: JSON.stringify({ address: 'Bulevar 10', city: 'Novi Sad', postalCode: '21000' }) });
    assert.equal((await api(page, `/crm/companies/${vegaId}`)).status, 'opportunity');
    const funnels = await api(page, '/crm/funnels');
    vegaDealId = (await api(page, '/crm/deals', { method: 'POST', body: JSON.stringify({ title: 'Vega fleet licence', funnelId: funnels[0].id, companyId: vegaId, primaryContactId: marko.id }) })).id;
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
    // Vega's opportunity loses him as primary contact (CD-464's rule, the same as a move from the contact page).
    assert.equal((await api(page, `/crm/deals/${vegaDealId}`)).primaryContactId, null);
  });

  step('the moved contact counts for the new company in the app, not for the opportunity he was on (QA 4e)', async () => {
    // The company page he moved to: a lead missing only the address, with him under Contacts.
    await page.waitForFunction(() => /^\/companies\/[0-9a-f-]+$/.test(location.pathname));
    await page.waitForSelector('[data-testid=company-status]');
    // The Company page's header and tabs (CD-534): the status tag, the meta line, the banner and the Contacts tab.
    assert.equal(await page.$eval('[data-testid=company-status]', (el) => el.innerText), 'Lead, automatic');
    assert.match(await page.$eval('[data-testid=company-meta]', (el) => el.innerText), /^6 of 7 ready/);
    // Only the address is missing: the banner's tags show the contact check as done.
    assert.equal((await page.$eval('[data-testid=company-blockers]', (el) => el.innerText)).split('\n')[0], '6 of 7 ready. Missing: Address.');
    const checks = await page.$$eval('[data-testid=readiness-check]', (els) => els.map((el) => [el.textContent, el.dataset.done]));
    assert.deepEqual(checks.at(-1), ['A contact with a role in the decision', 'true']);
    await click(page, '[data-testid=tab-contacts]');
    assert.match(await page.$eval('[data-testid=company-contacts]', (el) => el.innerText), /Marko Petrović/);
    // The list: Brightline has the contact, Vega none; both are leads six of seven ready (Vega now has an address but no contact).
    const rows = await listRows();
    assert.equal(rows['Brightline Studio'].cells[5], '1');
    assert.match(rows['Brightline Studio'].text, /Lead\s+6 of 7 ready[\s\S]*Incomplete record, no address/);
    assert.equal(rows['Vega Logistika d.o.o.'].cells[5], '0');
    assert.match(rows['Vega Logistika d.o.o.'].text, /Lead\s+6 of 7 ready[\s\S]*Incomplete record, no contact/);
    // The Contacts list and his page show the new company.
    await page.goto(BASE_URL + '/contacts', { waitUntil: 'networkidle0' });
    await page.waitForSelector('.table-row.clickable');
    assert.match(await page.$eval('.table-row.clickable', (el) => el.innerText), /Marko Petrović[\s\S]*Brightline Studio/);
    await click(page, '.table-row.clickable');
    await page.waitForFunction(() => /^\/contacts\/[0-9a-f-]+$/.test(location.pathname));
    // The contact screen is a lazy chunk: wait for its Company row before reading the page.
    await page.waitForFunction(() => /Company\s+\S/.test(document.body.innerText));
    const contactPage = await text(page);
    // The Summary's first row is his company; the company card repeats it after its initials tile.
    assert.match(contactPage, /Summary\s+Brightline Studio/);
    assert.match(contactPage, /Company\s+(?:BS\s+)?Brightline Studio/);
    assert.doesNotMatch(contactPage, /Vega Logistika/);
  });
});
