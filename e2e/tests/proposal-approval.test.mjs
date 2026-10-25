// Proposal approval (CD-120): configured once per funnel in Settings → Funnels (one switch, one
// approver), then on an opportunity: import its proposal, request approval, approve it, and only
// then mark it as sent. The Approval status filter follows it.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { api, BASE_URL, click, createDealInUi, eventually, newUserWithWorkspace, steps, useBrowser, waitForToastToClear } from '../lib/harness.mjs';

const SWITCH = 'button[aria-label="Proposals in this funnel need approval before they are sent"]';

describe('proposal approval', () => {
  const browser = useBrowser();
  const step = steps(browser, 'proposal-approval');
  let page;
  let me;
  let funnelId;
  let dealId;

  step('switches approval on once for the funnel, with its approver', async () => {
    page = await browser.person('petra');
    await newUserWithWorkspace(page, { label: 'proposal-approval', name: 'Petra Approver', workspace: 'Approval Co' });
    me = (await api(page, '/profile')).userId;
    funnelId = (await api(page, '/crm/funnels'))[0].id;
    await page.goto(BASE_URL + '/settings/funnel', { waitUntil: 'networkidle0' });
    // One section for the funnel, below its stages and above the preview; no stage has its own switch.
    const order = await page.evaluate(() => {
      const card = document.querySelector('[data-testid=funnel-card]');
      const els = [...card.querySelectorAll('[data-testid=add-stage], [data-testid=funnel-approval], [data-testid=funnel-preview]')];
      return els.map((el) => el.dataset.testid);
    });
    assert.deepEqual(order, ['add-stage', 'funnel-approval', 'funnel-preview']);
    assert.equal(await page.$$eval(SWITCH, (els) => els.length), 1);
    await click(page, SWITCH);
    await page.waitForSelector('[data-testid=funnel-approver]');
    await page.select('[data-testid=funnel-approver]', me);
    const saved = await eventually(async () => {
      const f = (await api(page, '/crm/funnels')).find((x) => x.id === funnelId);
      return f.proposalApproval && f.approverUserId === me;
    });
    assert.ok(saved, 'the funnel asks for approval, by Petra');
  });

  step('imports the proposal on the Documents tab, typed Proposal', async () => {
    dealId = await createDealInUi(page, { company: 'Vega Trans', contact: 'Marko Jović' });
    await page.waitForSelector('[data-testid=approval-status]');
    assert.equal(await page.$eval('[data-testid=approval-status]', (el) => el.textContent), 'Not requested');
    // Nothing to request without a proposal.
    await page.waitForFunction(() => document.querySelector('[data-testid=approval-request]')?.disabled === true);
    const pdf = join(tmpdir(), `Ponuda-${Date.now()}.pdf`);
    await writeFile(pdf, '%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n');
    await click(page, 'button.composer-tab::-p-text(Documents)');
    await click(page, '[data-testid=docs-mode-import]');
    const input = await page.waitForSelector('[data-testid=docs-import-input]');
    await input.uploadFile(pdf);
    await page.waitForSelector('[data-testid=docs-import-file]');
    // Saving waits for a document type.
    assert.equal(await page.$eval('[data-testid=docs-import-save]', (el) => el.disabled), true);
    await page.select('[data-testid=docs-import-file] select', 'Proposal');
    await click(page, '[data-testid=docs-import-save]');
    const docs = await eventually(async () => {
      const list = await api(page, `/crm/deal-documents?dealId=${dealId}`);
      return list.length === 1 && list[0];
    });
    assert.equal(docs.docType, 'Proposal');
    assert.equal(docs.source, 'uploaded');
  });

  step("can't be sent before approval; requested, then approved", async () => {
    assert.equal((await api(page, `/crm/deals?approvalStatus=not_requested`)).some((r) => r.deal.id === dealId), true);
    await click(page, 'button::-p-text(Preview built-in proposal)');
    await page.waitForSelector('[data-testid=proposal-mark-sent]');
    assert.equal(await page.$eval('[data-testid=proposal-mark-sent]', (el) => el.disabled), true, 'Mark as sent waits for approval');
    await click(page, 'button::-p-text(Close)');

    await waitForToastToClear(page);
    await page.waitForFunction(() => document.querySelector('[data-testid=approval-request]')?.disabled === false);
    await click(page, '[data-testid=approval-request]');
    await page.waitForFunction(() => document.querySelector('[data-testid=approval-status]')?.textContent === 'Pending approval');
    assert.equal((await api(page, `/crm/deals/${dealId}`)).approvalStatus, 'pending');
    assert.equal((await api(page, `/crm/deals?approvalStatus=pending`)).some((r) => r.deal.id === dealId), true);

    await click(page, '[data-testid=approval-approve]');
    await page.waitForFunction(() => document.querySelector('[data-testid=approval-status]')?.textContent === 'Approved');
    assert.equal((await api(page, `/crm/deals?approvalStatus=approved`)).some((r) => r.deal.id === dealId), true);
  });

  step('once approved, the proposal is marked as sent', async () => {
    await click(page, 'button::-p-text(Preview built-in proposal)');
    await page.waitForFunction(() => document.querySelector('[data-testid=proposal-mark-sent]')?.disabled === false);
    await click(page, '[data-testid=proposal-mark-sent]');
    await page.waitForFunction(() => document.querySelector('[data-testid=proposal-mark-sent]')?.textContent.includes('Marked as sent'));
    assert.ok((await api(page, `/crm/deals/${dealId}`)).proposalSentAt, 'sent');
    await click(page, 'button::-p-text(Close)');
  });

  it('throws no uncaught errors in the page', () => {
    assert.deepEqual(browser.errors, []);
  });
});
