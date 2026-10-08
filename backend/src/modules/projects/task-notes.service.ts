import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { hasRole, type TenantContext } from '../../shared/authorization';
import { DatabaseService, type Tx } from '../../shared/database/database.service';
import { mapDbError } from '../../shared/database/errors';
import { MAX_TASK_CHECKLIST_ITEMS, taskChecklistItems, taskComments, users } from '../../shared/database/schema';
import { nonEmptyPatch } from '../../shared/validation/common';
import { TasksService } from './tasks.service';

const itemText = z.string().trim().min(1, 'Write the item').max(300, 'At most 300 characters');

/** POST /api/tasks/:id/checklist: a new item at the end. */
export const AddChecklistItem = z.object({ text: itemText });
export type AddChecklistItem = z.infer<typeof AddChecklistItem>;

/** PATCH /api/tasks/:id/checklist/:itemId: its text or whether it's done. */
export const UpdateChecklistItem = nonEmptyPatch(z.object({ text: itemText, done: z.boolean() }).partial());
export type UpdateChecklistItem = z.infer<typeof UpdateChecklistItem>;

/** POST /api/tasks/:id/comments. */
export const AddComment = z.object({ body: z.string().trim().min(1, 'Write a comment').max(5000, 'At most 5,000 characters') });
export type AddComment = z.infer<typeof AddComment>;

const commentColumns = {
  id: taskComments.id,
  body: taskComments.body,
  authorUserId: taskComments.authorUserId,
  authorName: sql<string | null>`(select coalesce(u.display_name, u.email) from ${users} u where u.id = ${taskComments.authorUserId})`,
  createdAt: taskComments.createdAt,
};

/**
 * A task's checklist and comments (CD-270, design v2 §4). Whoever can see the task reads them;
 * whoever can act on it (task-access.ts) ticks, adds and edits items and comments. A comment is
 * deleted by its author, owners or admins. Live updates: hint `task`.
 */
@Injectable()
export class TaskNotesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly tasks: TasksService,
  ) {}

  checklist(ctx: TenantContext, taskId: string) {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      await this.tasks.require(tx, ctx, taskId, 'read');
      return this.items(tx, taskId);
    });
  }

  addItem(ctx: TenantContext, taskId: string, input: AddChecklistItem) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        await this.tasks.require(tx, ctx, taskId, 'act');
        const [{ n, next }] = (await tx
          .select({ n: sql<number>`count(*)::int`, next: sql<number>`coalesce(max(${taskChecklistItems.position}) + 1, 0)::int` })
          .from(taskChecklistItems)
          .where(eq(taskChecklistItems.taskId, taskId))) as [{ n: number; next: number }];
        if (n >= MAX_TASK_CHECKLIST_ITEMS) throw new BadRequestException(`At most ${MAX_TASK_CHECKLIST_ITEMS} items on a checklist`);
        await tx.insert(taskChecklistItems).values({ tenantId: ctx.tenantId, taskId, text: input.text, position: next });
        return this.items(tx, taskId);
      })
      .catch(mapDbError);
  }

  updateItem(ctx: TenantContext, taskId: string, itemId: string, input: UpdateChecklistItem) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        await this.tasks.require(tx, ctx, taskId, 'act');
        const [row] = await tx
          .update(taskChecklistItems)
          .set(input)
          .where(and(eq(taskChecklistItems.id, itemId), eq(taskChecklistItems.taskId, taskId)))
          .returning({ id: taskChecklistItems.id });
        if (!row) throw new NotFoundException('Checklist item not found');
        return this.items(tx, taskId);
      })
      .catch(mapDbError);
  }

  removeItem(ctx: TenantContext, taskId: string, itemId: string) {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      await this.tasks.require(tx, ctx, taskId, 'act');
      const [row] = await tx
        .delete(taskChecklistItems)
        .where(and(eq(taskChecklistItems.id, itemId), eq(taskChecklistItems.taskId, taskId)))
        .returning({ id: taskChecklistItems.id });
      if (!row) throw new NotFoundException('Checklist item not found');
      return this.items(tx, taskId);
    });
  }

  /** Oldest first, as a conversation reads. */
  comments(ctx: TenantContext, taskId: string) {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      await this.tasks.require(tx, ctx, taskId, 'read');
      return this.commentList(tx, taskId);
    });
  }

  addComment(ctx: TenantContext, taskId: string, input: AddComment) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        await this.tasks.require(tx, ctx, taskId, 'act');
        await tx.insert(taskComments).values({ tenantId: ctx.tenantId, taskId, authorUserId: ctx.userId, body: input.body });
        return this.commentList(tx, taskId);
      })
      .catch(mapDbError);
  }

  removeComment(ctx: TenantContext, taskId: string, commentId: string) {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      await this.tasks.require(tx, ctx, taskId, 'read');
      const [row] = await tx
        .select({ authorUserId: taskComments.authorUserId })
        .from(taskComments)
        .where(and(eq(taskComments.id, commentId), eq(taskComments.taskId, taskId)));
      if (!row) throw new NotFoundException('Comment not found');
      if (row.authorUserId !== ctx.userId && !hasRole(ctx.role, 'admin')) throw new ForbiddenException('Only the author, owners and admins can delete a comment');
      await tx.delete(taskComments).where(eq(taskComments.id, commentId));
      return this.commentList(tx, taskId);
    });
  }

  private items(tx: Tx, taskId: string) {
    return tx
      .select({ id: taskChecklistItems.id, text: taskChecklistItems.text, done: taskChecklistItems.done, position: taskChecklistItems.position })
      .from(taskChecklistItems)
      .where(eq(taskChecklistItems.taskId, taskId))
      .orderBy(asc(taskChecklistItems.position));
  }

  private commentList(tx: Tx, taskId: string) {
    return tx.select(commentColumns).from(taskComments).where(eq(taskComments.taskId, taskId)).orderBy(asc(taskComments.createdAt));
  }
}
