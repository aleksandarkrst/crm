/**
 * Customer visit plans (CD-134): owners and admins create, change and delete plans for any member;
 * members see only their own plans, read-only; one plan per salesperson and month; plans are
 * monthly only (CD-212); lines are validated; a company in a plan can't be deleted; the
 * salesperson is emailed when someone else saves their plan; changes are in the history; tenants
 * are isolated.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { addMember, call, createTenant, eventually, mailTo, ok, type Session, signIn } from './helpers';

let owner: Session;
let admin: Session;
let seller: Session;
let other: Session;
let outsider: Session;
let tenant: string;
let otherTenant: string;
const companies: Record<string, string> = {};
const as = (s: Session, t = tenant) => ({ token: s.token, tenant: t });

interface Plan {
  id: string;
  salespersonUserId: string;
  salespersonName: string;
  periodType: 'month' | 'quarter';
  periodStart: string;
  periodEnd: string;
  periodLabel: string;
  note: string | null;
  lines: { id: string; companyId: string; companyName: string; plannedVisits: number }[];
  totalPlanned: number;
  updatedAt: string;
}

const plan = (s: Session, body: Record<string, unknown>, status?: number) => ok<Plan>('POST', '/crm/visit-plans', { ...as(s), body }, status);
const monthly = (salespersonUserId: string, periodStart: string, lines: [string, number][], note?: string) => ({
  salespersonUserId,
  periodType: 'month',
  periodStart,
  ...(note ? { note } : {}),
  lines: lines.map(([name, plannedVisits]) => ({ companyId: companies[name], plannedVisits })),
});

beforeAll(async () => {
  owner = await signIn('plans-owner');
  admin = await signIn('plans-admin');
  seller = await signIn('plans-seller');
  other = await signIn('plans-other');
  outsider = await signIn('plans-outsider');
  tenant = await createTenant(owner, 'Plans');
  otherTenant = await createTenant(outsider, 'Plans other');
  await addMember(owner, tenant, admin, 'admin');
  await addMember(owner, tenant, seller, 'member');
  await addMember(owner, tenant, other, 'member');
  for (const name of ['Alpha', 'Beta', 'Gamma', 'Delta']) companies[name] = (await ok<{ id: string }>('POST', '/crm/companies', { ...as(owner), body: { name: `${name} Plans` } })).id;
});

describe('visit plans', () => {
  it('creates, reads, changes and deletes a monthly plan', async () => {
    const created = await plan(admin, monthly(seller.userId, '2026-10-01', [['Beta', 2], ['Alpha', 3]], 'Focus on renewals'));
    expect(created).toMatchObject({
      salespersonUserId: seller.userId,
      salespersonName: seller.name,
      periodType: 'month',
      periodStart: '2026-10-01',
      periodEnd: '2026-11-01',
      periodLabel: 'October 2026',
      note: 'Focus on renewals',
      totalPlanned: 5,
    });
    // Lines by company name.
    expect(created.lines.map((l) => [l.companyName, l.plannedVisits])).toEqual([
      ['Alpha Plans', 3],
      ['Beta Plans', 2],
    ]);
    expect(await ok<Plan>('GET', `/crm/visit-plans/${created.id}`, as(owner))).toMatchObject({ id: created.id, totalPlanned: 5 });

    // Lines replace: Alpha changes, Beta goes, Gamma comes; the Alpha line keeps its id.
    const alpha = created.lines.find((l) => l.companyName === 'Alpha Plans')!;
    const changed = await ok<Plan>('PATCH', `/crm/visit-plans/${created.id}`, {
      ...as(owner),
      body: { note: '', lines: [{ companyId: companies.Alpha, plannedVisits: 4 }, { companyId: companies.Gamma, plannedVisits: 1 }] },
    });
    expect(changed.note).toBeNull();
    expect(changed.totalPlanned).toBe(5);
    expect(changed.lines.map((l) => [l.companyName, l.plannedVisits])).toEqual([
      ['Alpha Plans', 4],
      ['Gamma Plans', 1],
    ]);
    expect(changed.lines[0]!.id).toBe(alpha.id);
    expect(Date.parse(changed.updatedAt)).toBeGreaterThan(Date.parse(created.updatedAt));

    const listed = await ok<{ plans: Plan[] }>('GET', `/crm/visit-plans?salespersonUserId=${seller.userId}&periodType=month`, as(owner));
    expect(listed.plans.map((p) => p.id)).toContain(created.id);

    await ok('DELETE', `/crm/visit-plans/${created.id}`, as(admin));
    await ok('GET', `/crm/visit-plans/${created.id}`, as(owner), 404);
    await ok('DELETE', `/crm/visit-plans/${created.id}`, as(admin), 404);
  });

  it('refuses a second plan for the same salesperson and period (409), on create and on change', async () => {
    const first = await plan(owner, monthly(seller.userId, '2026-11-01', [['Alpha', 1]]));
    const dup = await call('POST', '/crm/visit-plans', { ...as(admin), body: monthly(seller.userId, '2026-11-01', [['Beta', 1]]) });
    expect(dup.status).toBe(409);
    expect(dup.body.message).toBe(`${seller.name} already has a plan for November 2026. Open that plan and change it instead.`);
    // Another person for the same month is fine.
    await plan(owner, monthly(other.userId, '2026-11-01', [['Beta', 1]]));
    const december = await plan(owner, monthly(seller.userId, '2026-12-01', [['Beta', 1]]));
    const moved = await call('PATCH', `/crm/visit-plans/${december.id}`, { ...as(owner), body: { periodStart: '2026-11-01' } });
    expect(moved.status).toBe(409);
    await ok('DELETE', `/crm/visit-plans/${first.id}`, as(owner));
    expect((await ok<Plan>('PATCH', `/crm/visit-plans/${december.id}`, { ...as(owner), body: { periodStart: '2026-11-01' } })).periodLabel).toBe('November 2026');
  });

  it('shows members only their own plans, read-only', async () => {
    const mine = await plan(owner, monthly(seller.userId, '2027-01-01', [['Alpha', 2]]));
    const theirs = await plan(owner, monthly(other.userId, '2027-01-01', [['Alpha', 1]]));

    const list = await ok<{ plans: Plan[] }>('GET', '/crm/visit-plans', as(seller));
    expect(list.plans.length).toBeGreaterThan(0);
    expect(list.plans.every((p) => p.salespersonUserId === seller.userId)).toBe(true);
    // Asking for someone else's plans still returns only their own.
    const asked = await ok<{ plans: Plan[] }>('GET', `/crm/visit-plans?salespersonUserId=${other.userId}`, as(seller));
    expect(asked.plans).toEqual([]);
    const byIds = await ok<{ plans: Plan[] }>('GET', `/crm/visit-plans?ids=${mine.id},${theirs.id}`, as(seller));
    expect(byIds.plans.map((p) => p.id)).toEqual([mine.id]);

    await ok('GET', `/crm/visit-plans/${mine.id}`, as(seller));
    await ok('GET', `/crm/visit-plans/${theirs.id}`, as(seller), 404);
    await ok('GET', `/crm/history?entityType=visit_plan&entityId=${theirs.id}`, as(seller), 404);
    await ok('GET', `/crm/history?entityType=visit_plan&entityId=${mine.id}`, as(seller));

    // Owners and admins see everyone's.
    const all = await ok<{ plans: Plan[] }>('GET', '/crm/visit-plans?periodStart=2027-01-01', as(admin));
    expect(all.plans.map((p) => p.id).sort()).toEqual([mine.id, theirs.id].sort());

    expect((await call('POST', '/crm/visit-plans', { ...as(seller), body: monthly(seller.userId, '2027-02-01', [['Alpha', 1]]) })).status).toBe(403);
    expect((await call('PATCH', `/crm/visit-plans/${mine.id}`, { ...as(seller), body: { note: 'mine' } })).status).toBe(403);
    expect((await call('DELETE', `/crm/visit-plans/${mine.id}`, as(seller))).status).toBe(403);
  });

  it('plans are monthly: a quarterly plan is refused, on create and on change (CD-212)', async () => {
    const quarterly = await call('POST', '/crm/visit-plans', { ...as(owner), body: { salespersonUserId: seller.userId, periodType: 'quarter', periodStart: '2026-10-01', lines: [{ companyId: companies.Alpha, plannedVisits: 6 }] } });
    expect(quarterly.status).toBe(400);
    expect(quarterly.body.message).toBe("Visit plans are monthly. A quarter's progress is the sum of its three monthly plans.");
    // Without a period type it is a month; a day that doesn't start a month is refused.
    const month = await plan(owner, { salespersonUserId: other.userId, periodStart: '2028-02-01', lines: [{ companyId: companies.Beta, plannedVisits: 3 }] });
    expect(month).toMatchObject({ periodType: 'month', periodStart: '2028-02-01', periodEnd: '2028-03-01', periodLabel: 'February 2028' });
    await plan(owner, monthly(seller.userId, '2026-10-15', [['Alpha', 1]]), 400);
    const toQuarter = await call('PATCH', `/crm/visit-plans/${month.id}`, { ...as(owner), body: { periodType: 'quarter', periodStart: '2028-01-01' } });
    expect(toQuarter.status).toBe(400);
    expect((await ok<Plan>('GET', `/crm/visit-plans/${month.id}`, as(owner))).periodType).toBe('month');
  });

  it('validates the lines and the salesperson', async () => {
    const base = monthly(seller.userId, '2027-03-01', [['Alpha', 1]]);
    const post = (body: Record<string, unknown>) => call('POST', '/crm/visit-plans', { ...as(owner), body });
    expect((await post({ ...base, lines: [] })).status).toBe(400);
    expect((await post({ ...base, lines: [{ companyId: companies.Alpha, plannedVisits: 0 }] })).status).toBe(400);
    expect((await post({ ...base, lines: [{ companyId: companies.Alpha, plannedVisits: 100 }] })).status).toBe(400);
    expect((await post({ ...base, lines: [{ companyId: companies.Alpha, plannedVisits: 1.5 }] })).status).toBe(400);
    const twice = await post({ ...base, lines: [{ companyId: companies.Alpha, plannedVisits: 1 }, { companyId: companies.Alpha, plannedVisits: 2 }] });
    expect(twice.status).toBe(400);
    expect(JSON.stringify(twice.body)).toContain('only once');
    expect((await post({ ...base, lines: [{ companyId: '00000000-0000-4000-8000-000000000000', plannedVisits: 1 }] })).status).toBe(400);
    const notMember = await post({ ...base, salespersonUserId: outsider.userId });
    expect(notMember.status).toBe(400);
    expect(notMember.body.message).toBe('The salesperson must be a member of this workspace');
    expect((await call('PATCH', '/crm/visit-plans/00000000-0000-4000-8000-000000000000', { ...as(owner), body: { note: 'x' } })).status).toBe(404);
    expect((await call('PATCH', `/crm/visit-plans/00000000-0000-4000-8000-000000000000`, { ...as(owner), body: {} })).status).toBe(400);
  });

  it("refuses to delete a company that is in a plan (409), like a company with deals", async () => {
    const p = await plan(owner, monthly(other.userId, '2027-04-01', [['Delta', 2]]));
    const refused = await call('DELETE', `/crm/companies/${companies.Delta}`, as(owner));
    expect(refused.status).toBe(409);
    expect(refused.body.message).toBe('Delta Plans is in 1 visit plan. Remove it from the plans first.');
    await ok('DELETE', `/crm/visit-plans/${p.id}`, as(owner));
    await ok('DELETE', `/crm/companies/${companies.Delta}`, as(owner));
  });

  it('records the plan and its lines in the change history', async () => {
    const p = await plan(admin, monthly(other.userId, '2027-05-01', [['Alpha', 2], ['Beta', 1]]));
    await ok('PATCH', `/crm/visit-plans/${p.id}`, { ...as(owner), body: { note: 'Push Q2', lines: [{ companyId: companies.Alpha, plannedVisits: 3 }, { companyId: companies.Gamma, plannedVisits: 1 }] } });
    await ok('PATCH', `/crm/visit-plans/${p.id}`, { ...as(owner), body: { salespersonUserId: seller.userId } });
    const { entries } = await ok<{ entries: { action: string; field: string | null; oldValue: unknown; newValue: unknown; oldLabel: string | null; newLabel: string | null; label: string | null; actor: { name: string } | null }[] }>(
      'GET',
      `/crm/history?entityType=visit_plan&entityId=${p.id}`,
      as(owner),
    );
    const find = (action: string, label?: string) => entries.filter((e) => e.action === action && (label === undefined || e.label === label));
    expect(find('created')).toEqual([expect.objectContaining({ label: '2027-05-01', actor: expect.objectContaining({ name: admin.name }) })]);
    expect(find('line_added', 'Alpha Plans')[0]?.newValue).toMatchObject({ companyId: companies.Alpha, plannedVisits: 2 });
    expect(find('line_added', 'Gamma Plans')[0]?.newValue).toMatchObject({ plannedVisits: 1 });
    expect(find('line_changed', 'Alpha Plans')[0]).toMatchObject({ oldValue: expect.objectContaining({ plannedVisits: 2 }), newValue: expect.objectContaining({ plannedVisits: 3 }) });
    expect(find('line_removed', 'Beta Plans')[0]?.oldValue).toMatchObject({ plannedVisits: 1 });
    expect(entries.find((e) => e.field === 'note')).toMatchObject({ oldValue: null, newValue: 'Push Q2' });
    expect(entries.find((e) => e.field === 'salespersonUserId')).toMatchObject({ oldLabel: other.name, newLabel: seller.name });

    // A stale If-Match on a field someone changed since is a conflict.
    const stale = await call('PATCH', `/crm/visit-plans/${p.id}`, { ...as(owner), headers: { 'if-match': `"${p.updatedAt}"` }, body: { note: 'Older idea' } });
    expect(stale.status).toBe(409);
  });

  it('emails the salesperson when someone else saves their plan, not when they save their own', async () => {
    const subjects = async (s: Session) => (await mailTo(s, s.email)).map((m) => m.subject);
    const p = await plan(owner, monthly(seller.userId, '2027-06-01', [['Alpha', 2], ['Gamma', 1]]));
    const mail = await eventually(async () => (await mailTo(seller, seller.email)).find((m) => m.subject === 'Your visit plan for June 2027'), 'plan email');
    expect(mail.text).toContain(`${owner.name} made a visit plan for you for June 2027`);
    expect(mail.text).toContain('- Alpha Plans: 2 visits');
    expect(mail.text).toContain(`/visit-plans/${p.id}`);

    await ok('PATCH', `/crm/visit-plans/${p.id}`, { ...as(admin), body: { lines: [{ companyId: companies.Alpha, plannedVisits: 1 }] } });
    await eventually(async () => (await subjects(seller)).includes('Your visit plan for June 2027 was changed'), 'plan changed email');

    // The admin's own plan sends nothing; neither does a plan for a salesperson who turned it off.
    // A marker to the admin comes last: the worker takes jobs in order, so then the others have run.
    await plan(admin, monthly(admin.userId, '2027-06-01', [['Alpha', 1]]));
    // The salesperson turned "Visit plans" off (read when the email would be sent).
    await ok('PATCH', '/profile', { ...as(seller), body: { notifyVisitPlans: false } });
    await plan(owner, monthly(seller.userId, '2027-09-01', [['Alpha', 1]]));
    await plan(owner, monthly(admin.userId, '2027-07-01', [['Alpha', 1]]));
    await eventually(async () => (await subjects(admin)).includes('Your visit plan for July 2027'), 'marker email');
    await ok('PATCH', '/profile', { ...as(seller), body: { notifyVisitPlans: true } });
    expect((await subjects(admin)).filter((s) => s.startsWith('Your visit plan'))).toEqual(['Your visit plan for July 2027']);
    expect((await subjects(seller)).some((s) => s.includes('September 2027'))).toBe(false);
  });

  it('is isolated per workspace', async () => {
    const p = await plan(owner, monthly(seller.userId, '2027-08-01', [['Alpha', 1]]));
    await ok('GET', `/crm/visit-plans/${p.id}`, as(outsider, otherTenant), 404);
    expect((await ok<{ plans: Plan[] }>('GET', '/crm/visit-plans', as(outsider, otherTenant))).plans).toEqual([]);
    expect((await call('PATCH', `/crm/visit-plans/${p.id}`, { ...as(outsider, otherTenant), body: { note: 'x' } })).status).toBe(404);
    // A company of another workspace can't be put in a plan.
    const foreign = await ok<{ id: string }>('POST', '/crm/companies', { ...as(outsider, otherTenant), body: { name: 'Foreign' } });
    expect((await call('POST', '/crm/visit-plans', { ...as(outsider, otherTenant), body: { salespersonUserId: outsider.userId, periodType: 'month', periodStart: '2027-08-01', lines: [{ companyId: companies.Alpha, plannedVisits: 1 }] } })).status).toBe(400);
    expect((await call('PATCH', `/crm/visit-plans/${p.id}`, { ...as(owner), body: { lines: [{ companyId: foreign.id, plannedVisits: 1 }] } })).status).toBe(400);
    // Not a member at all.
    expect((await call('GET', '/crm/visit-plans', as(outsider))).status).toBe(403);
  });
});
