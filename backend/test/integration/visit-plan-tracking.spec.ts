/**
 * Visit plan tracking (CD-135): a plan's progress per customer (held, capped, over plan, upcoming,
 * not closed, unplanned; cancelled and online meetings never count; a shared visit counts once,
 * for the deal owner who was there), the list's totals, Reports → Visit-plan completion (owners
 * and admins only, same numbers as the plan page, customer filter) and the Overview summary
 * (members always get their own).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { addMember, call, createTenant, firstFunnel, type Json, ok, type Session, signIn } from './helpers';

let owner: Session;
let seller: Session; // member with plans
let other: Session; // member without a plan, credited with a shared visit
let tenant: string;
const companies: Record<string, string> = {};
const as = (s: Session) => ({ token: s.token, tenant });

/** The first day of the month `offset` months from now (UTC), YYYY-MM-DD. */
function monthStart(offset: number): string {
  const d = new Date();
  const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1));
  return m.toISOString().slice(0, 10);
}
/** 10:00 UTC (noon in Belgrade) on a day of the month starting on `start`. */
const dayAt = (start: string, day: number) => `${start.slice(0, 8)}${String(day).padStart(2, '0')}T10:00:00.000Z`;
const hourAfter = (iso: string) => new Date(new Date(iso).getTime() + 3_600_000).toISOString();

const PAST = monthStart(-3);
const FUTURE = monthStart(2);

let pastPlan: Json;
let futurePlan: Json;
const meetingIds: Record<string, string> = {};

async function visit(s: Session, name: string, company: string, start: string, over: Record<string, unknown> = {}) {
  const m = await ok('POST', '/crm/meetings', { ...as(s), body: { title: name, type: 'visit', startsAt: start, endsAt: hourAfter(start), companyId: companies[company], ...over } });
  meetingIds[name] = m.id;
  return m;
}
const held = (s: Session, id: string) => ok('POST', `/crm/meetings/${id}/held`, as(s));

beforeAll(async () => {
  owner = await signIn('track-owner');
  seller = await signIn('track-seller');
  other = await signIn('track-other');
  tenant = await createTenant(owner, 'Tracking');
  await addMember(owner, tenant, seller, 'member');
  await addMember(owner, tenant, other, 'member');
  for (const name of ['Alpha', 'Beta', 'Gamma', 'Delta']) companies[name] = (await ok('POST', '/crm/companies', { ...as(owner), body: { name: `${name} Track` } })).id;
  const funnel = await firstFunnel(owner, tenant);
  const gammaDeal = await ok('POST', '/crm/deals', { ...as(owner), body: { title: 'Gamma deal', funnelId: funnel.id, companyId: companies.Gamma, ownerUserId: other.userId } });

  pastPlan = await ok('POST', '/crm/visit-plans', {
    ...as(owner),
    body: {
      salespersonUserId: seller.userId,
      periodType: 'month',
      periodStart: PAST,
      lines: [
        { companyId: companies.Alpha, plannedVisits: 2 },
        { companyId: companies.Beta, plannedVisits: 1 },
        { companyId: companies.Gamma, plannedVisits: 1 },
      ],
    },
  });
  futurePlan = await ok('POST', '/crm/visit-plans', {
    ...as(owner),
    body: { salespersonUserId: seller.userId, periodType: 'month', periodStart: FUTURE, lines: [{ companyId: companies.Alpha, plannedVisits: 1 }] },
  });

  // Alpha: three held visits, one over plan.
  for (const day of [3, 10, 17]) await held(seller, (await visit(seller, `Alpha ${day}`, 'Alpha', dayAt(PAST, day))).id);
  // Beta: a cancelled visit, and a planned one never closed.
  await ok('POST', `/crm/meetings/${(await visit(seller, 'Beta cancelled', 'Beta', dayAt(PAST, 4))).id}/cancel`, { ...as(seller), body: { reason: 'Ill' } });
  await visit(seller, 'Beta open', 'Beta', dayAt(PAST, 5));
  // Gamma: an online meeting (never a visit), and a shared visit that counts for the deal owner who was there.
  await held(seller, (await visit(seller, 'Gamma online', 'Gamma', dayAt(PAST, 6), { type: 'online' })).id);
  await held(seller, (await visit(seller, 'Gamma shared', 'Gamma', dayAt(PAST, 7), { dealId: gammaDeal.id, internalUserIds: [other.userId] })).id);
  // Delta isn't in the plan: an unplanned visit.
  await held(seller, (await visit(seller, 'Delta', 'Delta', dayAt(PAST, 8))).id);
  // The future plan: one upcoming visit.
  await visit(seller, 'Alpha later', 'Alpha', dayAt(FUTURE, 12));
});

describe('a plan’s progress', () => {
  it('counts held (capped), over plan, not closed, unplanned; cancelled and online never count; a shared visit counts once', async () => {
    const p = await ok('GET', `/crm/visit-plans/${pastPlan.id}/progress`, as(seller));
    const line = (name: string) => p.lines.find((l: Json) => l.companyId === companies[name]);
    expect(line('Alpha')).toMatchObject({ planned: 2, held: 3, heldCapped: 2, overPlan: 1, upcoming: 0, notClosed: 0, completion: 1, companyName: 'Alpha Track' });
    expect(line('Alpha').heldMeetingIds).toEqual([meetingIds['Alpha 3'], meetingIds['Alpha 10'], meetingIds['Alpha 17']]);
    expect(line('Beta')).toMatchObject({ planned: 1, held: 0, notClosed: 1, notClosedMeetingIds: [meetingIds['Beta open']] });
    expect(line('Gamma')).toMatchObject({ planned: 1, held: 0 });
    expect(p.unplanned).toEqual([{ companyId: companies.Delta, companyName: 'Delta Track', held: 1, meetingIds: [meetingIds.Delta] }]);
    expect(p.totals).toMatchObject({ planned: 4, heldCapped: 2, held: 3, overPlan: 1, notClosed: 1, upcoming: 0, unplanned: 1, completion: 0.5, expectedPace: 1, pace: 'behind' });
    // The meetings behind the numbers, for the plan page's lists.
    expect(p.meetings[meetingIds['Beta open']!]).toMatchObject({ title: 'Beta open', status: 'planned', companyName: 'Beta Track' });
    expect(p.meetings[meetingIds['Beta cancelled']!]).toBeUndefined();

    const f = await ok('GET', `/crm/visit-plans/${futurePlan.id}/progress`, as(owner));
    expect(f.lines[0]).toMatchObject({ planned: 1, held: 0, upcoming: 1, upcomingMeetingIds: [meetingIds['Alpha later']] });
    expect(f.totals).toMatchObject({ expectedPace: 0, pace: 'notStarted' });
  });

  it('marking a visit held moves it from not closed to held', async () => {
    await held(seller, meetingIds['Beta open']!);
    const p = await ok('GET', `/crm/visit-plans/${pastPlan.id}/progress`, as(seller));
    expect(p.totals).toMatchObject({ heldCapped: 3, held: 4, notClosed: 0, completion: 0.75 });
    await ok('POST', `/crm/meetings/${meetingIds['Beta open']}/undo-held`, as(seller));
  });

  it("is hidden from other members like the plan itself; the list's totals leave their plans out", async () => {
    expect((await call('GET', `/crm/visit-plans/${pastPlan.id}/progress`, as(other))).status).toBe(404);
    const mine = await ok('GET', `/crm/visit-plans/progress?ids=${pastPlan.id},${futurePlan.id}`, as(seller));
    expect(mine.progress.map((r: Json) => r.planId).sort()).toEqual([pastPlan.id, futurePlan.id].sort());
    expect(mine.progress.find((r: Json) => r.planId === pastPlan.id).totals).toMatchObject({ heldCapped: 2, planned: 4 });
    expect((await ok('GET', `/crm/visit-plans/progress?ids=${pastPlan.id}`, as(other))).progress).toEqual([]);
  });
});

describe('Reports → Visit-plan completion', () => {
  it('is for owners and admins only', async () => {
    expect((await call('GET', `/crm/visit-plans/report?periodType=month&periodStart=${PAST}`, as(seller))).status).toBe(403);
  });

  it('shows the plan page’s numbers per salesperson, and a credited salesperson without a plan', async () => {
    const r = await ok('GET', `/crm/visit-plans/report?periodType=month&periodStart=${PAST}`, as(owner));
    const page = await ok('GET', `/crm/visit-plans/${pastPlan.id}/progress`, as(owner));
    const row = r.rows.find((x: Json) => x.salespersonUserId === seller.userId);
    const { pace, ...totals } = page.totals;
    expect(row).toMatchObject({ ...totals, pace, planId: pastPlan.id, salespersonName: seller.name });
    // The shared Gamma visit counts for its deal owner, who has no plan: all unplanned.
    expect(r.rows.find((x: Json) => x.salespersonUserId === other.userId)).toMatchObject({ planId: null, planned: 0, held: 0, unplanned: 1 });
    expect(r.totals).toMatchObject({ planned: 4, heldCapped: 2, unplanned: 2, completion: 0.5 });
    expect(r.periodLabel).toBe(pastPlan.periodLabel);
  });

  it('filters by salesperson and by customer (visits of one customer across salespeople)', async () => {
    const one = await ok('GET', `/crm/visit-plans/report?periodType=month&periodStart=${PAST}&salespersonUserId=${other.userId}`, as(owner));
    expect(one.rows.map((x: Json) => x.salespersonUserId)).toEqual([other.userId]);
    const gamma = await ok('GET', `/crm/visit-plans/report?periodType=month&periodStart=${PAST}&companyId=${companies.Gamma}`, as(owner));
    const byPerson = Object.fromEntries(gamma.rows.map((x: Json) => [x.salespersonUserId, x]));
    expect(byPerson[seller.userId]).toMatchObject({ planned: 1, held: 0, unplanned: 0, completion: 0 });
    expect(byPerson[other.userId]).toMatchObject({ planned: 0, unplanned: 1 });
    const alpha = await ok('GET', `/crm/visit-plans/report?periodType=month&periodStart=${PAST}&companyId=${companies.Alpha}`, as(owner));
    expect(alpha.rows).toHaveLength(1);
    expect(alpha.rows[0]).toMatchObject({ planned: 2, held: 3, heldCapped: 2, overPlan: 1, completion: 1 });
  });

  it('refuses a period start that does not begin a period', async () => {
    expect((await call('GET', `/crm/visit-plans/report?periodType=month&periodStart=${PAST.slice(0, 8)}15`, as(owner))).status).toBe(400);
  });
});

describe('the Overview summary', () => {
  it('gives members their own progress, whatever they ask for', async () => {
    const own = await ok('GET', `/crm/visit-plans/progress-summary?periodType=month&periodStart=${PAST}&all=1`, as(seller));
    expect(own).toMatchObject({ salespersonUserId: seller.userId, planned: 4, heldCapped: 2, completion: 0.5, plans: [{ id: pastPlan.id }] });
    const otherOwn = await ok('GET', `/crm/visit-plans/progress-summary?periodType=month&periodStart=${PAST}&salespersonUserId=${seller.userId}`, as(other));
    expect(otherOwn).toMatchObject({ salespersonUserId: other.userId, planned: 0, plans: [] });
  });

  it('gives owners the team or one salesperson, with the report’s numbers', async () => {
    const team = await ok('GET', `/crm/visit-plans/progress-summary?periodType=month&periodStart=${PAST}&all=1`, as(owner));
    const report = await ok('GET', `/crm/visit-plans/report?periodType=month&periodStart=${PAST}`, as(owner));
    expect(team).toMatchObject({ salespersonUserId: null, planned: report.totals.planned, heldCapped: report.totals.heldCapped, completion: report.totals.completion });
    const one = await ok('GET', `/crm/visit-plans/progress-summary?periodType=month&periodStart=${FUTURE}&salespersonUserId=${seller.userId}`, as(owner));
    expect(one).toMatchObject({ planned: 1, heldCapped: 0, upcoming: 1, pace: 'notStarted' });
  });

  it('narrows to one customer for the company card', async () => {
    const alpha = await ok('GET', `/crm/visit-plans/progress-summary?periodType=month&periodStart=${PAST}&all=1&companyId=${companies.Alpha}`, as(owner));
    expect(alpha).toMatchObject({ planned: 2, held: 3, heldCapped: 2, plans: [{ id: pastPlan.id }] });
    const delta = await ok('GET', `/crm/visit-plans/progress-summary?periodType=month&periodStart=${PAST}&all=1&companyId=${companies.Delta}`, as(owner));
    expect(delta).toMatchObject({ planned: 0, plans: [] });
  });
});
