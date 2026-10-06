// Unit tests of the employee card's draft and the Org structure charts (CD-225): `npm test` in
// frontend (Node's test runner, TypeScript run as is by Node 24's type stripping).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ApiDepartment, ApiEmployee, ApiTeam } from '../src/lib/api.ts';
import { changedFields, draftValues, isDirty, patchOf } from '../src/store/cardDraft.ts';
import { departmentChart, reportingTree } from '../src/store/orgChart.ts';

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
    departmentId: null,
    departmentName: null,
    teamId: null,
    teamName: null,
    managerId: null,
    managerName: null,
    workEmail: null,
    workPhone: null,
    workLocation: null,
    status: 'active',
    ...extra,
  } as ApiEmployee;
}
const dept = (id: string, name: string, headEmployeeId: string | null = null) => ({ id, name, code: null, headEmployeeId, headName: null, teams: 0, activeEmployees: 0 }) as unknown as ApiDepartment;
const team = (id: string, departmentId: string, name: string, leadEmployeeId: string | null = null) => ({ id, departmentId, name, leadEmployeeId, leadName: null, leadOutside: false, activeEmployees: 0 }) as unknown as ApiTeam;

describe('departmentChart', () => {
  const ana = person('Ana', { departmentId: 'sales' });
  const bo = person('Bo', { departmentId: 'sales', teamId: 'north' });
  const cy = person('Cy', { departmentId: 'sales', teamId: 'north' });
  const dee = person('Dee', { departmentId: 'sales' });
  const ceo = person('Ceo', { departmentId: 'sales' });
  const people = [ana, bo, cy, dee, ceo];
  const departments = [dept('sales', 'Sales', ana.id)];
  const teams = [team('north', 'sales', 'North', cy.id)];

  it('shows the head once, at the top: not in "No team" or a team box', () => {
    const [sales] = departmentChart(people, people, departments, teams, true);
    assert.equal(sales!.head?.id, ana.id);
    const shown = sales!.teams.flatMap((t) => t.people.map((p) => p.id));
    assert.ok(!shown.includes(ana.id), 'head not repeated');
    assert.equal(new Set(shown).size, shown.length, 'nobody twice');
    assert.equal(sales!.count, 5);
  });

  it('puts the lead first in their team', () => {
    const [sales] = departmentChart(people, people, departments, teams, true);
    const north = sales!.teams.find((t) => t.team?.id === 'north')!;
    assert.deepEqual(north.people.map((p) => p.id), [cy.id, bo.id]);
    assert.equal(north.leadId, cy.id);
  });

  it('leaves the CEO out of the departments (they sit in the company node)', () => {
    const [sales] = departmentChart(people, people, departments, teams, true, ceo.id);
    assert.ok(!sales!.teams.some((t) => t.people.some((p) => p.id === ceo.id)));
    assert.equal(sales!.count, 4);
    // A CEO who also heads a department is not shown as its head.
    const [headed] = departmentChart(people, people, [dept('sales', 'Sales', ceo.id)], teams, true, ceo.id);
    assert.equal(headed!.head, null);
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
