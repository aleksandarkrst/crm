/**
 * Typed fetch wrapper for the backend. Same-origin: the browser calls /api/... and the Vite dev
 * server (locally) or nginx (production) forwards to the API container.
 *
 * Every tenant-scoped call carries the X-Tenant-Id header; the backend checks membership and
 * PostgreSQL row-level security enforces the isolation.
 */
import { getAccessToken } from './auth';

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

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const token = await getAccessToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const tenant = getTenantId();
  if (tenant) headers.set('X-Tenant-Id', tenant);
  if (init.json !== undefined) headers.set('Content-Type', 'application/json');

  const res = await fetch(`/api${path}`, { ...init, headers, body: init.json !== undefined ? JSON.stringify(init.json) : init.body });
  const body: unknown = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}

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
  /** The labels of checklistItems, in order. */
  checklist: string[];
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
}
export interface ApiMe {
  user: { id: string; email: string | null; displayName: string | null };
  tenants: ApiTenant[];
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
}
export type WorkspaceInput = Partial<Pick<ApiWorkspace, 'name' | 'currency' | 'timezone' | 'fiscalYearStartMonth'>>;
export type ApiLanguage = 'en' | 'sr' | 'de';
export type ApiDateFormat = 'DD.MM.YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD';
export type ApiStartPage = 'pipeline' | 'overview' | 'today' | 'contacts';
/** The signed-in user's profile (GET/PATCH /profile). The last two apply to the current workspace only. */
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
  /** Current name of the owner, also after they left the workspace (lists only). */
  ownerName?: string | null;
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
export interface ApiProduct {
  id: string;
  name: string;
  type: 'Service' | 'Product';
  billingKind: 'One-off' | 'Monthly' | 'Yearly' | 'Hourly';
  unitPrice: string;
  vatRate: string;
  /** ISO 4217 code of the price (CD-77); only deals in this currency can use the product. */
  currency: string;
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

export interface ApiMilestone {
  label: string;
  pct: number;
  date?: string;
}
export interface ApiDealLine {
  id: string;
  dealId: string;
  productId: string | null;
  position: number;
  quantity: string;
  unitPrice: string;
  vatRate: string;
  schedule: string;
  startDate: string | null;
  months: number;
  milestones: ApiMilestone[];
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
}
export interface ApiInvitation {
  id: string;
  email: string;
  role: 'admin' | 'member';
  expiresAt: string;
  createdAt: string;
}
export interface ApiInvitePreview {
  tenantName: string;
  email: string;
  role: 'admin' | 'member';
  invitedBy: string | null;
  expiresAt: string;
}

/** Custom field values to write: null or '' clears a field. */
export type CustomFieldPatch = Record<string, CustomValue | null>;
export type CompanyInput = Partial<Omit<ApiCompany, 'id' | 'customFields'>> & { name?: string; customFields?: CustomFieldPatch };
export type ContactInput = Partial<Omit<ApiContact, 'id' | 'ownerName' | 'customFields'>> & { customFields?: CustomFieldPatch };
export type DealInput = Partial<
  Pick<ApiDeal, 'title' | 'companyId' | 'primaryContactId' | 'funnelId' | 'ownerUserId' | 'source' | 'closeDate' | 'amount' | 'currency' | 'headline' | 'need' | 'constraint' | 'decisionMaker' | 'discoveryDate'>
> & { champ?: ApiChamp; customFields?: CustomFieldPatch };
export type ProductInput = Partial<Omit<ApiProduct, 'id' | 'unitPrice' | 'vatRate'>> & { unitPrice?: number; vatRate?: number };
export type DealLineInput = Partial<{
  productId: string | null;
  position: number;
  quantity: number;
  unitPrice: number;
  vatRate: number;
  schedule: string;
  startDate: string | null;
  months: number;
  milestones: ApiMilestone[];
}>;
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

export const crmApi = {
  me: () => api<ApiMe>('/me'),
  createTenant: (name: string) => api<ApiTenant>('/tenants', { method: 'POST', json: { name } }),

  workspace: () => api<ApiWorkspace>('/workspace'),
  updateWorkspace: (input: WorkspaceInput) => api<ApiWorkspace>('/workspace', { method: 'PATCH', json: input }),
  profile: () => api<ApiProfile>('/profile'),
  updateProfile: (input: ProfileInput) => api<ApiProfile>('/profile', { method: 'PATCH', json: input }),

  team: () => api<{ members: ApiMember[]; invitations: ApiInvitation[] }>('/team'),
  invite: (email: string, role: 'admin' | 'member') => api<{ invitation: ApiInvitation; token: string }>('/team/invitations', { method: 'POST', json: { email, role } }),
  revokeInvitation: (id: string) => api(`/team/invitations/${id}`, { method: 'DELETE' }),
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

  companies: () => all<ApiCompany>('/crm/companies'),
  createCompany: (input: CompanyInput & { name: string }) => api<ApiCompany>('/crm/companies', { method: 'POST', json: input }),
  updateCompany: (id: string, input: CompanyInput) => api<ApiCompany>(`/crm/companies/${id}`, { method: 'PATCH', json: input }),
  deleteCompany: (id: string) => api(`/crm/companies/${id}`, { method: 'DELETE' }),

  contacts: () => all<ApiContact>('/crm/contacts'),
  createContact: (input: ContactInput & { fullName: string }) => api<ApiContact>('/crm/contacts', { method: 'POST', json: input }),
  updateContact: (id: string, input: ContactInput) => api<ApiContact>(`/crm/contacts/${id}`, { method: 'PATCH', json: input }),
  deleteContact: (id: string) => api(`/crm/contacts/${id}`, { method: 'DELETE' }),

  deals: () => all<ApiDealRow>('/crm/deals'),
  createDeal: (input: DealInput & { title: string; funnelId: string }) => api<ApiDeal>('/crm/deals', { method: 'POST', json: input }),
  updateDeal: (id: string, input: DealInput) => api<ApiDeal>(`/crm/deals/${id}`, { method: 'PATCH', json: input }),
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

  dealLines: () => all<ApiDealLine>('/crm/deal-lines'),
  createDealLine: (dealId: string, input: DealLineInput) => api<ApiDealLine>(`/crm/deals/${dealId}/lines`, { method: 'POST', json: input }),
  updateDealLine: (id: string, input: DealLineInput) => api<ApiDealLine>(`/crm/deal-lines/${id}`, { method: 'PATCH', json: input }),
  deleteDealLine: (id: string) => api(`/crm/deal-lines/${id}`, { method: 'DELETE' }),

  dealTasks: () => all<ApiDealTask>('/crm/deal-tasks'),
  upsertPlaybookTask: (dealId: string, input: TaskInput & { stageId: string; checklistItemId: string }) =>
    api<ApiDealTask>(`/crm/deals/${dealId}/tasks/playbook`, { method: 'PUT', json: input }),
  createTask: (dealId: string, input: TaskInput & { stageId: string; label: string; position?: number; blocksAdvance?: boolean }) =>
    api<ApiDealTask>(`/crm/deals/${dealId}/tasks`, { method: 'POST', json: input }),
  updateTask: (id: string, input: TaskInput) => api<ApiDealTask>(`/crm/deal-tasks/${id}`, { method: 'PATCH', json: input }),
  deleteTask: (id: string) => api(`/crm/deal-tasks/${id}`, { method: 'DELETE' }),

  products: () => all<ApiProduct>('/crm/products'),
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
};
