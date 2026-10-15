import { and, desc, inArray } from 'drizzle-orm';
import type { Tx } from '../../shared/database/database.service';
import { requestActor } from '../../shared/database/request-context';
import { recordChanges, timeoffPolicies, type TimeoffHistoryEntityType, users } from '../../shared/database/schema';

type ChangeRow = typeof recordChanges.$inferSelect;

/** One history entry of a policy, a profile or an entitlement, as the API answers it. */
export interface TimeoffHistoryEntry {
  id: string;
  /** Which record changed (the card merges a profile's and its entitlements' history). */
  entityType: TimeoffHistoryEntityType;
  entityId: string;
  action: ChangeRow['action'];
  field: string | null;
  oldValue: unknown;
  newValue: unknown;
  /** Policy names for `policyId` values. */
  oldLabel: string | null;
  newLabel: string | null;
  /** The record's name on created and deleted (a policy's name, an entitlement's year). */
  label: string | null;
  /** Null: the system (the daily job). */
  actor: { userId: string | null; name: string } | null;
  changedAt: Date;
}

const FORMER_MEMBER = 'Former member';

/** `record_changes` rows of these records, newest first, with names for the ids they mention. */
export async function readHistory(
  tx: Tx,
  targets: { entityType: TimeoffHistoryEntityType; ids: string[] }[],
  page: { limit: number; offset: number },
): Promise<{ entries: TimeoffHistoryEntry[]; more: boolean }> {
  const ids = targets.flatMap((t) => t.ids);
  if (!ids.length) return { entries: [], more: false };
  const types = targets.map((t) => t.entityType);
  const rows = await tx
    .select()
    .from(recordChanges)
    .where(and(inArray(recordChanges.entityType, types), inArray(recordChanges.entityId, ids)))
    .orderBy(desc(recordChanges.changedAt), desc(recordChanges.id))
    .limit(page.limit + 1)
    .offset(page.offset);
  return { entries: await present(tx, rows.slice(0, page.limit)), more: rows.length > page.limit };
}

async function present(tx: Tx, rows: ChangeRow[]): Promise<TimeoffHistoryEntry[]> {
  const userIds = new Set<string>();
  const policyIds = new Set<string>();
  for (const r of rows) {
    if (r.actorUserId) userIds.add(r.actorUserId);
    if (r.field === 'policyId') for (const v of [r.oldValue, r.newValue]) if (typeof v === 'string') policyIds.add(v);
  }
  const names = new Map<string, string>();
  if (userIds.size) {
    for (const u of await tx.select({ id: users.id, name: users.displayName, email: users.email }).from(users).where(inArray(users.id, [...userIds]))) names.set(u.id, u.name || u.email || FORMER_MEMBER);
  }
  const policies = new Map<string, string>();
  if (policyIds.size) {
    for (const p of await tx.select({ id: timeoffPolicies.id, name: timeoffPolicies.name }).from(timeoffPolicies).where(inArray(timeoffPolicies.id, [...policyIds]))) policies.set(p.id, p.name);
  }
  const labelOf = (field: string | null, v: unknown) => (field === 'policyId' && typeof v === 'string' ? (policies.get(v) ?? 'Deleted policy') : null);
  return rows.map((r) => ({
    id: r.id,
    entityType: r.entityType as TimeoffHistoryEntityType,
    entityId: r.entityId,
    action: r.action,
    field: r.field,
    oldValue: r.oldValue,
    newValue: r.newValue,
    oldLabel: labelOf(r.field, r.oldValue),
    newLabel: labelOf(r.field, r.newValue),
    label: r.label,
    actor: r.actorUserId ? { userId: r.actorUserId, name: names.get(r.actorUserId) ?? FORMER_MEMBER } : null,
    changedAt: r.changedAt,
  }));
}

/**
 * A history row the service writes itself, for a change the triggers can't see as one field: a
 * policy's experience rows (rows of their own table) replaced as a whole.
 */
export async function recordFieldChange(tx: Tx, tenantId: string, entityType: TimeoffHistoryEntityType, entityId: string, field: string, oldValue: unknown, newValue: unknown): Promise<void> {
  const actor = requestActor.getStore();
  await tx.insert(recordChanges).values({
    tenantId,
    entityType,
    entityId,
    action: 'updated',
    field,
    oldValue,
    newValue,
    actorUserId: actor?.userId ?? null,
    clientId: actor?.clientId ?? null,
  });
}
