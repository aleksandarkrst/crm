/** Pure derivations over the store state (ported from the design prototype's logic). */
import { SCRIPTS } from './seed';
import type { CustomFieldEntity, CustomValue } from '../lib/api';
import { billingDates, type DealTotals, dealTotals } from './dealMath';
import { readiness, STATUS_RANK } from './companyBoard';
import { dealsWithUpcomingMeeting } from './meetings';
import type { CatalogItem, CompanyStatus, CustomFieldDef, DealLine, Lead, LeadTask, LogEntry, Person, SegKey, Stage, State, TaskState } from './types';

export const num = (v: unknown): number => Number(String(v ?? '').replace(/[^0-9.]/g, '')) || 0;

// ---------------------------------------------------------------- money (CD-73)
// Amounts are written with Intl.NumberFormat in the workspace currency. A deal keeps its own
// currency (deals created before the workspace currency changed), and totals never add different
// currencies together: they list one amount per currency ("$14,000 + €2,500").

/** A currency and the locale amounts are written in. */
export interface Cur {
  currency: string;
  locale: string;
}
/** English locales that write a currency the way its home market does; others use en-US. */
const LOCALES: Record<string, string> = { EUR: 'en-IE', USD: 'en-US', GBP: 'en-GB', CHF: 'en-CH', AUD: 'en-AU', CAD: 'en-CA', NZD: 'en-NZ', INR: 'en-IN', SGD: 'en-SG', HKD: 'en-HK', ZAR: 'en-ZA', IEP: 'en-IE' };
export const localeFor = (currency: string): string => LOCALES[currency] ?? 'en-US';
const EUR: Cur = { currency: 'EUR', locale: 'en-IE' };
/**
 * The currency to write a deal's amounts in (its own), or the workspace currency without a deal.
 * The locale always follows the workspace, so one screen writes every currency the same way
 * (a USD workspace shows "$" for its own deals and "€" for a euro deal; a CAD one "US$" for USD).
 */
export const curOf = (s: State, lead?: Lead): Cur => {
  const ws = s.workspace.currency || 'EUR';
  return { currency: lead?.currency || ws, locale: localeFor(ws) };
};
const formatters = new Map<string, Intl.NumberFormat>();
function formatter(c: Cur, short: boolean): Intl.NumberFormat {
  const key = `${c.currency}|${c.locale}|${short}`;
  let f = formatters.get(key);
  if (!f) {
    const opts: Intl.NumberFormatOptions = { style: 'currency', minimumFractionDigits: 0, maximumFractionDigits: short ? 1 : 0, ...(short ? { notation: 'compact' } : {}) };
    try {
      f = new Intl.NumberFormat(c.locale, { ...opts, currency: c.currency });
    } catch {
      f = new Intl.NumberFormat('en-US', { ...opts, currency: 'EUR' }); // not an ISO 4217 code
    }
    formatters.set(key, f);
  }
  return f;
}
/** "€14,000": whole units in the given currency (the design's format for EUR). */
export const money = (n: number, c: Cur = EUR): string => formatter(c, false).format(Math.round(n));
/** "€1,500.50": an exact amount with cents, for prices and line totals (CD-83). */
export const moneyExact = (n: number, c: Cur = EUR): string => {
  try {
    return new Intl.NumberFormat(c.locale, { style: 'currency', currency: c.currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
  } catch {
    return plainAmount(n, c.locale);
  }
};
/** "1,500.50": an amount without a currency (products have none; the deal gives it). */
export const plainAmount = (n: number, locale = 'en-US'): string => new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
/** "€184.4k" for cards and column headers; exact below 1,000. */
export const moneyShort = (n: number, c: Cur = EUR): string =>
  Math.abs(n) < 1000
    ? money(n, c)
    : formatter(c, true)
        .formatToParts(n)
        .map((p) => (p.type === 'compact' ? p.value.toLowerCase() : p.value))
        .join('');
/** The symbol of a currency as amounts show it ("€", "$", "RSD"). */
export const currencySymbol = (c: Cur): string => formatter(c, false).formatToParts(0).find((p) => p.type === 'currency')?.value ?? c.currency;
/**
 * A sum of amounts that may be in different currencies: one amount per currency, the workspace
 * currency first ("$14,000", "$14,000 + €2,500"). Amounts without a currency are in the workspace one.
 */
export function moneyTotal(s: State, items: { currency?: string; amount: number }[], short = false): string {
  const ws = curOf(s);
  const by = new Map<string, number>([[ws.currency, 0]]);
  for (const it of items) by.set(it.currency || ws.currency, (by.get(it.currency || ws.currency) ?? 0) + it.amount);
  const shown = [...by].filter(([, n]) => n !== 0);
  return (shown.length ? shown : [[ws.currency, 0] as const]).map(([currency, n]) => (short ? moneyShort : money)(n, { ...ws, currency })).join(' + ');
}
/** The summed value of these deals, per currency (see moneyTotal). */
export const valueTotal = (s: State, leads: Lead[], short = false): string => moneyTotal(s, leads.map((l) => ({ currency: l.currency, amount: valueNum(l.value) })), short);
/** "€14,000" → 14000 (digits only, like the prototype; amounts are written without decimals). */
export const valueNum = (v: unknown): number => Number(String(v).replace(/[^0-9]/g, '')) || 0;

export const initialsOf = (name: string | undefined): string =>
  String(name || '')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');

// ---------------------------------------------------------------- dates in the workspace time zone (CD-73)
// "Today", overdue and the dates of timeline entries follow the workspace time zone (an IANA name,
// `s.workspace.timezone`), not the browser's. Date-only values (due dates, closing dates) are
// calendar dates and are compared as ISO strings.

/** A moment as an ISO date (yyyy-mm-dd) in a time zone; the browser's when none or an unknown one is given. */
export function isoInZone(d: Date, tz?: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz || undefined, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
    const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
    return `${part('year')}-${part('month')}-${part('day')}`;
  } catch {
    return tz ? isoInZone(d) : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
}
/** Today as an ISO date (yyyy-mm-dd) in the time zone (pass the workspace's), for comparing with due dates. */
export const todayIso = (tz?: string): string => isoInZone(new Date(), tz);
/** "2026-09-23" → "23 Sep". */
export const isoLabel = (iso: string): string => (iso ? new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '—');
/** A moment (ISO date-time) as "23 Sep" on the calendar of the time zone. */
export const momentLabel = (at: string, tz?: string): string => isoLabel(isoInZone(new Date(at), tz));

export const todayLabel = (tz?: string): string => isoLabel(todayIso(tz));

// ---------------------------------------------------------------- funnels & leads

export const stagesFor = (s: State, seg: SegKey): Stage[] => s.funnels[seg]?.stages ?? [];
/** Every funnel, in the workspace's order, as options for a select (value = funnel id). */
export const funnelOptions = (s: State): { value: SegKey; label: string }[] => Object.values(s.funnels).map((f) => ({ value: f.id, label: f.label }));
export const stageOf = (s: State, lead: Lead): Stage => {
  const stages = stagesFor(s, lead.segment);
  return stages.find((st) => st.id === lead.stage) ?? stages[0]!;
};
export const leadById = (s: State, id: string | null | undefined): Lead | undefined => s.leads.find((l) => l.id === id);
/** The deal owner's label (see memberName). */
export const ownerOf = (s: State, l: Lead): string => memberName(s, l.ownerId, l.owner);

/** The deal's closing date (ISO), or '' when it has none: no date is never made up. */
export const closeIsoOf = (lead: Lead): string => lead.closeDate || '';

/** First payment date for a new line: the day after the closing date ('' without one). */
export function defaultStart(lead: Lead | undefined): string {
  const base = lead?.closeDate;
  if (!base) return '';
  const d = new Date(base);
  if (isNaN(d.getTime())) return base;
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function script(activity: string, lead: Lead): string {
  const raw = SCRIPTS[activity] || 'No script yet for this activity. Add one in the funnel builder.';
  const first = (lead.contact || '').split(' ')[0] ?? '';
  return raw.split('{{company}}').join(lead.company).split('{{first}}').join(first).split('{{industry}}').join(lead.industry);
}

/** Activity history loaded from the API (see ensureLog in the store). */
export const timelineFor = (s: State, leadId: string): LogEntry[] => s.log[leadId] || [];

// ---------------------------------------------------------------- products, lines & payments

const NO_ITEM: CatalogItem = { id: '', name: 'No product', description: '', unit: '', price: 0, qty: 1, vat: 0, frequency: 'one_time', cycles: null };
/** Live custom fields of a record type, in order (CD-15). */
export const customFieldsOf = (s: State, entity: CustomFieldEntity): CustomFieldDef[] => s.customFields.filter((f) => f.entity === entity);
/** A custom field value as text, for lists and exports: option labels, Yes/No, plain numbers. */
export function customValueText(f: CustomFieldDef, v: CustomValue | undefined): string {
  if (v === undefined || v === null || v === '') return '';
  if (f.type === 'select') return f.options.find((o) => o.id === v)?.label ?? '';
  if (f.type === 'checkbox') return v ? 'Yes' : 'No';
  return String(v);
}
export const itemById = (s: State, id: string): CatalogItem => s.catalog.find((c) => c.id === id) || s.catalog[0] || NO_ITEM;

/** The deal's products as saved in the backend (CD-83). */
export function linesOf(s: State, lead: Lead | undefined): DealLine[] {
  return lead ? s.dealLines[lead.id] || [] : [];
}

/** A deal's totals from its products, tax mode and discounts (see dealMath). */
export const totalsOf = (s: State, lead: Lead): DealTotals => dealTotals(linesOf(s, lead), lead.taxMode, lead.discounts);

/** Company name of a person: from their own company, else from the lead they are shown under. */
export const companyOfPerson = (s: State, p: Person): string => p.company ?? leadById(s, p.leadId)?.company ?? '—';
/** Company id of a person, resolved the same way as companyOfPerson. */
export const companyIdOfPerson = (s: State, p: Person): string | null => (p.company !== undefined ? p.companyId : leadById(s, p.leadId)?.companyId) ?? null;

// ---------------------------------------------------------------- proposal approval (CD-120)

export type ApprovalStatus = 'not_required' | 'not_requested' | 'pending' | 'approved';
export const APPROVAL_LABELS: Record<ApprovalStatus, string> = { not_required: 'Not required', not_requested: 'Not requested', pending: 'Pending approval', approved: 'Approved' };

/** Its proposal's approval, as the API works it out: the funnel's rule, then what was requested and approved. */
export function approvalStatusOf(s: State, lead: Lead): ApprovalStatus {
  if (!s.funnels[lead.segment]?.proposalApproval) return 'not_required';
  return lead.approval.approvedAt ? 'approved' : lead.approval.requestedAt ? 'pending' : 'not_requested';
}

// ---------------------------------------------------------------- company status (CD-358)

export const COMPANY_STATUS_LABELS: Record<CompanyStatus, string> = { lead: 'Lead', opportunity: 'Opportunity', client: 'Client', past_client: 'Past client', not_interested: 'Not interested' };
/** Lower is further back; a status can only be set back by hand (company-status.ts in the API). */
export const COMPANY_STATUS_RANK = STATUS_RANK;

/**
 * Whether a company can't take an opportunity (CD-360), as the API checks it: a lead, or a Not
 * interested company that isn't complete.
 */
export function pipelineBlocked(s: State, companyId: string): boolean {
  // A company (or status) not loaded here isn't blocked: the API decides.
  const status = s.extraCompanies.find((c) => c.id === companyId)?.status;
  if (!status) return false;
  return status === 'lead' || (status === 'not_interested' && companyReadiness(s, companyId).blockers.length > 0);
}

/** A company's own contacts, each once (primary contacts of its deals included). */
export function companyContacts(s: State, companyId: string): Person[] {
  const seen = new Set<string>();
  return allPeople(s).filter((p) => companyIdOfPerson(s, p) === companyId && !seen.has(p.contactId || p.id) && !!seen.add(p.contactId || p.id));
}

/** What a lead still needs before it becomes an opportunity (companyBoard.ts: the API's 7 checks). */
export function companyReadiness(s: State, companyId: string): { ready: number; total: number; blockers: string[]; missing: string[] } {
  return readiness(s.extraCompanies.find((x) => x.id === companyId), companyContacts(s, companyId));
}

/**
 * The dated payments of a deal, without tax (CD-83, CD-365): its installments when it has them, otherwise
 * every billing of every product from its billing start date ("until canceled": the first year).
 * `undated` says a payment was left out for lack of a date.
 */
export function dealPayments(s: State, lead: Lead): { payments: { when: Date; amount: number }[]; undated: boolean } {
  const payments: { when: Date; amount: number }[] = [];
  let undated = false;
  const push = (iso: string, amount: number) => {
    const d = iso ? new Date(iso) : null;
    if (d && !isNaN(d.getTime())) payments.push({ when: d, amount });
    else undated = true;
  };
  // Without tax, like the deal value (CD-365).
  const lines = linesOf(s, lead);
  const totals = dealTotals(lines, lead.taxMode, lead.discounts);
  if (lead.installments.length) {
    // Installments are entered with tax (they add up to the one-time products with tax): take the
    // deal's own share of tax out of each; the whole deal's share when it has no one-time products.
    const netShare = totals.oneTimeTotal > 0 ? totals.oneTimeNet / totals.oneTimeTotal : totals.total > 0 ? totals.subtotal / totals.total : 1;
    for (const i of lead.installments) push(i.date, num(i.amount) * netShare);
    return { payments, undated };
  }
  lines.forEach((ln, i) => {
    const t = totals.lines[i]!;
    const each = t.net / t.cycles;
    const dates = billingDates(ln);
    if (!dates.length) undated = true;
    for (const d of dates) push(d, each);
  });
  return { payments, undated };
}

/** Every dated payment of a deal (see dealPayments), as on Overview. */
export function paymentsFor(s: State, lead: Lead): { when: Date; amount: number }[] {
  return dealPayments(s, lead).payments;
}

export function billedShare(s: State, lead: Lead): number {
  const ps = paymentsFor(s, lead);
  const total = ps.reduce((a, p) => a + p.amount, 0);
  if (!total) return 0;
  const now = new Date();
  return ps.filter((p) => p.when <= now).reduce((a, p) => a + p.amount, 0) / total;
}

// ---------------------------------------------------------------- people & companies

/** Primary contacts (shown inline on their leads) plus everyone else. */
export function allPeople(s: State): Person[] {
  const seen = new Set<string>();
  return s.leads
    .filter((l) => l.contactId && !seen.has(l.contactId) && seen.add(l.contactId))
    .map<Person>((l) => ({
      id: l.id + ':p',
      leadId: l.id,
      contactId: l.contactId ?? undefined,
      companyId: l.companyId,
      company: l.company,
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
    }))
    .concat(s.extraPeople);
}
export const personById = (s: State, id: string | null | undefined): Person | undefined => allPeople(s).find((p) => p.id === id);
export function contactsForLead(s: State, leadId: string): Person[] {
  const links = s.links[leadId] || [];
  return allPeople(s).filter((p) => p.leadId === leadId || links.includes(p.id));
}

/** Ownership labels (CD-357), by the API's value. */
export const OWNERSHIP_LABELS: Record<string, string> = { private: 'Private', state: 'State' };

export interface CompanyRecord {
  /** Backend company id: companies are identified by id, never by name (names aren't unique). */
  id: string;
  name: string;
  industry: string;
  hq: string;
  size: string;
  source: string;
  /** Owner label, and user id for filtering (labels aren't unique). */
  owner: string;
  ownerId: string | null;
  /** Company ID (CD-357), '' for an older company without one; ownership is 'Private', 'State' or ''. */
  pib: string;
  ownership: string;
  /** Status label (CD-358): Lead, Opportunity, Client, Past client or Not interested; its rank sorts the column. */
  status: string;
  statusRank: number;
  leads: Lead[];
  contactCount: number;
  oppCount: number;
  /** Open value (CD-380): its deals that are neither Won nor Lost. */
  value: number;
  valueLabel: string;
  /** Lifetime value (CD-380): its Won deals. */
  lifetimeValue: number;
  lifetimeLabel: string;
  stageName: string;
  lastTouch: string;
}

/**
 * Companies (by id) with their leads, including companies without a deal yet. Leads without a
 * company aren't grouped into a company record.
 */
export function companyRecords(s: State): CompanyRecord[] {
  const map = new Map<string, Omit<CompanyRecord, 'contactCount' | 'oppCount' | 'value' | 'valueLabel' | 'lifetimeValue' | 'lifetimeLabel' | 'stageName' | 'lastTouch' | 'pib' | 'ownership' | 'status' | 'statusRank'>>();
  for (const l of s.leads) {
    if (!l.companyId) continue;
    if (!map.has(l.companyId)) map.set(l.companyId, { id: l.companyId, name: l.company, industry: l.industry, hq: l.hq, size: l.size, source: l.source, owner: ownerOf(s, l), ownerId: l.ownerId ?? null, leads: [] });
    map.get(l.companyId)!.leads.push(l);
  }
  for (const c of s.extraCompanies) if (c.id && !map.has(c.id)) map.set(c.id, { ...c, id: c.id, owner: memberName(s, c.ownerId, c.owner), ownerId: c.ownerId ?? null, leads: [] });
  const extras = new Map(s.extraCompanies.map((c) => [c.id, c]));
  return [...map.values()].map((r) => {
    const extra = extras.get(r.id);
    const ids = new Set<string>();
    r.leads.forEach((l) => contactsForLead(s, l.id).forEach((p) => ids.add(p.id)));
    const open = r.leads.filter((l) => l.outcome === 'open');
    const won = r.leads.filter((l) => l.outcome === 'won');
    const sum = (leads: Lead[]) => leads.reduce((a, l) => a + valueNum(l.value), 0);
    const stall = r.leads.length ? Math.min(...r.leads.map((l) => l.stall || 0)) : null;
    const last = r.leads[r.leads.length - 1];
    return {
      ...r,
      pib: extra?.pib ?? '',
      ownership: OWNERSHIP_LABELS[extra?.ownershipType ?? ''] ?? '',
      status: COMPANY_STATUS_LABELS[extra?.status ?? 'lead'],
      statusRank: COMPANY_STATUS_RANK[extra?.status ?? 'lead'],
      contactCount: ids.size,
      oppCount: r.leads.length,
      value: sum(open),
      valueLabel: valueTotal(s, open),
      lifetimeValue: sum(won),
      lifetimeLabel: valueTotal(s, won),
      stageName: last ? stageOf(s, last).name : '—',
      lastTouch: stall === null ? '—' : stall === 0 ? 'Today' : stall + 'd ago',
    };
  });
}

/**
 * Labels for picking a company: the name, plus the HQ (or a number) when several companies share
 * that name, so they can be told apart.
 */
export function companyLabels(records: CompanyRecord[]): Map<string, string> {
  const byName = new Map<string, CompanyRecord[]>();
  for (const r of records) byName.set(r.name.trim().toLowerCase(), [...(byName.get(r.name.trim().toLowerCase()) || []), r]);
  const out = new Map<string, string>();
  const hqOf = (r: CompanyRecord) => (r.hq && r.hq !== '—' ? r.hq.trim() : '');
  for (const group of byName.values()) {
    const hqs = group.map(hqOf);
    const byHq = hqs.every((h, i) => h && hqs.indexOf(h) === i);
    group.forEach((r, i) => out.set(r.id, group.length === 1 ? r.name : r.name + ' · ' + (byHq ? hqOf(r) : '#' + (i + 1))));
  }
  return out;
}

// ---------------------------------------------------------------- stage to-dos

export const taskKey = (leadId: string, stageId: string, idx: number) => `${leadId}::${stageId}::${idx}`;
export const taskOf = (s: State, leadId: string, stageId: string, idx: number): TaskState => s.tasks[taskKey(leadId, stageId, idx)] || {};

export interface TodoItem {
  label: string;
  offPlaybook: boolean;
  extraIdx?: number;
}

export function todoItemsFor(s: State, lead: Lead, stageId: string): TodoItem[] {
  const stage = stagesFor(s, lead.segment).find((x) => x.id === stageId);
  const extra = s.extraTodos[lead.id + '::' + stageId] || [];
  return (stage ? stage.checklist : [])
    .map<TodoItem>((label) => ({ label, offPlaybook: false }))
    .concat(extra.map((label, i) => ({ label, offPlaybook: true, extraIdx: i })));
}

export const stageDone = (s: State, lead: Lead, stageId: string): boolean =>
  todoItemsFor(s, lead, stageId).every((_it, idx) => taskOf(s, lead.id, stageId, idx).done);

// ---------------------------------------------------------------- the advance gate (CD-363)
// The same rules as the API's deals/stage-gate.ts, so the Advance and Won buttons show what the
// server would answer; the server decides (a refused move comes back as a 409 with these reasons).

/** Why the deal can't move forward out of its current stage: open to-dos, documentation. */
export function advanceBlockers(s: State, lead: Lead): string[] {
  const stage = stageOf(s, lead);
  const out: string[] = [];
  if (stage.gateTodos) {
    const open = todoItemsFor(s, lead, stage.id).filter((_it, idx) => !taskOf(s, lead.id, stage.id, idx).done).length;
    if (open) out.push(`${open} ${open === 1 ? 'to-do' : 'to-dos'} open in ${stage.name}`);
  }
  if (stage.gateDocs && !lead.docsComplete[stage.id]) out.push(`Documentation isn't marked complete in ${stage.name}`);
  return out;
}

/** In a funnel with any gate on, Won only from the last stage before it; null when allowed. */
export function wonBlocker(s: State, lead: Lead): string | null {
  const stages = stagesFor(s, lead.segment);
  if (!stages.some((st) => !st.won && (st.gateTodos || st.gateDocs))) return null;
  const working = stages.filter((st) => !st.won);
  const last = working[working.length - 1];
  return last && lead.stage !== last.id ? `Win it from ${last.name}, the last stage before Won` : null;
}

/** A jump past a gated stage, as the API refuses it (skipBlocker in stage-gate.ts). */
export function skipBlocker(s: State, lead: Lead, to: Stage): string | null {
  const stages = stagesFor(s, lead.segment);
  const between = stages.slice(stages.findIndex((st) => st.id === lead.stage) + 1, stages.indexOf(to)).filter((st) => !st.won);
  const gated = between.find((st) => st.gateTodos || st.gateDocs);
  return gated ? `Move it through ${gated.name} first` : null;
}

/** Who answers for the deal's current stage: the stage owner, else the deal's owner (user id). */
export const stageOwnerId = (s: State, lead: Lead): string | null => stageOf(s, lead).ownerId ?? lead.ownerId ?? null;

/** The current stage's target days: its own, else the funnel's. */
export const stageTargetDays = (s: State, lead: Lead): number | null => stageOf(s, lead).targetDays ?? s.funnels[lead.segment]?.targetDays ?? null;

// ---------------------------------------------------------------- tasks: overdue and next steps (CD-67)

/** A task from "New task" that isn't done and was due before `today` (the workspace's ISO date). */
export const isOverdue = (t: LeadTask, today: string): boolean => !t.done && !!t.due && t.due < today;
/** Overdue tasks on deals in this workspace, by the workspace's today. */
export const overdueTasks = (s: State): LeadTask[] => {
  const today = todayIso(s.workspace.timezone);
  return s.leadTasks.filter((t) => isOverdue(t, today) && s.leads.some((l) => l.id === t.leadId));
};
/**
 * An open deal with no open task from "New task" and no planned meeting still to come (CD-130):
 * nobody has planned what happens next. The store keeps the coming year's planned meetings loaded.
 */
export const needsNextStep = (s: State, lead: Lead): boolean =>
  lead.outcome === 'open' && !s.leadTasks.some((t) => t.leadId === lead.id && !t.done) && !dealsWithUpcomingMeeting(s.meetings).has(lead.id);

// ---------------------------------------------------------------- sales bonuses

/** Bonus rule of a salesperson, saved per user id (CD-17); a salesperson without one has none. */
export function bonusRule(s: State, ownerId: string) {
  const saved = s.bonusRules?.[ownerId];
  return { rate: saved?.rate ?? '', floor: saved?.floor ?? '', fixed: saved?.fixed ?? '', trigger: s.bonusTrigger || 'On contract signed' };
}
/**
 * A deal's bonus: the rate on its net value, or the flat amount when it is under the minimum. The
 * minimum and the flat amount are in the workspace currency; there are no exchange rates, so a
 * deal in another currency gets the rate only (in its own currency).
 */
export const bonusOf = (lead: Lead, rule: { rate: number | string; floor: number | string; fixed: number | string }, workspaceCurrency?: string): number => {
  const net = num(lead.value);
  const rated = (net * num(rule.rate)) / 100;
  if (workspaceCurrency && lead.currency && lead.currency !== workspaceCurrency) return rated;
  return net >= num(rule.floor) ? rated : num(rule.fixed);
};
// ---------------------------------------------------------------- people who own deals
// Owners are matched and grouped by user id, never by name: two members can share a name, and
// someone who left the workspace still owns their deals until they are handed over.

export const FORMER_MEMBER = 'Former member';

/** Active members by user id. Members who share a name get their email added to tell them apart. */
export function memberLabels(s: State): Map<string, string> {
  const active = s.team.filter((m) => m.status === 'Active');
  const key = (name: string) => name.trim().toLowerCase();
  const seen = new Map<string, number>();
  for (const m of active) seen.set(key(m.name), (seen.get(key(m.name)) ?? 0) + 1);
  return new Map(active.map((m) => [m.id, seen.get(key(m.name))! > 1 && m.email && m.email !== m.name ? m.name + ' · ' + m.email : m.name]));
}

/**
 * Label of a user by id: the member's name, or for someone who is no longer in the workspace
 * their last known name (from the API) marked as former, or just "Former member".
 */
export function memberName(s: State, userId: string | null | undefined, lastKnown?: string | null): string {
  if (!userId) return '—';
  const label = memberLabels(s).get(userId);
  if (label) return label;
  return lastKnown ? lastKnown + ' (former member)' : FORMER_MEMBER;
}

/**
 * Options for the Salesperson filters, by user id: active members, then former members who
 * still own deals or tasks (so their work can still be found).
 */
export function salesPeople(s: State): { value: string; label: string }[] {
  const labels = memberLabels(s);
  const former = new Map<string, string>();
  const addFormer = (id: string | null | undefined, lastKnown?: string | null) => {
    if (id && !labels.has(id) && !former.has(id)) former.set(id, memberName(s, id, lastKnown));
  };
  s.leads.forEach((l) => addFormer(l.ownerId, l.owner));
  s.leads.forEach((l) => addFormer(l.contactOwnerId, l.contactOwner));
  s.extraPeople.forEach((p) => addFormer(p.ownerId, p.ownerName));
  s.leadTasks.forEach((t) => addFormer(t.ownerId, t.ownerName));
  return [...labels, ...former].map(([value, label]) => ({ value, label }));
}
