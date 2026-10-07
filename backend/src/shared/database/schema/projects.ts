import { sql } from 'drizzle-orm';
import { check, date, foreignKey, index, integer, numeric, pgTable, primaryKey, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { companies, deals } from './crm';
import { tenants, users } from './platform';

/**
 * Projects tables (owned by the projects module, milestone 14). Every table carries tenant_id and
 * is protected by row-level security (drizzle/0051_projects_rls.sql); references use composite
 * (tenant_id, id) foreign keys, as in the CRM.
 *
 * A project type is a set of ordered stages for one kind of project, like a funnel in the CRM
 * (design v2, CD-272). A project is on one type and in one of its stages; Complete and Cancel are
 * its status, not stages.
 */

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

const tenantId = () =>
  uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' });

/** At most this many types per workspace, and stages per type. */
export const MAX_PROJECT_TYPES = 30;
export const MAX_PROJECT_STAGES = 20;

/** A project type ("Website", "Service installation"): name unique per workspace (case-insensitive, trimmed). */
export const projectTypes = pgTable(
  'project_types',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    position: integer('position').notNull(),
    ...timestamps,
  },
  (t) => [
    unique('project_types_tenant_id_uq').on(t.tenantId, t.id),
    uniqueIndex('project_types_name_uq').on(t.tenantId, sql`lower(btrim(${t.name}))`),
    check('project_types_name_ck', sql`length(btrim(${t.name})) between 1 and 60`),
  ],
);

/**
 * A stage of a project type, in `position` order. Deleting the type deletes its stages; deleting a
 * stage that holds projects is refused by projects_stage_fk (the service moves them first).
 */
export const projectStages = pgTable(
  'project_stages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantId(),
    projectTypeId: uuid('project_type_id').notNull(),
    name: text('name').notNull(),
    position: integer('position').notNull(),
    ...timestamps,
  },
  (t) => [
    unique('project_stages_tenant_id_uq').on(t.tenantId, t.id),
    // The target of projects_stage_fk: a project's stage is always a stage of its type.
    unique('project_stages_tenant_type_id_uq').on(t.tenantId, t.projectTypeId, t.id),
    uniqueIndex('project_stages_name_uq').on(t.tenantId, t.projectTypeId, sql`lower(btrim(${t.name}))`),
    foreignKey({ columns: [t.tenantId, t.projectTypeId], foreignColumns: [projectTypes.tenantId, projectTypes.id], name: 'project_stages_type_fk' }).onDelete('cascade'),
    check('project_stages_name_ck', sql`length(btrim(${t.name})) between 1 and 60`),
  ],
);

export const PROJECT_STATUSES = ['open', 'completed', 'cancelled'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
/** Design v2: how the project is going, set by its lead. */
export const PROJECT_HEALTHS = ['on_track', 'at_risk', 'off_track'] as const;
export type ProjectHealth = (typeof PROJECT_HEALTHS)[number];
/** The Cancel project dialog's reasons (design v2 §2). */
export const PROJECT_CANCEL_REASONS = ['Client cancelled', 'Budget cut', 'Scope moved to another project', 'Other'] as const;

/**
 * A client project: always one CRM company, optionally the deal it came from (a deal of that
 * company; one deal can have several projects). The company can't be deleted while it has
 * projects (no cascade); deleting the deal clears `deal_id` (projects_deal_fk is in drizzle/0051:
 * ON DELETE SET NULL (deal_id) nulls only that column, which Drizzle can't express). `lead_user_id` is the
 * project lead (a member when set; cleared if the user is deleted).
 */
export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    projectTypeId: uuid('project_type_id').notNull(),
    stageId: uuid('stage_id').notNull(),
    status: text('status', { enum: PROJECT_STATUSES }).notNull().default('open'),
    /** Why it was cancelled (set with status `cancelled`, cleared on reopen). */
    cancelReason: text('cancel_reason', { enum: PROJECT_CANCEL_REASONS }),
    /** Spec 3.2: optional, up to 20 characters, unique among open projects; shown before the name in pickers. */
    code: text('code'),
    description: text('description'),
    startDate: date('start_date'),
    endDate: date('end_date'),
    health: text('health', { enum: PROJECT_HEALTHS }).notNull().default('on_track'),
    /** Design v2 Details: what the project is worth (a won deal's amount when it starts from one), in `currency`. */
    value: numeric('value', { precision: 14, scale: 2 }),
    /** ISO 4217; the workspace currency when null. */
    currency: text('currency'),
    /** Design v2 Details: the hours planned for the project. */
    budgetHours: numeric('budget_hours', { precision: 8, scale: 1 }),
    companyId: uuid('company_id').notNull(),
    dealId: uuid('deal_id'),
    leadUserId: uuid('lead_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [
    unique('projects_tenant_id_uq').on(t.tenantId, t.id),
    // Spec 3.2: unique among the open projects of the same client (case-insensitive, trimmed).
    uniqueIndex('projects_name_uq').on(t.tenantId, t.companyId, sql`lower(btrim(${t.name}))`).where(sql`${t.status} = 'open'`),
    uniqueIndex('projects_code_uq').on(t.tenantId, sql`lower(${t.code})`).where(sql`${t.code} is not null and ${t.status} = 'open'`),
    index('projects_tenant_deal_idx').on(t.tenantId, t.dealId),
    index('projects_tenant_company_idx').on(t.tenantId, t.companyId),
    foreignKey({ columns: [t.tenantId, t.projectTypeId], foreignColumns: [projectTypes.tenantId, projectTypes.id], name: 'projects_type_fk' }),
    foreignKey({ columns: [t.tenantId, t.projectTypeId, t.stageId], foreignColumns: [projectStages.tenantId, projectStages.projectTypeId, projectStages.id], name: 'projects_stage_fk' }),
    foreignKey({ columns: [t.tenantId, t.companyId], foreignColumns: [companies.tenantId, companies.id], name: 'projects_company_fk' }),
    check('projects_name_ck', sql`length(btrim(${t.name})) between 1 and 200`),
    check('projects_code_ck', sql`${t.code} is null or length(btrim(${t.code})) between 1 and 20`),
    check('projects_description_ck', sql`${t.description} is null or length(${t.description}) <= 5000`),
    check('projects_dates_ck', sql`${t.startDate} is null or ${t.endDate} is null or ${t.endDate} >= ${t.startDate}`),
    check('projects_value_ck', sql`${t.value} is null or ${t.value} >= 0`),
    check('projects_budget_hours_ck', sql`${t.budgetHours} is null or ${t.budgetHours} >= 0`),
    check('projects_currency_ck', sql`${t.currency} is null or ${t.currency} ~ '^[A-Z]{3}$'`),
    check('projects_health_ck', sql`${t.health} in ('on_track', 'at_risk', 'off_track')`),
    check('projects_status_ck', sql`${t.status} in ('open', 'completed', 'cancelled')`),
  ],
);

/**
 * Deals that already got a project from "Create a project when a deal is won" (CD-233): one row per
 * deal, written in the same transaction as the project, so winning it again (after a reopen) never
 * creates a second one, even after that project is deleted. Deleting the deal deletes its row.
 */
export const projectAutoDeals = pgTable(
  'project_auto_deals',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    dealId: uuid('deal_id').notNull(),
    projectId: uuid('project_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.dealId], name: 'project_auto_deals_pk' }),
    foreignKey({ columns: [t.tenantId, t.dealId], foreignColumns: [deals.tenantId, deals.id], name: 'project_auto_deals_deal_fk' }).onDelete('cascade'),
  ],
);
