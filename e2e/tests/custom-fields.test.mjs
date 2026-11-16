// Custom fields (CD-15): an owner adds a field, fills it on a deal, and the value survives a reload;
// members can fill values but not change the definitions. Custom fields are hidden in Workspace
// settings since CD-524, so the field is added and deleted through the API.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { api, BASE_URL, clickButton, createDealInUi, email, eventually, newUserWithWorkspace, signIn, steps, useBrowser, waitForToastToClear, finishOnboarding } from '../lib/harness.mjs';

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

  step('sets up a workspace and an opportunity', async () => {
    page = await browser.person('cf-owner');
    await newUserWithWorkspace(page, { label: 'cf-owner', name: 'Fiona Fields', workspace: 'Fields Co' });
    dealId = await createDealInUi(page, { company: 'Globex', contact: 'Hank Scorpio' });
    await waitForToastToClear(page);
  });

  step('adds an opportunity field (through the API: Settings has no custom fields since CD-524)', async () => {
    // The old Customize fields link lands on Settings → CRM, which has no New field button (CD-524).
    await page.goto(BASE_URL + '/settings/fields', { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => location.pathname === '/settings/crm');
    await page.waitForSelector('[data-testid=funnel-builder]');
    assert.equal(await page.$('button::-p-text(New field)'), null, 'no New field button in Settings');
    await api(page, '/crm/custom-fields', { method: 'POST', body: JSON.stringify({ entity: 'deal', label: 'PO number', type: 'text' }) });
    field = await eventually(async () => (await api(page, '/crm/custom-fields')).find((f) => f.label === 'PO number'));
    assert.ok(field, 'field saved');
    assert.equal(field.entity, 'deal');
    assert.equal(field.type, 'text');
  });

  step('fills the field on the opportunity', async () => {
    await page.goto(`${BASE_URL}/deals/${dealId}`, { waitUntil: 'networkidle0' });
    await fillCustom(page, 'PO number', 'PO-4711');
    const saved = await eventually(async () => (await api(page, '/crm/deals/' + dealId)).customFields?.[field.id] === 'PO-4711');
    assert.ok(saved, 'value saved on the opportunity');
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
    await finishOnboarding(member);
    // Members have no Settings at all (CD-523): Customize fields' URL goes home.
    await member.goto(`${BASE_URL}/settings/fields`, { waitUntil: 'networkidle0' });
    await member.waitForFunction(() => !location.pathname.startsWith('/settings'));
    assert.equal(await member.$('button::-p-text(New field)'), null, 'no New field button for members');

    await member.goto(`${BASE_URL}/deals/${dealId}`, { waitUntil: 'networkidle0' });
    assert.equal(await customValue(member, 'PO number'), 'PO-4711');
    await fillCustom(member, 'PO number', 'PO-4712');
    const saved = await eventually(async () => (await api(member, '/crm/deals/' + dealId)).customFields?.[field.id] === 'PO-4712');
    assert.ok(saved, 'member saved a value');
  });

  step('deleting the field hides it from the opportunity', async () => {
    // Deleted through the API: its Settings screen (and its confirm) is hidden since CD-524.
    await api(page, `/crm/custom-fields/${field.id}`, { method: 'DELETE' });
    await eventually(async () => !(await api(page, '/crm/custom-fields')).some((f) => f.id === field.id));
    await page.goto(`${BASE_URL}/deals/${dealId}`, { waitUntil: 'networkidle0' });
    assert.equal(await page.$('[data-custom-field="PO number"]'), null, 'field hidden on the opportunity');
  });

  it('throws no uncaught errors in the page', () => {
    assert.deepEqual(browser.errors, []);
  });
});
