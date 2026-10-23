// Workspace settings and profile settings are saved and survive a reload; a deal's discovery notes reach the proposal.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { api, BASE_URL, clickButton, createDealInUi, email, eventually, newUserWithWorkspace, RUN, setByLabel, signIn, steps, text, useBrowser, waitForToastToClear, finishOnboarding } from '../lib/harness.mjs';

/** The value of the input/select/textarea next to a label (like setByLabel, for reading). */
const valueByLabel = (page, label, tag = 'input') =>
  page.evaluate(
    (label, tag) => {
      const span = [...document.querySelectorAll('span')].find((el) => el.textContent.trim() === label);
      return span?.parentElement?.querySelector(tag)?.value ?? null;
    },
    label,
    tag,
  );

describe('settings and discovery fields', () => {
  const browser = useBrowser();
  const step = steps(browser, 'settings');
  let page;
  let member;
  let dealId;
  const workspaceName = `Renamed Studio ${RUN}`;

  step('sets up a workspace and an opportunity', async () => {
    page = await browser.person('owner');
    await newUserWithWorkspace(page, { label: 'settings-owner', name: 'Olga Owner', workspace: 'Settings Co' });
    dealId = await createDealInUi(page, { company: 'Umbrella', contact: 'Albert Wesker' });
    await waitForToastToClear(page);
  });

  step('saves the workspace settings', async () => {
    await page.goto(`${BASE_URL}/settings/workspace`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.body.innerText.includes('Fiscal year starts'));
    assert.ok(await setByLabel(page, 'Name', workspaceName));
    assert.ok(await setByLabel(page, 'Currency', 'RSD', 'select'));
    assert.ok(await setByLabel(page, 'Time zone', 'Europe/London', 'select'));
    assert.ok(await setByLabel(page, 'Fiscal year starts', '4', 'select'));
    assert.ok(await setByLabel(page, 'Customer email language', 'sr', 'select'));
    assert.ok((await text(page)).includes('Language of the fixed text in emails to customers'), 'hint under the language');
    const saved = await eventually(async () => {
      const ws = await api(page, '/workspace');
      return ws.name === workspaceName && ws.currency === 'RSD' && ws.timezone === 'Europe/London' && ws.fiscalYearStartMonth === 4 && ws.customerEmailLanguage === 'sr' && ws;
    });
    assert.ok(saved, 'workspace settings saved');
  });

  step('has no Integrations or Billing tab, and their old links go back to Settings (CD-207)', async () => {
    const tabs = await page.$$eval('button', (els) => els.map((b) => b.textContent.trim()));
    assert.ok(tabs.includes('Notifications'), 'the tab bar is there');
    assert.ok(!tabs.includes('Integrations') && !tabs.includes('Billing'), 'no placeholder tabs');
    for (const tab of ['integrations', 'billing']) {
      await page.goto(`${BASE_URL}/settings/${tab}`, { waitUntil: 'networkidle0' });
      await page.waitForFunction(() => location.pathname === '/settings/workspace' && document.body.innerText.includes('Fiscal year starts'));
    }
  });

  step('shows the saved workspace settings after a reload, and the new name in the session', async () => {
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.body.innerText.includes('Fiscal year starts'));
    assert.equal(await valueByLabel(page, 'Name'), workspaceName);
    assert.equal(await valueByLabel(page, 'Currency', 'select'), 'RSD');
    assert.equal(await valueByLabel(page, 'Time zone', 'select'), 'Europe/London');
    assert.equal(await valueByLabel(page, 'Fiscal year starts', 'select'), '4');
    assert.equal(await valueByLabel(page, 'Customer email language', 'select'), 'sr');
    await page.goto(`${BASE_URL}/profile`, { waitUntil: 'networkidle0' });
    await page.waitForFunction((name) => document.body.innerText.includes(name), {}, workspaceName);
  });

  step('saves the profile settings, without password fields or fake toasts', async () => {
    const body = await text(page);
    assert.equal(await page.$$eval('input[type=password]', (els) => els.length), 0, 'no password fields');
    assert.ok(!/current password|update password/i.test(body), 'no password section');
    assert.ok(!body.includes('Save changes'), 'no fake save button');
    // Language and date format aren't applied yet, so they aren't offered (CD-223).
    assert.ok(!body.includes('Date format'), 'no date format');
    assert.equal(await page.$$eval('span', (els) => els.filter((el) => el.textContent.trim() === 'Language').length), 0, 'no language');
    const funnels = await api(page, '/crm/funnels');
    const ent = funnels.find((f) => f.key === 'ent');
    assert.ok(await setByLabel(page, 'Full name', 'Olga Renamed'));
    assert.ok(await setByLabel(page, 'Job title', 'Head of sales'));
    assert.ok(await setByLabel(page, 'Phone', '+381 60 123 456'));
    assert.ok(await setByLabel(page, 'Start page', 'today', 'select'));
    assert.ok(await setByLabel(page, 'Default funnel', ent.id, 'select'));
    await page.click('.switch');
    const saved = await eventually(async () => {
      const p = await api(page, '/profile');
      return (
        p.displayName === 'Olga Renamed' &&
        p.jobTitle === 'Head of sales' &&
        p.phone === '+381 60 123 456' &&
        p.startPage === 'today' &&
        p.defaultFunnelId === ent.id &&
        p.dailyDigest === false &&
        p
      );
    });
    assert.ok(saved, 'profile saved');
  });

  step('shows the saved profile after a reload', async () => {
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.body.innerText.includes('Daily digest email'));
    assert.equal(await valueByLabel(page, 'Full name'), 'Olga Renamed');
    assert.equal(await valueByLabel(page, 'Job title'), 'Head of sales');
    assert.equal(await valueByLabel(page, 'Phone'), '+381 60 123 456');
    assert.equal(await valueByLabel(page, 'Start page', 'select'), 'today');
    assert.equal(await page.$eval('.switch', (el) => el.classList.contains('on')), false);
  });

  step('opens the saved start page', async () => {
    await page.goto(BASE_URL, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => location.pathname === '/today');
  });

  // The discovery notes are hidden on the deal page since the Qualification card (CD-362); they are
  // still saved on the deal and merged into the proposal.
  step('merges the discovery notes of an opportunity into the proposal', async () => {
    await api(page, '/crm/deals/' + dealId, {
      method: 'PATCH',
      body: JSON.stringify({
        discoveryDate: '2026-09-03',
        need: 'a repositioning across six markets',
        constraint: 'procurement requires three approvals',
        decisionMaker: 'the CMO with CFO sign-off',
        headline: 'One story across six markets',
      }),
    });
    await page.goto(`${BASE_URL}/settings/templates`, { waitUntil: 'networkidle0' });
    await clickButton(page, 'Preview with an opportunity');
    await page.waitForFunction(() => document.body.textContent.includes('What you told us'));
    const doc = await text(page);
    assert.ok(doc.includes('One story across six markets'), 'headline in the proposal');
    assert.ok(doc.includes('3 September 2026'), 'discovery date in the proposal');
    assert.ok(doc.includes('a repositioning across six markets.'), 'need in the proposal');
    assert.ok(doc.includes('procurement requires three approvals'), 'constraint in the proposal');
    assert.ok(doc.includes('the CMO with CFO sign-off'), 'decision maker in the proposal');
  });

  step('shows members the workspace settings read-only', async () => {
    const { token } = await api(page, '/team/invitations', { method: 'POST', body: JSON.stringify({ email: email('settings-member'), role: 'member' }) });
    member = await browser.person('member');
    await member.goto(`${BASE_URL}/invite/${token}`, { waitUntil: 'networkidle0' });
    await signIn(member, email('settings-member'), 'Max Member');
    await clickButton(member, 'Accept and join');
    await finishOnboarding(member);
    await member.goto(`${BASE_URL}/settings/workspace`, { waitUntil: 'networkidle0' });
    await member.waitForFunction(() => document.body.innerText.includes('Only owners and admins can change the workspace settings.'));
    assert.equal(await valueByLabel(member, 'Name'), workspaceName);
    assert.equal(await valueByLabel(member, 'Currency', 'select'), 'RSD');
    const disabled = await member.evaluate(() =>
      ['Name', 'Currency', 'Time zone', 'Fiscal year starts'].map((label) => {
        const span = [...document.querySelectorAll('span')].find((el) => el.textContent.trim() === label);
        return span?.parentElement?.querySelector('input, select')?.disabled;
      }),
    );
    assert.deepEqual(disabled, [true, true, true, true]);
    // A member's own profile starts with the defaults, independent of the owner's.
    const p = await api(member, '/profile');
    assert.equal(p.startPage, 'pipeline');
    assert.equal(p.defaultFunnelId, null);
  });

  it('throws no uncaught errors in the page', () => {
    assert.deepEqual(browser.errors, []);
  });
});

