import { describe, expect, it } from 'vitest';
import { computeStatus, factsFingerprint, opportunityReadiness, type StatusCompany, type StatusContact } from '../src/modules/crm/companies/company-status';

const complete: StatusCompany = { name: 'Vega Logistika', pib: '104532877', mb: '21345678', address: 'Bulevar 12', city: 'Beograd', postalCode: '11000', activityCode: '4941' };
const qualified: StatusContact = { fullName: 'Jelena Savić', jobTitle: 'Head of operations', buyerRole: 'Champion', ownerUserId: 'u1' };
const status = (over: Partial<Parameters<typeof computeStatus>[0]> = {}) => computeStatus({ company: complete, contacts: [qualified], opportunities: [], projects: [], ...over });

describe('opportunityReadiness (CD-358)', () => {
  it('is 7 of 7 with complete identity, address and a qualified contact', () => {
    expect(opportunityReadiness(complete, [qualified])).toEqual({ ready: 7, total: 7, blockers: [] });
  });

  it('lists what is missing, the address parts as one line', () => {
    const r = opportunityReadiness({ ...complete, mb: null, address: ' ', postalCode: null, activityCode: '' }, [qualified]);
    expect(r).toEqual({ ready: 3, total: 7, blockers: ['Matični broj', 'Address (street and postal code)', 'Šifra delatnosti'] });
  });

  it('names the contact closest to qualifying and what it misses', () => {
    const nikola: StatusContact = { fullName: 'Nikola Ilić', jobTitle: 'Managing director', buyerRole: 'Decision maker', ownerUserId: null };
    const ana: StatusContact = { fullName: 'Ana Petrović', jobTitle: null, buyerRole: null, ownerUserId: null };
    expect(opportunityReadiness(complete, [ana, nikola]).blockers).toEqual(['A contact with a job title, a role in the decision and an owner: Nikola Ilić has no owner yet.']);
    expect(opportunityReadiness(complete, [ana]).blockers[0]).toBe('A contact with a job title, a role in the decision and an owner: Ana Petrović has no job title, role in the decision or owner yet.');
    expect(opportunityReadiness(complete, []).blockers).toEqual(['A contact with a job title, a role in the decision and an owner']);
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
