/** Time off (milestone 16, `/api/timeoff`): vacation policies and the employee's entitlement (CD-163). */
import { api, ApiError, authorizedFetch } from './api';

/** "From N years of work experience: +X days". The highest row reached applies. */
export interface ApiExperienceRule {
  fromYears: number;
  extraDays: number;
}

/** GET /timeoff/policies (spec 5.2). */
export interface ApiTimeOffPolicy {
  id: string;
  name: string;
  baseDays: number;
  /** Caps base + extra + individual; null is no cap. */
  maxDays: number | null;
  carryOver: boolean;
  /** At most this many unused days carry over; null is all of them. */
  carryOverCap: number | null;
  isDefault: boolean;
  note: string | null;
  experienceRules: ApiExperienceRule[];
  /** Active employees on it. */
  employees: number;
  updatedAt: string;
}

export interface ApiPolicyInput {
  name: string;
  baseDays: number;
  maxDays: number | null;
  carryOver: boolean;
  carryOverCap: number | null;
  note: string | null;
  experienceRules: ApiExperienceRule[];
}

/** One year's vacation entitlement (spec 5.4). */
export interface ApiEntitlement {
  id: string;
  year: number;
  policy: { id: string; name: string };
  baseDays: number;
  experienceYears: number;
  experienceDays: number;
  individualDays: number;
  individualReason: string | null;
  /** Full months of work in a first or last year; null is the whole year. */
  monthsWorked: number | null;
  annualDays: number;
  totalDays: number;
  /** Days of the year were approved: only Recalculate changes it. */
  frozen: boolean;
  /** The employee's policy changed since: Recalculate applies it to this year. */
  policyOutdated: boolean;
  updatedAt: string;
}

/** GET /timeoff/employees/:id/profile: the card's Time off section (spec 5.3). */
export interface ApiTimeOffProfile {
  employeeId: string;
  fullName: string;
  policy: { id: string; name: string };
  /** False while on the default policy without a row of their own. */
  hasProfile: boolean;
  priorExperienceMonths: number;
  priorExperienceLabel: string;
  startDate: string | null;
  endDate: string | null;
  entitlements: ApiEntitlement[];
  currentYear: number;
  canEdit: boolean;
}

export interface ApiTimeOffHistoryEntry {
  id: string;
  entityType: 'timeoff_policy' | 'timeoff_profile' | 'vacation_entitlement';
  entityId: string;
  action: string;
  field: string | null;
  oldValue: unknown;
  newValue: unknown;
  oldLabel: string | null;
  newLabel: string | null;
  label: string | null;
  actor: { userId: string | null; name: string } | null;
  changedAt: string;
}

export interface ApiRecalculation {
  before: ApiEntitlement | null;
  after: Pick<ApiEntitlement, 'baseDays' | 'experienceYears' | 'experienceDays' | 'individualDays' | 'annualDays' | 'monthsWorked' | 'totalDays'> | null;
  profile: ApiTimeOffProfile | null;
}

/** The figures of spec 6.3, in working days. */
export interface ApiBalanceFigures {
  year: number;
  entitlement: number;
  carriedOver: number;
  carryExpiresOn: string;
  adjustments: number;
  total: number;
  used: number;
  scheduled: number;
  pending: number;
  expired: number;
  remaining: number;
  available: number;
  /** The part of `remaining` that expires on 30 June. */
  carryRemaining: number;
  twoWeekPart: boolean;
}

export type AdjustmentKind = 'correction' | 'opening_balance' | 'extra_days';
export const ADJUSTMENT_KIND_LABEL: Record<AdjustmentKind, string> = { correction: 'Correction', opening_balance: 'Opening balance', extra_days: 'Extra days granted' };

export interface ApiBalanceHistoryEntry {
  date: string;
  kind: 'entitlement' | 'carry_over' | 'adjustment' | 'expired';
  label: string;
  days: number;
  runningTotal: number;
  actor?: { userId: string | null; name: string } | null;
  reason?: string;
  adjustmentKind?: AdjustmentKind;
}

/** GET /timeoff/employees/:id/balance?year= (spec 6.3, 6.5). */
export interface ApiBalance {
  employeeId: string;
  fullName: string;
  year: number;
  currentYear: number;
  years: number[];
  policy: { id: string; name: string; carryOver: boolean; carryOverCap: number | null };
  hasStartDate: boolean;
  figures: ApiBalanceFigures;
  history: ApiBalanceHistoryEntry[];
  expiryRecordedAt: string | null;
  canAdjust: boolean;
}

/** One row of the Balances table (spec 6.5). */
export interface ApiBalanceRow {
  employee: { id: string; fullName: string; jobTitle: string | null; hasStartDate: boolean };
  unit: { id: string; name: string } | null;
  managerId: string | null;
  policy: { id: string; name: string };
  figures: ApiBalanceFigures;
}

export interface ApiBalancesTable {
  year: number;
  currentYear: number;
  rows: ApiBalanceRow[];
  canAdjust: boolean;
}

export interface BalancesFilters {
  year?: number;
  unitId?: string;
  managerId?: string;
  policyId?: string;
  expiring?: boolean;
}

const balancesQuery = (f: BalancesFilters) => {
  const q = new URLSearchParams();
  if (f.year) q.set('year', String(f.year));
  if (f.unitId) q.set('unitId', f.unitId);
  if (f.managerId) q.set('managerId', f.managerId);
  if (f.policyId) q.set('policyId', f.policyId);
  if (f.expiring) q.set('expiring', 'true');
  const s = q.toString();
  return s ? `?${s}` : '';
};

export const timeOffApi = {
  balance: (employeeId: string, year?: number) => api<ApiBalance>(`/timeoff/employees/${employeeId}/balance${year ? `?year=${year}` : ''}`),
  adjust: (employeeId: string, body: { poolYear: number; days: number; kind: AdjustmentKind; reason: string }) => api<ApiBalance>(`/timeoff/employees/${employeeId}/adjustments`, { method: 'POST', json: body }),
  balances: (f: BalancesFilters) => api<ApiBalancesTable>(`/timeoff/balances${balancesQuery(f)}`),
  /** The table as a CSV file (the screen hands it to `downloadBlob`). */
  balancesCsv: async (f: BalancesFilters): Promise<Blob> => {
    const res = await authorizedFetch(`/timeoff/balances/csv${balancesQuery(f)}`);
    if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null));
    return res.blob();
  },
  bulkPolicy: (employeeIds: string[], policyId: string) => api<{ changed: number }>('/timeoff/balances/policy', { method: 'POST', json: { employeeIds, policyId } }),
  bulkRecalculate: (employeeIds: string[], year: number) => api<{ changed: number }>('/timeoff/balances/recalculate', { method: 'POST', json: { employeeIds, year } }),
  policies: {
    list: () => api<ApiTimeOffPolicy[]>('/timeoff/policies'),
    create: (input: ApiPolicyInput) => api<ApiTimeOffPolicy>('/timeoff/policies', { method: 'POST', json: input }),
    /** Answers the policy and `recalculated`: how many employees' entitlements changed. */
    update: (id: string, patch: Partial<ApiPolicyInput>) => api<ApiTimeOffPolicy & { recalculated: number }>(`/timeoff/policies/${id}`, { method: 'PATCH', json: patch }),
    remove: (id: string) => api<null>(`/timeoff/policies/${id}`, { method: 'DELETE' }),
    makeDefault: (id: string) => api<ApiTimeOffPolicy>(`/timeoff/policies/${id}/default`, { method: 'POST' }),
    history: (id: string) => api<{ entries: ApiTimeOffHistoryEntry[]; more: boolean }>(`/timeoff/policies/${id}/history`),
  },
  profile: (employeeId: string) => api<ApiTimeOffProfile>(`/timeoff/employees/${employeeId}/profile`),
  updateProfile: (employeeId: string, patch: { policyId?: string; priorExperienceMonths?: number }) => api<ApiTimeOffProfile>(`/timeoff/employees/${employeeId}/profile`, { method: 'PATCH', json: patch }),
  updateEntitlement: (employeeId: string, year: number, body: { individualDays: number; individualReason: string | null }) =>
    api<ApiTimeOffProfile>(`/timeoff/employees/${employeeId}/entitlements/${year}`, { method: 'PATCH', json: body }),
  recalculate: (employeeId: string, year: number, preview: boolean) => api<ApiRecalculation>(`/timeoff/employees/${employeeId}/entitlements/${year}/recalculate`, { method: 'POST', json: { preview } }),
  history: (employeeId: string) => api<{ entries: ApiTimeOffHistoryEntry[]; more: boolean }>(`/timeoff/employees/${employeeId}/history`),
};

/** "20 days + 2 from 5 years, + 4 from 10 years" (the list's Days column). */
export function experienceSummary(rules: ApiExperienceRule[]): string {
  return [...rules]
    .sort((a, b) => a.fromYears - b.fromYears)
    .map((r) => `+${r.extraDays} from ${r.fromYears} ${r.fromYears === 1 ? 'year' : 'years'}`)
    .join(', ');
}

/** "Until 30 June", "Up to 5 days until 30 June" or "Off". */
export function carryOverLabel(p: Pick<ApiTimeOffPolicy, 'carryOver' | 'carryOverCap'>): string {
  if (!p.carryOver) return 'Off';
  return p.carryOverCap === null ? 'Until 30 June' : `Up to ${p.carryOverCap} ${p.carryOverCap === 1 ? 'day' : 'days'} until 30 June`;
}

/** "20 base + 2 experience (5 years) + 3 individual" (an entitlement's parts). */
export function entitlementParts(e: Pick<ApiEntitlement, 'baseDays' | 'experienceDays' | 'experienceYears' | 'individualDays'>): string {
  const parts = [`${e.baseDays} base`];
  if (e.experienceDays) parts.push(`${e.experienceDays} for ${e.experienceYears} ${e.experienceYears === 1 ? 'year' : 'years'} of experience`);
  if (e.individualDays) parts.push(`${e.individualDays} individual`);
  return parts.join(' + ');
}
