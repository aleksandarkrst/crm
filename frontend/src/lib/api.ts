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

// Shapes returned by the backend (see backend/src/shared/database/schema).
export interface ApiFunnelStage {
  id: string;
  key: string;
  name: string;
  position: number;
  activity: string;
  channel: string;
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
export interface ApiMe {
  user: { id: string; email: string | null; displayName: string | null };
  tenants: { id: string; name: string; slug: string; role: 'owner' | 'admin' | 'member' }[];
}

export const crmApi = {
  me: () => api<ApiMe>('/me'),
  createTenant: (name: string) => api<ApiMe['tenants'][number]>('/tenants', { method: 'POST', json: { name } }),
  funnels: () => api<ApiFunnel[]>('/crm/funnels'),
  moveDeal: (id: string, stageId: string) => api(`/crm/deals/${id}/move`, { method: 'POST', json: { stageId } }),
};
