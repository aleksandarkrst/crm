// The Companies Kanban (CD-359): readiness of a lead and what a drop between status columns does.
// Pure (no React, no store imports), so it is unit-tested with Node's runner (test/companyBoard.test.ts).
import type { CompanyStatus } from './types';

export interface ReadinessCompany {
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

/**
 * What a lead still needs before it becomes an opportunity, as the API checks it
 * (opportunityReadiness in crm/companies/company-status.ts): 7 checks, the address as one line.
 * `blockers` are the company page's sentences, `missing` the card's short words.
 */
export function readiness(c: ReadinessCompany | undefined, people: ReadinessContact[]): { ready: number; total: number; blockers: string[]; missing: string[] } {
  const address = [!filled(c?.address) && 'street', !filled(c?.city) && 'city', !filled(c?.postalCode) && 'postal code'].filter((x): x is string => !!x);
  const gapsOf = (p: ReadinessContact) => [!filled(p.role) && 'job title', !filled(p.buyerRole) && 'role in the decision', !p.ownerId && 'owner'].filter((x): x is string => !!x);
  let contact: string | null = null;
  let contactShort = '';
  if (!people.some((p) => gapsOf(p).length === 0)) {
    const want = 'A contact with a job title, a role in the decision and an owner';
    const best = [...people].sort((a, b) => gapsOf(a).length - gapsOf(b).length)[0];
    const gaps = best ? gapsOf(best) : [];
    contact = best ? `${want}: ${best.name} has no ${list(gaps, 'or')} yet.` : want;
    contactShort = best ? `contact ${list(gaps, 'and')}` : 'a contact';
  }
  const checks: [number, string, string][] = [
    [filled(c?.pib) ? 0 : 1, 'Company ID (PIB)', 'PIB'],
    [filled(c?.mb) ? 0 : 1, 'Matični broj', 'MB'],
    [address.length, `Address (${list(address, 'and')})`, 'address'],
    [filled(c?.activityCode) ? 0 : 1, 'Šifra delatnosti', 'activity code'],
    [contact ? 1 : 0, contact ?? '', contactShort],
  ];
  const open = checks.filter(([m]) => m > 0);
  return { ready: 7 - checks.reduce((n, [m]) => n + m, 0), total: 7, blockers: open.map(([, msg]) => msg), missing: open.map(([, , short]) => short) };
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
