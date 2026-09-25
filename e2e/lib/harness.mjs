// Shared helpers for the browser tests: one Chrome per test file, one browser context per person.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, it } from 'node:test';
import puppeteer from 'puppeteer';

/** Where the UI runs (Vite dev server or preview, proxying /api to the API). */
export const BASE_URL = (process.env.E2E_BASE_URL || 'http://localhost:5173').replace(/\/$/, '');
const HEADLESS = process.env.E2E_HEADLESS !== 'false';
const SLOW_MO = Number(process.env.E2E_SLOW_MO) || 0;
const NO_SANDBOX = process.env.E2E_NO_SANDBOX === '1' || !!process.env.CI;
const ARTIFACTS = process.env.E2E_ARTIFACTS_DIR || join(import.meta.dirname, '..', 'artifacts');
const TIMEOUT = Number(process.env.E2E_TIMEOUT) || 10_000;
const STEP_TIMEOUT = 90_000;

/** Unique per run so tests can share a database with other runs and with people using it. */
export const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
export const email = (label) => `${label}-${RUN}@example.test`;

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Sets up a browser for the current test file and returns a `person()` factory.
 * Each person gets an isolated browser context (own localStorage), like a private window.
 */
export function useBrowser() {
  const state = { browser: null, pages: [], errors: [] };

  before(
    async () => {
      state.browser = await puppeteer.launch({
        headless: HEADLESS,
        slowMo: SLOW_MO,
        args: ['--window-size=1400,1100', ...(NO_SANDBOX ? ['--no-sandbox', '--disable-setuid-sandbox'] : [])],
      });
    },
    { timeout: 60_000 },
  );

  after(
    async () => {
      const browser = state.browser;
      if (!browser) return;
      await Promise.race([browser.close(), sleep(10_000)]);
      if (browser.connected) browser.process()?.kill('SIGKILL');
    },
    { timeout: 30_000 },
  );

  return {
    /** Opens a new isolated browser context (a person) with one page. */
    async person(name) {
      const ctx = await state.browser.createBrowserContext();
      const page = await ctx.newPage();
      await page.setViewport({ width: 1400, height: 1100 });
      page.setDefaultTimeout(TIMEOUT);
      page.on('pageerror', (e) => state.errors.push(`${name}: ${e.message}`));
      page.on('dialog', (d) => void d.accept());
      state.pages.push({ name, page });
      return page;
    },
    /** Uncaught errors thrown in any page so far. */
    get errors() {
      return state.errors;
    },
    /** Saves a full-page screenshot of every open page (called when a step fails). */
    async screenshots(label) {
      mkdirSync(ARTIFACTS, { recursive: true });
      for (const { name, page } of state.pages) {
        const file = join(ARTIFACTS, `${label}-${name}.png`.replace(/[^\w.-]+/g, '_'));
        // Best effort: a page stuck mid-navigation must not hang the run.
        await Promise.race([page.screenshot({ path: file, fullPage: true }).catch(() => {}), sleep(10_000)]);
      }
    },
  };
}

/**
 * Sequential steps that share state (a user journey). After the first failure, a screenshot is
 * saved and the remaining steps are skipped instead of failing for the same reason.
 */
export function steps(browser, suite) {
  let failed = null;
  return (name, fn) =>
    it(name, { timeout: STEP_TIMEOUT }, async (t) => {
      if (failed) return t.skip(`skipped: "${failed}" failed`);
      try {
        await fn();
      } catch (err) {
        failed = name;
        await browser.screenshots(`${suite}-${name}`);
        throw err;
      }
    });
}

// ------------------------------------------------------------------ page helpers

export const text = (page) => page.evaluate(() => document.body.innerText);

/** Clicks the first element matching a CSS/Puppeteer selector once it is there. */
export async function click(page, selector) {
  const el = await page.waitForSelector(selector);
  await el.click();
}

/** Clicks a <button> by its text content (not innerText, since some labels are CSS-uppercased). */
export const clickButton = (page, label) => click(page, `button::-p-text(${label})`);

/** Waits until the toast (bottom of the screen, ~2.6 s) is gone, since it can cover buttons. */
export async function waitForToastToClear(page) {
  await page.waitForFunction(() => !document.querySelector('.toast'), { timeout: 6_000 });
}

/** Sets a React-controlled input/select/textarea: native value setter + input and change events. */
export function setValue(page, selector, value) {
  return page.$eval(
    selector,
    (el, value) => {
      const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    },
    value,
  );
}

/**
 * Sets the input/select that sits next to a label (a <span> with exactly `label` as its text, or
 * the icon of a deal summary row named `label`). Returns false if there is no such field.
 */
export function setByLabel(page, label, value, tag = 'input') {
  return page.evaluate(
    (label, value, tag) => {
      const row = [...document.querySelectorAll('.icon-row')].find((el) => el.dataset.label === label);
      const span = row ? null : [...document.querySelectorAll('span')].find((el) => el.textContent.trim() === label);
      const el = (row ?? span?.parentElement)?.querySelector(tag);
      if (!el) return false;
      const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    },
    label,
    value,
    tag,
  );
}

/** Calls the API from inside the page, with the page's own session and workspace. */
export function api(page, path, init = {}) {
  return page.evaluate(
    async (path, init) => {
      const headers = {
        Authorization: 'Bearer ' + localStorage.getItem('crm.devToken'),
        'X-Tenant-Id': localStorage.getItem('crm.tenantId') ?? '',
        'Content-Type': 'application/json',
      };
      const res = await fetch('/api' + path, { ...init, headers });
      if (!res.ok) throw new Error(`${init.method ?? 'GET'} /api${path} → ${res.status} ${await res.text()}`);
      return res.status === 204 ? null : res.json();
    },
    path,
    init,
  );
}

/** Polls `fn` until it returns a truthy value (for saves that are debounced or asynchronous). */
export async function eventually(fn, { timeout = 8_000, interval = 200 } = {}) {
  const deadline = Date.now() + timeout;
  let last;
  for (;;) {
    last = await fn();
    if (last) return last;
    if (Date.now() > deadline) return last;
    await sleep(interval);
  }
}

// ------------------------------------------------------------------ flows

/** Dev sign-in: any email, no password. Expects the sign-in form to be on screen. */
export async function signIn(page, address, name) {
  await page.waitForSelector('input[type=email]');
  await page.type('input[type=email]', address);
  if (name) await page.type('input[placeholder="Your name"]', name);
  await click(page, 'button[type=submit]');
}

/** Creates the first workspace of a newly signed-in user and waits for the pipeline. */
export async function createWorkspace(page, name, currency) {
  await page.waitForSelector('input[placeholder="e.g. Cadence Studio"]');
  await page.type('input[placeholder="e.g. Cadence Studio"]', name);
  if (currency) await setValue(page, 'select[aria-label="Main currency"]', currency);
  await click(page, 'button[type=submit]');
  await page.waitForSelector('button::-p-text(New deal)');
}

/** Opens the app, signs in as a new user and creates a workspace. */
export async function newUserWithWorkspace(page, { label, name, workspace, currency }) {
  await page.goto(BASE_URL, { waitUntil: 'networkidle0' });
  await signIn(page, email(label), name);
  await createWorkspace(page, workspace, currency);
}

/** "New deal" on the pipeline with a new company and contact; returns the new deal id. */
export async function createDealInUi(page, { company, contact }) {
  await clickButton(page, 'New deal');
  await page.waitForSelector('input[placeholder="Company name"]');
  await page.type('input[placeholder="Company name"]', company);
  await page.type('input[placeholder="Full name"]', contact);
  await clickButton(page, 'Create & start funnel');
  await page.waitForFunction(() => location.pathname.startsWith('/deals/'));
  return page.url().split('/deals/')[1];
}

/** Sets the deal's closing date on the lead screen (a React-controlled date input). */
export const setClosingDate = (page, isoDate) => setValue(page, 'input[type=date]', isoDate);
