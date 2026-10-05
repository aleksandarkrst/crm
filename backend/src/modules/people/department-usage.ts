import type { Tx } from '../../shared/database/database.service';

/**
 * What else uses a department (spec 6.3): deleting it is refused while anything does, and the
 * message names it ("used by 2 strategic initiatives"). Projects (14, strategic initiatives) and
 * Planning (21, department plans and KPIs) provide it when they ship, like ABSENCE_SOURCE; until
 * then nothing uses a department.
 */
export interface DepartmentUsage {
  /** Short descriptions of what uses it, e.g. "2 strategic initiatives"; empty when nothing does. */
  usedBy(tx: Tx, tenantId: string, departmentId: string): Promise<string[]>;
}

export const DEPARTMENT_USAGE = Symbol('DEPARTMENT_USAGE');

export const nothingUsesDepartments: DepartmentUsage = { usedBy: async () => [] };
