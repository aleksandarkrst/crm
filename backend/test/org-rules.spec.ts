import { BadRequestException, ConflictException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { lostLeads, leadMoveMessage } from '../src/modules/people/heads';
import {
  ancestorsOf,
  cloneSnapshot,
  loopPath,
  managerForLead,
  managerForUnit,
  type OrgSnapshot,
  planCeo,
  planChanges,
  planFillManagers,
  planLead,
  planUnitMoved,
  unitAndBelow,
  unitForManager,
} from '../src/modules/people/org-rules';

/**
 * The org rules of CD-226 on a small company:
 *
 *   CEO (no unit)
 *   Sales (lead: sam)            → Field sales (lead: fiona) → North (no lead)
 *                                → Inside sales (no lead)
 *   Service (no lead)
 */
function company(): OrgSnapshot {
  const person = (id: string, unitId: string | null, managerId: string | null, active = true) => [id, { id, fullName: id[0]!.toUpperCase() + id.slice(1), unitId, managerId, active }] as const;
  const unit = (id: string, parentId: string | null, leadId: string | null) => [id, { id, name: id, parentId, leadId }] as const;
  return {
    people: new Map([
      person('ceo', null, null),
      person('sam', 'sales', 'ceo'),
      person('fiona', 'field', 'sam'),
      person('nina', 'north', null),
      person('ivan', 'inside', null),
      person('sara', null, null),
      person('olga', 'service', null),
      person('gone', null, null, false),
    ]),
    units: new Map([unit('sales', null, 'sam'), unit('field', 'sales', 'fiona'), unit('north', 'field', null), unit('inside', 'sales', null), unit('service', null, null)]),
    ceoId: 'ceo',
  };
}

describe('the unit tree', () => {
  it('ancestors nearest first, a unit and everything below it', () => {
    const s = company();
    expect(ancestorsOf(s, 'north').map((u) => u.id)).toEqual(['field', 'sales']);
    expect(ancestorsOf(s, 'sales')).toEqual([]);
    expect([...unitAndBelow(s, 'sales')].sort()).toEqual(['field', 'inside', 'north', 'sales']);
  });
});

describe('managerForUnit', () => {
  it("is the unit's lead, else the nearest lead above, else the CEO", () => {
    const s = company();
    expect(managerForUnit(s, 'field', 'nina')).toBe('fiona');
    expect(managerForUnit(s, 'north', 'nina')).toBe('fiona');
    expect(managerForUnit(s, 'inside', 'ivan')).toBe('sam');
    expect(managerForUnit(s, 'service', 'olga')).toBe('ceo');
  });

  it('never the person themselves: a lead of the unit gets the lead above', () => {
    const s = company();
    expect(managerForUnit(s, 'field', 'fiona')).toBe('sam');
    expect(managerForUnit(s, 'sales', 'sam')).toBe('ceo');
  });

  it('skips a lead who left and one that would close a loop; nobody when there is nobody', () => {
    const s = company();
    s.people.get('fiona')!.active = false;
    expect(managerForUnit(s, 'north', 'nina')).toBe('sam');
    // Sam reports to Nina: Sam can't be Nina's manager, and the CEO reports to nobody.
    s.people.get('sam')!.managerId = 'nina';
    expect(managerForUnit(s, 'north', 'nina')).toBe('ceo');
    s.ceoId = null;
    expect(managerForUnit(s, 'north', 'nina')).toBeNull();
  });

  it('the CEO never gets a manager automatically', () => {
    expect(managerForUnit(company(), 'sales', 'ceo')).toBeNull();
  });

  it("a lead's manager comes from above their unit only", () => {
    const s = company();
    expect(managerForLead(s, 'field', 'fiona')).toBe('sam');
    expect(managerForLead(s, 'sales', 'sam')).toBe('ceo');
  });
});

describe('planChanges', () => {
  it('unit set: the manager becomes the lead of the new unit', () => {
    const s = company();
    const [c] = planChanges(s, [{ employeeId: 'sara', unitId: 'field' }]);
    expect(c).toMatchObject({ fromUnitId: null, unitId: 'field', fromManagerId: null, managerId: 'fiona' });
    expect(s.people.get('sara')).toMatchObject({ unitId: 'field', managerId: 'fiona' });
  });

  it('unit set without anyone above keeps the manager; the same unit changes nothing', () => {
    const s = company();
    s.ceoId = null;
    expect(planChanges(s, [{ employeeId: 'olga', unitId: 'service' }])[0]).toMatchObject({ unitId: 'service', managerId: null });
    s.people.get('olga')!.managerId = 'sam';
    expect(planChanges(s, [{ employeeId: 'olga', unitId: 'service' }])[0]).toMatchObject({ managerId: 'sam' });
    expect(planChanges(s, [{ employeeId: 'olga', unitId: null }])[0]).toMatchObject({ unitId: null, managerId: 'sam' });
  });

  it('manager set: the unit becomes the one the manager leads, else the manager’s own', () => {
    const s = company();
    expect(planChanges(s, [{ employeeId: 'sara', managerId: 'fiona' }])[0]).toMatchObject({ unitId: 'field', managerId: 'fiona' });
    expect(planChanges(s, [{ employeeId: 'olga', managerId: 'nina' }])[0]).toMatchObject({ unitId: 'north', managerId: 'nina' });
    // The CEO has no unit: the unit stays.
    expect(planChanges(s, [{ employeeId: 'ivan', managerId: 'ceo' }])[0]).toMatchObject({ unitId: 'inside', managerId: 'ceo' });
    // Removing a manager keeps the unit.
    expect(planChanges(s, [{ employeeId: 'ivan', managerId: null }])[0]).toMatchObject({ unitId: 'inside', managerId: null });
  });

  it('a lead stays in the unit they lead whoever they report to', () => {
    const s = company();
    expect(planChanges(s, [{ employeeId: 'fiona', managerId: 'olga' }])[0]).toMatchObject({ unitId: 'field', managerId: 'olga' });
  });

  it('explicit wins: a change that sets both keeps both', () => {
    const s = company();
    expect(planChanges(s, [{ employeeId: 'sara', unitId: 'service', managerId: 'fiona' }])[0]).toMatchObject({ unitId: 'service', managerId: 'fiona' });
  });

  it('refuses yourself (400), someone who left (400) and a loop (409, naming it); unknown units and people', () => {
    const s = company();
    expect(() => planChanges(s, [{ employeeId: 'sam', managerId: 'sam' }])).toThrow(BadRequestException);
    expect(() => planChanges(s, [{ employeeId: 'sam', managerId: 'gone' }])).toThrow(BadRequestException);
    expect(() => planChanges(s, [{ employeeId: 'gone', unitId: 'sales' }])).toThrow('Gone has left the company');
    expect(() => planChanges(s, [{ employeeId: 'sara', unitId: 'nowhere' }])).toThrow('Unit not found');
    try {
      planChanges(company(), [{ employeeId: 'sam', managerId: 'fiona' }]);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ConflictException);
      expect((err as ConflictException).getResponse()).toMatchObject({ code: 'reporting_loop', message: 'This would create a loop: Sam → Fiona → Sam' });
    }
  });

  it('checks each change against the ones before it (a loop built step by step)', () => {
    const s = company();
    expect(() => planChanges(s, [{ employeeId: 'sara', managerId: 'olga' }, { employeeId: 'olga', managerId: 'sara' }])).toThrow(ConflictException);
  });

  it('a derived manager never closes a loop', () => {
    const s = company();
    // Fiona reports to Sara; Sara moves into Field sales, which Fiona leads: Sam (above) instead.
    s.people.get('fiona')!.managerId = 'sara';
    expect(planChanges(s, [{ employeeId: 'sara', unitId: 'field' }])[0]).toMatchObject({ unitId: 'field', managerId: 'sam' });
  });
});

describe('leads move (heads.ts)', () => {
  it('a change that takes a lead out of their unit is a lost role, named in the message', () => {
    const s = company();
    const planned = planChanges(cloneSnapshot(s), [{ employeeId: 'fiona', unitId: 'service' }, { employeeId: 'sara', unitId: 'service' }]);
    const lost = lostLeads(s, planned);
    expect(lost).toEqual([{ employeeId: 'fiona', fullName: 'Fiona', unit: { id: 'field', name: 'field' }, toUnitId: 'service' }]);
    expect(leadMoveMessage(s, lost)).toBe('Fiona is lead of field. Moving them to service removes them as lead of field.');
    expect(lostLeads(s, planChanges(cloneSnapshot(s), [{ employeeId: 'fiona', managerId: 'olga' }]))).toEqual([]);
  });
});

describe('planLead (a new unit lead)', () => {
  it('in a CEO-only company: the new lead reports to the CEO', () => {
    const s: OrgSnapshot = {
      people: new Map([
        ['ceo', { id: 'ceo', fullName: 'Ceo', unitId: null, managerId: null, active: true }],
        ['tom', { id: 'tom', fullName: 'Tom', unitId: null, managerId: null, active: true }],
      ]),
      units: new Map([['team', { id: 'team', name: 'Team', parentId: null, leadId: null }]]),
      ceoId: 'ceo',
    };
    expect(planLead(s, 'team', 'tom')).toEqual({ changes: [{ employeeId: 'tom', unitId: 'team', managerId: 'ceo' }], loops: [] });
  });

  it('joins the unit, reports to the lead above; members without a manager or of the previous lead now report to them', () => {
    const s = company();
    s.people.get('nina')!.managerId = null;
    const { changes, loops } = planLead(s, 'north', 'sara');
    expect(changes).toEqual([
      { employeeId: 'sara', unitId: 'north', managerId: 'fiona' },
      { employeeId: 'nina', managerId: 'sara' },
    ]);
    expect(loops).toEqual([]);
  });

  it("replacing a lead: the previous lead's reports and the leads of units right below follow", () => {
    const s = company();
    // Fiona (lead of Field sales, inside Sales) reports to Sam; Ivan in Inside sales reports to nobody.
    s.people.get('ivan')!.managerId = null;
    const { changes } = planLead(s, 'sales', 'olga');
    expect(changes).toEqual([
      { employeeId: 'olga', unitId: 'sales', managerId: 'ceo' },
      { employeeId: 'fiona', managerId: 'olga' },
    ]);
  });

  it('someone for whom it would close a loop keeps their manager and is listed', () => {
    const s = company();
    // Sara will lead North; she reports to Nina, a member without a manager.
    s.people.get('sara')!.managerId = 'nina';
    const { changes, loops } = planLead(s, 'north', 'sara');
    expect(changes).toEqual([{ employeeId: 'sara', unitId: 'north', managerId: 'fiona' }, { employeeId: 'nina', managerId: 'sara' }]);
    expect(loops).toEqual([]);
    // Now the lead keeps a manager who is a member: that member can't report to the lead.
    const t = company();
    t.ceoId = null;
    t.units.get('sales')!.leadId = null;
    t.units.get('field')!.leadId = null;
    t.people.get('sara')!.managerId = 'nina';
    const second = planLead(t, 'north', 'sara');
    expect(second.changes).toEqual([{ employeeId: 'sara', unitId: 'north', managerId: 'nina' }]);
    expect(second.loops).toEqual([{ id: 'nina', fullName: 'Nina', message: 'This would create a loop: Nina → Sara → Nina' }]);
  });

  it('no lead changes nobody', () => {
    expect(planLead(company(), 'north', null)).toEqual({ changes: [], loops: [] });
  });
});

describe('planCeo and planUnitMoved', () => {
  it('a new CEO manages the leads of the top units who have none', () => {
    const s = company();
    s.people.get('sam')!.managerId = null;
    s.units.get('service')!.leadId = 'olga';
    expect(planCeo(s, 'sara')).toEqual([
      { employeeId: 'sam', managerId: 'sara' },
      { employeeId: 'olga', managerId: 'sara' },
    ]);
    expect(planCeo(s, 'gone')).toEqual([]);
  });

  it('the new CEO reports to nobody, so a lead they reported to can report to them (CD-228)', () => {
    // Sara reported to Sam, the lead of Sales; Sara becomes the CEO.
    const s = company();
    s.people.get('sara')!.managerId = 'sam';
    s.people.get('sam')!.managerId = null;
    const changes = planCeo(s, 'sara', 'ceo');
    expect(changes).toEqual([
      { employeeId: 'sara', managerId: null },
      { employeeId: 'sam', managerId: 'sara' },
    ]);
    planChanges(s, changes);
    expect([s.people.get('sara')!.managerId, s.people.get('sam')!.managerId]).toEqual([null, 'sara']);
  });

  it('fills in missing managers by the rules; units stay, people without a unit are left alone (CD-228)', () => {
    const s = company();
    s.people.get('sam')!.managerId = null;
    s.people.get('fiona')!.managerId = null;
    // Nina is in North (no lead): Fiona, the lead above. Ivan in Inside sales (no lead): Sam.
    // Olga in Service (no lead, nothing above): the CEO. Sara has no unit: unchanged.
    const changes = planFillManagers(s);
    expect(changes).toEqual([
      { employeeId: 'sam', unitId: 'sales', managerId: 'ceo' },
      { employeeId: 'fiona', unitId: 'field', managerId: 'sam' },
      { employeeId: 'olga', unitId: 'service', managerId: 'ceo' },
      { employeeId: 'ivan', unitId: 'inside', managerId: 'sam' },
      { employeeId: 'nina', unitId: 'north', managerId: 'fiona' },
    ]);
    planChanges(s, changes);
    expect(s.people.get('nina')!.unitId).toBe('north');
    expect(s.people.get('sara')!.managerId).toBeNull();
    // Nothing left to fill.
    expect(planFillManagers(s)).toEqual([]);
  });

  it("leads who reported to the previous CEO move to the new one; a lead's own choice stays", () => {
    const s = company();
    s.units.get('service')!.leadId = 'olga';
    s.people.get('olga')!.managerId = 'ivan';
    // Sam reported to the old CEO, Olga to Ivan.
    expect(planCeo(s, 'sara', 'ceo')).toEqual([{ employeeId: 'sam', managerId: 'sara' }]);
    // Without the previous CEO, only leads with no manager move.
    expect(planCeo(s, 'sara')).toEqual([]);
  });

  it("a moved unit's lead follows the lead above the new place if they reported to the one above the old", () => {
    const before = company();
    before.units.get('service')!.leadId = 'olga';
    const after = cloneSnapshot(before);
    after.units.get('field')!.parentId = 'service';
    expect(planUnitMoved(before, after, 'field')).toEqual([{ employeeId: 'fiona', managerId: 'olga' }]);
    // A lead who reports to someone else keeps them.
    before.people.get('fiona')!.managerId = 'ivan';
    after.people.get('fiona')!.managerId = 'ivan';
    expect(planUnitMoved(before, after, 'field')).toEqual([]);
  });
});

describe('helpers', () => {
  it('loopPath names the chain; unitForManager prefers the unit they lead', () => {
    const s = company();
    expect(loopPath(s, 'sam', 'fiona')).toEqual(['Sam', 'Fiona', 'Sam']);
    expect(loopPath(s, 'fiona', 'sam')).toBeNull();
    s.people.get('fiona')!.unitId = 'north';
    expect(unitForManager(s, 'fiona')).toBe('field');
    expect(unitForManager(s, 'nina')).toBe('north');
    expect(unitForManager(s, 'ceo')).toBeNull();
  });
});
