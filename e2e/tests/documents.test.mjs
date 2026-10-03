// Document templates and generated documents (CD-13): download the starter template, upload it
// as a template in Settings, generate a proposal on a deal (the worker fills it in), see it listed
// and download it. Needs the worker running next to the API.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe } from 'node:test';
import { inflateRawSync } from 'node:zlib';
import { api, BASE_URL, click, clickButton, createDealInUi, eventually, newUserWithWorkspace, RUN, setValue, steps, text, useBrowser } from '../lib/harness.mjs';

const dir = mkdtempSync(join(tmpdir(), 'pultly-e2e-docs-'));
after(() => rmSync(dir, { recursive: true, force: true }));

/** One file out of a .docx (a zip), read through its central directory. */
function zipEntry(buf, wanted) {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  assert.ok(eocd >= 0, 'a zip file');
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < buf.readUInt16LE(eocd + 10); i++) {
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    const local = buf.readUInt32LE(p + 42);
    if (name === wanted) {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + size);
      return (method === 8 ? inflateRawSync(data) : data).toString('utf8');
    }
    p += 46 + nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  throw new Error(`${wanted} not in the zip`);
}
const docxText = (buf) => [...zipEntry(buf, 'word/document.xml').matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join(' ');

/** Waits for a new file in `folder` whose name matches, and returns its path. */
async function downloaded(folder, pattern) {
  const name = await eventually(() => existsSync(folder) && readdirSync(folder).find((f) => pattern.test(f) && !f.endsWith('.crdownload')), { timeout: 10_000 });
  assert.ok(name, `a file matching ${pattern} was downloaded`);
  return join(folder, name);
}

describe('document templates and generated documents', () => {
  const browser = useBrowser();
  const step = steps(browser, 'documents');
  let page;
  let starter;
  const company = `Docs d.o.o. ${RUN}`;
  const downloads = join(dir, 'downloads');

  step('sets up a workspace and allows downloads', async () => {
    page = await browser.person('dora');
    await newUserWithWorkspace(page, { label: 'docs', name: 'Dora Documents', workspace: 'Docs Studio' });
    const cdp = await page.createCDPSession();
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads, browserContextId: page.browserContext().id });
  });

  step('downloads the starter template from the merge field reference', async () => {
    await page.goto(BASE_URL + '/settings/templates', { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.body.innerText.includes('{{deal.amount}}'));
    await clickButton(page, 'Download starter template');
    starter = await downloaded(downloads, /starter template\.docx$/);
    assert.match(docxText(readFileSync(starter)), /\{\{deal\.headline\}\}/);
  });

  step('uploads it as a template: the dialog lists its merge fields first', async () => {
    await clickButton(page, 'New template');
    const input = await page.waitForSelector('.modal input[type=file]');
    await input.uploadFile(starter);
    await page.waitForFunction(() => /parameters found/i.test(document.querySelector('.modal')?.innerText ?? ''));
    const modal = await page.$eval('.modal', (el) => el.innerText);
    assert.match(modal, /\{\{deal\.headline\}\} → Proposal headline/);
    assert.ok(!modal.includes('not recognised'), 'every field of the starter is known');
    await setValue(page, '.modal input[placeholder^="e.g. Proposal"]', 'E2E proposal');
    await clickButton(page, 'Save template');
    await page.waitForSelector('[data-template="E2E proposal"]');
    const templates = await api(page, '/crm/document-templates');
    assert.deepEqual(templates.map((t) => t.name), ['E2E proposal']);
  });

  step('generates a proposal on a deal and lists it when the worker is done', async () => {
    await page.goto(BASE_URL + '/pipeline', { waitUntil: 'networkidle0' });
    await createDealInUi(page, { company, contact: 'Petra Proposal' });
    await click(page, 'button.composer-tab::-p-text(Documents)');
    await page.waitForSelector('select[aria-label="Document template"]');
    await clickButton(page, 'Generate document');
    const doc = await page.waitForSelector(`[data-doc="E2E proposal — ${company}"]`);
    await page.waitForFunction((el) => el.innerText.toLowerCase().includes('ready') && el.innerText.includes('Download .docx'), { timeout: 15_000 }, doc);
    const meta = await doc.evaluate((el) => el.innerText);
    assert.match(meta, /E2E proposal · Dora Documents/);
    // The worker writes a timeline entry.
    await page.waitForFunction(() => document.body.innerText.includes('Document generated'), { timeout: 10_000 });
  });

  step('downloads the generated document with the deal filled in', async () => {
    await click(page, `[data-doc="E2E proposal — ${company}"] button::-p-text(Download .docx)`);
    const file = await downloaded(downloads, /^E2E proposal — .*\.docx$/);
    const body = docxText(readFileSync(file));
    assert.match(body, new RegExp(`Prepared for Petra Proposal, +at ${company.replace(/[.]/g, '\\.')}`));
    assert.ok(body.includes('Dora Documents'), 'the owner');
    assert.ok(!body.includes('{{'), 'no merge field left');
    assert.match(await text(page), /Left empty:/);
  });

  step('throws no uncaught errors in the page', async () => {
    assert.deepEqual(browser.errors, []);
  });
});
