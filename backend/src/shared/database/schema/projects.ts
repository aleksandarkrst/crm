import { sql } from 'drizzle-orm';
import { boolean, check, date, foreignKey, index, integer, numeric, pgTable, primaryKey, text, time, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { companies, deals } from './crm';
import { employees } from './people';
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

/**
 * A project's team (CD-271, design v2 §2 Team tab): employees from the org chart with their role on
 * the project and the hours a week they give it. Load (on the Team tab) adds up every open
 * project's hours of a person against their weekly hours. Deleting the project removes its team;
 * an employee who leaves stays listed (shown as inactive) until removed.
 */
export const projectMembers = pgTable(
  'project_members',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').notNull(),
    employeeId: uuid('employee_id').notNull(),
    role: text('role'),
    hoursPerWeek: numeric('hours_per_week', { precision: 4, scale: 1, mode: 'number' }).notNull().default(0),
    ...timestamps,
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.projectId, t.employeeId], name: 'project_members_pk' }),
    index('project_members_tenant_employee_idx').on(t.tenantId, t.employeeId),
    foreignKey({ columns: [t.tenantId, t.projectId], foreignColumns: [projects.tenantId, projects.id], name: 'project_members_project_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.tenantId, t.employeeId], foreignColumns: [employees.tenantId, employees.id], name: 'project_members_employee_fk' }).onDelete('cascade'),
    check('project_members_role_ck', sql`${t.role} is null or length(btrim(${t.role})) between 1 and 100`),
    check('project_members_hours_ck', sql`${t.hoursPerWeek} between 0 and 80`),
  ],
);

/** Where a project's file sits (design v2 Documents tab). */
export const PROJECT_FILE_FOLDERS = ['Contract', 'Brief', 'Design', 'Client material', 'Deliverable'] as const;
export type ProjectFileFolder = (typeof PROJECT_FILE_FOLDERS)[number];
/** The largest file someone can add to a project. */
export const MAX_PROJECT_FILE_BYTES = 25 * 1024 * 1024;

/**
 * A file added to a project (CD-271, Documents tab): the bytes are in storage under `storage_key`
 * (`projects/<projectId>/<id>`); the row says what it is, its folder and who added it. Deleting the
 * project deletes its rows (the service removes the stored files).
 */
export const projectFiles = pgTable(
  'project_files',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantId(),
    projectId: uuid('project_id').notNull(),
    name: text('name').notNull(),
    folder: text('folder', { enum: PROJECT_FILE_FOLDERS }).notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    storageKey: text('storage_key').notNull(),
    /** The task it was added to (CD-270), shown in the Documents tab as "Linked to: T-12"; cleared if the task goes. */
    taskId: uuid('task_id'),
    addedByUserId: uuid('added_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [
    unique('project_files_tenant_id_uq').on(t.tenantId, t.id),
    index('project_files_tenant_project_idx').on(t.tenantId, t.projectId),
    index('project_files_tenant_task_idx').on(t.tenantId, t.taskId),
    foreignKey({ columns: [t.tenantId, t.projectId], foreignColumns: [projects.tenantId, projects.id], name: 'project_files_project_fk' }).onDelete('cascade'),
    check('project_files_name_ck', sql`length(btrim(${t.name})) between 1 and 255`),
    check('project_files_folder_ck', sql`${t.folder} in ('Contract', 'Brief', 'Design', 'Client material', 'Deliverable')`),
    check('project_files_size_ck', sql`${t.sizeBytes} between 0 and 26214400`),
  ],
);


// ---------------------------------------------------------------- tasks (CD-146, design v2)

/** A task's status (design v2 §3, §4): the Tasks kanban columns and the task page's status bar. */
export const TASK_STATUSES = ['todo', 'in_progress', 'on_hold', 'done'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
/** The On hold dialog's reason presets (design v2 §4); any other text is allowed too. */
export const TASK_HOLD_REASONS = ['Waiting for the client', 'Waiting for another task', 'Waiting for access or keys', 'Assignee unavailable'] as const;
/** At most this many people on one task (CD-147). */
export const MAX_TASK_ASSIGNEES = 50;

/**
 * The last task number given out in a workspace (CD-146): tasks are numbered T-1, T-2, … per
 * workspace and a number is never reused, also after a delete. One row per workspace, raised with
 * `insert … on conflict do update … returning` in the transaction that creates the task.
 */
export const taskCounters = pgTable('task_counters', {
  tenantId: uuid('tenant_id')
    .primaryKey()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  lastNumber: integer('last_number').notNull().default(0),
});

/**
 * A task of a project (CD-146, design v2 §3, §4). It sits in one of the project type's stages
 * (`stage_id`; cleared when that stage is deleted, set again when the project changes type) and has
 * a status; On hold carries a reason. People work on it through `task_assignments`. Deleting the
 * project deletes its tasks.
 */
export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantId(),
    /** "T-142": per workspace, from `task_counters`. */
    number: integer('number').notNull(),
    projectId: uuid('project_id').notNull(),
    stageId: uuid('stage_id'),
    name: text('name').notNull(),
    status: text('status', { enum: TASK_STATUSES }).notNull().default('todo'),
    /** Why the work is paused: set with status `on_hold`, cleared when it leaves On hold. */
    onHoldReason: text('on_hold_reason'),
    description: text('description'),
    startDate: date('start_date'),
    dueDate: date('due_date'),
    estimateHours: numeric('estimate_hours', { precision: 6, scale: 2, mode: 'number' }),
    /** When it was last marked Done (cleared on reopen). */
    doneAt: timestamp('done_at', { withTimezone: true }),
    /**
     * The task this one waits for (CD-269): another task of the same project, never one that already
     * waits for this one (TasksService checks both). Cleared when that task is deleted
     * (`tasks_waits_for_fk`, drizzle/0066) or either one moves to another project.
     */
    waitsForTaskId: uuid('waits_for_task_id'),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [
    unique('tasks_tenant_id_uq').on(t.tenantId, t.id),
    unique('tasks_number_uq').on(t.tenantId, t.number),
    index('tasks_tenant_project_idx').on(t.tenantId, t.projectId),
    index('tasks_tenant_waits_for_idx').on(t.tenantId, t.waitsForTaskId),
    check('tasks_not_own_dependency_ck', sql`${t.waitsForTaskId} is null or ${t.waitsForTaskId} <> ${t.id}`),
    foreignKey({ columns: [t.tenantId, t.projectId], foreignColumns: [projects.tenantId, projects.id], name: 'tasks_project_fk' }).onDelete('cascade'),
    check('tasks_name_ck', sql`length(btrim(${t.name})) between 1 and 200`),
    check('tasks_status_ck', sql`${t.status} in ('todo', 'in_progress', 'on_hold', 'done')`),
    check('tasks_hold_reason_ck', sql`(${t.status} = 'on_hold') = (${t.onHoldReason} is not null) and (${t.onHoldReason} is null or length(btrim(${t.onHoldReason})) between 1 and 200)`),
    check('tasks_description_ck', sql`${t.description} is null or length(${t.description}) <= 10000`),
    check('tasks_dates_ck', sql`${t.dueDate} is null or ${t.startDate} is null or ${t.dueDate} >= ${t.startDate}`),
    check('tasks_estimate_ck', sql`${t.estimateHours} is null or (${t.estimateHours} between 0.25 and 9999 and mod(${t.estimateHours} * 4, 1) = 0)`),
  ],
);

/**
 * Who works on a task (CD-146, CD-147): employees from the org chart, with or without an account.
 * One row per person and task; removing someone sets `active = false` and keeps the row, so their
 * hours stay in the totals ("Not assigned any more"). Deleting the task or the employee removes it.
 */
export const taskAssignments = pgTable(
  'task_assignments',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id').notNull(),
    employeeId: uuid('employee_id').notNull(),
    active: boolean('active').notNull().default(true),
    /** Their hour limit on this task (CD-147): 0.25 to 9,999 h in quarter hours; null is no limit. */
    hourLimit: numeric('hour_limit', { precision: 6, scale: 2, mode: 'number' }),
    assignedByUserId: uuid('assigned_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.taskId, t.employeeId], name: 'task_assignments_pk' }),
    index('task_assignments_tenant_employee_idx').on(t.tenantId, t.employeeId),
    foreignKey({ columns: [t.tenantId, t.taskId], foreignColumns: [tasks.tenantId, tasks.id], name: 'task_assignments_task_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.tenantId, t.employeeId], foreignColumns: [employees.tenantId, employees.id], name: 'task_assignments_employee_fk' }).onDelete('cascade'),
    check('task_assignments_limit_ck', sql`${t.hourLimit} is null or (${t.hourLimit} between 0.25 and 9999 and mod(${t.hourLimit} * 4, 1) = 0)`),
  ],
);

/**
 * Stand-in hours per person and task (CD-147), unused since time entries (CD-152): nothing reads or
 * writes it. Kept one release so the release before keeps working on this schema (expand, then
 * contract); a later migration drops it.
 */
export const taskTimeFixtures = pgTable(
  'task_time_fixtures',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantId(),
    taskId: uuid('task_id').notNull(),
    employeeId: uuid('employee_id').notNull(),
    hours: numeric('hours', { precision: 6, scale: 2, mode: 'number' }).notNull(),
    approved: boolean('approved').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('task_time_fixtures_task_idx').on(t.tenantId, t.taskId),
    foreignKey({ columns: [t.tenantId, t.taskId], foreignColumns: [tasks.tenantId, tasks.id], name: 'task_time_fixtures_task_fk' }).onDelete('cascade'),
  ],
);

/**
 * How far someone's logged hours on a task are into their hour limit (CD-149, spec 10.3): 0 below
 * 80 %, 80 from 80 %, 100 from the limit. Only this state is stored, so each "Hour limit almost
 * reached" and "Hour limit reached" email goes once per crossing; the hours are summed when read.
 */
export const taskLimitAlerts = pgTable(
  'task_limit_alerts',
  {
    tenantId: tenantId(),
    taskId: uuid('task_id').notNull(),
    employeeId: uuid('employee_id').notNull(),
    level: integer('level').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.taskId, t.employeeId], name: 'task_limit_alerts_pk' }),
    foreignKey({ columns: [t.tenantId, t.taskId], foreignColumns: [tasks.tenantId, tasks.id], name: 'task_limit_alerts_task_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.tenantId, t.employeeId], foreignColumns: [employees.tenantId, employees.id], name: 'task_limit_alerts_employee_fk' }).onDelete('cascade'),
    check('task_limit_alerts_level_ck', sql`${t.level} in (0, 80, 100)`),
  ],
);

/** A task's checklist (CD-270): items in order, ticked when done. Deleting the task deletes them. */
export const taskChecklistItems = pgTable(
  'task_checklist_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantId(),
    taskId: uuid('task_id').notNull(),
    text: text('text').notNull(),
    done: boolean('done').notNull().default(false),
    position: integer('position').notNull(),
    ...timestamps,
  },
  (t) => [
    index('task_checklist_items_task_idx').on(t.tenantId, t.taskId, t.position),
    foreignKey({ columns: [t.tenantId, t.taskId], foreignColumns: [tasks.tenantId, tasks.id], name: 'task_checklist_items_task_fk' }).onDelete('cascade'),
    check('task_checklist_items_text_ck', sql`length(btrim(${t.text})) between 1 and 300`),
  ],
);

/** At most this many checklist items on a task. */
export const MAX_TASK_CHECKLIST_ITEMS = 100;

/** A comment on a task (CD-270), visible to everyone who can see the task. Deleting the task deletes them. */
export const taskComments = pgTable(
  'task_comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantId(),
    taskId: uuid('task_id').notNull(),
    authorUserId: uuid('author_user_id').references(() => users.id, { onDelete: 'set null' }),
    body: text('body').notNull(),
    ...timestamps,
  },
  (t) => [
    index('task_comments_task_idx').on(t.tenantId, t.taskId, t.createdAt),
    foreignKey({ columns: [t.tenantId, t.taskId], foreignColumns: [tasks.tenantId, tasks.id], name: 'task_comments_task_fk' }).onDelete('cascade'),
    check('task_comments_body_ck', sql`length(btrim(${t.body})) between 1 and 5000`),
  ],
);


// ---------------------------------------------------------------- work orders (CD-265, design v2 §5)

/** A work order's status: the Work orders kanban columns (design v2 §5). On hold carries a reason. */
export const WORK_ORDER_STATUSES = ['unscheduled', 'scheduled', 'in_progress', 'on_hold', 'completed'] as const;
export type WorkOrderStatus = (typeof WORK_ORDER_STATUSES)[number];
export const WORK_ORDER_TYPES = ['installation', 'repair', 'maintenance', 'inspection'] as const;
export type WorkOrderType = (typeof WORK_ORDER_TYPES)[number];
export const WORK_ORDER_PRIORITIES = ['normal', 'urgent'] as const;
/** Where the work is done (design v2 §6 Details). */
export const WORK_ORDER_PLACES = ['customer', 'workshop'] as const;
export type WorkOrderPlace = (typeof WORK_ORDER_PLACES)[number];
/** At most this many technicians on one work order (CD-259). */
export const MAX_WORK_ORDER_TECHNICIANS = 20;

/** The last work order number given out in a workspace: WO-1001, WO-1002, … never reused. */
export const workOrderCounters = pgTable('work_order_counters', {
  tenantId: uuid('tenant_id')
    .primaryKey()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  lastNumber: integer('last_number').notNull().default(1000),
});

/**
 * A work order (CD-265, design v2 §5): service work for a company, optionally within a project,
 * done by Service (or Both) technicians. Scheduled needs a technician, a date and a start time.
 */
export const workOrders = pgTable(
  'work_orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantId(),
    /** "WO-1044": per workspace, from `work_order_counters`. */
    number: integer('number').notNull(),
    title: text('title').notNull(),
    companyId: uuid('company_id').notNull(),
    projectId: uuid('project_id'),
    type: text('type', { enum: WORK_ORDER_TYPES }).notNull().default('repair'),
    priority: text('priority', { enum: WORK_ORDER_PRIORITIES }).notNull().default('normal'),
    status: text('status', { enum: WORK_ORDER_STATUSES }).notNull().default('unscheduled'),
    /** Why the work is paused: set with status `on_hold`, cleared when it leaves On hold. */
    holdReason: text('hold_reason'),
    scheduledDate: date('scheduled_date'),
    scheduledStart: time('scheduled_start'),
    /** Planned time in hours, in steps of 0.25. */
    durationHours: numeric('duration_hours', { precision: 5, scale: 2, mode: 'number' }).notNull().default(2),
    /** The site (address or name) at the customer. */
    location: text('location'),
    /** At the customer or in the workshop (CD-266). */
    workPlace: text('work_place', { enum: WORK_ORDER_PLACES }).notNull().default('customer'),
    equipment: text('equipment'),
    job: text('job'),
    /** Report and sign-off (CD-266): what was done, the materials used, who signed for the customer and when. */
    report: text('report'),
    materials: text('materials'),
    customerName: text('customer_name'),
    signedOffAt: timestamp('signed_off_at', { withTimezone: true }),
    signedOffByUserId: uuid('signed_off_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [
    unique('work_orders_tenant_id_uq').on(t.tenantId, t.id),
    unique('work_orders_number_uq').on(t.tenantId, t.number),
    index('work_orders_tenant_project_idx').on(t.tenantId, t.projectId),
    index('work_orders_tenant_company_idx').on(t.tenantId, t.companyId),
    foreignKey({ columns: [t.tenantId, t.companyId], foreignColumns: [companies.tenantId, companies.id], name: 'work_orders_company_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.tenantId, t.projectId], foreignColumns: [projects.tenantId, projects.id], name: 'work_orders_project_fk' }).onDelete('set null'),
    check('work_orders_title_ck', sql`length(btrim(${t.title})) between 1 and 200`),
    check('work_orders_status_ck', sql`${t.status} in ('unscheduled', 'scheduled', 'in_progress', 'on_hold', 'completed')`),
    check('work_orders_type_ck', sql`${t.type} in ('installation', 'repair', 'maintenance', 'inspection')`),
    check('work_orders_priority_ck', sql`${t.priority} in ('normal', 'urgent')`),
    check('work_orders_hold_reason_ck', sql`(${t.status} = 'on_hold') = (${t.holdReason} is not null) and (${t.holdReason} is null or length(btrim(${t.holdReason})) between 1 and 200)`),
    check('work_orders_scheduled_ck', sql`${t.status} <> 'scheduled' or (${t.scheduledDate} is not null and ${t.scheduledStart} is not null)`),
    check('work_orders_duration_ck', sql`${t.durationHours} between 0.25 and 99 and mod(${t.durationHours} * 4, 1) = 0`),
    check('work_orders_text_ck', sql`length(${t.location}) <= 300 and length(${t.equipment}) <= 300 and length(${t.job}) <= 10000 and length(${t.report}) <= 10000`),
    check('work_orders_place_ck', sql`${t.workPlace} in ('customer', 'workshop')`),
    check('work_orders_sign_off_ck', sql`length(${t.materials}) <= 5000 and length(${t.customerName}) <= 200 and (${t.signedOffAt} is null or ${t.customerName} is not null)`),
  ],
);

/** The technicians on a work order (CD-259): several, one of them the lead. */
export const workOrderTechnicians = pgTable(
  'work_order_technicians',
  {
    tenantId: tenantId(),
    workOrderId: uuid('work_order_id').notNull(),
    employeeId: uuid('employee_id').notNull(),
    isLead: boolean('is_lead').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.workOrderId, t.employeeId] }),
    uniqueIndex('work_order_technicians_lead_uq').on(t.tenantId, t.workOrderId).where(sql`${t.isLead}`),
    index('work_order_technicians_employee_idx').on(t.tenantId, t.employeeId),
    foreignKey({ columns: [t.tenantId, t.workOrderId], foreignColumns: [workOrders.tenantId, workOrders.id], name: 'work_order_technicians_wo_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.tenantId, t.employeeId], foreignColumns: [employees.tenantId, employees.id], name: 'work_order_technicians_employee_fk' }).onDelete('cascade'),
  ],
);

/** A work order's checklist (CD-266): the same items as a task's checklist. */
export const workOrderChecklistItems = pgTable(
  'work_order_checklist_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantId(),
    workOrderId: uuid('work_order_id').notNull(),
    text: text('text').notNull(),
    done: boolean('done').notNull().default(false),
    position: integer('position').notNull(),
    ...timestamps,
  },
  (t) => [
    index('work_order_checklist_items_wo_idx').on(t.tenantId, t.workOrderId, t.position),
    foreignKey({ columns: [t.tenantId, t.workOrderId], foreignColumns: [workOrders.tenantId, workOrders.id], name: 'work_order_checklist_items_wo_fk' }).onDelete('cascade'),
    check('work_order_checklist_items_text_ck', sql`length(btrim(${t.text})) between 1 and 300`),
  ],
);
