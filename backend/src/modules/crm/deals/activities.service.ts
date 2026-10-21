import { Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { TenantContext } from '../../../shared/authorization';
import { DatabaseService, type Tx } from '../../../shared/database/database.service';
import { mapDbError } from '../../../shared/database/errors';
import { activities, CHANNELS, deals, memberships, users } from '../../../shared/database/schema';
import { optionalText } from '../../../shared/validation/common';

export const CreateActivity = z.object({
  channel: z.enum(CHANNELS),
  title: z.string().trim().min(1).max(300),
  detail: optionalText(5000),
  occurredAt: z.iso.datetime().optional(),
});
export type CreateActivity = z.infer<typeof CreateActivity>;

const FORMER_MEMBER = 'Former member';
const activityColumns = {
  id: activities.id,
  tenantId: activities.tenantId,
  dealId: activities.dealId,
  actorUserId: activities.actorUserId,
  channel: activities.channel,
  title: activities.title,
  detail: activities.detail,
  occurredAt: activities.occurredAt,
  createdAt: activities.createdAt,
};
export interface ActivityView {
  id: string;
  tenantId: string;
  dealId: string;
  actorUserId: string | null;
  channel: (typeof CHANNELS)[number] | null;
  title: string;
  detail: string | null;
  occurredAt: Date;
  createdAt: Date;
  /** null: the system. A member who left is "Former member" (userId null). */
  actor: { userId: string | null; name: string } | null;
}

/** Channels that count as talking to the customer (resets the "days since contact" stall). */
const CONTACT_CHANNELS = new Set(['EM', 'LI', 'WA', 'MT', 'PH']);

@Injectable()
export class ActivitiesService {
  constructor(private readonly database: DatabaseService) {}

  /** The deal's timeline, newest first, each entry with who did it (CD-318; null for the system). */
  list(ctx: TenantContext, dealId: string): Promise<ActivityView[]> {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      // The actor is named only while they are a member of this workspace; after that they are "Former member".
      const rows = await tx
        .select({ ...activityColumns, memberId: memberships.userId, actorName: sql<string | null>`coalesce(${users.displayName}, ${users.email})` })
        .from(activities)
        .leftJoin(memberships, and(eq(memberships.userId, activities.actorUserId), eq(memberships.tenantId, activities.tenantId)))
        .leftJoin(users, eq(users.id, memberships.userId))
        .where(eq(activities.dealId, dealId))
        .orderBy(desc(activities.occurredAt))
        .limit(500);
      return rows.map(({ actorName, memberId, ...row }) => ({
        ...row,
        actor: row.actorUserId ? (memberId && actorName ? { userId: memberId, name: actorName } : { userId: null, name: FORMER_MEMBER }) : null,
      }));
    });
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
          if (!deal) throw new NotFoundException('Opportunity not found');
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
        .set({ lastContactAt: sql`greatest(coalesce(${deals.lastContactAt}, ${occurredAt}::timestamptz), ${occurredAt}::timestamptz)` })
        .where(eq(deals.id, dealId));
    }
  }
}
