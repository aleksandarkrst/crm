/**
 * Vacation decisions (CD-167, spec 10 to 12): the country turns them on; approving a vacation
 * queues one, the worker generates the PDF with the next number and emails it to the employee and
 * the decision recipients; missing company details fail it with a reason and tell the Admins;
 * Admins regenerate (same number, new version); the employee downloads and confirms receipt,
 * managers and other workspaces can't see it; cancelling marks it cancelled.
 */
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { call, createTenant, eventually, mailTo, ok, type Session, signIn } from './helpers';
import { joinAsEmployee, START } from './people-helpers';

let owner: Session;
let mgr: Session;
let emp: Session;
let other: Session;
let tenant: string;
let otherTenant: string;
const id = {} as Record<'owner' | 'mgr' | 'emp', string>;
const as = (s: Session) => ({ token: s.token, tenant });
const NEXT = new Date().getUTCFullYear() + 1;
const d = (md: string) => `${NEXT}-${md}`;
const COMPANY = { legalName: 'Zapadni Balkan Mašine d.o.o.', address: 'Bulevar oslobođenja 12, 21000 Novi Sad', pib: '104052135', mb: '20084693', place: 'Novi Sad', signatoryName: 'Petar Jovanović', signatoryTitle: 'Direktor' };

interface Decision {
  id: string;
  number: string;
  version: number;
  status: string;
  error: string | null;
  state: string;
  emailedTo: string[] | null;
  acknowledgedAt: string | null;
}
type SentMail = { to: string; subject: string; text: string; attachments?: { filename: string; contentType: string; encoding?: string }[] };

const submit = (s: Session, body: Record<string, unknown>) => ok<{ id: string }>('POST', '/timeoff/requests', { ...as(s), body: { type: 'vacation', ...body } });
const approve = (requestId: string) => ok('POST', `/timeoff/requests/${requestId}/approve`, { ...as(mgr), body: {} }, 200);
/** The request's decision once the worker has finished with it. */
const decisionOf = (requestId: string, s: Session = emp) =>
  eventually(async () => {
    const r = await ok<{ decision: Decision | null }>('GET', `/timeoff/requests/${requestId}`, as(s));
    return r.decision && ['ready', 'failed'].includes(r.decision.status) && (r.decision.status === 'failed' || r.decision.emailedTo) ? r.decision : null;
  }, `the decision of ${requestId}`);
const mails = async (to: string, subject: string) => ((await mailTo(owner, to)) as unknown as SentMail[]).filter((m) => m.subject.startsWith(subject));

async function pdfOf(s: Session, decisionId: string, t = tenant) {
  const res = await fetch(`${inject('apiUrl')}/api/timeoff/decisions/${decisionId}/pdf`, { headers: { authorization: `Bearer ${s.token}`, 'x-tenant-id': t } });
  return { status: res.status, type: res.headers.get('content-type'), body: Buffer.from(await res.arrayBuffer()) };
}

beforeAll(async () => {
  [owner, mgr, emp, other] = (await Promise.all(['dec-owner', 'dec-mgr', 'dec-emp', 'dec-other'].map((l) => signIn(l)))) as [Session, Session, Session, Session];
  tenant = await createTenant(owner, 'Vacation decisions');
  otherTenant = await createTenant(other, 'Decisions elsewhere');
  id.owner = (await ok('GET', '/people/access', as(owner))).employeeId;
  id.mgr = await joinAsEmployee(owner, tenant, mgr);
  id.emp = await joinAsEmployee(owner, tenant, emp);
  await ok('PATCH', `/people/employees/${id.emp}`, { ...as(owner), body: { managerId: id.mgr, employmentStartDate: START, jobTitle: 'Serviser' } }, 200);
  for (const key of ['mgr', 'owner'] as const) await ok('PATCH', `/people/employees/${id[key]}`, { ...as(owner), body: { employmentStartDate: START } }, 200);
});

describe('settings (spec 10.1, 12)', () => {
  it('Admins set the country, the company details (PIB and MB checked) and the recipients; members can\'t', async () => {
    expect((await call('PATCH', '/workspace', { ...as(emp), body: { country: 'RS' } })).status).toBe(403);
    expect((await call('PATCH', '/workspace', { ...as(owner), body: { company: { pib: '104052136' } } })).status).toBe(400);
    expect((await call('PATCH', '/workspace', { ...as(owner), body: { company: { mb: '2008469' } } })).status).toBe(400);
    const ws = await ok('PATCH', '/workspace', { ...as(owner), body: { country: 'rs' } });
    expect(ws.country).toBe('RS');
    expect(ws.company).toMatchObject({ legalName: null, pib: null });
    expect(ws.company.legalBasis).toContain('člana 75. Zakona o radu');
    expect((await call('PATCH', '/timeoff/settings', { ...as(owner), body: { decisionCopyEmails: ['not-an-address'] } })).status).toBe(400);
    expect((await call('PATCH', '/timeoff/settings', { ...as(owner), body: { decisionCopyEmails: ['a@x.test', 'b@x.test', 'c@x.test', 'd@x.test', 'e@x.test', 'f@x.test'] } })).status).toBe(400);
    expect((await call('PATCH', '/timeoff/settings', { ...as(mgr), body: { decisionCopyAdmins: true } })).status).toBe(403);
  });
});

describe('generation, delivery and receipt (spec 11)', () => {
  let failedRequest: string;
  let decision: Decision;

  it('without company details the decision fails with the reason, the Admins are told, the approval stands', async () => {
    const r = await submit(emp, { startDate: d('03-02'), endDate: d('03-06') });
    failedRequest = r.id;
    await approve(r.id);
    const dec = await decisionOf(r.id, owner);
    expect(dec).toMatchObject({ status: 'failed', number: `GO-${NEXT}-0001`, version: 1 });
    expect(dec.error).toContain('Company details are missing: legal name, address, PIB, MB, place of issue, signatory name, signatory title');
    expect((await ok('GET', `/timeoff/requests/${r.id}`, as(emp))).status).toBe('approved');
    await eventually(async () => (await mails(owner.email, 'Vacation decision could not be generated'))[0] ?? null, 'the failure email');
    expect((await pdfOf(emp, dec.id)).status).toBe(409);
  });

  it('regenerated with the details: the same number, version 2, emailed to the employee with the PDF attached', async () => {
    await ok('PATCH', '/workspace', { ...as(owner), body: { company: COMPANY } });
    const failed = (await ok<{ decision: Decision }>('GET', `/timeoff/requests/${failedRequest}`, as(owner))).decision;
    expect((await call('POST', `/timeoff/decisions/${failed.id}/regenerate`, { ...as(mgr), body: { email: true } })).status).toBe(403);
    const v2 = await ok<Decision>('POST', `/timeoff/decisions/${failed.id}/regenerate`, { ...as(owner), body: { email: true } });
    expect(v2).toMatchObject({ number: `GO-${NEXT}-0001`, version: 2, status: 'queued' });
    decision = await decisionOf(failedRequest);
    expect(decision).toMatchObject({ id: v2.id, status: 'ready', state: 'valid', emailedTo: [emp.email] });
    const [mail] = await mails(emp.email, 'Vacation decision (Rešenje o korišćenju godišnjeg odmora)');
    expect(mail!.subject).toContain(`GO-${NEXT}-0001`);
    expect(mail!.attachments).toEqual([expect.objectContaining({ filename: `Resenje-GO-${NEXT}-0001-v2.pdf`, contentType: 'application/pdf', encoding: 'base64' })]);
    // The earlier version stays, superseded.
    const all = await ok<Decision[]>('GET', '/timeoff/decisions', as(owner));
    expect(all.filter((x) => x.number === `GO-${NEXT}-0001`).map((x) => [x.version, x.state])).toEqual([[2, 'valid'], [1, 'superseded']]);
  });

  it('the employee downloads it and confirms receipt; the manager and other workspaces see nothing', async () => {
    const pdf = await pdfOf(emp, decision.id);
    expect(pdf.status).toBe(200);
    expect(pdf.type).toBe('application/pdf');
    expect(pdf.body.subarray(0, 5).toString()).toBe('%PDF-');
    expect((await pdfOf(owner, decision.id)).status).toBe(200);
    expect((await pdfOf(mgr, decision.id)).status).toBe(404);
    expect((await ok<{ decision: Decision | null }>('GET', `/timeoff/requests/${failedRequest}`, as(mgr))).decision).toBeNull();
    expect((await call('GET', '/timeoff/decisions', as(mgr))).status).toBe(403);
    expect((await pdfOf(other, decision.id, otherTenant)).status).toBe(404);
    expect((await call('POST', `/timeoff/decisions/${decision.id}/acknowledge`, { token: other.token, tenant: otherTenant })).status).toBe(404);
    expect((await call('POST', `/timeoff/decisions/${decision.id}/acknowledge`, as(owner))).status).toBe(403);
    const ack = await ok<Decision>('POST', `/timeoff/decisions/${decision.id}/acknowledge`, as(emp), 200);
    expect(ack.acknowledgedAt).not.toBeNull();
    expect(await ok('GET', '/timeoff/decisions', { token: other.token, tenant: otherTenant })).toEqual([]);
  });

  it('the recipients get a copy; two approvals at once get consecutive numbers; cancelling marks it cancelled', async () => {
    await ok('PATCH', '/timeoff/settings', { ...as(owner), body: { decisionCopyAdmins: true, decisionCopyEmails: [`HR.${emp.email}`] } });
    const a = await submit(emp, { startDate: d('04-06'), endDate: d('04-07') });
    const b = await submit(emp, { startDate: d('05-04'), endDate: d('05-05') });
    await Promise.all([approve(a.id), approve(b.id)]);
    const [da, db] = [await decisionOf(a.id), await decisionOf(b.id)];
    expect([da.number, db.number].sort()).toEqual([`GO-${NEXT}-0002`, `GO-${NEXT}-0003`]);
    expect([...da.emailedTo!].sort()).toEqual([emp.email, `hr.${emp.email}`.toLowerCase(), owner.email].sort());
    expect((await mails(`hr.${emp.email}`.toLowerCase(), 'Vacation decision')).length).toBe(2);
    await ok('POST', `/timeoff/requests/${a.id}/cancel`, { ...as(emp), body: {} }, 200);
    expect((await ok<{ decision: Decision }>('GET', `/timeoff/requests/${a.id}`, as(emp))).decision.state).toBe('cancelled');
    expect((await call('POST', `/timeoff/decisions/${da.id}/regenerate`, { ...as(owner), body: {} })).status).toBe(409);
  });

  it('no decision outside Serbia, and none for other time off', async () => {
    const paid = await ok<{ id: string }>('POST', '/timeoff/requests', { ...as(emp), body: { type: 'unpaid_leave', startDate: d('06-01'), endDate: d('06-01') } });
    await approve(paid.id);
    await ok('PATCH', '/workspace', { ...as(owner), body: { country: null } });
    const r = await submit(emp, { startDate: d('06-08'), endDate: d('06-08') });
    await approve(r.id);
    expect((await ok<{ decision: Decision | null }>('GET', `/timeoff/requests/${r.id}`, as(emp))).decision).toBeNull();
    expect((await ok<{ decision: Decision | null }>('GET', `/timeoff/requests/${paid.id}`, as(emp))).decision).toBeNull();
  });
});
