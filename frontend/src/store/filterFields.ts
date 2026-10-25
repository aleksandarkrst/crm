// What the filter row (CD-366) offers on each page: every system and custom field of the page's
// records, and of the records they belong to (a deal's company and contact). Custom fields come
// from their definitions, so a new one shows up without code.
import { type ApiMeeting, type CustomFieldEntity, LOST_REASONS } from '../lib/api';
import { FREQUENCIES } from './dealMath';
import { type FilterField, type FilterOption, type FilterPerson, GROUP } from './filters';
import { MEETING_STATUSES, MEETING_TYPES, STATUS_LABEL } from './meetings';
import { BUYER_ROLES, INDUSTRIES, SOURCES, TEAM_SIZES } from './seed';
import { allPeople, COMPANY_STATUS_LABELS, companyIdOfPerson, companyLabels, type CompanyRecord, companyRecords, curOf, currencySymbol, customFieldsOf, needsNextStep, salesPeople, stagesFor, valueNum } from './selectors';
import { instantToZoned } from './time';
import type { CatalogItem, Lead, Person, SegKey, State } from './types';

/** Shown (and filtered on) for a contact with no role in the decision yet (CD-361). */
export const NO_ROLE = 'No role yet';

/** Options from the known values first, then any other value records have, A–Z. */
function optionsOf(known: readonly string[], seen: Iterable<string | null | undefined>): FilterOption[] {
  const extra = [...new Set(seen)].filter((v): v is string => !!v && v !== '—' && !known.includes(v)).sort((a, b) => a.localeCompare(b));
  return [...known, ...extra].map((v) => ({ id: v, name: v }));
}

/** The workspace's members (and former owners) for the person filters; "Me" with my name · title. */
export function filterPeople(s: State, me: string): FilterPerson[] {
  return salesPeople(s).map(({ value: id, label }) => {
    const emp = s.people.employees.find((e) => e.userId === id);
    const role = (id === me ? s.profile.title : '') || emp?.jobTitle || s.team.find((m) => m.id === id)?.role || '';
    return { id, name: label, sub: id === me ? [label, role].filter(Boolean).join(' · ') : [role, emp?.unitName].filter(Boolean).join(' · ') };
  });
}

/** A record type's custom fields, read through the record's id. */
function customFields<R>(s: State, entity: CustomFieldEntity, idOf: (r: R) => string | null | undefined, group: string, prefix: string): FilterField<R>[] {
  return customFieldsOf(s, entity).map<FilterField<R>>((cf) => {
    const raw = (r: R) => {
      const id = idOf(r);
      return id ? s.customValues[entity]?.[id]?.[cf.id] : undefined;
    };
    const base = { id: prefix + 'cf:' + cf.id, label: cf.label, group, custom: true };
    switch (cf.type) {
      case 'select':
        return { ...base, kind: 'list', options: cf.options.map((o) => ({ id: o.id, name: o.label })), get: (r) => (raw(r) === undefined || raw(r) === '' ? null : String(raw(r))) };
      case 'checkbox':
        return { ...base, kind: 'checkbox', get: (r) => raw(r) === true || raw(r) === 'true' };
      case 'number':
        return { ...base, kind: 'number', get: (r) => (raw(r) === undefined || raw(r) === '' ? null : Number(raw(r))) };
      case 'date':
        return { ...base, kind: 'date', get: (r) => (typeof raw(r) === 'string' ? (raw(r) as string) : null) };
      default:
        return { ...base, kind: 'text', get: (r) => (raw(r) === undefined ? '' : String(raw(r))) };
    }
  });
}

/** A record's company fields (CompanyRecord plus its details), the company's custom fields too. */
function companyFields<R>(s: State, toCompany: (r: R) => CompanyRecord | undefined, opts: { group: string; prefix: string; records: CompanyRecord[]; own?: boolean }): FilterField<R>[] {
  const { group, prefix: p, records } = opts;
  const extras = new Map(s.extraCompanies.map((c) => [c.id, c]));
  const extra = (r: R) => extras.get(toCompany(r)?.id);
  const labels = companyLabels(records);
  const text = (id: string, label: string, get: (r: R) => string | undefined): FilterField<R> => ({ id: p + id, label, group, kind: 'text', get: (r) => get(r) ?? '' });
  const fields: FilterField<R>[] = [
    opts.own
      ? text('name', 'Name', (r) => toCompany(r)?.name)
      : { id: p + 'company', label: 'Company', group, kind: 'list', icon: 'company', options: records.map((c) => ({ id: c.id, name: labels.get(c.id) ?? c.name })).sort((a, b) => a.name.localeCompare(b.name)), get: (r) => toCompany(r)?.id },
    { id: p + 'industry', label: 'Industry', group, kind: 'list', options: optionsOf(INDUSTRIES, records.map((c) => c.industry)), get: (r) => toCompany(r)?.industry },
    { id: p + 'hq', label: 'HQ', group, kind: 'list', options: optionsOf([], records.map((c) => c.hq)), get: (r) => toCompany(r)?.hq },
    { id: p + 'size', label: 'Team size', group, kind: 'list', options: optionsOf(TEAM_SIZES, records.map((c) => c.size)), get: (r) => toCompany(r)?.size },
    ...(opts.own ? [{ id: p + 'source', label: 'Source', group, kind: 'list', options: optionsOf(SOURCES, records.map((c) => c.source)), get: (r: R) => toCompany(r)?.source } as FilterField<R>] : []),
    text('pib', 'Company ID', (r) => toCompany(r)?.pib),
    // The company status (CD-358), in its order.
    { id: p + 'status', label: 'Status', group, kind: 'list', icon: 'status', options: (['lead', 'opportunity', 'client', 'past_client', 'not_interested'] as const).map((id) => ({ id, name: COMPANY_STATUS_LABELS[id] })), get: (r) => (toCompany(r) ? (extra(r)?.status ?? 'lead') : undefined) },
    text('mb', 'Matični broj', (r) => extra(r)?.mb),
    text('activityCode', 'Šifra delatnosti', (r) => extra(r)?.activityCode),
    { id: p + 'ownership', label: 'Ownership', group, kind: 'list', options: optionsOf(['Private', 'State'], []), get: (r) => toCompany(r)?.ownership },
    text('address', 'Street', (r) => extra(r)?.address),
    text('city', 'City', (r) => extra(r)?.city),
    text('postalCode', 'Postal code', (r) => extra(r)?.postalCode),
    text('domain', 'Domain', (r) => extra(r)?.domain),
    text('notes', 'Notes', (r) => extra(r)?.notes),
  ];
  return [...fields, ...customFields(s, 'company', (r: R) => toCompany(r)?.id, group, p)];
}

/** A contact's fields (CD-361 details included), and the contact's custom fields. */
function contactFields<R>(s: State, toPerson: (r: R) => Person | undefined, opts: { group: string; prefix: string; own?: boolean }): FilterField<R>[] {
  const { group, prefix: p } = opts;
  const text = (id: string, label: string, get: (x: Person) => string | undefined): FilterField<R> => ({ id: p + id, label, group, kind: 'text', get: (r) => {
    const x = toPerson(r);
    return x ? (get(x) ?? '') : '';
  } });
  const people = allPeople(s);
  return [
    text('name', opts.own ? 'Name' : 'Contact', (x) => x.name),
    text('role', 'Role', (x) => x.role),
    text('email', 'Email', (x) => x.email),
    text('phone', 'Phone', (x) => x.phone),
    text('linkedin', 'LinkedIn', (x) => x.linkedin),
    { id: p + 'buyerRole', label: 'Buyer role', group, kind: 'list', options: optionsOf([...BUYER_ROLES, NO_ROLE], []), get: (r) => (toPerson(r) ? toPerson(r)!.buyerRole || NO_ROLE : null) },
    text('orgUnit', 'Org unit', (x) => x.orgUnit),
    { id: p + 'source', label: 'Source', group, kind: 'list', options: optionsOf(SOURCES, people.map((x) => x.source)), get: (r) => toPerson(r)?.source },
    text('influence', 'Influence on the opportunity', (x) => x.influence),
    text('notes', 'Notes', (x) => x.notes),
    { id: p + 'birthday', label: 'Birthday', group, kind: 'date', get: (r) => toPerson(r)?.birthday || null },
    text('spouseName', 'Spouse', (x) => x.spouseName),
    text('children', 'Children', (x) => x.children),
    text('pets', 'Pets', (x) => x.pets),
    ...customFields(s, 'contact', (r: R) => toPerson(r)?.contactId, group, p),
  ];
}

// ---------------------------------------------------------------- pages

/** Status ids for the outcomes; the open stages use their own ids. */
export const WON = '__won';
export const LOST = '__lost';
/** Dots for the open stages, light to dark green (as the board's stage shades). */
const STAGE_DOTS = ['var(--brand-soft-2)', 'var(--stage-done)', 'var(--green-500)', 'var(--brand)', 'var(--forest)'];

/** A deal's Status value: its stage while open, else Won or Lost. */
export const statusOf = (l: Lead): string => (l.outcome === 'lost' ? LOST : l.outcome === 'won' ? WON : l.stage);
/**
 * The Status options of a funnel: its open stages under "Open", then Won and Lost. `null` is every
 * funnel (Overview on "Audience"): each funnel's open stages, named with their funnel when there are several.
 */
export function statusOptions(s: State, funnel: SegKey | null): FilterOption[] {
  const funnels = funnel === null ? Object.values(s.funnels) : [s.funnels[funnel]!];
  const named = funnels.length > 1;
  const dot = (i: number, n: number) => STAGE_DOTS[Math.min(STAGE_DOTS.length - 1, Math.round((i / Math.max(1, n - 1)) * (STAGE_DOTS.length - 1)))];
  return [
    ...funnels.flatMap((f) => {
      const open = stagesFor(s, f.id).filter((st) => !st.won);
      return open.map((st, i) => ({ id: st.id, name: named ? `${st.name} · ${f.label}` : st.name, sub: true, dot: dot(i, open.length) }));
    }),
    { id: WON, name: 'Won', dot: 'var(--lime)', ring: true },
    { id: LOST, name: 'Lost', dot: 'var(--danger)' },
  ];
}
/** Status "Open, Won": the whole "Open" group (whatever stages the funnel has) and Won. */
export const openAndWon = (): string[] => [GROUP, WON];

/**
 * Pipeline and Overview (CD-366): the opportunity's fields, then its company's and its primary
 * contact's. `pinned` are the page's chips; the Status options are the funnel's.
 */
export function opportunityFields(s: State, funnel: SegKey | null, pinned: string[]): FilterField<Lead>[] {
  const records = companyRecords(s);
  const byId = new Map(records.map((c) => [c.id, c]));
  const contacts = new Map(allPeople(s).map((p) => [p.contactId, p]));
  const unit = currencySymbol(curOf(s));
  const g = 'Opportunity';
  const text = (id: string, label: string, get: (l: Lead) => string | undefined): FilterField<Lead> => ({ id, label, group: g, kind: 'text', get: (l) => get(l) ?? '' });
  const fields: FilterField<Lead>[] = [
    { id: 'owner', label: 'Salesperson', group: g, kind: 'person', get: (l) => l.ownerId },
    { id: 'status', label: 'Status', group: g, kind: 'list', icon: 'status', groupLabel: 'Open', options: statusOptions(s, funnel), get: statusOf },
    { id: 'close', label: 'Closing date', group: g, kind: 'date', get: (l) => l.closeDate || null },
    { id: 'value', label: 'Value', group: g, kind: 'number', icon: 'value', unit, get: (l) => valueNum(l.value) },
    { id: 'source', label: 'Source', group: g, kind: 'list', options: optionsOf(SOURCES, s.leads.map((l) => l.source)), get: (l) => l.source },
    text('title', 'Opportunity name', (l) => l.title),
    { id: 'stall', label: 'Days since contact', group: g, kind: 'number', get: (l) => l.stall },
    { id: 'late', label: 'Days late', group: g, kind: 'number', get: (l) => l.lateDays },
    { id: 'noNextStep', label: 'No next step', group: g, kind: 'checkbox', get: (l) => needsNextStep(s, l) },
    { id: 'qualified', label: 'Qualified', group: g, kind: 'checkbox', get: (l) => !!l.qualifiedAt },
    text('pain', 'Pain', (l) => l.pain),
    text('solution', 'Solution', (l) => l.painSolution),
    { id: 'lostReason', label: 'Lost reason', group: g, kind: 'list', options: optionsOf(LOST_REASONS, []), get: (l) => (l.outcome === 'lost' ? l.lostReason : null) },
    ...customFields(s, 'deal', (l: Lead) => l.id, g, ''),
    ...companyFields(s, (l: Lead) => byId.get(l.companyId ?? ''), { group: 'Company', prefix: 'company.', records }),
    ...contactFields(s, (l: Lead) => contacts.get(l.contactId ?? undefined), { group: 'Contact', prefix: 'contact.' }),
  ];
  return fields.map((f) => (pinned.includes(f.id) ? { ...f, pinned: true } : f));
}

/** Companies: every company field, then the numbers of its opportunities. */
export function companyPageFields(s: State): FilterField<CompanyRecord>[] {
  const records = companyRecords(s);
  const unit = currencySymbol(curOf(s));
  const g = 'Opportunities';
  return [
    { id: 'owner', label: 'Salesperson', group: 'Company', kind: 'person', pinned: true, get: (c) => c.ownerId },
    ...companyFields(s, (c: CompanyRecord) => c, { group: 'Company', prefix: '', records, own: true }),
    { id: 'stage', label: 'Latest stage', group: g, kind: 'list', icon: 'status', options: optionsOf([], records.map((c) => c.stageName)), get: (c) => c.stageName },
    { id: 'opps', label: 'Opportunities', group: g, kind: 'number', get: (c) => c.oppCount },
    { id: 'openValue', label: 'Open value', group: g, kind: 'number', icon: 'value', unit, get: (c) => c.value },
    { id: 'lifetimeValue', label: 'Lifetime value', group: g, kind: 'number', icon: 'value', unit, get: (c) => c.lifetimeValue },
    { id: 'contacts', label: 'Contacts', group: g, kind: 'number', get: (c) => c.contactCount },
    { id: 'stall', label: 'Days since contact', group: g, kind: 'number', get: (c) => (c.leads.length ? Math.min(...c.leads.map((l) => l.stall || 0)) : null) },
  ];
}

/** Contacts: every contact field, and their company. */
export function contactPageFields(s: State): FilterField<Person>[] {
  const records = companyRecords(s);
  const labels = companyLabels(records);
  return [
    { id: 'owner', label: 'Salesperson', group: 'Contact', kind: 'person', pinned: true, get: (p) => p.ownerId },
    ...contactFields(s, (p: Person) => p, { group: 'Contact', prefix: '', own: true }),
    { id: 'company', label: 'Company', group: 'Company', kind: 'list', icon: 'company', options: records.map((c) => ({ id: c.id, name: labels.get(c.id) ?? c.name })).sort((a, b) => a.name.localeCompare(b.name)), get: (p) => companyIdOfPerson(s, p) },
  ];
}

/** Products: every product field; `uses` counts the opportunities a product is on. */
export function productFields(s: State, uses: (c: CatalogItem) => number): FilterField<CatalogItem>[] {
  const unit = currencySymbol(curOf(s));
  const g = 'Product';
  return [
    { id: 'name', label: 'Name', group: g, kind: 'text', get: (c) => c.name },
    { id: 'description', label: 'Description', group: g, kind: 'text', get: (c) => c.description },
    { id: 'unitPrice', label: 'Unit price', group: g, kind: 'number', icon: 'value', unit, get: (c) => c.price },
    { id: 'unit', label: 'Unit', group: g, kind: 'list', options: optionsOf([], s.catalog.map((c) => c.unit)), get: (c) => c.unit },
    { id: 'qty', label: 'Quantity', group: g, kind: 'number', get: (c) => c.qty },
    { id: 'price', label: 'Price', group: g, kind: 'number', icon: 'value', unit, get: (c) => c.price * c.qty },
    { id: 'tax', label: 'Tax', group: g, kind: 'list', options: [...new Set(s.catalog.map((c) => c.vat))].sort((a, b) => a - b).map((v) => ({ id: String(v), name: v + '%' })), get: (c) => String(c.vat) },
    { id: 'frequency', label: 'Billing frequency', group: g, kind: 'list', options: FREQUENCIES.map((f) => ({ id: f.value, name: f.label })), get: (c) => c.frequency },
    { id: 'inUse', label: 'In use', group: g, kind: 'number', get: uses },
  ];
}

/** What Today's filters read of a task (store-made and funnel-made ones alike). */
export interface FilterTask {
  title: string;
  ownerId: string | null;
  channelLabel: string;
  /** ISO due date; a funnel task is due today or tomorrow. */
  dueIso: string;
  note: string;
  done: boolean;
  stageName: string;
  companyId: string | null;
}

/** Today: the task's fields, and its opportunity's stage and company. */
export function taskFields(s: State, tasks: FilterTask[]): FilterField<FilterTask>[] {
  const records = companyRecords(s);
  const labels = companyLabels(records);
  const g = 'Task';
  return [
    { id: 'owner', label: 'Salesperson', group: g, kind: 'person', pinned: true, get: (t) => t.ownerId },
    { id: 'type', label: 'Type', group: g, kind: 'list', options: optionsOf([], tasks.map((t) => t.channelLabel)), get: (t) => t.channelLabel },
    { id: 'due', label: 'Due date', group: g, kind: 'date', get: (t) => t.dueIso },
    { id: 'title', label: 'Title', group: g, kind: 'text', get: (t) => t.title },
    { id: 'note', label: 'Note', group: g, kind: 'text', get: (t) => t.note },
    { id: 'done', label: 'Done', group: g, kind: 'checkbox', get: (t) => t.done },
    { id: 'stage', label: 'Stage', group: 'Opportunity', kind: 'list', icon: 'status', options: optionsOf([], Object.values(s.funnels).flatMap((f) => f.stages.map((st) => st.name))), get: (t) => t.stageName },
    { id: 'company', label: 'Company', group: 'Opportunity', kind: 'list', icon: 'company', options: records.map((c) => ({ id: c.id, name: labels.get(c.id) ?? c.name })).sort((a, b) => a.name.localeCompare(b.name)), get: (t) => t.companyId },
  ];
}

/** Calendar: the meeting's fields (the salesperson is its organizer or an internal participant), then its company's. */
export function meetingFields(s: State): FilterField<ApiMeeting>[] {
  const records = companyRecords(s);
  const byId = new Map(records.map((c) => [c.id, c]));
  const tz = s.workspace.timezone;
  const g = 'Meeting';
  const text = (id: string, label: string, get: (m: ApiMeeting) => string | null): FilterField<ApiMeeting> => ({ id, label, group: g, kind: 'text', get: (m) => get(m) ?? '' });
  return [
    { id: 'owner', label: 'Salesperson', group: g, kind: 'person', pinned: true, get: (m) => [m.organizerUserId, ...m.participants.filter((p) => p.kind === 'internal').map((p) => p.userId)].filter((id): id is string => !!id) },
    { id: 'type', label: 'Type', group: g, kind: 'list', pinned: true, options: MEETING_TYPES.map((t) => ({ id: t.value, name: t.short, dotClass: 'mt-' + t.value })), get: (m) => m.type },
    { id: 'status', label: 'Status', group: g, kind: 'list', pinned: true, icon: 'status', options: MEETING_STATUSES.map((st) => ({ id: st, name: STATUS_LABEL[st] })), get: (m) => m.status },
    { id: 'date', label: 'Date', group: g, kind: 'date', get: (m) => instantToZoned(m.startsAt, tz).date },
    text('title', 'Title', (m) => m.title),
    text('location', 'Location', (m) => m.location),
    text('agenda', 'Agenda', (m) => m.agenda),
    text('deal', 'Opportunity', (m) => m.dealTitle),
    { id: 'minutes', label: 'Internal minutes', group: g, kind: 'list', options: [{ id: 'missing', name: 'Missing' }, { id: 'recorded', name: 'Recorded' }], get: (m) => m.internalMinutes },
    { id: 'notClosed', label: 'Not closed', group: g, kind: 'checkbox', get: (m) => m.notClosed },
    ...companyFields(s, (m: ApiMeeting) => byId.get(m.companyId), { group: 'Company', prefix: 'company.', records }),
  ];
}
