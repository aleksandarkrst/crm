import { sql } from 'drizzle-orm';
import { check, date, foreignKey, index, integer, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
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
  ],
);

/**
 * One person's timesheet day once it leaves Draft (spec 5.2): no row is Draft. Submitted and
 * Approved days refuse changes to their entries (the trigger on time_entries).
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
