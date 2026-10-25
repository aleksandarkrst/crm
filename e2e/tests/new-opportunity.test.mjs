// New opportunity (CD-360): only an opportunity or a client enters the Pipeline. A lead picked in the
// dialog's searchable company list (or the dialog opened from its contact's page) says what is missing and
// can't be submitted; once the company is complete it can, with the sale type, which then shows in the Summary.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { api, BASE_URL, click, createNew, eventually, newUserWithWorkspace, pickDealCompany, READY_IDENTITY, setValue, steps, testPib, useBrowser } from '../lib/harness.mjs';

describe('new opportunity', () => {
  const browser = useBrowser();
  const step = steps(browser, 'new-opportunity');
  let page;
  let companyId;
  let contactId;

  step('sets up a lead: complete but for its matični broj', async () => {
    page = await browser.person('nora');
    await newUserWithWorkspace(page, { label: 'new-opportunity', name: 'Nora New', workspace: 'Entry Co' });
    const me = (await api(page, '/profile')).userId;
    const { mb: _mb, ...rest } = READY_IDENTITY;
    companyId = (await api(page, '/crm/companies', { method: 'POST', body: JSON.stringify({ name: 'Vega Logistika', pib: testPib(), ...rest }) })).id;
    contactId = (await api(page, '/crm/contacts', { method: 'POST', body: JSON.stringify({ companyId, fullName: 'Nikola Ilić', jobTitle: 'CEO', buyerRole: 'Decision maker', ownerUserId: me }) })).id;
    assert.equal((await api(page, `/crm/companies/${companyId}`)).status, 'lead');
  });

  step('picked from the searchable company list, a lead shows what it misses and cannot be submitted', async () => {
    await page.goto(`${BASE_URL}/pipeline`, { waitUntil: 'networkidle0' });
    await createNew(page, 'deal');
    await pickDealCompany(page, companyId, 'vega');
    const notice = await page.$eval('[data-testid=new-deal-lead]', (el) => el.innerText);
    assert.match(notice, /Vega Logistika is still a lead/);
    assert.equal(await page.$eval('[data-testid=new-deal-create]', (el) => el.disabled), true);
    await click(page, 'button::-p-text(Cancel)');
  });

  step('opened for the lead, the dialog says what is missing and cannot be submitted', async () => {
    await page.goto(`${BASE_URL}/contacts/${contactId}`, { waitUntil: 'networkidle0' });
    await click(page, '[data-testid=record-new-deal]');
    await page.waitForSelector('[data-testid=new-deal-lead]');
    const notice = await page.$eval('[data-testid=new-deal-lead]', (el) => el.innerText);
    assert.match(notice, /Vega Logistika is still a lead/);
    assert.match(notice, /Matični broj/);
    assert.equal(await page.$eval('[data-testid=new-deal-create]', (el) => el.disabled), true);
  });

  step('Complete the company leads to its page; with the matični broj it becomes an opportunity', async () => {
    await click(page, '[data-testid=new-deal-complete-company]');
    await page.waitForFunction((id) => location.pathname === `/companies/${id}`, {}, companyId);
    assert.equal(await page.$eval('[data-testid=record-new-deal]', (el) => el.disabled), true, '+ Opportunity is off for a lead');
    await setValue(page, 'input[aria-label="Matični broj"]', READY_IDENTITY.mb);
    await page.$eval('input[aria-label="Matični broj"]', (el) => el.blur());
    assert.ok(await eventually(async () => (await api(page, `/crm/companies/${companyId}`)).status === 'opportunity'), 'the company is an opportunity');
    await page.waitForFunction(() => /^Opportunity/.test(document.querySelector('[data-testid=company-status]')?.innerText ?? ''));
  });

  step('creates the opportunity with its sale type, which the Summary shows', async () => {
    await page.waitForFunction(() => document.querySelector('[data-testid=record-new-deal]')?.disabled === false);
    await click(page, '[data-testid=record-new-deal]');
    await page.waitForSelector('[data-testid=new-deal-create]');
    assert.equal(await page.$eval('[data-testid=new-deal-company]', (el) => el.value), companyId);
    // The sale type is required.
    await click(page, '[data-testid=new-deal-create]');
    await page.waitForFunction(() => document.body.innerText.includes('Pick the sale type.'));
    await click(page, '[data-testid=new-deal-sale-transactional]');
    await click(page, '[data-testid=new-deal-create]');
    await page.waitForFunction(() => location.pathname.startsWith('/deals/'));
    const dealId = page.url().split('/deals/')[1];
    assert.equal((await api(page, `/crm/deals/${dealId}`)).saleType, 'transactional');
    assert.equal(await page.$eval('select[aria-label="Sale type"]', (el) => el.value), 'transactional');
  });

  step("fills in a lead's missing MB and job title right in the dialog, then creates the opportunity", async () => {
    const me = (await api(page, '/profile')).userId;
    const { mb: _mb, ...rest } = READY_IDENTITY;
    const id = (await api(page, '/crm/companies', { method: 'POST', body: JSON.stringify({ name: 'Orion Tech', pib: testPib(), ...rest }) })).id;
    const person = (await api(page, '/crm/contacts', { method: 'POST', body: JSON.stringify({ companyId: id, fullName: 'Ana Petrović', buyerRole: 'Decision maker', ownerUserId: me }) })).id;
    await page.goto(`${BASE_URL}/contacts/${person}`, { waitUntil: 'networkidle0' });
    await click(page, '[data-testid=record-new-deal]');
    await page.waitForSelector('[data-testid=new-deal-complete-form]');
    assert.equal(await page.$eval('[data-testid=new-deal-create]', (el) => el.disabled), true);
    await setValue(page, '[data-testid=new-deal-complete-form] input[aria-label="Matični broj"]', READY_IDENTITY.mb);
    await setValue(page, '[data-testid=new-deal-complete-form] input[aria-label="Job title"]', 'CEO');
    await click(page, '[data-testid=new-deal-complete-save]');
    // Complete now: an opportunity, so the warning goes and Create works.
    await page.waitForFunction(() => !document.querySelector('[data-testid=new-deal-lead]'));
    assert.equal((await api(page, `/crm/companies/${id}`)).status, 'opportunity');
    assert.equal(await page.$eval('[data-testid=new-deal-create]', (el) => el.disabled), false);
    await click(page, '[data-testid=new-deal-sale-capital]');
    await click(page, '[data-testid=new-deal-create]');
    await page.waitForFunction(() => location.pathname.startsWith('/deals/'));
    const dealId = page.url().split('/deals/')[1];
    assert.equal((await api(page, `/crm/deals/${dealId}`)).companyId, id);
  });

  it('throws no uncaught errors in the page', () => {
    assert.deepEqual(browser.errors, []);
  });
});
