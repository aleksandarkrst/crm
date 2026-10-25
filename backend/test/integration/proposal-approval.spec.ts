/**
 * Proposal approval per funnel (CD-120): the funnel's switch and approver; request, approve and
 * revoke (403 for anyone but the approver, owners and admins); sending blocked until approved; the
 * Approval status on deals and as a filter; the approval-request email and the digest section; and
 * uploading your own documents with their type (one Proposal per opportunity).
 */
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { addMember, call, createTenant, eventually, type Funnel, mailTo, ok, readyCompany, type Session, signIn, waitForMail } from './helpers';

let owner: Session;
let admin: Session;
let approver: Session;
let seller: Session;
let tenant: string;
/** Proposals need approval, by `approver`. */
let gated: Funnel;
/** No approval. */
let free: Funnel;
/** An opportunity company, so deals may enter the Pipeline (CD-360). */
let companyId: string;
const as = (s: Session) => ({ token: s.token, tenant });

const PDF = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n');

interface Approval {
  approvalStatus: string;
  approvalRequestedAt: string | null;
  approvalRequestedByUserId: string | null;
  approvedAt: string | null;
  approvedByUserId: string | null;
  proposalSentAt: string | null;
}

const newDeal = (title: string, funnel = gated) => ok<{ id: string }>('POST', '/crm/deals', { ...as(seller), body: { title, funnelId: funnel.id, companyId, saleType: 'transactional' } });
const statusOf = async (dealId: string) => (await ok<{ approvalStatus: string }>('GET', `/crm/deals/${dealId}`, as(seller))).approvalStatus;
const step = (s: Session, dealId: string, what: 'approval/request' | 'approval/approve' | 'approval/revoke' | 'proposal/sent') => call<Approval>('POST', `/crm/deals/${dealId}/${what}`, as(s));
const titles = async (dealId: string) => (await ok<{ title: string; detail: string | null }[]>('GET', `/crm/deals/${dealId}/activities`, as(owner))).map((a) => a.title);

/** POST /crm/deals/:id/documents/upload with `files` and `types` (multipart). */
async function upload(s: Session, dealId: string, files: { name: string; bytes: Buffer }[], types: unknown) {
  const form = new FormData();
  for (const f of files) form.append('files', new Blob([new Uint8Array(f.bytes)]), f.name);
  form.append('types', typeof types === 'string' ? types : JSON.stringify(types));
  const res = await fetch(`${inject('apiUrl')}/api/crm/deals/${dealId}/documents/upload`, { method: 'POST', headers: { authorization: `Bearer ${s.token}`, 'x-tenant-id': tenant }, body: form });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
const uploadProposal = async (dealId: string) => {
  const res = await upload(seller, dealId, [{ name: 'Offer.pdf', bytes: PDF }], ['Proposal']);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body[0] as { id: string };
};
/** A deal in the gated funnel with a ready Proposal, approval requested by the seller. */
const pendingDeal = async (title: string, funnel = gated) => {
  const deal = await newDeal(title, funnel);
  await uploadProposal(deal.id);
  expect((await step(seller, deal.id, 'approval/request')).status).toBe(200);
  return deal;
};

beforeAll(async () => {
  [owner, admin, approver, seller] = await Promise.all([signIn('appr-owner'), signIn('appr-admin'), signIn('appr-approver'), signIn('appr-seller')]);
  tenant = await createTenant(owner, 'Approval');
  await addMember(owner, tenant, admin, 'admin');
  await addMember(owner, tenant, approver, 'member');
  await addMember(owner, tenant, seller, 'member');
  companyId = (await readyCompany(owner, tenant, 'Approval Co')).id;
  [gated, free] = (await ok<Funnel[]>('GET', '/crm/funnels', as(owner))) as [Funnel, Funnel];
  await ok('PATCH', `/crm/funnels/${gated.id}`, { ...as(owner), body: { proposalApproval: true, approverUserId: approver.userId } });
});

describe('funnel settings', () => {
  it('refuses approval without an approver, or with one who is not a member', async () => {
    const none = await call('PATCH', `/crm/funnels/${free.id}`, { ...as(owner), body: { proposalApproval: true } });
    expect(none.status).toBe(400);
    expect(none.body.message).toContain('Pick the approver');
    const outsider = await signIn('appr-outsider');
    const foreign = await call('PATCH', `/crm/funnels/${free.id}`, { ...as(owner), body: { proposalApproval: true, approverUserId: outsider.userId } });
    expect(foreign.status).toBe(400);
    expect(foreign.body.message).toContain('The approver must be a member');
    // Clearing the approver of an approval funnel is refused too; nothing changed.
    expect((await call('PATCH', `/crm/funnels/${gated.id}`, { ...as(owner), body: { approverUserId: null } })).status).toBe(400);
    // Members can't change it.
    expect((await call('PATCH', `/crm/funnels/${free.id}`, { ...as(seller), body: { proposalApproval: false } })).status).toBe(403);
    const funnels = await ok<(Funnel & { proposalApproval: boolean; approverUserId: string | null })[]>('GET', '/crm/funnels', as(seller));
    expect(funnels.find((f) => f.id === free.id)).toMatchObject({ proposalApproval: false, approverUserId: null });
    expect(funnels.find((f) => f.id === gated.id)).toMatchObject({ proposalApproval: true, approverUserId: approver.userId });
  });

  it('keeps the switch and the approver on the funnel, not on its stages', async () => {
    const saved = await ok<Funnel & Record<string, unknown>>('PATCH', `/crm/funnels/${gated.id}`, { ...as(admin), body: { proposalApproval: true, approverUserId: approver.userId } });
    expect(saved).toMatchObject({ proposalApproval: true, approverUserId: approver.userId });
    expect(saved.stages.map((s) => s.id)).toEqual(gated.stages.map((s) => s.id));
    for (const s of saved.stages) expect(Object.keys(s).filter((k) => /approv/i.test(k))).toEqual([]);
  });
});

describe('request, approve, revoke and send', () => {
  it('only lets the approver, owners and admins decide (403 for other members)', async () => {
    const deal = await pendingDeal('Approval · who decides');
    expect((await step(seller, deal.id, 'approval/approve')).status).toBe(403);
    expect((await step(seller, deal.id, 'approval/revoke')).status).toBe(403);

    const byApprover = await step(approver, deal.id, 'approval/approve');
    expect(byApprover.status).toBe(200);
    expect(byApprover.body).toMatchObject({ approvalStatus: 'approved', approvedByUserId: approver.userId, approvalRequestedByUserId: seller.userId });
    expect((await step(owner, deal.id, 'approval/revoke')).body.approvalStatus).toBe('not_requested');

    await step(seller, deal.id, 'approval/request');
    expect((await step(admin, deal.id, 'approval/approve')).body).toMatchObject({ approvalStatus: 'approved', approvedByUserId: admin.userId });
    expect((await step(admin, deal.id, 'approval/revoke')).status).toBe(200);
    await step(seller, deal.id, 'approval/request');
    expect((await step(owner, deal.id, 'approval/approve')).body.approvedByUserId).toBe(owner.userId);
    // Approve needs a pending request.
    expect((await step(owner, deal.id, 'approval/approve')).status).toBe(409);
  });

  it('blocks sending until approved; revoking blocks it again and is in the activities', async () => {
    const deal = await newDeal('Approval · sending');
    expect(await statusOf(deal.id)).toBe('not_requested');
    expect((await step(seller, deal.id, 'proposal/sent')).status).toBe(409);
    await uploadProposal(deal.id);

    const requested = await step(seller, deal.id, 'approval/request');
    expect(requested.body).toMatchObject({ approvalStatus: 'pending', approvalRequestedByUserId: seller.userId, approvedAt: null });
    expect((await step(seller, deal.id, 'approval/request')).status).toBe(409);
    const refused = await step(seller, deal.id, 'proposal/sent');
    expect(refused.status).toBe(409);
    expect((refused.body as unknown as { message: string }).message).toContain(approver.name);

    expect((await step(approver, deal.id, 'approval/approve')).status).toBe(200);
    expect((await step(seller, deal.id, 'approval/request')).status).toBe(409);
    const sent = await step(seller, deal.id, 'proposal/sent');
    expect(sent.status).toBe(200);
    expect(sent.body).toMatchObject({ approvalStatus: 'approved' });
    expect(Date.parse(sent.body.proposalSentAt!)).toBeGreaterThan(0);

    const revoked = await step(approver, deal.id, 'approval/revoke');
    expect(revoked.body).toMatchObject({ approvalStatus: 'not_requested', approvalRequestedAt: null, approvedAt: null, approvedByUserId: null });
    expect((await step(seller, deal.id, 'proposal/sent')).status).toBe(409);
    expect((await step(approver, deal.id, 'approval/revoke')).status).toBe(409);
    expect(await statusOf(deal.id)).toBe('not_requested');

    const log = await ok<{ title: string; detail: string | null }[]>('GET', `/crm/deals/${deal.id}/activities`, as(owner));
    expect(log.map((a) => a.title).slice(0, 4)).toEqual(['Proposal approval revoked', 'Proposal sent', 'Proposal approved', 'Approval requested']);
    expect(log.find((a) => a.title === 'Approval requested')!.detail).toBe(`From ${approver.name}`);
  });

  it('declining a pending request is its own activity', async () => {
    const deal = await pendingDeal('Approval · declined');
    expect((await step(approver, deal.id, 'approval/revoke')).body.approvalStatus).toBe('not_requested');
    expect((await titles(deal.id))[0]).toBe('Approval request declined');
  });

  it('is not required in a funnel without approval: sending works, requesting is a 409', async () => {
    const deal = await newDeal('Approval · not required', free);
    expect(await statusOf(deal.id)).toBe('not_required');
    await uploadProposal(deal.id);
    expect((await step(seller, deal.id, 'approval/request')).status).toBe(409);
    expect((await step(owner, deal.id, 'approval/approve')).status).toBe(409);
    const sent = await step(seller, deal.id, 'proposal/sent');
    expect(sent.status).toBe(200);
    expect(sent.body).toMatchObject({ approvalStatus: 'not_required' });
    expect(sent.body.proposalSentAt).not.toBeNull();
  });

  it('needs a ready Proposal document to request approval', async () => {
    const deal = await newDeal('Approval · needs a proposal');
    const refused = await step(seller, deal.id, 'approval/request');
    expect(refused.status).toBe(409);
    expect((refused.body as unknown as { message: string }).message).toContain('Add the proposal first');
    // A supporting document isn't the proposal.
    expect((await upload(seller, deal.id, [{ name: 'Prices.pdf', bytes: PDF }], ['Price list'])).status).toBe(201);
    expect((await step(seller, deal.id, 'approval/request')).status).toBe(409);
    await uploadProposal(deal.id);
    expect((await step(seller, deal.id, 'approval/request')).body.approvalStatus).toBe('pending');
  });

  it('refuses a request on a closed opportunity', async () => {
    const deal = await newDeal('Approval · won');
    await uploadProposal(deal.id);
    await ok('POST', `/crm/deals/${deal.id}/move`, { ...as(owner), body: { stageId: gated.stages.find((s) => s.isWon)!.id } }, 200);
    expect((await step(seller, deal.id, 'approval/request')).status).toBe(409);
  });

  it('resets the approval when the opportunity moves to another funnel', async () => {
    const deal = await pendingDeal('Approval · funnel change');
    await step(approver, deal.id, 'approval/approve');
    const moved = await ok<{ approvalStatus: string }>('PATCH', `/crm/deals/${deal.id}`, { ...as(owner), body: { funnelId: free.id } });
    expect(moved.approvalStatus).toBe('not_required');
    expect(await titles(deal.id)).toContain('Proposal approval reset');
  });
});

describe("the approver's task", () => {
  interface Task { id: string; dealId: string; label: string; assigneeUserId: string | null; dueDate: string | null; done: boolean; blocksAdvance: boolean }
  const tasksOf = async (dealId: string) => (await ok<Task[]>('GET', `/crm/deal-tasks?dealIds=${dealId}`, as(owner))).filter((t) => t.label === 'Approve the proposal');

  it('a request gives the approver a task due today; approving ticks it', async () => {
    const deal = await pendingDeal('Task · approved');
    const [task, ...more] = await tasksOf(deal.id);
    expect(more).toHaveLength(0);
    expect(task).toMatchObject({ assigneeUserId: approver.userId, done: false, blocksAdvance: false });
    // Workspace "today" (the test tenant's time zone), never the UTC date (CD-338).
    const { timezone } = await ok<{ timezone: string }>('GET', '/workspace', as(owner));
    expect(task!.dueDate).toBe(new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date()));
    await step(approver, deal.id, 'approval/approve');
    expect(await tasksOf(deal.id)).toMatchObject([{ id: task!.id, done: true }]);
  });

  it('declining, revoking and a reset remove the open task', async () => {
    const declined = await pendingDeal('Task · declined');
    await step(approver, declined.id, 'approval/revoke');
    expect(await tasksOf(declined.id)).toHaveLength(0);

    const reset = await pendingDeal('Task · funnel change');
    await ok('PATCH', `/crm/deals/${reset.id}`, { ...as(owner), body: { funnelId: free.id } });
    expect(await tasksOf(reset.id)).toHaveLength(0);

    // Revoked after approval: the ticked task stays as history, the next request makes a new one.
    const revoked = await pendingDeal('Task · revoked');
    await step(approver, revoked.id, 'approval/approve');
    await step(owner, revoked.id, 'approval/revoke');
    await step(seller, revoked.id, 'approval/request');
    expect((await tasksOf(revoked.id)).map((t) => t.done).sort()).toEqual([false, true]);
  });
});

describe('the approval-request email and the digest', () => {
  /** Approval by the admin, so the approver's own switch doesn't matter here. */
  let byAdmin: Funnel;

  beforeAll(async () => {
    byAdmin = await ok<Funnel>('POST', '/crm/funnels', { ...as(owner), body: { label: 'Approved by admin' } });
    await ok('PATCH', `/crm/funnels/${byAdmin.id}`, { ...as(owner), body: { proposalApproval: true, approverUserId: admin.userId } });
  });

  it('emails the approver when approval is requested', async () => {
    const deal = await pendingDeal('Email · asked', byAdmin);
    const mail = await eventually(async () => (await mailTo(admin, admin.email)).find((m) => m.subject.endsWith('Email · asked')), 'the approval-request email');
    expect(mail.subject).toBe(`${seller.name} asks you to approve the proposal for Email · asked`);
    expect(mail.text).toContain('Funnel: Approved by admin');
    expect(mail.text).toContain(`http://app.example.test/deals/${deal.id}`);
  });

  it("doesn't email an approver who turned it off", async () => {
    expect(await ok('GET', '/profile', as(approver))).toMatchObject({ notifyProposalApprovals: true });
    expect(await ok('PATCH', '/profile', { ...as(approver), body: { notifyProposalApprovals: false } })).toMatchObject({ notifyProposalApprovals: false });
    await pendingDeal('Email · switched off');
    // A marker in the same queue, sent last: once it arrived, the request before it has run.
    await pendingDeal('Email · marker', byAdmin);
    await waitForMail(admin, admin.email, 2);
    await ok('PATCH', '/profile', { ...as(approver), body: { notifyProposalApprovals: true } });
    expect((await mailTo(approver, approver.email)).filter((m) => m.subject.endsWith('Email · switched off'))).toEqual([]);
  });

  it("lists pending requests in the approver's digest, not approved ones or other people's", async () => {
    const waiting = await pendingDeal('Digest · waiting');
    const done = await pendingDeal('Digest · approved');
    await step(approver, done.id, 'approval/approve');
    const digest = await ok<{ approvalsPending: { id: string; title: string }[] }>('GET', '/notifications/digest', as(approver));
    const ids = digest.approvalsPending.map((d) => d.id);
    expect(ids).toContain(waiting.id);
    expect(ids).not.toContain(done.id);
    expect((await ok<{ approvalsPending: { id: string }[] }>('GET', '/notifications/digest', as(seller))).approvalsPending).toEqual([]);

    await ok('POST', '/dev/digest', as(approver), 202);
    const mail = await eventually(async () => (await mailTo(approver, approver.email)).find((m) => m.subject.startsWith('Your day in Approval')), 'the digest email');
    expect(mail.subject).toMatch(/proposals? to approve/);
    expect(mail.text).toContain('Proposals waiting for your approval');
    expect(mail.text).toContain('Digest · waiting');
  });
});

describe('the Approval status filter', () => {
  it('finds each status whatever the stage, and revoking moves a deal back', async () => {
    const notRequired = await newDeal('Filter · not required', free);
    const notRequested = await newDeal('Filter · not requested');
    const pending = await pendingDeal('Filter · pending');
    const approved = await pendingDeal('Filter · approved');
    await step(approver, approved.id, 'approval/approve');
    // Different stages, so the filter can't be about the stage.
    const second = gated.stages.filter((s) => !s.isWon).sort((a, b) => a.position - b.position)[1]!;
    await ok('POST', `/crm/deals/${pending.id}/move`, { ...as(owner), body: { stageId: second.id } }, 200);

    const mine = [notRequired.id, notRequested.id, pending.id, approved.id];
    const found = async (status: string) => {
      const rows = await ok<{ deal: { id: string; approvalStatus: string } }[]>('GET', `/crm/deals?approvalStatus=${status}&limit=200`, as(owner));
      expect(rows.every((r) => r.deal.approvalStatus === status)).toBe(true);
      return rows.map((r) => r.deal.id).filter((id) => mine.includes(id));
    };
    expect(await found('not_required')).toEqual([notRequired.id]);
    expect(await found('not_requested')).toEqual([notRequested.id]);
    expect(await found('pending')).toEqual([pending.id]);
    expect(await found('approved')).toEqual([approved.id]);
    expect((await call('GET', '/crm/deals?approvalStatus=maybe', as(owner))).status).toBe(400);

    await step(approver, approved.id, 'approval/revoke');
    expect((await found('not_requested')).sort()).toEqual([notRequested.id, approved.id].sort());
    expect(await found('approved')).toEqual([]);
  });
});

describe('uploading documents', () => {
  it('refuses wrong types and counts, two Proposals, and files that are not what they say', async () => {
    const deal = await newDeal('Upload · rules');
    const pdf = (name = 'a.pdf') => ({ name, bytes: PDF });
    expect((await upload(seller, deal.id, [pdf(), pdf('b.pdf')], ['Proposal'])).status).toBe(400);
    expect((await upload(seller, deal.id, [pdf()], ['Poem'])).status).toBe(400);
    expect((await upload(seller, deal.id, [pdf()], 'not json')).status).toBe(400);
    expect((await upload(seller, deal.id, [], ['Proposal'])).status).toBe(400);
    const two = await upload(seller, deal.id, [pdf(), pdf('b.pdf')], ['Proposal', 'Proposal']);
    expect(two.status).toBe(400);
    expect(two.body.message).toContain('Only one file can be the Proposal');
    const fake = await upload(seller, deal.id, [{ name: 'fake.pdf', bytes: Buffer.from('just text, not a PDF') }], ['Proposal']);
    expect(fake.status).toBe(400);
    expect(fake.body.message).toContain('fake.pdf');
    expect((await upload(seller, deal.id, [{ name: 'notes.txt', bytes: PDF }], ['Other'])).status).toBe(400);
    expect(await ok('GET', `/crm/deal-documents?dealId=${deal.id}`, as(owner))).toEqual([]);
  });

  it('stores the files with their type; one Proposal per opportunity; serves the PDF as a PDF', async () => {
    const deal = await newDeal('Upload · stored');
    const res = await upload(seller, deal.id, [{ name: 'Offer 2026.pdf', bytes: PDF }, { name: 'Specs.pdf', bytes: PDF }], ['Proposal', 'Technical specification']);
    expect(res.status).toBe(201);
    expect(res.body).toEqual([
      expect.objectContaining({ name: 'Offer 2026', docType: 'Proposal', source: 'uploaded', status: 'ready', mimeType: 'application/pdf', sizeBytes: PDF.length }),
      expect.objectContaining({ name: 'Specs', docType: 'Technical specification', source: 'uploaded', status: 'ready' }),
    ]);

    const again = await upload(seller, deal.id, [{ name: 'Offer v2.pdf', bytes: PDF }], ['Proposal']);
    expect(again.status).toBe(409);
    expect(again.body.message).toContain('Offer 2026');
    expect((await ok<unknown[]>('GET', `/crm/deal-documents?dealId=${deal.id}`, as(owner))).length).toBe(2);

    const file = await fetch(`${inject('apiUrl')}/api/crm/deal-documents/${res.body[0].id}/file`, { headers: { authorization: `Bearer ${approver.token}`, 'x-tenant-id': tenant } });
    expect(file.status).toBe(200);
    expect(file.headers.get('content-type')).toContain('application/pdf');
    expect(file.headers.get('content-disposition')).toContain('Offer 2026.pdf');
    expect(Buffer.from(await file.arrayBuffer()).equals(PDF)).toBe(true);
  });

  it('deleting the Proposal resets its approval', async () => {
    const deal = await newDeal('Upload · delete resets');
    const proposal = await uploadProposal(deal.id);
    await step(seller, deal.id, 'approval/request');
    await step(approver, deal.id, 'approval/approve');
    await ok('DELETE', `/crm/deal-documents/${proposal.id}`, as(owner));
    expect(await statusOf(deal.id)).toBe('not_requested');
    expect(await titles(deal.id)).toContain('Proposal approval reset');
    // A new one can be uploaded now.
    await uploadProposal(deal.id);
  });
});
