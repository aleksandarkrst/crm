import type { Tx } from '../../shared/database/database.service';

/**
 * What else uses an org unit (spec 6.3; departments before CD-226): deleting it is refused while
 * anything does, and the message names it ("used by 2 strategic initiatives"). Projects (14,
 * strategic initiatives) and Planning (21, department plans and KPIs) provide it when they ship,
 * like ABSENCE_SOURCE; until then nothing uses a unit.
 */
export interface UnitUsage {
  /** Short descriptions of what uses it, e.g. "2 strategic initiatives"; empty when nothing does. */
  usedBy(tx: Tx, tenantId: string, unitId: string): Promise<string[]>;
}

export const UNIT_USAGE = Symbol('UNIT_USAGE');

export const nothingUsesUnits: UnitUsage = { usedBy: async () => [] };
