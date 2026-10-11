// Approvals (CD-157): a manager sees their report's submitted week on Workforce → Approvals,
// approves it from the list (confirmation first), and on another person's week rejects it with a
// required comment; the employee then sees the comment on the rejected day.
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { api, BASE_URL, click, clickButton, email, eventually, finishOnboarding, newUserWithWorkspace, signIn, steps, useBrowser } from '../lib/harness.mjs';

const addDays = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

describe('approvals', () => {
  const browser = useBrowser();
  const step = steps(browser, 'approvals');
  let manager;
  const people = {};
  let monday;

  /** Invites `label`, who joins, becomes the manager's report and submits a week of hours. */
  async function report(label, name) {
    const { token } = await api(manager, '/team/invitations', { method: 'POST', body: JSON.stringify({ email: email(label), role: 'member' }) });
    const page = await browser.person(label);
    await page.goto(`${BASE_URL}/invite/${token}`, { waitUntil: 'networkidle0' });
    await signIn(page, email(label), name);
    await clickButton(page, 'Accept and join');
    await finishOnboarding(page);
    const me = (await api(page, '/people/access')).employeeId;
    const boss = (await api(manager, '/people/access')).employeeId;
    await api(manager, `/people/employees/${me}`, { method: 'PATCH', body: JSON.stringify({ managerId: boss }) });
    const company = await api(manager, '/crm/companies', { method: 'POST', body: JSON.stringify({ name: `Client of ${name}` }) });
    const [type] = await api(manager, '/project-types');
    const project = await api(manager, '/projects', { method: 'POST', body: JSON.stringify({ name: `Project of ${name}`, projectTypeId: type.id, companyId: company.id }) });
    const task = await api(manager, '/tasks', { method: 'POST', body: JSON.stringify({ projectId: project.id, name: 'Inspect engine', assigneeIds: [me] }) });
    monday = (await api(page, '/timesheet/week')).thisWeek;
    for (let i = 0; i < 5; i++) await api(page, '/timesheet/cells', { method: 'PUT', body: JSON.stringify({ date: addDays(monday, i), taskId: task.id, minutes: 480, ...(i === 2 ? { note: 'Customer signed 5 h' } : {}) }) });
    await api(page, '/timesheet/submit', { method: 'POST', body: JSON.stringify({ weekStart: monday }) });
    people[label] = { page, id: me, name };
  }

  step('a manager with two reports who submitted this week', async () => {
    manager = await browser.person('ap-manager');
    await newUserWithWorkspace(manager, { label: 'ap-manager', name: 'Marko Ilić', workspace: 'Approvals Co' });
    await report('ap-dragan', 'Dragan Milić');
    await report('ap-bojan', 'Bojan Đurić');
  });

  step('Approvals lists both as Submitted with five blue squares; Approve week approves Dragan after a confirmation', async () => {
    await manager.goto(`${BASE_URL}/approvals?week=${monday}`, { waitUntil: 'networkidle0' });
    await manager.waitForSelector('[data-testid=ap-row]');
    const rows = await manager.$$eval('[data-testid=ap-row]', (els) => els.map((el) => ({ status: el.dataset.status, text: el.textContent })));
    assert.equal(rows.length, 2);
    assert.ok(rows.every((r) => r.status === 'submitted'), JSON.stringify(rows));
    assert.ok(await manager.$('[data-testid=ap-all-good]'), 'everyone submitted on time');
    const dragan = `[data-testid=ap-row][data-employee="${people['ap-dragan'].id}"]`;
    assert.equal(await manager.$eval(`${dragan} [data-testid=ap-squares]`, (el) => el.querySelectorAll('[data-status=submitted]').length), 5);
    await click(manager, `${dragan} [data-testid=ap-approve]`);
    await manager.waitForSelector('[data-testid=confirm-dialog]');
    assert.match(await manager.$eval('[data-testid=confirm-dialog]', (el) => el.textContent), /Approve week \d+ for Dragan Milić\?5 days · 40 h entered/);
    await click(manager, '[data-testid=confirm-ok]');
    await manager.waitForFunction((sel) => document.querySelector(sel)?.dataset.status === 'approved', {}, dragan);
    assert.equal(await manager.$eval(`${dragan} [data-testid=ap-squares]`, (el) => el.querySelectorAll('[data-status=approved]').length), 5);
    assert.equal(await manager.$(`${dragan} [data-testid=ap-approve]`), null);
  });

  step("Bojan's week: every entry with its project, task, hours and note; Reject week needs a comment", async () => {
    await manager.goto(`${BASE_URL}/approvals/${people['ap-bojan'].id}?week=${monday}`, { waitUntil: 'networkidle0' });
    await manager.waitForSelector('[data-testid=ap-day]');
    assert.equal((await manager.$$('[data-testid=ap-day]')).length, 5);
    assert.match(await manager.$eval('[data-testid=ap-week-summary]', (el) => el.textContent), /^40 h entered · 5 days waiting for you$/);
    const wednesday = await manager.$eval(`[data-testid=ap-day][data-date="${addDays(monday, 2)}"]`, (el) => el.textContent);
    assert.match(wednesday, /Client of Bojan Đurić › Project of Bojan Đurić/);
    assert.match(wednesday, /T-\d+ Inspect engine/);
    assert.match(wednesday, /Customer signed 5 h/);
    await click(manager, '[data-testid=ap-reject-week]');
    await manager.waitForSelector('[data-testid=ap-reject-comment]');
    await click(manager, '[data-testid=ap-reject-confirm]');
    assert.match(await manager.$eval('.modal', (el) => el.textContent), /Enter a comment/);
    await manager.type('[data-testid=ap-reject-comment]', 'The Agrokop inspection is missing.');
    await click(manager, '[data-testid=ap-reject-confirm]');
    await manager.waitForFunction(() => document.querySelector('[data-testid=ap-week-status]')?.textContent === 'Rejected (5 days)');
    assert.match(await manager.$eval('[data-testid=ap-day-comment]', (el) => el.textContent), /Rejected by Marko Ilić · .*: The Agrokop inspection is missing\./);
  });

  step('Bojan sees the rejected week and can edit again; the list shows him under Rejected', async () => {
    const week = await eventually(async () => {
      const w = await api(people['ap-bojan'].page, `/timesheet/week?week=${monday}`);
      return w.status === 'rejected' && w;
    });
    assert.equal(week.days[0].comment, 'The Agrokop inspection is missing.');
    assert.equal(week.days[0].returnedBy, 'Marko Ilić');
    assert.ok(week.days[0].editable);
    await manager.goto(`${BASE_URL}/approvals?week=${monday}`, { waitUntil: 'networkidle0' });
    await manager.waitForSelector('[data-testid=ap-returned]');
    assert.match(await manager.$eval('[data-testid=ap-returned]', (el) => el.textContent), /Bojan Đurić · 5 days/);
  });

  step('Bojan sees the comment on his timesheet and resubmits the rejected days with a reply (CD-158)', async () => {
    const bojan = people['ap-bojan'].page;
    await bojan.goto(`${BASE_URL}/timesheet?week=${monday}`, { waitUntil: 'networkidle0' });
    await bojan.waitForSelector('[data-testid=ts-rejected-note]');
    assert.equal((await bojan.$$('[data-testid=ts-rejected-note]')).length, 5);
    assert.match(await bojan.$eval('[data-testid=ts-rejected-note]', (el) => el.textContent), /was rejected by Marko Ilić · .*: The Agrokop inspection is missing\./);
    assert.equal(await bojan.$eval('[data-testid=ts-resubmit]', (el) => el.textContent), 'Resubmit rejected days (5)');
    await click(bojan, '[data-testid=ts-resubmit]');
    await bojan.waitForSelector('[data-testid=ts-resubmit-reply]');
    await bojan.type('[data-testid=ts-resubmit-reply]', 'Added the Agrokop inspection on Thursday.');
    await click(bojan, '[data-testid=ts-resubmit-confirm]');
    await bojan.waitForFunction(() => document.querySelector('[data-testid=ts-status]')?.textContent === 'Submitted');
    assert.equal(await bojan.$('[data-testid=ts-rejected-note]'), null);
  });

  step('the approver sees the days as Resubmitted with the reply', async () => {
    await manager.goto(`${BASE_URL}/approvals/${people['ap-bojan'].id}?week=${monday}`, { waitUntil: 'networkidle0' });
    await manager.waitForSelector('[data-testid=ap-day-resubmitted]');
    assert.equal((await manager.$$('[data-testid=ap-day-resubmitted]')).length, 5);
    assert.match(await manager.$eval('[data-testid=ap-day-resubmitted]', (el) => el.textContent), /Resubmitted · .* · was rejected by Marko Ilić: The Agrokop inspection is missing\. · reply: Added the Agrokop inspection on Thursday\./);
    assert.match(await manager.$eval('[data-testid=ap-week-summary]', (el) => el.textContent), /5 days waiting for you/);
  });
});
