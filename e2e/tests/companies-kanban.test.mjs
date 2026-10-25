// Companies Kanban (CD-359): a column per status, the readiness line on a lead's card, the Kanban /
// Table toggle remembered, a card dropped to the left sets the status back by hand (the Activity
// says so), and one dropped to the right opens the company with what is missing.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { api, BASE_URL, click, eventually, newUserWithWorkspace, steps, testPib, useBrowser } from '../lib/harness.mjs';

/** Drops a company's card on a status column with the board's own drag events. */
function dragCard(page, companyId, status) {
  return page.evaluate(
    (id, st) => {
      const card = document.querySelector(`[data-testid=company-card][data-company="${id}"]`);
      const col = document.querySelector(`[data-testid=companies-col-${st}]`);
      if (!card || !col) return `card found: ${!!card}, column found: ${!!col}`;
      const dt = new DataTransfer();
      card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
      col.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
      col.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
      card.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
      return 'ok';
    },
    companyId,
    status,
  );
}

const cardText = (page, id) => page.$eval(`[data-testid=company-card][data-company="${id}"]`, (el) => el.innerText);
const columnOf = (page, id) => page.$eval(`[data-testid=company-card][data-company="${id}"]`, (el) => el.closest('[data-testid^=companies-col-]').dataset.testid.replace('companies-col-', ''));

describe('companies kanban', () => {
  const browser = useBrowser();
  const step = steps(browser, 'companies-kanban');
  let page;
  let leadId;
  let readyId;

  step('sets up a lead (PIB only) and a complete company', async () => {
    page = await browser.person('kana');
    await newUserWithWorkspace(page, { label: 'companies-kanban', name: 'Kana Kanban', workspace: 'Kanban Co' });
    const me = (await api(page, '/profile')).userId;
    leadId = (await api(page, '/crm/companies', { method: 'POST', body: JSON.stringify({ name: 'Vega Logistika', pib: testPib() }) })).id;
    readyId = (await api(page, '/crm/companies', { method: 'POST', body: JSON.stringify({ name: 'Brightline Studio', pib: testPib(), mb: '20084693', activityCode: '4941', address: 'Bulevar 10', city: 'Novi Sad', postalCode: '21000' }) })).id;
    await api(page, '/crm/contacts', { method: 'POST', body: JSON.stringify({ companyId: readyId, fullName: 'Nikola Ilić', jobTitle: 'CEO', buyerRole: 'Decision maker', ownerUserId: me }) });
    assert.ok(await eventually(async () => (await api(page, `/crm/companies/${readyId}`)).status === 'opportunity'), 'the complete company is an opportunity');
  });

  step('Companies is second in the sidebar; the Kanban puts each company in its status column', async () => {
    await page.goto(BASE_URL + '/companies', { waitUntil: 'networkidle0' });
    const nav = await page.$$eval('.app-sidebar nav .nav-item .nav-label', (els) => els.map((el) => el.textContent));
    assert.deepEqual(nav.slice(0, 2), ['Overview', 'Companies']);
    await page.waitForSelector('[data-testid=companies-board]');
    assert.equal(await columnOf(page, leadId), 'lead');
    assert.equal(await columnOf(page, readyId), 'opportunity');
  });

  step("a lead's card shows its readiness and what is missing", async () => {
    const lead = await cardText(page, leadId);
    assert.match(lead, /Ready for Opportunity\s+1 of 7/);
    assert.match(lead, /Missing: MB, address, activity code, a contact/);
  });

  step('the Table toggle is remembered', async () => {
    await click(page, '[data-testid=companies-view-table]');
    await page.waitForSelector('[data-testid=company-row-status]');
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-testid=company-row-status]');
    assert.equal(await page.$('[data-testid=companies-board]'), null);
    await click(page, '[data-testid=companies-view-board]');
    await page.waitForSelector('[data-testid=companies-board]');
  });

  step('dropped to the left, the status is set back by hand and the Activity says so', async () => {
    assert.equal(await dragCard(page, readyId, 'lead'), 'ok');
    assert.ok(await eventually(async () => (await api(page, `/crm/companies/${readyId}`)).statusSetManually), 'set back by hand');
    assert.equal((await api(page, `/crm/companies/${readyId}`)).status, 'lead');
    await page.waitForFunction((id) => document.querySelector(`[data-testid=company-card][data-company="${id}"]`)?.closest('[data-testid=companies-col-lead]'), {}, readyId);
    const history = await api(page, `/crm/companies/${readyId}/status-history`);
    assert.equal(history[0].reason, 'manual');
  });

  step('dropped to the right, the company opens with what is missing', async () => {
    assert.equal(await dragCard(page, leadId, 'opportunity'), 'ok');
    await page.waitForFunction((id) => location.pathname === `/companies/${id}`, {}, leadId);
    await page.waitForSelector('[data-testid=company-blockers]');
    await page.waitForFunction(() => document.body.innerText.includes('becomes an Opportunity by itself once these are filled in'));
    assert.equal((await api(page, `/crm/companies/${leadId}`)).status, 'lead');
  });

  it('throws no uncaught errors in the page', () => {
    assert.deepEqual(browser.errors, []);
  });
});
