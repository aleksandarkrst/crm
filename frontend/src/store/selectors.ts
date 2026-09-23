/** Pure derivations over the store state (ported from the design prototype's logic). */
import { CHAMP, CHAMP_LEVELS, OWNERS, SCRIPTS } from './seed';
import type { CatalogItem, Champ, DealLine, Lead, LogEntry, Person, SegKey, Stage, State, TaskState } from './types';

export const num = (v: unknown): number => Number(String(v ?? '').replace(/[^0-9.]/g, '')) || 0;
export const money = (n: number): string => '€' + Math.round(n).toLocaleString('en-US');
/** "€14,000" → 14000 (digits only, like the prototype). */
export const valueNum = (v: unknown): number => Number(String(v).replace(/[^0-9]/g, '')) || 0;

export const initialsOf = (name: string | undefined): string =>
  String(name || '')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');

export const todayLabel = (): string => new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });

// ---------------------------------------------------------------- funnels & leads

export const stagesFor = (s: State, seg: SegKey): Stage[] => s.funnels[seg].stages;
export const stageOf = (s: State, lead: Lead): Stage => {
  const stages = stagesFor(s, lead.segment);
  return stages.find((st) => st.id === lead.stage) ?? stages[0]!;
};
export const leadById = (s: State, id: string | null | undefined): Lead | undefined => s.leads.find((l) => l.id === id);
export const ownerOf = (l: Lead): string => OWNERS[(Number(String(l.id).replace(/\D/g, '')) - 1 + OWNERS.length) % OWNERS.length]!;
export const bandOf = (v: string): string => {
  const n = valueNum(v);
  return n < 25000 ? 'Under €25k' : n <= 100000 ? '€25k–€100k' : 'Over €100k';
};

export function defaultCloseDate(lead: Lead): string {
  const seed = String(lead.id)
    .split('')
    .reduce((a, c) => a + c.charCodeAt(0), 0);
  const d = new Date();
  d.setDate(d.getDate() + 5 + (seed % 330));
  return d.toISOString().slice(0, 10);
}
/** "" means the user cleared it on purpose. */
export const closeIsoOf = (lead: Lead): string => (lead.closeDate === '' ? '' : lead.closeDate || defaultCloseDate(lead));

export function defaultStart(lead: Lead | undefined): string {
  const base = lead && lead.closeDate ? lead.closeDate : lead ? defaultCloseDate(lead) : '2026-10-01';
  const d = new Date(base);
  if (isNaN(d.getTime())) return base;
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function monthLabel(start: string | undefined, add: number): string {
  const d = new Date(start || '2026-10-01');
  if (isNaN(d.getTime())) return '—';
  d.setMonth(d.getMonth() + add);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function shiftIso(start: string | undefined, add: number): string {
  const d = new Date(start || '2026-10-01');
  if (isNaN(d.getTime())) return start || '';
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

/** Every dated payment a lead's lines produce (subscriptions: next 12 months). */
export function paymentsFor(s: State, lead: Lead): { when: Date; amount: number }[] {
  const out: { when: Date; amount: number }[] = [];
  const push = (iso: string, amount: number) => {
    const d = new Date(iso);
    if (!isNaN(d.getTime())) out.push({ when: d, amount });
  };
  for (const ln of linesOf(s, lead)) {
    const gross = grossOf(ln);
    const startIso = ln.start || '2026-10-01';
    if (ln.schedule === 'Custom milestones') (ln.milestones || []).forEach((m, i) => push(m.date || shiftIso(startIso, i), (gross * num(m.pct)) / 100));
    else if (ln.schedule === 'Equal monthly instalments') {
      const n = Math.max(1, Math.round(num(ln.months)) || 1);
      for (let i = 0; i < n; i++) push(shiftIso(startIso, i), gross / n);
    } else if (ln.schedule === 'Recurring subscription') for (let i = 0; i < 12; i++) push(shiftIso(startIso, i), gross);
    else push(startIso, gross);
  }
  return out;
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
    }))
    .concat(s.extraPeople);
}
export const personById = (s: State, id: string | null | undefined): Person | undefined => allPeople(s).find((p) => p.id === id);
export function contactsForLead(s: State, leadId: string): Person[] {
  const links = s.links[leadId] || [];
  return allPeople(s).filter((p) => p.leadId === leadId || links.includes(p.id));
}

export interface CompanyRecord {
  id?: string;
  name: string;
  industry: string;
  hq: string;
  size: string;
  source: string;
  owner: string;
  leads: Lead[];
  contactCount: number;
  oppCount: number;
  value: number;
  valueLabel: string;
  stageName: string;
  lastTouch: string;
}

/** Companies are derived from leads, plus companies added without a deal yet. */
export function companyRecords(s: State): CompanyRecord[] {
  const map = new Map<string, Omit<CompanyRecord, 'contactCount' | 'oppCount' | 'value' | 'valueLabel' | 'stageName' | 'lastTouch'>>();
  for (const l of s.leads) {
    if (!map.has(l.company)) map.set(l.company, { id: l.companyId ?? undefined, name: l.company, industry: l.industry, hq: l.hq, size: l.size, source: l.source, owner: ownerOf(l), leads: [] });
    map.get(l.company)!.leads.push(l);
  }
  for (const c of s.extraCompanies) {
    const known = map.get(c.name);
    if (known) known.id ??= c.id;
    else map.set(c.name, { ...c, leads: [] });
  }
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
      valueLabel: '€' + value.toLocaleString('en-US'),
      stageName: last ? stageOf(s, last).name : '—',
      lastTouch: stall === null ? '—' : stall === 0 ? 'Today' : stall + 'd ago',
    };
  });
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

// ---------------------------------------------------------------- sales bonuses

export function bonusRule(s: State, owner: string) {
  const trigger = s.workspace.bonusTrigger || 'On contract signed';
  const saved = s.bonusRules[owner];
  return { rate: saved?.rate ?? 3, floor: saved?.floor ?? 10000, fixed: saved?.fixed ?? 250, trigger };
}
export const bonusOf = (lead: Lead, rule: { rate: number | string; floor: number | string; fixed: number | string }): number => {
  const net = num(lead.value);
  return net >= num(rule.floor) ? (net * num(rule.rate)) / 100 : num(rule.fixed);
};
export const salesPeople = (s: State): string[] => s.team.filter((m) => m.role === 'Sales').map((m) => m.name);
