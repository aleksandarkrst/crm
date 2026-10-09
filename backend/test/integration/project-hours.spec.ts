/**
 * Logged hours on projects (CD-277): every time entry on a project's tasks and work orders, all time
 * and this calendar month, on the project list (the company card and the Projects table read it);
 * a closed project takes no time and reopening it restores logging; a project with time on its
 * tasks can't be deleted.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { addMember, call, createTenant, ok, type Session, signIn } from './helpers';
import { accessOf, asTenantSql } from './people-helpers';

interface Project {
  id: string;
  loggedMinutes: number;
  monthMinutes: number;
}

let owner: Session;
let ana: Session;
let tenant: string;
let anaId: string;
let companyId: string;
let projectId: string;
let otherId: string;
let taskId: string;
let today: string;

const as = (s: Session = owner) => ({ token: s.token, tenant });
const list = async () => ok<Project[]>('GET', `/projects?companyId=${companyId}`, as(ana));
const byId = async (id: string) => (await list()).find((p) => p.id === id)!;

beforeAll(async () => {
  [owner, ana] = await Promise.all([signIn('ph-owner'), signIn('ph-ana')]);
  tenant = await createTenant(owner, 'Project hours');
  await addMember(owner, tenant, ana, 'member');
  anaId = (await accessOf(ana, tenant)).employeeId;
  await ok('PATCH', `/people/employees/${anaId}`, { ...as(), body: { workType: 'both' } });
  companyId = (await ok<{ id: string }>('POST', '/crm/companies', { ...as(), body: { name: 'Kovin Pančevo' } })).id;
  const [type] = await ok<{ id: string }[]>('GET', '/project-types', as());
  const create = async (name: string) => (await ok<{ id: string }>('POST', '/projects', { ...as(), body: { name, projectTypeId: type!.id, companyId, budgetHours: 40 } })).id;
  projectId = await create('Service contract 2026');
  otherId = await create('Parts catalogue 2026');
  taskId = (await ok<{ id: string }>('POST', '/tasks', { ...as(), body: { projectId, name: 'Hydraulic leak', assigneeIds: [anaId] } })).id;
  today = (await ok<{ today: string }>('GET', '/timesheet/week', as(ana))).today;
});

describe('logged hours on projects', () => {
  it('start at 0', async () => {
    expect(await byId(projectId)).toMatchObject({ loggedMinutes: 0, monthMinutes: 0 });
  });

  it("count every entry on the project's tasks and work orders; this month only this month's (TC 11)", async () => {
    await ok('PUT', '/timesheet/cells', { ...as(ana), body: { date: today, taskId, minutes: 240 } });
    const order = await ok<{ id: string }>('POST', '/work-orders', { ...as(), body: { title: 'Inspection', companyId, projectId, technicianIds: [anaId] } });
    await ok('POST', '/timesheet/entries', { ...as(ana), body: { workOrderId: order.id, date: today, minutes: 90 } });
    // An entry from an earlier month (written straight: before the week the API takes).
    const earlier = `${Number(today.slice(0, 4)) - 1}-06-15`;
    await asTenantSql(tenant, `insert into time_entries (tenant_id, employee_id, task_id, work_date, minutes) values ($1, $2, $3, $4, 600)`, [tenant, anaId, taskId, earlier]);
    expect(await byId(projectId)).toMatchObject({ loggedMinutes: 930, monthMinutes: 330 });
    expect(await byId(otherId)).toMatchObject({ loggedMinutes: 0, monthMinutes: 0 });
    // One project's read shows the same.
    expect(await ok<Project>('GET', `/projects/${projectId}`, as(ana))).toMatchObject({ loggedMinutes: 930, monthMinutes: 330 });
  });

  it('a closed project takes no time, reopening restores logging (TC 14)', async () => {
    await ok('PATCH', `/projects/${projectId}`, { ...as(), body: { status: 'completed' } });
    expect((await call('PUT', '/timesheet/cells', { ...as(ana), body: { date: today, taskId, minutes: 300 } })).status).toBe(423);
    await ok('PATCH', `/projects/${projectId}`, { ...as(), body: { status: 'open' } });
    await ok('PUT', '/timesheet/cells', { ...as(ana), body: { date: today, taskId, minutes: 300 } });
    expect((await byId(projectId)).monthMinutes).toBe(390);
  });

  it('a project with logged hours is kept (TC 13); one without can go', async () => {
    const refused = await call('DELETE', `/projects/${projectId}`, as());
    expect(refused.status).toBe(409);
    expect(JSON.stringify(refused.body)).toContain('This project has logged hours');
    await ok('DELETE', `/projects/${otherId}`, as(), 204);
  });
});
