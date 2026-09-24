import { Injectable, NotFoundException, type OnModuleInit } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, not, notInArray, or, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AuditService } from '../../../shared/audit/audit.service';
import type { TenantContext } from '../../../shared/authorization';
import { DatabaseService, type Tx } from '../../../shared/database/database.service';
import { mapDbError } from '../../../shared/database/errors';
import { CHANNELS, type ChecklistItem, dealTasks, funnels, funnelStages } from '../../../shared/database/schema';
import { type TenantProvisioner, TenantProvisioning } from '../../../shared/events/tenant-provisioning';
import { nonEmptyPatch } from '../../../shared/validation/common';
import { DEFAULT_FUNNELS } from './default-funnels';

const checklistLabel = z.string().trim().min(1).max(200);
/**
 * A stage's checklist as items (CD-32). Keep an item's id to rename it without losing the deals'
 * progress on it; leave the id out for a new item. Labels must differ within a stage, because
 * to-dos are also unique per label.
 */
export const ChecklistItems = z
  .array(z.object({ id: z.uuid().optional(), label: checklistLabel }))
  .max(20)
  .refine((items) => new Set(items.map((i) => i.label)).size === items.length, 'Two to-dos of a stage have the same name')
  .refine((items) => {
    const ids = items.flatMap((i) => (i.id ? [i.id] : []));
    return new Set(ids).size === ids.length;
  }, 'Two to-dos of a stage have the same id');

export const UpdateStage = nonEmptyPatch(
  z.object({
    name: z.string().trim().min(1).max(100).optional(),
    activity: z.string().trim().min(1).max(200).optional(),
    channel: z.enum(CHANNELS).optional(),
    documentOnEntry: z.string().trim().max(60).nullish(),
    winProbability: z.number().int().min(0).max(100).optional(),
    checklistItems: ChecklistItems.optional(),
    /** Labels only (before CD-32): items are matched by label, so a renamed label is a new item. */
    checklist: z.array(checklistLabel).max(20).optional(),
  }),
).refine((v) => !(v.checklist && v.checklistItems), 'Send checklistItems or checklist, not both');
export type UpdateStage = z.infer<typeof UpdateStage>;

/** Funnels are the per-persona playbooks: ordered stages with activity, channel and to-dos. */
@Injectable()
export class FunnelsService implements TenantProvisioner, OnModuleInit {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly provisioning: TenantProvisioning,
  ) {}

  onModuleInit(): void {
    this.provisioning.register(this);
  }

  /** Seeds the default funnels for a brand-new tenant (runs inside tenant creation). */
  async provision(tx: Tx, tenantId: string): Promise<void> {
    for (const [position, template] of DEFAULT_FUNNELS.entries()) {
      const [funnel] = await tx
        .insert(funnels)
        .values({ tenantId, key: template.key, label: template.label, note: template.note, position })
        .returning({ id: funnels.id });
      await tx.insert(funnelStages).values(
        template.stages.map((s, i) => ({ ...s, checklistItems: newItems(s.checklist), tenantId, funnelId: funnel!.id, position: i, isWon: s.key === 'won' })),
      );
    }
  }

  /** All funnels with their stages in order. */
  list(ctx: TenantContext) {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const fs = await tx.select().from(funnels).orderBy(asc(funnels.position));
      if (fs.length === 0) return [];
      const stages = await tx
        .select()
        .from(funnelStages)
        .where(inArray(funnelStages.funnelId, fs.map((f) => f.id)))
        .orderBy(asc(funnelStages.position));
      return fs.map((f) => ({ ...f, stages: stages.filter((s) => s.funnelId === f.id) }));
    });
  }

  /**
   * Edits a stage. A new checklist keeps the deals' progress on every item whose id it keeps, even
   * when the item was renamed (CD-32): the to-dos follow the item's new label.
   */
  updateStage(ctx: TenantContext, funnelId: string, stageId: string, input: UpdateStage) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const where = and(eq(funnelStages.id, stageId), eq(funnelStages.funnelId, funnelId));
        const [current] = await tx.select({ checklistItems: funnelStages.checklistItems }).from(funnelStages).where(where);
        if (!current) throw new NotFoundException('Stage not found');
        const { checklistItems, ...rest } = input;
        const items = checklistItems?.map((i) => ({ id: i.id ?? randomUUID(), label: i.label }));
        const [row] = await tx
          .update(funnelStages)
          .set({ ...rest, ...(items ? { checklistItems: items } : {}) })
          .where(where)
          .returning();
        if (items) await this.followRenamedItems(tx, stageId, current.checklistItems, items);
        await this.audit.record(tx, ctx, { action: 'funnel.stage_updated', entityType: 'funnel_stage', entityId: stageId, data: input });
        return row!;
      })
      .catch(mapDbError);
  }

  /**
   * Playbook to-dos carry their item's label too (unique per deal and stage), so renamed items
   * rename their to-dos. Unlinked to-dos (their item was removed, or renamed before CD-32) holding
   * a label an item is renamed to are dropped first; they were invisible already. The rename goes
   * through a temporary label so swapping two names can't collide.
   */
  private async followRenamedItems(tx: Tx, stageId: string, before: ChecklistItem[], after: ChecklistItem[]) {
    const oldLabel = new Map(before.map((i) => [i.id, i.label]));
    const renamed = after.filter((i) => oldLabel.has(i.id) && oldLabel.get(i.id) !== i.label);
    if (renamed.length === 0) return;
    const playbook = and(eq(dealTasks.stageId, stageId), not(dealTasks.offPlaybook));
    await tx.delete(dealTasks).where(
      and(
        playbook,
        inArray(dealTasks.label, renamed.map((i) => i.label)),
        or(isNull(dealTasks.checklistItemId), notInArray(dealTasks.checklistItemId, after.map((i) => i.id))),
      ),
    );
    await tx
      .update(dealTasks)
      .set({ label: sql`'~' || ${dealTasks.id}::text` })
      .where(and(playbook, inArray(dealTasks.checklistItemId, renamed.map((i) => i.id))));
    for (const item of renamed) await tx.update(dealTasks).set({ label: item.label }).where(and(playbook, eq(dealTasks.checklistItemId, item.id)));
  }
}

/** Checklist items with new ids, for labels from a template. */
export const newItems = (labels: string[]): ChecklistItem[] => labels.map((label) => ({ id: randomUUID(), label }));
