/**
 * Automatic company status (CD-358), as plain rules. The status is computed from the company's data
 * and what happened with it, never picked: Lead until its identity, address and a qualified contact
 * are complete, then Opportunity; Client once an opportunity is won (or it has a project); Past client
 * when its last project is completed and nothing is open; Not interested when every opportunity was
 * lost. A person can only set it back (a lower rank); the automation then never raises it again until
 * "Back to automatic", but still lowers it when the facts no longer support it.
 */
import { COMPANY_STATUSES, type CompanyStatus } from '../../../shared/database/schema';

export { COMPANY_STATUSES, type CompanyStatus };

/** Lower is further back. Setting a status by hand is only allowed to a lower rank. */
export const STATUS_RANK: Record<CompanyStatus, number> = { not_interested: 0, lead: 1, opportunity: 2, past_client: 3, client: 4 };

export const STATUS_LABELS: Record<CompanyStatus, string> = {
  lead: 'Lead',
  opportunity: 'Opportunity',
  client: 'Client',
  past_client: 'Past client',
  not_interested: 'Not interested',
};

export interface StatusCompany {
  name: string;
  pib: string | null;
  mb: string | null;
  address: string | null;
  city: string | null;
  postalCode: string | null;
  activityCode: string | null;
}

export interface StatusContact {
  fullName: string;
  jobTitle: string | null;
  buyerRole: string | null;
  ownerUserId: string | null;
}

/** An opportunity of the company: open (neither won nor lost), won or lost. */
export type OpportunityState = 'open' | 'won' | 'lost';
export type ProjectState = 'open' | 'completed' | 'cancelled';

/** What a lead still needs before it becomes an opportunity: 7 checks, and the messages to show. */
export interface Readiness {
  /** How many of the 7 checks pass ("3 of 7 ready"). */
  ready: number;
  total: number;
  blockers: string[];
}

const filled = (v: string | null | undefined) => !!v && v.trim() !== '';

/** The contact closest to qualifying, and what it still misses (job title, role in the decision, owner). */
function contactBlocker(contacts: StatusContact[]): string | null {
  const missing = (c: StatusContact) => [!filled(c.jobTitle) && 'job title', !filled(c.buyerRole) && 'role in the decision', !c.ownerUserId && 'owner'].filter((m): m is string => !!m);
  if (contacts.some((c) => missing(c).length === 0)) return null;
  const want = 'A contact with a job title, a role in the decision and an owner';
  const best = [...contacts].sort((a, b) => missing(a).length - missing(b).length)[0];
  if (!best) return want;
  const gaps = missing(best);
  const list = gaps.length > 1 ? `${gaps.slice(0, -1).join(', ')} or ${gaps[gaps.length - 1]}` : gaps[0];
  return `${want}: ${best.fullName} has no ${list} yet.`;
}

/** The 7 checks: PIB, matični broj, street, city, postal code, šifra delatnosti and a qualified contact. */
export function opportunityReadiness(company: StatusCompany, contacts: StatusContact[]): Readiness {
  const address = [!filled(company.address) && 'street', !filled(company.city) && 'city', !filled(company.postalCode) && 'postal code'].filter((p): p is string => !!p);
  const contact = contactBlocker(contacts);
  // The address is three of the checks, shown as one line.
  const checks: [missing: number, message: string][] = [
    [filled(company.pib) ? 0 : 1, 'Company ID (PIB)'],
    [filled(company.mb) ? 0 : 1, 'Matični broj'],
    [address.length, `Address (${address.length > 1 ? `${address.slice(0, -1).join(', ')} and ${address[address.length - 1]}` : address[0]})`],
    [filled(company.activityCode) ? 0 : 1, 'Šifra delatnosti'],
    [contact ? 1 : 0, contact ?? ''],
  ];
  const failed = checks.reduce((n, [missing]) => n + missing, 0);
  return { ready: 7 - failed, total: 7, blockers: checks.filter(([missing]) => missing > 0).map(([, message]) => message) };
}

/** The status the facts support. */
export function computeStatus(input: { company: StatusCompany; contacts: StatusContact[]; opportunities: OpportunityState[]; projects: ProjectState[] }): CompanyStatus {
  const { opportunities: opps, projects } = input;
  const wasClient = opps.includes('won') || projects.some((p) => p !== 'cancelled');
  if (wasClient) {
    const active = opps.includes('open') || projects.includes('open');
    return !active && projects.includes('completed') ? 'past_client' : 'client';
  }
  if (opps.length > 0 && opps.every((o) => o === 'lost')) return 'not_interested';
  return opportunityReadiness(input.company, input.contacts).blockers.length ? 'lead' : 'opportunity';
}

/**
 * The status to keep. Automatic: what the facts support. Set by hand: the hand-set status, unless
 * the facts no longer support even that (then the lower, computed one).
 */
export function effectiveStatus(computed: CompanyStatus, manual: CompanyStatus | null): CompanyStatus {
  if (!manual) return computed;
  return STATUS_RANK[computed] < STATUS_RANK[manual] ? computed : manual;
}
