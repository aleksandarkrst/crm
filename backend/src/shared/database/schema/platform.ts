import { sql } from 'drizzle-orm';
import { boolean, check, index, jsonb, pgTable, primaryKey, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Platform tables (owned by the identity module). These are NOT tenant-scoped by RLS:
 * they are how we figure out which tenants a user may access in the first place.
 */

export const CUSTOMER_EMAIL_LANGUAGES = ['en', 'sr'] as const;
export type CustomerEmailLanguage = (typeof CUSTOMER_EMAIL_LANGUAGES)[number];

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
    // Language of the fixed text in emails to customers, e.g. external meeting minutes (CD-208).
    customerEmailLanguage: text('customer_email_language', { enum: CUSTOMER_EMAIL_LANGUAGES }).notNull().default('en'),
    // Settings → Employees (milestone 13, spec 10.3): prefill of new employees' weekly hours, whether
    // an employee number is required, and whether employees may change their own bank account.
    employeeDefaultWeeklyHours: smallint('employee_default_weekly_hours').notNull().default(40),
    employeeNumberRequired: boolean('employee_number_required').notNull().default(false),
    employeeSelfEditBank: boolean('employee_self_edit_bank').notNull().default(true),
    // The CEO (CD-225): the top of the org chart's company node, an active employee of this
    // workspace. Not a "No manager" data issue. The foreign key (id, ceo_employee_id) → employees
    // (tenant_id, id) ON DELETE SET NULL (ceo_employee_id) is in drizzle/0046_tenant_ceo.sql;
    // deactivating the CEO clears it (people's applyDeactivation).
    ceoEmployeeId: uuid('ceo_employee_id'),
    /** "Create a project when a deal is won" (CD-233, Settings → Workspace): off by default. */
    autoCreateProjects: boolean('auto_create_projects').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('tenants_fiscal_month_ck', sql`${t.fiscalYearStartMonth} between 1 and 12`),
    check('tenants_customer_email_language_ck', sql`${t.customerEmailLanguage} in ('en', 'sr')`),
    check('tenants_employee_weekly_hours_ck', sql`${t.employeeDefaultWeeklyHours} between 1 and 60`),
  ],
);

export const PROFILE_LANGUAGES = ['en', 'sr', 'de'] as const;
export const DATE_FORMATS = ['DD.MM.YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'] as const;
export const START_PAGES = ['pipeline', 'overview', 'today', 'contacts'] as const;
/** Onboarding steps that are stored (CD-115). The workspace step is done once the user has a membership. */
export const ONBOARDING_USER_STEPS = ['profile', 'team'] as const;
export type OnboardingUserStep = (typeof ONBOARDING_USER_STEPS)[number];

export const users = pgTable(
  'users',
  {
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
    // Onboarding after the first sign-up (CD-115): the steps finished so far, so a refresh or a new
    // session resumes where the user left off, and when it was completed (null = still onboarding).
    onboardingSteps: text('onboarding_steps').array().$type<OnboardingUserStep[]>().notNull().default(sql`'{}'::text[]`),
    onboardedAt: timestamp('onboarded_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  // Finds the account an email address already has, whichever way it signs in (CD-114).
  (t) => [index('users_email_lower_idx').on(sql`lower(${t.email})`)],
);

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
    // Email me (with an .ics) when someone else adds me to a meeting, or changes or cancels it (CD-207).
    notifyMeetingInvites: boolean('notify_meeting_invites').notNull().default(true),
    // Email me when someone else creates or changes my visit plan (CD-207).
    notifyVisitPlans: boolean('notify_visit_plans').notNull().default(true),
    // Email me about org changes: a new manager, a new direct report (milestone 13, spec 10.2).
    notifyOrgChanges: boolean('notify_org_changes').notNull().default(true),
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
export type InvitationRole = (typeof INVITATION_ROLES)[number];
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
    /**
     * The employee record the invitation was sent from (milestone 13, spec 4.7): accepting it links
     * the new member to that record. The foreign key (tenant_id, employee_id) → employees is in
     * drizzle/0039_people_rls.sql (ON DELETE SET NULL (employee_id)).
     */
    employeeId: uuid('employee_id'),
    /**
     * Administration / Payroll the inviting Admin ticked (CD-224). Unused since CD-225 removed those
     * roles: always empty for new invitations, ignored on acceptance; a later migration may drop it.
     */
    assignedRoles: text('assigned_roles').array().$type<('administration' | 'payroll')[]>().notNull().default(sql`'{}'::text[]`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('invitations_tenant_idx').on(t.tenantId),
    index('invitations_employee_idx').on(t.employeeId),
    check('invitations_assigned_roles_ck', sql`${t.assignedRoles} <@ array['administration', 'payroll']::text[]`),
  ],
);

/**
 * Creating an account with email and password (CD-114): someone asked for a confirmation email.
 * The link's token is looked up by its SHA-256 hash and kept encrypted with APP_SECRET
 * (`token_sealed`) so the worker can email it. It works once (`used_at`) until `expires_at`; a new
 * request for the same address deletes the older ones. Not tenant-scoped: there is no user yet.
 */
export const signupRequests = pgTable(
  'signup_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(), // stored lower-case
    // 'signup': confirms the address before the account exists; 'reset': "Forgot password?".
    purpose: text('purpose').$type<'signup' | 'reset'>().notNull().default('signup'),
    tokenHash: text('token_hash').notNull().unique(),
    tokenSealed: text('token_sealed').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('signup_requests_email_idx').on(t.email)],
);
