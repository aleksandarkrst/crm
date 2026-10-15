import { sql } from 'drizzle-orm';
import { boolean, check, foreignKey, index, integer, pgTable, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { employees } from './people';
import { tenants } from './platform';

/**
 * Time off tables (owned by the timeoff module, milestone 16). Every table carries tenant_id, has
 * row-level security (drizzle/0096_timeoff_policies_rls.sql) and uses composite (tenant_id, id)
 * foreign keys. CD-163 adds the vacation policies, the employee's time off profile and the yearly
 * entitlement; requests, balances and sick leave follow in CD-164 to CD-170.
 */

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  // Set by the crm_touch_version trigger, so history rows carry the same moment.
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

const tenantId = () =>
  uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' });

/** The Labor Law's minimum annual leave (spec 3.3, A1): a policy can't give fewer days. */
export const MIN_BASE_DAYS = 20;
export const MAX_BASE_DAYS = 60;

/**
 * A set of vacation rules (spec 5.2): base days, a cap on the total, and whether unused days carry
 * over to June 30 of the next year (and how many at most). Exactly one policy per workspace is the
 * default (`timeoff_policies_default_uq`): new employees and employees without a profile row use
 * it. New workspaces get "Standard" (20 days, carry-over on, no cap); existing ones got it in the
 * migration. A policy with employees on it can't be deleted (the profile's FK restricts it).
 */
export const timeoffPolicies = pgTable(
  'timeoff_policies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    baseDays: integer('base_days').notNull().default(MIN_BASE_DAYS),
    /** Caps base + extra + individual days; null is no cap. */
    maxDays: integer('max_days'),
    carryOver: boolean('carry_over').notNull().default(true),
    /** At most this many unused days carry over; null is all of them. */
    carryOverCap: integer('carry_over_cap'),
    isDefault: boolean('is_default').notNull().default(false),
    note: text('note'),
    ...timestamps,
  },
  (t) => [
    unique('timeoff_policies_tenant_id_uq').on(t.tenantId, t.id),
    uniqueIndex('timeoff_policies_name_uq').on(t.tenantId, sql`lower(btrim(${t.name}))`),
    uniqueIndex('timeoff_policies_default_uq').on(t.tenantId).where(sql`${t.isDefault}`),
    check('timeoff_policies_name_ck', sql`length(btrim(${t.name})) between 1 and 100`),
    check('timeoff_policies_base_days_ck', sql`${t.baseDays} between 20 and 60`),
    check('timeoff_policies_max_days_ck', sql`${t.maxDays} is null or ${t.maxDays} between 20 and 100`),
    check('timeoff_policies_carry_over_cap_ck', sql`${t.carryOverCap} is null or ${t.carryOverCap} between 0 and 60`),
    check('timeoff_policies_note_ck', sql`${t.note} is null or length(${t.note}) <= 2000`),
  ],
);

/**
 * "From N years of work experience: +X days" (spec 5.2). Rows don't add up: the highest row the
 * employee reaches applies. One row per threshold.
 */
export const timeoffPolicyExperienceRules = pgTable(
  'timeoff_policy_experience_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantId(),
    policyId: uuid('policy_id').notNull(),
    fromYears: integer('from_years').notNull(),
    extraDays: integer('extra_days').notNull(),
  },
  (t) => [
    uniqueIndex('timeoff_policy_rules_from_uq').on(t.tenantId, t.policyId, t.fromYears),
    index('timeoff_policy_rules_policy_idx').on(t.tenantId, t.policyId),
    foreignKey({ columns: [t.tenantId, t.policyId], foreignColumns: [timeoffPolicies.tenantId, timeoffPolicies.id], name: 'timeoff_policy_rules_policy_fk' }).onDelete('cascade'),
    check('timeoff_policy_rules_from_years_ck', sql`${t.fromYears} between 1 and 50`),
    check('timeoff_policy_rules_extra_days_ck', sql`${t.extraDays} between 1 and 20`),
  ],
);

/**
 * An employee's time off profile (spec 5.3): their policy and the work experience they had before
 * joining, in months (for the experience rows). Without a row the employee is on the default
 * policy with no prior experience. Deleting the employee takes the profile along; a policy with
 * profiles can't be deleted.
 */
export const employeeTimeoffProfiles = pgTable(
  'employee_timeoff_profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantId(),
    employeeId: uuid('employee_id').notNull(),
    policyId: uuid('policy_id').notNull(),
    priorExperienceMonths: integer('prior_experience_months').notNull().default(0),
    ...timestamps,
  },
  (t) => [
    unique('employee_timeoff_profiles_tenant_id_uq').on(t.tenantId, t.id),
    uniqueIndex('employee_timeoff_profiles_employee_uq').on(t.tenantId, t.employeeId),
    index('employee_timeoff_profiles_policy_idx').on(t.tenantId, t.policyId),
    foreignKey({ columns: [t.tenantId, t.employeeId], foreignColumns: [employees.tenantId, employees.id], name: 'employee_timeoff_profiles_employee_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.tenantId, t.policyId], foreignColumns: [timeoffPolicies.tenantId, timeoffPolicies.id], name: 'employee_timeoff_profiles_policy_fk' }).onDelete('restrict'),
    check('employee_timeoff_profiles_prior_ck', sql`${t.priorExperienceMonths} between 0 and 600`),
  ],
);

/**
 * One employee's vacation entitlement for one calendar year (spec 5.4): the policy it was computed
 * with, its parts (base, extra by experience, individual extra days with their reason), the full
 * months of work in a first or last year (null: the whole year) and the result. `annual_days` is
 * the whole year's total (base + extra + individual, capped); `total_days` is what the employee is
 * entitled to in that year (proportional in a first or last year). Recomputed while `frozen` is
 * false; approving a vacation day of the year freezes it (CD-166), after which only an Admin's
 * Recalculate changes it. Written by the timeoff module only.
 */
export const vacationEntitlements = pgTable(
  'vacation_entitlements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantId(),
    employeeId: uuid('employee_id').notNull(),
    year: integer('year').notNull(),
    policyId: uuid('policy_id').notNull(),
    baseDays: integer('base_days').notNull(),
    experienceDays: integer('experience_days').notNull().default(0),
    /** The work experience the extra days were based on, in whole years. */
    experienceYears: integer('experience_years').notNull().default(0),
    individualDays: integer('individual_days').notNull().default(0),
    individualReason: text('individual_reason'),
    monthsWorked: integer('months_worked'),
    annualDays: integer('annual_days').notNull(),
    totalDays: integer('total_days').notNull(),
    frozen: boolean('frozen').notNull().default(false),
    ...timestamps,
  },
  (t) => [
    unique('vacation_entitlements_tenant_id_uq').on(t.tenantId, t.id),
    uniqueIndex('vacation_entitlements_year_uq').on(t.tenantId, t.employeeId, t.year),
    index('vacation_entitlements_policy_idx').on(t.tenantId, t.policyId),
    foreignKey({ columns: [t.tenantId, t.employeeId], foreignColumns: [employees.tenantId, employees.id], name: 'vacation_entitlements_employee_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.tenantId, t.policyId], foreignColumns: [timeoffPolicies.tenantId, timeoffPolicies.id], name: 'vacation_entitlements_policy_fk' }).onDelete('restrict'),
    check('vacation_entitlements_year_ck', sql`${t.year} between 2000 and 2100`),
    check('vacation_entitlements_individual_ck', sql`${t.individualDays} between 0 and 60 and (${t.individualDays} = 0 or ${t.individualReason} is not null)`),
    check('vacation_entitlements_reason_ck', sql`${t.individualReason} is null or length(btrim(${t.individualReason})) between 1 and 300`),
    check('vacation_entitlements_months_ck', sql`${t.monthsWorked} is null or ${t.monthsWorked} between 0 and 12`),
    check('vacation_entitlements_days_ck', sql`${t.annualDays} >= 0 and ${t.totalDays} between 0 and ${t.annualDays}`),
  ],
);

export type TimeoffPolicyRow = typeof timeoffPolicies.$inferSelect;
export type VacationEntitlementRow = typeof vacationEntitlements.$inferSelect;
