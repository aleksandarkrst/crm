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
