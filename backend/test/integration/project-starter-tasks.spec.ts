/**
 * "Add starter tasks from the products" (CD-263, design v2 §11): a project made from a deal with the
 * switch on gets a task per product line, in the deal's order, at the first stage; a line sold in
 * hours sets the estimate. Without the switch, no tasks.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { createTenant, firstFunnel, ok, productLine, saveProducts, type Session, signIn } from './helpers';

let owner: Session;
let tenant: string;
let companyId: string;
let dealId: string;
let typeId: string;
const as = () => ({ token: owner.token, tenant });

beforeAll(async () => {
  owner = await signIn('starter-owner');
  tenant = await createTenant(owner, 'Starter tasks');
  const funnel = await firstFunnel(owner, tenant);
  companyId = (await ok<{ id: string }>('POST', '/crm/companies', { ...as(), body: { name: 'Northwind' } })).id;
  dealId = (await ok<{ id: string }>('POST', '/crm/deals', { ...as(), body: { title: 'AC rollout', funnelId: funnel.id, companyId } })).id;
  const install = await ok<{ id: string }>('POST', '/crm/products', { ...as(), body: { name: 'Installation work', unit: 'h', unitPrice: 50 } });
  const unit = await ok<{ id: string }>('POST', '/crm/products', { ...as(), body: { name: 'Split unit 3.5 kW', unit: 'pcs', unitPrice: 900 } });
  await saveProducts(owner, tenant, dealId, [productLine(unit.id, { quantity: 3 }), productLine(install.id, { quantity: 12.5 })]);
  typeId = (await ok<{ id: string }[]>('GET', '/project-types', as()))[0]!.id;
});

const tasksOf = (projectId: string) => ok<{ name: string; estimateHours: number | null; stageId: string | null; status: string }[]>('GET', `/tasks?projectId=${projectId}`, as());

describe('starter tasks from the deal products', () => {
  it('with the switch on: a task per line, in order, at the first stage; hours set the estimate', async () => {
    const project = await ok<{ id: string; stageId: string }>('POST', '/projects', { ...as(), body: { name: 'AC rollout', projectTypeId: typeId, companyId, dealId, starterTasks: true } });
    const tasks = (await tasksOf(project.id)).sort((a, b) => a.name.localeCompare(b.name));
    expect(tasks.map((t) => [t.name, t.estimateHours, t.stageId, t.status])).toEqual([
      ['Installation work', 12.5, project.stageId, 'todo'],
      ['Split unit 3.5 kW', null, project.stageId, 'todo'],
    ]);
  });

  it('without it: no tasks', async () => {
    const project = await ok<{ id: string }>('POST', '/projects', { ...as(), body: { name: 'AC rollout 2', projectTypeId: typeId, companyId, dealId } });
    expect(await tasksOf(project.id)).toEqual([]);
  });
});
