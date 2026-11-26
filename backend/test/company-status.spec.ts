import { describe, expect, it } from 'vitest';
import { computeStatus, countsInDecision, factsFingerprint, opportunityReadiness, type StatusCompany, type StatusContact } from '../src/modules/crm/companies/company-status';

const complete: StatusCompany = { name: 'Vega Logistika', pib: '104532877', mb: '21345678', address: 'Bulevar 12', city: 'Beograd', postalCode: '11000', activityCode: '4941', ownerUserId: 'u0' };
const qualified: StatusContact = { fullName: 'Jelena Savić', jobTitle: 'Head of operations', buyerRole: 'Champion', ownerUserId: 'u1' };
const status = (over: Partial<Parameters<typeof computeStatus>[0]> = {}) => computeStatus({ company: complete, contacts: [qualified], opportunities: [], projects: [], ...over });

describe('opportunityReadiness (CD-358)', () => {
  it('is 7 of 7 with complete identity, address and a qualified contact', () => {
    expect(opportunityReadiness(complete, [qualified])).toEqual({ ready: 7, total: 7, blockers: [] });
  });

  it('lists what is missing, the address parts as one line', () => {
    const r = opportunityReadiness({ ...complete, mb: null, address: ' ', postalCode: null, activityCode: '' }, [qualified]);
    expect(r).toEqual({ ready: 4, total: 7, blockers: ['Matični broj', 'Address (street and postal code)', 'Šifra delatnosti'] });
  });

  it('counts the company owner and the name as checks (CD-533)', () => {
    expect(opportunityReadiness({ ...complete, ownerUserId: null }, [qualified])).toEqual({ ready: 6, total: 7, blockers: ['Company owner'] });
    expect(opportunityReadiness({ ...complete, name: ' ' }, [qualified]).blockers).toEqual(['Name']);
    expect(computeStatus({ company: { ...complete, ownerUserId: null }, contacts: [qualified], opportunities: [], projects: [] })).toBe('lead');
  });

  it('counts a contact by its role in the decision alone (CD-534): not involved or no role does not count', () => {
    const noTitleNoOwner: StatusContact = { fullName: 'Nikola Ilić', jobTitle: null, buyerRole: 'User', ownerUserId: null };
    const notInvolved: StatusContact = { fullName: 'Ana Petrović', jobTitle: 'CFO', buyerRole: 'Not involved', ownerUserId: 'u1' };
    const noRole: StatusContact = { fullName: 'Marko Stanić', jobTitle: 'Purchasing', buyerRole: null, ownerUserId: 'u1' };
    expect(opportunityReadiness(complete, [noTitleNoOwner]).blockers).toEqual([]);
    for (const role of ['Decision maker', 'Signs off budget', 'Influencer', 'User', 'Economic buyer', 'Champion', 'Gatekeeper', 'End user']) expect(countsInDecision(role)).toBe(true);
    expect(countsInDecision('Not involved')).toBe(false);
    expect(countsInDecision(null)).toBe(false);
    expect(countsInDecision('  ')).toBe(false);
    // The one without a role is named first (picking a role is the smallest step), else whoever is not involved.
    expect(opportunityReadiness(complete, [notInvolved, noRole]).blockers).toEqual(['A contact with a role in the decision: Marko Stanić has no role yet.']);
    expect(opportunityReadiness(complete, [notInvolved]).blockers).toEqual(['A contact with a role in the decision: Ana Petrović is not involved.']);
    expect(opportunityReadiness(complete, []).blockers).toEqual(['A contact with a role in the decision']);
    expect(computeStatus({ company: complete, contacts: [notInvolved, noRole], opportunities: [], projects: [] })).toBe('lead');
    expect(computeStatus({ company: complete, contacts: [notInvolved, noTitleNoOwner], opportunities: [], projects: [] })).toBe('opportunity');
  });
});

describe('computeStatus (CD-358)', () => {
  it('is a lead while something is missing, an opportunity once nothing is', () => {
    expect(status({ company: { ...complete, pib: null } })).toBe('lead');
    expect(status({ contacts: [] })).toBe('lead');
    expect(status()).toBe('opportunity');
    expect(status({ opportunities: ['open'] })).toBe('opportunity');
    expect(status({ company: { ...complete, mb: null }, opportunities: ['open'] })).toBe('lead');
  });

  it('becomes a client once an opportunity is won or a project exists, whatever is missing', () => {
    expect(status({ opportunities: ['won'] })).toBe('client');
    expect(status({ company: { ...complete, pib: null }, contacts: [], opportunities: ['lost', 'won'] })).toBe('client');
    expect(status({ projects: ['open'] })).toBe('client');
    expect(status({ projects: ['cancelled'] })).toBe('opportunity');
  });

  it('is a past client when its last project is completed and nothing is open', () => {
    expect(status({ opportunities: ['won'], projects: ['completed'] })).toBe('past_client');
    expect(status({ opportunities: ['won'], projects: ['completed', 'cancelled'] })).toBe('past_client');
    expect(status({ opportunities: ['won', 'open'], projects: ['completed'] })).toBe('client');
    expect(status({ opportunities: ['won'], projects: ['completed', 'open'] })).toBe('client');
    // Won without any project yet stays a client.
    expect(status({ opportunities: ['won'] })).toBe('client');
  });

  it('is not interested when every opportunity was lost', () => {
    expect(status({ opportunities: ['lost', 'lost'] })).toBe('not_interested');
    expect(status({ opportunities: ['lost', 'open'] })).toBe('opportunity');
    expect(status({ company: { ...complete, pib: null }, opportunities: ['lost'] })).toBe('not_interested');
  });
});

describe('factsFingerprint: what a status set by hand is held against (CD-478)', () => {
  const facts = (over: Partial<Parameters<typeof computeStatus>[0]> = {}) => factsFingerprint({ company: complete, contacts: [qualified], opportunities: [], projects: [], ...over });

  it('stays the same while nothing that moves the status changes', () => {
    expect(facts({ opportunities: ['won', 'open'] })).toBe(facts({ opportunities: ['open', 'won'], company: { ...complete, name: 'Renamed' } }));
  });

  it('changes with an opportunity won, lost or added, a project, or the readiness', () => {
    const base = facts({ opportunities: ['open'] });
    expect(facts({ opportunities: ['won'] })).not.toBe(base);
    expect(facts({ opportunities: ['open', 'open'] })).not.toBe(base);
    expect(facts({ opportunities: ['open'], projects: ['open'] })).not.toBe(base);
    expect(facts({ opportunities: ['open'], company: { ...complete, mb: null } })).not.toBe(base);
  });
});
