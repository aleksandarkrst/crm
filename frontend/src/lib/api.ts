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
  checklist: string[];
  isWon: boolean;
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
}
export interface ApiChamp {
  C: number;
  H: number;
  M: number;
  P: number;
}
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
  lastContactAt: string | null;
  stageEnteredAt: string;
  createdAt: string;
  updatedAt: string;
}
export interface ApiDealRow {
  deal: ApiDeal;
  contactIds: string[];
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
  offPlaybook: boolean;
  position: number;
  done: boolean;
  doneAt: string | null;
  doneByName: string | null;
  outcome: string | null;
  note: string | null;
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

export type CompanyInput = Partial<Omit<ApiCompany, 'id'>> & { name?: string };
export type ContactInput = Partial<Omit<ApiContact, 'id'>>;
export type DealInput = Partial<Pick<ApiDeal, 'title' | 'companyId' | 'primaryContactId' | 'funnelId' | 'source' | 'closeDate' | 'amount'>> & { champ?: ApiChamp };
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
export type TaskInput = Partial<{ label: string; done: boolean; outcome: string | null; note: string | null }>;
export type StageInput = Partial<Pick<ApiFunnelStage, 'name' | 'activity' | 'channel' | 'documentOnEntry' | 'winProbability' | 'checklist'>>;

export const crmApi = {
  me: () => api<ApiMe>('/me'),
  createTenant: (name: string) => api<ApiTenant>('/tenants', { method: 'POST', json: { name } }),

  team: () => api<{ members: ApiMember[]; invitations: ApiInvitation[] }>('/team'),
  invite: (email: string, role: 'admin' | 'member') => api<{ invitation: ApiInvitation; token: string }>('/team/invitations', { method: 'POST', json: { email, role } }),
  revokeInvitation: (id: string) => api(`/team/invitations/${id}`, { method: 'DELETE' }),
  updateMember: (userId: string, role: ApiRole) => api(`/team/members/${userId}`, { method: 'PATCH', json: { role } }),
  removeMember: (userId: string) => api(`/team/members/${userId}`, { method: 'DELETE' }),
  previewInvitation: (token: string) => api<ApiInvitePreview>(`/invitations/${token}`),
  acceptInvitation: (token: string) => api<ApiTenant>(`/invitations/${token}/accept`, { method: 'POST' }),

  funnels: () => api<ApiFunnel[]>('/crm/funnels'),
  updateStage: (funnelId: string, stageId: string, input: StageInput) => api(`/crm/funnels/${funnelId}/stages/${stageId}`, { method: 'PATCH', json: input }),

  companies: () => all<ApiCompany>('/crm/companies'),
  createCompany: (input: CompanyInput & { name: string }) => api<ApiCompany>('/crm/companies', { method: 'POST', json: input }),
  updateCompany: (id: string, input: CompanyInput) => api<ApiCompany>(`/crm/companies/${id}`, { method: 'PATCH', json: input }),

  contacts: () => all<ApiContact>('/crm/contacts'),
  createContact: (input: ContactInput & { fullName: string }) => api<ApiContact>('/crm/contacts', { method: 'POST', json: input }),
  updateContact: (id: string, input: ContactInput) => api<ApiContact>(`/crm/contacts/${id}`, { method: 'PATCH', json: input }),

  deals: () => all<ApiDealRow>('/crm/deals'),
  createDeal: (input: DealInput & { title: string; funnelId: string }) => api<ApiDeal>('/crm/deals', { method: 'POST', json: input }),
  updateDeal: (id: string, input: DealInput) => api<ApiDeal>(`/crm/deals/${id}`, { method: 'PATCH', json: input }),
  moveDeal: (id: string, stageId: string) => api<ApiDeal>(`/crm/deals/${id}/move`, { method: 'POST', json: { stageId } }),
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
  upsertPlaybookTask: (dealId: string, input: TaskInput & { stageId: string; label: string }) =>
    api<ApiDealTask>(`/crm/deals/${dealId}/tasks/playbook`, { method: 'PUT', json: input }),
  createTask: (dealId: string, input: TaskInput & { stageId: string; label: string; position?: number }) =>
    api<ApiDealTask>(`/crm/deals/${dealId}/tasks`, { method: 'POST', json: input }),
  updateTask: (id: string, input: TaskInput) => api<ApiDealTask>(`/crm/deal-tasks/${id}`, { method: 'PATCH', json: input }),
  deleteTask: (id: string) => api(`/crm/deal-tasks/${id}`, { method: 'DELETE' }),

  products: () => all<ApiProduct>('/crm/products'),
  createProduct: (input: ProductInput & { name: string }) => api<ApiProduct>('/crm/products', { method: 'POST', json: input }),
  updateProduct: (id: string, input: ProductInput) => api<ApiProduct>(`/crm/products/${id}`, { method: 'PATCH', json: input }),
  deleteProduct: (id: string) => api(`/crm/products/${id}`, { method: 'DELETE' }),
};
