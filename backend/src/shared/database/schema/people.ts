import { sql } from 'drizzle-orm';
import { boolean, check, date, foreignKey, index, integer, jsonb, numeric, pgTable, primaryKey, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { tenants, users } from './platform';

/**
 * People tables (owned by the people module, milestone 13): employees, their personal details and
 * bank account, departments, teams and the assigned functional roles. Every table carries
 * tenant_id, has row-level security and uses composite (tenant_id, id) foreign keys, like the CRM
 * tables. The custom migration (drizzle/0039_people_rls.sql) adds what Drizzle can't express:
 * RLS, the foreign keys that null one column (ON DELETE SET NULL (column)), the team-in-department
 * key, versions (If-Match), change history, live updates, the search text and the backfill.
 *
 * Who may see and change what is enforced in the people module's services (PeopleAccess), not by
 * RLS (spec Q10): RLS only separates workspaces.
 */

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  // Set by the crm_touch_version trigger: the version clients send back in If-Match.
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

const tenantId = () =>
  uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' });

/** Work type (CD-268): Office gets project tasks, Service work orders, Both either. */
export const WORK_TYPES = ['office', 'service', 'both'] as const;
export type WorkType = (typeof WORK_TYPES)[number];

export const EMPLOYMENT_TYPES = ['permanent', 'fixed_term', 'contractor', 'student'] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];
export const LEAVING_REASONS = ['resigned', 'contract_ended', 'dismissed', 'retired', 'other'] as const;
export type LeavingReason = (typeof LEAVING_REASONS)[number];

/** A scheduled deactivation's choices (employees.deactivation_plan). Employee ids; null means "nobody". */
export interface DeactivationPlan {
  /** New manager of the leaving person's direct reports ("No manager" = null). */
  reportsManagerId: string | null;
  /** The new lead of the unit they lead (CD-226; drizzle/0048 converted older plans). */
  unitLeads?: { unitId: string; employeeId: string | null }[];
  /**
   * Before CD-226. Still written (empty) so a rolled-back release can read new plans; a plan the
   * previous release wrote after the migration is read through these (unit ids = their ids).
   */
  teamLeads: { teamId: string; employeeId: string | null }[];
  departmentHeads: { departmentId: string; employeeId: string | null }[];
  /** Who scheduled it (the audit entry when the job applies it). */
  byUserId: string;
}
/** Functional roles that an Admin assigns (spec 9.1). Employee, Manager and Admin are derived. */
export const ASSIGNED_ROLES = ['administration', 'payroll'] as const;
export type AssignedRole = (typeof ASSIGNED_ROLES)[number];

/** At most this many organization levels per workspace (CD-226). */
export const MAX_ORG_LEVELS = 5;

/**
 * The named levels of the org structure (CD-226), top-down by `position` (1 = top): Department and
 * Team by default (made by drizzle/0048 for existing workspaces and on first read for new ones).
 * Admins rename, reorder and add them (up to 5); a level with units can't be removed. Positions are
 * kept 1..n by OrgService (no unique index: a reorder rewrites several rows).
 */
export const orgLevels = pgTable(
  'org_levels',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantId(),
    position: integer('position').notNull(),
    name: text('name').notNull(),
    ...timestamps,
  },
  (t) => [
    unique('org_levels_tenant_id_uq').on(t.tenantId, t.id),
    uniqueIndex('org_levels_name_uq').on(t.tenantId, sql`lower(btrim(${t.name}))`),
    check('org_levels_name_ck', sql`length(btrim(${t.name})) between 1 and 50`),
    check('org_levels_position_ck', sql`${t.position} between 1 and 20`),
  ],
);

/**
 * A unit of the org structure (CD-226): a department, team, sector… of one level, inside a unit of
 * a higher level (`parent_id`) or directly under the company. Name unique within its parent, code
 * unique when set. The parent's level must be higher (trigger `org_units_check_parent`, which also
 * makes loops impossible). `lead_employee_id` is the unit's Lead: a member of the unit, leading at
 * most one unit. Units of departments and teams kept their ids (drizzle/0048).
 * Foreign keys that null one column (lead, employees.unit_id) are in the custom migration.
 */
export const orgUnits = pgTable(
  'org_units',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantId(),
    levelId: uuid('level_id').notNull(),
    parentId: uuid('parent_id'),
    name: text('name').notNull(),
    code: text('code'),
    leadEmployeeId: uuid('lead_employee_id'),
    ...timestamps,
  },
  (t) => [
    unique('org_units_tenant_id_uq').on(t.tenantId, t.id),
    uniqueIndex('org_units_name_uq').on(t.tenantId, sql`coalesce(${t.parentId}, '00000000-0000-0000-0000-000000000000'::uuid)`, sql`lower(btrim(${t.name}))`),
    uniqueIndex('org_units_code_uq').on(t.tenantId, sql`lower(${t.code})`).where(sql`${t.code} is not null`),
    // A person leads at most one unit.
    uniqueIndex('org_units_lead_uq').on(t.tenantId, t.leadEmployeeId).where(sql`${t.leadEmployeeId} is not null`),
    index('org_units_tenant_parent_idx').on(t.tenantId, t.parentId),
    foreignKey({ columns: [t.tenantId, t.levelId], foreignColumns: [orgLevels.tenantId, orgLevels.id], name: 'org_units_level_fk' }),
    foreignKey({ columns: [t.tenantId, t.parentId], foreignColumns: [t.tenantId, t.id], name: 'org_units_parent_fk' }),
    check('org_units_name_ck', sql`length(btrim(${t.name})) between 1 and 100`),
    check('org_units_code_ck', sql`${t.code} is null or length(${t.code}) between 1 and 20`),
    check('org_units_not_own_parent_ck', sql`${t.parentId} is null or ${t.parentId} <> ${t.id}`),
  ],
);

/**
 * The top level of the org structure before CD-226 (replaced by org_units; nothing reads or
 * writes it since, a later migration drops it). Name unique per workspace (case-insensitive, trimmed), code
 * unique when set. Deleting one is refused while it has teams (teams_department_fk); its employees
 * then have no department (employees_department_fk, custom migration).
 */
export const departments = pgTable(
  'departments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    code: text('code'),
    /** Employee heading the department (FK in the custom migration: ON DELETE SET NULL (head_employee_id)). */
    headEmployeeId: uuid('head_employee_id'),
    ...timestamps,
  },
  (t) => [
    unique('departments_tenant_id_uq').on(t.tenantId, t.id),
    uniqueIndex('departments_name_uq').on(t.tenantId, sql`lower(btrim(${t.name}))`),
    uniqueIndex('departments_code_uq').on(t.tenantId, sql`lower(${t.code})`).where(sql`${t.code} is not null`),
    check('departments_name_ck', sql`length(btrim(${t.name})) between 1 and 100`),
    check('departments_code_ck', sql`${t.code} is null or length(${t.code}) between 1 and 20`),
  ],
);

/** A group inside exactly one department. Unused since CD-226 (org_units), like departments. */
export const teams = pgTable(
  'teams',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantId(),
    departmentId: uuid('department_id').notNull(),
    name: text('name').notNull(),
    /** Employee leading the team (FK in the custom migration: ON DELETE SET NULL (lead_employee_id)). */
    leadEmployeeId: uuid('lead_employee_id'),
    ...timestamps,
  },
  (t) => [
    unique('teams_tenant_id_uq').on(t.tenantId, t.id),
    // Target of employees_team_fk: an employee's team must belong to the employee's department.
    unique('teams_tenant_department_id_uq').on(t.tenantId, t.departmentId, t.id),
    uniqueIndex('teams_name_uq').on(t.tenantId, t.departmentId, sql`lower(btrim(${t.name}))`),
    foreignKey({ columns: [t.tenantId, t.departmentId], foreignColumns: [departments.tenantId, departments.id], name: 'teams_department_fk' }).onUpdate('cascade'),
    check('teams_name_ck', sql`length(btrim(${t.name})) between 1 and 100`),
  ],
);

/**
 * A person who works for the company (spec 4.2), with or without an app account. `user_id` links
 * them 1:1 to a member of the workspace (spec 4.6). Status is derived: inactive when
 * `deactivated_at` is set, leaving when an end date is set but not yet applied, else active.
 *
 * Foreign keys that null one column live in the custom migration: manager (employees_manager_fk),
 * department (employees_department_fk) and team (employees_team_fk, on (tenant_id, department_id,
 * team_id) → teams, so a team always belongs to the employee's department, and moving a team to
 * another department moves its members with it: ON UPDATE CASCADE).
 */
export const employees = pgTable(
  'employees',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantId(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    /** "First Last", for display and history labels. */
    fullName: text('full_name')
      .notNull()
      .generatedAlwaysAs(sql`first_name || ' ' || last_name`),
    /**
     * Accent-free lower-case "first last job title work email" (people_fold, set by a trigger), so
     * "petrovic" finds "Petrović". Search with `search_text like '%' || people_fold(query) || '%'`.
     */
    searchText: text('search_text').notNull().default(''),
    workEmail: text('work_email'), // stored lower-case
    employeeNumber: text('employee_number'),
    jobTitle: text('job_title'),
    /** Before CD-226; unused since (unit_id), dropped by a later migration. */
    departmentId: uuid('department_id'),
    teamId: uuid('team_id'),
    /** The org unit they belong to (CD-226; FK employees_unit_fk in the custom migration: ON DELETE SET NULL (unit_id)). */
    unitId: uuid('unit_id'),
    managerId: uuid('manager_id'),
    workPhone: text('work_phone'),
    workLocation: text('work_location'),
    employmentStartDate: date('employment_start_date'),
    employmentType: text('employment_type', { enum: EMPLOYMENT_TYPES }).notNull().default('permanent'),
    weeklyHours: numeric('weekly_hours', { precision: 4, scale: 1, mode: 'number' }).notNull().default(40),
    timesheetRequired: boolean('timesheet_required').notNull().default(true),
    attendanceTracked: boolean('attendance_tracked').notNull().default(false),
    /** What they can be given (CD-268): office staff get project tasks, service staff work orders, both either. */
    workType: text('work_type', { enum: WORK_TYPES }).notNull().default('office'),
    /** Set only through Deactivate (spec 4.8). */
    employmentEndDate: date('employment_end_date'),
    /** When the deactivation was applied (status Inactive). */
    deactivatedAt: timestamp('deactivated_at', { withTimezone: true }),
    leavingReason: text('leaving_reason', { enum: LEAVING_REASONS }),
    /**
     * What a deactivation with a future last working day will do on the day after it (spec 4.8,
     * the daily job people.deactivate-due): the new manager of the direct reports and the
     * replacements of team leads and department heads chosen in the dialog. Null otherwise.
     */
    deactivationPlan: jsonb('deactivation_plan').$type<DeactivationPlan>(),
    /** First time a member was linked; an employee that was ever linked can't be deleted (spec 4.8). */
    firstLinkedAt: timestamp('first_linked_at', { withTimezone: true }),
    /**
     * Made by an invitation from Settings → Team (CD-226, `createInvitedEmployee`): names from the
     * invited email until the person joins (then from their profile); withdrawn or expired before
     * anyone linked it, the record is deleted.
     */
    createdFromInvite: boolean('created_from_invite').notNull().default(false),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [
    unique('employees_tenant_id_uq').on(t.tenantId, t.id),
    // A member is linked to at most one employee per workspace.
    unique('employees_user_uq').on(t.tenantId, t.userId),
    // Unique among active and inactive employees, case-insensitive (stored lower-case anyway).
    uniqueIndex('employees_work_email_uq').on(t.tenantId, sql`lower(${t.workEmail})`).where(sql`${t.workEmail} is not null`),
    uniqueIndex('employees_number_uq').on(t.tenantId, t.employeeNumber).where(sql`${t.employeeNumber} is not null`),
    // The scope query walks manager_id (PeopleAccess).
    index('employees_tenant_manager_idx').on(t.tenantId, t.managerId),
    index('employees_tenant_department_idx').on(t.tenantId, t.departmentId, t.teamId),
    index('employees_tenant_unit_idx').on(t.tenantId, t.unitId),
    index('employees_tenant_last_name_idx').on(t.tenantId, t.lastName, t.firstName),
    check('employees_names_ck', sql`length(${t.firstName}) <= 100 and length(btrim(${t.lastName})) between 1 and 100`),
    check('employees_type_ck', sql`${t.employmentType} in ('permanent', 'fixed_term', 'contractor', 'student')`),
    check('employees_weekly_hours_ck', sql`${t.weeklyHours} between 1 and 60`),
    check('employees_work_type_ck', sql`${t.workType} in ('office', 'service', 'both')`),
    check('employees_leaving_reason_ck', sql`${t.leavingReason} is null or ${t.leavingReason} in ('resigned', 'contract_ended', 'dismissed', 'retired', 'other')`),
    check('employees_not_own_manager_ck', sql`${t.managerId} is null or ${t.managerId} <> ${t.id}`),
    check('employees_team_needs_department_ck', sql`${t.teamId} is null or ${t.departmentId} is not null`),
  ],
);

/**
 * Personal details and bank account of an employee (spec 4.3, 4.4), 1:1, in their own table so
 * list queries never touch them. The IBANs are sealed with SecretBox (purpose "employee-iban");
 * only the last four characters, the country and a short mask ("RS35 •••• 1379", what history and
 * emails show) are stored in the clear. Saving it touches the employee row (one version per card).
 */
export const employeePersonal = pgTable(
  'employee_personal',
  {
    tenantId: tenantId(),
    employeeId: uuid('employee_id').notNull(),
    dateOfBirth: date('date_of_birth'),
    privateEmail: text('private_email'),
    privatePhone: text('private_phone'),
    addressStreet: text('address_street'),
    addressPostalCode: text('address_postal_code'),
    addressCity: text('address_city'),
    addressCountry: text('address_country'),
    emergencyContactName: text('emergency_contact_name'),
    emergencyContactPhone: text('emergency_contact_phone'),
    ibanSealed: text('iban_sealed'),
    ibanLast4: text('iban_last4'),
    ibanCountry: text('iban_country'),
    ibanMasked: text('iban_masked'),
    bankName: text('bank_name'),
    /** Foreign currency account (EUR travel expenses, milestone 17). Same as the IBAN unless set. */
    fxSameAsIban: boolean('fx_same_as_iban').notNull().default(true),
    fxIbanSealed: text('fx_iban_sealed'),
    fxIbanLast4: text('fx_iban_last4'),
    fxIbanCountry: text('fx_iban_country'),
    fxIbanMasked: text('fx_iban_masked'),
    swiftBic: text('swift_bic'),
    fxBankName: text('fx_bank_name'),
    fxBankAddress: text('fx_bank_address'),
    ...timestamps,
  },
  (t) => [
    // Keyed by workspace and employee, so another workspace's insert fails on the foreign key, not on a duplicate key.
    primaryKey({ columns: [t.tenantId, t.employeeId], name: 'employee_personal_pk' }),
    foreignKey({ columns: [t.tenantId, t.employeeId], foreignColumns: [employees.tenantId, employees.id], name: 'employee_personal_employee_fk' }).onDelete('cascade'),
  ],
);

/**
 * Administration and Payroll, once assigned by an Admin (spec 9.1). Unused since CD-225 removed the
 * roles (only Admins do HR work): nothing reads or writes it; a later migration may drop it.
 */
export const employeeRoles = pgTable(
  'employee_roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantId(),
    employeeId: uuid('employee_id').notNull(),
    role: text('role', { enum: ASSIGNED_ROLES }).notNull(),
    grantedByUserId: uuid('granted_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('employee_roles_tenant_id_uq').on(t.tenantId, t.id),
    unique('employee_roles_uq').on(t.tenantId, t.employeeId, t.role),
    foreignKey({ columns: [t.tenantId, t.employeeId], foreignColumns: [employees.tenantId, employees.id], name: 'employee_roles_employee_fk' }).onDelete('cascade'),
    check('employee_roles_role_ck', sql`${t.role} in ('administration', 'payroll')`),
  ],
);
