/**
 * Loads a workspace from the API and maps it onto the UI's model. The design is lead-centric:
 * a lead (deal) shows its company and primary contact inline, companies are derived from leads
 * plus companies without a deal, and people are primary contacts plus everyone else.
 */
import { type ApiActivity, type ApiCompany, type ApiDealLine, type ApiDealTask, type ApiContact, type ApiFunnel, crmApi } from '../lib/api';
import { initialsOf, money, taskKey } from './selectors';
import type { CatalogItem, CompanyExtra, DealLine, Funnel, Lead, LeadTask, LogEntry, Person, SegKey, State, TeamMember } from './types';

export type WorkspaceData = Pick<
  State,
  'funnels' | 'leads' | 'extraCompanies' | 'extraPeople' | 'links' | 'catalog' | 'champ' | 'dealLines' | 'tasks' | 'extraTodos' | 'extraTodoIds' | 'leadTasks' | 'team'
>;

const SEGMENTS: SegKey[] = ['smb', 'ent'];
export const ROLE_LABEL = { owner: 'Owner', admin: 'Admin', member: 'Member' } as const;
const DAY = 86_400_000;

function mapFunnel(f: ApiFunnel): Funnel {
  return {
    id: f.id,
    label: f.label,
    note: f.note ?? '',
    stages: f.stages.map((st) => ({
      id: st.id,
      name: st.name,
      activity: st.activity,
      channel: st.channel,
      doc: st.documentOnEntry ?? 'None',
      checklist: st.checklist,
      prob: st.winProbability,
      won: st.isWon,
    })),
  };
}

const dateLabel = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });

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

export const mapActivity = (a: ApiActivity): LogEntry => ({ date: dateLabel(a.occurredAt), channel: a.channel, title: a.title, detail: a.detail ?? '' });

export const mapLeadTask = (t: ApiDealTask): LeadTask => ({
  id: t.id,
  leadId: t.dealId,
  stageId: t.stageId,
  title: t.label,
  channel: t.channel ?? 'RS',
  due: t.dueDate ?? '',
  ownerId: t.assigneeUserId ?? '',
  note: t.note ?? '',
  done: t.done,
  at: t.doneAt ? dateLabel(t.doneAt) : undefined,
  by: t.doneByName?.split(' ')[0] ?? undefined,
});

export async function loadWorkspace(): Promise<WorkspaceData> {
  const [apiFunnels, companies, contacts, dealRows, products, apiLines, apiTasks, apiTeam] = await Promise.all([
    crmApi.funnels(),
    crmApi.companies(),
    crmApi.contacts(),
    crmApi.deals(),
    crmApi.products(),
    crmApi.dealLines(),
    crmApi.dealTasks(),
    crmApi.team(),
  ]);

  const team: TeamMember[] = [
    ...apiTeam.members.map<TeamMember>((m) => ({ id: m.userId, name: m.displayName || m.email || 'Member', email: m.email ?? '', role: ROLE_LABEL[m.role], status: 'Active' })),
    ...apiTeam.invitations.map<TeamMember>((i) => ({ id: i.id, name: i.email, email: i.email, role: ROLE_LABEL[i.role], status: 'Invited' })),
  ];
  // Owners are shown by the same name as in the team list, so the Salesperson filters match.
  const nameOf = (userId: string | null) => team.find((m) => m.status === 'Active' && m.id === userId)?.name;

  const funnels = {} as State['funnels'];
  const segOfFunnel = new Map<string, SegKey>();
  for (const seg of SEGMENTS) {
    const f = apiFunnels.find((x) => x.key === seg);
    if (!f) throw new Error(`This workspace has no "${seg}" funnel.`);
    funnels[seg] = mapFunnel(f);
    segOfFunnel.set(f.id, seg);
  }

  const companyById = new Map<string, ApiCompany>(companies.map((c) => [c.id, c]));
  const contactById = new Map<string, ApiContact>(contacts.map((c) => [c.id, c]));
  const now = Date.now();

  const leads: Lead[] = [];
  const champ: State['champ'] = {};
  for (const { deal } of dealRows) {
    const segment = segOfFunnel.get(deal.funnelId);
    if (!segment) continue; // funnels beyond the two personas aren't shown by this UI yet
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
      owner: nameOf(deal.ownerUserId),
      ownerId: deal.ownerUserId,
      segment,
      stage: deal.stageId,
      value: money(Number(deal.amount)),
      score: deal.fitScore,
      stall: Math.max(0, Math.floor((now - lastTouch) / DAY)),
      industry: co?.industry ?? '—',
      hq: co?.hq ?? '—',
      size: co?.teamSize ?? '—',
      source: deal.source ?? co?.source ?? '—',
      need: 'scope still to be captured in discovery.',
      constraint: 'not captured yet',
      decisionMaker: ct?.fullName ?? '—',
      discoveryDate: '—',
      headline: deal.title,
      lines: [],
      total: money(Number(deal.amount)),
      closeDate: deal.closeDate ?? '',
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
    owner: nameOf(c.ownerUserId) ?? '—',
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
    }));

  const personIdOf = (contactId: string) => (primaryOf.has(contactId) ? primaryOf.get(contactId)! + ':p' : contactId);
  const links: State['links'] = {};
  for (const r of dealRows) if (r.contactIds.length) links[r.deal.id] = r.contactIds.map(personIdOf);

  const catalog: CatalogItem[] = products.map((p) => ({ id: p.id, name: p.name, type: p.type, kind: p.billingKind, price: Number(p.unitPrice), vat: Number(p.vatRate) }));

  const dealLines: State['dealLines'] = {};
  for (const l of apiLines) (dealLines[l.dealId] ||= []).push(mapLine(l));

  // To-dos: playbook items are matched to the stage checklist by label (idx = checklist position);
  // off-playbook items follow the checklist, in their saved order.
  const stageById = new Map(SEGMENTS.flatMap((seg) => funnels[seg].stages.map((st) => [st.id, st] as const)));
  const tasks: State['tasks'] = {};
  const extraTodos: State['extraTodos'] = {};
  const extraTodoIds: State['extraTodoIds'] = {};
  const leadTasks: LeadTask[] = [];
  for (const t of apiTasks) {
    if (!t.blocksAdvance) {
      leadTasks.push(mapLeadTask(t));
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
      idx = stage.checklist.indexOf(t.label);
      if (idx < 0) continue; // the checklist item was renamed or removed since
    }
    tasks[taskKey(t.dealId, t.stageId, idx)] = {
      done: t.done,
      at: t.doneAt ? dateLabel(t.doneAt) : undefined,
      by: t.doneByName?.split(' ')[0] ?? undefined,
      outcome: t.outcome ?? undefined,
      note: t.note ?? undefined,
    };
  }

  return { funnels, leads, extraCompanies, extraPeople, links, catalog, champ, dealLines, tasks, extraTodos, extraTodoIds, leadTasks, team };
}
