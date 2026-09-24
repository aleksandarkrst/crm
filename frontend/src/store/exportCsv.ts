/**
 * List export (CD-65): the rows a list screen shows, with its filters applied, as a CSV built in the
 * browser (see lib/csv.ts for the Excel and formula-injection rules). Owners and admins only.
 */
import { toCsv } from '../lib/csv';
import { type CompanyRecord, memberName, ownerOf, personById, valueNum } from './selectors';
import type { Funnel, Lead, State } from './types';

/** Placeholders ("—") are empty cells in the file. */
const clean = (v: string | null | undefined) => (!v || v === '—' ? '' : v);

/** Deals as the Pipeline shows them (its funnel and filters). */
export function dealsCsv(s: State, leads: Lead[]): string {
  const stages = new Map<string, { stage: string; funnel: string }>();
  for (const f of Object.values(s.funnels) as Funnel[]) for (const st of f.stages) stages.set(st.id, { stage: st.name, funnel: f.label });
  return toCsv(leads, [
    { header: 'Deal ID', value: (l) => l.id },
    { header: 'Deal', value: (l) => l.title || l.company },
    { header: 'Company ID', value: (l) => l.companyId ?? '' },
    { header: 'Company', value: (l) => clean(l.company) },
    { header: 'Contact', value: (l) => clean(l.contact) },
    { header: 'Contact email', value: (l) => clean(l.email) },
    { header: 'Funnel', value: (l) => stages.get(l.stage)?.funnel ?? '' },
    { header: 'Stage', value: (l) => stages.get(l.stage)?.stage ?? '' },
    { header: 'Outcome', value: (l) => (l.outcome === 'won' ? 'Won' : l.outcome === 'lost' ? 'Lost' : 'Open') },
    { header: 'Lost reason', value: (l) => l.lostReason ?? '' },
    { header: 'Value', value: (l) => valueNum(l.value) },
    { header: 'Currency', value: (l) => l.currency || s.workspace.currency },
    { header: 'Closing date', value: (l) => l.closeDate ?? '' },
    { header: 'Owner', value: (l) => clean(ownerOf(s, l)) },
    { header: 'Source', value: (l) => clean(l.source) },
    { header: 'Fit score', value: (l) => l.score },
    { header: 'Days since contact', value: (l) => l.stall },
  ]);
}

/** Companies as the Companies screen lists them. */
export function companiesCsv(records: CompanyRecord[]): string {
  return toCsv(records, [
    { header: 'Company ID', value: (c) => c.id },
    { header: 'Name', value: (c) => c.name },
    { header: 'Industry', value: (c) => clean(c.industry) },
    { header: 'HQ', value: (c) => clean(c.hq) },
    { header: 'Team size', value: (c) => clean(c.size) },
    { header: 'Source', value: (c) => clean(c.source) },
    { header: 'Owner', value: (c) => clean(c.owner) },
    { header: 'Contacts', value: (c) => c.contactCount },
    { header: 'Opportunities', value: (c) => c.oppCount },
    { header: 'Open value', value: (c) => c.value },
    { header: 'Latest stage', value: (c) => clean(c.stageName) },
    { header: 'Last touch', value: (c) => clean(c.lastTouch) },
  ]);
}

/** Contacts as the Contacts screen lists them (by the screen's row ids). */
export function contactsCsv(s: State, rows: { id: string; company: string; companyId: string | null }[]): string {
  const people = rows.map((r) => ({ row: r, p: personById(s, r.id) })).filter((x) => !!x.p);
  return toCsv(people, [
    { header: 'Contact ID', value: ({ p }) => p!.contactId ?? '' },
    { header: 'Full name', value: ({ p }) => p!.name },
    { header: 'Job title', value: ({ p }) => clean(p!.role) },
    { header: 'Company ID', value: ({ row }) => row.companyId ?? '' },
    { header: 'Company', value: ({ row }) => clean(row.company) },
    { header: 'Email', value: ({ p }) => clean(p!.email) },
    { header: 'Phone', value: ({ p }) => clean(p!.phone) },
    { header: 'LinkedIn', value: ({ p }) => clean(p!.linkedin) },
    { header: 'Buyer role', value: ({ p }) => p!.buyerRole || 'Influencer' },
    { header: 'Owner', value: ({ p }) => clean(memberName(s, p!.ownerId, p!.ownerName)) },
  ]);
}
