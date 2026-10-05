// Calendar and meeting page fixes from testing (CD-212): dragging over empty slots on the week view
// draws a placeholder that can be resized, and the quick-create popover saves it; Escape discards
// one; a meeting's lower edge and the meeting itself are dragged right on the Calendar; a click on
// a day of the month opens the popover at 09:00; the meeting dialog offers only the meeting
// company's contacts; the meeting page edits the time in place.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { api, BASE_URL, click, eventually, newUserWithWorkspace, RUN, setValue, steps, useBrowser } from '../lib/harness.mjs';

const TZ = 'Europe/Belgrade'; // new workspaces use it
const HOUR = 48; // px per hour of the time grid

/** An ISO date `days` from today in the workspace time zone. */
function isoDay(days) {
  const d = new Date(Date.now() + days * 86_400_000);
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
/** "10:00" of an instant in the workspace time zone. */
const hm = (iso) => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));

describe('calendar quick create and in-place editing', () => {
  const browser = useBrowser();
  const step = steps(browser, 'calendar-quick-create');
  let page;
  let alpha;
  let beta;
  let deal;
  let meetingId;
  const TITLE = `Quick plan ${RUN}`;
  const DAY = isoDay(10); // a weekday or weekend in the future, with no other meetings

  /** The screen point of a minute of the day in DAY's column. */
  const at = (minutes) =>
    page.evaluate(
      (day, minutes, hour) => {
        const r = document.querySelector(`.cal-col[data-day="${day}"]`).getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + (minutes / 60) * hour };
      },
      DAY,
      minutes,
      HOUR,
    );
  /** Presses at a point, moves by (dx, dy) in small steps and lets go. */
  async function drag(from, dx, dy) {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 5 });
    await page.mouse.move(from.x + dx, from.y + dy, { steps: 5 });
    await page.mouse.up();
  }
  const centerOf = (selector) =>
    page.$eval(selector, (el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
  const draftTime = () => page.$eval('[data-testid=cal-draft-time]', (el) => el.textContent.trim());

  step('sets up two companies with a contact each, and a deal', async () => {
    page = await browser.person('quinn');
    await newUserWithWorkspace(page, { label: 'quick', name: 'Quinn Quick', workspace: 'Quick Co' });
    alpha = await api(page, '/crm/companies', { method: 'POST', body: JSON.stringify({ name: `Quick Alpha ${RUN}`, hq: 'Novi Sad' }) });
    beta = await api(page, '/crm/companies', { method: 'POST', body: JSON.stringify({ name: `Quick Beta ${RUN}` }) });
    await api(page, '/crm/contacts', { method: 'POST', body: JSON.stringify({ fullName: 'Ana Alpha', companyId: alpha.id }) });
    await api(page, '/crm/contacts', { method: 'POST', body: JSON.stringify({ fullName: 'Boris Beta', companyId: beta.id }) });
    const funnels = await api(page, '/crm/funnels');
    deal = await api(page, '/crm/deals', { method: 'POST', body: JSON.stringify({ title: 'Alpha rollout', funnelId: funnels[0].id, companyId: alpha.id }) });
  });

  step('dragging over empty slots draws a placeholder; its lower edge resizes it; the popover saves it', async () => {
    await page.goto(`${BASE_URL}/calendar?view=week&date=${DAY}`, { waitUntil: 'networkidle0' });
    await page.waitForSelector(`.cal-col[data-day="${DAY}"]`);
    // 10:00 to 11:30, in 15-minute steps.
    const from = await at(10 * 60 + 2);
    await drag(from, 0, 1.5 * HOUR - 2);
    await page.waitForSelector('[data-testid=quick-create]');
    assert.equal(await draftTime(), '10:00–11:30');
    assert.equal(await page.$eval('[data-testid=quick-start]', (el) => el.value), '10:00');
    assert.equal(await page.$eval('[data-testid=quick-end]', (el) => el.value), '11:30');

    // Its lower edge, half an hour down: 10:00–12:00; the popover follows.
    const edge = await centerOf('[data-testid=cal-draft-resize]');
    await drag(edge, 0, HOUR / 2);
    await page.waitForFunction(() => document.querySelector('[data-testid=cal-draft-time]')?.textContent.trim() === '10:00–12:00');
    assert.equal(await page.$eval('[data-testid=quick-end]', (el) => el.value), '12:00');
    assert.ok(await page.$('[data-testid=quick-create]'), 'still open');

    // The deal is required: saving without a company says so.
    await click(page, '[data-testid=quick-save]');
    await page.waitForSelector('[data-testid=quick-errors]');
    assert.match(await page.$eval('[data-testid=quick-errors]', (el) => el.innerText), /Pick the customer company/);

    await page.type('[data-testid=quick-title]', TITLE);
    await setValue(page, '[data-testid=quick-company]', alpha.id);
    await page.waitForFunction((id) => document.querySelector('[data-testid=quick-deal]')?.value === id, {}, deal.id);
    await click(page, '[data-testid=quick-save]');
    await page.waitForFunction(() => !document.querySelector('[data-testid=quick-create]'), { timeout: 10_000 });
    assert.equal(await page.$('[data-testid=cal-draft]'), null, 'the placeholder is gone');
    const saved = await eventually(async () => (await api(page, `/crm/meetings?dealId=${deal.id}`)).meetings.find((m) => m.title === TITLE));
    assert.ok(saved, 'the meeting was saved');
    meetingId = saved.id;
    assert.equal(hm(saved.startsAt), '10:00');
    assert.equal(hm(saved.endsAt), '12:00');
    assert.equal(saved.type, 'visit');
    assert.equal(saved.location, 'Novi Sad', 'a visit is at the HQ');
    await page.waitForSelector(`.cal-col[data-day="${DAY}"] .cal-block[data-meeting-id="${meetingId}"]`);
  });

  step('Escape, or a click outside, discards a meeting being made', async () => {
    const p = await at(15 * 60 + 5);
    await page.mouse.click(p.x, p.y);
    await page.waitForSelector('[data-testid=quick-create]');
    assert.equal(await draftTime(), '15:00–16:00', 'a click makes an hour from the half hour');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('[data-testid=quick-create]') && !document.querySelector('[data-testid=cal-draft]'));

    await page.mouse.click(p.x, p.y);
    await page.waitForSelector('[data-testid=quick-create]');
    await click(page, '[data-testid=cal-title]');
    await page.waitForFunction(() => !document.querySelector('[data-testid=quick-create]') && !document.querySelector('[data-testid=cal-draft]'));
    assert.equal((await api(page, `/crm/meetings?dealId=${deal.id}`)).meetings.length, 1, 'nothing saved');
  });

  step('a meeting is resized by its lower edge and moved by dragging, right on the Calendar', async () => {
    const block = `.cal-block[data-meeting-id="${meetingId}"]`;
    // Lower edge an hour down: 10:00–13:00.
    await drag(await centerOf(`${block} [data-testid=cal-resize]`), 0, HOUR);
    const resized = await eventually(async () => {
      const m = await api(page, `/crm/meetings/${meetingId}`);
      return hm(m.endsAt) === '13:00' && m;
    });
    assert.ok(resized, 'the new end was saved');
    assert.equal(hm(resized.startsAt), '10:00');
    // Moved an hour later, the length kept: 11:00–14:00.
    await page.waitForFunction((sel) => document.querySelector(sel)?.getBoundingClientRect().height > 2.5 * 48, {}, block);
    await drag(await centerOf(block), 0, HOUR);
    const moved = await eventually(async () => {
      const m = await api(page, `/crm/meetings/${meetingId}`);
      return hm(m.startsAt) === '11:00' && m;
    });
    assert.ok(moved, 'the new time was saved');
    assert.equal(hm(moved.endsAt), '14:00');
    // A click on the lower edge alone changes nothing and stays on the Calendar.
    await page.waitForFunction((sel) => !!document.querySelector(sel), {}, `${block} [data-testid=cal-resize]`);
    const edge = await centerOf(`${block} [data-testid=cal-resize]`);
    await page.mouse.click(edge.x, edge.y);
    assert.equal(new URL(page.url()).pathname, '/calendar');
  });

  step('a click on a day of the month opens the popover at 09:00', async () => {
    await page.goto(`${BASE_URL}/calendar?view=month&date=${DAY}`, { waitUntil: 'networkidle0' });
    const corner = await page.$eval(`.cal-cell[data-day="${DAY}"]`, (el) => {
      const r = el.getBoundingClientRect();
      return { x: r.right - 6, y: r.bottom - 6 };
    });
    await page.mouse.click(corner.x, corner.y);
    await page.waitForSelector('[data-testid=quick-create]');
    assert.equal(await page.$eval('[data-testid=quick-date]', (el) => el.value), DAY);
    assert.equal(await page.$eval('[data-testid=quick-start]', (el) => el.value), '09:00');
    assert.equal(await page.$eval('[data-testid=quick-end]', (el) => el.value), '10:00');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('[data-testid=quick-create]'));
  });

  step('the meeting dialog offers only the contacts of the meeting’s company', async () => {
    await click(page, '[data-testid=cal-new]');
    await page.waitForSelector('.modal [data-testid=meeting-form]');
    await page.waitForSelector('[data-testid=meeting-external-hint]');
    await setValue(page, '[data-testid=meeting-company]', alpha.id);
    await click(page, '.meeting-picker .picker-search');
    await page.waitForFunction(() => document.querySelector('.meeting-picker')?.innerText.includes('Ana Alpha'));
    const listed = await page.$eval('.meeting-picker', (el) => el.innerText);
    assert.ok(!listed.includes('Boris Beta'), `another company's contact is not offered: ${listed}`);
    assert.match(listed, /Add new contact at Quick Alpha/);
    await click(page, '.modal .modal-actions .btn-secondary');
    await page.waitForFunction(() => !document.querySelector('.modal [data-testid=meeting-form]'));
  });

  step('the meeting page changes the time in place; it is saved after a reload', async () => {
    await page.goto(`${BASE_URL}/meetings/${meetingId}`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-testid=meeting-field-start]');
    assert.equal(await page.$('[data-testid=meeting-edit]'), null);
    await setValue(page, '[data-testid=meeting-field-start]', '15:00');
    const saved = await eventually(async () => {
      const m = await api(page, `/crm/meetings/${meetingId}`);
      return hm(m.startsAt) === '15:00' && m;
    });
    assert.ok(saved, 'the new start was saved');
    assert.equal(hm(saved.endsAt), '18:00', 'the length is kept');
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.querySelector('[data-testid=meeting-field-start]')?.value === '15:00');
    assert.equal(await page.$eval('[data-testid=meeting-field-end]', (el) => el.value), '18:00');
    assert.match(await page.$eval('[data-testid=meeting-when]', (el) => el.innerText), /15:00–18:00/);
  });

  it('throws no uncaught errors in the page', () => {
    assert.deepEqual(browser.errors, []);
  });
});
