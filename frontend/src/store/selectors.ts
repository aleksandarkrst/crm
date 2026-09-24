/** Pure derivations over the store state (ported from the design prototype's logic). */
import { CHAMP, CHAMP_LEVELS, SCRIPTS } from './seed';
import type { CustomFieldEntity, CustomValue } from '../lib/api';
import type { CatalogItem, Champ, CustomFieldDef, DealLine, Lead, LeadTask, LogEntry, Person, SegKey, Stage, State, TaskState } from './types';

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
export const bandOf = (v: string): string => {
  const n = valueNum(v);
  return n < 25000 ? 'Under €25k' : n <= 100000 ? '€25k–€100k' : 'Over €100k';
};

/** The deal's closing date (ISO), or '' when it has none: no date is never made up. */
export const closeIsoOf = (lead: Lead): string => lead.closeDate || '';

/**
 * The closing-date window for an Overview date filter (see DATE_RANGES), as inclusive ISO dates.
 * `null` means no filter. `today` is an ISO date (the workspace's today). Quarters and years are
 * fiscal ones: the year starts in `fiscalMonth` (1 = January, a calendar year).
 */
export function closeRangeOf(label: string, today = todayIso(), fiscalMonth = 1): { from: string; to: string } | null {
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const [y = 0, month = 1, date = 1] = today.split('-').map(Number);
  const m = month - 1;
  // Months since the fiscal year started; the fiscal year and its quarters are counted from there.
  const intoYear = (m - (fiscalMonth - 1) + 12) % 12;
  const fy = m - intoYear; // first month of this fiscal year (may be in the previous calendar year)
  const q = m - (intoYear % 3);
  const day = (yy: number, mm: number, dd: number) => iso(new Date(yy, mm, dd));
  switch (label) {
    case 'Closing in 30 days':
      return { from: today, to: day(y, m, date + 30) };
    case 'Closing this month':
      return { from: day(y, m, 1), to: day(y, m + 1, 0) };
    case 'Closing this quarter':
      return { from: day(y, q, 1), to: day(y, q + 3, 0) };
    case 'Closing next quarter':
      return { from: day(y, q + 3, 1), to: day(y, q + 6, 0) };
    case 'Closing this year':
      return { from: day(y, fy, 1), to: day(y, fy + 12, 0) };
    case 'Closing date passed':
      return { from: '0000-01-01', to: day(y, m, date - 1) };
    default:
      return null;
  }
}
/** Whether a deal falls in an Overview date filter. Deals without a closing date only match "no filter". */
export function inCloseRange(lead: Lead, range: { from: string; to: string } | null): boolean {
  if (!range) return true;
  const close = closeIsoOf(lead);
  return !!close && close >= range.from && close <= range.to;
}

/** First payment date for a new line: the day after the closing date ('' without one). */
export function defaultStart(lead: Lead | undefined): string {
  const base = lead?.closeDate;
  if (!base) return '';
  const d = new Date(base);
  if (isNaN(d.getTime())) return base;
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function monthLabel(start: string | undefined, add: number): string {
  if (!start) return 'No start date';
  const d = new Date(start);
  if (isNaN(d.getTime())) return '—';
  d.setMonth(d.getMonth() + add);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** `start` moved by `add` months; '' without a start date. */
export function shiftIso(start: string | undefined, add: number): string {
  if (!start) return '';
  const d = new Date(start);
  if (isNaN(d.getTime())) return start;
  d.setMonth(d.getMonth() + add);
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

const NO_ITEM: CatalogItem = { id: '', name: 'No product', type: 'Service', kind: 'One-off', price: 0, vat: 0 };
/** The currency a product is priced in (CD-77). */
export const itemCurrency = (s: State, item: CatalogItem | undefined): string => item?.currency || s.workspace.currency;
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

/** The deal's lines (products, prices and payment schedules) as saved in the backend. */
export function linesOf(s: State, lead: Lead | undefined): DealLine[] {
  return lead ? s.dealLines[lead.id] || [] : [];
}

export const netOf = (lines: DealLine[]): number => lines.reduce((a, l) => a + num(l.qty) * num(l.price), 0);
export const vatOf = (lines: DealLine[]): number => lines.reduce((a, l) => a + (num(l.qty) * num(l.price) * num(l.vat)) / 100, 0);
export const grossOf = (l: DealLine): number => num(l.qty) * num(l.price) * (1 + num(l.vat) / 100);

/** Company name of a person: from their own company, else from the lead they are shown under. */
export const companyOfPerson = (s: State, p: Person): string => p.company ?? leadById(s, p.leadId)?.company ?? '—';
/** Company id of a person, resolved the same way as companyOfPerson. */
export const companyIdOfPerson = (s: State, p: Person): string | null => (p.company !== undefined ? p.companyId : leadById(s, p.leadId)?.companyId) ?? null;

/**
 * The dated payments of one line, incl. VAT (subscriptions: the next 12 months). Payments are dated
 * from the line's start date; a milestone can carry its own date, so milestones with a date count
 * even when the line has no start date (CD-74). `undated` says a payment was left out for lack of a date.
 */
export function linePayments(ln: DealLine): { payments: { when: Date; amount: number }[]; undated: boolean } {
  const payments: { when: Date; amount: number }[] = [];
  let undated = false;
  const push = (iso: string, amount: number) => {
    const d = iso ? new Date(iso) : null;
    if (d && !isNaN(d.getTime())) payments.push({ when: d, amount });
    else undated = true;
  };
  const gross = grossOf(ln);
  const start = ln.start;
  if (ln.schedule === 'Custom milestones') (ln.milestones || []).forEach((m, i) => push(m.date || shiftIso(start, i), (gross * num(m.pct)) / 100));
  else if (!start) undated = true;
  else if (ln.schedule === 'Equal monthly instalments') {
    const n = Math.max(1, Math.round(num(ln.months)) || 1);
    for (let i = 0; i < n; i++) push(shiftIso(start, i), gross / n);
  } else if (ln.schedule === 'Recurring subscription') for (let i = 0; i < 12; i++) push(shiftIso(start, i), gross);
  else push(start, gross);
  return { payments, undated };
}

/** Every dated payment a lead's lines produce (see linePayments), as on Overview. */
export function paymentsFor(s: State, lead: Lead): { when: Date; amount: number }[] {
  return linesOf(s, lead).flatMap((ln) => linePayments(ln).payments);
}

export function billedShare(s: State, lead: Lead): number {
  const ps = paymentsFor(s, lead);
  const total = ps.reduce((a, p) => a + p.amount, 0);
  if (!total) return 0;
  const now = new Date();
  return ps.filter((p) => p.when <= now).reduce((a, p) => a + p.amount, 0) / total;
}

// ---------------------------------------------------------------- CHAMP qualification

export function champFor(s: State, lead: Lead): Champ {
  const saved = s.champ[lead.id];
  if (saved) return saved;
  let left = lead.score;
  const out = {} as Champ;
  CHAMP.forEach((c, i) => {
    const share = i === CHAMP.length - 1 ? left : Math.round(lead.score / 4);
    out[c.key] = CHAMP_LEVELS.reduce((a, l) => (Math.abs(l.v - share) < Math.abs(a - share) ? l.v : a), 0);
    left -= share;
  });
  return out;
}
export const champTotal = (s: State, lead: Lead): number => {
  const v = champFor(s, lead);
  return CHAMP.reduce((a, c) => a + (v[c.key] || 0), 0);
};

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
      buyerRole: l.buyerRole || (/founder|ceo|owner|managing/i.test(l.role) ? 'Decision maker' : 'Influencer'),
      ownerId: l.contactOwnerId,
      ownerName: l.contactOwner,
    }))
    .concat(s.extraPeople);
}
export const personById = (s: State, id: string | null | undefined): Person | undefined => allPeople(s).find((p) => p.id === id);
export function contactsForLead(s: State, leadId: string): Person[] {
  const links = s.links[leadId] || [];
  return allPeople(s).filter((p) => p.leadId === leadId || links.includes(p.id));
}

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
  leads: Lead[];
  contactCount: number;
  oppCount: number;
  value: number;
  valueLabel: string;
  stageName: string;
  lastTouch: string;
}

/**
 * Companies (by id) with their leads, including companies without a deal yet. Leads without a
 * company aren't grouped into a company record.
 */
export function companyRecords(s: State): CompanyRecord[] {
  const map = new Map<string, Omit<CompanyRecord, 'contactCount' | 'oppCount' | 'value' | 'valueLabel' | 'stageName' | 'lastTouch'>>();
  for (const l of s.leads) {
    if (!l.companyId) continue;
    if (!map.has(l.companyId)) map.set(l.companyId, { id: l.companyId, name: l.company, industry: l.industry, hq: l.hq, size: l.size, source: l.source, owner: ownerOf(s, l), ownerId: l.ownerId ?? null, leads: [] });
    map.get(l.companyId)!.leads.push(l);
  }
  for (const c of s.extraCompanies) if (c.id && !map.has(c.id)) map.set(c.id, { ...c, id: c.id, owner: memberName(s, c.ownerId, c.owner), ownerId: c.ownerId ?? null, leads: [] });
  return [...map.values()].map((r) => {
    const ids = new Set<string>();
    r.leads.forEach((l) => contactsForLead(s, l.id).forEach((p) => ids.add(p.id)));
    const value = r.leads.reduce((a, l) => a + valueNum(l.value), 0);
    const stall = r.leads.length ? Math.min(...r.leads.map((l) => l.stall || 0)) : null;
    const last = r.leads[r.leads.length - 1];
    return {
      ...r,
      contactCount: ids.size,
      oppCount: r.leads.length,
      value,
      valueLabel: valueTotal(s, r.leads),
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

// ---------------------------------------------------------------- tasks: overdue and next steps (CD-67)

/** A task from "New task" that isn't done and was due before `today` (the workspace's ISO date). */
export const isOverdue = (t: LeadTask, today: string): boolean => !t.done && !!t.due && t.due < today;
/** Overdue tasks on deals in this workspace, by the workspace's today. */
export const overdueTasks = (s: State): LeadTask[] => {
  const today = todayIso(s.workspace.timezone);
  return s.leadTasks.filter((t) => isOverdue(t, today) && s.leads.some((l) => l.id === t.leadId));
};
/** An open deal with no open task from "New task": nobody has planned what happens next. */
export const needsNextStep = (s: State, lead: Lead): boolean => lead.outcome === 'open' && !s.leadTasks.some((t) => t.leadId === lead.id && !t.done);

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
