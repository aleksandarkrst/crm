// Onboarding after the first sign-up (CD-115): a new user creates a workspace, says who they are
// and invites the team (or skips it); a refresh resumes at the step they were on. Someone invited
// who signs up without the link joins that workspace instead of creating another one, and skips
// the team step. Returning users go straight to the app.
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { api, BASE_URL, click, clickButton, email, signIn, steps, text, useBrowser } from '../lib/harness.mjs';

describe('onboarding after sign-up', () => {
  const browser = useBrowser();
  const step = steps(browser, 'user-onboarding');
  let owner;
  const progress = (page) => page.$eval('[data-testid=onboarding-progress]', (el) => el.textContent);
  const colleague = email('onb-colleague');

  step('a new user starts with the workspace, step 1 of 3', async () => {
    owner = await browser.person('olivia');
    await owner.goto(BASE_URL, { waitUntil: 'networkidle0' });
    await signIn(owner, email('onb-owner'), 'Olivia Onboarding');
    await owner.waitForSelector('::-p-text(Create your workspace)');
    assert.match(await progress(owner), /Step 1 of 3 · Workspace/);
    await owner.type('input[placeholder="e.g. Pultly Studio"]', 'Onboarded Co');
    await owner.select('select[aria-label="Time zone"]', 'Asia/Tokyo');
    await clickButton(owner, 'Create workspace');
    await owner.waitForFunction(() => document.querySelector('[data-testid=onboarding-progress]')?.textContent.includes('About you'));
  });

  step('a refresh resumes at the step it was on, with the name from the sign-in', async () => {
    await owner.reload({ waitUntil: 'networkidle0' });
    await owner.waitForFunction(() => document.querySelector('[data-testid=onboarding-progress]')?.textContent.includes('Step 2 of 3 · About you'));
    assert.equal(await owner.$eval('input[placeholder="e.g. Ana Petrović"]', (el) => el.value), 'Olivia Onboarding');
    await owner.type('input[placeholder="e.g. Account executive"]', 'Head of sales');
    await click(owner, 'button[type=submit]');
    await owner.waitForFunction(() => document.querySelector('[data-testid=onboarding-progress]')?.textContent.includes('Step 3 of 3 · Invite your team'));
    const workspace = await api(owner, '/workspace');
    assert.equal(workspace.timezone, 'Asia/Tokyo');
  });

  step('inviting the team finishes onboarding and opens the app, with "Invite your team" done', async () => {
    await owner.type('input[aria-label="Email 1"]', colleague);
    await clickButton(owner, 'Send invitation');
    await owner.waitForSelector('[data-testid=new-menu]', { timeout: 15_000 });
    await owner.waitForSelector('[data-testid=getting-started] li[data-step=invite][data-done=true]');
    const team = await api(owner, '/team');
    assert.deepEqual(
      team.invitations.map((i) => i.email),
      [colleague],
    );
    assert.equal((await api(owner, '/profile')).jobTitle, 'Head of sales');
  });

  step('a returning user goes straight to the app', async () => {
    await owner.reload({ waitUntil: 'networkidle0' });
    await owner.waitForSelector('[data-testid=new-menu]');
    assert.equal(await owner.$('[data-testid=onboarding-progress]'), null);
  });

  step('an invited user who signs up without the link joins that workspace, with no team step', async () => {
    const invited = await browser.person('colin');
    await invited.goto(BASE_URL, { waitUntil: 'networkidle0' });
    await signIn(invited, colleague, 'Colin Colleague');
    await invited.waitForSelector('::-p-text(Join Onboarded Co)');
    assert.match(await text(invited), /Olivia Onboarding invited you as a member/);
    assert.match(await progress(invited), /Step 1 of 2 · Workspace/);
    await clickButton(invited, 'Accept and join');
    await invited.waitForFunction(() => document.querySelector('[data-testid=onboarding-progress]')?.textContent.includes('Step 2 of 2 · About you'));
    await click(invited, 'button[type=submit]');
    await invited.waitForSelector('[data-testid=new-menu]', { timeout: 15_000 });
    const me = await api(invited, '/me');
    assert.deepEqual(
      me.tenants.map((t) => t.name),
      ['Onboarded Co'],
    );
    assert.equal(me.onboarding.required, false);
  });
});
