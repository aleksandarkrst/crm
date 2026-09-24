import { BadRequestException, ConflictException, Injectable, NotFoundException, type OnModuleInit } from '@nestjs/common';
import { and, asc, count, eq, inArray, isNull, not, notInArray, or, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AuditService } from '../../../shared/audit/audit.service';
import type { TenantContext } from '../../../shared/authorization';
import { DatabaseService, type Tx } from '../../../shared/database/database.service';
import { mapDbError } from '../../../shared/database/errors';
import { activities, CHANNELS, type ChecklistItem, deals, dealStageHistory, dealTasks, funnels, funnelStages } from '../../../shared/database/schema';
import { JobsService } from '../../../shared/events/jobs.service';
import { type TenantProvisioner, TenantProvisioning } from '../../../shared/events/tenant-provisioning';
import { nonEmptyPatch, optionalText } from '../../../shared/validation/common';
import { StageHistoryService } from '../deals/stage-history.service';
import { BLANK_FUNNEL_STAGES, DEFAULT_FUNNELS, type StageTemplate } from './default-funnels';

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

const StageFields = z.object({
  name: z.string().trim().min(1).max(100),
  activity: z.string().trim().min(1).max(200),
  channel: z.enum(CHANNELS),
  documentOnEntry: z.string().trim().max(60).nullish(),
  winProbability: z.number().int().min(0).max(100),
  checklistItems: ChecklistItems,
});

export const UpdateStage = nonEmptyPatch(
  StageFields.partial().extend({
    /** Labels only (before CD-32): items are matched by label, so a renamed label is a new item. */
    checklist: z.array(checklistLabel).max(20).optional(),
  }),
).refine((v) => !(v.checklist && v.checklistItems), 'Send checklistItems or checklist, not both');
export type UpdateStage = z.infer<typeof UpdateStage>;

/** A new stage (CD-9); `position` is where it goes (0 = first), by default just before the won stage. */
export const CreateStage = StageFields.partial().extend({
  name: StageFields.shape.name,
  position: z.number().int().min(0).max(100).optional(),
});
export type CreateStage = z.infer<typeof CreateStage>;

/** Every stage of the funnel that isn't deleted, each once, in the new order. */
export const ReorderStages = z.object({
  stageIds: z
    .array(z.uuid())
    .min(1)
    .max(50)
    .refine((ids) => new Set(ids).size === ids.length, 'A stage is listed twice'),
});
export type ReorderStages = z.infer<typeof ReorderStages>;

/** Where the deals of a deleted stage go (required when it has deals). */
export const DeleteStageQuery = z.object({ moveDealsTo: z.uuid().optional() });
export type DeleteStageQuery = z.infer<typeof DeleteStageQuery>;

/** A new funnel (CD-10): a copy of another funnel's stages, or a small default set. */
export const CreateFunnel = z.object({
  label: z.string().trim().min(1).max(100),
  note: optionalText(1000),
  copyFromFunnelId: z.uuid().optional(),
});
export type CreateFunnel = z.infer<typeof CreateFunnel>;

export const UpdateFunnel = nonEmptyPatch(z.object({ label: z.string().trim().min(1).max(100).optional(), note: optionalText(1000) }));
export type UpdateFunnel = z.infer<typeof UpdateFunnel>;

/** "Mid-market — CMO" → "mid-market-cmo"; keys are stable slugs, unique per funnel or tenant. */
function slugOf(text: string, taken: Set<string>, fallback: string): string {
  const base =
    text
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || fallback;
  let key = base;
  for (let i = 2; taken.has(key); i++) key = `${base}-${i}`;
  return key;
}

const notDeleted = isNull(funnelStages.deletedAt);

/** Funnels are the per-persona playbooks: ordered stages with activity, channel and to-dos. */
@Injectable()
export class FunnelsService implements TenantProvisioner, OnModuleInit {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly provisioning: TenantProvisioning,
    private readonly history: StageHistoryService,
    private readonly jobs: JobsService,
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
      await tx.insert(funnelStages).values(template.stages.map((s, i) => stageRow(s, tenantId, funnel!.id, i)));
    }
  }

  /** All funnels with their stages in order (deleted stages are left out). */
  list(ctx: TenantContext) {
    return this.database.withTenant(ctx.tenantId, (tx) => this.listIn(tx));
  }

  private async listIn(tx: Tx) {
    const fs = await tx.select().from(funnels).orderBy(asc(funnels.position), asc(funnels.createdAt));
    if (fs.length === 0) return [];
    const stages = await tx
      .select()
      .from(funnelStages)
      .where(and(inArray(funnelStages.funnelId, fs.map((f) => f.id)), notDeleted))
      .orderBy(asc(funnelStages.position));
    return fs.map((f) => ({ ...f, stages: stages.filter((s) => s.funnelId === f.id) }));
  }

  private async one(tx: Tx, funnelId: string) {
    const found = (await this.listIn(tx)).find((f) => f.id === funnelId);
    if (!found) throw new NotFoundException('Funnel not found');
    return found;
  }

  // ------------------------------------------------------------------ funnels (CD-10)

  /**
   * Creates a funnel after the others. With `copyFromFunnelId` it gets a copy of that funnel's
   * stages (checklists with new item ids, no deals); otherwise a small default set.
   */
  createFunnel(ctx: TenantContext, input: CreateFunnel) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const existing = await tx.select({ key: funnels.key, position: funnels.position }).from(funnels);
        let stages: StageTemplate[] = BLANK_FUNNEL_STAGES;
        if (input.copyFromFunnelId) {
          const source = await tx.select().from(funnelStages).where(and(eq(funnelStages.funnelId, input.copyFromFunnelId), notDeleted)).orderBy(asc(funnelStages.position));
          if (source.length === 0) throw new BadRequestException('The funnel to copy was not found');
          stages = source.map((s) => ({ ...s, checklist: s.checklistItems.map((i) => i.label) }));
        }
        const [funnel] = await tx
          .insert(funnels)
          .values({
            tenantId: ctx.tenantId,
            key: slugOf(input.label, new Set(existing.map((f) => f.key)), 'funnel'),
            label: input.label,
            note: input.note ?? null,
            position: Math.max(-1, ...existing.map((f) => f.position)) + 1,
          })
          .returning();
        await tx.insert(funnelStages).values(stages.map((s, i) => stageRow(s, ctx.tenantId, funnel!.id, i)));
        await this.audit.record(tx, ctx, { action: 'funnel.created', entityType: 'funnel', entityId: funnel!.id, data: input });
        return this.one(tx, funnel!.id);
      })
      .catch(mapDbError);
  }

  /** Renames a funnel or changes its note ("how they buy"). The key stays. */
  updateFunnel(ctx: TenantContext, funnelId: string, input: UpdateFunnel) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const [row] = await tx.update(funnels).set(input).where(eq(funnels.id, funnelId)).returning({ id: funnels.id });
        if (!row) throw new NotFoundException('Funnel not found');
        await this.audit.record(tx, ctx, { action: 'funnel.updated', entityType: 'funnel', entityId: funnelId, data: input });
        return this.one(tx, funnelId);
      })
      .catch(mapDbError);
  }

  /**
   * Deletes a funnel that has never had a deal: none in it now, and no deal's history passes
   * through it (a deal moved to another funnel still points at the stages it was in). The last
   * funnel of a workspace stays.
   */
  deleteFunnel(ctx: TenantContext, funnelId: string) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const all = await tx.select({ id: funnels.id }).from(funnels);
        if (!all.some((f) => f.id === funnelId)) throw new NotFoundException('Funnel not found');
        if (all.length === 1) throw new ConflictException("A workspace needs at least one funnel, so the last one can't be deleted.");
        const [{ n }] = (await tx.select({ n: count() }).from(deals).where(eq(deals.funnelId, funnelId))) as [{ n: number }];
        if (n > 0) throw new ConflictException(`This funnel has ${n} deal${n === 1 ? '' : 's'}. Move ${n === 1 ? 'it' : 'them'} to another funnel or delete ${n === 1 ? 'it' : 'them'} first.`);
        const stageIds = (await tx.select({ id: funnelStages.id }).from(funnelStages).where(eq(funnelStages.funnelId, funnelId))).map((s) => s.id);
        if (stageIds.length) {
          const [used] = await tx
            .select({ id: dealStageHistory.id })
            .from(dealStageHistory)
            .where(or(inArray(dealStageHistory.toStageId, stageIds), inArray(dealStageHistory.fromStageId, stageIds)))
            .limit(1);
          if (used) throw new ConflictException('Deals have been in this funnel before (their stage history points at it), so it can\'t be deleted.');
        }
        await tx.delete(funnels).where(eq(funnels.id, funnelId)); // stages and their to-dos cascade
        await this.audit.record(tx, ctx, { action: 'funnel.deleted', entityType: 'funnel', entityId: funnelId });
      })
      .catch(mapDbError);
  }

  // ------------------------------------------------------------------ stages (CD-9)

  /** Adds a stage at `position` (the stages from there on move down one), by default before the won stage. */
  createStage(ctx: TenantContext, funnelId: string, input: CreateStage) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const funnel = await this.one(tx, funnelId);
        const keys = await tx.select({ key: funnelStages.key }).from(funnelStages).where(eq(funnelStages.funnelId, funnelId));
        const stages = funnel.stages;
        const wonAt = stages.findIndex((s) => s.isWon);
        const at = Math.min(input.position ?? (wonAt >= 0 ? wonAt : stages.length), stages.length);
        const { checklistItems, ...fields } = input; // fields.position is replaced by `at` below
        const [row] = await tx
          .insert(funnelStages)
          .values({
            activity: fields.name,
            ...fields,
            tenantId: ctx.tenantId,
            funnelId,
            key: slugOf(fields.name, new Set(keys.map((k) => k.key)), 'stage'),
            position: at,
            checklistItems: (checklistItems ?? []).map((i) => ({ id: i.id ?? randomUUID(), label: i.label })),
            isWon: false,
          })
          .returning();
        await this.renumber(tx, [...stages.slice(0, at).map((s) => s.id), row!.id, ...stages.slice(at).map((s) => s.id)]);
        await this.audit.record(tx, ctx, { action: 'funnel.stage_created', entityType: 'funnel_stage', entityId: row!.id, data: input });
        return this.one(tx, funnelId);
      })
      .catch(mapDbError);
  }

  /** Puts the funnel's stages in the given order. Deals stay in their stages. */
  reorderStages(ctx: TenantContext, funnelId: string, input: ReorderStages) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const funnel = await this.one(tx, funnelId);
        const current = new Set(funnel.stages.map((s) => s.id));
        if (input.stageIds.length !== current.size || !input.stageIds.every((id) => current.has(id)))
          throw new BadRequestException('List every stage of this funnel exactly once');
        await this.renumber(tx, input.stageIds);
        await this.audit.record(tx, ctx, { action: 'funnel.stages_reordered', entityType: 'funnel', entityId: funnelId, data: input });
        return this.one(tx, funnelId);
      })
      .catch(mapDbError);
  }

  /**
   * Deletes a stage. Its deals (lost ones too) move to `moveDealsTo`, another stage of the funnel,
   * each with a "moved" stage history row by the caller and a timeline entry; moving into the won
   * stage wins them, as a drag would. The funnel's last stage and its only won stage stay.
   *
   * The stage row is kept, marked deleted (see drizzle/0012_stage_soft_delete.sql), because the
   * deals' stage history points at it. Its playbook to-dos go with it; tasks from the "New task"
   * dialog move to the target stage (or the stage before it) so nobody's work disappears.
   */
  deleteStage(ctx: TenantContext, funnelId: string, stageId: string, query: DeleteStageQuery) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const funnel = await this.one(tx, funnelId);
        const stage = funnel.stages.find((s) => s.id === stageId);
        if (!stage) throw new NotFoundException('Stage not found');
        if (funnel.stages.length === 1) throw new ConflictException("A funnel needs at least one stage, so its last stage can't be deleted.");
        if (stage.isWon && funnel.stages.filter((s) => s.isWon).length === 1)
          throw new ConflictException("This is the funnel's won stage: deals are won by reaching it, so it can't be deleted.");

        const inStage = await tx.select().from(deals).where(eq(deals.stageId, stageId));
        let target = query.moveDealsTo ? funnel.stages.find((s) => s.id === query.moveDealsTo && s.id !== stageId) : undefined;
        if (query.moveDealsTo && !target) throw new BadRequestException('Move the deals to another stage of the same funnel');
        if (inStage.length && !target)
          throw new BadRequestException(`This stage has ${inStage.length} deal${inStage.length === 1 ? '' : 's'}. Pick the stage to move ${inStage.length === 1 ? 'it' : 'them'} to (moveDealsTo).`);
        if (target?.isWon && inStage.some((d) => d.lostAt))
          throw new ConflictException("Lost deals can't go to the won stage. Pick another stage, or reopen them first.");

        const now = new Date();
        if (target && inStage.length) {
          const t = target;
          await tx
            .update(deals)
            .set({ stageId: t.id, stageEnteredAt: now, closedAt: t.isWon ? now : null })
            .where(eq(deals.stageId, stageId));
          for (const deal of inStage) {
            const outcome = deal.lostAt ? 'lost' : t.isWon ? 'won' : 'open';
            await this.history.record(tx, ctx, { dealId: deal.id, kind: 'moved', fromStageId: stageId, toStageId: t.id, outcome }, now);
            await tx.insert(activities).values({ tenantId: ctx.tenantId, dealId: deal.id, actorUserId: ctx.userId, channel: t.channel, title: `Moved to ${t.name}`, detail: `The stage ${stage.name} was deleted.` });
            if (outcome === 'won') await this.jobs.send('crm.deal-won', { tenantId: ctx.tenantId, dealId: deal.id, actorUserId: ctx.userId }, tx);
          }
        }

        const rest = funnel.stages.filter((s) => s.id !== stageId);
        target ??= funnel.stages[funnel.stages.indexOf(stage) - 1] ?? rest[0]!;
        await tx.update(dealTasks).set({ stageId: target.id }).where(and(eq(dealTasks.stageId, stageId), eq(dealTasks.offPlaybook, true), eq(dealTasks.blocksAdvance, false)));
        await tx.delete(dealTasks).where(and(eq(dealTasks.stageId, stageId), or(not(dealTasks.offPlaybook), dealTasks.blocksAdvance)));
        await tx
          .update(funnelStages)
          .set({ deletedAt: now, key: sql`${funnelStages.key} || '~' || ${funnelStages.id}::text` })
          .where(eq(funnelStages.id, stageId));
        await this.renumber(tx, rest.map((s) => s.id));
        await this.audit.record(tx, ctx, { action: 'funnel.stage_deleted', entityType: 'funnel_stage', entityId: stageId, data: { movedDeals: inStage.length, to: query.moveDealsTo ?? null } });
        return this.one(tx, funnelId);
      })
      .catch(mapDbError);
  }

  private async renumber(tx: Tx, stageIds: string[]) {
    for (const [position, id] of stageIds.entries()) await tx.update(funnelStages).set({ position }).where(eq(funnelStages.id, id));
  }

  /**
   * Edits a stage. A new checklist keeps the deals' progress on every item whose id it keeps, even
   * when the item was renamed (CD-32): the to-dos follow the item's new label.
   */
  updateStage(ctx: TenantContext, funnelId: string, stageId: string, input: UpdateStage) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const where = and(eq(funnelStages.id, stageId), eq(funnelStages.funnelId, funnelId), notDeleted);
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

/** A stage row from a template (or a copied stage): new id, new checklist item ids. */
function stageRow(s: StageTemplate & { isWon?: boolean }, tenantId: string, funnelId: string, position: number) {
  return {
    key: s.key,
    name: s.name,
    activity: s.activity,
    channel: s.channel,
    documentOnEntry: s.documentOnEntry,
    winProbability: s.winProbability,
    checklistItems: newItems(s.checklist),
    isWon: s.isWon ?? s.key === 'won',
    tenantId,
    funnelId,
    position,
  };
}
