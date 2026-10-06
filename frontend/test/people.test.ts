// Unit tests of the employee card's draft and the Org structure charts (CD-225, CD-226): `npm test` in
// frontend (Node's test runner, TypeScript run as is by Node 24's type stripping).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ApiEmployee, ApiOrgLevel, ApiOrgUnit } from '../src/lib/api.ts';
import { changedFields, draftValues, isDirty, patchOf } from '../src/store/cardDraft.ts';
import { managerForUnit, reportingTree, unitChart, unitForManager, unitIdsFromParams, unitPathLabel, unitsBelow, unitTree } from '../src/store/orgChart.ts';

describe('the card draft', () => {
  const initial = { firstName: 'Ana', jobTitle: '', weeklyHours: '40', timesheetRequired: true, iban: '' };
  const editable = new Set(['firstName', 'jobTitle', 'weeklyHours', 'iban']);

  it('is clean until a value differs from the card', () => {
    assert.equal(isDirty(initial, {}, editable), false);
    // Typed and typed back: nothing to save.
    assert.equal(isDirty(initial, { firstName: 'Ana' }, editable), false);
    assert.equal(isDirty(initial, { firstName: 'Ana M' }, editable), true);
  });

  it('keeps only changed fields the caller may change, across sections', () => {
    const edits = { firstName: 'Ana', jobTitle: 'Technician', weeklyHours: '32', timesheetRequired: false, iban: 'RS35260005601001611379' };
    assert.deepEqual(changedFields(initial, edits, editable), { jobTitle: 'Technician', weeklyHours: '32', iban: 'RS35260005601001611379' });
  });

  it('shows the card with what was typed on top', () => {
    assert.deepEqual(draftValues(initial, { jobTitle: 'Lead' }), { ...initial, jobTitle: 'Lead' });
  });

  it('trims text and clears empty fields', () => {
    assert.deepEqual(patchOf({ jobTitle: '  Lead ', workPhone: '   ', timesheetRequired: false }), { jobTitle: 'Lead', workPhone: null, timesheetRequired: false });
  });
});

let n = 0;
function person(firstName: string, extra: Partial<ApiEmployee> = {}): ApiEmployee {
  n += 1;
  return {
    id: `e${n}`,
    userId: null,
    firstName,
    lastName: 'Test',
    fullName: `${firstName} Test`,
    jobTitle: null,
    unitId: null,
    unitName: null,
    managerId: null,
    managerName: null,
    workEmail: null,
    workPhone: null,
    workLocation: null,
    status: 'active',
    ...extra,
  } as ApiEmployee;
}
const level = (id: string, name: string, position: number) => ({ id, name, position, version: '', units: 0 }) as ApiOrgLevel;
const unit = (id: string, levelId: string, name: string, parentId: string | null = null, leadEmployeeId: string | null = null) =>
  ({ id, levelId, parentId, name, code: null, leadEmployeeId, leadName: null, version: '', members: 0, units: 0 }) as ApiOrgUnit;

describe('unitChart with three levels (CD-226)', () => {
  // Sector "Commercial" → Department "Sales" (lead Ana) → Team "North" (lead Cy); Department "Service" (empty).
  const levels = [level('team', 'Team', 3), level('sector', 'Sector', 1), level('dept', 'Department', 2)];
  const ana = person('Ana', { unitId: 'sales' });
  const bo = person('Bo', { unitId: 'north' });
  const cy = person('Cy', { unitId: 'north' });
  const dee = person('Dee', { unitId: 'sales' });
  const eve = person('Eve', { unitId: 'commercial' });
  const ceo = person('Ceo', { unitId: 'sales' });
  const free = person('Free');
  const people = [ana, bo, cy, dee, eve, ceo, free];
  const units = [
    unit('north', 'team', 'North', 'sales', cy.id),
    unit('sales', 'dept', 'Sales', 'commercial', ana.id),
    unit('commercial', 'sector', 'Commercial'),
    unit('service', 'dept', 'Service', 'commercial'),
    unit('ops', 'dept', 'Operations'),
  ];

  it('nests the units from the company down, by level and name, each lead once on top', () => {
    const chart = unitChart(people, people, levels, units, true, ceo.id);
    assert.deepEqual(
      chart.roots.map((r) => r.unit.name),
      ['Commercial', 'Operations'],
    );
    const commercial = chart.roots[0]!;
    assert.equal(commercial.level?.name, 'Sector');
    assert.deepEqual(commercial.members.map((p) => p.id), [eve.id]);
    assert.deepEqual(commercial.children.map((c) => c.unit.name), ['Sales', 'Service']);
    const sales = commercial.children[0]!;
    assert.equal(sales.lead?.id, ana.id);
    assert.deepEqual(sales.members.map((p) => p.id), [dee.id], 'the CEO and the lead are not members');
    const north = sales.children[0]!;
    assert.equal(north.lead?.id, cy.id);
    assert.deepEqual(north.members.map((p) => p.id), [bo.id]);
    assert.equal(sales.count, 4);
    assert.equal(commercial.count, 5);
    assert.deepEqual(chart.noUnit.map((p) => p.id), [free.id]);
    const everyone = [chart.roots, chart.roots.flatMap((r) => r.children), [north]].flat().flatMap((n) => [n.lead, ...n.members].filter(Boolean).map((p) => p!.id));
    assert.equal(new Set(everyone).size, everyone.length, 'nobody twice');
  });

  it('with a filter, shows only units with someone in them or below', () => {
    const chart = unitChart([bo], people, levels, units, false, ceo.id);
    assert.deepEqual(chart.roots.map((r) => r.unit.name), ['Commercial']);
    assert.deepEqual(chart.roots[0]!.children.map((c) => c.unit.name), ['Sales']);
    assert.equal(chart.roots[0]!.children[0]!.lead, null, 'a lead the filter leaves out is not shown');
    assert.deepEqual(chart.noUnit, []);
  });

  it('paths, units below, the tree order and the org rules the confirmations show', () => {
    assert.equal(unitPathLabel(units, 'north'), 'Commercial › Sales › North');
    assert.deepEqual([...unitsBelow(units, 'commercial')].sort(), ['commercial', 'north', 'sales', 'service']);
    assert.deepEqual(
      unitTree(units).map((t) => `${t.depth}:${t.unit.name}`),
      ['0:Commercial', '1:Sales', '2:North', '1:Service', '0:Operations'],
    );
    // The unit's lead, else the nearest lead above, else the CEO; never the person.
    assert.equal(managerForUnit(units, 'north', bo.id, ceo.id), cy.id);
    assert.equal(managerForUnit(units, 'north', cy.id, ceo.id), ana.id);
    assert.equal(managerForUnit(units, 'service', dee.id, ceo.id), ceo.id);
    assert.equal(managerForUnit(units, 'ops', dee.id, null), null);
    // A manager's unit: the one they lead, else their own.
    assert.equal(unitForManager(units, people, ana.id), 'sales');
    assert.equal(unitForManager(units, people, dee.id), 'sales');
    assert.equal(unitForManager(units, people, free.id), null);
  });

  it('reads the unit filter from the URL, and old department and team links too', () => {
    const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
    assert.deepEqual(unitIdsFromParams(new URLSearchParams(`unit=${id(1)},${id(2)}`)), [id(1), id(2)]);
    assert.deepEqual(unitIdsFromParams(new URLSearchParams(`dept=${id(3)}`)), [id(3)]);
    assert.deepEqual(unitIdsFromParams(new URLSearchParams(`dept=${id(3)}&team=${id(4)}`)), [id(4)]);
  });
});

describe('reportingTree', () => {
  it('puts the CEO first among several roots', () => {
    const big = person('Big');
    const r1 = person('R1', { managerId: big.id });
    const r2 = person('R2', { managerId: big.id });
    const boss = person('Boss');
    assert.equal(reportingTree([big, r1, r2, boss])[0]!.employee.id, big.id);
    assert.equal(reportingTree([big, r1, r2, boss], boss.id)[0]!.employee.id, boss.id);
  });
});
