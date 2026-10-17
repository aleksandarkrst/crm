import { sql } from 'drizzle-orm';
import { boolean, check, date, foreignKey, index, integer, pgTable, primaryKey, text, time, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
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
/** Where a public holiday came from (milestone 16, spec 4.2). */
export const HOLIDAY_SOURCES = ['manual', 'preload'] as const;
export type HolidaySource = (typeof HOLIDAY_SOURCES)[number];
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
    // Someone's hours on a task: limits, alerts and the time report (CD-149).
    index('time_entries_task_employee_idx').on(t.tenantId, t.taskId, t.employeeId),
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
    /** The approver's decision (CD-157): when and who approved, or when and who returned it, with the latest comment. */
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    approvedByUserId: uuid('approved_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    /** The day as it was approved (CD-159, spec 9.1): expected and entered minutes at that moment; cleared by an unlock. */
    approvedExpectedMinutes: integer('approved_expected_minutes'),
    approvedMinutes: integer('approved_minutes'),
    returnedAt: timestamp('returned_at', { withTimezone: true }),
    returnedByUserId: uuid('returned_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    comment: text('comment'),
    /** The employee resubmitted a returned day (CD-158): when, and their optional reply to the comment; cleared by the next return. */
    resubmittedAt: timestamp('resubmitted_at', { withTimezone: true }),
    reply: text('reply'),
    ...timestamps,
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.employeeId, t.workDate], name: 'timesheet_days_pk' }),
    foreignKey({ columns: [t.tenantId, t.employeeId], foreignColumns: [employees.tenantId, employees.id], name: 'timesheet_days_employee_fk' }).onDelete('cascade'),
    check('timesheet_days_status_ck', sql`${t.status} in ('draft', 'submitted', 'rejected', 'approved')`),
    check('timesheet_days_comment_ck', sql`${t.comment} is null or length(${t.comment}) between 1 and 1000`),
    check('timesheet_days_reply_ck', sql`${t.reply} is null or length(${t.reply}) between 1 and 1000`),
  ],
);

/** What happened to a day (spec 9.5): every status change, by whom (null: the deadline job). */
/** `absence_changed` (CD-170, spec 14.3): the time off module added or removed an absence line on a submitted or approved day. */
export const TIMESHEET_DAY_EVENT_KINDS = ['submitted', 'auto_submitted', 'recalled', 'approved', 'returned', 'resubmitted', 'unlocked', 'absence_changed'] as const;
export type TimesheetDayEventKind = (typeof TIMESHEET_DAY_EVENT_KINDS)[number];

/**
 * The append-only history of a timesheet day (CD-157, spec 9.5): one row per day and status change,
 * with the actor as they were named at the time (the name stays when the member goes), the comment
 * of a return or the reason of an unlock, and the approval mode the action ran under. Nothing
 * updates or deletes these rows; deleting the employee takes them along.
 */
export const timesheetDayEvents = pgTable(
  'timesheet_day_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantId(),
    employeeId: uuid('employee_id').notNull(),
    workDate: date('work_date').notNull(),
    kind: text('kind', { enum: TIMESHEET_DAY_EVENT_KINDS }).notNull(),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    actorName: text('actor_name'),
    comment: text('comment'),
    approvalMode: text('approval_mode', { enum: ['week', 'day'] }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('timesheet_day_events_day_idx').on(t.tenantId, t.employeeId, t.workDate),
    foreignKey({ columns: [t.tenantId, t.employeeId], foreignColumns: [employees.tenantId, employees.id], name: 'timesheet_day_events_employee_fk' }).onDelete('cascade'),
    check('timesheet_day_events_kind_ck', sql`${t.kind} in ('submitted', 'auto_submitted', 'recalled', 'approved', 'returned', 'resubmitted', 'unlocked', 'absence_changed')`),
    check('timesheet_day_events_mode_ck', sql`${t.approvalMode} in ('week', 'day')`),
    check('timesheet_day_events_comment_ck', sql`${t.comment} is null or length(${t.comment}) between 1 and 1000`),
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
    /** The first day. Every holiday repeats on the same day and month every later year (CD-318). */
    holidayDate: date('holiday_date').notNull(),
    /** The last day of a holiday that spans several days; null for a single day (CD-318). */
    endDate: date('end_date'),
    name: text('name').notNull(),
    minutes: integer('minutes'),
    /** False for a day that holds in its own year only: Orthodox Easter and a moved Sunday holiday (milestone 16, spec 4.3). */
    repeats: boolean('repeats').notNull().default(true),
    /** Preloaded for the country (spec 4.2), or added by an Admin. */
    source: text('source', { enum: HOLIDAY_SOURCES }).notNull().default('manual'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('public_holidays_date_uq').on(t.tenantId, t.holidayDate),
    check('public_holidays_name_ck', sql`length(btrim(${t.name})) between 1 and 100`),
    check('public_holidays_end_ck', sql`${t.endDate} is null or (${t.endDate} >= ${t.holidayDate} and ${t.endDate} <= ${t.holidayDate} + 60)`),
    check('public_holidays_minutes_ck', sql`${t.minutes} is null or (${t.minutes} between 15 and 1440 and ${t.minutes} % 15 = 0)`),
    check('public_holidays_source_ck', sql`${t.source} in ('manual', 'preload')`),
  ],
);

/**
 * The years whose public holidays were preloaded for the workspace's country (spec 4.3): a year is
 * generated once, so an Admin's later edits and deletions are never undone by the next run.
 */
export const publicHolidayPreloads = pgTable(
  'public_holiday_preloads',
  {
    tenantId: tenantId(),
    year: integer('year').notNull(),
    country: text('country').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.year], name: 'public_holiday_preloads_pk' }), check('public_holiday_preloads_year_ck', sql`${t.year} between 2000 and 2100`)],
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

/** The absences a timesheet day can carry (CD-170, spec 14.1). */
export const TIMESHEET_ABSENCE_KINDS = ['vacation', 'paid_leave', 'unpaid_leave', 'other_absence', 'sick_leave'] as const;
export type TimesheetAbsenceKind = (typeof TIMESHEET_ABSENCE_KINDS)[number];

/**
 * A full-day absence in one person's timesheet (CD-170, spec 14.1): approved time off or sick
 * leave on a working day, with the standard day's hours. Written only by the time off module's
 * sync (`timeoff.sync-timesheet`, through `TimesheetAbsencesService.sync`), read-only for everyone
 * in the timesheet; the hours count as entered and no task hours go on the day. At most one per
 * person and day. `source_id` is the request or the sick leave record (no foreign key: it points at
 * either table). The label never names the type of sick leave.
 */
export const timesheetAbsences = pgTable(
  'timesheet_absences',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantId(),
    employeeId: uuid('employee_id').notNull(),
    workDate: date('work_date').notNull(),
    kind: text('kind', { enum: TIMESHEET_ABSENCE_KINDS }).notNull(),
    /** "Vacation", "Paid leave: Marriage", "Sick leave". */
    label: text('label').notNull(),
    minutes: integer('minutes').notNull(),
    sourceId: uuid('source_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('timesheet_absences_day_uq').on(t.tenantId, t.employeeId, t.workDate),
    index('timesheet_absences_source_idx').on(t.tenantId, t.sourceId),
    foreignKey({ columns: [t.tenantId, t.employeeId], foreignColumns: [employees.tenantId, employees.id], name: 'timesheet_absences_employee_fk' }).onDelete('cascade'),
    check('timesheet_absences_kind_ck', sql`${t.kind} in ('vacation', 'paid_leave', 'unpaid_leave', 'other_absence', 'sick_leave')`),
    check('timesheet_absences_minutes_ck', sql`${t.minutes} between 1 and 1440`),
    check('timesheet_absences_label_ck', sql`length(${t.label}) between 1 and 200`),
  ],
);
