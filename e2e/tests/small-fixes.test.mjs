// Small fixes (CD-76): notes from the New contact dialog are saved and shown on the contact, and
// members see the funnel builder's stage fields read-only.
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { api, BASE_URL, clickButton, createReadyCompany, email, eventually, newUserWithWorkspace, setValue, signIn, steps, useBrowser, createNew, finishOnboarding } from '../lib/harness.mjs';

describe('contact notes and read-only funnels', () => {
  const browser = useBrowser();
  const step = steps(browser, 'small-fixes');
  let page;

  step('the New contact dialog saves its notes', async () => {
    page = await browser.person('sam');
    await newUserWithWorkspace(page, { label: 'fixes', name: 'Sam Owner', workspace: 'Fixes Co' });
    const funnels = await api(page, '/crm/funnels');
    await api(page, '/crm/deals', { method: 'POST', body: JSON.stringify({ title: 'Notes opportunity', funnelId: funnels[0].id, companyId: await createReadyCompany(page, 'Notes Customer') }) });
    await page.goto(BASE_URL + '/contacts', { waitUntil: 'networkidle0' });
    await createNew(page, 'contact');
    await page.waitForSelector('input[placeholder="e.g. Ana Marković"]');
    await page.type('input[placeholder="e.g. Ana Marković"]', 'Nina Notes');
    // The dialog asks for the job title and the role in the decision too; its Notes field is
    // "Anything worth knowing" (CD-361: influence is a separate field on the contact page).
    await page.type('.modal input[placeholder="e.g. Marketing Director"]', 'Finance director');
    await page.select('::-p-xpath(//*[contains(@class,"modal")]//label[contains(., "Role in the decision")]//select)', 'Decision maker');
    await setValue(page, '.modal textarea[placeholder="Anything worth knowing"]', 'Signs off on budgets over 10k');
    await clickButton(page, 'Add contact');
    const saved = await eventually(async () => (await api(page, '/crm/contacts')).find((c) => c.fullName === 'Nina Notes'));
    assert.ok(saved, 'contact saved');
    assert.equal(saved.notes, 'Signs off on budgets over 10k');
    await page.goto(`${BASE_URL}/contacts/${saved.id}`, { waitUntil: 'networkidle0' });
    const shown = await page.waitForFunction(() => document.querySelector('textarea[aria-label="Notes"]')?.value);
    assert.equal(await shown.jsonValue(), 'Signs off on budgets over 10k');
  });

  step('a member has no funnel settings: the URL goes home and Pipeline has no Edit funnel (CD-523)', async () => {
    const { token } = await api(page, '/team/invitations', { method: 'POST', body: JSON.stringify({ email: email('fixes-member'), role: 'member' }) });
    const member = await browser.person('max');
    await member.goto(`${BASE_URL}/invite/${token}`, { waitUntil: 'networkidle0' });
    await signIn(member, email('fixes-member'), 'Max Member');
    await clickButton(member, 'Accept and join');
    await finishOnboarding(member);
    await member.goto(BASE_URL + '/settings/funnel', { waitUntil: 'networkidle0' });
    // Home (CD-288), then the Pipeline itself.
    await member.waitForSelector('[data-testid=home-modules]');
    await member.goto(BASE_URL + '/pipeline', { waitUntil: 'networkidle0' });
    await member.waitForSelector('[data-testid=pipeline-funnel]');
    assert.equal(await member.$('[data-testid=funnels-read-only]'), null, 'no funnel settings');
    assert.equal(await member.$('[data-testid=pipeline-edit-funnel]'), null, 'no Edit funnel pencil');
  });
});
