/** Work orders (CD-265, `/api/work-orders`). Every member sees every work order. */
import { api } from './api';
import type { ApiChecklistItem } from './tasksApi';

export type WorkOrderStatus = 'unscheduled' | 'scheduled' | 'in_progress' | 'on_hold' | 'completed';
/** The kanban columns, in order (design v2 §5). */
export const WORK_ORDER_STATUSES: { id: WorkOrderStatus; label: string; dot: string }[] = [
  { id: 'unscheduled', label: 'Unscheduled', dot: '#93A39B' },
  { id: 'scheduled', label: 'Scheduled', dot: '#2F6FB5' },
  { id: 'in_progress', label: 'In progress', dot: '#14503C' },
  { id: 'on_hold', label: 'On hold', dot: '#B42318' },
  { id: 'completed', label: 'Completed', dot: '#3E8E6A' },
];
export const workOrderStatusLabel = (s: WorkOrderStatus) => WORK_ORDER_STATUSES.find((x) => x.id === s)!.label;

export type WorkOrderType = 'installation' | 'repair' | 'maintenance' | 'inspection';
export const WORK_ORDER_TYPE_LABEL: Record<WorkOrderType, string> = { installation: 'Installation', repair: 'Repair', maintenance: 'Maintenance', inspection: 'Inspection' };
export type WorkOrderPriority = 'normal' | 'urgent';
/** Where the work is done (CD-266). */
export type WorkOrderPlace = 'customer' | 'workshop';
export const WORK_ORDER_PLACE_LABEL: Record<WorkOrderPlace, string> = { customer: 'At the customer', workshop: 'In the workshop' };
/** The On hold dialog's presets (design v2 §6); any other text works too. */
export const WORK_ORDER_HOLD_REASONS = ['Waiting for parts', 'Waiting for the customer', 'Site not accessible', 'Needs a second technician'] as const;

export interface ApiWorkOrderTechnician {
  employeeId: string;
  name: string;
  jobTitle: string | null;
  isLead: boolean;
}

export interface ApiWorkOrder {
  id: string;
  number: number;
  title: string;
  companyId: string;
  companyName: string;
  projectId: string | null;
  projectName: string | null;
  projectCode: string | null;
  type: WorkOrderType;
  priority: WorkOrderPriority;
  status: WorkOrderStatus;
  holdReason: string | null;
  scheduledDate: string | null;
  /** "HH:MM". */
  scheduledStart: string | null;
  durationHours: number;
  location: string | null;
  workPlace: WorkOrderPlace;
  equipment: string | null;
  job: string | null;
  /** Report and sign-off (CD-266). */
  report: string | null;
  materials: string | null;
  customerName: string | null;
  signedOffAt: string | null;
  signedOffByName: string | null;
  completedAt: string | null;
  createdAt: string;
  version: string;
  technicians: ApiWorkOrderTechnician[];
  canChange: boolean;
  /** CD-148: the technicians, the project lead, owners and admins change the status (Reopen included). */
  canSetStatus: boolean;
  /** Completed: nothing changes until it is reopened. */
  locked: boolean;
  canDelete: boolean;
}

export interface NewWorkOrderInput {
  title: string;
  companyId: string;
  projectId?: string | null;
  type?: WorkOrderType;
  priority?: WorkOrderPriority;
  /** The first is the lead. */
  technicianIds?: string[];
  scheduledDate?: string | null;
  scheduledStart?: string | null;
  durationHours?: number;
  location?: string | null;
  job?: string | null;
}

export type WorkOrderPatch = Partial<{
  title: string;
  projectId: string | null;
  type: WorkOrderType;
  priority: WorkOrderPriority;
  status: WorkOrderStatus;
  holdReason: string;
  technicianIds: string[];
  scheduledDate: string | null;
  scheduledStart: string | null;
  durationHours: number;
  location: string | null;
  equipment: string | null;
  job: string | null;
  workPlace: WorkOrderPlace;
  report: string | null;
  materials: string | null;
  customerName: string | null;
  /** Needs the customer's name. */
  signedOff: boolean;
}>;

export interface WorkOrderFilter {
  projectId?: string;
  companyId?: string;
  /** An employee id, or `me`. */
  technicianId?: string;
  status?: WorkOrderStatus;
  q?: string;
}

/** "WO-1044". */
export const workOrderId = (w: { number: number }) => `WO-${w.number}`;

/** 1.5 → "1 h 30 min", 2 → "2 h", 0.25 → "15 min" (design v2: durations on work orders). */
export function durationText(h: number): string {
  const mins = Math.round(h * 60);
  const hh = Math.floor(mins / 60);
  const mm = mins % 60;
  return [hh ? `${hh} h` : '', mm ? `${mm} min` : ''].filter(Boolean).join(' ');
}

/** The API's rule for durations: 0.25 to 99 h in quarter hours; null when fine. */
export function durationError(n: number): string | null {
  if (!Number.isFinite(n) || n < 0.25) return 'At least 0.25 h';
  if (n > 99) return 'At most 99 h';
  if (!Number.isInteger(n * 4)) return 'Use steps of 0.25 h (a quarter of an hour)';
  return null;
}

export const workOrdersApi = {
  list: (filter: WorkOrderFilter = {}) => {
    const q = new URLSearchParams(Object.entries(filter).filter((e): e is [string, string] => !!e[1]));
    return api<ApiWorkOrder[]>('/work-orders' + (q.size ? `?${q}` : ''));
  },
  get: (id: string) => api<ApiWorkOrder>(`/work-orders/${id}`),
  create: (input: NewWorkOrderInput) => api<ApiWorkOrder>('/work-orders', { method: 'POST', json: input }),
  update: (id: string, patch: WorkOrderPatch) => api<ApiWorkOrder>(`/work-orders/${id}`, { method: 'PATCH', json: patch }),
  remove: (id: string) => api<null>(`/work-orders/${id}`, { method: 'DELETE' }),
  // The checklist (CD-266): each change answers with the whole list.
  checklist: (id: string) => api<ApiChecklistItem[]>(`/work-orders/${id}/checklist`),
  addItem: (id: string, text: string) => api<ApiChecklistItem[]>(`/work-orders/${id}/checklist`, { method: 'POST', json: { text } }),
  updateItem: (id: string, itemId: string, patch: { text?: string; done?: boolean }) => api<ApiChecklistItem[]>(`/work-orders/${id}/checklist/${itemId}`, { method: 'PATCH', json: patch }),
  removeItem: (id: string, itemId: string) => api<ApiChecklistItem[]>(`/work-orders/${id}/checklist/${itemId}`, { method: 'DELETE' }),
};
