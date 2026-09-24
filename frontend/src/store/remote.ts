/**
 * Loads a workspace from the API and maps it onto the UI's model. The design is lead-centric:
 * a lead (deal) shows its company and primary contact inline, companies are derived from leads
 * plus companies without a deal, and people are primary contacts plus everyone else.
 */
import { type ApiActivity, type ApiBonusRules, type ApiCompany, type ApiCustomField, type ApiDealLine, type ApiDealTask, type ApiContact, type ApiFunnel, type ApiInvitation, type ApiMember, type ApiProduct, type ApiProfile, type ApiStageChange, type ApiWorkspace, ApiError, crmApi } from '../lib/api';
import { initialsOf, localeFor, momentLabel, money, taskKey } from './selectors';
import type { BonusRule, CatalogItem, CompanyExtra, CustomFieldDef, DealLine, Funnel, Lead, LeadTask, LogEntry, Person, Profile, SegKey, StageChange, State, TeamMember, Workspace } from './types';

export type WorkspaceData = Pick<
  State,
  | 'funnels'
  | 'leads'
  | 'extraCompanies'
  | 'extraPeople'
  | 'links'
  | 'catalog'
  | 'champ'
  | 'dealLines'
  | 'tasks'
  | 'extraTodos'
  | 'extraTodoIds'
  | 'leadTasks'
  | 'team'
  | 'workspace'
  | 'profile'
  | 'customFields'
  | 'customValues'
  | 'bonusRules'
  | 'bonusTrigger'
  | 'versions'
>;

export const ROLE_LABEL = { owner: 'Owner', admin: 'Admin', member: 'Member' } as const;
const DAY = 86_400_000;

function mapFunnel(f: ApiFunnel): Funnel {
  return {
    id: f.id,
    label: f.label,
    note: f.note ?? '',
    stages: f.stages.map((st) => ({
      id: st.id,
      key: st.key,
      name: st.name,
      activity: st.activity,
      channel: st.channel,
      doc: st.documentOnEntry ?? 'None',
      checklist: st.checklistItems.map((i) => i.label),
      checklistIds: st.checklistItems.map((i) => i.id),
      prob: st.winProbability,
      won: st.isWon,
    })),
  };
}

/** A moment as "23 Sep" on the workspace calendar (its time zone, `tz`). */
const dateLabel = (iso: string, tz?: string) => momentLabel(iso, tz);

export const mapLine = (l: ApiDealLine): DealLine => ({
  id: l.id,
  itemId: l.productId ?? '',
  qty: Number(l.quantity),
  price: Number(l.unitPrice),
  vat: Number(l.vatRate),
  schedule: l.schedule,
  start: l.startDate ?? '',
  months: l.months,
  milestones: l.milestones,
});

export const mapCustomField = ({ position: _position, ...f }: ApiCustomField): CustomFieldDef => f;

export const mapProduct = (p: ApiProduct): CatalogItem => ({ id: p.id, name: p.name, type: p.type, kind: p.billingKind, price: Number(p.unitPrice), vat: Number(p.vatRate), currency: p.currency });

/** Bonus rules by user id (CD-17); numbers as the inputs show them. */
export const mapBonusRules = (b: ApiBonusRules): Record<string, BonusRule> =>
  Object.fromEntries(b.rules.map((r) => [r.userId, { rate: Number(r.rate), floor: Number(r.floor), fixed: Number(r.fixed) }]));

/** The bonus rules, or null for members: the API answers them 403 (CD-17). */
const loadBonusRules = () => crmApi.bonusRules().catch((err: unknown) => (err instanceof ApiError && err.status === 403 ? null : Promise.reject(err)));

/** Workspace settings. */
export const mapWorkspace = (w: ApiWorkspace): Workspace => ({ name: w.name, currency: w.currency, timezone: w.timezone, fiscalMonth: w.fiscalYearStartMonth });

export const mapProfile = (p: ApiProfile): Profile => ({
  name: p.displayName ?? p.email ?? '',
  title: p.jobTitle ?? '',
  email: p.email ?? '',
  phone: p.phone ?? '',
  language: p.language,
  dateFormat: p.dateFormat,
  startPage: p.startPage,
  defaultFunnelId: p.defaultFunnelId ?? '',
  digest: p.dailyDigest,
  dealAssigned: p.notifyDealAssigned,
});

/** Members, then pending invitations with their email status. */
export const mapTeam = (apiTeam: { members: ApiMember[]; invitations: ApiInvitation[] }): TeamMember[] => [
  ...apiTeam.members.map<TeamMember>((m) => ({ id: m.userId, name: m.displayName || m.email || 'Member', email: m.email ?? '', role: ROLE_LABEL[m.role], status: 'Active' })),
  ...apiTeam.invitations.map<TeamMember>((i) => ({
    id: i.id,
    name: i.email,
    email: i.email,
    role: ROLE_LABEL[i.role],
    status: 'Invited',
    invite: { emailStatus: i.emailStatus, emailSentAt: i.emailSentAt, emailError: i.emailError, hasLink: i.hasLink },
  })),
];

export const mapActivity = (a: ApiActivity, tz?: string): LogEntry => ({ date: dateLabel(a.occurredAt, tz), channel: a.channel, title: a.title, detail: a.detail ?? '' });

export const mapStageChange = (c: ApiStageChange): StageChange => ({
  dealId: c.dealId,
  kind: c.kind,
  fromStageId: c.fromStageId,
  toStageId: c.toStageId,
  outcome: c.outcome,
  at: Date.parse(c.changedAt),
});

export const mapLeadTask = (t: ApiDealTask, tz?: string): LeadTask => ({
  id: t.id,
  leadId: t.dealId,
  stageId: t.stageId,
  title: t.label,
  channel: t.channel ?? 'RS',
  due: t.dueDate ?? '',
  ownerId: t.assigneeUserId ?? '',
  ownerName: t.assigneeName ?? undefined,
  note: t.note ?? '',
  done: t.done,
  at: t.doneAt ? dateLabel(t.doneAt, tz) : undefined,
  by: t.doneByName?.split(' ')[0] ?? undefined,
});

/** What the workspace is built from, one API list each. */
const PARTS = {
  funnels: () => crmApi.funnels(),
  companies: () => crmApi.companies(),
  contacts: () => crmApi.contacts(),
  deals: () => crmApi.deals(),
  products: () => crmApi.products(),
  lines: () => crmApi.dealLines(),
  tasks: () => crmApi.dealTasks(),
  team: () => crmApi.team(),
  workspace: () => crmApi.workspace(),
  profile: () => crmApi.profile(),
  customFields: () => crmApi.customFields(),
  bonus: () => loadBonusRules(),
};
export type Part = keyof typeof PARTS;
type Raw = { [K in Part]: Awaited<ReturnType<(typeof PARTS)[K]>> };
/** The lists the last load read, so a live update (CD-20) re-reads only the ones that changed. */
let lastRaw: Raw | null = null;

/**
 * Loads the workspace. With `only`, just those lists are read again and the others are taken
 * from the previous load (live updates); without it, everything is read.
 */
export async function loadWorkspace(only?: ReadonlySet<Part>): Promise<WorkspaceData> {
  const prev = only ? lastRaw : null;
  const keys = (Object.keys(PARTS) as Part[]).filter((k) => !prev || only!.has(k));
  const fetched = await Promise.all(keys.map((k) => PARTS[k]()));
  const raw = { ...prev } as Record<Part, unknown>;
  keys.forEach((k, i) => (raw[k] = fetched[i]));
  lastRaw = raw as Raw;
  const { funnels: apiFunnels, companies, contacts, deals: dealRows, products, lines: apiLines, tasks: apiTasks, team: apiTeam, workspace: apiWorkspace, profile: apiProfile, customFields: apiFields, bonus: apiBonus } = lastRaw;

  const team = mapTeam(apiTeam);

  // Every funnel, keyed by its id, in the workspace's order (CD-10).
  if (apiFunnels.length === 0) throw new Error('This workspace has no funnel.');
  const funnels: State['funnels'] = {};
  for (const f of apiFunnels) funnels[f.id] = mapFunnel(f);

  const tz = apiWorkspace.timezone;
  const locale = localeFor(apiWorkspace.currency);
  const companyById = new Map<string, ApiCompany>(companies.map((c) => [c.id, c]));
  const contactById = new Map<string, ApiContact>(contacts.map((c) => [c.id, c]));
  const now = Date.now();

  const leads: Lead[] = [];
  const champ: State['champ'] = {};
  for (const { deal, ownerName } of dealRows) {
    const segment: SegKey = deal.funnelId;
    if (!funnels[segment]) continue; // a funnel created after the funnels were read; the next load has it
    const co = deal.companyId ? companyById.get(deal.companyId) : undefined;
    const ct = deal.primaryContactId ? contactById.get(deal.primaryContactId) : undefined;
    const lastTouch = Date.parse(deal.lastContactAt ?? deal.createdAt);
    leads.push({
      id: deal.id,
      companyId: deal.companyId,
      contactId: deal.primaryContactId,
      title: deal.title,
      company: co?.name ?? 'No company',
      contact: ct?.fullName ?? 'No primary contact',
      role: ct?.jobTitle ?? '—',
      initials: ct ? initialsOf(ct.fullName) : '—',
      email: ct?.email ?? '—',
      phone: ct?.phone ?? '—',
      buyerRole: ct?.buyerRole,
      contactOwnerId: ct?.ownerUserId,
      contactOwner: ct?.ownerName ?? undefined,
      owner: ownerName ?? undefined,
      ownerId: deal.ownerUserId,
      segment,
      stage: deal.stageId,
      value: money(Number(deal.amount), { currency: deal.currency, locale }),
      currency: deal.currency,
      score: deal.fitScore,
      stall: Math.max(0, Math.floor((now - lastTouch) / DAY)),
      industry: co?.industry ?? '—',
      hq: co?.hq ?? '—',
      size: co?.teamSize ?? '—',
      source: deal.source ?? co?.source ?? '—',
      need: deal.need ?? '',
      constraint: deal.constraint ?? '',
      decisionMaker: deal.decisionMaker ?? '',
      discoveryDate: deal.discoveryDate ?? '',
      headline: deal.headline ?? '',
      lines: [],
      total: money(Number(deal.amount), { currency: deal.currency, locale }),
      closeDate: deal.closeDate ?? '',
      outcome: deal.outcome,
      lostReason: deal.lostReason ?? undefined,
      lostNote: deal.lostNote ?? undefined,
      lostAt: deal.lostAt ?? undefined,
    });
    if (deal.champ) champ[deal.id] = deal.champ as State['champ'][string];
  }

  const extraCompanies: CompanyExtra[] = companies.map((c) => ({
    id: c.id,
    name: c.name,
    industry: c.industry ?? '',
    hq: c.hq ?? '',
    size: c.teamSize ?? '',
    source: c.source ?? '',
    owner: c.ownerName ?? '',
    ownerId: c.ownerUserId,
  }));

  // Everyone who isn't already shown as a lead's primary contact.
  const primaryOf = new Map<string, string>(); // contactId → first lead where they are primary
  for (const l of leads) if (l.contactId && !primaryOf.has(l.contactId)) primaryOf.set(l.contactId, l.id);
  const linkedLead = new Map<string, string>();
  for (const r of dealRows) for (const cid of r.contactIds) if (!linkedLead.has(cid)) linkedLead.set(cid, r.deal.id);

  const extraPeople: Person[] = contacts
    .filter((c) => !primaryOf.has(c.id))
    .map((c) => ({
      id: c.id,
      contactId: c.id,
      companyId: c.companyId,
      company: c.companyId ? companyById.get(c.companyId)?.name : undefined,
      leadId: linkedLead.get(c.id) ?? leads.find((l) => c.companyId && l.companyId === c.companyId)?.id ?? '',
      primary: false,
      name: c.fullName,
      role: c.jobTitle ?? '',
      email: c.email ?? '',
      phone: c.phone ?? '',
      linkedin: c.linkedin ?? undefined,
      buyerRole: c.buyerRole,
      initials: initialsOf(c.fullName),
      ownerId: c.ownerUserId,
      ownerName: c.ownerName ?? undefined,
    }));

  const personIdOf = (contactId: string) => (primaryOf.has(contactId) ? primaryOf.get(contactId)! + ':p' : contactId);
  const links: State['links'] = {};
  for (const r of dealRows) if (r.contactIds.length) links[r.deal.id] = r.contactIds.map(personIdOf);

  const catalog: CatalogItem[] = products.map(mapProduct);
  const customValues: State['customValues'] = {
    deal: Object.fromEntries(dealRows.map((r) => [r.deal.id, r.deal.customFields ?? {}])),
    company: Object.fromEntries(companies.map((c) => [c.id, c.customFields ?? {}])),
    contact: Object.fromEntries(contacts.map((c) => [c.id, c.customFields ?? {}])),
  };

  const dealLines: State['dealLines'] = {};
  for (const l of apiLines) (dealLines[l.dealId] ||= []).push(mapLine(l));

  // To-dos: playbook items are matched to the stage checklist by item id (idx = checklist position),
  // so renaming an item keeps them; off-playbook items follow the checklist, in their saved order.
  const stageById = new Map(Object.values(funnels).flatMap((f) => f.stages.map((st) => [st.id, st] as const)));
  const tasks: State['tasks'] = {};
  const extraTodos: State['extraTodos'] = {};
  const extraTodoIds: State['extraTodoIds'] = {};
  const leadTasks: LeadTask[] = [];
  for (const t of apiTasks) {
    if (!t.blocksAdvance) {
      leadTasks.push(mapLeadTask(t, tz));
      continue;
    }
    const stage = stageById.get(t.stageId);
    if (!stage) continue;
    let idx: number;
    if (t.offPlaybook) {
      const key = t.dealId + '::' + t.stageId;
      (extraTodos[key] ||= []).push(t.label);
      (extraTodoIds[key] ||= []).push(t.id);
      idx = stage.checklist.length + extraTodos[key].length - 1;
    } else {
      idx = t.checklistItemId ? stage.checklistIds.indexOf(t.checklistItemId) : -1;
      if (idx < 0) continue; // the checklist item was removed since
    }
    tasks[taskKey(t.dealId, t.stageId, idx)] = {
      done: t.done,
      at: t.doneAt ? dateLabel(t.doneAt, tz) : undefined,
      by: t.doneByName?.split(' ')[0] ?? undefined,
      outcome: t.outcome ?? undefined,
      note: t.note ?? undefined,
    };
  }

  // The version of each deal, company and contact as loaded: sent as If-Match when editing (CD-20).
  const versions: State['versions'] = {};
  for (const { deal } of dealRows) versions['deal:' + deal.id] = deal.updatedAt;
  for (const c of companies) versions['company:' + c.id] = c.updatedAt;
  for (const c of contacts) versions['contact:' + c.id] = c.updatedAt;

  return {
    versions,
    funnels,
    leads,
    extraCompanies,
    extraPeople,
    links,
    catalog,
    champ,
    dealLines,
    tasks,
    extraTodos,
    extraTodoIds,
    leadTasks,
    team,
    workspace: mapWorkspace(apiWorkspace),
    profile: mapProfile(apiProfile),
    customFields: apiFields.map(mapCustomField),
    customValues,
    bonusRules: apiBonus ? mapBonusRules(apiBonus) : null,
    bonusTrigger: apiBonus?.trigger ?? 'On contract signed',
  };
}
