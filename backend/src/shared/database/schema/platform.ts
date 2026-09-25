import { sql } from 'drizzle-orm';
import { boolean, check, index, jsonb, pgTable, primaryKey, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Platform tables (owned by the identity module). These are NOT tenant-scoped by RLS:
 * they are how we figure out which tenants a user may access in the first place.
 */

export const tenants = pgTable(
  'tenants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    // Workspace settings (Settings → Workspace). Owners and admins change them.
    currency: text('currency').notNull().default('EUR'), // ISO 4217 code
    timezone: text('timezone').notNull().default('Europe/Belgrade'), // IANA time zone
    fiscalYearStartMonth: smallint('fiscal_year_start_month').notNull().default(1), // 1 = January
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('tenants_fiscal_month_ck', sql`${t.fiscalYearStartMonth} between 1 and 12`)],
);

export const PROFILE_LANGUAGES = ['en', 'sr', 'de'] as const;
export const DATE_FORMATS = ['DD.MM.YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'] as const;
export const START_PAGES = ['pipeline', 'overview', 'today', 'contacts'] as const;

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  // "<issuer>|<sub>" from the identity provider token. Stable per person per provider.
  authSubject: text('auth_subject').notNull().unique(),
  email: text('email'),
  displayName: text('display_name'),
  // True once the user has set their name in the profile; sign-ins then stop overwriting it.
  displayNameCustom: boolean('display_name_custom').notNull().default(false),
  // Profile settings. They are the user's own and apply in every workspace.
  jobTitle: text('job_title'),
  phone: text('phone'),
  language: text('language', { enum: PROFILE_LANGUAGES }).notNull().default('en'),
  dateFormat: text('date_format', { enum: DATE_FORMATS }).notNull().default('DD.MM.YYYY'),
  startPage: text('start_page', { enum: START_PAGES }).notNull().default('pipeline'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const MEMBERSHIP_ROLES = ['owner', 'admin', 'member'] as const;
export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];

export const memberships = pgTable(
  'memberships',
  {
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    role: text('role', { enum: MEMBERSHIP_ROLES }).notNull().default('member'),
    // Profile settings that belong to one workspace: its funnels, and a digest of its pipeline.
    // No foreign key: funnels are RLS-protected CRM rows; ProfileService checks the id with the
    // tenant set, a trigger clears it when the funnel is deleted (0021), and the UI falls back to
    // the first funnel for an id it doesn't know.
    defaultFunnelId: uuid('default_funnel_id'),
    dailyDigest: boolean('daily_digest').notNull().default(true),
    // Email me when someone else makes me the owner of a deal (CD-16).
    notifyDealAssigned: boolean('notify_deal_assigned').notNull().default(true),
    /** The getting-started checklist (CD-68) is dismissed per user, so each admin decides for themselves. */
    onboardingDismissedAt: timestamp('onboarding_dismissed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.userId] }), index('memberships_user_idx').on(t.userId)],
);

/** Tenant-scoped (RLS). Append-only record of critical business actions. */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id'),
    data: jsonb('data'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('audit_logs_tenant_created_idx').on(t.tenantId, t.createdAt)],
);

export const INVITATION_ROLES = ['admin', 'member'] as const;
/** Where the invitation email is: queued (waiting for the worker or retrying), sent, or failed after its retries. */
export const INVITATION_EMAIL_STATUSES = ['queued', 'sent', 'failed'] as const;

/**
 * An invitation to join a tenant, sent to an email address. The token is looked up by its SHA-256
 * hash; it is also kept encrypted with APP_SECRET (`token_sealed`) so the worker can email the
 * link and an admin can resend or copy it later (CD-7). Invitations from before CD-7 have none. Not tenant-scoped by RLS: accepting one
 * means finding it before the user is a member (the service always filters by tenant otherwise).
 */
export const invitations = pgTable(
  'invitations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    email: text('email').notNull(), // stored lower-case
    role: text('role', { enum: INVITATION_ROLES }).notNull().default('member'),
    tokenHash: text('token_hash').notNull().unique(),
    invitedByUserId: uuid('invited_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    acceptedByUserId: uuid('accepted_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    tokenSealed: text('token_sealed'),
    emailStatus: text('email_status', { enum: INVITATION_EMAIL_STATUSES }),
    emailSentAt: timestamp('email_sent_at', { withTimezone: true }),
    emailError: text('email_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('invitations_tenant_idx').on(t.tenantId)],
);
