import { ConflictException, Injectable, NotFoundException, type OnModuleInit } from '@nestjs/common';
import { and, asc, eq, isNotNull, sql } from 'drizzle-orm';
import { AuditService } from '../../shared/audit/audit.service';
import type { TenantContext } from '../../shared/authorization';
import { DatabaseService, type Tx } from '../../shared/database/database.service';
import { mapDbError } from '../../shared/database/errors';
import { type ReasonKind, tenants, timeoffReasons, timeoffRequests } from '../../shared/database/schema';
import { TenantProvisioning, type TenantProvisioner } from '../../shared/events/tenant-provisioning';
import type { CreateReason, UpdateReason, UpdateTimeoffSettings } from './timeoff.schemas';

/** A reason as the API answers it (spec 7.2, 7.3). */
export interface ReasonView {
  id: string;
  kind: ReasonKind;
  name: string;
  maxDays: number | null;
  countsTowardLimit: boolean;
  paidByEmployer: boolean;
  active: boolean;
  position: number;
  /** Requests that use it (a used reason can't be deleted, only deactivated). */
  used: number;
}

/** The workspace's time off settings (spec 15.3) that aren't policies or reasons. */
export interface TimeoffSettingsView {
  /** Paid leave: working days per calendar year for the reasons that count toward it (A10). */
  paidLeaveYearlyLimit: number;
}

/** The defaults of a new workspace (spec 7.2, 7.3; the migration gave them to existing ones). */
export const DEFAULT_REASONS: { kind: ReasonKind; name: string; maxDays: number | null; countsTowardLimit: boolean; paidByEmployer: boolean }[] = [
  { kind: 'paid_leave', name: 'Marriage', maxDays: 5, countsTowardLimit: true, paidByEmployer: true },
  { kind: 'paid_leave', name: 'Birth of a child', maxDays: 5, countsTowardLimit: true, paidByEmployer: true },
  { kind: 'paid_leave', name: 'Serious illness of a close family member', maxDays: 5, countsTowardLimit: true, paidByEmployer: true },
  { kind: 'paid_leave', name: 'Death of a close family member', maxDays: 5, countsTowardLimit: false, paidByEmployer: true },
  { kind: 'paid_leave', name: 'Blood donation', maxDays: 2, countsTowardLimit: false, paidByEmployer: true },
  { kind: 'paid_leave', name: 'Religious holiday', maxDays: 1, countsTowardLimit: false, paidByEmployer: true },
  { kind: 'paid_leave', name: 'Other, by company rules', maxDays: 5, countsTowardLimit: false, paidByEmployer: true },
  { kind: 'other_absence', name: 'Maternity leave', maxDays: null, countsTowardLimit: false, paidByEmployer: false },
  { kind: 'other_absence', name: 'Child care leave', maxDays: null, countsTowardLimit: false, paidByEmployer: false },
  { kind: 'other_absence', name: 'Special child care leave', maxDays: null, countsTowardLimit: false, paidByEmployer: false },
  { kind: 'other_absence', name: 'Military service', maxDays: null, countsTowardLimit: false, paidByEmployer: false },
  { kind: 'other_absence', name: 'Other', maxDays: null, countsTowardLimit: false, paidByEmployer: false },
];

/**
 * Paid leave and other absence reasons (CD-165, spec 7.2, 7.3) and the paid leave yearly limit:
 * any member reads them (the request form); Admins add, rename, change the limits, deactivate and
 * delete (only an unused one). Each change is in the audit log and the reason's history (0100).
 */
@Injectable()
export class ReasonsService implements TenantProvisioner, OnModuleInit {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly provisioning: TenantProvisioning,
  ) {}

  onModuleInit(): void {
    this.provisioning.register(this);
  }

  async provision(tx: Tx, tenantId: string): Promise<void> {
    await tx
      .insert(timeoffReasons)
      .values(DEFAULT_REASONS.map((r, i) => ({ tenantId, ...r, position: i + 1 })))
      .onConflictDoNothing();
  }

  list(ctx: TenantContext, kind?: ReasonKind): Promise<ReasonView[]> {
    return this.database.withTenant(ctx.tenantId, (tx) => this.listIn(tx, kind));
  }

  private async listIn(tx: Tx, kind?: ReasonKind, id?: string): Promise<ReasonView[]> {
    const rows = await tx
      .select()
      .from(timeoffReasons)
      .where(and(kind ? eq(timeoffReasons.kind, kind) : undefined, id ? eq(timeoffReasons.id, id) : undefined))
      .orderBy(asc(timeoffReasons.kind), asc(timeoffReasons.position), asc(timeoffReasons.name));
    const counts = await tx
      .select({ reasonId: timeoffRequests.reasonId, n: sql<number>`count(*)::int` })
      .from(timeoffRequests)
      .where(isNotNull(timeoffRequests.reasonId))
      .groupBy(timeoffRequests.reasonId);
    const used = new Map(counts.map((c) => [c.reasonId!, c.n]));
    return rows.map((r) => ({ id: r.id, kind: r.kind, name: r.name, maxDays: r.maxDays, countsTowardLimit: r.countsTowardLimit, paidByEmployer: r.paidByEmployer, active: r.active, position: r.position, used: used.get(r.id) ?? 0 }));
  }

  create(ctx: TenantContext, input: CreateReason): Promise<ReasonView> {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const last = await tx.select({ position: timeoffReasons.position }).from(timeoffReasons).where(eq(timeoffReasons.kind, input.kind)).orderBy(asc(timeoffReasons.position));
        const [row] = await tx
          .insert(timeoffReasons)
          .values({ tenantId: ctx.tenantId, ...input, maxDays: input.kind === 'paid_leave' ? input.maxDays : null, countsTowardLimit: input.kind === 'paid_leave' && input.countsTowardLimit, position: (last[last.length - 1]?.position ?? 0) + 1 })
          .returning({ id: timeoffReasons.id });
        await this.audit.record(tx, ctx, { action: 'timeoff.reason_created', entityType: 'timeoff_reason', entityId: row!.id, data: { ...input } });
        return (await this.listIn(tx, undefined, row!.id))[0]!;
      })
      .catch(mapDbError);
  }

  update(ctx: TenantContext, id: string, input: UpdateReason): Promise<ReasonView> {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const patch = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
        const [row] = await tx.update(timeoffReasons).set(patch).where(eq(timeoffReasons.id, id)).returning({ id: timeoffReasons.id });
        if (!row) throw new NotFoundException('Reason not found');
        await this.audit.record(tx, ctx, { action: 'timeoff.reason_updated', entityType: 'timeoff_reason', entityId: id, data: { ...input } });
        return (await this.listIn(tx, undefined, id))[0]!;
      })
      .catch(mapDbError);
  }

  /** Only a reason no request uses (spec 7.2); deactivate a used one instead. */
  remove(ctx: TenantContext, id: string): Promise<void> {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const [reason] = await this.listIn(tx, undefined, id);
        if (!reason) throw new NotFoundException('Reason not found');
        if (reason.used) throw new ConflictException(`${reason.used} ${reason.used === 1 ? 'request uses' : 'requests use'} this reason. Deactivate it instead.`);
        await tx.delete(timeoffReasons).where(eq(timeoffReasons.id, id));
        await this.audit.record(tx, ctx, { action: 'timeoff.reason_deleted', entityType: 'timeoff_reason', entityId: id, data: { name: reason.name } });
      })
      .catch(mapDbError);
  }

  settings(ctx: TenantContext): Promise<TimeoffSettingsView> {
    return this.database.withTenant(ctx.tenantId, (tx) => this.settingsIn(tx, ctx.tenantId));
  }

  async settingsIn(tx: Tx, tenantId: string): Promise<TimeoffSettingsView> {
    const [t] = await tx.select({ limit: tenants.timeoffPaidLeaveYearlyLimit }).from(tenants).where(eq(tenants.id, tenantId));
    return { paidLeaveYearlyLimit: t?.limit ?? 5 };
  }

  updateSettings(ctx: TenantContext, input: UpdateTimeoffSettings): Promise<TimeoffSettingsView> {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      await tx.update(tenants).set({ timeoffPaidLeaveYearlyLimit: input.paidLeaveYearlyLimit }).where(eq(tenants.id, ctx.tenantId));
      await this.audit.record(tx, ctx, { action: 'timeoff.settings_updated', entityType: 'workspace', entityId: ctx.tenantId, data: { ...input } });
      return this.settingsIn(tx, ctx.tenantId);
    });
  }
}
