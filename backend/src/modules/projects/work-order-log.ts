import { and, asc, eq, isNull, ne, or } from 'drizzle-orm';
import type { Tx } from '../../shared/database/database.service';
import { companies, projects, workOrders, workOrderTechnicians } from '../../shared/database/schema';

/**
 * Who may log time on a work order (CD-148): the rule milestone 15's timesheets use for work
 * orders, as `canLogTime` (task-log.ts) is for tasks. Call it inside `DatabaseService.withTenant`.
 * The trigger on time entries (drizzle/0077_timesheet_rls.sql) enforces the same lock.
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

/**
 * The work orders `employeeId` can log time on now (the Timesheet's picker, CD-152): they are a
 * technician on it, it isn't Completed, and its project (if any) is open. By number.
 */
export function loggableWorkOrders(tx: Tx, employeeId: string) {
  return tx
    .select({
      id: workOrders.id,
      number: workOrders.number,
      title: workOrders.title,
      status: workOrders.status,
      companyName: companies.name,
      projectId: projects.id,
      projectName: projects.name,
    })
    .from(workOrderTechnicians)
    .innerJoin(workOrders, eq(workOrders.id, workOrderTechnicians.workOrderId))
    .innerJoin(companies, eq(companies.id, workOrders.companyId))
    .leftJoin(projects, eq(projects.id, workOrders.projectId))
    .where(and(eq(workOrderTechnicians.employeeId, employeeId), ne(workOrders.status, 'completed'), or(isNull(workOrders.projectId), eq(projects.status, 'open'))))
    .orderBy(asc(workOrders.number));
}
