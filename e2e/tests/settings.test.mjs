// Workspace settings, profile settings and the deal's discovery fields are saved and survive a reload.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { api, BASE_URL, clickButton, createDealInUi, email, eventually, newUserWithWorkspace, RUN, setByLabel, signIn, steps, text, useBrowser, waitForToastToClear } from '../lib/harness.mjs';

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

  step('sets up a workspace and a deal', async () => {
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
    const saved = await eventually(async () => {
      const ws = await api(page, '/workspace');
      return ws.name === workspaceName && ws.currency === 'RSD' && ws.timezone === 'Europe/London' && ws.fiscalYearStartMonth === 4 && ws;
    });
    assert.ok(saved, 'workspace settings saved');
  });

  step('shows the saved workspace settings after a reload, and the new name in the session', async () => {
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.body.innerText.includes('Fiscal year starts'));
    assert.equal(await valueByLabel(page, 'Name'), workspaceName);
    assert.equal(await valueByLabel(page, 'Currency', 'select'), 'RSD');
    assert.equal(await valueByLabel(page, 'Time zone', 'select'), 'Europe/London');
    assert.equal(await valueByLabel(page, 'Fiscal year starts', 'select'), '4');
    await page.goto(`${BASE_URL}/profile`, { waitUntil: 'networkidle0' });
    await page.waitForFunction((name) => document.body.innerText.includes(name), {}, workspaceName);
  });

  step('saves the profile settings, without password fields or fake toasts', async () => {
    const body = await text(page);
    assert.equal(await page.$$eval('input[type=password]', (els) => els.length), 0, 'no password fields');
    assert.ok(!/current password|update password/i.test(body), 'no password section');
    assert.ok(!body.includes('Save changes'), 'no fake save button');
    const funnels = await api(page, '/crm/funnels');
    const ent = funnels.find((f) => f.key === 'ent');
    assert.ok(await setByLabel(page, 'Full name', 'Olga Renamed'));
    assert.ok(await setByLabel(page, 'Job title', 'Head of sales'));
    assert.ok(await setByLabel(page, 'Phone', '+381 60 123 456'));
    assert.ok(await setByLabel(page, 'Language', 'de', 'select'));
    assert.ok(await setByLabel(page, 'Date format', 'YYYY-MM-DD', 'select'));
    assert.ok(await setByLabel(page, 'Start page', 'today', 'select'));
    assert.ok(await setByLabel(page, 'Default funnel', ent.id, 'select'));
    await page.click('.switch');
    const saved = await eventually(async () => {
      const p = await api(page, '/profile');
      return (
        p.displayName === 'Olga Renamed' &&
        p.jobTitle === 'Head of sales' &&
        p.phone === '+381 60 123 456' &&
        p.language === 'de' &&
        p.dateFormat === 'YYYY-MM-DD' &&
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
    assert.equal(await valueByLabel(page, 'Language', 'select'), 'de');
    assert.equal(await valueByLabel(page, 'Date format', 'select'), 'YYYY-MM-DD');
    assert.equal(await valueByLabel(page, 'Start page', 'select'), 'today');
    assert.equal(await page.$eval('.switch', (el) => el.classList.contains('on')), false);
  });

  step('opens the saved start page', async () => {
    await page.goto(BASE_URL, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => location.pathname === '/today');
  });

  step('saves the discovery fields of a deal', async () => {
    await page.goto(`${BASE_URL}/deals/${dealId}`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.body.innerText.includes('Discovery'));
    assert.ok(await setByLabel(page, 'Discovery date', '2026-09-03'));
    assert.ok(await setByLabel(page, 'Need', 'a repositioning across six markets', 'textarea'));
    assert.ok(await setByLabel(page, 'Constraint', 'procurement requires three approvals'));
    assert.ok(await setByLabel(page, 'Decision maker', 'the CMO with CFO sign-off'));
    assert.ok(await setByLabel(page, 'Proposal headline', 'One story across six markets'));
    const saved = await eventually(async () => {
      const d = await api(page, '/crm/deals/' + dealId);
      return (
        d.discoveryDate === '2026-09-03' &&
        d.need === 'a repositioning across six markets' &&
        d.constraint === 'procurement requires three approvals' &&
        d.decisionMaker === 'the CMO with CFO sign-off' &&
        d.headline === 'One story across six markets' &&
        d
      );
    });
    assert.ok(saved, 'discovery fields saved');
  });

  step('shows the discovery fields after a reload, and in the proposal', async () => {
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.body.innerText.includes('Discovery'));
    assert.equal(await valueByLabel(page, 'Discovery date'), '2026-09-03');
    assert.equal(await valueByLabel(page, 'Need', 'textarea'), 'a repositioning across six markets');
    assert.equal(await valueByLabel(page, 'Constraint'), 'procurement requires three approvals');
    assert.equal(await valueByLabel(page, 'Decision maker'), 'the CMO with CFO sign-off');
    assert.equal(await valueByLabel(page, 'Proposal headline'), 'One story across six markets');

    await page.goto(`${BASE_URL}/settings/templates`, { waitUntil: 'networkidle0' });
    await clickButton(page, 'Preview with a lead');
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
    await member.waitForSelector('[data-testid=new-menu]');
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

