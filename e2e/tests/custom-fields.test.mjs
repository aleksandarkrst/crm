// Custom fields (CD-15): an owner adds a field in Settings → Customize Fields, fills it on a deal,
// and the value survives a reload; members can fill values but not change the definitions.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { api, BASE_URL, clickButton, createDealInUi, email, eventually, newUserWithWorkspace, signIn, steps, text, useBrowser, waitForToastToClear } from '../lib/harness.mjs';

/** Types into the custom field input with this label (data-custom-field) on the screen. */
async function fillCustom(page, label, value) {
  const input = await page.waitForSelector(`[data-custom-field="${label}"]`);
  await input.click({ count: 3 });
  await input.type(value);
}
const customValue = (page, label) => page.$eval(`[data-custom-field="${label}"]`, (el) => el.value);

describe('custom fields', () => {
  const browser = useBrowser();
  const step = steps(browser, 'custom-fields');
  let page;
  let dealId;
  let field;

  step('sets up a workspace and a deal', async () => {
    page = await browser.person('cf-owner');
    await newUserWithWorkspace(page, { label: 'cf-owner', name: 'Fiona Fields', workspace: 'Fields Co' });
    dealId = await createDealInUi(page, { company: 'Globex', contact: 'Hank Scorpio' });
    await waitForToastToClear(page);
  });

  step('adds a deal field in Settings → Customize Fields', async () => {
    await page.goto(BASE_URL + '/settings/fields', { waitUntil: 'networkidle0' });
    assert.ok(!(await text(page)).includes('for this session only'), 'no "session only" note any more');
    await clickButton(page, 'New field');
    await page.type('input[placeholder="e.g. Contract end date"]', 'PO number');
    await clickButton(page, 'Add field');
    await page.waitForFunction(() => document.querySelector('.toast')?.textContent.includes('PO number added to deals'));
    field = await eventually(async () => (await api(page, '/crm/custom-fields')).find((f) => f.label === 'PO number'));
    assert.ok(field, 'field saved');
    assert.equal(field.entity, 'deal');
    assert.equal(field.type, 'text');
    await page.waitForSelector('[data-testid=fields-deal] [data-testid=custom-field]');
    await waitForToastToClear(page);
  });

  step('fills the field on the deal', async () => {
    await page.goto(`${BASE_URL}/deals/${dealId}`, { waitUntil: 'networkidle0' });
    await fillCustom(page, 'PO number', 'PO-4711');
    const saved = await eventually(async () => (await api(page, '/crm/deals/' + dealId)).customFields?.[field.id] === 'PO-4711');
    assert.ok(saved, 'value saved on the deal');
  });

  step('the value survives a reload', async () => {
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-custom-field="PO number"]');
    assert.equal(await customValue(page, 'PO number'), 'PO-4711');
  });

  step('a member fills values but cannot change the definitions', async () => {
    const { token } = await api(page, '/team/invitations', { method: 'POST', body: JSON.stringify({ email: email('cf-member'), role: 'member' }) });
    const member = await browser.person('cf-member');
    await member.goto(`${BASE_URL}/invite/${token}`, { waitUntil: 'networkidle0' });
    await signIn(member, email('cf-member'), 'Mia Member');
    await clickButton(member, 'Accept and join');
    await member.waitForSelector('button::-p-text(New deal)');
    await member.goto(`${BASE_URL}/settings/fields`, { waitUntil: 'networkidle0' });
    await member.waitForFunction(() => document.body.innerText.includes('Only owners and admins can add or change custom fields.'));
    assert.equal(await member.$('button::-p-text(New field)'), null, 'no New field button for members');
    assert.equal(await member.$('[data-testid=custom-field] button::-p-text(Delete)'), null, 'no Delete for members');

    await member.goto(`${BASE_URL}/deals/${dealId}`, { waitUntil: 'networkidle0' });
    assert.equal(await customValue(member, 'PO number'), 'PO-4711');
    await fillCustom(member, 'PO number', 'PO-4712');
    const saved = await eventually(async () => (await api(member, '/crm/deals/' + dealId)).customFields?.[field.id] === 'PO-4712');
    assert.ok(saved, 'member saved a value');
  });

  step('deleting the field asks first and hides it from the deal', async () => {
    await page.goto(BASE_URL + '/settings/fields', { waitUntil: 'networkidle0' });
    // The harness accepts every dialog; just read the question.
    let question = '';
    page.once('dialog', (d) => void (question = d.message()));
    await page.click('[data-testid=fields-deal] [data-testid=custom-field] button::-p-text(Delete)');
    await eventually(async () => !(await api(page, '/crm/custom-fields')).some((f) => f.id === field.id));
    assert.match(question, /Values already entered are kept/);
    await page.goto(`${BASE_URL}/deals/${dealId}`, { waitUntil: 'networkidle0' });
    assert.equal(await page.$('[data-custom-field="PO number"]'), null, 'field hidden on the deal');
  });

  it('throws no uncaught errors in the page', () => {
    assert.deepEqual(browser.errors, []);
  });
});
