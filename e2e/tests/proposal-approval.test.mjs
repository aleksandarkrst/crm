// Proposal approval (CD-120): configured once per funnel in Settings → Funnels (one switch, one
// approver), then on an opportunity's Documents tab: import its proposal, request approval (a task
// for the approver), approve it, and only then send it. The Approval status filter follows it.
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
    await click(page, 'button.composer-tab::-p-text(Documents)');
    // The next step sits where "Preview built-in proposal" is; nothing to request without a proposal.
    await page.waitForSelector('[data-testid=approval-status]');
    assert.equal(await page.$eval('[data-testid=approval-status]', (el) => el.textContent), 'Not requested');
    await page.waitForFunction(() => document.querySelector('[data-testid=approval-request]')?.disabled === true);
    const pdf = join(tmpdir(), `Ponuda-${Date.now()}.pdf`);
    await writeFile(pdf, '%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n');
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

    // Imported: no second proposal, so the choice and the built-in preview give way to "Add documents".
    await page.waitForSelector('[data-testid=docs-add]');
    assert.equal(await page.$('[data-testid=docs-mode-import]'), null);
    assert.equal(await page.$('::-p-text(Preview built-in proposal)'), null);
    await click(page, '[data-testid=docs-add]');
    await (await page.waitForSelector('[data-testid=docs-import-input]')).uploadFile(pdf);
    const types = await page.$$eval('[data-testid=docs-import-file] select option', (els) => els.map((o) => o.value));
    assert.ok(types.includes('Price list') && !types.includes('Proposal'), 'supporting documents only');
    await click(page, '[data-testid=docs-add]');
  });

  step("can't be sent before approval; requested (a task for the approver), then approved", async () => {
    assert.equal((await api(page, `/crm/deals?approvalStatus=not_requested`)).some((r) => r.deal.id === dealId), true);
    assert.equal(await page.$('[data-testid=proposal-send]'), null, 'no Send proposal before approval');

    await waitForToastToClear(page);
    await page.waitForFunction(() => document.querySelector('[data-testid=approval-request]')?.disabled === false);
    await click(page, '[data-testid=approval-request]');
    await page.waitForFunction(() => document.querySelector('[data-testid=approval-status]')?.textContent === 'Pending approval');
    assert.equal((await api(page, `/crm/deals/${dealId}`)).approvalStatus, 'pending');
    assert.equal((await api(page, `/crm/deals?approvalStatus=pending`)).some((r) => r.deal.id === dealId), true);
    const task = (await api(page, `/crm/deal-tasks?dealIds=${dealId}`)).find((t) => t.label === 'Approve the proposal');
    assert.equal(task?.assigneeUserId, me, 'the approver has a task');

    // Petra is the approver: Approve shows where Request approval was.
    await click(page, '[data-testid=approval-approve]');
    await page.waitForFunction(() => document.querySelector('[data-testid=approval-status]')?.textContent === 'Approved');
    assert.equal((await api(page, `/crm/deals?approvalStatus=approved`)).some((r) => r.deal.id === dealId), true);
    assert.equal((await api(page, `/crm/deal-tasks?dealIds=${dealId}`)).find((t) => t.id === task.id)?.done, true, 'the task is ticked');
    await page.waitForSelector('[data-testid=approval-revoke]');
  });

  step('once approved, Send proposal marks it as sent', async () => {
    await page.waitForFunction(() => document.querySelector('[data-testid=proposal-send]')?.disabled === false);
    await click(page, '[data-testid=proposal-send]');
    await page.waitForFunction(() => document.querySelector('[data-testid=proposal-send]')?.textContent === 'Proposal sent');
    assert.ok((await api(page, `/crm/deals/${dealId}`)).proposalSentAt, 'sent');
  });

  it('throws no uncaught errors in the page', () => {
    assert.deepEqual(browser.errors, []);
  });
});
