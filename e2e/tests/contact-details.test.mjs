// Contact details and personal details (CD-361): the New contact dialog asks for job title, role in
// the decision and owner; the contact page saves Org unit, Source, Influence and the Personal section;
// the company's contact list flags a contact with no role in the decision.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { api, BASE_URL, click, clickButton, eventually, newUserWithWorkspace, setValue, steps, testPib, useBrowser } from '../lib/harness.mjs';

describe('contact details and personal details', () => {
  const browser = useBrowser();
  const step = steps(browser, 'contact-details');
  let page;
  let company;
  let contactId;

  step('the New contact dialog asks for job title and role, with you as the owner', async () => {
    page = await browser.person('details');
    await newUserWithWorkspace(page, { label: 'details', name: 'Dora Details', workspace: 'Details Co' });
    company = await api(page, '/crm/companies', { method: 'POST', body: JSON.stringify({ pib: testPib(), name: 'Acme d.o.o.' }) });
    await page.goto(`${BASE_URL}/companies/${company.id}`, { waitUntil: 'networkidle0' });
    await click(page, 'button[aria-label="Add a contact"]');
    await page.waitForSelector('.modal input[placeholder="e.g. Ana Marković"]');
    assert.match(await page.$eval('[data-testid=new-contact-owner]', (el) => el.selectedOptions[0].textContent), /\(you\)$/);
    await page.type('.modal input[placeholder="e.g. Ana Marković"]', 'Rita Role');
    await clickButton(page, 'Add contact');
    await page.waitForFunction(() => /Enter their job title/.test(document.querySelector('.modal')?.innerText ?? ''));
    assert.match(await page.$eval('.modal', (el) => el.innerText), /Pick their role in the decision/);

    await page.type('.modal input[placeholder="e.g. Marketing Director"]', 'Head of purchasing');
    await page.evaluate(() => {
      const select = [...document.querySelectorAll('.modal select')].find((el) => [...el.options].some((o) => o.value === 'Champion'));
      select.value = 'Champion';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await clickButton(page, 'Add contact');
    await page.waitForFunction(() => !document.querySelector('.modal'));
    const saved = await eventually(async () => (await api(page, '/crm/contacts')).find((c) => c.fullName === 'Rita Role'));
    assert.equal(saved.jobTitle, 'Head of purchasing');
    assert.equal(saved.buyerRole, 'Champion');
    contactId = saved.id;
  });

  step('a contact with no role in the decision is flagged on the company', async () => {
    await api(page, '/crm/contacts', { method: 'POST', body: JSON.stringify({ fullName: 'Nino Norole', companyId: company.id }) });
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.querySelector('[data-testid=company-contacts]')?.innerText.includes('Nino Norole'));
    const flagged = await page.$$eval('[data-testid=company-contacts] button', (els) => els.filter((el) => el.querySelector('[data-testid=no-role-badge]')).map((el) => el.innerText));
    assert.equal(flagged.length, 1, flagged.join(' | '));
    assert.match(flagged[0], /Nino Norole/);
  });

  step('the contact page saves Details and Personal, and they survive a reload', async () => {
    await page.goto(`${BASE_URL}/contacts/${contactId}`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-testid=contact-personal]');
    await setValue(page, 'input[aria-label="Org unit"]', 'Procurement');
    await page.select('select[aria-label="Source"]', 'Referral');
    await setValue(page, 'textarea[aria-label="Influence on the opportunity"]', 'Signs off on budgets over 10k');
    await click(page, 'button[aria-label="Birthday"]');
    await setValue(page, 'input[aria-label="Birthday"]', '1985-04-12');
    await setValue(page, 'input[aria-label="Spouse"]', 'Marko');
    await setValue(page, 'input[aria-label="Children"]', 'Ana (7)');
    await setValue(page, 'input[aria-label="Pets"]', 'Dog Rex');
    const saved = await eventually(async () => {
      const c = (await api(page, '/crm/contacts')).find((x) => x.id === contactId);
      return c.orgUnit === 'Procurement' && c.source === 'Referral' && c.influence === 'Signs off on budgets over 10k' && c.birthday === '1985-04-12' && c.spouseName === 'Marko' && c.children === 'Ana (7)' && c.pets === 'Dog Rex' && c;
    });
    assert.ok(saved, 'details and personal details saved');
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-testid=contact-personal]');
    assert.equal(await page.$eval('input[aria-label="Spouse"]', (el) => el.value), 'Marko');
    assert.equal(await page.$eval('input[aria-label="Org unit"]', (el) => el.value), 'Procurement');
  });

  it('throws no uncaught errors in the page', () => {
    assert.deepEqual(browser.errors, []);
  });
});
