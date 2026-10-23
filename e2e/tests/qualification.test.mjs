// The Qualification card (CD-362): sponsors are contacts, pain and solution, the steps to be qualified
// with "Other", and the Qualified switch with who and when. All of it survives a reload. CHAMP and the
// fit score are gone from the deal page and the Pipeline.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { api, BASE_URL, click, createDealInUi, eventually, newUserWithWorkspace, steps, text, useBrowser, waitForToastToClear } from '../lib/harness.mjs';

/** Sets the select/textarea of a row on the Qualification card (labels like "Other" repeat elsewhere). */
const setOnCard = (page, label, value, tag) =>
  page.evaluate(
    (label, value, tag) => {
      const card = document.querySelector('[data-testid=qualification]');
      const row = [...card.querySelectorAll('.field-row')].find((el) => el.querySelector('.field-label')?.textContent.trim() === label);
      const el = row?.querySelector(tag);
      if (!el) return false;
      const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLTextAreaElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    },
    label,
    value,
    tag,
  );
const valueOnCard = (page, label, tag) =>
  page.evaluate(
    (label, tag) => {
      const card = document.querySelector('[data-testid=qualification]');
      const row = [...card.querySelectorAll('.field-row')].find((el) => el.querySelector('.field-label')?.textContent.trim() === label);
      return row?.querySelector(tag)?.value ?? null;
    },
    label,
    tag,
  );
/** Ticks or unticks one step in the "To be qualified" dropdown. */
async function toggleStep(page, step) {
  await click(page, '[data-testid=qualification] button[aria-label="To be qualified"]');
  await page.waitForSelector('[data-testid=qualification-steps]');
  await page.evaluate((step) => {
    const item = [...document.querySelectorAll('[data-testid=qualification-steps] .org-multi-item')].find((el) => el.textContent.trim() === step);
    item.querySelector('input').click();
  }, step);
  await click(page, '[data-testid=qualification] button[aria-label="To be qualified"]');
}

describe('qualification', () => {
  const browser = useBrowser();
  const step = steps(browser, 'qualification');
  let page;
  let dealId;
  let contactId;

  step('creates an opportunity with a contact', async () => {
    page = await browser.person('qualify');
    await newUserWithWorkspace(page, { label: 'qualify', name: 'Quinn Qualifier', workspace: 'Qualify Co' });
    dealId = await createDealInUi(page, { company: 'Globex', contact: 'Hank Scorpio' });
    await waitForToastToClear(page);
    contactId = (await api(page, '/crm/deals/' + dealId)).primaryContactId;
    assert.ok(contactId, 'the deal has its contact');
  });

  step('the card is called Qualification; CHAMP and the fit score are gone', async () => {
    await page.waitForSelector('[data-testid=qualification]');
    const body = await text(page);
    assert.ok(!body.includes('Fit score\n'), 'no Fit score card');
    assert.ok(!body.includes('CHAMP'), 'no CHAMP');
    assert.ok(!(await page.$('[data-testid=qualification] input[type=date]')), 'the discovery date is hidden');
  });

  step('fills sponsors, pain, solution, steps and other, and turns Qualified on', async () => {
    assert.ok(await setOnCard(page, 'Sponsor', contactId, 'select'));
    assert.ok(await setOnCard(page, 'Power sponsor', contactId, 'select'));
    assert.ok(await setOnCard(page, 'Pain', 'Outages and overtime', 'textarea'));
    assert.ok(await setOnCard(page, 'Solution', 'Remote monitoring', 'textarea'));
    await toggleStep(page, 'Confirm budget');
    await toggleStep(page, 'Agree on timeline');
    assert.ok(await setOnCard(page, 'Other', 'Tender published', 'textarea'));
    await click(page, '[data-testid=qualification] button[role=switch]');
    await page.waitForSelector('[data-testid=qualified-by]');
    const saved = await eventually(async () => {
      const d = await api(page, '/crm/deals/' + dealId);
      return (
        d.sponsorContactId === contactId &&
        d.powerSponsorContactId === contactId &&
        d.pain === 'Outages and overtime' &&
        d.painSolution === 'Remote monitoring' &&
        d.qualificationSteps.join() === 'Confirm budget,Agree on timeline' &&
        d.qualificationOther === 'Tender published' &&
        !!d.qualifiedAt &&
        d
      );
    });
    assert.ok(saved, 'qualification saved');
    assert.match(await page.$eval('[data-testid=qualified-by]', (el) => el.textContent), /Quinn Qualifier/);
  });

  step('everything is still there after a reload, and a step can be removed', async () => {
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-testid=qualified-by]');
    assert.equal(await valueOnCard(page, 'Sponsor', 'select'), contactId);
    assert.equal(await valueOnCard(page, 'Power sponsor', 'select'), contactId);
    assert.equal(await valueOnCard(page, 'Pain', 'textarea'), 'Outages and overtime');
    assert.equal(await valueOnCard(page, 'Other', 'textarea'), 'Tender published');
    assert.match(await page.$eval('[data-testid=qualification] button[aria-label="To be qualified"]', (el) => el.textContent), /Confirm budget, Agree on timeline/);
    await toggleStep(page, 'Confirm budget');
    assert.ok(await eventually(async () => (await api(page, '/crm/deals/' + dealId)).qualificationSteps.join() === 'Agree on timeline'));
  });

  step('turning Qualified off clears who and when; both changes are on the timeline', async () => {
    await click(page, '[data-testid=qualification] button[role=switch]');
    await page.waitForFunction(() => !document.querySelector('[data-testid=qualified-by]'));
    assert.ok(await eventually(async () => (await api(page, '/crm/deals/' + dealId)).qualifiedAt === null));
    const titles = (await api(page, `/crm/deals/${dealId}/activities`)).map((a) => a.title);
    assert.ok(titles.includes('Marked Qualified') && titles.includes('No longer Qualified'), titles.join(' | '));
  });

  step('the Pipeline shows no fit score', async () => {
    await page.goto(`${BASE_URL}/pipeline`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.body.innerText.includes('Globex'));
    assert.ok(!/\bfit \d+/.test(await text(page)), 'no "fit N" badge');
  });

  it('throws no uncaught errors in the page', () => {
    assert.deepEqual(browser.errors, []);
  });
});
