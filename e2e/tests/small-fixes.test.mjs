// Small fixes (CD-76): notes from the New contact dialog are saved and shown on the contact, and
// members see the funnel builder's stage fields read-only.
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { api, BASE_URL, clickButton, email, eventually, newUserWithWorkspace, setValue, signIn, steps, useBrowser, createNew } from '../lib/harness.mjs';

describe('contact notes and read-only funnels', () => {
  const browser = useBrowser();
  const step = steps(browser, 'small-fixes');
  let page;

  step('the New contact dialog saves its notes', async () => {
    page = await browser.person('sam');
    await newUserWithWorkspace(page, { label: 'fixes', name: 'Sam Owner', workspace: 'Fixes Co' });
    const funnels = await api(page, '/crm/funnels');
    await api(page, '/crm/deals', { method: 'POST', body: JSON.stringify({ title: 'Notes deal', funnelId: funnels[0].id }) });
    await page.goto(BASE_URL + '/contacts', { waitUntil: 'networkidle0' });
    await createNew(page, 'contact');
    await page.waitForSelector('input[placeholder="e.g. Ana Marković"]');
    await page.type('input[placeholder="e.g. Ana Marković"]', 'Nina Notes');
    await setValue(page, 'textarea[placeholder="How they influence the deal"]', 'Signs off on budgets over 10k');
    await clickButton(page, 'Add contact');
    const saved = await eventually(async () => (await api(page, '/crm/contacts')).find((c) => c.fullName === 'Nina Notes'));
    assert.ok(saved, 'contact saved');
    assert.equal(saved.notes, 'Signs off on budgets over 10k');
    await page.goto(`${BASE_URL}/contacts/${saved.id}`, { waitUntil: 'networkidle0' });
    const shown = await page.waitForFunction(() => document.querySelector('textarea.ghost')?.value);
    assert.equal(await shown.jsonValue(), 'Signs off on budgets over 10k');
  });

  step('a member sees the stage fields read-only', async () => {
    const { token } = await api(page, '/team/invitations', { method: 'POST', body: JSON.stringify({ email: email('fixes-member'), role: 'member' }) });
    const member = await browser.person('max');
    await member.goto(`${BASE_URL}/invite/${token}`, { waitUntil: 'networkidle0' });
    await signIn(member, email('fixes-member'), 'Max Member');
    await clickButton(member, 'Accept and join');
    await member.waitForSelector('[data-testid=new-menu]');
    await member.goto(BASE_URL + '/settings/funnel', { waitUntil: 'networkidle0' });
    await member.waitForSelector('[data-testid=funnels-read-only]');
    const fields = await member.$$eval('.gate-chip input, input.ghost, select.form-input, input[type=number]', (els) => els.map((el) => el.disabled));
    assert.ok(fields.length > 5, 'stage fields found');
    assert.ok(fields.every(Boolean), 'every stage field is disabled');
    assert.equal(await member.$('button::-p-text(+ to-do)'), null);
    assert.equal(await member.$('button::-p-text(+ Add stage to this funnel)'), null);
  });
});
