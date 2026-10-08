/**
 * Work orders (CD-265): numbered WO-1001…, Unscheduled until a technician, a date and a start are
 * set, technicians must be Service or Both, On hold needs a reason; everyone sees them, owners,
 * admins, the creator, the project lead and the technicians change them.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { addMember, call, createTenant, ok, type Session, signIn } from './helpers';
import { accessOf } from './people-helpers';

interface WorkOrder {
  id: string;
  number: number;
  status: string;
  holdReason: string | null;
  scheduledDate: string | null;
  scheduledStart: string | null;
  durationHours: number;
  technicians: { employeeId: string; isLead: boolean }[];
  canChange: boolean;
  canDelete: boolean;
}

let owner: Session;
let ana: Session;
let bo: Session;
let tenant: string;
let anaId: string;
let boId: string;
let companyId: string;
let projectId: string;
const as = (s: Session = owner) => ({ token: s.token, tenant });
const create = (body: Record<string, unknown>, s: Session = owner) => ok<WorkOrder>('POST', '/work-orders', { ...as(s), body: { title: 'Fix the unit', companyId, ...body } });

beforeAll(async () => {
  [owner, ana, bo] = await Promise.all([signIn('wo-owner'), signIn('wo-ana'), signIn('wo-bo')]);
  tenant = await createTenant(owner, 'Work orders');
  await addMember(owner, tenant, ana, 'member');
  await addMember(owner, tenant, bo, 'member');
  anaId = (await accessOf(ana, tenant)).employeeId;
  boId = (await accessOf(bo, tenant)).employeeId;
  await ok('PATCH', `/people/employees/${anaId}`, { ...as(), body: { workType: 'service' } }, 200);
  companyId = (await ok<{ id: string }>('POST', '/crm/companies', { ...as(), body: { name: 'Northwind' } })).id;
  const [type] = await ok<{ id: string }[]>('GET', '/project-types', as());
  projectId = (await ok<{ id: string }>('POST', '/projects', { ...as(), body: { name: 'Fit-out', projectTypeId: type!.id, companyId } })).id;
});

describe('creating', () => {
  it('numbers from WO-1001, starts Unscheduled with a 2 h default', async () => {
    const a = await create({});
    const b = await create({ type: 'installation', priority: 'urgent', projectId });
    expect(b.number).toBe(a.number + 1);
    expect(a.number).toBe(1001);
    expect(a).toMatchObject({ status: 'unscheduled', durationHours: 2, technicians: [] });
    expect(b).toMatchObject({ type: 'installation', priority: 'urgent', projectId });
  });

  it('is Scheduled with a technician, a date and a start; the first technician leads', async () => {
    const wo = await create({ technicianIds: [anaId], scheduledDate: '2026-10-12', scheduledStart: '08:30', durationHours: 1.5 });
    expect(wo).toMatchObject({ status: 'scheduled', scheduledDate: '2026-10-12', scheduledStart: '08:30', durationHours: 1.5 });
    expect(wo.technicians).toMatchObject([{ employeeId: anaId, isLead: true }]);
  });

  it('refuses an Office technician, a date without a start, a bad duration and a project of another company', async () => {
    expect((await call('POST', '/work-orders', { ...as(), body: { title: 'x', companyId, technicianIds: [boId] } })).status).toBe(400);
    expect((await call('POST', '/work-orders', { ...as(), body: { title: 'x', companyId, scheduledDate: '2026-10-12' } })).status).toBe(400);
    expect((await call('POST', '/work-orders', { ...as(), body: { title: 'x', companyId, durationHours: 0.3 } })).status).toBe(400);
    const other = (await ok<{ id: string }>('POST', '/crm/companies', { ...as(), body: { name: 'Other Ltd' } })).id;
    expect((await call('POST', '/work-orders', { ...as(), body: { title: 'x', companyId: other, projectId } })).status).toBe(400);
  });
});

describe('status', () => {
  it('Scheduled needs a technician and a time; setting them schedules, clearing them unschedules', async () => {
    const wo = await create({});
    expect((await call('PATCH', `/work-orders/${wo.id}`, { ...as(), body: { status: 'scheduled' } })).status).toBe(400);
    const scheduled = await ok<WorkOrder>('PATCH', `/work-orders/${wo.id}`, { ...as(), body: { technicianIds: [anaId], scheduledDate: '2026-10-13', scheduledStart: '09:00' } }, 200);
    expect(scheduled.status).toBe('scheduled');
    const cleared = await ok<WorkOrder>('PATCH', `/work-orders/${wo.id}`, { ...as(), body: { technicianIds: [] } }, 200);
    expect(cleared.status).toBe('unscheduled');
  });

  it('On hold needs a reason, which clears when it leaves; Completed is stamped', async () => {
    const wo = await create({});
    expect((await call('PATCH', `/work-orders/${wo.id}`, { ...as(), body: { status: 'on_hold' } })).status).toBe(400);
    const held = await ok<WorkOrder>('PATCH', `/work-orders/${wo.id}`, { ...as(), body: { status: 'on_hold', holdReason: 'Waiting for parts' } }, 200);
    expect(held).toMatchObject({ status: 'on_hold', holdReason: 'Waiting for parts' });
    const going = await ok<WorkOrder>('PATCH', `/work-orders/${wo.id}`, { ...as(), body: { status: 'in_progress' } }, 200);
    expect(going).toMatchObject({ status: 'in_progress', holdReason: null });
    const done = await ok<WorkOrder & { completedAt: string | null }>('PATCH', `/work-orders/${wo.id}`, { ...as(), body: { status: 'completed' } }, 200);
    expect(done.completedAt).not.toBeNull();
  });
});

describe('access', () => {
  it('everyone sees every work order; a plain member can not change or delete it, a technician can change it', async () => {
    const wo = await create({ technicianIds: [anaId], scheduledDate: '2026-10-14', scheduledStart: '10:00' });
    const seen = await ok<WorkOrder[]>('GET', '/work-orders', as(bo));
    expect(seen.find((w) => w.id === wo.id)).toMatchObject({ canChange: false, canDelete: false });
    expect((await call('PATCH', `/work-orders/${wo.id}`, { ...as(bo), body: { priority: 'urgent' } })).status).toBe(403);
    expect((await call('DELETE', `/work-orders/${wo.id}`, as(bo))).status).toBe(403);
    expect((await call('PATCH', `/work-orders/${wo.id}`, { ...as(ana), body: { status: 'in_progress' } })).status).toBe(200);
    expect((await call('DELETE', `/work-orders/${wo.id}`, as(ana))).status).toBe(403);
    expect((await call('DELETE', `/work-orders/${wo.id}`, as())).status).toBe(204);
    expect((await call('GET', `/work-orders/${wo.id}`, as())).status).toBe(404);
  });

  it('the one who created it can change and delete it', async () => {
    const wo = await create({}, bo);
    expect((await call('PATCH', `/work-orders/${wo.id}`, { ...as(bo), body: { title: 'Renamed' } })).status).toBe(200);
    expect((await call('DELETE', `/work-orders/${wo.id}`, as(bo))).status).toBe(204);
  });
});

describe('list', () => {
  it('narrows by technician, status and text', async () => {
    const wo = await create({ title: 'Boiler service', technicianIds: [anaId], scheduledDate: '2026-10-15', scheduledStart: '07:00' });
    const mine = await ok<WorkOrder[]>('GET', '/work-orders?technicianId=me', as(ana));
    expect(mine.every((w) => w.technicians.some((t) => t.employeeId === anaId))).toBe(true);
    expect(mine.some((w) => w.id === wo.id)).toBe(true);
    expect((await ok<WorkOrder[]>('GET', '/work-orders?q=boiler', as())).map((w) => w.id)).toEqual([wo.id]);
    expect((await ok<WorkOrder[]>('GET', `/work-orders?q=WO-${wo.number}`, as())).map((w) => w.id)).toEqual([wo.id]);
    expect((await ok<WorkOrder[]>('GET', `/work-orders?projectId=${projectId}&status=scheduled`, as())).length).toBe(0);
  });
});
