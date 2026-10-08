/**
 * Work order status and lock (CD-148, design v2): the technicians, the project lead, owners and
 * admins change the status; Mark completed is immediate and locks the order (fields, technicians,
 * checklist) until Reopen, which needs no reason; status changes are in the history.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { addMember, call, createTenant, ok, type Session, signIn } from './helpers';
import { accessOf } from './people-helpers';

interface WorkOrder {
  id: string;
  status: string;
  completedAt: string | null;
  canChange: boolean;
  canSetStatus: boolean;
  locked: boolean;
}

let owner: Session;
let tech: Session;
let creator: Session;
let lead: Session;
let tenant: string;
let techId: string;
let companyId: string;
let projectId: string;
const as = (s: Session = owner) => ({ token: s.token, tenant });
const patch = (id: string, body: Record<string, unknown>, s: Session = owner) => call<WorkOrder>('PATCH', `/work-orders/${id}`, { ...as(s), body });

beforeAll(async () => {
  [owner, tech, creator, lead] = await Promise.all([signIn('wos-owner'), signIn('wos-tech'), signIn('wos-creator'), signIn('wos-lead')]);
  tenant = await createTenant(owner, 'Work order status');
  for (const s of [tech, creator, lead]) await addMember(owner, tenant, s, 'member');
  techId = (await accessOf(tech, tenant)).employeeId;
  await ok('PATCH', `/people/employees/${techId}`, { ...as(), body: { workType: 'service' } }, 200);
  companyId = (await ok<{ id: string }>('POST', '/crm/companies', { ...as(), body: { name: 'Northwind' } })).id;
  const [type] = await ok<{ id: string }[]>('GET', '/project-types', as());
  projectId = (await ok<{ id: string }>('POST', '/projects', { ...as(), body: { name: 'Fit-out', projectTypeId: type!.id, companyId, leadUserId: lead.userId } })).id;
});

const newOrder = (s: Session = creator) => ok<WorkOrder>('POST', '/work-orders', { ...as(s), body: { title: 'Service the unit', companyId, projectId, technicianIds: [techId] } });

describe('who changes the status', () => {
  it('the technician, the project lead and owners do; the creator edits fields but not the status', async () => {
    const w = await newOrder();
    const asCreator = await ok<WorkOrder>('GET', `/work-orders/${w.id}`, as(creator));
    expect([asCreator.canChange, asCreator.canSetStatus]).toEqual([true, false]);
    expect((await patch(w.id, { status: 'in_progress' }, creator)).status).toBe(403);
    expect((await patch(w.id, { equipment: 'Split unit' }, creator)).status).toBe(200);
    expect((await patch(w.id, { status: 'in_progress' }, tech)).status).toBe(200);
    expect((await patch(w.id, { status: 'on_hold', holdReason: 'Waiting for parts' }, lead)).status).toBe(200);
    expect((await patch(w.id, { status: 'in_progress' }, owner)).status).toBe(200);
  });
});

describe('Completed locks the order', () => {
  it('Mark completed is immediate; then fields, technicians and the checklist are refused until Reopen', async () => {
    const w = await newOrder();
    await ok('POST', `/work-orders/${w.id}/checklist`, { ...as(tech), body: { text: 'Check the refrigerant' } });
    const done = (await patch(w.id, { status: 'completed' }, tech)).body;
    expect([done.status, done.locked, !!done.completedAt]).toEqual(['completed', true, true]);

    expect((await patch(w.id, { equipment: 'Changed' }, owner)).status).toBe(409);
    expect((await patch(w.id, { technicianIds: [] }, owner)).status).toBe(409);
    expect((await patch(w.id, { status: 'in_progress', equipment: 'Sneaky' }, owner)).status).toBe(409);
    expect((await call('POST', `/work-orders/${w.id}/checklist`, { ...as(tech), body: { text: 'More' } })).status).toBe(409);

    // Reopen needs no reason; the order can change again.
    const reopened = (await patch(w.id, { status: 'in_progress' }, tech)).body;
    expect([reopened.status, reopened.locked, reopened.completedAt]).toEqual(['in_progress', false, null]);
    expect((await patch(w.id, { equipment: 'Now fine' }, owner)).status).toBe(200);

    const history = await ok<{ entries: { field: string | null; newValue: unknown }[] }>('GET', `/work-orders/${w.id}/history`, as());
    expect(history.entries.filter((e) => e.field === 'status').map((e) => e.newValue)).toEqual(['in_progress', 'completed']);
  });
});
