/**
 * Typed fetch wrapper for the backend. Same-origin: the browser calls /api/... and the Vite dev
 * server (locally) or nginx (production) forwards to the API container.
 *
 * Every tenant-scoped call carries the X-Tenant-Id header; the backend checks membership and
 * PostgreSQL row-level security enforces the isolation.
 */
import { getAccessToken, renewSession, type SignedIn } from './auth';
import { canSignInAgain, sessionEnded, whenSignedInAgain } from './session';

const TENANT_KEY = 'crm.tenantId';

export const getTenantId = () => localStorage.getItem(TENANT_KEY);
export const setTenantId = (id: string) => localStorage.setItem(TENANT_KEY, id);
export const clearTenantId = () => localStorage.removeItem(TENANT_KEY);

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(typeof body === 'object' && body && 'message' in body ? String((body as { message: unknown }).message) : `HTTP ${status}`);
  }
}

/**
 * This browser tab (CD-20). The API records it with every change, so the live-update stream can
 * tell a tab which changes are its own echo, and a tab's own quick edits never conflict.
 */
export const CLIENT_ID = crypto.randomUUID();

/** The headers every API call carries: the token, the workspace and this tab. */
export async function apiHeaders(init?: HeadersInit): Promise<Headers> {
  const headers = new Headers(init);
  const token = await getAccessToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const tenant = getTenantId();
  if (tenant) headers.set('X-Tenant-Id', tenant);
  headers.set('X-Client-Id', CLIENT_ID);
  return headers;
}

/** `If-Match` with the version (updatedAt) an edit was based on; none means last-write-wins. */
const ifMatch = (version?: string): HeadersInit | undefined => (version ? { 'If-Match': `"${version}"` } : undefined);

/**
 * fetch(`/api${path}`) with this tab's headers and a session that doesn't end mid-work (CD-88).
 * On 401 it renews the token once and sends the request again. If that fails too while the app is
 * open, the session has ended: the "sign in again" dialog opens, and the request waits for it and
 * then goes out again, so an edit is saved late instead of thrown away. Before the app is open
 * (start-up) the 401 response is returned to the caller.
 */
export async function authorizedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const send = async () => fetch(`/api${path}`, { ...init, headers: await apiHeaders(init.headers) });
  for (;;) {
    await whenSignedInAgain();
    let res = await send();
    if (res.status !== 401) return res;
    if (await renewSession()) {
      res = await send();
      if (res.status !== 401) return res;
    }
    if (!canSignInAgain()) return res;
    sessionEnded();
  }
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.json !== undefined) headers.set('Content-Type', 'application/json');

  const res = await authorizedFetch(path, { ...init, headers, body: init.json !== undefined ? JSON.stringify(init.json) : init.body });
  const body: unknown = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}

/** A call made before signing in (creating an account, CD-114): no token, no workspace. */
async function publicApi<T>(path: string, json?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, json === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(json) });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}

/** Ways to create an account here: email (a confirmation link), and the provider's Google connection. */
export interface SignupOptions {
  email: boolean;
  google: string | null;
}
/** Why a confirmation link doesn't work (410), or that its address has an account already (409). */
export type SignupProblem = { code: 'invalid' | 'expired' | 'used' | 'exists'; message: string; email?: string };

export const signupApi = {
  options: () => publicApi<SignupOptions>('/auth/signup/options'),
  start: (email: string) => publicApi<{ sent: true }>('/auth/signup', { email }),
  check: (token: string) => publicApi<{ email: string }>('/auth/signup/check', { token }),
  /** Creates the account and signs in: the access token is there unless signing in failed. */
  complete: (token: string, password: string) => publicApi<LinkDone>('/auth/signup/complete', { token, password }),
};

/** An emailed link used up: the account's email, and the session when signing in worked. */
export type LinkDone = { email: string } & Partial<SignedIn>;

/** "Forgot password?" (CD-114): the same shape as creating an account, and the same problems (410). */
export const passwordApi = {
  forgot: (email: string) => publicApi<{ sent: true }>('/auth/password/forgot', { email }),
  check: (token: string) => publicApi<{ email: string }>('/auth/password/check', { token }),
  reset: (token: string, password: string) => publicApi<LinkDone>('/auth/password/reset', { token, password }),
};

/** `path` limited to some rows (`?ids=` or `?dealIds=`, at most 200; CD-98), or the whole list. */
const only = (path: string, param: 'ids' | 'dealIds', ids?: readonly string[]) => (ids ? `${path}?${param}=${ids.join(',')}` : path);

/** Fetches every page of a list endpoint (the API caps a page at 200 rows). */
async function all<T>(path: string): Promise<T[]> {
  const out: T[] = [];
  const sep = path.includes('?') ? '&' : '?';
  for (let offset = 0; ; offset += 200) {
    const page = await api<T[]>(`${path}${sep}limit=200&offset=${offset}`);
    out.push(...page);
    if (page.length < 200) return out;
  }
}

// Shapes returned by the backend (see backend/src/shared/database/schema).
export type Channel = 'RS' | 'EM' | 'LI' | 'WA' | 'MT' | 'PH' | 'NT';
export type ApiRole = 'owner' | 'admin' | 'member';

export interface ApiFunnelStage {
  id: string;
  key: string;
  name: string;
  position: number;
  activity: string;
  channel: Channel;
  documentOnEntry: string | null;
  winProbability: number;
  /** Stage to-dos with stable ids (CD-32): renaming one keeps the deals' progress on it. */
  checklistItems: ApiChecklistItem[];
  isWon: boolean;
}
export interface ApiChecklistItem {
  id: string;
  label: string;
}
export interface ApiFunnel {
  id: string;
  key: string;
  label: string;
  note: string | null;
  stages: ApiFunnelStage[];
}
export interface ApiTenant {
  id: string;
  name: string;
  slug: string;
  role: ApiRole;
  /** In GET /me's list (the sidebar switcher, CD-214). */
  memberCount?: number;
}
export interface ApiMe {
  user: { id: string; email: string | null; displayName: string | null };
  tenants: ApiTenant[];
  onboarding: ApiUserOnboarding;
}
/** An invitation waiting for the signed-in user's email address (CD-115). */
export interface ApiPendingInvitation {
  id: string;
  tenantName: string;
  role: 'admin' | 'member';
  invitedBy: string | null;
  expiresAt: string;
}
/**
 * Onboarding after the first sign-up (CD-115): create or join a workspace, then "About you", then
 * (owners, skippable) "Invite your team". `required` is false once it is done, or for users who had
 * a workspace before it existed.
 */
export type ApiUserOnboardingStep = 'workspace' | 'profile' | 'team';
export interface ApiUserOnboarding {
  required: boolean;
  completedAt: string | null;
  steps: { key: ApiUserOnboardingStep; done: boolean; skippable: boolean }[];
  invitations: ApiPendingInvitation[];
}
/** Settings of the current workspace (GET/PATCH /workspace; owners and admins change them). */
export interface ApiWorkspace {
  id: string;
  name: string;
  slug: string;
  /** ISO 4217 code, e.g. "EUR". */
  currency: string;
  /** IANA time zone, e.g. "Europe/Belgrade". */
  timezone: string;
  /** 1 = January. */
  fiscalYearStartMonth: number;
  /** Language of the fixed text in emails to customers, e.g. meeting minutes (CD-208). */
  customerEmailLanguage: ApiCustomerEmailLanguage;
  /** Settings → Employees (CD-215): prefills new employees and imports, 1–60. */
  employeeDefaultWeeklyHours: number;
  /** Create, edit and import require an employee number. */
  employeeNumberRequired: boolean;
  /** Employees change their own bank account (else only Administration and Admins). */
  employeeSelfEditBank: boolean;
}
export type ApiCustomerEmailLanguage = 'en' | 'sr';
export type WorkspaceInput = Partial<
  Pick<ApiWorkspace, 'name' | 'currency' | 'timezone' | 'fiscalYearStartMonth' | 'customerEmailLanguage' | 'employeeDefaultWeeklyHours' | 'employeeNumberRequired' | 'employeeSelfEditBank'>
>;
export type ApiLanguage = 'en' | 'sr' | 'de';
export type ApiDateFormat = 'DD.MM.YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD';
export type ApiStartPage = 'pipeline' | 'overview' | 'today' | 'contacts';
/** The signed-in user's profile (GET/PATCH /profile). The last three apply to the current workspace only. */
export interface ApiProfile {
  userId: string;
  email: string | null;
  displayName: string | null;
  jobTitle: string | null;
  phone: string | null;
  language: ApiLanguage;
  dateFormat: ApiDateFormat;
  startPage: ApiStartPage;
  defaultFunnelId: string | null;
  dailyDigest: boolean;
  /** Email me when someone else makes me the owner of a deal (CD-16). */
  notifyDealAssigned: boolean;
  /** Email me (with an .ics) when someone else adds me to a meeting, or changes or cancels it (CD-207). */
  notifyMeetingInvites: boolean;
  /** Email me when someone else creates or changes my visit plan (CD-207). */
  notifyVisitPlans: boolean;
  /** Email me "New manager" / "New direct report" when someone changes reporting lines (milestone 13). */
  notifyOrgChanges: boolean;
}
/**
 * Getting started (CD-68): the workspace's activation steps (CD-115), derived from its records.
 * `records` lists which of the first contact, company, product and deal are there.
 */
export type ApiOnboardingStep = 'invite' | 'records' | 'template' | 'funnel';
export type ApiSampleKind = 'company' | 'contact' | 'product' | 'deal';
export interface ApiOnboarding {
  steps: { key: ApiOnboardingStep; done: boolean; items?: { key: ApiSampleKind; done: boolean }[] }[];
  complete: boolean;
  dismissed: boolean;
  sampleData: { loaded: boolean; counts: Record<ApiSampleKind, number> };
}
export interface ApiSampleRemoval {
  removed: Record<ApiSampleKind, number>;
  /** Sample records kept because real records use them (they become ordinary records). */
  kept: Record<ApiSampleKind, number>;
  state: ApiOnboarding;
}
export type ProfileInput = Partial<Omit<ApiProfile, 'userId' | 'email'>>;
export interface ApiCompany {
  id: string;
  name: string;
  industry: string | null;
  hq: string | null;
  teamSize: string | null;
  source: string | null;
  domain: string | null;
  ownerUserId: string | null;
  notes: string | null;
  /** Custom field values by field id (CD-15). */
  customFields: CustomFieldValues;
  /** Current name of the owner, also after they left the workspace (lists only). */
  ownerName?: string | null;
  /** The version: send it back as If-Match when changing the company (CD-20). */
  updatedAt: string;
}
export interface ApiContact {
  id: string;
  companyId: string | null;
  fullName: string;
  jobTitle: string | null;
  email: string | null;
  phone: string | null;
  linkedin: string | null;
  buyerRole: string;
  ownerUserId: string | null;
  /** Custom field values by field id (CD-15). */
  customFields: CustomFieldValues;
  notes: string | null;
  /** Current name of the owner, also after they left the workspace (lists only). */
  ownerName?: string | null;
  /** The version: send it back as If-Match when changing the contact (CD-20). */
  updatedAt: string;
}
export interface ApiChamp {
  C: number;
  H: number;
  M: number;
  P: number;
}
/** Why a deal was lost (the backend's fixed pick list). */
export const LOST_REASONS = ['Price', 'Timing', 'Chose a competitor', 'No budget', 'No decision', 'Other'] as const;
export type LostReason = (typeof LOST_REASONS)[number];
/** Lost is stored on the deal; won means the deal is in its funnel's won stage. */
export type DealOutcome = 'open' | 'won' | 'lost';
export interface ApiDeal {
  id: string;
  companyId: string | null;
  primaryContactId: string | null;
  funnelId: string;
  stageId: string;
  ownerUserId: string | null;
  title: string;
  source: string | null;
  amount: string;
  currency: string;
  /** How the prices of its products treat tax, its discounts and installments (CD-83). */
  taxMode: ApiTaxMode;
  discounts: ApiDealDiscount[];
  installments: ApiInstallment[];
  closeDate: string | null;
  fitScore: number;
  champ: ApiChamp | null;
  /** Discovery notes, merged into the proposal. */
  headline: string | null;
  need: string | null;
  constraint: string | null;
  decisionMaker: string | null;
  discoveryDate: string | null;
  lastContactAt: string | null;
  stageEnteredAt: string;
  outcome: DealOutcome;
  lostAt: string | null;
  lostReason: LostReason | null;
  lostNote: string | null;
  /** Custom field values by field id (CD-15). */
  customFields: CustomFieldValues;
  createdAt: string;
  updatedAt: string;
}
/** One stage or outcome change of a deal (GET /crm/deal-stage-history, oldest first). */
export interface ApiStageChange {
  id: string;
  dealId: string;
  kind: 'created' | 'moved' | 'funnel_changed' | 'lost' | 'reopened';
  /** null when the deal was created. */
  fromStageId: string | null;
  toStageId: string;
  /** The deal's outcome after the change. */
  outcome: DealOutcome;
  changedAt: string;
  changedByUserId: string | null;
}
export interface ApiDealRow {
  deal: ApiDeal;
  contactIds: string[];
  /** Current name of the owner, also after they left the workspace. */
  ownerName?: string | null;
}
export interface ApiActivity {
  id: string;
  dealId: string;
  channel: Channel;
  title: string;
  detail: string | null;
  occurredAt: string;
}
export type ApiBillingFrequency = 'one_time' | 'weekly' | 'monthly' | 'quarterly' | 'annually';
export type ApiTaxMode = 'exclusive' | 'inclusive' | 'none';
export type ApiDiscountKind = 'percent' | 'amount';
/** A product of the catalog (CD-83): no currency, deals have one. */
export interface ApiProduct {
  id: string;
  name: string;
  description: string | null;
  unit: string | null;
  unitPrice: string;
  /** Default quantity: the product's price is unit price × quantity. */
  quantity: string;
  vatRate: string;
  billingFrequency: ApiBillingFrequency;
  /** Recurring only; null renews until canceled. */
  billingCycles: number | null;
}
export interface ApiDealDiscount {
  id: string;
  label: string;
  kind: ApiDiscountKind;
  value: number;
}
export interface ApiInstallment {
  id: string;
  description: string;
  date: string | null;
  amount: number;
}

/** A value of a custom field: text, URL, ISO date and option id are strings (CD-15). */
export type CustomValue = string | number | boolean;
export type CustomFieldValues = Record<string, CustomValue>;
export type CustomFieldEntity = 'deal' | 'company' | 'contact';
export type CustomFieldType = 'text' | 'number' | 'date' | 'select' | 'checkbox' | 'url';
export interface ApiCustomField {
  id: string;
  entity: CustomFieldEntity;
  label: string;
  type: CustomFieldType;
  /** Single-select options; values store the option id. */
  options: { id: string; label: string }[];
  required: boolean;
  position: number;
}
/** Sales bonus rules (CD-17): owners and admins only; members get 403. Amounts in the workspace currency. */
export interface ApiBonusRules {
  trigger: string;
  rules: { userId: string; rate: string; floor: string; fixed: string }[];
}

export interface ApiDealLine {
  id: string;
  dealId: string;
  productId: string | null;
  position: number;
  description: string | null;
  quantity: string;
  unitPrice: string;
  discountKind: ApiDiscountKind;
  discountValue: string;
  vatRate: string;
  billingFrequency: ApiBillingFrequency;
  billingCycles: number | null;
  /** Billing start date. */
  startDate: string | null;
}
export interface ApiDealTask {
  id: string;
  dealId: string;
  stageId: string;
  label: string;
  /** The checklist item of a playbook to-do (CD-32). */
  checklistItemId: string | null;
  offPlaybook: boolean;
  position: number;
  done: boolean;
  doneAt: string | null;
  doneByName: string | null;
  outcome: string | null;
  note: string | null;
  /** false for tasks from the "New task" dialog (they don't gate stage advance). */
  blocksAdvance: boolean;
  dueDate: string | null;
  assigneeUserId: string | null;
  channel: Channel | null;
  /** Current name of the assignee, also after they left the workspace (lists only). */
  assigneeName?: string | null;
}

export interface ApiMember {
  userId: string;
  email: string | null;
  displayName: string | null;
  role: ApiRole;
  joinedAt: string;
  /** Their employee record (milestone 13): Settings → Team links to the card. */
  employeeId: string | null;
}
export interface ApiInvitation {
  id: string;
  email: string;
  role: 'admin' | 'member';
  expiresAt: string;
  createdAt: string;
  /** The invitation email (CD-7): queued (sending or retrying), sent, failed after retries; null for old invitations. */
  emailStatus: 'queued' | 'sent' | 'failed' | null;
  emailSentAt: string | null;
  emailError: string | null;
  /** False for invitations from before CD-7: their link can't be resent or copied. */
  hasLink: boolean;
}
export interface ApiInvitePreview {
  tenantName: string;
  email: string;
  role: 'admin' | 'member';
  invitedBy: string | null;
  expiresAt: string;
}

/** One change of a deal, company or contact (CD-69), newest first from GET /crm/history. */
export interface ApiHistoryEntry {
  id: string;
  /** participant_*: a meeting's participant (CD-130); `label` is the name, the value `{ kind, userId, contactId, name }`. */
  action: 'created' | 'updated' | 'deleted' | 'line_added' | 'line_changed' | 'line_removed' | 'participant_added' | 'participant_removed';
  /** The API's field name (title, ownerUserId, stageId, …); "line" for deal lines. */
  field: string | null;
  oldValue: unknown;
  newValue: unknown;
  /** Names for ids (stage, funnel, company, contact, owner). */
  oldLabel: string | null;
  newLabel: string | null;
  /** The record's name (created, deleted) or a line's product. */
  label: string | null;
  /** null: the system. A member who left is "Former member" (userId null). */
  actor: { userId: string | null; name: string } | null;
  changedAt: string;
}
export type HistoryEntity = 'deal' | 'company' | 'contact' | 'meeting' | 'visit_plan';

/**
 * Customer visit plans (CD-134): per salesperson and month, the visits planned per company. Plans
 * are monthly (CD-212); 'quarter' is only on plans saved before, and in tracking, where a quarter
 * adds up its three monthly plans.
 */
export type VisitPlanPeriodType = 'month' | 'quarter';
export interface ApiVisitPlanLine {
  id: string;
  companyId: string;
  companyName: string;
  plannedVisits: number;
}
export interface ApiVisitPlan {
  id: string;
  salespersonUserId: string;
  salespersonName: string;
  periodType: VisitPlanPeriodType;
  /** First day of the period (YYYY-MM-DD); periodEnd is the first day after it. */
  periodStart: string;
  periodEnd: string;
  /** "October 2026", "Q4 2026", "Q1 FY2027 (Oct–Dec 2026)". */
  periodLabel: string;
  note: string | null;
  lines: ApiVisitPlanLine[];
  totalPlanned: number;
  /** The caller may change and delete it (Admins: every plan; managers: their direct reports', CD-142). */
  canEdit: boolean;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}
/** Whose visit plans the caller sees and manages (CD-142); null lists mean everyone. */
export interface ApiVisitScope {
  all: boolean;
  manageAll: boolean;
  /** Sees others' plans (Admins, managers): Reports and the team summary. */
  seesTeam: boolean;
  visibleUserIds: string[] | null;
  manageableUserIds: string[] | null;
}
export interface VisitPlanInput {
  salespersonUserId: string;
  /** Always 'month' (the API refuses 'quarter', CD-212). */
  periodType: 'month';
  periodStart: string;
  note?: string | null;
  lines: { companyId: string; plannedVisits: number }[];
}
/**
 * Visit plan tracking (CD-135): planned vs. held Customer visits, all counted by the backend's one
 * counting function (visit-counting.ts). `pace`: done at 100%, behind below the share of the
 * period passed (`expectedPace`), notStarted before the period, onTrack otherwise.
 */
export type VisitPace = 'done' | 'behind' | 'notStarted' | 'onTrack';
export interface ApiVisitTotals {
  planned: number;
  /** Held visits counted toward completion: at most the planned number per customer. */
  heldCapped: number;
  /** Held visits at the plan's customers, uncapped. */
  held: number;
  upcoming: number;
  notClosed: number;
  /** Held visits at customers outside the plan. */
  unplanned: number;
  overPlan: number;
  /** 0..1 */
  completion: number;
  /** 0..1, the share of the period that has passed. */
  expectedPace: number;
  pace: VisitPace;
}
export interface ApiVisitLineProgress {
  companyId: string;
  companyName: string;
  planned: number;
  held: number;
  heldCapped: number;
  upcoming: number;
  notClosed: number;
  overPlan: number;
  completion: number;
  heldMeetingIds: string[];
  upcomingMeetingIds: string[];
  notClosedMeetingIds: string[];
}
export interface ApiVisitPlanProgress {
  planId: string;
  salespersonUserId: string;
  periodType: VisitPlanPeriodType;
  periodStart: string;
  periodEnd: string;
  periodLabel: string;
  lines: ApiVisitLineProgress[];
  unplanned: { companyId: string; companyName: string; held: number; meetingIds: string[] }[];
  totals: ApiVisitTotals;
  meetings: Record<string, { id: string; title: string; startsAt: string; endsAt: string; status: MeetingStatus; companyName: string }>;
}
/** The meetings behind a report row's numbers (CD-211), for the Calendar's `ids=` link. */
export interface ApiVisitRowMeetings {
  held: string[];
  upcoming: string[];
  notClosed: string[];
  unplanned: string[];
}
export interface ApiVisitRowTotals extends ApiVisitTotals {
  meetingIds: ApiVisitRowMeetings;
}
export interface ApiVisitReportRow extends ApiVisitRowTotals {
  salespersonUserId: string;
  salespersonName: string;
  /** null: no plan for the period, only unplanned visits. For a quarter: its first monthly plan. */
  planId: string | null;
  /** The monthly plans counted: one for a month, up to three for a quarter (CD-212). */
  plans: { id: string; periodStart: string; periodLabel: string }[];
}
interface ApiVisitPeriod {
  periodType: VisitPlanPeriodType;
  periodStart: string;
  periodEnd: string;
  periodLabel: string;
}
export interface ApiVisitReport extends ApiVisitPeriod {
  companyId: string | null;
  rows: ApiVisitReportRow[];
  totals: ApiVisitRowTotals;
}
export interface ApiVisitSummary extends ApiVisitPeriod, ApiVisitRowTotals {
  salespersonUserId: string | null;
  /** The monthly plans counted (a quarter's three months, CD-212). */
  plans: { id: string; salespersonUserId: string; salespersonName: string; periodStart: string; periodLabel: string }[];
}
export interface VisitPeriodQuery {
  periodType: VisitPlanPeriodType;
  periodStart?: string;
  salespersonUserId?: string;
  companyId?: string;
  all?: boolean;
}
const visitQuery = (q: VisitPeriodQuery) => {
  const p = new URLSearchParams({ periodType: q.periodType });
  if (q.periodStart) p.set('periodStart', q.periodStart);
  if (q.salespersonUserId) p.set('salespersonUserId', q.salespersonUserId);
  if (q.companyId) p.set('companyId', q.companyId);
  if (q.all) p.set('all', '1');
  return '?' + p.toString();
};

/** The body of a 409 from an update with If-Match: someone changed these fields meanwhile. */
export interface ApiConflict {
  message: string;
  conflicts: { field: string; value: unknown; label: string | null; changedBy: string | null; changedAt: string }[];
}

/** Custom field values to write: null or '' clears a field. */
export type CustomFieldPatch = Record<string, CustomValue | null>;
export type CompanyInput = Partial<Omit<ApiCompany, 'id' | 'customFields' | 'updatedAt'>> & { name?: string; customFields?: CustomFieldPatch };
export type ContactInput = Partial<Omit<ApiContact, 'id' | 'ownerName' | 'customFields' | 'updatedAt'>> & { customFields?: CustomFieldPatch };
export type DealInput = Partial<
  Pick<ApiDeal, 'title' | 'companyId' | 'primaryContactId' | 'funnelId' | 'ownerUserId' | 'source' | 'closeDate' | 'amount' | 'currency' | 'headline' | 'need' | 'constraint' | 'decisionMaker' | 'discoveryDate'>
> & { champ?: ApiChamp; customFields?: CustomFieldPatch };
export type ProductInput = Partial<{
  name: string;
  description: string | null;
  unit: string | null;
  unitPrice: number;
  quantity: number;
  vatRate: number;
  billingFrequency: ApiBillingFrequency;
  billingCycles: number | null;
}>;
/** Everything the deal's "Products" dialog saves at once (PUT /crm/deals/:id/products). */
export interface DealProductsInput {
  currency?: string;
  taxMode: ApiTaxMode;
  lines: {
    id?: string;
    productId: string;
    description: string | null;
    startDate: string | null;
    quantity: number;
    unitPrice: number;
    discountKind: ApiDiscountKind;
    discountValue: number;
    vatRate: number;
    billingFrequency: ApiBillingFrequency;
    billingCycles: number | null;
  }[];
  discounts: { id?: string; label: string; kind: ApiDiscountKind; value: number }[];
  installments: { id?: string; description: string; date: string | null; amount: number }[];
}
export type TaskInput = Partial<{
  label: string;
  done: boolean;
  outcome: string | null;
  note: string | null;
  dueDate: string | null;
  assigneeUserId: string | null;
  channel: Channel | null;
}>;
export type StageInput = Partial<Pick<ApiFunnelStage, 'name' | 'activity' | 'channel' | 'documentOnEntry' | 'winProbability' | 'checklistItems'>>;

// ---------------------------------------------------------------- meetings (CD-130)
/** visit = Customer visit (the only type that counts toward visit plans); office = at our office. */
export type MeetingType = 'visit' | 'online' | 'office' | 'phone';
export type MeetingStatus = 'planned' | 'held' | 'cancelled';
export interface ApiMeetingParticipant {
  id: string;
  kind: 'internal' | 'external';
  userId: string | null;
  contactId: string | null;
  /** The person's name when they were added (kept for "(deleted)"). */
  name: string;
  email: string | null;
  /** An external contact that was deleted, or a member no longer in the workspace. */
  deleted: boolean;
}
export interface ApiMeeting {
  id: string;
  title: string;
  type: MeetingType;
  /** ISO instants. */
  startsAt: string;
  endsAt: string;
  location: string | null;
  agenda: string | null;
  companyId: string;
  companyName: string;
  /** Every meeting has a deal (CD-213); null only on meetings saved without one before that ("No deal"). */
  dealId: string | null;
  dealTitle: string | null;
  dealOwnerUserId: string | null;
  /** null: the organizer left the workspace ("Organizer left"). */
  organizerUserId: string | null;
  organizerName: string | null;
  status: MeetingStatus;
  cancelReason: string | null;
  heldAt: string | null;
  cancelledAt: string | null;
  /** Planned and ended more than 24 hours ago. */
  notClosed: boolean;
  participants: ApiMeetingParticipant[];
  /** Recorded once the internal minutes have a summary (CD-132). */
  internalMinutes: 'missing' | 'recorded';
  /** The minutes' version, null before anyone wrote them: an open minutes tab reads them again when it changes. */
  minutesUpdatedAt: string | null;
  /** The external minutes' latest send (CD-133). */
  externalDelivery: 'not_sent' | 'queued' | 'sent' | 'failed';
  /** Moves whenever a send's delivery changes: an open send log reads again. */
  sendsUpdatedAt: string | null;
  createdByUserId: string | null;
  createdAt: string;
  /** The version: send it back as If-Match when changing the meeting. */
  updatedAt: string;
}
export interface MeetingInput {
  title?: string;
  type?: MeetingType;
  startsAt?: string;
  endsAt?: string;
  location?: string | null;
  agenda?: string | null;
  companyId?: string;
  /** Required on create, and a change can't clear it (CD-213). */
  dealId?: string;
  organizerUserId?: string;
  /** Replace the sets (the organizer is always kept). */
  internalUserIds?: string[];
  externalContactIds?: string[];
}
/** A next step of the internal minutes (CD-132); `taskId` is the deal task made from it. */
export interface ApiMeetingNextStep {
  id: string;
  text: string;
  ownerUserId: string | null;
  /** yyyy-mm-dd */
  dueDate: string | null;
  taskId: string | null;
}
/** The internal minutes of a meeting (CD-132): empty strings and no steps before anyone wrote them. */
export interface ApiInternalMinutes {
  summary: string;
  agreements: string;
  nextSteps: ApiMeetingNextStep[];
  /** The version (If-Match); null before the first save. */
  updatedAt: string | null;
  updatedByName: string | null;
}
/** The parts sent replace the stored ones; the steps' task links stay as the server has them. */
export interface InternalMinutesInput {
  summary?: string;
  agreements?: string;
  nextSteps?: Omit<ApiMeetingNextStep, 'taskId'>[];
}
export type MinutesDeliveryStatus = 'queued' | 'sent' | 'failed';
/** One person a send of the external minutes went to: a contact (to) or a member (cc). */
export interface ApiMinutesRecipient {
  id: string;
  kind: 'to' | 'cc';
  contactId: string | null;
  userId: string | null;
  name: string;
  email: string;
  status: MinutesDeliveryStatus;
  error: string | null;
  sentAt: string | null;
}
/** One send of the external minutes (CD-133): an exact copy of what was sent. */
export interface ApiMinutesSend {
  id: string;
  meetingId: string;
  senderUserId: string | null;
  senderName: string;
  senderEmail: string;
  subject: string;
  body: string;
  language: 'en' | 'sr';
  /** failed when any recipient failed, queued while any is queued, else sent. */
  status: MinutesDeliveryStatus;
  recipients: ApiMinutesRecipient[];
  createdAt: string;
}
/** The external minutes' text (CD-133). */
export interface ApiExternalMinutes {
  subject: string;
  body: string;
  prefilled: boolean;
  /** The version (If-Match); null before it was written. */
  updatedAt: string | null;
  updatedByName: string | null;
  language: 'en' | 'sr';
  lastSend: ApiMinutesSend | null;
  changedSinceLastSend: boolean;
}
/** Preview and send: contacts (external participants with an email) and members to copy. */
export interface MinutesEmailInput {
  subject: string;
  body: string;
  toContactIds: string[];
  ccUserIds: string[];
}
/** The email exactly as it goes out. */
export interface ApiMinutesEmail {
  from: string;
  replyTo: string;
  to: { name: string; email: string }[];
  cc: { name: string; email: string }[];
  subject: string;
  text: string;
  html: string;
}
/** GET /crm/meetings: meetings overlapping [from, to), or by record or ids. */
export interface MeetingQuery {
  from?: string;
  to?: string;
  /** Organizer or internal participant. */
  userId?: string;
  companyId?: string;
  dealId?: string;
  /** External participant. */
  contactId?: string;
  type?: MeetingType[];
  status?: MeetingStatus[];
  notClosed?: boolean;
  /** Held without a summary (CD-132). */
  missingMinutes?: boolean;
  ids?: readonly string[];
  sort?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}
const meetingSearch = (q: MeetingQuery): string => {
  const p = new URLSearchParams();
  const add = (k: string, v: string | number | undefined) => {
    if (v !== undefined && v !== '') p.set(k, String(v));
  };
  add('from', q.from);
  add('to', q.to);
  add('userId', q.userId);
  add('companyId', q.companyId);
  add('dealId', q.dealId);
  add('contactId', q.contactId);
  if (q.type?.length) add('type', q.type.join(','));
  if (q.status?.length) add('status', q.status.join(','));
  if (q.notClosed) add('notClosed', 1);
  if (q.missingMinutes) add('missingMinutes', 1);
  if (q.ids) add('ids', q.ids.join(','));
  add('sort', q.sort);
  add('limit', q.limit);
  add('offset', q.offset);
  const s = p.toString();
  return s ? '?' + s : '';
};

export const crmApi = {
  me: () => api<ApiMe>('/me'),
  createTenant: (name: string, currency?: string, timezone?: string) =>
    api<ApiTenant>('/tenants', { method: 'POST', json: { name, ...(currency ? { currency } : {}), ...(timezone ? { timezone } : {}) } }),
  saveOnboardingProfile: (name: string, jobTitle: string) => api<ApiUserOnboarding>('/me/onboarding/profile', { method: 'PUT', json: { name, jobTitle } }),
  finishOnboardingTeam: () => api<ApiUserOnboarding>('/me/onboarding/team', { method: 'POST' }),
  acceptPendingInvitation: (id: string) => api<ApiTenant>(`/me/invitations/${id}/accept`, { method: 'POST' }),

  workspace: () => api<ApiWorkspace>('/workspace'),
  updateWorkspace: (input: WorkspaceInput) => api<ApiWorkspace>('/workspace', { method: 'PATCH', json: input }),
  profile: () => api<ApiProfile>('/profile'),
  updateProfile: (input: ProfileInput) => api<ApiProfile>('/profile', { method: 'PATCH', json: input }),
  onboarding: () => api<ApiOnboarding>('/onboarding'),
  setOnboardingDismissed: (dismissed: boolean) => api<ApiOnboarding>('/onboarding/dismissed', { method: 'PUT', json: { dismissed } }),
  loadSampleData: () => api<ApiOnboarding>('/onboarding/sample-data', { method: 'POST' }),
  removeSampleData: () => api<ApiSampleRemoval>('/onboarding/sample-data', { method: 'DELETE' }),

  team: () => api<{ members: ApiMember[]; invitations: ApiInvitation[] }>('/team'),
  invite: (email: string, role: 'admin' | 'member') => api<{ invitation: ApiInvitation; token: string }>('/team/invitations', { method: 'POST', json: { email, role } }),
  revokeInvitation: (id: string) => api(`/team/invitations/${id}`, { method: 'DELETE' }),
  resendInvitation: (id: string) => api<ApiInvitation>(`/team/invitations/${id}/resend`, { method: 'POST' }),
  invitationLink: (id: string) => api<{ token: string }>(`/team/invitations/${id}/link`),
  updateMember: (userId: string, role: ApiRole) => api(`/team/members/${userId}`, { method: 'PATCH', json: { role } }),
  removeMember: (userId: string) => api(`/team/members/${userId}`, { method: 'DELETE' }),
  previewInvitation: (token: string) => api<ApiInvitePreview>(`/invitations/${token}`),
  acceptInvitation: (token: string) => api<ApiTenant>(`/invitations/${token}/accept`, { method: 'POST' }),

  funnels: () => api<ApiFunnel[]>('/crm/funnels'),
  createFunnel: (input: { label: string; note?: string | null; copyFromFunnelId?: string }) => api<ApiFunnel>('/crm/funnels', { method: 'POST', json: input }),
  updateFunnel: (id: string, input: { label?: string; note?: string | null }) => api<ApiFunnel>(`/crm/funnels/${id}`, { method: 'PATCH', json: input }),
  deleteFunnel: (id: string) => api(`/crm/funnels/${id}`, { method: 'DELETE' }),
  updateStage: (funnelId: string, stageId: string, input: StageInput) => api(`/crm/funnels/${funnelId}/stages/${stageId}`, { method: 'PATCH', json: input }),
  createStage: (funnelId: string, input: StageInput & { name: string; position?: number }) => api<ApiFunnel>(`/crm/funnels/${funnelId}/stages`, { method: 'POST', json: input }),
  reorderStages: (funnelId: string, stageIds: string[]) => api<ApiFunnel>(`/crm/funnels/${funnelId}/stages/order`, { method: 'PUT', json: { stageIds } }),
  /** Deals in the stage move to `moveDealsTo` (required when it has any). */
  deleteStage: (funnelId: string, stageId: string, moveDealsTo?: string) =>
    api<ApiFunnel>(`/crm/funnels/${funnelId}/stages/${stageId}${moveDealsTo ? '?moveDealsTo=' + moveDealsTo : ''}`, { method: 'DELETE' }),

  companies: (ids?: readonly string[]) => all<ApiCompany>(only('/crm/companies', 'ids', ids)),
  createCompany: (input: CompanyInput & { name: string }) => api<ApiCompany>('/crm/companies', { method: 'POST', json: input }),
  updateCompany: (id: string, input: CompanyInput, version?: string) => api<ApiCompany>(`/crm/companies/${id}`, { method: 'PATCH', json: input, headers: ifMatch(version) }),
  deleteCompany: (id: string) => api(`/crm/companies/${id}`, { method: 'DELETE' }),

  contacts: (ids?: readonly string[]) => all<ApiContact>(only('/crm/contacts', 'ids', ids)),
  createContact: (input: ContactInput & { fullName: string }) => api<ApiContact>('/crm/contacts', { method: 'POST', json: input }),
  updateContact: (id: string, input: ContactInput, version?: string) => api<ApiContact>(`/crm/contacts/${id}`, { method: 'PATCH', json: input, headers: ifMatch(version) }),
  deleteContact: (id: string) => api(`/crm/contacts/${id}`, { method: 'DELETE' }),

  deals: (ids?: readonly string[]) => all<ApiDealRow>(only('/crm/deals', 'ids', ids)),
  createDeal: (input: DealInput & { title: string; funnelId: string }) => api<ApiDeal>('/crm/deals', { method: 'POST', json: input }),
  updateDeal: (id: string, input: DealInput, version?: string) => api<ApiDeal>(`/crm/deals/${id}`, { method: 'PATCH', json: input, headers: ifMatch(version) }),
  deleteDeal: (id: string) => api(`/crm/deals/${id}`, { method: 'DELETE' }),
  moveDeal: (id: string, stageId: string) => api<ApiDeal>(`/crm/deals/${id}/move`, { method: 'POST', json: { stageId } }),
  markLost: (id: string, reason: LostReason, note: string | null) => api<ApiDeal>(`/crm/deals/${id}/lost`, { method: 'POST', json: { reason, note } }),
  reopenDeal: (id: string) => api<ApiDeal>(`/crm/deals/${id}/reopen`, { method: 'POST' }),
  stageHistory: () => all<ApiStageChange>('/crm/deal-stage-history'),
  linkContact: (dealId: string, contactId: string) => api(`/crm/deals/${dealId}/contacts/${contactId}`, { method: 'PUT' }),
  unlinkContact: (dealId: string, contactId: string) => api(`/crm/deals/${dealId}/contacts/${contactId}`, { method: 'DELETE' }),
  activities: (dealId: string) => api<ApiActivity[]>(`/crm/deals/${dealId}/activities`),
  logActivity: (dealId: string, input: { channel: Channel; title: string; detail?: string | null }) =>
    api<ApiActivity>(`/crm/deals/${dealId}/activities`, { method: 'POST', json: input }),

  dealLines: (dealIds?: readonly string[]) => all<ApiDealLine>(only('/crm/deal-lines', 'dealIds', dealIds)),
  saveDealProducts: (dealId: string, input: DealProductsInput) => api<{ lines: ApiDealLine[] }>(`/crm/deals/${dealId}/products`, { method: 'PUT', json: input }),

  dealTasks: (dealIds?: readonly string[]) => all<ApiDealTask>(only('/crm/deal-tasks', 'dealIds', dealIds)),
  upsertPlaybookTask: (dealId: string, input: TaskInput & { stageId: string; checklistItemId: string }) =>
    api<ApiDealTask>(`/crm/deals/${dealId}/tasks/playbook`, { method: 'PUT', json: input }),
  createTask: (dealId: string, input: TaskInput & { stageId: string; label: string; position?: number; blocksAdvance?: boolean }) =>
    api<ApiDealTask>(`/crm/deals/${dealId}/tasks`, { method: 'POST', json: input }),
  updateTask: (id: string, input: TaskInput) => api<ApiDealTask>(`/crm/deal-tasks/${id}`, { method: 'PATCH', json: input }),
  deleteTask: (id: string) => api(`/crm/deal-tasks/${id}`, { method: 'DELETE' }),

  products: (ids?: readonly string[]) => all<ApiProduct>(only('/crm/products', 'ids', ids)),
  createProduct: (input: ProductInput & { name: string }) => api<ApiProduct>('/crm/products', { method: 'POST', json: input }),
  updateProduct: (id: string, input: ProductInput) => api<ApiProduct>(`/crm/products/${id}`, { method: 'PATCH', json: input }),
  deleteProduct: (id: string) => api(`/crm/products/${id}`, { method: 'DELETE' }),

  customFields: () => api<ApiCustomField[]>('/crm/custom-fields'),
  createCustomField: (input: { entity: CustomFieldEntity; label: string; type: CustomFieldType; options?: { label: string }[]; required?: boolean }) =>
    api<ApiCustomField>('/crm/custom-fields', { method: 'POST', json: input }),
  updateCustomField: (id: string, input: { label?: string; options?: { id?: string; label: string }[]; required?: boolean }) => api<ApiCustomField>(`/crm/custom-fields/${id}`, { method: 'PATCH', json: input }),
  reorderCustomFields: (entity: CustomFieldEntity, fieldIds: string[]) => api<ApiCustomField[]>('/crm/custom-fields/order', { method: 'PUT', json: { entity, fieldIds } }),
  deleteCustomField: (id: string) => api(`/crm/custom-fields/${id}`, { method: 'DELETE' }),

  bonusRules: () => api<ApiBonusRules>('/crm/bonus-rules'),
  updateBonusSettings: (trigger: string) => api<ApiBonusRules>('/crm/bonus-rules', { method: 'PATCH', json: { trigger } }),
  putBonusRule: (userId: string, rule: { rate: number; floor: number; fixed: number }) => api<ApiBonusRules>(`/crm/bonus-rules/${userId}`, { method: 'PUT', json: rule }),
  visitPlans: (ids?: readonly string[]) => api<{ plans: ApiVisitPlan[] }>(only('/crm/visit-plans', 'ids', ids)).then((r) => r.plans),
  createVisitPlan: (input: VisitPlanInput) => api<ApiVisitPlan>('/crm/visit-plans', { method: 'POST', json: input }),
  /** `lines` replaces the plan's lines. */
  updateVisitPlan: (id: string, input: Partial<VisitPlanInput>, version?: string) => api<ApiVisitPlan>(`/crm/visit-plans/${id}`, { method: 'PATCH', json: input, headers: ifMatch(version) }),
  deleteVisitPlan: (id: string) => api(`/crm/visit-plans/${id}`, { method: 'DELETE' }),
  visitPlanScope: () => api<ApiVisitScope>('/crm/visit-plans/scope'),
  visitPlanProgress: (id: string) => api<ApiVisitPlanProgress>(`/crm/visit-plans/${id}/progress`),
  /** The totals of several plans (≤200), for the list. */
  visitPlansProgress: (ids: readonly string[]) => api<{ progress: { planId: string; totals: ApiVisitTotals }[] }>(`/crm/visit-plans/progress?ids=${ids.join(',')}`).then((r) => r.progress),
  /** Reports → Visit-plan completion (owners and admins). */
  visitReport: (q: VisitPeriodQuery) => api<ApiVisitReport>('/crm/visit-plans/report' + visitQuery(q)),
  /** The Overview card and the company card; members always get their own. */
  visitSummary: (q: VisitPeriodQuery) => api<ApiVisitSummary>('/crm/visit-plans/progress-summary' + visitQuery(q)),
  history: (entityType: HistoryEntity, entityId: string, offset = 0, limit = 30) =>
    api<{ entries: ApiHistoryEntry[]; more: boolean }>(`/crm/history?entityType=${entityType}&entityId=${entityId}&limit=${limit}&offset=${offset}`),

  meetings: {
    list: (q: MeetingQuery) => api<{ meetings: ApiMeeting[]; more: boolean }>('/crm/meetings' + meetingSearch(q)),
    get: (id: string) => api<ApiMeeting>(`/crm/meetings/${id}`),
    create: (input: MeetingInput & { title: string; type: MeetingType; startsAt: string; endsAt: string; companyId: string }) => api<ApiMeeting>('/crm/meetings', { method: 'POST', json: input }),
    patch: (id: string, input: MeetingInput, version?: string) => api<ApiMeeting>(`/crm/meetings/${id}`, { method: 'PATCH', json: input, headers: ifMatch(version) }),
    held: (id: string) => api<ApiMeeting>(`/crm/meetings/${id}/held`, { method: 'POST' }),
    cancel: (id: string, reason: string | null) => api<ApiMeeting>(`/crm/meetings/${id}/cancel`, { method: 'POST', json: reason ? { reason } : {} }),
    undoHeld: (id: string) => api<ApiMeeting>(`/crm/meetings/${id}/undo-held`, { method: 'POST' }),
    restore: (id: string) => api<ApiMeeting>(`/crm/meetings/${id}/restore`, { method: 'POST' }),
    delete: (id: string) => api(`/crm/meetings/${id}`, { method: 'DELETE' }),
    /** Internal minutes (CD-132). */
    minutes: (id: string) => api<ApiInternalMinutes>(`/crm/meetings/${id}/minutes/internal`),
    /** `version` is the minutes' updatedAt; before the first save, the epoch (so a save someone made meanwhile conflicts). */
    saveMinutes: (id: string, input: InternalMinutesInput, version: string | null) =>
      api<ApiInternalMinutes>(`/crm/meetings/${id}/minutes/internal`, { method: 'PUT', json: input, headers: ifMatch(version ?? '1970-01-01T00:00:00.000Z') }),
    stepTask: (id: string, stepId: string) => api<{ minutes: ApiInternalMinutes; task: ApiDealTask }>(`/crm/meetings/${id}/minutes/next-steps/${stepId}/task`, { method: 'POST' }),
    /** External minutes (CD-133): the first read fills in the template. */
    external: (id: string) => api<ApiExternalMinutes>(`/crm/meetings/${id}/minutes/external`),
    saveExternal: (id: string, input: { subject?: string; body?: string }, version: string | null) =>
      api<ApiExternalMinutes>(`/crm/meetings/${id}/minutes/external`, { method: 'PUT', json: input, headers: ifMatch(version ?? '1970-01-01T00:00:00.000Z') }),
    copyInternal: (id: string) => api<{ subject: string; body: string }>(`/crm/meetings/${id}/minutes/external/copy-internal`, { method: 'POST' }),
    previewMinutes: (id: string, input: MinutesEmailInput) => api<ApiMinutesEmail>(`/crm/meetings/${id}/minutes/preview`, { method: 'POST', json: input }),
    sendMinutes: (id: string, input: MinutesEmailInput) => api<ApiMinutesSend>(`/crm/meetings/${id}/minutes/send`, { method: 'POST', json: input }),
    sends: (id: string) => api<ApiMinutesSend[]>(`/crm/meetings/${id}/minutes/sends`),
    retrySend: (id: string, sendId: string) => api<ApiMinutesSend>(`/crm/meetings/${id}/minutes/sends/${sendId}/retry`, { method: 'POST' }),
  },
};

// ---------------------------------------------------------------- people (milestone 13)
// Employees, departments and teams (backend modules/people, docs/ARCHITECTURE.md "People"). What
// a row carries depends on the caller (spec 9): directory fields always; `employment` only for rows
// in their scope; `hr` for Administration and Admin; `roles` for Admins. Never assume the optional
// parts exist.

export type ApiFunctionalRole = 'employee' | 'manager' | 'administration' | 'payroll' | 'admin';
export type ApiEmployeeStatus = 'active' | 'leaving' | 'inactive';
export type ApiAccountState = 'linked' | 'invited' | 'none';
export type ApiDataIssue = 'no_manager' | 'no_start_date' | 'no_department' | 'manager_no_account' | 'no_employee_number';
export type ApiEmploymentType = 'permanent' | 'fixed_term' | 'contractor' | 'student';

/** The caller's place in the org: `GET /api/people/access`. */
export interface ApiPeopleAccess {
  employeeId: string | null;
  roles: ApiFunctionalRole[];
  directReportIds: string[];
  reportIds: string[];
}

export interface ApiEmployment {
  employeeNumber: string | null;
  startDate: string | null;
  endDate: string | null;
  type: ApiEmploymentType;
  weeklyHours: number;
  timesheetRequired: boolean;
  attendanceTracked: boolean;
  deactivatedAt: string | null;
  /** Administration and Admin only. */
  leavingReason?: string | null;
}

/** One row of the directory (`GET /api/people/employees`). */
export interface ApiEmployee {
  id: string;
  userId: string | null;
  firstName: string;
  lastName: string;
  fullName: string;
  jobTitle: string | null;
  departmentId: string | null;
  departmentName: string | null;
  teamId: string | null;
  teamName: string | null;
  managerId: string | null;
  managerName: string | null;
  workEmail: string | null;
  workPhone: string | null;
  workLocation: string | null;
  status: ApiEmployeeStatus;
  /** Self, managers above them, Administration, Admin. */
  employment?: ApiEmployment;
  /** Administration and Admin. */
  hr?: { account: ApiAccountState; dataIssues: ApiDataIssue[] };
  /** Admins. */
  roles?: ApiFunctionalRole[];
}

export interface ApiEmployeeQuery {
  status?: ApiEmployeeStatus[];
  ids?: readonly string[];
}

export interface ApiDepartment {
  id: string;
  name: string;
  code: string | null;
  headEmployeeId: string | null;
  version: string;
  activeEmployees: number;
}

export interface ApiTeam {
  id: string;
  departmentId: string;
  name: string;
  leadEmployeeId: string | null;
  version: string;
  activeEmployees: number;
}

/** "Set department and team" (together: a team brings its department) or "Set manager" for several employees. */
export interface BulkEmployeesInput {
  employeeIds: string[];
  departmentId?: string | null;
  teamId?: string | null;
  managerId?: string | null;
}

/** "Include personal details and bank accounts" (Administration, Admin; every export is audited). */
export interface ApiEmployeePersonalExport {
  id: string;
  personal: {
    dateOfBirth: string | null;
    privateEmail: string | null;
    privatePhone: string | null;
    addressStreet: string | null;
    addressPostalCode: string | null;
    addressCity: string | null;
    addressCountry: string | null;
    emergencyContactName: string | null;
    emergencyContactPhone: string | null;
  };
  bank: { iban: string | null; bankName: string | null; fxIban: string | null; fxSameAsIban: boolean; swiftBic: string | null; fxBankName: string | null; fxBankAddress: string | null };
}

const employeeSearch = (q: ApiEmployeeQuery) => {
  const p = new URLSearchParams();
  if (q.status?.length) p.set('status', q.status.join(','));
  if (q.ids) p.set('ids', q.ids.join(','));
  const s = p.toString();
  return s ? '?' + s : '';
};

export const peopleApi = {
  access: () => api<ApiPeopleAccess>('/people/access'),
  /** The whole directory in one response (sorted by last name); `ids` (≤200) for live updates. */
  employees: (q: ApiEmployeeQuery = {}) => api<{ employees: ApiEmployee[]; total: number }>('/people/employees' + employeeSearch(q)).then((r) => r.employees),
  departments: () => api<ApiDepartment[]>('/people/departments'),
  teams: () => api<ApiTeam[]>('/people/teams'),
  /** All or nothing: `{ updated }` is how many actually changed. */
  bulkUpdate: (input: BulkEmployeesInput) => api<{ updated: number }>('/people/employees/bulk', { method: 'POST', json: input }),
  exportPersonal: (employeeIds: string[]) => api<{ employees: ApiEmployeePersonalExport[] }>('/people/employees/export', { method: 'POST', json: { employeeIds } }).then((r) => r.employees),
};

/** The five functional roles (spec 9.1), in the matrix's column order. */
export type FunctionalRole = 'employee' | 'manager' | 'administration' | 'payroll' | 'admin';
/** Assigned by an Admin; the other three are derived. */
export type AssignedRole = 'administration' | 'payroll';
export type PermissionScope = 'none' | 'own' | 'direct' | 'indirect' | 'all';
/** The permission matrix the server checks against (GET /people/permissions, CD-142). */
export interface ApiPermissionMatrix {
  roles: { id: FunctionalRole; label: string; who: string; given: string }[];
  modules: {
    id: string;
    name: string;
    milestone: number | null;
    /** Not live: "Coming with <name>". */
    live: boolean;
    rows: { id: string; action: string; cells: Record<FunctionalRole, { scope: PermissionScope; label: string }> }[];
  }[];
}
export interface ApiRoleHolder {
  employeeId: string | null;
  userId: string | null;
  name: string;
  jobTitle: string | null;
  hasAccount: boolean;
}
/** "Who has which role" (GET /people/roles). */
export interface ApiRoleHolders {
  administration: (ApiRoleHolder & { employeeId: string; grantedAt: string })[];
  payroll: (ApiRoleHolder & { employeeId: string; grantedAt: string })[];
  admins: (ApiRoleHolder & { workspaceRole: 'owner' | 'admin' })[];
  managers: (ApiRoleHolder & { employeeId: string; reports: number })[];
}
/** A directory row, as the employee picker needs it. */
export interface ApiDirectoryEmployee {
  id: string;
  userId: string | null;
  fullName: string;
  jobTitle: string | null;
  departmentName: string | null;
  status: 'active' | 'leaving' | 'inactive';
}

/** Functional roles and permissions (CD-142). */
export const rolesApi = {
  permissions: () => api<ApiPermissionMatrix>('/people/permissions'),
  holders: () => api<ApiRoleHolders>('/people/roles'),
  /** Admin only. */
  grant: (employeeId: string, role: AssignedRole) => api<{ employeeId: string; roles: AssignedRole[] }>(`/people/employees/${employeeId}/roles/${role}`, { method: 'PUT' }),
  /** Admin only. */
  remove: (employeeId: string, role: AssignedRole) => api(`/people/employees/${employeeId}/roles/${role}`, { method: 'DELETE' }),
  /** The directory (active employees), for "Add person". */
  employees: () => api<{ employees: ApiDirectoryEmployee[]; total: number }>('/people/employees').then((r) => r.employees),
};

// ------------------------------------------------------------------ people: the employee card (milestone 13, CD-140)

export type EmployeeStatus = 'active' | 'leaving' | 'inactive';
export type EmployeeAccount = 'linked' | 'invited' | 'none';
export type EmploymentType = 'permanent' | 'fixed_term' | 'contractor' | 'student';
export type LeavingReason = 'resigned' | 'contract_ended' | 'dismissed' | 'retired' | 'other';

/** The fields of an employee card the API takes (PATCH /people/employees/:id) and names in history and `editableFields`. */
export type EmployeeField =
  | 'firstName'
  | 'lastName'
  | 'workEmail'
  | 'jobTitle'
  | 'workPhone'
  | 'workLocation'
  | 'employeeNumber'
  | 'employmentStartDate'
  | 'employmentType'
  | 'weeklyHours'
  | 'timesheetRequired'
  | 'attendanceTracked'
  | 'departmentId'
  | 'teamId'
  | 'managerId'
  | 'dateOfBirth'
  | 'privateEmail'
  | 'privatePhone'
  | 'addressStreet'
  | 'addressPostalCode'
  | 'addressCity'
  | 'addressCountry'
  | 'emergencyContactName'
  | 'emergencyContactPhone'
  | 'iban'
  | 'bankName'
  | 'fxSameAsIban'
  | 'fxIban'
  | 'swiftBic'
  | 'fxBankName'
  | 'fxBankAddress';

export interface ApiMaskedIban {
  /** "RS35 •••• •••• •••• ••13 79". */
  masked: string;
  last4: string | null;
  country: string | null;
  foreign: boolean;
}

export interface ApiApprovals {
  kind: 'manager' | 'admins' | 'self';
  reason: 'manager' | 'no_manager' | 'manager_inactive' | 'manager_no_account' | 'manager_absent';
  approvers: { userId: string; employeeId: string | null; fullName: string }[];
  selfApproved: boolean;
}

/**
 * GET /people/employees/:id: the card. Sections the caller may not see are absent (not empty):
 * `employment` (self, managers above, HR), `personal` and `bank` (self, HR), `appAccess` (Admin).
 */
export interface ApiEmployeeCard {
  id: string;
  userId: string | null;
  firstName: string;
  lastName: string;
  fullName: string;
  jobTitle: string | null;
  departmentId: string | null;
  departmentName: string | null;
  teamId: string | null;
  teamName: string | null;
  managerId: string | null;
  managerName: string | null;
  workEmail: string | null;
  workPhone: string | null;
  workLocation: string | null;
  status: EmployeeStatus;
  /** Send back as If-Match. */
  version: string;
  account: EmployeeAccount;
  roles: FunctionalRole[];
  manager: { id: string; fullName: string; hasAccount: boolean; manager: { id: string; fullName: string } | null } | null;
  directReports: { id: string; fullName: string; jobTitle: string | null }[];
  leadsTeams: { id: string; name: string }[];
  headsDepartments: { id: string; name: string }[];
  approvals: ApiApprovals | null;
  employment?: {
    employeeNumber: string | null;
    startDate: string | null;
    endDate: string | null;
    type: EmploymentType;
    weeklyHours: number;
    timesheetRequired: boolean;
    attendanceTracked: boolean;
    deactivatedAt: string | null;
    leavingReason?: LeavingReason | null;
  };
  hr?: { dataIssues: string[] };
  personal?: {
    dateOfBirth: string | null;
    privateEmail: string | null;
    privatePhone: string | null;
    addressStreet: string | null;
    addressPostalCode: string | null;
    addressCity: string | null;
    addressCountry: string | null;
    emergencyContactName: string | null;
    emergencyContactPhone: string | null;
  };
  bank?: {
    iban: ApiMaskedIban | null;
    bankName: string | null;
    fxSameAsIban: boolean;
    fxIban: ApiMaskedIban | null;
    swiftBic: string | null;
    fxBankName: string | null;
    fxBankAddress: string | null;
  };
  appAccess?: {
    signInEmail: string | null;
    workspaceRole: ApiRole | null;
    invitation: { id: string; email: string; role: 'admin' | 'member'; expiresAt: string; emailStatus: ApiInvitation['emailStatus']; emailSentAt: string | null; emailError: string | null; hasLink: boolean } | null;
  };
  permissions: {
    editableFields: EmployeeField[];
    canRevealBank: boolean;
    canSeeHistory: boolean;
    canDelete: boolean;
    canInvite: boolean;
    canLink: boolean;
    canUnlink: boolean;
    canDeactivate: boolean;
    canReactivate: boolean;
  };
}

/** A row of the directory (GET /people/employees), as the card's pickers use it. */
export interface ApiEmployeeRow {
  id: string;
  userId: string | null;
  fullName: string;
  jobTitle: string | null;
  departmentId: string | null;
  teamId: string | null;
  managerId: string | null;
  status: EmployeeStatus;
}

/** PATCH /people/employees/:id: any subset; '' or null clears a text field. */
export type EmployeePatch = Partial<Record<EmployeeField, string | number | boolean | null>>;

/** One change of an employee (GET /people/history), newest first; IBANs only as their mask. */
export interface ApiPeopleHistoryEntry {
  id: string;
  action: 'created' | 'updated' | 'deleted';
  field: string | null;
  oldValue: unknown;
  newValue: unknown;
  oldLabel: string | null;
  newLabel: string | null;
  label: string | null;
  actor: { userId: string | null; name: string } | null;
  changedAt: string;
}

/** "Link to member": a member and whether their own record can be merged into this one. */
export interface ApiLinkCandidate {
  userId: string;
  name: string;
  email: string | null;
  employeeId: string | null;
  employeeName: string | null;
  mergeable: boolean;
  blockers: string[];
}

export interface DeactivateInput {
  lastWorkingDay: string;
  reason?: LeavingReason | null;
  /** Required (null = "No manager") when they have direct reports. */
  reportsManagerId?: string | null;
  teamLeads?: { teamId: string; employeeId: string | null }[];
  departmentHeads?: { departmentId: string; employeeId: string | null }[];
}

/** The employee card's calls (CD-140); the Org structure page has its own client. */
export const peopleCardApi = {
  access: () => api<ApiPeopleAccess>('/people/access'),
  card: (id: string) => api<ApiEmployeeCard>(`/people/employees/${id}`),
  /** "Add employee" (Administration, Admin): first and last name and the start date are required. */
  create: (input: EmployeePatch) => api<ApiEmployeeCard>('/people/employees', { method: 'POST', json: input }),
  update: (id: string, patch: EmployeePatch, version?: string) => api<ApiEmployeeCard>(`/people/employees/${id}`, { method: 'PATCH', json: patch, headers: ifMatch(version) }),
  reveal: (id: string, account: 'iban' | 'fxIban') =>
    api<{ account: 'iban' | 'fxIban'; iban: string; formatted: string; domestic: string | null; foreign: boolean }>(`/people/employees/${id}/bank/reveal`, { method: 'POST', json: { account } }),
  history: (id: string, offset = 0, limit = 30) => api<{ entries: ApiPeopleHistoryEntry[]; more: boolean }>(`/people/history?entityType=employee&entityId=${id}&limit=${limit}&offset=${offset}`),
  /** "Approvals go to" (spec 7.4) for `date` (default today). */
  approvers: (id: string, date?: string) => api<ApiApprovals>(`/people/employees/${id}/approvers${date ? `?date=${date}` : ''}`),
  /** Active employees, departments and teams for the card's pickers. */
  directory: () => api<{ employees: ApiEmployeeRow[]; total: number }>('/people/employees'),
  departments: () => api<ApiDepartment[]>('/people/departments'),
  teams: () => api<ApiTeam[]>('/people/teams'),
  invite: (id: string, role: 'admin' | 'member') => api<{ invitation: ApiInvitation; token: string; card: ApiEmployeeCard }>(`/people/employees/${id}/invite`, { method: 'POST', json: { role } }),
  /** "Invite selected": `{ queued, skipped }`; a job creates the invitations. */
  bulkInvite: (employeeIds: string[], role: 'admin' | 'member' = 'member') => api<{ queued: number; skipped: number }>('/people/employees/invite', { method: 'POST', json: { employeeIds, role } }),
  linkCandidates: (id: string) => api<ApiLinkCandidate[]>(`/people/employees/${id}/link-candidates`),
  link: (id: string, userId: string) => api<ApiEmployeeCard>(`/people/employees/${id}/link`, { method: 'POST', json: { userId } }),
  unlink: (id: string) => api<ApiEmployeeCard>(`/people/employees/${id}/unlink`, { method: 'POST' }),
  deactivate: (id: string, input: DeactivateInput) => api<ApiEmployeeCard>(`/people/employees/${id}/deactivate`, { method: 'POST', json: input }),
  reactivate: (id: string, employmentStartDate?: string) => api<ApiEmployeeCard>(`/people/employees/${id}/reactivate`, { method: 'POST', json: employmentStartDate ? { employmentStartDate } : {} }),
  remove: (id: string) => api(`/people/employees/${id}`, { method: 'DELETE' }),
};
