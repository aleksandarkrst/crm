import { Injectable, NotFoundException } from '@nestjs/common';
import { asc, eq, getTableColumns, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { TenantContext } from '../../../shared/authorization';
import { DatabaseService } from '../../../shared/database/database.service';
import { mapDbError } from '../../../shared/database/errors';
import { dealTasks, users } from '../../../shared/database/schema';
import { optionalText, PaginationQuery } from '../../../shared/validation/common';

const label = z.string().trim().max(200);
const TaskState = z.object({
  done: z.boolean().optional(),
  outcome: optionalText(200),
  note: optionalText(5000),
});

/** Playbook to-dos are identified by deal + stage + checklist label. */
export const UpsertPlaybookTask = TaskState.extend({ stageId: z.uuid(), label: label.min(1) });
/** Off-playbook to-dos are added per deal (label may start empty while the user types it). */
export const CreateExtraTask = TaskState.extend({ stageId: z.uuid(), label, position: z.number().int().min(0).max(1000).optional() });
export const UpdateTask = TaskState.extend({ label: label.optional() });
export type UpsertPlaybookTask = z.infer<typeof UpsertPlaybookTask>;
export type CreateExtraTask = z.infer<typeof CreateExtraTask>;
export type UpdateTask = z.infer<typeof UpdateTask>;

/** Ticking a to-do records when and by whom; unticking clears it. */
function doneFields(ctx: TenantContext, done: boolean | undefined) {
  if (done === undefined) return {};
  return done ? { done, doneAt: new Date(), doneByUserId: ctx.userId } : { done, doneAt: null, doneByUserId: null };
}

/** Stage to-dos per deal: the playbook checklist state plus to-dos added off-playbook. */
@Injectable()
export class DealTasksService {
  constructor(private readonly database: DatabaseService) {}

  list(ctx: TenantContext, page: PaginationQuery) {
    return this.database.withTenant(ctx.tenantId, (tx) =>
      tx
        .select({ ...getTableColumns(dealTasks), doneByName: sql<string | null>`coalesce(${users.displayName}, ${users.email})` })
        .from(dealTasks)
        .leftJoin(users, eq(users.id, dealTasks.doneByUserId))
        .orderBy(asc(dealTasks.dealId), asc(dealTasks.position), asc(dealTasks.createdAt))
        .limit(page.limit)
        .offset(page.offset),
    );
  }

  upsertPlaybook(ctx: TenantContext, dealId: string, input: UpsertPlaybookTask) {
    const { done, ...rest } = input;
    const state = { ...rest, ...doneFields(ctx, done) };
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const [row] = await tx
          .insert(dealTasks)
          .values({ ...state, tenantId: ctx.tenantId, dealId, offPlaybook: false })
          .onConflictDoUpdate({
            target: [dealTasks.dealId, dealTasks.stageId, dealTasks.label],
            targetWhere: sql`not ${dealTasks.offPlaybook}`,
            set: { ...state, updatedAt: new Date() },
          })
          .returning();
        return row!;
      })
      .catch(mapDbError);
  }

  createExtra(ctx: TenantContext, dealId: string, input: CreateExtraTask) {
    const { done, ...rest } = input;
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const [row] = await tx
          .insert(dealTasks)
          .values({ ...rest, ...doneFields(ctx, done), tenantId: ctx.tenantId, dealId, offPlaybook: true })
          .returning();
        return row!;
      })
      .catch(mapDbError);
  }

  update(ctx: TenantContext, id: string, input: UpdateTask) {
    const { done, ...rest } = input;
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
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

  remove(ctx: TenantContext, id: string) {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const [row] = await tx.delete(dealTasks).where(eq(dealTasks.id, id)).returning({ id: dealTasks.id });
      if (!row) throw new NotFoundException('To-do not found');
    });
  }
}
