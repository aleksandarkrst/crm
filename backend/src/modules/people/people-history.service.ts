import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, gt, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { TenantContext } from '../../shared/authorization';
import { DatabaseService, type Tx } from '../../shared/database/database.service';
import { requestActor } from '../../shared/database/request-context';
import { departments, employees, memberships, PEOPLE_HISTORY_ENTITY_TYPES, type PeopleHistoryEntityType, recordChanges, teams, users } from '../../shared/database/schema';
import type { CallerAccess } from './caller-access';
import { BANK_FIELDS, canSeeHistoryField, EMPLOYMENT_FIELDS, LEAVING_FIELDS, listFields, PERSONAL_FIELDS } from './field-rules';
import { PeopleAccess } from './people-access';

export const PeopleHistoryQuery = z.object({
  entityType: z.enum(PEOPLE_HISTORY_ENTITY_TYPES),
  entityId: z.uuid(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type PeopleHistoryQuery = z.infer<typeof PeopleHistoryQuery>;

type ChangeRow = typeof recordChanges.$inferSelect;

/** Fields whose values are ids, and what they name. */
const EMPLOYEE_ID_FIELDS = new Set(['managerId', 'headEmployeeId', 'leadEmployeeId']);
const FORMER_MEMBER = 'Former member';
const ENTITY_NAMES: Record<PeopleHistoryEntityType, string> = { employee: 'employee', department: 'department', team: 'team' };

export interface PeopleHistoryEntry {
  id: string;
  action: ChangeRow['action'];
  field: string | null;
  /** IBANs are only ever their mask ("RS35 •••• 1379"). */
  oldValue: unknown;
  newValue: unknown;
  /** Names for id values: employees ("Ana Petrović", "… (left)"), departments, teams, members. */
  oldLabel: string | null;
  newLabel: string | null;
  /** The record's name on created and deleted, as it was then. */
  label: string | null;
  actor: { userId: string | null; name: string } | null;
  changedAt: Date;
}

/**
 * History of employees, departments and teams (record_changes, written by the triggers of
 * drizzle/0039_people_rls.sql), read with the employee card's rules (spec 9.3, 9.4): an employee's
 * history by the employee themselves (without the reason for leaving), Administration and Admin;
 * departments' and teams' by Administration and Admin. Rows of fields the caller may not see are
 * left out. Also the If-Match conflict check of employee updates.
 */
@Injectable()
export class PeopleHistoryService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: PeopleAccess,
  ) {}

  list(ctx: TenantContext, query: PeopleHistoryQuery) {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const access = await this.access.of(ctx, tx);
      if (query.entityType === 'employee') {
        const [employee] = await tx.select({ id: employees.id }).from(employees).where(eq(employees.id, query.entityId));
        // The record may be gone (deleted): its history stays readable for HR.
        if (!employee && !access.isHr) throw new NotFoundException('Employee not found');
        if (!access.canSeeHistory(query.entityId)) throw new ForbiddenException("Only the employee, Administration and Admins see an employee's history");
      } else if (!access.isHr) {
        throw new ForbiddenException(`Only Administration and Admins see the history of a ${ENTITY_NAMES[query.entityType]}`);
      }
      // Hidden fields are filtered in the query, so pages stay full.
      const hidden = query.entityType === 'employee' ? hiddenFields(access, query.entityId) : [];
      const rows = await tx
        .select()
        .from(recordChanges)
        .where(
          and(
            eq(recordChanges.entityType, query.entityType),
            eq(recordChanges.entityId, query.entityId),
            hidden.length ? or(isNull(recordChanges.field), sql`${recordChanges.field} not in (${sql.join(hidden.map((f) => sql`${f}`), sql`, `)})`) : undefined,
          ),
        )
        .orderBy(desc(recordChanges.changedAt), desc(recordChanges.id))
        .limit(query.limit + 1)
        .offset(query.offset);
      const page = rows.slice(0, query.limit);
      return { entries: await this.present(tx, ctx, page), more: rows.length > query.limit };
    });
  }

  /**
   * Optimistic concurrency for an employee card (one version: employees.updated_at), like the CRM's
   * (CD-20): a field someone else changed since `version` to a value other than the one sent is a
   * 409 naming who and what. `current` has the card's current values under the API's field names.
   */
  async assertNoConflict(tx: Tx, ctx: TenantContext, employeeId: string, updatedAt: Date, sent: Record<string, unknown>, current: Record<string, unknown>, version: Date | undefined) {
    if (!version || updatedAt.getTime() <= version.getTime()) return;
    const fields = Object.keys(sent).filter((k) => sent[k] !== undefined);
    if (fields.length === 0) return;
    const clientId = requestActor.getStore()?.clientId;
    const changes = await tx
      .select()
      .from(recordChanges)
      .where(
        and(
          eq(recordChanges.entityType, 'employee'),
          eq(recordChanges.entityId, employeeId),
          eq(recordChanges.action, 'updated'),
          gt(recordChanges.changedAt, version),
          inArray(recordChanges.field, fields),
          clientId ? or(isNull(recordChanges.clientId), ne(recordChanges.clientId, clientId)) : undefined,
        ),
      )
      .orderBy(desc(recordChanges.changedAt));
    const conflicting = changes.filter((c, i) => changes.findIndex((d) => d.field === c.field) === i).filter((c) => !sameValue(current[c.field!], sent[c.field!]));
    if (conflicting.length === 0) return;
    const entries = await this.present(tx, ctx, conflicting);
    const latest = entries[0]!;
    const who = latest.actor?.userId === ctx.userId ? 'You' : latest.actor ? (latest.actor.name === FORMER_MEMBER ? 'A former member' : latest.actor.name) : 'Someone';
    const whileYou = who === 'You' ? 'in another window while you were editing' : 'while you were editing';
    throw new ConflictException({
      statusCode: 409,
      error: 'Conflict',
      message: `${who} changed this employee ${whileYou}. Your change to ${listFields(conflicting.map((c) => c.field!))} wasn't saved.`,
      conflicts: entries.map((e) => ({ field: e.field, value: e.newValue, label: e.newLabel, changedBy: e.actor?.name ?? null, changedAt: e.changedAt })),
    });
  }

  /** Readable names: employees (with "(left)"), departments, teams, members ("Former member" once they left). */
  private async present(tx: Tx, ctx: TenantContext, rows: ChangeRow[]): Promise<PeopleHistoryEntry[]> {
    const ids = { employee: new Set<string>(), department: new Set<string>(), team: new Set<string>(), user: new Set<string>() };
    for (const r of rows) {
      if (r.actorUserId) ids.user.add(r.actorUserId);
      for (const v of [r.oldValue, r.newValue]) {
        if (typeof v !== 'string' || !r.field) continue;
        if (EMPLOYEE_ID_FIELDS.has(r.field)) ids.employee.add(v);
        else if (r.field === 'departmentId') ids.department.add(v);
        else if (r.field === 'teamId') ids.team.add(v);
        else if (r.field === 'userId') ids.user.add(v);
      }
    }
    const names = new Map<string, string>();
    if (ids.employee.size) {
      const list = await tx
        .select({ id: employees.id, name: employees.fullName, left: employees.deactivatedAt })
        .from(employees)
        .where(inArray(employees.id, [...ids.employee]));
      for (const e of list) names.set(e.id, e.left ? `${e.name} (left)` : e.name);
    }
    if (ids.department.size) {
      for (const d of await tx.select({ id: departments.id, name: departments.name }).from(departments).where(inArray(departments.id, [...ids.department]))) names.set(d.id, d.name);
    }
    if (ids.team.size) {
      for (const t of await tx.select({ id: teams.id, name: teams.name }).from(teams).where(inArray(teams.id, [...ids.team]))) names.set(t.id, t.name);
    }
    if (ids.user.size) {
      const list = await tx
        .select({ id: users.id, name: sql<string>`coalesce(${users.displayName}, ${users.email}, 'Member')` })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(and(eq(memberships.tenantId, ctx.tenantId), inArray(memberships.userId, [...ids.user])));
      for (const u of list) names.set(u.id, u.name);
    }
    const labelOf = (field: string | null, value: unknown): string | null => {
      if (!field || typeof value !== 'string') return null;
      if (EMPLOYEE_ID_FIELDS.has(field)) return names.get(value) ?? 'Deleted employee';
      if (field === 'departmentId') return names.get(value) ?? 'Deleted department';
      if (field === 'teamId') return names.get(value) ?? 'Deleted team';
      if (field === 'userId') return names.get(value) ?? FORMER_MEMBER;
      return null;
    };
    return rows.map((r) => ({
      id: r.id,
      action: r.action,
      field: r.field,
      oldValue: r.oldValue,
      newValue: r.newValue,
      oldLabel: labelOf(r.field, r.oldValue),
      newLabel: labelOf(r.field, r.newValue),
      label: r.label,
      actor: r.actorUserId ? { userId: names.has(r.actorUserId) ? r.actorUserId : null, name: names.get(r.actorUserId) ?? FORMER_MEMBER } : null,
      changedAt: r.changedAt,
    }));
  }
}

/** History fields of employee `employeeId` the caller may not see (field-rules.ts). */
function hiddenFields(access: CallerAccess, employeeId: string): string[] {
  const all = ['leavingReason', ...LEAVING_FIELDS, ...EMPLOYMENT_FIELDS, ...PERSONAL_FIELDS, ...BANK_FIELDS];
  return all.filter((f) => !canSeeHistoryField(access, employeeId, f));
}

/** The update sends the value the record already has (someone made the same change): no conflict. */
function sameValue(a: unknown, b: unknown): boolean {
  if ((a !== null && typeof a === 'object') || (b !== null && typeof b === 'object')) return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  return (a ?? null) === (b ?? null) || String(a ?? '') === String(b ?? '');
}
