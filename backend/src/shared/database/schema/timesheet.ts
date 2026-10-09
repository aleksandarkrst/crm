import { sql } from 'drizzle-orm';
import { check, date, foreignKey, index, integer, pgTable, primaryKey, text, time, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { employees } from './people';
import { tenants, users } from './platform';
import { tasks, workOrders } from './projects';

/**
 * Timesheet tables (owned by the timesheet module, milestone 15). Every table carries tenant_id and
 * is protected by row-level security (drizzle/0077_timesheet_rls.sql); references use composite
 * (tenant_id, id) foreign keys. A day's status, a closed project and a Completed work order are
 * enforced on time entries by a trigger in the same migration, whichever code writes them.
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

/** A day's status (spec 5.2; the design says Rejected where the spec says Returned). */
export const TIMESHEET_DAY_STATUSES = ['draft', 'submitted', 'rejected', 'approved'] as const;
export type TimesheetDayStatus = (typeof TIMESHEET_DAY_STATUSES)[number];

/**
 * Hours someone worked on a task or a work order on one day (CD-152, CD-276): whole minutes in
 * steps of 15. The weekly timesheet and the task and work order pages write the same rows; a
 * timesheet cell is the sum of one person's entries on that task and day. Deleting a task or a work
 * order with time is refused ("close it instead"); deleting the employee takes their entries.
 */
export const timeEntries = pgTable(
  'time_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantId(),
    employeeId: uuid('employee_id').notNull(),
    workDate: date('work_date').notNull(),
    taskId: uuid('task_id'),
    workOrderId: uuid('work_order_id'),
    minutes: integer('minutes').notNull(),
    note: text('note'),
    /** Start → End on the work order page (CD-276): both or neither; then `minutes` is their difference. */
    startTime: time('start_time'),
    endTime: time('end_time'),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [
    index('time_entries_employee_date_idx').on(t.tenantId, t.employeeId, t.workDate),
    index('time_entries_task_idx').on(t.tenantId, t.taskId),
    index('time_entries_work_order_idx').on(t.tenantId, t.workOrderId),
    foreignKey({ columns: [t.tenantId, t.employeeId], foreignColumns: [employees.tenantId, employees.id], name: 'time_entries_employee_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.tenantId, t.taskId], foreignColumns: [tasks.tenantId, tasks.id], name: 'time_entries_task_fk' }).onDelete('restrict'),
    foreignKey({ columns: [t.tenantId, t.workOrderId], foreignColumns: [workOrders.tenantId, workOrders.id], name: 'time_entries_work_order_fk' }).onDelete('restrict'),
    check('time_entries_target_ck', sql`(${t.taskId} is null) <> (${t.workOrderId} is null)`),
    check('time_entries_minutes_ck', sql`${t.minutes} between 15 and 1440 and ${t.minutes} % 15 = 0`),
    check('time_entries_note_ck', sql`${t.note} is null or length(${t.note}) <= 500`),
    check(
      'time_entries_span_ck',
      sql`(${t.startTime} is null) = (${t.endTime} is null) and (${t.startTime} is null or (${t.endTime} > ${t.startTime} and ${t.minutes} = extract(epoch from ${t.endTime} - ${t.startTime}) / 60))`,
    ),
  ],
);

/**
 * One person's timesheet day once it was first submitted (spec 5.2): without a row a day is Draft;
 * a recalled day is a Draft row that keeps `first_submitted_at` (CD-155). Submitted and Approved
 * days refuse changes to their entries (the trigger on time_entries).
 */
export const timesheetDays = pgTable(
  'timesheet_days',
  {
    tenantId: tenantId(),
    employeeId: uuid('employee_id').notNull(),
    workDate: date('work_date').notNull(),
    status: text('status', { enum: TIMESHEET_DAY_STATUSES }).notNull(),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    submittedByUserId: uuid('submitted_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    /** When the day was first submitted (CD-155): kept through Recall, so a later submission is only Late if it never went in. */
    firstSubmittedAt: timestamp('first_submitted_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.employeeId, t.workDate], name: 'timesheet_days_pk' }),
    foreignKey({ columns: [t.tenantId, t.employeeId], foreignColumns: [employees.tenantId, employees.id], name: 'timesheet_days_employee_fk' }).onDelete('cascade'),
    check('timesheet_days_status_ck', sql`${t.status} in ('draft', 'submitted', 'rejected', 'approved')`),
  ],
);

/**
 * A task or work order someone added to a week with "+ Add task or work order" or Copy last week
 * (spec 4.4), so the row shows before it has hours. Rows still without hours go when the week is
 * submitted. A week is its Monday.
 */
export const timesheetRows = pgTable(
  'timesheet_rows',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantId(),
    employeeId: uuid('employee_id').notNull(),
    weekStart: date('week_start').notNull(),
    taskId: uuid('task_id'),
    workOrderId: uuid('work_order_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('timesheet_rows_task_uq').on(t.tenantId, t.employeeId, t.weekStart, t.taskId).where(sql`${t.taskId} is not null`),
    uniqueIndex('timesheet_rows_work_order_uq').on(t.tenantId, t.employeeId, t.weekStart, t.workOrderId).where(sql`${t.workOrderId} is not null`),
    foreignKey({ columns: [t.tenantId, t.employeeId], foreignColumns: [employees.tenantId, employees.id], name: 'timesheet_rows_employee_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.tenantId, t.taskId], foreignColumns: [tasks.tenantId, tasks.id], name: 'timesheet_rows_task_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.tenantId, t.workOrderId], foreignColumns: [workOrders.tenantId, workOrders.id], name: 'timesheet_rows_work_order_fk' }).onDelete('cascade'),
    check('timesheet_rows_target_ck', sql`(${t.taskId} is null) <> (${t.workOrderId} is null)`),
    check('timesheet_rows_monday_ck', sql`extract(isodow from ${t.weekStart}) = 1`),
  ],
);

export type TimeEntry = typeof timeEntries.$inferSelect;

/**
 * The workspace's public holidays (CD-153, Settings → Workforce → Holidays): one per date, a name,
 * and the hours off (null: the whole standard day). They show as a row in the Timesheet, lower the
 * expected hours and move a deadline that falls on them to the next working day.
 */
export const publicHolidays = pgTable(
  'public_holidays',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantId(),
    holidayDate: date('holiday_date').notNull(),
    name: text('name').notNull(),
    minutes: integer('minutes'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('public_holidays_date_uq').on(t.tenantId, t.holidayDate),
    check('public_holidays_name_ck', sql`length(btrim(${t.name})) between 1 and 100`),
    check('public_holidays_minutes_ck', sql`${t.minutes} is null or (${t.minutes} between 15 and 1440 and ${t.minutes} % 15 = 0)`),
  ],
);

/**
 * Flags on one person's week (spec 5.2): Late (first submitted after the deadline) and
 * Auto-submitted (submitted by the deadline job, CD-153). Set once and never cleared.
 */
export const timesheetWeeks = pgTable(
  'timesheet_weeks',
  {
    tenantId: tenantId(),
    employeeId: uuid('employee_id').notNull(),
    weekStart: date('week_start').notNull(),
    lateAt: timestamp('late_at', { withTimezone: true }),
    autoSubmittedAt: timestamp('auto_submitted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.employeeId, t.weekStart], name: 'timesheet_weeks_pk' }),
    foreignKey({ columns: [t.tenantId, t.employeeId], foreignColumns: [employees.tenantId, employees.id], name: 'timesheet_weeks_employee_fk' }).onDelete('cascade'),
    check('timesheet_weeks_monday_ck', sql`extract(isodow from ${t.weekStart}) = 1`),
  ],
);

/** A week whose deadline the auto submit has handled (CD-153), so a tick run twice, or after downtime, does it once. */
export const timesheetDeadlineRuns = pgTable(
  'timesheet_deadline_runs',
  {
    tenantId: tenantId(),
    weekStart: date('week_start').notNull(),
    ranAt: timestamp('ran_at', { withTimezone: true }).notNull().defaultNow(),
    submittedWeeks: integer('submitted_weeks').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.weekStart], name: 'timesheet_deadline_runs_pk' })],
);

/** The timesheet emails (CD-154). */
export const TIMESHEET_NOTICE_KINDS = ['reminder', 'late', 'auto_submitted', 'late_summary'] as const;
export type TimesheetNoticeKind = (typeof TIMESHEET_NOTICE_KINDS)[number];

/**
 * One timesheet email per week, kind and recipient (CD-154): the reminder, "late" and "submitted
 * automatically" (recipient: the employee) and the approver's summary (recipient: the user). Claimed
 * in the same transaction that queues the email, so a tick run twice, or after a restart, sends it
 * once; the mail job's retries cover a failed send.
 */
export const timesheetNotices = pgTable(
  'timesheet_notices',
  {
    tenantId: tenantId(),
    weekStart: date('week_start').notNull(),
    kind: text('kind', { enum: TIMESHEET_NOTICE_KINDS }).notNull(),
    recipient: uuid('recipient').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.weekStart, t.kind, t.recipient], name: 'timesheet_notices_pk' }),
    check('timesheet_notices_kind_ck', sql`${t.kind} in ('reminder', 'late', 'auto_submitted', 'late_summary')`),
  ],
);
