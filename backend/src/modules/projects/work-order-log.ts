import { and, eq } from 'drizzle-orm';
import type { Tx } from '../../shared/database/database.service';
import { workOrders, workOrderTechnicians } from '../../shared/database/schema';

/**
 * Who may log time on a work order (CD-148): the rule milestone 15's timesheets use for work
 * orders, as `canLogTime` (task-log.ts) is for tasks. Call it inside `DatabaseService.withTenant`.
 * The database trigger on time entries that enforces the same lock comes with milestone 15.
 */

export type WorkOrderLogRefusal = 'not_found' | 'not_technician' | 'completed';

/** Pure: a technician on the order, which isn't Completed (unit-tested). */
export function workOrderLogRefusal(facts: { status: string; isTechnician: boolean } | null): WorkOrderLogRefusal | null {
  if (!facts) return 'not_found';
  if (!facts.isTechnician) return 'not_technician';
  if (facts.status === 'completed') return 'completed';
  return null;
}

export async function workOrderLogRefusalFor(tx: Tx, employeeId: string, workOrderId: string): Promise<WorkOrderLogRefusal | null> {
  const [row] = await tx
    .select({ status: workOrders.status, technician: workOrderTechnicians.employeeId })
    .from(workOrders)
    .leftJoin(workOrderTechnicians, and(eq(workOrderTechnicians.workOrderId, workOrders.id), eq(workOrderTechnicians.employeeId, employeeId)))
    .where(eq(workOrders.id, workOrderId));
  return workOrderLogRefusal(row ? { status: row.status, isTechnician: row.technician !== null } : null);
}

/** Whether `employeeId` may log time on `workOrderId` now. */
export async function canLogWorkOrderTime(tx: Tx, employeeId: string, workOrderId: string): Promise<boolean> {
  return (await workOrderLogRefusalFor(tx, employeeId, workOrderId)) === null;
}
