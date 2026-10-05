import type { ApiCustomerEmailLanguage, ApiCustomField, ApiDateFormat, ApiLanguage, ApiOnboarding, ApiStageChange, ApiStartPage, CustomFieldEntity, CustomFieldValues, DealOutcome, LostReason, ApiVisitScope } from '../lib/api';
import type { DealDoc, DocTemplate } from './documents';
import type { MeetingDialogSeed, MeetingList } from './meetings';
import type { ApiInternalMinutes, ApiMeeting } from '../lib/api';
import type { PeopleState } from './people';
import type { VisitPlan } from './visitPlans';

/** A funnel's backend id (CD-10: any number of funnels, not just the two personas). */
export type SegKey = string;
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
  /** Ids of the checklist items, parallel to `checklist` (CD-32): to-dos are matched by id. */
  checklistIds: string[];
  prob: number | '';
  /** The terminal "won" stage. */
  won?: boolean;
}

export interface Funnel {
  /** Backend funnel id (the key of State.funnels). */
  id: string;
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
  /** Notes on the primary contact (from the New contact dialog or the contact screen). */
  contactNotes?: string;
  /** The primary contact's LinkedIn (a URL or whatever was typed); '' when none. */
  contactLinkedin?: string;
  /** Owner of the primary contact (user id, and last known name from the API). */
  contactOwnerId?: string | null;
  contactOwner?: string;
  /** Last known name of the deal owner, from the API. Show it with ownerOf(), match by ownerId. */
  owner?: string;
  /** User id of the deal owner. */
  ownerId?: string | null;
  segment: SegKey;
  stage: string;
  value: string; // "€14,000"
  /** ISO 4217 code of the deal amount; the workspace currency when unset. */
  currency?: string;
  /** How the deal's prices treat tax, its discounts and installments (CD-83). */
  taxMode: TaxMode;
  discounts: DealDiscount[];
  installments: Installment[];
  /** ISO date-time the deal entered its current stage. */
  stageSince?: string;
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
  notes?: string;
  initials: string;
  /** Owner of the contact (user id); ownerName is their last known name, from the API. */
  ownerId?: string | null;
  ownerName?: string;
}

export interface CompanyExtra {
  id?: string;
  name: string;
  industry: string;
  hq: string;
  size: string;
  source: string;
  /** Website domain, e.g. "acme.com" (CD-209); '' when none. */
  domain: string;
  notes: string;
  /** Last known name of the owner, from the API (see memberName). */
  owner: string;
  ownerId?: string | null;
}

/** How often a product is billed (CD-83). */
export type BillingFrequency = 'one_time' | 'weekly' | 'monthly' | 'quarterly' | 'annually';
/** Whether the prices of a deal exclude tax, include it, or have none. */
export type TaxMode = 'exclusive' | 'inclusive' | 'none';
export type DiscountKind = 'percent' | 'amount';

/** A product or service of the catalog (CD-83). Products have no currency: the deal has one. */
export interface CatalogItem {
  id: string;
  name: string;
  description: string;
  /** What one unit is ("hour", "seat"); '' when not set. */
  unit: string;
  /** Unit price. */
  price: number;
  /** Default quantity; the product's price is unit price × quantity. */
  qty: number;
  vat: number;
  frequency: BillingFrequency;
  /** Recurring only: how many times it is billed; null renews until canceled. */
  cycles: number | null;
}

/** A product on a deal. Numbers stay as typed while the products dialog edits them. */
export interface DealLine {
  id: string;
  itemId: string;
  description: string;
  qty: number | string;
  price: number | string;
  discountKind: DiscountKind;
  discount: number | string;
  vat: number | string;
  frequency: BillingFrequency;
  cycles: number | null;
  /** Billing start date (ISO), '' when not set. */
  start: string;
}

/** A discount on the whole deal: it lowers the one-time products only. */
export interface DealDiscount {
  id: string;
  label: string;
  kind: DiscountKind;
  value: number | string;
}

/** A dated part payment of the one-time products of a deal. */
export interface Installment {
  id: string;
  description: string;
  /** ISO date, '' when not set. */
  date: string;
  amount: number | string;
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

export interface TeamMember {
  /** user id for members, invitation id for pending invitations */
  id: string;
  name: string;
  email: string;
  role: 'Owner' | 'Admin' | 'Member';
  status: 'Active' | 'Invited';
  /** Pending invitations only: where their email is (CD-7). */
  invite?: { emailStatus: 'queued' | 'sent' | 'failed' | null; emailSentAt: string | null; emailError: string | null; hasLink: boolean };
}

/** A custom field of deals, companies or contacts (CD-15), as the API returns it. */
export type CustomFieldDef = Omit<ApiCustomField, 'position'>;

/** Workspace settings, saved per tenant (see ApiWorkspace). */
export interface Workspace {
  name: string;
  /** ISO 4217 code, e.g. "EUR". */
  currency: string;
  /** IANA time zone. */
  timezone: string;
  /** Month the fiscal year starts, 1 = January. */
  fiscalMonth: number;
  /** Language of the fixed text in emails to customers (CD-208). */
  customerEmailLanguage: ApiCustomerEmailLanguage;
  /** Settings → Employees (CD-215): weekly hours new employees start with, 1–60. */
  employeeDefaultWeeklyHours: number;
  employeeNumberRequired: boolean;
  /** Employees change their own bank account. */
  employeeSelfEditBank: boolean;
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
  /** Notification settings (Settings → Notifications, CD-16). Apply to this workspace only. */
  digest: boolean;
  dealAssigned: boolean;
  meetingInvites: boolean;
  visitPlans: boolean;
  /** "New manager" / "New direct report" emails (milestone 13). */
  orgChanges: boolean;
}

export interface BonusRule {
  rate: number | string;
  floor: number | string;
  fixed: number | string;
}

export interface Filters {
  /** Overview audience: a funnel id, or 'Audience' for every funnel. */
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
  notes: string;
}

export interface NewFieldDraft {
  label: string;
  type: ApiCustomField['type'];
  entity: CustomFieldEntity;
  required: boolean;
  /** Single-select options, one per line. */
  options: string;
}

export interface State {
  /** Every funnel by id, in the workspace's order. */
  funnels: Record<SegKey, Funnel>;
  /** The funnel open on the Pipeline and in the funnel builder. */
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
  /**
   * The version (updatedAt) of each deal, company and contact the screen shows, keyed
   * "deal:<id>" etc. Edits send it as If-Match, so the API can say when someone else changed the
   * same field meanwhile (CD-20). Updated when the workspace is (re)loaded.
   */
  versions: Record<string, string>;
  /** When a live update last touched a record (by id), so open views (history) re-read it. */
  changedAt: Record<string, number>;
  /** Stage history of every deal, oldest first; null until Overview loads it (see refreshHistory). */
  stageHistory: StageChange[] | null;
  team: TeamMember[];
  /** Custom field definitions (CD-15), in their order. */
  customFields: CustomFieldDef[];
  /** Custom field values by record type and record id (deal, company or contact id). */
  customValues: Record<CustomFieldEntity, Record<string, CustomFieldValues>>;
  workspace: Workspace;
  profile: Profile;
  /** Getting started (CD-68), for owners and admins; null for members. */
  onboarding: ApiOnboarding | null;
  /** Customer visit plans (CD-134) this user may see (members: their own), newest period first. */
  visitPlans: VisitPlan[];
  /** Whose visit plans this user sees and manages (CD-142): Admins all, managers their reports'. */
  visitScope: ApiVisitScope;
  /**
   * Sales bonus rules by user id (CD-17), saved in the workspace. null for members: the API
   * doesn't show them the rules, and the UI hides the bonus tab and the Overview card.
   */
  bonusRules: Record<string, BonusRule> | null;
  /** When a bonus counts as earned ("On contract signed" or "When fully billed"). */
  bonusTrigger: string;
  filters: Filters;
  toast: string;
  /** Document templates (CD-13); null until loaded (see loadTemplates). */
  templates: DocTemplate[] | null;
  /** Generated documents per deal id, loaded when a deal opens (see ensureDocs). */
  dealDocs: Record<string, DealDoc[]>;

  // modals
  genOpen: boolean;
  genLead: string | null;
  /** The document the generation dialog follows (CD-13); null until it is generated. */
  genDocId: string | null;
  docOpen: boolean;
  docLeadId: string | null;
  showMerge: boolean;
  sent: boolean;
  newLeadOpen: boolean;
  newLeadType: SegKey;
  /** Company and contact the New deal dialog starts with (from a company or contact page, CD-80). */
  newLeadCompanyId: string | null;
  newLeadContactId: string | null;
  /**
   * The New deal dialog was opened from the meeting form (CD-213: a meeting needs a deal): it keeps
   * the company, and creating stays on the meeting, which picks the new deal from `newLeadMade`.
   */
  newLeadForMeeting: boolean;
  newLeadMade: { companyId: string; dealId: string } | null;
  /** The command palette (Ctrl/⌘ K, CD-80). */
  paletteOpen: boolean;
  taskOpen: boolean;
  /** Deal the "New task" dialog opens on. */
  taskLeadId: string;
  /** Task the dialog edits (CD-27); null when it adds a new one. */
  taskEditId: string | null;
  contactOpen: boolean;
  contactCompany: string;
  /** Company the New contact dialog adds to without linking a deal (a company page with no deals, CD-80). */
  contactCompanyId: string | null;
  newContact: NewContactDraft;
  personaOpen: boolean;
  /** Funnel id the "New funnel" dialog copies, or 'blank'. */
  personaBase: string;
  templateOpen: boolean;
  templateType: string;
  fieldOpen: boolean;
  newField: NewFieldDraft;
  /** The product dialog (CD-83): open, and the product it edits (null for a new one). */
  productOpen: boolean;
  productEditId: string | null;
  /** Deal the "Products" dialog is open for. */
  dealProductsId: string | null;
  drill: Drill | null;
  /** Deal the "Mark as lost" dialog is open for. */
  lostLeadId: string | null;

  /** Meetings read so far, by id (CD-130; see store/meetings.ts). */
  meetings: Record<string, ApiMeeting>;
  /** Results of the meeting queries on screen, by query key. */
  meetingLists: Record<string, MeetingList>;
  /** Internal minutes read so far, by meeting id (CD-132). */
  meetingMinutes: Record<string, ApiInternalMinutes>;
  /** The New / Edit meeting dialog; null when closed. */
  meetingDialog: MeetingDialogSeed | null;
  /**
   * Goes up on every meeting or visit plan change (live hints, this tab's own included): visit
   * plan progress on screen (CD-135) is counted again (store/useVisitProgress.ts).
   */
  visitRev: number;
  /**
   * Goes up on every employee, department or team change (live hints, this tab's own included):
   * the org structure on screen is read again (store/org.ts, CD-138).
   */
  orgRev: number;
  /** Employees, departments and teams (milestone 13; see store/people.ts), read when a screen needs them. */
  people: PeopleState;
  /** Goes up on every employee and role change (live hints, resync): people lists re-read (CD-142). */
  peopleRev: number;
}
