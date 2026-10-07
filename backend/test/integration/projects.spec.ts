/**
 * Projects (CD-272, CD-233 slimmed for CD-275): project types with stages (defaults, editing, moving
 * projects when a stage or type goes), client projects from a deal (the deal must be of the company
 * and not lost; the deal's timeline says so), who may change what, and workspace isolation.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { addMember, call, createTenant, eventually, firstFunnel, ok, type Session, signIn } from './helpers';

interface StageView {
  id: string;
  name: string;
  position: number;
  projects: number;
}
interface TypeView {
  id: string;
  name: string;
  position: number;
  projects: number;
  stages: StageView[];
}

let owner: Session;
let admin: Session;
let member: Session;
let stranger: Session;
let tenant: string;
let otherTenant: string;
const as = (s: Session = owner) => ({ token: s.token, tenant });

const typesNow = () => ok<TypeView[]>('GET', '/project-types', as(member));
const newCompany = (name: string) => ok('POST', '/crm/companies', { ...as(), body: { name } });
const newDeal = async (title: string, companyId: string) => ok('POST', '/crm/deals', { ...as(), body: { title, funnelId: (await firstFunnel(owner, tenant)).id, companyId } });

beforeAll(async () => {
  [owner, admin, member, stranger] = await Promise.all([signIn('projects-owner'), signIn('projects-admin'), signIn('projects-member'), signIn('projects-stranger')]);
  [tenant, otherTenant] = await Promise.all([createTenant(owner, 'Projects'), createTenant(stranger, 'Projects other')]);
  await addMember(owner, tenant, admin, 'admin');
  await addMember(owner, tenant, member, 'member');
});

describe('project types', () => {
  it('a new workspace has "Client project" with Planning, In progress and Review', async () => {
    const types = await typesNow();
    expect(types.map((t) => [t.name, t.stages.map((s) => s.name)])).toEqual([['Client project', ['Planning', 'In progress', 'Review']]]);
  });

  it('owners and admins add, rename and reorder; members only read', async () => {
    expect((await call('POST', '/project-types', { ...as(member), body: { name: 'Nope' } })).status).toBe(403);
    let types = await ok<TypeView[]>('POST', '/project-types', { ...as(admin), body: { name: 'Website', stages: ['Discovery', 'Design', 'Build'] } });
    const web = types.find((t) => t.name === 'Website')!;
    expect(web.position).toBe(1);
    expect(web.stages.map((s) => s.name)).toEqual(['Discovery', 'Design', 'Build']);
    // The name is unique per workspace, case-insensitively.
    expect((await call('POST', '/project-types', { ...as(), body: { name: ' website ' } })).status).toBe(409);

    await ok('POST', `/project-types/${web.id}/stages`, { ...as(), body: { name: 'Launch' } });
    types = await ok('PATCH', `/project-types/${web.id}/stages/${web.stages[1]!.id}`, { ...as(), body: { name: 'UX and design' } }, 200);
    const stages = types.find((t) => t.id === web.id)!.stages;
    expect(stages.map((s) => s.name)).toEqual(['Discovery', 'UX and design', 'Build', 'Launch']);
    types = await ok('PUT', `/project-types/${web.id}/stages/order`, { ...as(), body: { stageIds: [stages[3]!.id, stages[0]!.id, stages[1]!.id, stages[2]!.id] } }, 200);
    expect(types.find((t) => t.id === web.id)!.stages.map((s) => [s.name, s.position])).toEqual([
      ['Launch', 0],
      ['Discovery', 1],
      ['UX and design', 2],
      ['Build', 3],
    ]);
    // Every stage once.
    expect((await call('PUT', `/project-types/${web.id}/stages/order`, { ...as(), body: { stageIds: [stages[0]!.id] } })).status).toBe(400);
    types = await ok('PATCH', `/project-types/${web.id}`, { ...as(), body: { name: 'Websites' } }, 200);
    expect(types.map((t) => t.name)).toEqual(['Client project', 'Websites']);
  });
});

describe('projects', () => {
  let acme: { id: string };
  let beta: { id: string };
  let dealId: string;
  let projectId: string;
  let clientType: TypeView;

  beforeAll(async () => {
    [acme, beta] = await Promise.all([newCompany('Acme'), newCompany('Beta')]);
    dealId = (await newDeal('CAT 320 overhaul', acme.id)).id;
    clientType = (await typesNow()).find((t) => t.name === 'Client project')!;
  });

  it('a member creates one from a deal: first stage, lead defaults to them, the deal timeline says so', async () => {
    const p = await ok('POST', '/projects', { ...as(member), body: { name: 'CAT 320 overhaul', projectTypeId: clientType.id, companyId: acme.id, dealId } });
    projectId = p.id;
    expect(p).toMatchObject({
      name: 'CAT 320 overhaul',
      status: 'open',
      projectTypeName: 'Client project',
      stageId: clientType.stages[0]!.id,
      stageName: 'Planning',
      companyName: 'Acme',
      dealId,
      dealTitle: 'CAT 320 overhaul',
      leadUserId: member.userId,
    });
    expect((await ok('GET', `/projects?dealId=${dealId}`, as())).map((x: { id: string }) => x.id)).toEqual([p.id]);
    await eventually(async () => {
      const titles = (await ok('GET', `/crm/deals/${dealId}/activities`, as())).map((a: { title: string }) => a.title);
      return titles.includes('Project created · CAT 320 overhaul');
    }, 'the deal timeline entry');
  });

  it('refuses a deal of another company, a lost deal, a lead who is not a member and a taken name', async () => {
    const betaDeal = await newDeal('Beta deal', beta.id);
    const body = { name: 'Other', projectTypeId: clientType.id, companyId: acme.id };
    expect((await call('POST', '/projects', { ...as(), body: { ...body, dealId: betaDeal.id } })).status).toBe(400);
    const lost = await newDeal('Lost one', acme.id);
    await ok('POST', `/crm/deals/${lost.id}/lost`, { ...as(), body: { reason: 'Price' } }, 200);
    expect((await call('POST', '/projects', { ...as(), body: { ...body, dealId: lost.id } })).status).toBe(400);
    expect((await call('POST', '/projects', { ...as(), body: { ...body, leadUserId: stranger.userId } })).status).toBe(400);
    // The name is unique among the company's open projects; another company may use it.
    expect((await call('POST', '/projects', { ...as(), body: { ...body, name: 'cat 320 OVERHAUL' } })).status).toBe(409);
    expect((await call('POST', '/projects', { ...as(), body: { ...body, name: 'CAT 320 overhaul', companyId: beta.id } })).status).toBe(201);
  });

  it('the lead, owners and admins change it; another member gets 403; the stage must be of its type', async () => {
    const other = await ok('POST', '/projects', { ...as(), body: { name: 'Owner-led', projectTypeId: clientType.id, companyId: acme.id } });
    expect((await call('PATCH', `/projects/${other.id}`, { ...as(member), body: { name: 'Mine now' } })).status).toBe(403);
    const moved = await ok('PATCH', `/projects/${projectId}`, { ...as(member), body: { stageId: clientType.stages[1]!.id } }, 200);
    expect(moved.stageName).toBe('In progress');
    const web = (await typesNow()).find((t) => t.name === 'Websites')!;
    expect((await call('PATCH', `/projects/${projectId}`, { ...as(member), body: { stageId: web.stages[0]!.id } })).status).toBe(400);
    expect((await ok('PATCH', `/projects/${projectId}`, { ...as(admin), body: { status: 'completed' } }, 200)).status).toBe('completed');
    await ok('PATCH', `/projects/${projectId}`, { ...as(admin), body: { status: 'open' } }, 200);
  });

  it('deleting a stage or type with projects needs somewhere to move them', async () => {
    let types = await typesNow();
    const inProgress = types.find((t) => t.id === clientType.id)!.stages[1]!;
    expect(inProgress.projects).toBe(1);
    expect((await call('DELETE', `/project-types/${clientType.id}/stages/${inProgress.id}`, as())).status).toBe(409);
    types = await ok('DELETE', `/project-types/${clientType.id}/stages/${inProgress.id}?moveProjectsTo=${clientType.stages[2]!.id}`, as(), 200);
    expect(types.find((t) => t.id === clientType.id)!.stages.map((s) => [s.name, s.position])).toEqual([
      ['Planning', 0],
      ['Review', 1],
    ]);
    expect((await ok('GET', `/projects/${projectId}`, as())).stageName).toBe('Review');

    const web = types.find((t) => t.name === 'Websites')!;
    expect((await call('DELETE', `/project-types/${clientType.id}`, as())).status).toBe(409);
    types = await ok('DELETE', `/project-types/${clientType.id}?moveProjectsTo=${web.id}`, as(), 200);
    expect(types.map((t) => [t.name, t.position])).toEqual([['Websites', 0]]);
    const p = await ok('GET', `/projects/${projectId}`, as());
    expect(p).toMatchObject({ projectTypeId: web.id, stageId: web.stages[0]!.id });
    // The last type stays.
    expect((await call('DELETE', `/project-types/${web.id}`, as())).status).toBe(409);
  });

  it('a company with projects is kept; deleting the deal clears the link', async () => {
    // A company with a project and no deals: the projects FK keeps it.
    const gamma = await newCompany('Gamma');
    const web = (await typesNow())[0]!;
    await ok('POST', '/projects', { ...as(), body: { name: 'Gamma site', projectTypeId: web.id, companyId: gamma.id } });
    const refused = await call('DELETE', `/crm/companies/${gamma.id}`, as());
    expect(refused.status).toBe(409);
    expect(refused.body.message).toBe('This company has projects. Delete them or move them to another company first.');
    await ok('DELETE', `/crm/deals/${dealId}`, as(), 204);
    expect((await ok('GET', `/projects/${projectId}`, as())).dealId).toBeNull();
  });

  it('another workspace sees none of it', async () => {
    const theirs = { token: stranger.token, tenant: otherTenant };
    expect((await ok('GET', '/projects', theirs)).length).toBe(0);
    expect((await call('GET', `/projects/${projectId}`, theirs)).status).toBe(404);
    expect((await ok<TypeView[]>('GET', '/project-types', theirs)).map((t) => t.name)).toEqual(['Client project']);
    expect((await call('GET', '/projects', { token: stranger.token, tenant })).status).toBe(403);
  });
});
