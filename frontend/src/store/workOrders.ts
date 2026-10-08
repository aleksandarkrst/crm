import type { ApiChecklistItem } from '../lib/tasksApi';
import { type ApiWorkOrder, type WorkOrderFilter, workOrdersApi } from '../lib/workOrdersApi';
import { useProjectsRead } from './projects';

/** Work orders (CD-265) are read on demand and again after any work order change (`s.workOrderRev`). */
export const useWorkOrders = (filter: WorkOrderFilter = {}, enabled = true) =>
  useProjectsRead<ApiWorkOrder[]>(enabled, () => workOrdersApi.list(filter), `work-orders:${JSON.stringify(filter)}`, 'workOrderRev');

/** One work order (its page, CD-266) and its checklist, read again after any work order change. */
export const useWorkOrder = (id: string | undefined) => useProjectsRead<ApiWorkOrder>(!!id, () => workOrdersApi.get(id!), `work-order:${id ?? ''}`, 'workOrderRev');
export const useWorkOrderChecklist = (id: string | undefined) =>
  useProjectsRead<ApiChecklistItem[]>(!!id, () => workOrdersApi.checklist(id!), `work-order-checklist:${id ?? ''}`, 'workOrderRev');

/** "12 Oct, 08:30" for a scheduled work order; nothing when it has no time yet. */
export function scheduledText(w: Pick<ApiWorkOrder, 'scheduledDate' | 'scheduledStart'>): string | null {
  if (!w.scheduledDate) return null;
  const day = new Date(w.scheduledDate + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  return w.scheduledStart ? `${day}, ${w.scheduledStart}` : day;
}
