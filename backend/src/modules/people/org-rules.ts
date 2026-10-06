import { BadRequestException, ConflictException } from '@nestjs/common';
import { loopMessage } from './reporting-lines';

/**
 * Automatic managers and units (CD-226), as pure functions over a snapshot of the org taken under
 * the reporting-line lock (`org-changes.ts` reads it and writes the result). Every path that changes
 * a unit, a manager or a lead goes through them: the card's PATCH, the list's bulk actions, "Add
 * people", the chart's drag, unit lead changes, deactivation and the CEO setting.
 *
 * - `managerForUnit`: the unit's lead (unless that is the person), else the nearest lead above,
 *   else the CEO; never the person, never a loop; null when there is nobody.
 * - Unit set: the manager becomes `managerForUnit` (kept when there is nobody), unless the same
 *   change sets a manager too: the explicit choice wins.
 * - Manager set: the unit becomes the one the manager leads, else the manager's own unit (kept when
 *   the manager has none, and for someone who leads a unit), unless the same change sets a unit too.
 * - Lead set (`planLead`): the lead joins the unit and reports to the nearest lead above, else the
 *   CEO; members of the unit and leads of its units right below who reported to the previous lead,
 *   or to nobody, now report to the new lead (someone for whom that would close a loop keeps their
 *   manager and is listed).
 * - CEO set (`planCeo`): leads of units directly under the company who have no manager report to
 *   the CEO.
 * The CEO never gets a manager automatically.
 */

export interface OrgPerson {
  id: string;
  fullName: string;
  managerId: string | null;
  unitId: string | null;
  active: boolean;
}

export interface OrgUnitNode {
  id: string;
  name: string;
  parentId: string | null;
  leadId: string | null;
}

/** The workspace's people (every record, inactive ones too, for the loop walk), units and CEO. */
export interface OrgSnapshot {
  people: Map<string, OrgPerson>;
  units: Map<string, OrgUnitNode>;
  ceoId: string | null;
}

/** A requested change of one person: `undefined` leaves that part to the rules. */
export interface OrgChange {
  employeeId: string;
  unitId?: string | null;
  managerId?: string | null;
}

/** What a change ends up as, after the rules. */
export interface PlannedChange {
  employeeId: string;
  fromUnitId: string | null;
  unitId: string | null;
  fromManagerId: string | null;
  managerId: string | null;
}

/** Someone a lead change leaves alone: reporting to the lead would close a loop. */
export interface LoopSkip {
  id: string;
  fullName: string;
  message: string;
}

export const cloneSnapshot = (s: OrgSnapshot): OrgSnapshot => ({
  people: new Map([...s.people].map(([k, v]) => [k, { ...v }])),
  units: new Map([...s.units].map(([k, v]) => [k, { ...v }])),
  ceoId: s.ceoId,
});

const isActive = (s: OrgSnapshot, id: string | null | undefined): id is string => !!id && !!s.people.get(id)?.active;

/** The unit someone leads (a person leads at most one). */
export function unitLedBy(s: OrgSnapshot, personId: string): OrgUnitNode | null {
  for (const u of s.units.values()) if (u.leadId === personId) return u;
  return null;
}

/** The units above `unitId`, nearest first (the unit itself not included). */
export function ancestorsOf(s: OrgSnapshot, unitId: string | null): OrgUnitNode[] {
  const out: OrgUnitNode[] = [];
  let at = unitId ? (s.units.get(unitId)?.parentId ?? null) : null;
  while (at && out.length < 100) {
    const u = s.units.get(at);
    if (!u || out.includes(u)) break;
    out.push(u);
    at = u.parentId;
  }
  return out;
}

/** `unitId` and every unit inside it, at any depth. */
export function unitAndBelow(s: OrgSnapshot, unitId: string): Set<string> {
  const out = new Set([unitId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const u of s.units.values()) {
      if (u.parentId && out.has(u.parentId) && !out.has(u.id)) {
        out.add(u.id);
        grew = true;
      }
    }
  }
  return out;
}

/**
 * The loop `managerId` would close for `employeeId`, as assertValidManager names it ("Ana → Marko →
 * Ana"), or null. It walks up from the manager; reaching the employee is a loop.
 */
export function loopPath(s: OrgSnapshot, employeeId: string, managerId: string | null): string[] | null {
  if (!managerId) return null;
  const chain: string[] = [];
  let at: string | null = managerId;
  const seen = new Set<string>();
  while (at && !seen.has(at) && chain.length < 1000) {
    seen.add(at);
    const p = s.people.get(at);
    chain.push(p?.fullName ?? 'Someone');
    if (at === employeeId) return [s.people.get(employeeId)?.fullName ?? 'This employee', ...chain];
    at = p?.managerId ?? null;
  }
  return null;
}

/** Whether `managerId` may be `employeeId`'s manager: active, not themselves, no loop. */
const fits = (s: OrgSnapshot, employeeId: string, managerId: string) => managerId !== employeeId && isActive(s, managerId) && !loopPath(s, employeeId, managerId);

/** The first of `candidates` that fits, or null. The CEO never gets a manager this way. */
function firstFitting(s: OrgSnapshot, personId: string, candidates: (string | null)[]): string | null {
  if (personId === s.ceoId) return null;
  for (const c of candidates) if (c && fits(s, personId, c)) return c;
  return null;
}

/** The unit's lead, else the nearest lead above, else the CEO; never the person, never a loop. */
export function managerForUnit(s: OrgSnapshot, unitId: string, personId: string): string | null {
  const unit = s.units.get(unitId);
  if (!unit) return null;
  return firstFitting(s, personId, [unit.leadId, ...ancestorsOf(s, unitId).map((u) => u.leadId), s.ceoId]);
}

/** A lead's manager: the nearest lead above their unit, else the CEO. */
export function managerForLead(s: OrgSnapshot, unitId: string, leadId: string): string | null {
  return firstFitting(s, leadId, [...ancestorsOf(s, unitId).map((u) => u.leadId), s.ceoId]);
}

/** The unit someone joins when they get `managerId`: the one the manager leads, else the manager's own. */
export function unitForManager(s: OrgSnapshot, managerId: string): string | null {
  return unitLedBy(s, managerId)?.id ?? s.people.get(managerId)?.unitId ?? null;
}

/** Refuses a manager the way assertValidManager does (400 yourself or not active, 409 a loop). */
export function assertManagerFits(s: OrgSnapshot, employeeId: string, managerId: string | null): void {
  if (!managerId) return;
  if (managerId === employeeId) throw new BadRequestException("An employee can't report to themselves");
  const m = s.people.get(managerId);
  if (!m) throw new BadRequestException('The manager must be an employee of this workspace');
  if (!m.active) throw new BadRequestException('The manager must be an active employee: this person has left the company');
  const loop = loopPath(s, employeeId, managerId);
  if (loop) throw new ConflictException({ statusCode: 409, error: 'Conflict', code: 'reporting_loop', message: loopMessage(loop) });
}

/**
 * Applies the rules to `changes`, one after the other on a copy of the snapshot (so a bulk change
 * is checked against what it has changed already), and returns the result per person, changed or
 * not. Refuses (exceptions) unknown units, people who left and invalid explicit managers. Only a
 * unit that actually changes brings a new manager, and only an explicit manager brings a new unit.
 * `s` is updated to the state after the changes.
 */
export function planChanges(s: OrgSnapshot, changes: readonly OrgChange[]): PlannedChange[] {
  const out: PlannedChange[] = [];
  for (const c of changes) {
    const p = s.people.get(c.employeeId);
    if (!p) throw new BadRequestException('Employee not found');
    if (!p.active) throw new BadRequestException(`${p.fullName} has left the company`);
    if (c.unitId && !s.units.has(c.unitId)) throw new BadRequestException('Unit not found');
    const before = { unitId: p.unitId, managerId: p.managerId };

    let unitId = p.unitId;
    if (c.unitId !== undefined) unitId = c.unitId;
    // A lead stays in the unit they lead whoever they report to.
    else if (c.managerId && !unitLedBy(s, p.id)) unitId = unitForManager(s, c.managerId) ?? p.unitId;

    let managerId = p.managerId;
    if (c.managerId !== undefined) {
      managerId = c.managerId;
      if (managerId !== p.managerId) assertManagerFits(s, p.id, managerId);
    } else if (c.unitId !== undefined && unitId && unitId !== p.unitId) {
      managerId = managerForUnit(s, unitId, p.id) ?? p.managerId;
    }

    p.unitId = unitId;
    p.managerId = managerId;
    out.push({ employeeId: p.id, fromUnitId: before.unitId, unitId, fromManagerId: before.managerId, managerId });
  }
  return out;
}

/**
 * A new lead of `unitId` (CD-226): the lead joins the unit and reports to the nearest lead above,
 * else the CEO; members of the unit and leads of the units right below it who reported to the
 * previous lead or to nobody now report to the new lead. Returns explicit changes for
 * `planChanges` and who keeps their manager because of a loop. Nothing changes for `null` (no lead).
 */
export function planLead(s: OrgSnapshot, unitId: string, leadId: string | null): { changes: OrgChange[]; loops: LoopSkip[] } {
  const unit = s.units.get(unitId);
  if (!unit || !leadId) return { changes: [], loops: [] };
  const previous = unit.leadId;
  const work = cloneSnapshot(s);
  const lead = work.people.get(leadId);
  if (!lead) throw new BadRequestException('The lead must be an employee of this workspace');
  // The lead leaves any unit they led (the caller confirmed it) and leads this one.
  for (const u of work.units.values()) if (u.leadId === leadId) u.leadId = null;
  work.units.get(unitId)!.leadId = leadId;

  const changes: OrgChange[] = [];
  const own = managerForLead(work, unitId, leadId);
  const leadChange: OrgChange = { employeeId: leadId, unitId, managerId: own ?? lead.managerId };
  changes.push(leadChange);
  lead.unitId = unitId;
  lead.managerId = leadChange.managerId!;

  const loops: LoopSkip[] = [];
  const childLeads = new Set([...work.units.values()].filter((u) => u.parentId === unitId && u.leadId).map((u) => u.leadId!));
  const members = [...work.people.values()]
    .filter((p) => p.active && p.id !== leadId && p.id !== work.ceoId && (p.unitId === unitId || childLeads.has(p.id)))
    .filter((p) => p.managerId === null || (previous !== null && p.managerId === previous))
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
  for (const m of members) {
    const loop = loopPath(work, m.id, leadId);
    if (loop) {
      loops.push({ id: m.id, fullName: m.fullName, message: loopMessage(loop) });
      continue;
    }
    m.managerId = leadId;
    changes.push({ employeeId: m.id, managerId: leadId });
  }
  return { changes, loops };
}

/** A new CEO: leads of units directly under the company who have no manager report to them. */
export function planCeo(s: OrgSnapshot, ceoId: string | null): OrgChange[] {
  if (!isActive(s, ceoId)) return [];
  const work = cloneSnapshot(s);
  work.ceoId = ceoId;
  const out: OrgChange[] = [];
  for (const u of work.units.values()) {
    if (u.parentId || !u.leadId || u.leadId === ceoId) continue;
    const lead = work.people.get(u.leadId);
    if (!lead?.active || lead.managerId || !fits(work, lead.id, ceoId)) continue;
    lead.managerId = ceoId;
    out.push({ employeeId: lead.id, managerId: ceoId });
  }
  return out;
}

/**
 * A unit moved under another parent: its lead, if they reported to the nearest lead above (or to
 * nobody), now reports to the nearest lead above the new place. `before` is the snapshot before
 * the move, `after` with the unit moved.
 */
export function planUnitMoved(before: OrgSnapshot, after: OrgSnapshot, unitId: string): OrgChange[] {
  const leadId = after.units.get(unitId)?.leadId;
  if (!leadId || !isActive(after, leadId)) return [];
  const lead = after.people.get(leadId)!;
  const was = managerForLead(before, unitId, leadId);
  if (lead.managerId !== null && lead.managerId !== was) return [];
  const next = managerForLead(after, unitId, leadId);
  return next && next !== lead.managerId ? [{ employeeId: leadId, managerId: next }] : [];
}
