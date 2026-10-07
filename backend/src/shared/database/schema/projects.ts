import { sql } from 'drizzle-orm';
import { check, foreignKey, index, integer, pgTable, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { companies } from './crm';
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
    index('projects_tenant_deal_idx').on(t.tenantId, t.dealId),
    index('projects_tenant_company_idx').on(t.tenantId, t.companyId),
    foreignKey({ columns: [t.tenantId, t.projectTypeId], foreignColumns: [projectTypes.tenantId, projectTypes.id], name: 'projects_type_fk' }),
    foreignKey({ columns: [t.tenantId, t.projectTypeId, t.stageId], foreignColumns: [projectStages.tenantId, projectStages.projectTypeId, projectStages.id], name: 'projects_stage_fk' }),
    foreignKey({ columns: [t.tenantId, t.companyId], foreignColumns: [companies.tenantId, companies.id], name: 'projects_company_fk' }),
    check('projects_name_ck', sql`length(btrim(${t.name})) between 1 and 200`),
  ],
);
