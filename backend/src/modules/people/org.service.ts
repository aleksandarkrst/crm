import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, gt, gte, isNull, type SQL, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { AuditService } from '../../shared/audit/audit.service';
import type { TenantContext } from '../../shared/authorization';
import { DatabaseService, type Tx } from '../../shared/database/database.service';
import { mapDbError } from '../../shared/database/errors';
import { employees, MAX_ORG_LEVELS, orgLevels, orgUnits } from '../../shared/database/schema';
import { JobsService } from '../../shared/events/jobs.service';
import type { CallerAccess } from './caller-access';
import { shownEmployee } from './employees.service';
import { lostLeads } from './heads';
import { changeOrg, loadOrgSnapshot, writeLead, writeOrgChanges } from './org-changes';
import { cloneSnapshot, type LoopSkip, planCeo, planChanges, planLead, planUnitMoved, unitAndBelow } from './org-rules';
import type { Assign, CreateLevel, CreateUnit, ReorderLevels, SetReportingLines, UpdateLevel, UpdateUnit } from './org.schemas';
import { PeopleAccess } from './people-access';
import { lockReportingLines } from './reporting-lines';
import { UNIT_USAGE, type UnitUsage } from './unit-usage';

const lead = alias(employees, 'lead');

/** Active people the app shows (CD-226), as counted in the units. */
const memberCount = sql<number>`(select count(*)::int from ${employees} e where e.unit_id = ${orgUnits.id} and e.deactivated_at is null and (e.user_id is not null or exists (select 1 from invitations i where i.employee_id = e.id and i.accepted_at is null and i.revoked_at is null and i.expires_at > now())))`;

const levelColumns = {
  id: orgLevels.id,
  name: orgLevels.name,
  position: orgLevels.position,
  version: orgLevels.updatedAt,
  // Qualified by hand: a select from one table renders its columns without the table name.
  units: sql<number>`(select count(*)::int from ${orgUnits} u where u.level_id = "org_levels"."id")`,
};

const unitColumns = {
  id: orgUnits.id,
  levelId: orgUnits.levelId,
  parentId: orgUnits.parentId,
  name: orgUnits.name,
  code: orgUnits.code,
  leadEmployeeId: orgUnits.leadEmployeeId,
  leadName: lead.fullName,
  version: orgUnits.updatedAt,
  /** Active members (the people the app shows), not counting units inside. */
  members: memberCount,
  /** Units right inside it. */
  units: sql<number>`(select count(*)::int from ${orgUnits} c where c.parent_id = ${orgUnits.id})`,
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const listNames = (names: string[]) => (names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);

/** The default levels of a workspace (CD-226). */
const DEFAULT_LEVELS = ['Department', 'Team'];

/**
 * Makes the default levels when the workspace has none yet (workspaces made after drizzle/0048 got
 * none from the migration). Concurrent first reads may both try: the name index lets one win.
 */
export async function ensureLevels(tx: Tx, tenantId: string): Promise<void> {
  const [any] = await tx.select({ id: orgLevels.id }).from(orgLevels).limit(1);
  if (any) return;
  await tx
    .insert(orgLevels)
    .values(DEFAULT_LEVELS.map((name, i) => ({ tenantId, name, position: i + 1 })))
    .onConflictDoNothing();
}

/**
 * The CEO rule (CD-226): when the CEO is set, leads of units directly under the company who have
 * no manager report to the CEO. Called by Settings (PATCH /api/workspace) in its transaction, after
 * saving the CEO. Emails as every in-app manager change.
 */
export async function applyCeoRule(tx: Tx, jobs: JobsService, tenantId: string, actorUserId: string | null, ceoId: string | null): Promise<void> {
  if (!ceoId) return;
  await lockReportingLines(tx, tenantId);
  const s = await loadOrgSnapshot(tx, tenantId);
  s.ceoId = ceoId;
  const planned = planChanges(s, planCeo(s, ceoId));
  await writeOrgChanges(tx, tenantId, s, planned, { jobs, actorUserId, clearLeadRoles: false });
}

/**
 * Organization levels and units (CD-226; departments and teams before, CD-138, CD-139) and the
 * org changes of people ("Add people", "Set manager"). Reading is for every member; every change is
 * for Admins (403 otherwise). Managers and units follow the rules of org-rules.ts; changes take the
 * reporting-line lock and queue the "New manager" / "New direct report" emails. Live updates come
 * from the tables' triggers.
 */
@Injectable()
export class OrgService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: PeopleAccess,
    private readonly audit: AuditService,
    private readonly jobs: JobsService,
    @Inject(UNIT_USAGE) private readonly usage: UnitUsage,
  ) {}

  // ------------------------------------------------------------------ levels

  /** The levels top-down: `{ id, name, position, version, units }[]`. */
  levels(ctx: TenantContext) {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      await ensureLevels(tx, ctx.tenantId);
      return this.levelRows(tx);
    });
  }

  private levelRows(tx: Tx) {
    return tx.select(levelColumns).from(orgLevels).orderBy(asc(orgLevels.position), asc(orgLevels.name));
  }

  /** A new level at `position` (default: the bottom); the ones from there move down. At most five. */
  createLevel(ctx: TenantContext, input: CreateLevel) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        await this.hr(tx, ctx);
        await lockLevels(tx, ctx.tenantId);
        await ensureLevels(tx, ctx.tenantId);
        const levels = await this.levelRows(tx);
        if (levels.length >= MAX_ORG_LEVELS) throw new ConflictException(`A workspace has at most ${MAX_ORG_LEVELS} levels`);
        const position = Math.min(input.position ?? levels.length + 1, levels.length + 1);
        await tx.update(orgLevels).set({ position: sql`${orgLevels.position} + 1` }).where(gte(orgLevels.position, position));
        const [row] = await tx.insert(orgLevels).values({ tenantId: ctx.tenantId, name: input.name, position }).returning({ id: orgLevels.id });
        await this.audit.record(tx, ctx, { action: 'org_level.created', entityType: 'org_level', entityId: row!.id, data: { name: input.name, position } });
        return this.levelRows(tx);
      })
      .catch(mapDbError);
  }

  renameLevel(ctx: TenantContext, id: string, input: UpdateLevel) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        await this.hr(tx, ctx);
        const [row] = await tx.update(orgLevels).set({ name: input.name }).where(eq(orgLevels.id, id)).returning({ id: orgLevels.id });
        if (!row) throw new NotFoundException('Level not found');
        await this.audit.record(tx, ctx, { action: 'org_level.renamed', entityType: 'org_level', entityId: id, data: { name: input.name } });
        return this.levelRows(tx);
      })
      .catch(mapDbError);
  }

  /**
   * New order of the levels (every id, top-down). Refused (409) when a unit would then be inside a
   * unit of the same or a lower level, naming one.
   */
  reorderLevels(ctx: TenantContext, input: ReorderLevels) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        await this.hr(tx, ctx);
        await lockLevels(tx, ctx.tenantId);
        const levels = await this.levelRows(tx);
        const ids = new Set(input.ids);
        if (ids.size !== input.ids.length || ids.size !== levels.length || levels.some((l) => !ids.has(l.id))) throw new BadRequestException('Send every level once, top-down');
        const next = new Map(input.ids.map((id, i) => [id, i + 1]));
        const parent = alias(orgUnits, 'parent');
        const pairs = await tx
          .select({ name: orgUnits.name, levelId: orgUnits.levelId, parentName: parent.name, parentLevelId: parent.levelId })
          .from(orgUnits)
          .innerJoin(parent, eq(parent.id, orgUnits.parentId));
        const broken = pairs.find((p) => next.get(p.parentLevelId)! >= next.get(p.levelId)!);
        if (broken) {
          const name = (id: string) => levels.find((l) => l.id === id)?.name ?? 'level';
          throw new ConflictException(`${broken.name} is inside ${broken.parentName}, so ${name(broken.levelId)} must stay below ${name(broken.parentLevelId)}. Move the unit first.`);
        }
        for (const l of levels) {
          const position = next.get(l.id)!;
          if (position !== l.position) await tx.update(orgLevels).set({ position }).where(eq(orgLevels.id, l.id));
        }
        await this.audit.record(tx, ctx, { action: 'org_level.reordered', entityType: 'org_level', data: { ids: input.ids } });
        return this.levelRows(tx);
      })
      .catch(mapDbError);
  }

  /** Only a level without units, and never the last one. The levels below move up. */
  deleteLevel(ctx: TenantContext, id: string) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        await this.hr(tx, ctx);
        await lockLevels(tx, ctx.tenantId);
        const levels = await this.levelRows(tx);
        const level = levels.find((l) => l.id === id);
        if (!level) throw new NotFoundException('Level not found');
        if (level.units) throw new ConflictException(`${level.name} has ${plural(level.units, 'unit')}. Delete them or move them first.`);
        if (levels.length === 1) throw new ConflictException('Keep at least one level');
        await tx.delete(orgLevels).where(eq(orgLevels.id, id));
        await tx.update(orgLevels).set({ position: sql`${orgLevels.position} - 1` }).where(gt(orgLevels.position, level.position));
        await this.audit.record(tx, ctx, { action: 'org_level.deleted', entityType: 'org_level', entityId: id, data: { name: level.name } });
        return this.levelRows(tx);
      })
      .catch(mapDbError);
  }

  // ------------------------------------------------------------------ units

  /** Every unit by name: `{ id, levelId, parentId, name, code, leadEmployeeId, leadName, version, members, units }[]`. */
  units(ctx: TenantContext) {
    return this.database.withTenant(ctx.tenantId, (tx) => this.unitRows(tx));
  }

  private unitRows(tx: Tx, where?: SQL) {
    return tx
      .select(unitColumns)
      .from(orgUnits)
      .leftJoin(lead, eq(lead.id, orgUnits.leadEmployeeId))
      .where(where)
      .orderBy(asc(sql`lower(${orgUnits.name})`), asc(orgUnits.id));
  }

  private async unit(tx: Tx, id: string) {
    const [row] = await this.unitRows(tx, eq(orgUnits.id, id));
    return row!;
  }

  /**
   * A unit of a level, inside a unit of a higher level or directly under the company. A lead joins
   * it and reports to the nearest lead above, else the CEO (org-rules `planLead`). Returns `{ unit,
   * managersChanged, loops }`.
   */
  createUnit(ctx: TenantContext, input: CreateUnit) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        await this.hr(tx, ctx);
        await lockReportingLines(tx, ctx.tenantId);
        await ensureLevels(tx, ctx.tenantId);
        await this.checkPlace(tx, input.levelId, input.parentId ?? null, null);
        const [row] = await tx
          .insert(orgUnits)
          .values({ tenantId: ctx.tenantId, levelId: input.levelId, parentId: input.parentId ?? null, name: input.name, code: input.code ?? null })
          .returning({ id: orgUnits.id });
        const id = row!.id;
        const result = input.leadEmployeeId ? await this.setLead(tx, ctx, id, input.leadEmployeeId, !!input.clearLeadRoles) : { managersChanged: [], loops: [] };
        await this.audit.record(tx, ctx, { action: 'org_unit.created', entityType: 'org_unit', entityId: id, data: { name: input.name } });
        return { unit: await this.unit(tx, id), ...result };
      })
      .catch(mapDbError);
  }

  /**
   * Rename, code, move under another parent (`parentId`; refused into itself or a unit inside it,
   * or under a unit that isn't of a higher level), lead (`planLead`). Returns `{ unit,
   * managersChanged, loops }`.
   */
  updateUnit(ctx: TenantContext, id: string, input: UpdateUnit) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        await this.hr(tx, ctx);
        await lockReportingLines(tx, ctx.tenantId);
        const [current] = await tx.select().from(orgUnits).where(eq(orgUnits.id, id)).for('update');
        if (!current) throw new NotFoundException('Unit not found');
        const set: Partial<typeof orgUnits.$inferInsert> = {};
        if (input.name !== undefined) set.name = input.name;
        if (input.code !== undefined) set.code = input.code;
        const managersChanged: string[] = [];
        let loops: LoopSkip[] = [];
        const moving = input.parentId !== undefined && input.parentId !== current.parentId;
        if (moving) await this.checkPlace(tx, current.levelId, input.parentId ?? null, id);
        const before = moving ? await loadOrgSnapshot(tx, ctx.tenantId) : null;
        if (moving) set.parentId = input.parentId;
        if (Object.keys(set).length) await tx.update(orgUnits).set(set).where(eq(orgUnits.id, id));
        if (moving) {
          // Its lead reported to the nearest lead above: now to the one above the new place.
          const after = cloneSnapshot(before!);
          after.units.get(id)!.parentId = input.parentId ?? null;
          const planned = planChanges(after, planUnitMoved(before!, after, id));
          const written = await writeOrgChanges(tx, ctx.tenantId, after, planned, { jobs: this.jobs, actorUserId: ctx.userId, clearLeadRoles: false });
          managersChanged.push(...written.managerChanges.map((c) => c.employeeId));
        }
        if (input.leadEmployeeId !== undefined && input.leadEmployeeId !== current.leadEmployeeId) {
          const result = await this.setLead(tx, ctx, id, input.leadEmployeeId, !!input.clearLeadRoles);
          managersChanged.push(...result.managersChanged);
          loops = result.loops;
        }
        await this.audit.record(tx, ctx, {
          action: 'org_unit.updated',
          entityType: 'org_unit',
          entityId: id,
          data: { fields: [...Object.keys(set), ...(input.leadEmployeeId !== undefined ? ['leadEmployeeId'] : [])], ...(managersChanged.length ? { managersChanged: managersChanged.length } : {}) },
        });
        return { unit: await this.unit(tx, id), managersChanged: [...new Set(managersChanged)], loops };
      })
      .catch(mapDbError);
  }

  /**
   * A new lead (or none): org-rules `planLead` (the lead joins the unit and reports to the nearest
   * lead above, else the CEO; members who reported to the previous lead or to nobody now report to
   * the lead). A lead leaving another unit they lead is 409 `heads_unit` unless `clear`.
   * The reporting-line lock is held.
   */
  private async setLead(tx: Tx, ctx: TenantContext, unitId: string, leadId: string | null, clear: boolean): Promise<{ managersChanged: string[]; loops: LoopSkip[] }> {
    if (leadId) await activeEmployee(tx, leadId, 'The lead');
    const s = await loadOrgSnapshot(tx, ctx.tenantId);
    if (!leadId) {
      await writeLead(tx, s, unitId, null);
      return { managersChanged: [], loops: [] };
    }
    const { changes, loops } = planLead(s, unitId, leadId);
    const planned = planChanges(s, changes);
    const written = await writeOrgChanges(tx, ctx.tenantId, s, planned, { jobs: this.jobs, actorUserId: ctx.userId, clearLeadRoles: clear });
    await writeLead(tx, s, unitId, leadId);
    return { managersChanged: written.managerChanges.map((c) => c.employeeId), loops };
  }

  /**
   * What a new lead would change, for the dialog (nothing saved): their new manager, who would
   * report to them, who keeps their manager (loops), and the unit they would stop leading.
   */
  leadPreview(ctx: TenantContext, unitId: string, leadId: string) {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      await this.hr(tx, ctx);
      const s = await loadOrgSnapshot(tx, ctx.tenantId);
      if (!s.units.has(unitId)) throw new NotFoundException('Unit not found');
      await activeEmployee(tx, leadId, 'The lead');
      const { changes, loops } = planLead(s, unitId, leadId);
      const work = cloneSnapshot(s);
      const planned = planChanges(work, changes);
      const own = planned.find((c) => c.employeeId === leadId)!;
      const name = (id: string | null) => (id ? (s.people.get(id)?.fullName ?? null) : null);
      const leaves = lostLeads(s, planned).find((l) => l.employeeId === leadId);
      return {
        managerId: own.managerId,
        managerName: name(own.managerId),
        members: planned.filter((c) => c.employeeId !== leadId && c.managerId !== c.fromManagerId).map((c) => ({ id: c.employeeId, fullName: name(c.employeeId)! })),
        loops,
        leavesUnit: leaves ? leaves.unit : null,
      };
    });
  }

  /**
   * Refused while it has units inside (move or delete them first) or another module uses it;
   * otherwise its members end up without a unit (the foreign key), keeping their managers.
   */
  deleteUnit(ctx: TenantContext, id: string) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        await this.hr(tx, ctx);
        await lockReportingLines(tx, ctx.tenantId);
        const [u] = await tx.select({ name: orgUnits.name }).from(orgUnits).where(eq(orgUnits.id, id)).for('update');
        if (!u) throw new NotFoundException('Unit not found');
        const inside = await tx.select({ name: orgUnits.name }).from(orgUnits).where(eq(orgUnits.parentId, id)).orderBy(asc(orgUnits.name));
        if (inside.length) throw new ConflictException(`${u.name} has ${plural(inside.length, 'unit')} (${listNames(inside.map((t) => t.name))}). Move or delete them first.`);
        const usedBy = await this.usage.usedBy(tx, ctx.tenantId, id);
        if (usedBy.length) throw new ConflictException(`${u.name} is used by ${usedBy.join(', ')}, so it can't be deleted.`);
        await tx.delete(orgUnits).where(eq(orgUnits.id, id));
        await this.audit.record(tx, ctx, { action: 'org_unit.deleted', entityType: 'org_unit', entityId: id, data: { name: u.name } });
      })
      .catch(mapDbError);
  }

  /** For the delete confirmation: its units (blocking), what else uses it (blocking), its active members. */
  unitUsage(ctx: TenantContext, id: string) {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      await this.hr(tx, ctx);
      const [u] = await tx.select({ id: orgUnits.id, name: orgUnits.name }).from(orgUnits).where(eq(orgUnits.id, id));
      if (!u) throw new NotFoundException('Unit not found');
      const inside = await tx.select({ id: orgUnits.id, name: orgUnits.name }).from(orgUnits).where(eq(orgUnits.parentId, id)).orderBy(asc(orgUnits.name));
      const members = await tx
        .select({ id: employees.id, fullName: employees.fullName })
        .from(employees)
        .where(and(eq(employees.unitId, id), isNull(employees.deactivatedAt), shownEmployee))
        .orderBy(asc(employees.lastName), asc(employees.firstName));
      return { ...u, units: inside, usedBy: await this.usage.usedBy(tx, ctx.tenantId, id), members };
    });
  }

  // ------------------------------------------------------------------ people

  /**
   * "Add people": puts the employees in the unit (null: no unit). Their managers follow the rules
   * (org-rules.ts), except those in `managers`. Returns `{ updated, managersChanged }`.
   */
  assign(ctx: TenantContext, input: Assign) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        await this.hr(tx, ctx);
        const ids = [...new Set(input.employeeIds)];
        const managers = input.managers ?? {};
        if (Object.keys(managers).some((id) => !ids.includes(id))) throw new BadRequestException('Managers can only be set for the employees being added');
        const written = await changeOrg(
          tx,
          ctx.tenantId,
          ids.map((employeeId) => ({ employeeId, unitId: input.unitId, ...(employeeId in managers ? { managerId: managers[employeeId] } : {}) })),
          { jobs: this.jobs, actorUserId: ctx.userId, clearLeadRoles: !!input.clearLeadRoles },
        );
        await this.audit.record(tx, ctx, {
          action: 'employees.assigned',
          entityType: 'org_unit',
          entityId: input.unitId ?? undefined,
          data: { count: ids.length, managers: written.managerChanges.length },
        });
        return { updated: written.changed.length, managersChanged: written.managerChanges.map((c) => c.employeeId) };
      })
      .catch(mapDbError);
  }

  /**
   * "Set manager" for one or many (spec 7.2): all or nothing, a loop anywhere refuses the whole
   * change (409, naming it). Each person joins the unit their manager leads, else the manager's own
   * (CD-226). Emails the changes. Returns `{ changed }`: whose manager changed.
   */
  setReportingLines(ctx: TenantContext, input: SetReportingLines) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        await this.hr(tx, ctx, 'Only Admins change reporting lines');
        const ids = [...new Set(input.employeeIds)];
        const written = await changeOrg(
          tx,
          ctx.tenantId,
          ids.map((employeeId) => ({ employeeId, managerId: input.managerId })),
          { jobs: this.jobs, actorUserId: ctx.userId, clearLeadRoles: !!input.clearLeadRoles },
        );
        if (written.managerChanges.length) {
          await this.audit.record(tx, ctx, { action: 'employees.manager_set', entityType: 'employee', entityId: written.managerChanges[0]!.employeeId, data: { count: written.managerChanges.length } });
        }
        return { changed: written.managerChanges.map((c) => c.employeeId) };
      })
      .catch(mapDbError);
  }

  // ------------------------------------------------------------------ helpers

  /** Admins only (CD-225), or 403. */
  private async hr(tx: Tx, ctx: TenantContext, refusal = 'Only Admins change the org structure'): Promise<CallerAccess> {
    const access = await this.access.of(ctx, tx);
    if (!access.isHr) throw new ForbiddenException(refusal);
    return access;
  }

  /**
   * Where a unit of `levelId` may go: the level exists; the parent exists, is of a higher level,
   * and (moving unit `self`) is neither the unit nor inside it.
   */
  private async checkPlace(tx: Tx, levelId: string, parentId: string | null, self: string | null) {
    const levels = await this.levelRows(tx);
    const level = levels.find((l) => l.id === levelId);
    if (!level) throw new BadRequestException('Level not found');
    if (!parentId) return;
    const [parent] = await tx.select({ id: orgUnits.id, name: orgUnits.name, levelId: orgUnits.levelId }).from(orgUnits).where(eq(orgUnits.id, parentId));
    if (!parent) throw new BadRequestException('The parent unit was not found');
    if (self) {
      const units = await tx.select({ id: orgUnits.id, name: orgUnits.name, parentId: orgUnits.parentId, leadId: orgUnits.leadEmployeeId }).from(orgUnits);
      if (unitAndBelow({ people: new Map(), units: new Map(units.map((u) => [u.id, u])), ceoId: null }, self).has(parentId)) throw new BadRequestException(`A unit can't be inside itself or one of its own units`);
    }
    const above = levels.find((l) => l.id === parent.levelId);
    if (!above || above.position >= level.position) {
      throw new BadRequestException(`A ${level.name} can only be inside a unit of a higher level: ${parent.name} is a ${above?.name ?? 'unit'}`);
    }
  }
}

/** A lead must be an active employee of the workspace (spec 6.2). */
async function activeEmployee(tx: Tx, id: string, what: string) {
  const [e] = await tx.select({ fullName: employees.fullName, deactivatedAt: employees.deactivatedAt }).from(employees).where(eq(employees.id, id));
  if (!e) throw new BadRequestException(`${what} must be an employee of this workspace`);
  if (e.deactivatedAt) throw new BadRequestException(`${what} must be an active employee: ${e.fullName} has left the company`);
}

/** Changes of the levels queue per workspace (their positions are rewritten together). */
async function lockLevels(tx: Tx, tenantId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`people.org-levels:${tenantId}`}, 0))`);
}
