/** Time off (milestone 16, `/api/timeoff`): vacation policies and the employee's entitlement (CD-163). */
import { api } from './api';

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

export const timeOffApi = {
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
