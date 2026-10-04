import { Injectable, NotFoundException } from '@nestjs/common';
import { desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { TenantContext } from '../../../shared/authorization';
import { DatabaseService, type Tx } from '../../../shared/database/database.service';
import { mapDbError } from '../../../shared/database/errors';
import { activities, CHANNELS, deals } from '../../../shared/database/schema';
import { optionalText } from '../../../shared/validation/common';

export const CreateActivity = z.object({
  channel: z.enum(CHANNELS),
  title: z.string().trim().min(1).max(300),
  detail: optionalText(5000),
  occurredAt: z.iso.datetime().optional(),
});
export type CreateActivity = z.infer<typeof CreateActivity>;

/** Channels that count as talking to the customer (resets the "days since contact" stall). */
const CONTACT_CHANNELS = new Set(['EM', 'LI', 'WA', 'MT', 'PH']);

@Injectable()
export class ActivitiesService {
  constructor(private readonly database: DatabaseService) {}

  list(ctx: TenantContext, dealId: string) {
    return this.database.withTenant(ctx.tenantId, (tx) =>
      tx.select().from(activities).where(eq(activities.dealId, dealId)).orderBy(desc(activities.occurredAt)).limit(500),
    );
  }

  create(ctx: TenantContext, dealId: string, input: CreateActivity) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
        const [row] = await tx
          .insert(activities)
          .values({ ...input, occurredAt, tenantId: ctx.tenantId, dealId, actorUserId: ctx.userId })
          .returning();
        if (CONTACT_CHANNELS.has(input.channel)) {
          const [deal] = await tx.update(deals).set({ lastContactAt: occurredAt }).where(eq(deals.id, dealId)).returning({ id: deals.id });
          if (!deal) throw new NotFoundException('Deal not found');
        }
        return row!;
      })
      .catch(mapDbError);
  }

  /**
   * A timeline entry written by another change, in its transaction (meetings, CD-130). With
   * `countsAsContact`, the deal's last contact moves to `occurredAt`, but never back in time
   * (marking last week's meeting as held after yesterday's call keeps yesterday).
   */
  async record(
    tx: Tx,
    ctx: TenantContext,
    dealId: string,
    entry: { channel: (typeof CHANNELS)[number]; title: string; detail: string | null; occurredAt?: Date },
    { countsAsContact = false } = {},
  ): Promise<void> {
    const occurredAt = entry.occurredAt ?? new Date();
    await tx.insert(activities).values({ ...entry, occurredAt, tenantId: ctx.tenantId, dealId, actorUserId: ctx.userId });
    if (countsAsContact) {
      await tx
        .update(deals)
        .set({ lastContactAt: sql`greatest(coalesce(${deals.lastContactAt}, ${occurredAt}), ${occurredAt})` })
        .where(eq(deals.id, dealId));
    }
  }
}
