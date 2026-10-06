import { ConflictException } from '@nestjs/common';
import { inArray } from 'drizzle-orm';
import type { Tx } from '../../shared/database/database.service';
import { orgUnits } from '../../shared/database/schema';
import { type OrgSnapshot, type PlannedChange, unitLedBy } from './org-rules';

/**
 * Leads belong to the unit they lead (CD-225 for departments and teams, CD-226 for units): a new
 * lead joins the unit (org-rules `planLead`), and moving a lead somewhere else (the card, the bulk
 * actions, "Add people", the chart's drag, or leading another unit) would end that role, so it is
 * refused with 409 `heads_unit` naming the roles, unless the caller sends `clearLeadRoles: true`;
 * then the roles are cleared in the same transaction. History rows come from the triggers.
 */

/** A lead about to leave the unit they lead. */
export interface LostLead {
  employeeId: string;
  fullName: string;
  unit: { id: string; name: string };
  toUnitId: string | null;
}

/** The planned changes that move a lead out of the unit they lead. */
export function lostLeads(s: OrgSnapshot, planned: readonly PlannedChange[]): LostLead[] {
  const out: LostLead[] = [];
  for (const c of planned) {
    if (c.unitId === c.fromUnitId) continue;
    const led = unitLedBy(s, c.employeeId);
    if (led && led.id !== c.unitId) out.push({ employeeId: c.employeeId, fullName: s.people.get(c.employeeId)?.fullName ?? 'Someone', unit: { id: led.id, name: led.name }, toUnitId: c.unitId });
  }
  return out;
}

/** "Ana Petrović is lead of Sales. Moving them to Service removes them as lead of Sales (and 2 more)." */
export function leadMoveMessage(s: OrgSnapshot, lost: readonly LostLead[]): string {
  const first = lost[0]!;
  const to = first.toUnitId ? s.units.get(first.toUnitId)?.name : null;
  const more = lost.length > 1 ? ` (and ${lost.length - 1} more)` : '';
  return `${first.fullName} is lead of ${first.unit.name}. Moving them ${to ? `to ${to}` : 'out of their unit'} removes them as lead of ${first.unit.name}${more}.`;
}

/**
 * Before writing: refuses (409 `heads_unit`) when a change would move a lead out of the unit they
 * lead, unless `clear`; with `clear`, removes them as lead (in the database and in `s`).
 */
export async function checkLeadMoves(tx: Tx, s: OrgSnapshot, planned: readonly PlannedChange[], clear: boolean): Promise<void> {
  const lost = lostLeads(s, planned);
  if (!lost.length) return;
  if (!clear) {
    throw new ConflictException({
      statusCode: 409,
      error: 'Conflict',
      code: 'heads_unit',
      message: leadMoveMessage(s, lost),
      people: lost.map((l) => ({ employeeId: l.employeeId, fullName: l.fullName, roles: [{ kind: 'unit', id: l.unit.id, name: l.unit.name }] })),
    });
  }
  const ids = lost.map((l) => l.unit.id);
  await tx.update(orgUnits).set({ leadEmployeeId: null }).where(inArray(orgUnits.id, ids));
  for (const id of ids) s.units.get(id)!.leadId = null;
}
