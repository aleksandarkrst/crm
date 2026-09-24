import { date, index, integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { tenants, users } from './platform';

/**
 * Notification tables (owned by the notifications module). Tenant-scoped, protected by RLS
 * (drizzle/0014_daily_digests_rls.sql).
 */

export const DIGEST_STATUSES = ['sending', 'sent', 'skipped', 'failed'] as const;

/**
 * One row per member, workspace and local date once that day's digest was handled: sent, skipped
 * because it had nothing in it, or failed after its retries. It makes the digest go out at most
 * once a day however often the scheduler looks.
 */
export const dailyDigests = pgTable(
  'daily_digests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    digestDate: date('digest_date').notNull(), // the workspace's local date
    status: text('status', { enum: DIGEST_STATUSES }).notNull(),
    itemCount: integer('item_count').notNull().default(0),
    error: text('error'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('daily_digests_tenant_id_uq').on(t.tenantId, t.id),
    unique('daily_digests_member_date_uq').on(t.tenantId, t.userId, t.digestDate),
    index('daily_digests_tenant_date_idx').on(t.tenantId, t.digestDate),
  ],
);
