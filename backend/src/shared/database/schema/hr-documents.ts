import { sql } from 'drizzle-orm';
import { boolean, check, foreignKey, index, integer, jsonb, pgTable, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { employees } from './people';
import { tenants, users } from './platform';

/**
 * Generated legal documents (milestone 16, spec 10.2; owned by the hr-documents module): the
 * vacation decisions of CD-167 now, travel orders in milestone 17. One row per version: a
 * regeneration adds a row with the same number and `version + 1` and marks the earlier one
 * `superseded`. The number comes from the yearly sequence of its type and is never reused. The
 * snapshot holds the exact values merged into the PDF, for audit. Row-level security in
 * drizzle/0103_hr_documents_rls.sql; a composite foreign key to the employee.
 */
export const HR_DOCUMENT_TYPES = ['vacation_decision'] as const;
export type HrDocumentType = (typeof HR_DOCUMENT_TYPES)[number];
export const HR_DOCUMENT_STATUSES = ['queued', 'running', 'ready', 'failed'] as const;
export type HrDocumentStatus = (typeof HR_DOCUMENT_STATUSES)[number];
/** Valid, or what happened to its source since: outdated (shortened), cancelled, or superseded by a newer version. */
export const HR_DOCUMENT_STATES = ['valid', 'outdated', 'cancelled', 'superseded'] as const;
export type HrDocumentState = (typeof HR_DOCUMENT_STATES)[number];

export const hrDocuments = pgTable(
  'hr_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    type: text('type', { enum: HR_DOCUMENT_TYPES }).notNull(),
    /** The record the document was made from (a time off request). */
    sourceId: uuid('source_id').notNull(),
    employeeId: uuid('employee_id').notNull(),
    /** "GO-2026-0001": the type's prefix, the year and the sequence. */
    number: text('number').notNull(),
    year: integer('year').notNull(),
    sequence: integer('sequence').notNull(),
    version: integer('version').notNull().default(1),
    status: text('status', { enum: HR_DOCUMENT_STATUSES }).notNull().default('queued'),
    error: text('error'),
    state: text('state', { enum: HR_DOCUMENT_STATES }).notNull().default('valid'),
    snapshot: jsonb('snapshot').$type<unknown>().notNull(),
    templateVersion: integer('template_version').notNull().default(1),
    storageKey: text('storage_key'),
    sizeBytes: integer('size_bytes'),
    sha256: text('sha256'),
    /** Email it when ready (always for a new decision; a regeneration asks). */
    emailOnReady: boolean('email_on_ready').notNull().default(true),
    emailedTo: text('emailed_to').array(),
    emailedAt: timestamp('emailed_at', { withTimezone: true }),
    /** The employee confirmed receipt in the app (spec 11.4). */
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('hr_documents_tenant_id_uq').on(t.tenantId, t.id),
    uniqueIndex('hr_documents_number_uq').on(t.tenantId, t.type, t.number, t.version),
    index('hr_documents_source_idx').on(t.tenantId, t.type, t.sourceId),
    index('hr_documents_employee_idx').on(t.tenantId, t.employeeId),
    foreignKey({ columns: [t.tenantId, t.employeeId], foreignColumns: [employees.tenantId, employees.id], name: 'hr_documents_employee_fk' }).onDelete('cascade'),
    check('hr_documents_type_ck', sql`${t.type} in ('vacation_decision')`),
    check('hr_documents_status_ck', sql`${t.status} in ('queued', 'running', 'ready', 'failed')`),
    check('hr_documents_state_ck', sql`${t.state} in ('valid', 'outdated', 'cancelled', 'superseded')`),
    check('hr_documents_version_ck', sql`${t.version} >= 1 and ${t.sequence} >= 1 and ${t.year} between 2000 and 2100`),
  ],
);

export type HrDocumentRow = typeof hrDocuments.$inferSelect;
