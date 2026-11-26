// The Companies Kanban (CD-359): readiness of a lead and what a drop between status columns does.
// Pure (no React, no store imports), so it is unit-tested with Node's runner (test/companyBoard.test.ts).
import type { CompanyStatus } from './types';

export interface ReadinessCompany {
  name?: string | null;
  /** The company's owner (CD-533). */
  ownerId?: string | null;
  pib?: string | null;
  mb?: string | null;
  address?: string | null;
  city?: string | null;
  postalCode?: string | null;
  activityCode?: string | null;
}
export interface ReadinessContact {
  name: string;
  role?: string;
  buyerRole?: string;
  ownerId?: string | null;
}

const filled = (v: string | null | undefined) => !!v && v.trim() !== '';
const list = (items: string[], and: string) => (items.length > 1 ? `${items.slice(0, -1).join(', ')} ${and} ${items[items.length - 1]}` : (items[0] ?? ''));

/** The one role in the decision that doesn't count (CD-534). */
export const NOT_INVOLVED = 'Not involved';
/** Whether a contact has a role in the decision (CD-534): any role but "Not involved"; none doesn't count. */
export const countsInDecision = (buyerRole: string | null | undefined): boolean => filled(buyerRole) && buyerRole!.trim() !== NOT_INVOLVED;

/** The seven checks as the readiness banner tags them (CD-534), in order. */
export const READINESS_TAGS = ['Name', 'PIB', 'MB', 'Address', 'Activity code', 'Owner', 'A contact with a role in the decision'] as const;

export interface ReadinessResult {
  ready: number;
  total: number;
  /** The company page's sentences for what is missing. */
  blockers: string[];
  /** The card's short words for what is missing. */
  missing: string[];
  /** Each of READINESS_TAGS, done or not. */
  done: boolean[];
}

/**
 * What a lead still needs before it becomes an opportunity, as the API checks it
 * (opportunityReadiness in crm/companies/company-status.ts): 7 checks (CD-533), each counted once:
 * name, PIB, MB, address (street, city and postal code), activity code, owner and a contact with a
 * role in the decision (CD-534: any role but "Not involved"; a job title or an owner isn't needed).
 */
export function readiness(c: ReadinessCompany | undefined, people: ReadinessContact[]): ReadinessResult {
  const address = [!filled(c?.address) && 'street', !filled(c?.city) && 'city', !filled(c?.postalCode) && 'postal code'].filter((x): x is string => !!x);
  let contact: string | null = null;
  let contactShort = '';
  if (!people.some((p) => countsInDecision(p.buyerRole))) {
    const want = 'A contact with a role in the decision';
    // The one without any role first: picking a role for them is the smallest step.
    const named = people.find((p) => !filled(p.buyerRole)) ?? people[0];
    contact = named ? (filled(named.buyerRole) ? `${want}: ${named.name} is not involved.` : `${want}: ${named.name} has no role yet.`) : want;
    contactShort = named ? 'contact role in the decision' : 'a contact';
  }
  const checks: [passed: boolean, string, string][] = [
    [filled(c?.name), 'Name', 'name'],
    [filled(c?.pib), 'Company ID (PIB)', 'company ID'],
    [filled(c?.mb), 'Matični broj', 'MB'],
    [address.length === 0, `Address (${list(address, 'and')})`, 'address'],
    [filled(c?.activityCode), 'Šifra delatnosti', 'activity code'],
    [!!c?.ownerId, 'Company owner', 'owner'],
    [!contact, contact ?? '', contactShort],
  ];
  const open = checks.filter(([passed]) => !passed);
  return { ready: checks.length - open.length, total: checks.length, blockers: open.map(([, msg]) => msg), missing: open.map(([, , short]) => short), done: checks.map(([passed]) => passed) };
}

/** The Kanban's columns, left to right. */
export const BOARD_STATUSES: CompanyStatus[] = ['lead', 'opportunity', 'client', 'past_client', 'not_interested'];
/** Lower is further back; by hand a status only goes back (STATUS_RANK in the API's company-status.ts). */
export const STATUS_RANK: Record<CompanyStatus, number> = { not_interested: 0, lead: 1, opportunity: 2, past_client: 3, client: 4 };

export interface DropCompany {
  name: string;
  status: CompanyStatus;
  /** Set back by hand: only "Back to automatic" moves it forward again. */
  manual: boolean;
  /** The lead's short missing words (readiness().missing). */
  missing: string[];
}

/**
 * What dropping a card on a status column does: nothing on its own column; a status further back
 * is set by hand (the API's manual rule), if this person may; one further on can't be set by hand,
 * so the company opens with a toast that says how it gets there.
 */
export function dropOutcome(c: DropCompany, to: CompanyStatus, canSetStatus: boolean): { kind: 'none' } | { kind: 'setBack'; to: CompanyStatus } | { kind: 'open'; message: string } | { kind: 'refuse'; message: string } {
  if (to === c.status) return { kind: 'none' };
  if (STATUS_RANK[to] < STATUS_RANK[c.status]) {
    return canSetStatus ? { kind: 'setBack', to } : { kind: 'refuse', message: `Only the owner of ${c.name} or an Admin can set its status back.` };
  }
  if (c.manual) return { kind: 'open', message: `${c.name} was set back by hand: use Back to automatic in its ⋯ menu, and the status follows its data again.` };
  if (c.status === 'not_interested') return { kind: 'open', message: `${c.name} moves on again with a new opportunity; it can take one once it is complete.` };
  if (c.status === 'lead' && to === 'opportunity')
    return { kind: 'open', message: `${c.name} becomes an Opportunity by itself once ${c.missing.length === 1 ? 'this is' : 'these are'} filled in: ${list(c.missing, 'and')}.` };
  if (c.status === 'lead') return { kind: 'open', message: `${c.name} is still a lead: fill in ${list(c.missing, 'and')} first, then it becomes an Opportunity by itself.` };
  if (to === 'client') return { kind: 'open', message: `${c.name} becomes a Client when one of its opportunities is won.` };
  return { kind: 'open', message: `${c.name} becomes a Past client when its last project is completed and nothing is open.` };
}
