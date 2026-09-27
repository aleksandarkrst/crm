/**
 * Document templates and generated documents (CD-13): upload limits and roles, generation by the
 * worker with the deal's values, downloads behind auth and tenant isolation, and files removed
 * with their template, document or deal.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { buildDocx, docxText, MAX_TEMPLATE_BYTES, starterTemplate } from '../../src/modules/crm/documents/docx';
import { DEFAULT_MIGRATION_DATABASE_URL } from './env';
import { addMember, call, createTenant, firstFunnel, ok, productLine, saveProducts, type Session, signIn } from './helpers';

let owner: Session;
let admin: Session;
let member: Session;
let outsider: Session;
let tenant: string;
let otherTenant: string;
let funnelId: string;

interface Template {
  id: string;
  name: string;
  docType: string;
  fileName: string;
  placeholders: { tag: string; known: boolean; label: string | null }[];
}
interface Doc {
  id: string;
  dealId: string;
  templateId: string | null;
  templateName: string;
  name: string;
  status: 'queued' | 'running' | 'ready' | 'failed';
  error: string | null;
  missingFields: string[];
  createdByName: string | null;
}

/** Multipart or binary calls, which helpers.call (JSON only) doesn't do. */
async function raw(method: string, path: string, opts: { token?: string; tenant?: string; form?: FormData } = {}) {
  const headers: Record<string, string> = {};
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.tenant) headers['x-tenant-id'] = opts.tenant;
  const res = await fetch(`${inject('apiUrl')}/api${path}`, { method, headers, body: opts.form });
  const bytes = Buffer.from(await res.arrayBuffer());
  let json: unknown = null;
  try {
    json = JSON.parse(bytes.toString('utf8'));
  } catch {
    // binary
  }
  return { status: res.status, bytes, json: json as Record<string, unknown> | null, headers: res.headers };
}

function form(file: Buffer | null, fileName = 'proposal.docx', fields: Record<string, string> = { name: 'Proposal v1', docType: 'Proposal' }) {
  const f = new FormData();
  if (file) f.append('file', new Blob([new Uint8Array(file)]), fileName);
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  return f;
}

async function upload(s: Session, t: string, file: Buffer = starterTemplate(), name = 'Proposal v1'): Promise<Template> {
  const res = await raw('POST', '/crm/document-templates', { token: s.token, tenant: t, form: form(file, 'proposal.docx', { name, docType: 'Proposal' }) });
  expect(res.status, JSON.stringify(res.json)).toBe(201);
  return res.json as unknown as Template;
}

async function waitForDocument(s: Session, t: string, id: string): Promise<Doc> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    const doc = await ok<Doc>('GET', `/crm/deal-documents/${id}`, { token: s.token, tenant: t });
    if (doc.status === 'ready' || doc.status === 'failed') return doc;
    if (Date.now() > deadline) throw new Error(`Document ${id} still ${doc.status}; is the worker running?`);
    await new Promise((r) => setTimeout(r, 150));
  }
}

const storagePath = (t: string, key: string) => {
  const dir = inject('storageDir');
  return dir ? join(dir, t, key) : '';
};
/** Checks a file on disk, when the tests know where the API keeps files. */
const expectFile = (t: string, key: string, present: boolean) => {
  const path = storagePath(t, key);
  if (path) expect(existsSync(path), path).toBe(present);
};

async function newDeal(s: Session, t: string, fId: string, extra: Record<string, unknown> = {}) {
  return ok<{ id: string }>('POST', '/crm/deals', { token: s.token, tenant: t, body: { title: 'Brand refresh', funnelId: fId, ...extra } });
}

beforeAll(async () => {
  [owner, admin, member, outsider] = await Promise.all([signIn('docs-owner'), signIn('docs-admin'), signIn('docs-member'), signIn('docs-outsider')]);
  tenant = await createTenant(owner, 'Documents');
  otherTenant = await createTenant(outsider, 'Other Documents');
  await addMember(owner, tenant, admin, 'admin');
  await addMember(owner, tenant, member, 'member');
  funnelId = (await firstFunnel(owner, tenant)).id;
});

describe('templates: roles and limits', () => {
  it('owners and admins upload; members get 403 but can list and read the reference', async () => {
    const byOwner = await upload(owner, tenant, starterTemplate(), 'Owner template');
    expect(byOwner).toMatchObject({ name: 'Owner template', docType: 'Proposal', fileName: 'proposal.docx' });
    expect(byOwner.placeholders.every((p) => p.known)).toBe(true);
    expect(byOwner.placeholders.map((p) => p.tag)).toEqual(expect.arrayContaining(['deal.headline', 'lines', 'line.total']));
    expectFile(tenant, `templates/${byOwner.id}.docx`, true);
    await upload(admin, tenant, starterTemplate(), 'Admin template');

    expect((await raw('POST', '/crm/document-templates', { token: member.token, tenant, form: form(starterTemplate()) })).status).toBe(403);
    expect((await raw('POST', '/crm/document-templates/scan', { token: member.token, tenant, form: form(starterTemplate()) })).status).toBe(403);

    const list = await ok<Template[]>('GET', '/crm/document-templates', { token: member.token, tenant });
    expect(list.map((t) => t.name)).toEqual(expect.arrayContaining(['Owner template', 'Admin template']));
    const ref = await ok<{ fields: { tag: string }[]; lineFields: { tag: string }[] }>('GET', '/crm/document-templates/placeholders', { token: member.token, tenant });
    expect(ref.fields.map((f) => f.tag)).toContain('deal.amount');
    expect(ref.lineFields.map((f) => f.tag)).toContain('line.product');
  });

  it('scan lists fields, known or not, and saves nothing', async () => {
    const before = await ok<Template[]>('GET', '/crm/document-templates', { token: owner.token, tenant });
    const res = await raw('POST', '/crm/document-templates/scan', { token: owner.token, tenant, form: form(buildDocx([{ text: 'Hi {{company}} {{deal.amoutn}}' }])) });
    expect(res.status).toBe(200);
    expect(res.json!.placeholders).toEqual([
      { tag: 'company', known: true, label: 'Company name' },
      { tag: 'deal.amoutn', known: false, label: null },
    ]);
    expect(await ok<Template[]>('GET', '/crm/document-templates', { token: owner.token, tenant })).toHaveLength(before.length);
  });

  it('refuses other file types, broken files and templates, too-large files, and a missing file or name', async () => {
    const post = (f: FormData) => raw('POST', '/crm/document-templates', { token: owner.token, tenant, form: f });
    const pdf = await post(form(starterTemplate(), 'proposal.pdf'));
    expect(pdf.status).toBe(400);
    expect(pdf.json!.message).toMatch(/\.docx/);
    const notZip = await post(form(Buffer.from('%PDF-1.7 pretending'), 'fake.docx'));
    expect(notZip.status).toBe(400);
    expect(notZip.json!.message).toMatch(/not a Word document/);
    const broken = await post(form(buildDocx([{ text: '{{#lines}} never closed' }])));
    expect(broken.status).toBe(400);
    expect(broken.json!.message).toMatch(/merge field error/);
    expect((await post(form(Buffer.alloc(MAX_TEMPLATE_BYTES + 1, 1)))).status).toBe(413);
    expect((await post(form(null))).status).toBe(400);
    expect((await post(form(starterTemplate(), 'proposal.docx', { name: ' ', docType: 'Proposal' }))).status).toBe(400);
    expect((await post(form(starterTemplate(), 'proposal.docx', { name: 'X', docType: 'Poem' }))).status).toBe(400);
  });

  it('serves the starter template and uploaded templates as .docx downloads', async () => {
    const starter = await raw('GET', '/crm/document-templates/starter', { token: member.token, tenant });
    expect(starter.status).toBe(200);
    expect(starter.headers.get('content-type')).toContain('wordprocessingml');
    expect(docxText(starter.bytes)).toContain('{{deal.total}}');
    const [tpl] = await ok<Template[]>('GET', '/crm/document-templates', { token: member.token, tenant });
    const file = await raw('GET', `/crm/document-templates/${tpl!.id}/file`, { token: member.token, tenant });
    expect(file.status).toBe(200);
    expect(file.headers.get('content-disposition')).toMatch(/attachment; filename=".*\.docx"/);
  });
});

describe('generating a document', () => {
  let template: Template;
  let dealId: string;
  let doc: Doc;

  beforeAll(async () => {
    template = await upload(owner, tenant, starterTemplate(), 'Proposal — generation');
    const company = await ok<{ id: string }>('POST', '/crm/companies', { token: owner.token, tenant, body: { name: 'Acme d.o.o.' } });
    const contact = await ok<{ id: string }>('POST', '/crm/contacts', { token: owner.token, tenant, body: { fullName: 'Ivana Radić', jobTitle: 'CMO', companyId: company.id } });
    const deal = await newDeal(owner, tenant, funnelId, {
      companyId: company.id,
      primaryContactId: contact.id,
      currency: 'USD',
      headline: 'A brand that travels',
      need: 'a brand that works in three markets.',
      decisionMaker: 'the board',
      discoveryDate: '2026-09-05',
    });
    dealId = deal.id;
    const product = await ok<{ id: string }>('POST', '/crm/products', { token: owner.token, tenant, body: { name: 'Brand strategy', unitPrice: 1500.5 } });
    await saveProducts(owner, tenant, dealId, [productLine(product.id, { quantity: 2, unitPrice: 1500.5, vatRate: 20 })]);
  });

  it('a member generates it; the worker fills in the deal, in the deal currency', async () => {
    const queued = await ok<Doc>('POST', `/crm/deals/${dealId}/documents`, { token: member.token, tenant, body: { templateId: template.id } }, 202);
    expect(queued).toMatchObject({ status: 'queued', templateId: template.id, templateName: 'Proposal — generation', name: 'Proposal — generation — Acme d.o.o.' });
    doc = await waitForDocument(member, tenant, queued.id);
    expect(doc.status, doc.error ?? '').toBe('ready');
    expect(doc.createdByName).toBe(member.name);
    // The starter uses these, and the deal has no value for them.
    expect(doc.missingFields).toEqual(['Constraint']);

    const file = await raw('GET', `/crm/deal-documents/${doc.id}/file`, { token: member.token, tenant });
    expect(file.status).toBe(200);
    expect(file.headers.get('content-disposition')).toContain("filename*=UTF-8''Proposal%20%E2%80%94%20generation%20%E2%80%94%20Acme%20d.o.o..docx");
    const text = docxText(file.bytes);
    expect(text).toContain('A brand that travels');
    expect(text).toContain('Prepared for Ivana Radić, CMO at Acme d.o.o.');
    expect(text).toContain('In our discovery call on 5 September 2026 you described a brand that works in three markets.');
    expect(text).toContain('US$1,500.50'); // unit price, USD deal in a EUR workspace
    expect(text).toContain('Total incl. VAT: US$3,601.20');
    expect(text).toContain(`Reply to ${owner.name}`);
    expect(text).not.toMatch(/\{\{|null|undefined/);
    expectFile(tenant, `documents/${doc.id}.docx`, true);
  });

  it('lists it on the deal and writes a timeline entry', async () => {
    const docs = await ok<Doc[]>('GET', `/crm/deal-documents?dealId=${dealId}`, { token: owner.token, tenant });
    expect(docs.map((d) => d.id)).toEqual([doc.id]);
    const activities = await ok<{ title: string; detail: string | null }[]>('GET', `/crm/deals/${dealId}/activities`, { token: owner.token, tenant });
    expect(activities[0]).toMatchObject({ title: 'Document generated · Proposal — generation — Acme d.o.o.' });
    expect(activities[0]!.detail).toContain(`by ${member.name}`);
    expect(activities[0]!.detail).toContain('Left empty: Constraint.');
  });

  it('keeps unknown fields as written', async () => {
    const typo = await upload(owner, tenant, buildDocx([{ text: 'Dear {{contact.frist_name}}, total {{total}}' }]), 'Typo');
    const queued = await ok<Doc>('POST', `/crm/deals/${dealId}/documents`, { token: owner.token, tenant, body: { templateId: typo.id, name: 'Letter' } }, 202);
    const done = await waitForDocument(owner, tenant, queued.id);
    const file = await raw('GET', `/crm/deal-documents/${done.id}/file`, { token: owner.token, tenant });
    expect(docxText(file.bytes)).toBe('Dear {{contact.frist_name}}, total US$3,601.20');
  });

  it('refuses unknown deals and templates', async () => {
    expect((await call('POST', `/crm/deals/00000000-0000-4000-8000-000000000000/documents`, { token: owner.token, tenant, body: { templateId: template.id } })).status).toBe(404);
    expect((await call('POST', `/crm/deals/${dealId}/documents`, { token: owner.token, tenant, body: { templateId: '00000000-0000-4000-8000-000000000000' } })).status).toBe(400);
    expect((await call('POST', `/crm/deals/${dealId}/documents`, { token: owner.token, tenant, body: {} })).status).toBe(400);
  });

  it('downloads need a signed-in member of the workspace; another workspace gets 404', async () => {
    expect((await raw('GET', `/crm/deal-documents/${doc.id}/file`, { tenant })).status).toBe(401);
    expect((await raw('GET', `/crm/deal-documents/${doc.id}/file`, { token: outsider.token, tenant })).status).toBe(403);
    // The outsider in their own workspace: RLS hides the row, so it doesn't exist there.
    for (const path of [`/crm/deal-documents/${doc.id}/file`, `/crm/deal-documents/${doc.id}`, `/crm/document-templates/${template.id}/file`]) {
      expect((await raw('GET', path, { token: outsider.token, tenant: otherTenant })).status, path).toBe(404);
    }
    expect((await raw('DELETE', `/crm/deal-documents/${doc.id}`, { token: outsider.token, tenant: otherTenant })).status).toBe(404);
    expect(await ok<Doc[]>('GET', `/crm/deal-documents?dealId=${dealId}`, { token: outsider.token, tenant: otherTenant })).toEqual([]);
    expect(await ok<Template[]>('GET', '/crm/document-templates', { token: outsider.token, tenant: otherTenant })).toEqual([]);
    // Nor can another workspace use this template on its own deal.
    const theirFunnel = (await firstFunnel(outsider, otherTenant)).id;
    const theirDeal = await newDeal(outsider, otherTenant, theirFunnel);
    expect((await call('POST', `/crm/deals/${theirDeal.id}/documents`, { token: outsider.token, tenant: otherTenant, body: { templateId: template.id } })).status).toBe(400);
  });
});

describe('an interrupted generation (CD-100)', () => {
  // The worker stopping mid-job is simulated: the document is set back to "running" with SQL (as
  // the owner) and the job is sent with pg-boss directly, as a first delivery or as a retry.
  let db: Client;
  let boss: PgBoss;
  let template: Template;
  let dealId: string;

  beforeAll(async () => {
    db = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL || DEFAULT_MIGRATION_DATABASE_URL });
    await db.connect();
    boss = new PgBoss({ connectionString: inject('databaseUrl'), schema: 'pgboss', createSchema: false, supervise: false, schedule: false });
    boss.on('error', () => {});
    await boss.start();
    template = await upload(owner, tenant, starterTemplate(), 'Proposal — interrupted');
    dealId = (await newDeal(owner, tenant, funnelId)).id;
  });
  afterAll(async () => {
    await boss?.stop({ graceful: false });
    await db?.end();
  });

  /** A generated document, then put back to "running" as if its worker had died. */
  async function leftRunning(since = 'now()'): Promise<string> {
    const queued = await ok<Doc>('POST', `/crm/deals/${dealId}/documents`, { token: owner.token, tenant, body: { templateId: template.id } }, 202);
    expect((await waitForDocument(owner, tenant, queued.id)).status).toBe('ready');
    await db.query(`update deal_documents set status = 'running', storage_key = null, completed_at = null, updated_at = ${since} where id = $1`, [queued.id]);
    return queued.id;
  }

  async function waitForJob(name: string, id: string) {
    const deadline = Date.now() + 15_000;
    for (;;) {
      const job = await boss.getJobById(name, id);
      if (job?.state === 'completed' || job?.state === 'failed') return job.state;
      if (Date.now() > deadline) throw new Error(`Job ${name} ${id} still ${job?.state}; is the worker running?`);
      await new Promise((r) => setTimeout(r, 150));
    }
  }

  const status = async (id: string) => (await db.query(`select status, error from deal_documents where id = $1`, [id])).rows[0] as { status: string; error: string | null };

  it('a retry takes over a document its earlier attempt left running', async () => {
    const id = await leftRunning();
    // Held back 2 s and marked as started once, so the worker gets it as a retry (retryCount 1).
    const jobId = await boss.send('crm.generate-document', { tenantId: tenant, documentId: id, actorUserId: owner.userId }, { startAfter: 2 });
    await db.query(`update pgboss.job set started_on = now() where name = 'crm.generate-document' and id = $1`, [jobId]);
    const doc = await waitForDocument(owner, tenant, id);
    expect(doc.status, doc.error ?? '').toBe('ready');
    const file = await raw('GET', `/crm/deal-documents/${id}/file`, { token: owner.token, tenant });
    expect(file.status).toBe(200);
  });

  it('a first delivery leaves a running document to the attempt that is running it', async () => {
    const id = await leftRunning();
    const jobId = await boss.send('crm.generate-document', { tenantId: tenant, documentId: id, actorUserId: owner.userId });
    expect(await waitForJob('crm.generate-document', jobId!)).toBe('completed');
    expect((await status(id)).status).toBe('running');
    await db.query(`update deal_documents set status = 'failed' where id = $1`, [id]);
  });

  it('the nightly job fails documents running for over an hour, and only those', async () => {
    const stuck = await leftRunning(`now() - interval '2 hours'`);
    const recent = await leftRunning(`now() - interval '5 minutes'`);
    const jobId = await boss.send('reporting.nightly', {});
    expect(await waitForJob('reporting.nightly', jobId!)).toBe('completed');
    expect(await status(stuck)).toEqual({ status: 'failed', error: 'Generation was interrupted. Try again.' });
    expect((await status(recent)).status).toBe('running');
    await db.query(`update deal_documents set status = 'failed' where id = $1`, [recent]);
  });
});

describe('deleting removes the files', () => {
  it('deleting a template removes its file and keeps the documents made from it', async () => {
    const template = await upload(admin, tenant, starterTemplate(), 'Short-lived');
    const deal = await newDeal(owner, tenant, funnelId);
    const queued = await ok<Doc>('POST', `/crm/deals/${deal.id}/documents`, { token: owner.token, tenant, body: { templateId: template.id } }, 202);
    await waitForDocument(owner, tenant, queued.id);

    expect((await call('DELETE', `/crm/document-templates/${template.id}`, { token: member.token, tenant })).status).toBe(403);
    await ok('DELETE', `/crm/document-templates/${template.id}`, { token: admin.token, tenant });
    expectFile(tenant, `templates/${template.id}.docx`, false);
    expect((await raw('GET', `/crm/document-templates/${template.id}/file`, { token: admin.token, tenant })).status).toBe(404);
    expect((await call('DELETE', `/crm/document-templates/${template.id}`, { token: admin.token, tenant })).status).toBe(404);

    const kept = await ok<Doc>('GET', `/crm/deal-documents/${queued.id}`, { token: owner.token, tenant });
    expect(kept).toMatchObject({ status: 'ready', templateId: null, templateName: 'Short-lived' });
    expect((await raw('GET', `/crm/deal-documents/${queued.id}/file`, { token: owner.token, tenant })).status).toBe(200);
    expect((await call('POST', `/crm/deals/${deal.id}/documents`, { token: owner.token, tenant, body: { templateId: template.id } })).status).toBe(400);
  });

  it('a document is deleted by whoever generated it or an admin, with its file', async () => {
    const template = await upload(owner, tenant);
    const deal = await newDeal(owner, tenant, funnelId);
    const mine = await ok<Doc>('POST', `/crm/deals/${deal.id}/documents`, { token: member.token, tenant, body: { templateId: template.id } }, 202);
    const theirs = await ok<Doc>('POST', `/crm/deals/${deal.id}/documents`, { token: owner.token, tenant, body: { templateId: template.id } }, 202);
    await waitForDocument(owner, tenant, mine.id);
    await waitForDocument(owner, tenant, theirs.id);

    expect((await call('DELETE', `/crm/deal-documents/${theirs.id}`, { token: member.token, tenant })).status).toBe(403);
    await ok('DELETE', `/crm/deal-documents/${mine.id}`, { token: member.token, tenant });
    expectFile(tenant, `documents/${mine.id}.docx`, false);
    expect((await call('GET', `/crm/deal-documents/${mine.id}`, { token: member.token, tenant })).status).toBe(404);
    await ok('DELETE', `/crm/deal-documents/${theirs.id}`, { token: admin.token, tenant });
    expectFile(tenant, `documents/${theirs.id}.docx`, false);
    const activities = await ok<{ title: string }[]>('GET', `/crm/deals/${deal.id}/activities`, { token: owner.token, tenant });
    expect(activities.filter((a) => a.title.startsWith('Document deleted'))).toHaveLength(2);
  });

  it('deleting a deal deletes its documents and their files', async () => {
    const template = await upload(owner, tenant);
    const deal = await newDeal(owner, tenant, funnelId);
    const queued = await ok<Doc>('POST', `/crm/deals/${deal.id}/documents`, { token: owner.token, tenant, body: { templateId: template.id } }, 202);
    await waitForDocument(owner, tenant, queued.id);
    expectFile(tenant, `documents/${queued.id}.docx`, true);
    await ok('DELETE', `/crm/deals/${deal.id}`, { token: owner.token, tenant });
    expectFile(tenant, `documents/${queued.id}.docx`, false);
    expect((await call('GET', `/crm/deal-documents/${queued.id}`, { token: owner.token, tenant })).status).toBe(404);
  });
});
