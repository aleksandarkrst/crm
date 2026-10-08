/**
 * List export (CD-65): the rows a list screen shows, with its filters applied, as a CSV built in the
 * browser (see lib/csv.ts for the Excel and formula-injection rules). Owners and admins only.
 */
import type { CustomFieldEntity } from '../lib/api';
import type { ApiProject } from '../lib/projectsApi';
import { type CsvColumn, toCsv } from '../lib/csv';
import { type CompanyRecord, customFieldsOf, customValueText, memberName, ownerOf, personById, valueNum } from './selectors';
import type { CatalogItem, Funnel, Lead, State } from './types';

/**
 * One column per custom field of the record type (CD-15), after the standard ones: option labels,
 * Yes/No for checkboxes, numbers as numbers. Deleted fields aren't exported.
 */
function customColumns<T>(s: State, entity: CustomFieldEntity, idOf: (row: T) => string | null | undefined): CsvColumn<T>[] {
  return customFieldsOf(s, entity).map((f) => ({
    header: f.label,
    value: (row: T) => {
      const id = idOf(row);
      const v = id ? s.customValues[entity][id]?.[f.id] : undefined;
      return f.type === 'number' && typeof v === 'number' ? v : customValueText(f, v);
    },
  }));
}

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
    ...customColumns<Lead>(s, 'deal', (l) => l.id),
  ]);
}

/** Companies as the Companies screen lists them. */
export function companiesCsv(s: State, records: CompanyRecord[]): string {
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
    ...customColumns<CompanyRecord>(s, 'company', (c) => c.id),
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
    ...customColumns<(typeof people)[number]>(s, 'contact', ({ p }) => p!.contactId),
  ]);
}

/** Products as the Products screen lists them (CD-81); the columns import back in. */
export function productsCsv(items: CatalogItem[]): string {
  const frequency: Record<CatalogItem['frequency'], string> = { one_time: 'One time', weekly: 'Weekly', monthly: 'Monthly', quarterly: 'Quarterly', annually: 'Annually' };
  return toCsv(items, [
    { header: 'Product ID', value: (p) => p.id },
    { header: 'Name', value: (p) => p.name },
    { header: 'Description', value: (p) => p.description },
    { header: 'Unit price', value: (p) => p.price },
    { header: 'Unit', value: (p) => p.unit },
    { header: 'Quantity', value: (p) => p.qty },
    { header: 'Tax %', value: (p) => p.vat },
    { header: 'Billing frequency', value: (p) => frequency[p.frequency] },
    { header: 'Billing cycles', value: (p) => p.cycles ?? '' },
  ]);
}

const PROJECT_HEALTH = { on_track: 'On track', at_risk: 'At risk', off_track: 'Off track' } as const;
const PROJECT_STATUS = { open: 'Open', completed: 'Completed', cancelled: 'Cancelled' } as const;

/** Projects as the Projects screen shows them (its view and filters, CD-278). */
export function projectsCsv(projects: ApiProject[]): string {
  return toCsv(projects, [
    { header: 'Code', value: (p) => clean(p.code) },
    { header: 'Name', value: (p) => p.name },
    { header: 'Company', value: (p) => p.companyName },
    { header: 'Lead', value: (p) => clean(p.leadName) },
    { header: 'Type', value: (p) => p.projectTypeName },
    { header: 'Stage', value: (p) => p.stageName },
    { header: 'Health', value: (p) => PROJECT_HEALTH[p.health] },
    { header: 'Status', value: (p) => PROJECT_STATUS[p.status] },
    { header: 'Start', value: (p) => clean(p.startDate) },
    { header: 'End', value: (p) => clean(p.endDate) },
  ]);
}
