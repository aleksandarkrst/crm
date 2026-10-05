/**
 * Loads a workspace from the API and maps it onto the UI's model. The design is lead-centric:
 * a lead (deal) shows its company and primary contact inline, companies are derived from leads
 * plus companies without a deal, and people are primary contacts plus everyone else.
 */
import { type ApiActivity, type ApiBonusRules, type ApiCompany, type ApiCustomField, type ApiDealLine, type ApiDealRow, type ApiDealTask, type ApiContact, type ApiFunnel, type ApiInvitation, type ApiMember, type ApiProduct, type ApiProfile, type ApiStageChange, type ApiVisitPlan, type ApiWorkspace, ApiError, crmApi } from '../lib/api';
import { initialsOf, localeFor, momentLabel, money, taskKey } from './selectors';
import { sortPlans } from './visitPlans';
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
  | 'onboarding'
  | 'visitPlans'
  | 'visitScope'
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
  description: l.description ?? '',
  qty: Number(l.quantity),
  price: Number(l.unitPrice),
  discountKind: l.discountKind,
  discount: Number(l.discountValue),
  vat: Number(l.vatRate),
  frequency: l.billingFrequency,
  cycles: l.billingFrequency === 'one_time' ? null : l.billingCycles,
  start: l.startDate ?? '',
});

export const mapCustomField = ({ position: _position, ...f }: ApiCustomField): CustomFieldDef => f;

export const mapProduct = (p: ApiProduct): CatalogItem => ({
  id: p.id,
  name: p.name,
  description: p.description ?? '',
  unit: p.unit ?? '',
  price: Number(p.unitPrice),
  qty: Number(p.quantity),
  vat: Number(p.vatRate),
  frequency: p.billingFrequency,
  cycles: p.billingFrequency === 'one_time' ? null : p.billingCycles,
});

/** Bonus rules by user id (CD-17); numbers as the inputs show them. */
export const mapBonusRules = (b: ApiBonusRules): Record<string, BonusRule> =>
  Object.fromEntries(b.rules.map((r) => [r.userId, { rate: Number(r.rate), floor: Number(r.floor), fixed: Number(r.fixed) }]));

/** The bonus rules, or null for members: the API answers them 403 (CD-17). */
const loadBonusRules = () => crmApi.bonusRules().catch((err: unknown) => (err instanceof ApiError && err.status === 403 ? null : Promise.reject(err)));

/** Getting started (CD-68), or null for members: the API answers them 403. */
const loadOnboarding = () => crmApi.onboarding().catch((err: unknown) => (err instanceof ApiError && err.status === 403 ? null : Promise.reject(err)));

/** Workspace settings. */
export const mapWorkspace = (w: ApiWorkspace): Workspace => ({
  name: w.name,
  currency: w.currency,
  timezone: w.timezone,
  fiscalMonth: w.fiscalYearStartMonth,
  customerEmailLanguage: w.customerEmailLanguage,
  employeeDefaultWeeklyHours: w.employeeDefaultWeeklyHours,
  employeeNumberRequired: w.employeeNumberRequired,
  employeeSelfEditBank: w.employeeSelfEditBank,
});

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
  meetingInvites: p.notifyMeetingInvites,
  visitPlans: p.notifyVisitPlans,
  orgChanges: p.notifyOrgChanges,
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
  onboarding: () => loadOnboarding(),
  /** Customer visit plans (CD-134); members get only their own. */
  visitPlans: () => crmApi.visitPlans(),
  /** Whose plans this user sees and manages (CD-142). */
  visitScope: () => crmApi.visitPlanScope(),
};
export type Part = keyof typeof PARTS;
type Raw = { [K in Part]: Awaited<ReturnType<(typeof PARTS)[K]>> };
/** The lists the last load read, so a live update (CD-20) re-reads only the ones that changed. */
let lastRaw: Raw | null = null;

/**
 * The lists a live update can re-read row by row (CD-98): `fetch` gets the rows named by a change
 * hint (by id, or for lines and to-dos by deal), `key` says which hinted id a row belongs to, and
 * `order` sorts the merged list the way the API does where screens show it in list order.
 */
type Rows = { fetch: (ids: string[]) => Promise<unknown[]>; key: (row: never) => string; order?: (rows: unknown[], raw: Raw) => unknown[] };
const BY_ID: Partial<Record<Part, Rows>> = {
  deals: {
    fetch: (ids) => crmApi.deals(ids),
    key: (r: ApiDealRow) => r.deal.id,
    // As the API sorts them: by stage position, then most recently changed first.
    order: (rows, raw) => {
      const position = new Map<string, number>();
      for (const f of raw.funnels) for (const st of f.stages) position.set(st.id, st.position);
      return [...(rows as ApiDealRow[])].sort(
        (a, b) => (position.get(a.deal.stageId) ?? 0) - (position.get(b.deal.stageId) ?? 0) || b.deal.updatedAt.localeCompare(a.deal.updatedAt),
      );
    },
  },
  companies: { fetch: (ids) => crmApi.companies(ids), key: (r: ApiCompany) => r.id },
  contacts: { fetch: (ids) => crmApi.contacts(ids), key: (r: ApiContact) => r.id },
  products: { fetch: (ids) => crmApi.products(ids), key: (r: ApiProduct) => r.id, order: (rows) => [...(rows as ApiProduct[])].sort((a, b) => a.name.localeCompare(b.name)) },
  lines: { fetch: (ids) => crmApi.dealLines(ids), key: (r: ApiDealLine) => r.dealId },
  tasks: { fetch: (ids) => crmApi.dealTasks(ids), key: (r: ApiDealTask) => r.dealId },
  visitPlans: { fetch: (ids) => crmApi.visitPlans(ids), key: (r: ApiVisitPlan) => r.id, order: (rows) => sortPlans(rows as ApiVisitPlan[]) },
};
/** More ids than this and the whole list is read instead (the API takes at most 200). */
const MAX_IDS = 200;

/**
 * What a live update names per list: re-read only these rows (ids, or deal ids for `lines` and
 * `tasks`). A list that is refreshed but has no entry here is read whole.
 */
export type Changed = Partial<Record<Part, ReadonlySet<string>>>;

/** Replaces the rows of the hinted keys with the fresh ones, in place; new keys go at the end. */
function merge(prev: unknown[], fresh: unknown[], ids: ReadonlySet<string>, key: (row: never) => string): unknown[] {
  const groups = new Map<string, unknown[]>();
  for (const row of fresh) {
    const k = key(row as never);
    groups.set(k, [...(groups.get(k) ?? []), row]);
  }
  const out: unknown[] = [];
  const done = new Set<string>();
  for (const row of prev) {
    const k = key(row as never);
    if (!ids.has(k)) out.push(row);
    else if (!done.has(k)) {
      done.add(k);
      out.push(...(groups.get(k) ?? [])); // none: deleted (or no longer visible)
    }
  }
  for (const [k, rows] of groups) if (!done.has(k)) out.push(...rows);
  return out;
}

/**
 * Loads the workspace. With `only`, just those lists are read again and the others are taken
 * from the previous load (live updates); lists with ids in `changed` are re-read only for those
 * rows. Without `only`, everything is read.
 */
export async function loadWorkspace(only?: ReadonlySet<Part>, changed: Changed = {}): Promise<WorkspaceData> {
  const prev = only ? lastRaw : null;
  const keys = (Object.keys(PARTS) as Part[]).filter((k) => !prev || only!.has(k));
  const partial = (k: Part) => (prev && BY_ID[k] && changed[k] && changed[k].size <= MAX_IDS ? [...changed[k]] : null);
  const fetched = await Promise.all(keys.map((k) => (partial(k) ? BY_ID[k]!.fetch(partial(k)!) : PARTS[k]())));
  const raw = { ...prev } as Record<Part, unknown>;
  keys.forEach((k, i) => {
    const ids = partial(k);
    raw[k] = ids && prev ? merge(prev[k] as unknown[], fetched[i] as unknown[], new Set(ids), BY_ID[k]!.key) : fetched[i];
  });
  for (const k of keys) {
    const order = BY_ID[k]?.order;
    if (order && partial(k)) raw[k] = order(raw[k] as unknown[], raw as Raw);
  }
  lastRaw = raw as Raw;
  const { funnels: apiFunnels, companies, contacts, deals: dealRows, products, lines: apiLines, tasks: apiTasks, team: apiTeam, workspace: apiWorkspace, profile: apiProfile, customFields: apiFields, bonus: apiBonus, onboarding, visitPlans, visitScope } = lastRaw;

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
      contactNotes: ct?.notes ?? '',
      contactLinkedin: ct?.linkedin ?? '',
      contactOwnerId: ct?.ownerUserId,
      contactOwner: ct?.ownerName ?? undefined,
      owner: ownerName ?? undefined,
      ownerId: deal.ownerUserId,
      segment,
      stage: deal.stageId,
      value: money(Number(deal.amount), { currency: deal.currency, locale }),
      currency: deal.currency,
      taxMode: deal.taxMode,
      discounts: deal.discounts ?? [],
      installments: (deal.installments ?? []).map((i) => ({ ...i, date: i.date ?? '' })),
      stageSince: deal.stageEnteredAt,
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
    domain: c.domain ?? '',
    notes: c.notes ?? '',
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
      notes: c.notes ?? '',
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
  for (const p of visitPlans) versions['visit_plan:' + p.id] = p.updatedAt;

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
    onboarding,
    visitPlans: sortPlans(visitPlans),
    visitScope,
  };
}
