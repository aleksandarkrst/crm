import type { Lead, Person } from './types';

/**
 * The Person a lead's primary contact is shown as (selectors.ts allPeople). Their company is the
 * contact row's own, never the opportunity's: a contact moved to another company (the New company
 * dialog, the contact page) belongs to, and counts for, the company they moved to, whatever deal
 * still names them (CD-533, QA 4e). Pure, so it is unit-tested with Node's runner (test/companyPeople.test.ts).
 */
export function primaryPerson(l: Lead): Person {
  return {
    id: l.id + ':p',
    leadId: l.id,
    contactId: l.contactId ?? undefined,
    companyId: l.contactCompanyId ?? null,
    company: l.contactCompany,
    primary: true,
    name: l.contact,
    role: l.role,
    email: l.email,
    phone: l.phone,
    initials: l.initials,
    // No guessed role: an empty one is what the "No role in decision" badge is for (CD-361).
    buyerRole: l.buyerRole ?? '',
    linkedin: l.contactLinkedin ?? '',
    notes: l.contactNotes ?? '',
    ownerId: l.contactOwnerId,
    ownerName: l.contactOwner,
    ...l.contactExtra,
  };
}

/**
 * The people a company shows (CD-518): its own contacts, then the contacts on its opportunities,
 * each person once. The Companies list's Contacts count and the company page both use this rule
 * (selectors.ts companyPeople). Pure (no React, no store), so it is unit-tested with Node's runner
 * (test/companyPeople.test.ts).
 */
export function uniquePeople<P extends { id: string; contactId?: string }>(own: readonly P[], onOpportunities: readonly (readonly P[])[]): P[] {
  const people: P[] = [];
  const seen = new Set<string>();
  for (const p of [own, ...onOpportunities].flat()) {
    // A primary contact's id is "<deal>:p"; the backend contact id is what makes it the same person.
    const key = p.contactId || p.id;
    if (seen.has(key)) continue;
    seen.add(key);
    people.push(p);
  }
  return people;
}
