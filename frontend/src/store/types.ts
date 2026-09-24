import type { ApiDateFormat, ApiLanguage, ApiStageChange, ApiStartPage, DealOutcome, LostReason } from '../lib/api';

export type SegKey = 'smb' | 'ent';
export type ChannelCode = 'RS' | 'EM' | 'LI' | 'WA' | 'MT' | 'PH' | 'NT';

export interface Stage {
  id: string;
  /** Stable slug from the funnel template ("proposal", "won", ...). */
  key?: string;
  name: string;
  activity: string;
  channel: ChannelCode;
  doc: string; // "None" | "Proposal" | ...
  checklist: string[];
  prob: number | '';
  /** The terminal "won" stage. */
  won?: boolean;
}

export interface Funnel {
  /** Backend funnel id. */
  id?: string;
  label: string;
  note: string;
  stages: Stage[];
}

export interface LeadDoc {
  name: string;
  state: 'draft' | 'sent' | 'signed';
  meta: string;
}

/** A lead is a deal: one company + primary contact moving through a funnel. */
export interface Lead {
  id: string;
  /** Backend references (the UI shows the company and primary contact inline on the lead). */
  companyId?: string | null;
  contactId?: string | null;
  title?: string;
  company: string;
  contact: string;
  role: string;
  initials: string;
  email: string;
  phone: string;
  buyerRole?: string;
  /** Last known name of the deal owner, from the API. Show it with ownerOf(), match by ownerId. */
  owner?: string;
  /** User id of the deal owner. */
  ownerId?: string | null;
  segment: SegKey;
  stage: string;
  value: string; // "€14,000"
  score: number;
  stall: number; // days since last contact
  industry: string;
  hq: string;
  size: string;
  source: string;
  need: string;
  constraint: string;
  decisionMaker: string;
  discoveryDate: string;
  headline: string;
  lines: [string, string][];
  total: string;
  docs?: LeadDoc[];
  closeDate?: string;
  /** Won while in the won stage; lost deals keep the stage they were lost in. */
  outcome: DealOutcome;
  lostReason?: LostReason;
  lostNote?: string;
  /** ISO date-time the deal was marked lost. */
  lostAt?: string;
}

export interface Person {
  id: string;
  /** The deal this person is shown under; '' when their company has no deal yet. */
  leadId: string;
  /** Backend contact id (a primary contact's Person id is "<leadId>:p"). */
  contactId?: string;
  companyId?: string | null;
  company?: string;
  primary: boolean;
  name: string;
  role: string;
  email: string;
  phone: string;
  linkedin?: string;
  buyerRole?: string;
  initials: string;
}

export interface CompanyExtra {
  id?: string;
  name: string;
  industry: string;
  hq: string;
  size: string;
  source: string;
  /** Last known name of the owner, from the API (see memberName). */
  owner: string;
  ownerId?: string | null;
}

export interface CatalogItem {
  id: string;
  name: string;
  type: string;
  kind: string; // One-off | Monthly | Yearly | Hourly
  price: number | string;
  vat: number | string;
}

export interface Milestone {
  label: string;
  pct: number | string;
  date?: string;
}

export interface DealLine {
  id: string;
  itemId: string;
  qty: number | string;
  price: number | string;
  vat: number | string;
  schedule: string;
  start: string;
  months: number | string;
  milestones: Milestone[];
}

export type Champ = Record<'C' | 'H' | 'M' | 'P', number>;

export interface TaskState {
  done?: boolean;
  at?: string;
  by?: string;
  outcome?: string;
  note?: string;
}

/**
 * A task from the "New task" dialog: it belongs to a lead and a stage, has an owner and a due
 * date, shows in Today and on the lead's To-Do list, and does not block stage advance.
 */
export interface LeadTask {
  id: string;
  leadId: string;
  stageId: string;
  title: string;
  channel: ChannelCode;
  /** ISO date (yyyy-mm-dd), '' when none. */
  due: string;
  /** User id of the owner (a workspace member), '' when none. */
  ownerId: string;
  /** Last known name of the owner, from the API. */
  ownerName?: string;
  note: string;
  done: boolean;
  at?: string;
  by?: string;
}

/** A stage or outcome change from the stage history; `at` is epoch ms. */
export type StageChange = Pick<ApiStageChange, 'dealId' | 'kind' | 'fromStageId' | 'toStageId' | 'outcome'> & { at: number };

export interface LogEntry {
  date: string;
  channel: string;
  title: string;
  detail: string;
}

export interface RoadmapItem {
  id: string;
  title: string;
  status: string;
}

export interface TeamMember {
  /** user id for members, invitation id for pending invitations */
  id: string;
  name: string;
  email: string;
  role: 'Owner' | 'Admin' | 'Member';
  status: 'Active' | 'Invited';
}

export interface ToggleRow {
  id: string;
  name?: string;
  label?: string;
  desc: string;
  on: boolean;
}

export interface FieldDef {
  id: string;
  label: string;
  type: string;
  entity: 'Leads' | 'Contacts';
  required: boolean;
  system: boolean;
  visible: boolean;
}

/** Workspace settings, saved per tenant (see ApiWorkspace). */
export interface Workspace {
  name: string;
  /** ISO 4217 code, e.g. "EUR". */
  currency: string;
  /** IANA time zone. */
  timezone: string;
  /** Month the fiscal year starts, 1 = January. */
  fiscalMonth: number;
  /** Sales-bonus rules are still browser-only. */
  bonusTrigger?: string;
}

/** The signed-in user's profile (see ApiProfile). */
export interface Profile {
  name: string;
  title: string;
  /** From the sign-in provider; read-only here. */
  email: string;
  phone: string;
  language: ApiLanguage;
  dateFormat: ApiDateFormat;
  startPage: ApiStartPage;
  /** Backend funnel id; '' for none. Applies to this workspace only. */
  defaultFunnelId: string;
  /** Applies to this workspace only. */
  digest: boolean;
}

export interface BonusRule {
  rate: number | string;
  floor: number | string;
  fixed: number | string;
}

export interface Filters {
  audience: string;
  owner: string;
  dates: string;
  source: string;
  stage: string;
  industry: string;
  stalled: string;
  band: string;
  /** Pipeline board: lost deals are hidden unless this says otherwise (see LOST_VIEWS). */
  lost: string;
}

export interface Drill {
  kicker: string;
  title: string;
  leadIds: string[];
}

export interface NewContactDraft {
  name: string;
  role: string;
  email: string;
  phone: string;
  linkedin: string;
  buyerRole: string;
}

export interface NewFieldDraft {
  label: string;
  type: string;
  entity: 'Leads' | 'Contacts';
  required: boolean;
}

export interface NewProductDraft {
  name: string;
  type: string;
  kind: string;
  price: string;
  vat: string;
}

export interface State {
  funnels: Record<SegKey, Funnel>;
  segment: SegKey;
  leads: Lead[];
  extraCompanies: CompanyExtra[];
  extraPeople: Person[];
  links: Record<string, string[]>;
  catalog: CatalogItem[];
  dealLines: Record<string, DealLine[]>;
  champ: Record<string, Champ>;
  tasks: Record<string, TaskState>;
  extraTodos: Record<string, string[]>;
  /** Backend ids of the off-playbook to-dos, parallel to extraTodos. */
  extraTodoIds: Record<string, string[]>;
  /** Tasks from the "New task" dialog (see LeadTask). */
  leadTasks: LeadTask[];
  log: Record<string, LogEntry[]>;
  /** Stage history of every deal, oldest first; null until Overview loads it (see refreshHistory). */
  stageHistory: StageChange[] | null;
  roadmapItems: RoadmapItem[];
  team: TeamMember[];
  notifs: ToggleRow[];
  integrations: ToggleRow[];
  fields: FieldDef[];
  workspace: Workspace;
  profile: Profile;
  bonusRules: Record<string, BonusRule>;
  filters: Filters;
  toast: string;

  // modals
  genOpen: boolean;
  genLead: string | null;
  genStep: number;
  docOpen: boolean;
  docLeadId: string | null;
  showMerge: boolean;
  sent: boolean;
  newLeadOpen: boolean;
  newLeadType: SegKey;
  taskOpen: boolean;
  /** Deal the "New task" dialog opens on. */
  taskLeadId: string;
  contactOpen: boolean;
  contactCompany: string;
  newContact: NewContactDraft;
  personaOpen: boolean;
  personaBase: string;
  templateOpen: boolean;
  templateType: string;
  templateFile: string | null;
  fieldOpen: boolean;
  newField: NewFieldDraft;
  productOpen: boolean;
  newProduct: NewProductDraft;
  drill: Drill | null;
  /** Deal the "Mark as lost" dialog is open for. */
  lostLeadId: string | null;
}
