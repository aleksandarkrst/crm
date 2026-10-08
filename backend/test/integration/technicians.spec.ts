/**
 * Work type per person (CD-268): Office by default, changed by owners and admins on the employee,
 * in the directory (the pickers filter on it) and in history; Settings → Technicians lists people
 * with their team, work type and open tasks, for owners and admins only.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { addMember, call, createTenant, ok, type Session, signIn } from './helpers';
import { accessOf } from './people-helpers';

interface Technician {
  employeeId: string;
  name: string;
  workType: string;
  openTasks: number;
  openWorkOrders: number;
}

let owner: Session;
let ana: Session;
let tenant: string;
let anaId: string;
const as = (s: Session = owner) => ({ token: s.token, tenant });

beforeAll(async () => {
  [owner, ana] = await Promise.all([signIn('techs-owner'), signIn('techs-ana')]);
  tenant = await createTenant(owner, 'Technicians');
  await addMember(owner, tenant, ana, 'member');
  anaId = (await accessOf(ana, tenant)).employeeId;
});

describe('work type', () => {
  it('is Office by default and shows in the directory', async () => {
    const { employees } = await ok<{ employees: { id: string; workType: string }[] }>('GET', '/people/employees', as(ana));
    expect(employees.find((e) => e.id === anaId)?.workType).toBe('office');
  });

  it('owners and admins change it; a member gets 403; history records it', async () => {
    expect((await call('PATCH', `/people/employees/${anaId}`, { ...as(ana), body: { workType: 'service' } })).status).toBe(403);
    expect((await call('PATCH', `/people/employees/${anaId}`, { ...as(), body: { workType: 'field' } })).status).toBe(400);
    await ok('PATCH', `/people/employees/${anaId}`, { ...as(), body: { workType: 'both' } }, 200);
    const { employees } = await ok<{ employees: { id: string; workType: string }[] }>('GET', '/people/employees', as(ana));
    expect(employees.find((e) => e.id === anaId)?.workType).toBe('both');
    const history = await ok<{ entries: { field: string | null; oldValue: unknown; newValue: unknown }[] }>('GET', `/people/history?entityType=employee&entityId=${anaId}`, as());
    expect(history.entries.find((e) => e.field === 'workType')).toMatchObject({ oldValue: 'office', newValue: 'both' });
  });
});

describe('Settings → Technicians', () => {
  it('lists people with their work type and open tasks, for owners and admins only', async () => {
    const company = await ok('POST', '/crm/companies', { ...as(), body: { name: 'Northwind' } });
    const [type] = await ok<{ id: string }[]>('GET', '/project-types', as());
    const project = await ok<{ id: string }>('POST', '/projects', { ...as(), body: { name: 'Fit-out', projectTypeId: type!.id, companyId: company.id } });
    await ok('POST', '/tasks', { ...as(), body: { projectId: project.id, name: 'Survey', assigneeIds: [anaId] } });
    const done = await ok<{ id: string }>('POST', '/tasks', { ...as(), body: { projectId: project.id, name: 'Done one', assigneeIds: [anaId] } });
    await ok('PATCH', `/tasks/${done.id}`, { ...as(), body: { status: 'done' } }, 200);

    // Ana (Both) is on an open work order too (CD-265).
    await ok('POST', '/work-orders', { ...as(), body: { title: 'Service the unit', companyId: company.id, technicianIds: [anaId] } });
    const list = await ok<Technician[]>('GET', '/technicians', as());
    expect(list.find((t) => t.employeeId === anaId)).toMatchObject({ workType: 'both', openTasks: 1, openWorkOrders: 1 });
    expect((await call('GET', '/technicians', as(ana))).status).toBe(403);
  });
});
