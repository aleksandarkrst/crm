import { sql } from 'drizzle-orm';
import { boolean, check, date, foreignKey, index, integer, pgTable, primaryKey, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { employees } from './people';
import { tenants, users } from './platform';

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

/** Why a balance was adjusted by hand (spec 6.4). */
export const ADJUSTMENT_KINDS = ['correction', 'opening_balance', 'extra_days'] as const;
export type AdjustmentKind = (typeof ADJUSTMENT_KINDS)[number];

/**
 * A manual change to one employee's pool (CD-164, spec 6.4): a correction, an opening balance when
 * the company starts using Pultly (days already used as a negative number, or carry-over from
 * before on last year's pool) or extra days granted once. Append-only (the policy allows SELECT and
 * INSERT only): a wrong one is undone by a new opposite one, so the history stays whole.
 */
export const vacationBalanceAdjustments = pgTable(
  'vacation_balance_adjustments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantId(),
    employeeId: uuid('employee_id').notNull(),
    poolYear: integer('pool_year').notNull(),
    days: integer('days').notNull(),
    kind: text('kind', { enum: ADJUSTMENT_KINDS }).notNull(),
    reason: text('reason').notNull(),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('vacation_balance_adjustments_employee_idx').on(t.tenantId, t.employeeId, t.poolYear),
    foreignKey({ columns: [t.tenantId, t.employeeId], foreignColumns: [employees.tenantId, employees.id], name: 'vacation_balance_adjustments_employee_fk' }).onDelete('cascade'),
    check('vacation_balance_adjustments_days_ck', sql`${t.days} between -60 and 60 and ${t.days} <> 0`),
    check('vacation_balance_adjustments_kind_ck', sql`${t.kind} in ('correction', 'opening_balance', 'extra_days')`),
    check('vacation_balance_adjustments_reason_ck', sql`length(btrim(${t.reason})) between 1 and 300`),
    check('vacation_balance_adjustments_year_ck', sql`${t.poolYear} between 2000 and 2100`),
  ],
);

/**
 * What the daily job recorded on 1 July (spec 6.2): the carry-over of pool `pool_year` an employee
 * had not used by 30 June. The balance derives "Expired" from the facts (a late approval of days
 * before 1 July lowers it); this row is the history entry of the moment, written once.
 */
export const vacationBalanceExpiries = pgTable(
  'vacation_balance_expiries',
  {
    tenantId: tenantId(),
    employeeId: uuid('employee_id').notNull(),
    poolYear: integer('pool_year').notNull(),
    days: integer('days').notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.employeeId, t.poolYear], name: 'vacation_balance_expiries_pk' }),
    foreignKey({ columns: [t.tenantId, t.employeeId], foreignColumns: [employees.tenantId, employees.id], name: 'vacation_balance_expiries_employee_fk' }).onDelete('cascade'),
    check('vacation_balance_expiries_days_ck', sql`${t.days} >= 0`),
  ],
);

/**
 * The time off emails sent once per period (spec 15.2): the carry-over reminder (per employee and
 * month), the approver's "Request waiting" summary and the Admins' "Manager absent" notice (per
 * recipient's employee record and day; CD-166).
 */
export const TIMEOFF_NOTICE_KINDS = ['carry_over_expiring', 'approval_reminder', 'manager_absent', 'sick_leave_check'] as const;
export type TimeoffNoticeKind = (typeof TIMEOFF_NOTICE_KINDS)[number];

/**
 * One time off email per kind, employee and period (CD-164: "Carry-over expiring" on 1 May and
 * 1 June, period "2026-05"), claimed in the transaction that queues it, so a daily job run twice,
 * or after downtime, sends it once.
 */
export const timeoffNotices = pgTable(
  'timeoff_notices',
  {
    tenantId: tenantId(),
    kind: text('kind', { enum: TIMEOFF_NOTICE_KINDS }).notNull(),
    employeeId: uuid('employee_id').notNull(),
    period: text('period').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.kind, t.employeeId, t.period], name: 'timeoff_notices_pk' }),
    foreignKey({ columns: [t.tenantId, t.employeeId], foreignColumns: [employees.tenantId, employees.id], name: 'timeoff_notices_employee_fk' }).onDelete('cascade'),
    check('timeoff_notices_kind_ck', sql`${t.kind} in ('carry_over_expiring', 'approval_reminder', 'manager_absent', 'sick_leave_check')`),
  ],
);

/** The kinds of reason an Admin keeps (spec 7.2, 7.3; sick leave types come with CD-169). */
export const REASON_KINDS = ['paid_leave', 'other_absence'] as const;
export type ReasonKind = (typeof REASON_KINDS)[number];

/**
 * A reason for paid leave ("Marriage", "Blood donation"…) or an other absence ("Maternity leave"…),
 * spec 7.2 and 7.3. Paid leave reasons carry the most working days per case and whether they count
 * toward the yearly group limit (`tenants.timeoff_paid_leave_yearly_limit`); other absences whether
 * the employer pays. A reason used in a request can't be deleted (the request's FK restricts it);
 * it is deactivated instead. The defaults are provisioned for new workspaces and were backfilled.
 */
export const timeoffReasons = pgTable(
  'timeoff_reasons',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantId(),
    kind: text('kind', { enum: REASON_KINDS }).notNull(),
    name: text('name').notNull(),
    /** Paid leave: the most working days per case (a warning, not a block); null is no limit. */
    maxDays: integer('max_days'),
    /** Paid leave: counts toward the yearly group limit (A10). */
    countsTowardLimit: boolean('counts_toward_limit').notNull().default(false),
    /** Other absence: paid by the employer (shown to Payroll). */
    paidByEmployer: boolean('paid_by_employer').notNull().default(false),
    active: boolean('active').notNull().default(true),
    position: integer('position').notNull().default(0),
    ...timestamps,
  },
  (t) => [
    unique('timeoff_reasons_tenant_id_uq').on(t.tenantId, t.id),
    uniqueIndex('timeoff_reasons_name_uq').on(t.tenantId, t.kind, sql`lower(btrim(${t.name}))`),
    check('timeoff_reasons_kind_ck', sql`${t.kind} in ('paid_leave', 'other_absence')`),
    check('timeoff_reasons_name_ck', sql`length(btrim(${t.name})) between 1 and 100`),
    check('timeoff_reasons_max_days_ck', sql`${t.maxDays} is null or ${t.maxDays} between 1 and 60`),
  ],
);

/** The time off types (spec 7.1). Sick leave is a record of its own (CD-169). */
export const TIMEOFF_TYPES = ['vacation', 'paid_leave', 'unpaid_leave', 'other_absence'] as const;
export type TimeoffType = (typeof TIMEOFF_TYPES)[number];
/** The status flow (spec 9.4): Pending → Approved | Rejected | Withdrawn; Approved → Cancelled. */
export const TIMEOFF_REQUEST_STATUSES = ['pending', 'approved', 'rejected', 'withdrawn', 'cancelled'] as const;
export type TimeoffRequestStatus = (typeof TIMEOFF_REQUEST_STATUSES)[number];

/**
 * A time off request (spec 8.2): whole working days of vacation, paid leave (with a reason), unpaid
 * leave or an other absence (Admins only). `working_days` is the count at submission, recomputed
 * when the holiday calendar changes (spec 8.6). `recorded` marks leave an Admin recorded as
 * approved directly (spec 8.7), with their reason. The approver is resolved when someone looks
 * (PeopleAccess.approversFor), never stored. The decision fields are CD-166's.
 */
export const timeoffRequests = pgTable(
  'timeoff_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantId(),
    employeeId: uuid('employee_id').notNull(),
    type: text('type', { enum: TIMEOFF_TYPES }).notNull(),
    reasonId: uuid('reason_id'),
    startDate: date('start_date').notNull(),
    endDate: date('end_date').notNull(),
    workingDays: integer('working_days').notNull(),
    note: text('note'),
    status: text('status', { enum: TIMEOFF_REQUEST_STATUSES }).notNull().default('pending'),
    submittedByUserId: uuid('submitted_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
    /** Recorded as approved by an Admin (spec 8.7), with why. */
    recorded: boolean('recorded').notNull().default(false),
    recordReason: text('record_reason'),
    decidedByUserId: uuid('decided_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionComment: text('decision_comment'),
    ...timestamps,
  },
  (t) => [
    unique('timeoff_requests_tenant_id_uq').on(t.tenantId, t.id),
    index('timeoff_requests_employee_idx').on(t.tenantId, t.employeeId, t.startDate),
    index('timeoff_requests_status_idx').on(t.tenantId, t.status, t.startDate),
    index('timeoff_requests_reason_idx').on(t.tenantId, t.reasonId),
    foreignKey({ columns: [t.tenantId, t.employeeId], foreignColumns: [employees.tenantId, employees.id], name: 'timeoff_requests_employee_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.tenantId, t.reasonId], foreignColumns: [timeoffReasons.tenantId, timeoffReasons.id], name: 'timeoff_requests_reason_fk' }).onDelete('restrict'),
    check('timeoff_requests_type_ck', sql`${t.type} in ('vacation', 'paid_leave', 'unpaid_leave', 'other_absence')`),
    check('timeoff_requests_status_ck', sql`${t.status} in ('pending', 'approved', 'rejected', 'withdrawn', 'cancelled')`),
    check('timeoff_requests_dates_ck', sql`${t.endDate} >= ${t.startDate} and ${t.endDate} <= ${t.startDate} + 366`),
    check('timeoff_requests_reason_ck', sql`(${t.type} in ('paid_leave', 'other_absence')) = (${t.reasonId} is not null)`),
    check('timeoff_requests_days_ck', sql`${t.workingDays} between 0 and 260`),
    check('timeoff_requests_note_ck', sql`${t.note} is null or length(${t.note}) <= 500`),
    check('timeoff_requests_record_ck', sql`${t.recordReason} is null or length(btrim(${t.recordReason})) between 1 and 300`),
    check('timeoff_requests_comment_ck', sql`${t.decisionComment} is null or length(${t.decisionComment}) <= 500`),
  ],
);

/** A request day's state (spec 15.4): counted, or taken out again (sick leave, a shortened or cancelled request). */
export const REQUEST_DAY_STATES = ['counted', 'interrupted', 'cancelled', 'returned'] as const;
export type RequestDayState = (typeof REQUEST_DAY_STATES)[number];

/**
 * One working day of a request (spec 15.4): the date, its pool year (vacation only) and whether it
 * still counts. The balance is computed from these rows and the adjustments, so it can't drift. A
 * counted day is unique per employee and date: two requests can't overlap (spec 8.3).
 */
export const timeoffRequestDays = pgTable(
  'timeoff_request_days',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantId(),
    requestId: uuid('request_id').notNull(),
    employeeId: uuid('employee_id').notNull(),
    date: date('date').notNull(),
    poolYear: integer('pool_year'),
    state: text('state', { enum: REQUEST_DAY_STATES }).notNull().default('counted'),
    /** The sick leave that interrupted the day (CD-169, spec 13.4, A9), while `state` is `interrupted`. */
    sickLeaveId: uuid('sick_leave_id'),
  },
  (t) => [
    uniqueIndex('timeoff_request_days_counted_uq').on(t.tenantId, t.employeeId, t.date).where(sql`${t.state} = 'counted'`),
    index('timeoff_request_days_request_idx').on(t.tenantId, t.requestId),
    index('timeoff_request_days_employee_idx').on(t.tenantId, t.employeeId, t.date),
    foreignKey({ columns: [t.tenantId, t.requestId], foreignColumns: [timeoffRequests.tenantId, timeoffRequests.id], name: 'timeoff_request_days_request_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.tenantId, t.employeeId], foreignColumns: [employees.tenantId, employees.id], name: 'timeoff_request_days_employee_fk' }).onDelete('cascade'),
    check('timeoff_request_days_state_ck', sql`${t.state} in ('counted', 'interrupted', 'cancelled', 'returned')`),
    check('timeoff_request_days_pool_ck', sql`${t.poolYear} is null or ${t.poolYear} between 2000 and 2100`),
    index('timeoff_request_days_sick_idx').on(t.tenantId, t.sickLeaveId),
    foreignKey({ columns: [t.tenantId, t.sickLeaveId], foreignColumns: [sickLeaves.tenantId, sickLeaves.id], name: 'timeoff_request_days_sick_leave_fk' }),
  ],
);

/**
 * Sick leave types (CD-169, spec 13.3): the assumed payer is information for Payroll, never used to
 * calculate money. New workspaces get the defaults (SickLeaveService provisions them; the migration
 * gave them to existing ones). A used type can't be deleted, only deactivated.
 */
export const sickLeaveTypes = pgTable(
  'sick_leave_types',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    payerNote: text('payer_note'),
    position: integer('position').notNull().default(0),
    active: boolean('active').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    unique('sick_leave_types_tenant_id_uq').on(t.tenantId, t.id),
    uniqueIndex('sick_leave_types_name_uq').on(t.tenantId, sql`lower(${t.name})`),
    check('sick_leave_types_name_ck', sql`length(btrim(${t.name})) between 1 and 100`),
    check('sick_leave_types_payer_ck', sql`${t.payerNote} is null or length(${t.payerNote}) <= 300`),
  ],
);

export const SICK_LEAVE_STATUSES = ['reported', 'confirmed', 'cancelled'] as const;
export type SickLeaveStatus = (typeof SICK_LEAVE_STATUSES)[number];

/**
 * A sick leave record (CD-169, spec 13): the employee, the period (no end date = open, "until
 * return"), the type once an Admin confirms it, an optional link to the record it continues (for
 * the day-31 count) and the sick note's reference. **No medical data**: no diagnosis, doctor or
 * attachment, and the note carries the hint not to enter any. Overlapping approved time off is
 * interrupted (timeoff_request_days.sick_leave_id). Records are never deleted; a wrong one is
 * cancelled with a reason.
 */
export const sickLeaves = pgTable(
  'sick_leaves',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantId(),
    employeeId: uuid('employee_id').notNull(),
    startDate: date('start_date').notNull(),
    endDate: date('end_date'),
    typeId: uuid('type_id'),
    continuationOfId: uuid('continuation_of_id'),
    sickNoteRef: text('sick_note_ref'),
    note: text('note'),
    status: text('status', { enum: SICK_LEAVE_STATUSES }).notNull().default('reported'),
    cancelReason: text('cancel_reason'),
    reportedByUserId: uuid('reported_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    confirmedByUserId: uuid('confirmed_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    unique('sick_leaves_tenant_id_uq').on(t.tenantId, t.id),
    index('sick_leaves_employee_idx').on(t.tenantId, t.employeeId, t.startDate),
    index('sick_leaves_status_idx').on(t.tenantId, t.status, t.startDate),
    index('sick_leaves_type_idx').on(t.tenantId, t.typeId),
    index('sick_leaves_continuation_idx').on(t.tenantId, t.continuationOfId),
    foreignKey({ columns: [t.tenantId, t.employeeId], foreignColumns: [employees.tenantId, employees.id], name: 'sick_leaves_employee_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.tenantId, t.typeId], foreignColumns: [sickLeaveTypes.tenantId, sickLeaveTypes.id], name: 'sick_leaves_type_fk' }).onDelete('restrict'),
    foreignKey({ columns: [t.tenantId, t.continuationOfId], foreignColumns: [t.tenantId, t.id], name: 'sick_leaves_continuation_fk' }),
    check('sick_leaves_status_ck', sql`${t.status} in ('reported', 'confirmed', 'cancelled')`),
    check('sick_leaves_dates_ck', sql`${t.endDate} is null or ${t.endDate} >= ${t.startDate}`),
    check('sick_leaves_confirmed_ck', sql`${t.status} <> 'confirmed' or ${t.typeId} is not null`),
    check('sick_leaves_ref_ck', sql`${t.sickNoteRef} is null or length(${t.sickNoteRef}) <= 50`),
    check('sick_leaves_note_ck', sql`${t.note} is null or length(${t.note}) <= 500`),
    check('sick_leaves_cancel_ck', sql`${t.status} <> 'cancelled' or ${t.cancelReason} is not null`),
    check('sick_leaves_continuation_ck', sql`${t.continuationOfId} is null or ${t.continuationOfId} <> ${t.id}`),
  ],
);

export type SickLeaveRow = typeof sickLeaves.$inferSelect;
export type SickLeaveTypeRow = typeof sickLeaveTypes.$inferSelect;

export type TimeoffPolicyRow = typeof timeoffPolicies.$inferSelect;
export type TimeoffReasonRow = typeof timeoffReasons.$inferSelect;
export type TimeoffRequestRow = typeof timeoffRequests.$inferSelect;
export type VacationEntitlementRow = typeof vacationEntitlements.$inferSelect;
export type VacationBalanceAdjustmentRow = typeof vacationBalanceAdjustments.$inferSelect;
