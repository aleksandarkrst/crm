// Calendar performance (spec 10.4, CD-211): a month with 500 meetings. They are seeded through the
// API in parallel batches; then the month is opened from the month before (the "›" arrow, inside the
// app) and the time from the click until the grid shows every meeting (three a day and "+N more")
// is measured in the page with performance.now(). The spec's target is under 1 s on a normal
// connection; CI shares a small machine between the database, the API, the UI and the browser, so
// the budget here is 3 s (BUDGET_MS) — a regression guard, not the product target.
// The Table view of the same month pages through them: 500 at a time, then "Load more".
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { api, BASE_URL, click, newUserWithWorkspace, RUN, steps, useBrowser } from '../lib/harness.mjs';

const COUNT = 500;
const BATCH = 25;
const BUDGET_MS = 3_000;

/** The first day of the month `offset` months from now (UTC), YYYY-MM-DD. */
function monthStart(offset) {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1)).toISOString().slice(0, 10);
}

describe('calendar performance', () => {
  const browser = useBrowser();
  const step = steps(browser, 'calendar-performance');
  let page;
  let companyId;
  // Far enough ahead that nothing else is there; 28 days fit every month.
  const MONTH = monthStart(14);
  const BEFORE = monthStart(13);
  /** Meeting `i`: one hour on day 1–28, between 07:00 and 14:00 UTC (the same day in Belgrade). */
  const meeting = (i, prefix = 'Load') => {
    const start = `${MONTH.slice(0, 8)}${String((i % 28) + 1).padStart(2, '0')}T${String(7 + (i % 8)).padStart(2, '0')}:00:00.000Z`;
    return { title: `${prefix} ${i} ${RUN}`, type: 'visit', startsAt: start, endsAt: new Date(Date.parse(start) + 3_600_000).toISOString(), companyId };
  };
  async function seed(from, to, prefix) {
    for (let i = from; i < to; i += BATCH) {
      const batch = [];
      for (let j = i; j < Math.min(i + BATCH, to); j++) batch.push(meeting(j, prefix));
      await page.evaluate(
        async (bodies) => {
          const headers = { Authorization: 'Bearer ' + localStorage.getItem('crm.devToken'), 'X-Tenant-Id': localStorage.getItem('crm.tenantId') ?? '', 'Content-Type': 'application/json' };
          const res = await Promise.all(bodies.map((body) => fetch('/api/crm/meetings', { method: 'POST', headers, body: JSON.stringify(body) })));
          const bad = res.find((r) => !r.ok);
          if (bad) throw new Error(`POST /api/crm/meetings → ${bad.status} ${await bad.text()}`);
        },
        batch,
      );
    }
  }

  step(`seeds ${COUNT} meetings in one month through the API`, async () => {
    page = await browser.person('perf');
    await newUserWithWorkspace(page, { label: 'calendar-perf', name: 'Pia Performance', workspace: 'Busy Co' });
    companyId = (await api(page, '/crm/companies', { method: 'POST', body: JSON.stringify({ name: `Busy Customer ${RUN}` }) })).id;
    await seed(0, COUNT, 'Load');
    const { meetings, more } = await api(page, `/crm/meetings?companyId=${companyId}&limit=1000`);
    assert.equal(meetings.length, COUNT);
    assert.equal(more, false);
  });

  step(`the month view shows them all within ${BUDGET_MS} ms`, async () => {
    await page.goto(`${BASE_URL}/calendar?view=month&date=${BEFORE}`, { waitUntil: 'networkidle0' });
    // The grid of the month before also shows the first days of this month, so it is not empty: wait for it to finish loading.
    await page.waitForFunction(() => /^\d+ meetings?/.test(document.querySelector('.cal-meta')?.textContent ?? ''), { timeout: 15_000 });

    await page.evaluate(() => {
      window.__perfStart = performance.now();
      document.querySelector('[data-testid=cal-next]').click();
    });
    await page.waitForFunction(
      (count) => {
        if (document.querySelector('.cal-meta')?.textContent !== `${count} meetings`) return false;
        const grid = document.querySelector('[data-testid=month-grid]');
        if (!grid || !grid.querySelector('.cal-more')) return false;
        window.__perfEnd ??= performance.now();
        return true;
      },
      { timeout: 30_000, polling: 'raf' },
      COUNT,
    );
    const elapsed = await page.evaluate(() => window.__perfEnd - window.__perfStart);
    console.log(`month view with ${COUNT} meetings: data loaded and grid rendered in ${Math.round(elapsed)} ms (budget ${BUDGET_MS} ms)`);

    // Every meeting is on the grid: three chips a day, the rest in "+N more".
    const shown = await page.$$eval('[data-testid=month-grid] .cal-cell:not(.other) [data-meeting-id]', (els) => els.length);
    const hidden = await page.$$eval('[data-testid=month-grid] .cal-more', (els) => els.reduce((n, el) => n + Number(el.textContent.match(/\+(\d+)/)?.[1] ?? 0), 0));
    assert.equal(shown, 28 * 3);
    assert.equal(shown + hidden, COUNT);
    assert.ok(elapsed < BUDGET_MS, `the month rendered in ${Math.round(elapsed)} ms, over the ${BUDGET_MS} ms budget`);
  });

  step('the table pages through a long list with "Load more"', async () => {
    await seed(COUNT, COUNT + 20, 'Extra');
    const to = `${MONTH.slice(0, 8)}28`;
    await page.goto(`${BASE_URL}/calendar?view=table&from=${MONTH}&to=${to}&company=${companyId}`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=meeting-table] .table-row').length === 500, { timeout: 15_000 });
    await click(page, '[data-testid=meeting-table-more]');
    await page.waitForFunction((n) => document.querySelectorAll('[data-testid=meeting-table] .table-row').length === n, { timeout: 15_000 }, COUNT + 20);
    assert.equal(await page.$('[data-testid=meeting-table-more]'), null, 'nothing more to load');
  });
});
