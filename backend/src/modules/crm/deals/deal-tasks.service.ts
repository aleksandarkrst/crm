import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, getTableColumns, not, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { TenantContext } from '../../../shared/authorization';
import { DatabaseService, type Tx } from '../../../shared/database/database.service';
import { mapDbError } from '../../../shared/database/errors';
import { activities, CHANNELS, dealTasks, funnelStages, memberships, users } from '../../../shared/database/schema';
import { nonEmptyPatch, optionalText, PaginationQuery } from '../../../shared/validation/common';
import { userNameOf } from '../owner';

const label = z.string().trim().max(200);
const TaskState = z.object({
  done: z.boolean().optional(),
  outcome: optionalText(200),
  note: optionalText(5000),
});
/** Fields of tasks created from the "New task" dialog (they don't block stage advance). */
const TaskPlanning = z.object({
  dueDate: z.iso.date().nullish(),
  /** Must be a member of the workspace. */
  assigneeUserId: z.uuid().nullish(),
  channel: z.enum(CHANNELS).nullish(),
});

/**
 * Playbook to-dos are identified by deal + stage + checklist item (CD-32). Clients from before
 * CD-32 send the item's label instead, which works while the item has that label.
 */
export const UpsertPlaybookTask = TaskState.extend({ stageId: z.uuid(), checklistItemId: z.uuid().optional(), label: label.min(1).optional() }).refine(
  (v) => v.checklistItemId || v.label,
  { message: 'checklistItemId is required', path: ['checklistItemId'] },
);
/** Off-playbook to-dos are added per deal (label may start empty while the user types it). */
export const CreateExtraTask = TaskState.extend({
  ...TaskPlanning.shape,
  stageId: z.uuid(),
  label,
  position: z.number().int().min(0).max(1000).optional(),
  blocksAdvance: z.boolean().optional(),
});
export const UpdateTask = nonEmptyPatch(TaskState.extend({ ...TaskPlanning.shape, label: label.optional() }));
export type UpsertPlaybookTask = z.infer<typeof UpsertPlaybookTask>;
export type CreateExtraTask = z.infer<typeof CreateExtraTask>;
export type UpdateTask = z.infer<typeof UpdateTask>;

/** Ticking a to-do records when and by whom; unticking clears it. */
function doneFields(ctx: TenantContext, done: boolean | undefined) {
  if (done === undefined) return {};
  return done ? { done, doneAt: new Date(), doneByUserId: ctx.userId } : { done, doneAt: null, doneByUserId: null };
}

/** The assignee's display name; rejects users who aren't members of this workspace. */
async function assertMember(tx: Tx, ctx: TenantContext, userId: string): Promise<string> {
  const [row] = await tx
    .select({ name: sql<string>`coalesce(${users.displayName}, ${users.email}, 'Member')` })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.tenantId, ctx.tenantId), eq(memberships.userId, userId)));
  if (!row) throw new BadRequestException('The owner must be a member of this workspace');
  return row.name;
}

/** Stage to-dos per deal: the playbook checklist state plus to-dos added off-playbook. */
@Injectable()
export class DealTasksService {
  constructor(private readonly database: DatabaseService) {}

  list(ctx: TenantContext, page: PaginationQuery) {
    return this.database.withTenant(ctx.tenantId, (tx) =>
      tx
        .select({
          ...getTableColumns(dealTasks),
          doneByName: sql<string | null>`coalesce(${users.displayName}, ${users.email})`,
          assigneeName: userNameOf(dealTasks.assigneeUserId),
        })
        .from(dealTasks)
        .leftJoin(users, eq(users.id, dealTasks.doneByUserId))
        .orderBy(asc(dealTasks.dealId), asc(dealTasks.position), asc(dealTasks.createdAt))
        .limit(page.limit)
        .offset(page.offset),
    );
  }

  /**
   * Ticks or annotates a playbook to-do; its row is created on first touch. By item id, the row
   * follows the item through renames; the label stored with it is the item's current label.
   */
  upsertPlaybook(ctx: TenantContext, dealId: string, input: UpsertPlaybookTask) {
    const { done, stageId, checklistItemId, label, ...rest } = input;
    const state = { ...rest, ...doneFields(ctx, done), updatedAt: new Date() };
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        let itemLabel = label!;
        if (checklistItemId) {
          const [stage] = await tx.select({ items: funnelStages.checklistItems }).from(funnelStages).where(eq(funnelStages.id, stageId));
          const item = stage?.items.find((i) => i.id === checklistItemId);
          if (!item) throw new BadRequestException("This to-do is not on the stage's checklist any more");
          itemLabel = item.label;
          const [row] = await tx
            .update(dealTasks)
            .set(state)
            .where(and(eq(dealTasks.dealId, dealId), eq(dealTasks.stageId, stageId), eq(dealTasks.checklistItemId, checklistItemId), not(dealTasks.offPlaybook)))
            .returning();
          if (row) return row;
        }
        const [row] = await tx
          .insert(dealTasks)
          .values({ ...state, tenantId: ctx.tenantId, dealId, stageId, label: itemLabel, checklistItemId: checklistItemId ?? null, offPlaybook: false })
          .onConflictDoUpdate({
            target: [dealTasks.dealId, dealTasks.stageId, dealTasks.label],
            targetWhere: sql`not ${dealTasks.offPlaybook}`,
            // An unlinked to-do with this label (its item was removed) is taken over by the item.
            set: checklistItemId ? { ...state, checklistItemId } : state,
          })
          .returning();
        return row!;
      })
      .catch(mapDbError);
  }

  /**
   * Adds an off-playbook to-do. With `blocksAdvance: false` it is a task from the "New task"
   * dialog: it gets a title, owner, due date and channel, and its creation goes on the timeline.
   */
  createExtra(ctx: TenantContext, dealId: string, input: CreateExtraTask) {
    const { done, ...rest } = input;
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        if (rest.blocksAdvance === false && !rest.label) throw new BadRequestException('A task needs a title');
        const owner = rest.assigneeUserId ? await assertMember(tx, ctx, rest.assigneeUserId) : null;
        const [row] = await tx
          .insert(dealTasks)
          .values({ ...rest, ...doneFields(ctx, done), tenantId: ctx.tenantId, dealId, offPlaybook: true })
          .returning();
        if (rest.blocksAdvance === false) {
          const detail = [rest.dueDate && 'Due ' + rest.dueDate, owner && 'Owner ' + owner, rest.note].filter(Boolean).join(' · ');
          await tx.insert(activities).values({ tenantId: ctx.tenantId, dealId, actorUserId: ctx.userId, channel: 'RS', title: 'Task added: ' + rest.label, detail: detail || null });
        }
        return row!;
      })
      .catch(mapDbError);
  }

  update(ctx: TenantContext, id: string, input: UpdateTask) {
    const { done, ...rest } = input;
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        if (rest.assigneeUserId) await assertMember(tx, ctx, rest.assigneeUserId);
        const [row] = await tx
          .update(dealTasks)
          .set({ ...rest, ...doneFields(ctx, done) })
          .where(eq(dealTasks.id, id))
          .returning();
        if (!row) throw new NotFoundException('To-do not found');
        return row;
      })
      .catch(mapDbError);
  }

  /**
   * Deleting a task from the "New task" dialog logs "Task removed" on the deal's timeline rather
   * than deleting its "Task added" entry: the timeline is the deal's history (who planned what,
   * and when it was dropped), and activities have no link to the task to match on safely.
   */
  remove(ctx: TenantContext, id: string) {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const [row] = await tx
        .delete(dealTasks)
        .where(eq(dealTasks.id, id))
        .returning({ dealId: dealTasks.dealId, label: dealTasks.label, offPlaybook: dealTasks.offPlaybook, blocksAdvance: dealTasks.blocksAdvance });
      if (!row) throw new NotFoundException('To-do not found');
      if (row.offPlaybook && !row.blocksAdvance)
        await tx.insert(activities).values({ tenantId: ctx.tenantId, dealId: row.dealId, actorUserId: ctx.userId, channel: 'RS', title: 'Task removed: ' + row.label, detail: null });
    });
  }
}
