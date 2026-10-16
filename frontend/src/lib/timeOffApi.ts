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

// ---------------------------------------------------------------- reasons, settings and requests (CD-165)

export type ReasonKind = 'paid_leave' | 'other_absence';
export interface ApiTimeOffReason {
  id: string;
  kind: ReasonKind;
  name: string;
  maxDays: number | null;
  countsTowardLimit: boolean;
  paidByEmployer: boolean;
  active: boolean;
  position: number;
  used: number;
}
export interface ApiTimeOffSettings {
  paidLeaveYearlyLimit: number;
  /** Vacation decision recipients besides the employee (CD-167, spec 12). */
  decisionCopyAdmins: boolean;
  decisionCopyEmails: string[];
}

/** A vacation decision document (CD-167, spec 11): the employee's own and Admins only. */
export interface ApiDecision {
  id: string;
  number: string;
  version: number;
  status: 'queued' | 'running' | 'ready' | 'failed';
  error: string | null;
  state: 'valid' | 'outdated' | 'cancelled' | 'superseded';
  year: number;
  emailedTo: string[] | null;
  emailedAt: string | null;
  acknowledgedAt: string | null;
  createdAt: string;
}

/** One row of the Decisions tab (Admins). */
export interface ApiDecisionRow extends ApiDecision {
  employee: { id: string; fullName: string };
  requestId: string;
  startDate: string;
  endDate: string;
  workingDays: number;
}

export const DECISION_STATE_LABEL: Record<ApiDecision['state'], string> = { valid: 'Valid', outdated: 'Outdated', cancelled: 'Cancelled', superseded: 'Superseded' };

/** "Ready", "Generating", "Failed": where the PDF is. */
export const decisionStatusLabel = (d: Pick<ApiDecision, 'status'>) => (d.status === 'ready' ? 'Ready' : d.status === 'failed' ? 'Failed' : 'Generating');

/** The PDF's download name. */
export const decisionFileName = (d: Pick<ApiDecision, 'number' | 'version'>) => `Resenje-${d.number}${d.version > 1 ? `-v${d.version}` : ''}.pdf`;

export type TimeOffType = 'vacation' | 'paid_leave' | 'unpaid_leave' | 'other_absence';
export const TIME_OFF_TYPE_LABEL: Record<TimeOffType, string> = { vacation: 'Vacation', paid_leave: 'Paid leave', unpaid_leave: 'Unpaid leave', other_absence: 'Other absence' };
export type TimeOffRequestStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn' | 'cancelled';
export const REQUEST_STATUS_LABEL: Record<TimeOffRequestStatus, string> = { pending: 'Pending', approved: 'Approved', rejected: 'Rejected', withdrawn: 'Withdrawn', cancelled: 'Cancelled' };

export interface ApiApproverView {
  kind: 'manager' | 'admins' | 'self';
  reason: string;
  approvers: { userId: string; employeeId: string | null; fullName: string }[];
  selfApproved: boolean;
}

export interface ApiTimeOffRequest {
  id: string;
  employee: { id: string; fullName: string };
  type: TimeOffType;
  reason: { id: string; name: string } | null;
  startDate: string;
  endDate: string;
  workingDays: number;
  note: string | null;
  status: TimeOffRequestStatus;
  submittedBy: { userId: string; name: string } | null;
  submittedAt: string;
  recorded: boolean;
  recordReason: string | null;
  decidedBy: { userId: string; name: string } | null;
  decidedAt: string | null;
  decisionComment: string | null;
  approver: ApiApproverView | null;
  days: { date: string; poolYear: number | null; state: string }[];
  warnings: string[];
  canWithdraw: boolean;
  canCancel: boolean;
  canShorten: boolean;
  /** The vacation decision (CD-167): the employee's own and Admins only. */
  decision: ApiDecision | null;
}

/** One row of the Approvals tab (spec 9.2). */
export interface ApiApprovalRow extends ApiTimeOffRequest {
  balanceAfter: number | null;
  alsoAway: { employeeId: string; fullName: string; what: string; startDate: string; endDate: string; status: 'approved' | 'pending' }[];
  startDatePassed: boolean;
  twoWeekPartMissing: boolean;
}

/** The team calendar (spec 9.5). */
export interface ApiCalendar {
  month: string;
  from: string;
  to: string;
  employees: { id: string; fullName: string; unitName: string | null }[];
  cells: { employeeId: string; date: string; type: TimeOffType; status: 'approved' | 'pending'; requestId: string }[];
  holidays: { date: string; name: string }[];
}

export interface ApiRequestPreview {
  workingDays: number;
  dates: string[];
  excluded: { date: string; name: string }[];
  refusal: { code: string; message: string } | null;
  balance: { before: ApiBalanceFigures; after: ApiBalanceFigures; pools: { poolYear: number; days: number }[] } | null;
  /** Vacation: more days than available; the request can't be submitted. */
  shortfall: { needed: number; available: number } | null;
  warnings: string[];
  approver: ApiApproverView | null;
}

export interface RequestInput {
  employeeId?: string;
  type: TimeOffType;
  reasonId?: string | null;
  startDate: string;
  endDate: string;
}

export interface RequestsFilters {
  employeeId?: string;
  year?: number;
  status?: TimeOffRequestStatus;
  type?: TimeOffType;
  all?: boolean;
}

const requestsQuery = (f: RequestsFilters) => {
  const q = new URLSearchParams();
  if (f.employeeId) q.set('employeeId', f.employeeId);
  if (f.year) q.set('year', String(f.year));
  if (f.status) q.set('status', f.status);
  if (f.type) q.set('type', f.type);
  if (f.all) q.set('all', 'true');
  const s = q.toString();
  return s ? `?${s}` : '';
};

export const timeOffApi = {
  reasons: {
    list: (kind?: ReasonKind) => api<ApiTimeOffReason[]>(`/timeoff/reasons${kind ? `?kind=${kind}` : ''}`),
    create: (input: { kind: ReasonKind; name: string; maxDays?: number | null; countsTowardLimit?: boolean; paidByEmployer?: boolean }) => api<ApiTimeOffReason>('/timeoff/reasons', { method: 'POST', json: input }),
    update: (id: string, patch: Partial<{ name: string; maxDays: number | null; countsTowardLimit: boolean; paidByEmployer: boolean; active: boolean }>) => api<ApiTimeOffReason>(`/timeoff/reasons/${id}`, { method: 'PATCH', json: patch }),
    remove: (id: string) => api<null>(`/timeoff/reasons/${id}`, { method: 'DELETE' }),
  },
  settings: () => api<ApiTimeOffSettings>('/timeoff/settings'),
  updateSettings: (patch: Partial<ApiTimeOffSettings>) => api<ApiTimeOffSettings>('/timeoff/settings', { method: 'PATCH', json: patch }),
  decisions: {
    list: (f: { year?: number; state?: ApiDecision['state'] }) => api<ApiDecisionRow[]>(`/timeoff/decisions?${new URLSearchParams(Object.entries({ year: f.year ? String(f.year) : '', state: f.state ?? '' }).filter(([, v]) => v)).toString()}`),
    pdf: async (id: string): Promise<Blob> => {
      const res = await authorizedFetch(`/timeoff/decisions/${id}/pdf`);
      if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null));
      return res.blob();
    },
    acknowledge: (id: string) => api<ApiDecision>(`/timeoff/decisions/${id}/acknowledge`, { method: 'POST' }),
    regenerate: (id: string, email: boolean) => api<ApiDecision>(`/timeoff/decisions/${id}/regenerate`, { method: 'POST', json: { email } }),
  },
  requests: {
    list: (f: RequestsFilters) => api<ApiTimeOffRequest[]>(`/timeoff/requests${requestsQuery(f)}`),
    get: (id: string) => api<ApiTimeOffRequest & { history: ApiTimeOffHistoryEntry[] }>(`/timeoff/requests/${id}`),
    preview: (input: RequestInput) => api<ApiRequestPreview>('/timeoff/requests/preview', { method: 'POST', json: input }),
    create: (input: RequestInput & { note?: string | null; record?: { reason: string; decision?: boolean } }) => api<ApiTimeOffRequest>('/timeoff/requests', { method: 'POST', json: input }),
    withdraw: (id: string) => api<ApiTimeOffRequest>(`/timeoff/requests/${id}/withdraw`, { method: 'POST' }),
    approve: (id: string, comment?: string | null) => api<ApiTimeOffRequest>(`/timeoff/requests/${id}/approve`, { method: 'POST', json: { comment: comment ?? null } }),
    reject: (id: string, comment: string) => api<ApiTimeOffRequest>(`/timeoff/requests/${id}/reject`, { method: 'POST', json: { comment } }),
    cancel: (id: string, comment?: string | null) => api<ApiTimeOffRequest>(`/timeoff/requests/${id}/cancel`, { method: 'POST', json: { comment: comment ?? null } }),
    shorten: (id: string, endDate: string, comment: string) => api<ApiTimeOffRequest>(`/timeoff/requests/${id}/shorten`, { method: 'POST', json: { endDate, comment } }),
  },
  approvals: {
    list: () => api<ApiApprovalRow[]>('/timeoff/approvals'),
    count: () => api<{ pending: number }>('/timeoff/approvals/count'),
    approveMany: (ids: string[], comment?: string | null) => api<{ approved: string[]; failed: { id: string; message: string }[] }>('/timeoff/approvals/approve', { method: 'POST', json: { ids, comment: comment ?? null } }),
  },
  calendar: (month: string, f: { unitId?: string; managerId?: string } = {}) => {
    const q = new URLSearchParams({ month });
    if (f.unitId) q.set('unitId', f.unitId);
    if (f.managerId) q.set('managerId', f.managerId);
    return api<ApiCalendar>(`/timeoff/calendar?${q.toString()}`);
  },
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
