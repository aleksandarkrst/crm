/**
 * "Create a project when a deal is won" (CD-233, CD-144 TC 7–10): with the workspace setting on,
 * winning a deal creates exactly one project (the deal's title, company and link; the owner as lead)
 * and the deal owner's email and the timeline entry; winning it again after a reopen creates none;
 * with the owner gone the first admin leads it; with the setting off nothing is created.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { addMember, call, createTenant, eventually, firstFunnel, type Funnel, mailTo, ok, type Session, signIn } from './helpers';

let owner: Session;
let seller: Session;
let tenant: string;
let funnel: Funnel;
const as = (s: Session = owner) => ({ token: s.token, tenant });

const wonStage = () => funnel.stages.find((s) => s.isWon)!;
async function newDeal(title: string, ownerUserId = owner.userId, withCompany = true) {
  const company = withCompany ? await ok('POST', '/crm/companies', { ...as(), body: { name: `${title} Ltd` } }) : null;
  return ok('POST', '/crm/deals', { ...as(), body: { title, funnelId: funnel.id, companyId: company?.id ?? null, ownerUserId } });
}
const win = (dealId: string) => ok('POST', `/crm/deals/${dealId}/move`, { ...as(), body: { stageId: wonStage().id } }, 200);
const projectsOf = (dealId: string) => ok<{ id: string; name: string; leadUserId: string; dealId: string; stageName: string; status: string }[]>('GET', `/projects?dealId=${dealId}`, as());
const timeline = async (dealId: string) => (await ok('GET', `/crm/deals/${dealId}/activities`, as())).map((a: { title: string }) => a.title);
/** The worker runs the job; give it a moment, then the state must be settled. */
const settle = () => new Promise((r) => setTimeout(r, 2500));

beforeAll(async () => {
  [owner, seller] = await Promise.all([signIn('auto-owner'), signIn('auto-seller')]);
  tenant = await createTenant(owner, 'Auto projects');
  await addMember(owner, tenant, seller, 'member');
  funnel = await firstFunnel(owner, tenant);
});

describe('automatic project on a won deal', () => {
  it('is off by default: winning a deal creates nothing (TC 9)', async () => {
    expect((await ok('GET', '/workspace', as())).autoCreateProjects).toBe(false);
    const deal = await newDeal('Off deal');
    await win(deal.id);
    await settle();
    expect(await projectsOf(deal.id)).toEqual([]);
  });

  it('only owners and admins turn it on', async () => {
    expect((await call('PATCH', '/workspace', { ...as(seller), body: { autoCreateProjects: true } })).status).toBe(403);
    expect((await ok('PATCH', '/workspace', { ...as(), body: { autoCreateProjects: true } }, 200)).autoCreateProjects).toBe(true);
  });

  let dealId: string;
  it('on: exactly one open project, the owner leads it, emailed, on the timeline (TC 7)', async () => {
    const deal = await newDeal('CAT 320 overhaul', seller.userId);
    dealId = deal.id;
    await win(dealId);
    const [project] = await eventually(async () => {
      const list = await projectsOf(dealId);
      return list.length ? list : null;
    }, 'the automatic project');
    expect(project).toMatchObject({ name: 'CAT 320 overhaul', status: 'open', leadUserId: seller.userId, dealId, stageName: 'Planning' });
    // The seller also got "assigned you" for the deal itself; find this one by its subject.
    const mail = await eventually(async () => (await mailTo(owner, seller.email)).find((m) => m.subject === 'Project created from a won deal: CAT 320 overhaul'), 'the project email');
    expect(mail.text).toContain(`/projects/${project!.id}`);
    await eventually(async () => (await timeline(dealId)).includes('Project created · CAT 320 overhaul'), 'the timeline entry');
  });

  it('is idempotent: moved back out of won and won again, no second project (TC 8)', async () => {
    await ok('POST', `/crm/deals/${dealId}/move`, { ...as(), body: { stageId: funnel.stages[0]!.id } }, 200);
    await win(dealId);
    await settle();
    expect(await projectsOf(dealId)).toHaveLength(1);
  });

  it('with the owner gone, the first owner or admin leads it (TC 10)', async () => {
    const leaver = await signIn('auto-leaver');
    await addMember(owner, tenant, leaver, 'member');
    const deal = await newDeal('Leaver deal', leaver.userId);
    await ok('DELETE', `/team/members/${leaver.userId}`, as(), 204);
    await win(deal.id);
    const [project] = await eventually(async () => {
      const list = await projectsOf(deal.id);
      return list.length ? list : null;
    }, 'the automatic project');
    expect(project!.leadUserId).toBe(owner.userId);
  });

  it('a won deal without a company gets none (a project needs its company)', async () => {
    const deal = await newDeal('No company deal', owner.userId, false);
    await win(deal.id);
    await settle();
    expect(await projectsOf(deal.id)).toEqual([]);
  });

  it('a name the company already uses gets a number', async () => {
    const deal = await newDeal('Rollout');
    await ok('POST', '/projects', { ...as(), body: { name: 'Rollout', projectTypeId: (await ok('GET', '/project-types', as()))[0].id, companyId: deal.companyId } });
    await win(deal.id);
    const [project] = await eventually(async () => {
      const list = await projectsOf(deal.id);
      return list.length ? list : null;
    }, 'the automatic project');
    expect(project!.name).toBe('Rollout (2)');
  });
});
