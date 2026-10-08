/**
 * The work order page (CD-266): where, materials and the report; signing off with the customer's
 * name; technicians changed one by one with a new lead, all in the history; the checklist.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { addMember, call, createTenant, ok, type Session, signIn } from './helpers';
import { accessOf } from './people-helpers';

interface WorkOrder {
  id: string;
  workPlace: string;
  materials: string | null;
  customerName: string | null;
  signedOffAt: string | null;
  signedOffByName: string | null;
  technicians: { employeeId: string; isLead: boolean }[];
}
interface Entry {
  action: string;
  field: string | null;
  label: string | null;
  newValue: unknown;
}

let owner: Session;
let ana: Session;
let bo: Session;
let cara: Session;
let tenant: string;
const emp: Record<'ana' | 'bo' | 'cara', string> = { ana: '', bo: '', cara: '' };
let order: WorkOrder;
const as = (s: Session = owner) => ({ token: s.token, tenant });
const patch = (body: Record<string, unknown>, s: Session = owner) => call<WorkOrder>('PATCH', `/work-orders/${order.id}`, { ...as(s), body });
const history = async () => (await ok<{ entries: Entry[] }>('GET', `/work-orders/${order.id}/history`, as())).entries;

beforeAll(async () => {
  [owner, ana, bo, cara] = await Promise.all([signIn('wop-owner'), signIn('wop-ana'), signIn('wop-bo'), signIn('wop-cara')]);
  tenant = await createTenant(owner, 'Work order page');
  for (const [name, s] of [['ana', ana], ['bo', bo], ['cara', cara]] as const) {
    await addMember(owner, tenant, s, 'member');
    emp[name] = (await accessOf(s, tenant)).employeeId;
    if (name !== 'cara') await ok('PATCH', `/people/employees/${emp[name]}`, { ...as(), body: { workType: 'service' } }, 200);
  }
  const companyId = (await ok<{ id: string }>('POST', '/crm/companies', { ...as(), body: { name: 'Northwind' } })).id;
  order = await ok<WorkOrder>('POST', '/work-orders', { ...as(), body: { title: 'Install 3 split AC units', companyId, technicianIds: [emp.ana] } });
});

describe('details, report and sign-off', () => {
  it('saves where, materials and the report; the history records them', async () => {
    expect(order.workPlace).toBe('customer');
    const saved = (await patch({ workPlace: 'workshop', materials: '3 × split unit 3.5 kW', report: 'Mounted and tested.' })).body;
    expect([saved.workPlace, saved.materials]).toEqual(['workshop', '3 × split unit 3.5 kW']);
    expect((await history()).filter((e) => e.action === 'updated').map((e) => e.field)).toEqual(expect.arrayContaining(['workPlace', 'materials', 'report']));
  });

  it("signing off needs the customer's name, records who and when, and keeps the name", async () => {
    expect((await patch({ signedOff: true })).status).toBe(400);
    const signed = (await patch({ customerName: 'Petra Customer', signedOff: true })).body;
    expect(signed.signedOffAt).not.toBeNull();
    expect(signed.signedOffByName).toBe(owner.name);
    expect((await patch({ customerName: null })).status).toBe(400);
    const undone = (await patch({ signedOff: false })).body;
    expect([undone.signedOffAt, undone.customerName]).toEqual([null, 'Petra Customer']);
  });
});

describe('technicians', () => {
  it('adds, changes the lead and removes one by one, each in the history', async () => {
    let saved = (await patch({ technicianIds: [emp.ana, emp.bo] })).body;
    expect(saved.technicians).toEqual([
      { employeeId: emp.ana, isLead: true, name: expect.any(String), jobTitle: null },
      { employeeId: emp.bo, isLead: false, name: expect.any(String), jobTitle: null },
    ]);
    saved = (await patch({ technicianIds: [emp.bo, emp.ana] })).body;
    expect(saved.technicians.find((t) => t.isLead)?.employeeId).toBe(emp.bo);
    saved = (await patch({ technicianIds: [emp.bo] })).body;
    expect(saved.technicians.map((t) => t.employeeId)).toEqual([emp.bo]);
    const techs = (await history()).filter((e) => e.field === 'technicians' || e.field === 'leadTechnician').map((e) => [e.action, e.field]);
    expect(techs).toEqual([
      ['participant_removed', 'technicians'],
      ['updated', 'leadTechnician'],
      ['participant_added', 'technicians'],
    ]);
    // An Office person can't be one.
    expect((await patch({ technicianIds: [emp.bo, emp.cara] })).status).toBe(400);
  });
});

describe('checklist', () => {
  it('adds in order, ticks and removes; someone who can\'t change the order gets 403', async () => {
    await ok('POST', `/work-orders/${order.id}/checklist`, { ...as(bo), body: { text: 'Check the refrigerant' } });
    let items = await ok<{ id: string; text: string; done: boolean }[]>('POST', `/work-orders/${order.id}/checklist`, { ...as(bo), body: { text: 'Photograph the units' } });
    expect(items.map((i) => i.text)).toEqual(['Check the refrigerant', 'Photograph the units']);
    items = await ok('PATCH', `/work-orders/${order.id}/checklist/${items[0]!.id}`, { ...as(bo), body: { done: true } }, 200);
    expect(items[0]!.done).toBe(true);
    items = await ok('DELETE', `/work-orders/${order.id}/checklist/${items[1]!.id}`, as(bo), 200);
    expect(items.length).toBe(1);
    // Cara (Office, not on it, didn't create it) reads but can't change it.
    expect((await ok<unknown[]>('GET', `/work-orders/${order.id}/checklist`, as(cara))).length).toBe(1);
    expect((await call('POST', `/work-orders/${order.id}/checklist`, { ...as(cara), body: { text: 'Mine' } })).status).toBe(403);
  });
});
