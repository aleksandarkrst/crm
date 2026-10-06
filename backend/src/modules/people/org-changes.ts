import { and, eq, inArray } from 'drizzle-orm';
import type { Tx } from '../../shared/database/database.service';
import { employees, orgUnits, tenants } from '../../shared/database/schema';
import type { JobsService } from '../../shared/events/jobs.service';
import { checkLeadMoves } from './heads';
import { type OrgChange, type OrgSnapshot, type PlannedChange, planChanges } from './org-rules';
import { lockReportingLines, type ManagerChange, queueManagerEmails } from './reporting-lines';

/**
 * The database side of the org rules (org-rules.ts, CD-226): read the snapshot under the
 * reporting-line lock, apply the rules, check lead moves (heads.ts), write and queue the "New
 * manager" / "New direct report" emails. Everything in the caller's transaction.
 */

/** The workspace's people, units and CEO. Take the reporting-line lock first (`lockReportingLines`). */
export async function loadOrgSnapshot(tx: Tx, tenantId: string): Promise<OrgSnapshot> {
  const people = await tx
    .select({ id: employees.id, fullName: employees.fullName, managerId: employees.managerId, unitId: employees.unitId, deactivatedAt: employees.deactivatedAt })
    .from(employees);
  const units = await tx.select({ id: orgUnits.id, name: orgUnits.name, parentId: orgUnits.parentId, leadId: orgUnits.leadEmployeeId }).from(orgUnits);
  const [t] = await tx.select({ ceoId: tenants.ceoEmployeeId }).from(tenants).where(eq(tenants.id, tenantId));
  return {
    people: new Map(people.map((p) => [p.id, { id: p.id, fullName: p.fullName, managerId: p.managerId, unitId: p.unitId, active: !p.deactivatedAt }])),
    units: new Map(units.map((u) => [u.id, u])),
    ceoId: t?.ceoId ?? null,
  };
}

export interface WriteOptions {
  jobs: JobsService;
  actorUserId: string | null;
  /** Confirms moving leads out of the unit they lead (heads.ts); otherwise 409 `heads_unit`. */
  clearLeadRoles: boolean;
  /** Who gets the emails (reporting-lines.ts `queueManagerEmails`); false: nobody. */
  emails?: { employee?: boolean; manager?: boolean } | false;
}

export interface WrittenChanges {
  /** Employees whose unit changed. */
  unitChanged: string[];
  managerChanges: ManagerChange[];
  /** Employees with any change. */
  changed: string[];
}

/**
 * Writes planned changes (from `planChanges` on `s`): lead moves first (409 or cleared), then the
 * units and managers in as few statements as there are distinct targets, then the emails.
 */
export async function writeOrgChanges(tx: Tx, tenantId: string, s: OrgSnapshot, planned: readonly PlannedChange[], opts: WriteOptions): Promise<WrittenChanges> {
  await checkLeadMoves(tx, s, planned, opts.clearLeadRoles);
  const groups = new Map<string, { set: Partial<typeof employees.$inferInsert>; ids: string[] }>();
  const unitChanged: string[] = [];
  const managerChanges: ManagerChange[] = [];
  // One net change per person (a bulk list may name someone twice).
  const net = new Map<string, PlannedChange>();
  for (const c of planned) {
    const was = net.get(c.employeeId);
    net.set(c.employeeId, was ? { ...c, fromUnitId: was.fromUnitId, fromManagerId: was.fromManagerId } : c);
  }
  for (const c of net.values()) {
    const set: Partial<typeof employees.$inferInsert> = {};
    if (c.unitId !== c.fromUnitId) {
      set.unitId = c.unitId;
      unitChanged.push(c.employeeId);
    }
    if (c.managerId !== c.fromManagerId) {
      set.managerId = c.managerId;
      managerChanges.push({ employeeId: c.employeeId, oldManagerId: c.fromManagerId, newManagerId: c.managerId });
    }
    if (!Object.keys(set).length) continue;
    const key = JSON.stringify(set);
    const group = groups.get(key);
    if (group) group.ids.push(c.employeeId);
    else groups.set(key, { set, ids: [c.employeeId] });
  }
  for (const { set, ids } of groups.values()) {
    for (let i = 0; i < ids.length; i += 1000) await tx.update(employees).set(set).where(inArray(employees.id, ids.slice(i, i + 1000)));
  }
  if (opts.emails !== false) await queueManagerEmails(opts.jobs, tx, tenantId, opts.actorUserId, managerChanges, opts.emails ?? {});
  const changed = [...new Set([...unitChanged, ...managerChanges.map((m) => m.employeeId)])];
  return { unitChanged, managerChanges, changed };
}

/**
 * The whole path for people's unit and manager changes: the lock, the snapshot, the rules, the
 * lead check and the writes. Who may do it is the caller's check.
 */
export async function changeOrg(tx: Tx, tenantId: string, changes: readonly OrgChange[], opts: WriteOptions): Promise<WrittenChanges & { planned: PlannedChange[] }> {
  await lockReportingLines(tx, tenantId);
  const s = await loadOrgSnapshot(tx, tenantId);
  const planned = planChanges(s, changes);
  return { ...(await writeOrgChanges(tx, tenantId, s, planned, opts)), planned };
}

/** Sets a unit's lead in the database and the snapshot. */
export async function writeLead(tx: Tx, s: OrgSnapshot, unitId: string, leadId: string | null): Promise<void> {
  await tx.update(orgUnits).set({ leadEmployeeId: leadId }).where(and(eq(orgUnits.id, unitId)));
  const unit = s.units.get(unitId);
  if (unit) unit.leadId = leadId;
}
