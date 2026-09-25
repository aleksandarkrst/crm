// The main journey: sign in → workspace → product → new deal → edits → drag between stages →
// reload → every screen renders. Checks the UI and what reached the API.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  api,
  BASE_URL,
  clickButton,
  createDealInUi,
  email,
  eventually,
  setClosingDate,
  signIn,
  steps,
  text,
  useBrowser,
  waitForToastToClear,
} from '../lib/harness.mjs';

describe('pipeline journey', () => {
  const browser = useBrowser();
  const step = steps(browser, 'pipeline');
  let page;
  let dealId;

  step('shows the sign-in screen', async () => {
    page = await browser.person('erin');
    await page.goto(BASE_URL, { waitUntil: 'networkidle0' });
    assert.match(await text(page), /Sign in to Cadence/);
  });

  step('asks a new user to create a workspace, then opens the pipeline', async () => {
    await signIn(page, email('erin'), 'Erin Test');
    await page.waitForSelector('::-p-text(Create your workspace)');
    await page.type('input[placeholder="e.g. Cadence Studio"]', 'E2E Studio');
    await clickButton(page, 'Create workspace');
    await page.waitForSelector('[data-testid=new-menu]');
  });

  step('adds a product to the catalog', async () => {
    await page.goto(BASE_URL + '/products', { waitUntil: 'networkidle0' });
    await clickButton(page, 'New product');
    await page.type('input[placeholder="e.g. Brand identity sprint"]', 'Website build');
    await page.type('input[placeholder="6500"]', '9000');
    await clickButton(page, 'Add to catalog');
    const saved = await eventually(async () => (await api(page, '/crm/products')).find((p) => p.name === 'Website build'));
    assert.ok(saved, 'product saved');
    assert.equal(Number(saved.unitPrice), 9000);
  });

  step('creates a deal with a new company and contact', async () => {
    await page.goto(BASE_URL + '/pipeline', { waitUntil: 'networkidle0' });
    dealId = await createDealInUi(page, { company: 'Northwind d.o.o.', contact: 'Ana Marković' });
    await page.waitForFunction(() => document.body.innerText.includes('Deal created'));
    const body = await text(page);
    assert.ok(body.includes('Northwind d.o.o.') && body.includes('Ana Marković'), 'lead screen shows company and contact');

    const deal = await api(page, '/crm/deals/' + dealId);
    const companies = await api(page, '/crm/companies');
    const contacts = await api(page, '/crm/contacts');
    const company = companies.find((c) => c.name === 'Northwind d.o.o.');
    const contact = contacts.find((c) => c.fullName === 'Ana Marković');
    assert.ok(company && contact, 'company and contact saved');
    assert.equal(deal.companyId, company.id);
    assert.equal(contact.companyId, company.id);
    assert.equal(deal.primaryContactId, contact.id);
  });

  step('saves the closing date', async () => {
    await setClosingDate(page, '2026-12-15');
    const deal = await eventually(async () => {
      const d = await api(page, '/crm/deals/' + dealId);
      return d.closeDate === '2026-12-15' && d;
    });
    assert.ok(deal, 'closeDate saved');
  });

  step('logs a note from the composer', async () => {
    await waitForToastToClear(page);
    await clickButton(page, 'Note');
    const textarea = await page.waitForSelector('textarea[placeholder^="Write a note"]');
    await textarea.type('Called, interested in a Q1 start.');
    await clickButton(page, 'Save note');
    const note = await eventually(async () =>
      (await api(page, `/crm/deals/${dealId}/activities`)).find((a) => a.channel === 'NT' && (a.detail || '').includes('Q1 start')),
    );
    assert.ok(note, 'note saved as an activity');
  });

  step('moves the deal to the next stage by drag and drop', async () => {
    const funnels = await api(page, '/crm/funnels');
    const deal = await api(page, '/crm/deals/' + dealId);
    const funnel = funnels.find((f) => f.id === deal.funnelId);
    const next = funnel.stages[1];
    await page.goto(BASE_URL + '/pipeline', { waitUntil: 'networkidle0' });
    await page.waitForSelector('[draggable=true]');
    const result = await page.evaluate((stageName) => {
      const card = [...document.querySelectorAll('[draggable=true]')].find((el) => el.innerText.includes('Northwind'));
      let col = [...document.querySelectorAll('span,div')].find((el) => el.children.length === 0 && el.textContent.trim() === stageName);
      while (col && col.getBoundingClientRect().height < 300) col = col.parentElement;
      if (!card || !col) return `card found: ${!!card}, column found: ${!!col}`;
      const dt = new DataTransfer();
      card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
      col.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
      col.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
      card.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
      return 'ok';
    }, next.name);
    assert.equal(result, 'ok');
    const moved = await eventually(async () => (await api(page, '/crm/deals/' + dealId)).stageId === next.id);
    assert.ok(moved, `deal moved to "${next.name}"`);
  });

  step('shows everything again after a reload', async () => {
    await page.reload({ waitUntil: 'networkidle0' });
    await page.goto(BASE_URL + '/companies', { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.body.innerText.includes('Northwind d.o.o.'));
    await page.goto(BASE_URL + '/contacts', { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.body.innerText.includes('Ana Marković'));
  });

  const screens = ['/overview', '/today', '/pipeline', '/companies', '/contacts', '/products', '/settings/workspace', '/settings/funnels', '/settings/templates', '/settings/team', '/profile'];
  for (const path of [...screens, '/deals/:id']) {
    step(`renders ${path}`, async () => {
      await page.goto(BASE_URL + path.replace(':id', dealId), { waitUntil: 'networkidle0' });
      const body = await text(page);
      assert.ok(body.length > 50, 'screen has content');
      assert.ok(!body.includes('Something went wrong'), 'no error screen');
    });
  }

  step('the user has exactly one workspace', async () => {
    const me = await api(page, '/me');
    assert.equal(me.tenants.length, 1);
  });

  it('throws no uncaught errors in the page', () => {
    assert.deepEqual(browser.errors, []);
  });
});
