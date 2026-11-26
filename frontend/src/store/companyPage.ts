// The company page's words and checks (CD-534, board C-Company): the status tag and meta line, what
// a field's value must look like, and the toast when a lead's "+ Opportunity" is pressed. Pure (no
// React, no store imports), so it is unit-tested with Node's runner (test/companyPage.test.ts).
import { mbValid, pibValid } from '../lib/serbianIds.ts';
import type { CompanyStatus } from './types';

export const STATUS_TAG_LABELS: Record<CompanyStatus, string> = { lead: 'Lead', opportunity: 'Opportunity', client: 'Client', past_client: 'Past client', not_interested: 'Not interested' };
/** The status tag's colour class (CD-530): Lead amber, Opportunity blue, Client green, Past client grey, Not interested red. */
export const STATUS_TAG_TONE: Record<CompanyStatus, string> = { lead: 'amber', opportunity: 'blue', client: 'green', past_client: '', not_interested: 'red' };

/** "Lead, automatic" or "Not interested, set by hand". */
export const statusTagText = (status: CompanyStatus, manual: boolean): string => `${STATUS_TAG_LABELS[status]}, ${manual ? 'set by hand' : 'automatic'}`;

/**
 * The line under the name: "N of 7 ready, owner Ana" for a lead, "Ready for the Pipeline, owner Ana"
 * for an opportunity (and a client or past client, who can take one too); "owner Ana" otherwise.
 */
export function metaLine(status: CompanyStatus, ready: { ready: number; total: number }, owner: string | null): string {
  const who = owner ? `owner ${owner}` : 'no owner';
  if (status === 'lead') return `${ready.ready} of ${ready.total} ready, ${who}`;
  if (status === 'opportunity' || status === 'client' || status === 'past_client') return `Ready for the Pipeline, ${who}`;
  return who.charAt(0).toUpperCase() + who.slice(1);
}

/** The toast when "+ Opportunity" is pressed on a lead: what is still missing (the banner's tags). */
export const missingToast = (missing: string[]): string => (missing.length ? `Complete the company first. Missing: ${missing.join(', ')}.` : 'Complete the company first.');

/** The banner's first line: "3 of 7 ready. Missing: PIB, MB." */
export const readyLine = (ready: { ready: number; total: number }, missing: string[]): string => `${ready.ready} of ${ready.total} ready.${missing.length ? ` Missing: ${missing.join(', ')}.` : ''}`;

export type CompanyTextField = 'name' | 'pib' | 'mb' | 'address' | 'city' | 'postalCode' | 'activityCode' | 'hq';
/** The fields a lead needs for Opportunity, with the "Needed for Opportunity" hint while empty. */
export const NEEDED_FIELDS: readonly CompanyTextField[] = ['pib', 'mb', 'address', 'city', 'postalCode', 'activityCode'];

/**
 * What is wrong with a value typed into a field, in the board's words; null when it can be saved.
 * PIB 9 digits, MB 8, postal code 5, activity code 4 (digits only; spaces are dropped); a PIB or an
 * MB whose check digit fails names that too, as the API refuses it. An empty value is fine except
 * for the name, which a company can't lose.
 */
export function fieldProblem(field: CompanyTextField, raw: string): string | null {
  const v = field === 'name' || field === 'address' || field === 'city' || field === 'hq' ? raw.trim() : raw.replace(/\s/g, '');
  if (field === 'name') return v ? null : 'A company needs a name.';
  if (!v) return null;
  switch (field) {
    case 'pib':
      if (!/^\d{9}$/.test(v)) return 'A PIB has 9 digits.';
      return pibValid(v) ? null : 'This PIB fails its check digit. Check it for a typo.';
    case 'mb':
      if (!/^\d{8}$/.test(v)) return 'An MB has 8 digits.';
      return mbValid(v) ? null : "This MB's last digit doesn't match the first seven. Check it for a typo.";
    case 'postalCode':
      return /^\d{5}$/.test(v) ? null : 'A postal code has 5 digits.';
    case 'activityCode':
      return /^\d{4}$/.test(v) ? null : 'An activity code has 4 digits.';
    default:
      return null;
  }
}

/** The value as it is saved: ids and codes without spaces, text trimmed of nothing (typing continues). */
export const cleanValue = (field: CompanyTextField, raw: string): string => (field === 'pib' || field === 'mb' || field === 'postalCode' || field === 'activityCode' ? raw.replace(/\s/g, '') : raw);

/** "[job title], [email]" under a contact's name, or what to fill in. */
export const contactLine = (jobTitle: string | undefined, email: string | undefined): string => [jobTitle, email].map((x) => (x && x !== '—' ? x.trim() : '')).filter(Boolean).join(', ') || 'No title or email yet';

/** The Details card's Opportunities line: a lead can't take one (a lead set back by hand may still have some); otherwise the count (linked by the page). */
export function opportunitiesLine(status: CompanyStatus, count: number): string {
  if (status === 'lead' && count === 0) return 'None. Leads cannot have one.';
  if (count === 0) return 'None yet';
  return count === 1 ? '1 opportunity' : `${count} opportunities`;
}
