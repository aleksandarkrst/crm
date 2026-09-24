import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenants, users } from './platform';

/**
 * CRM tables (owned by the crm module). Every table carries tenant_id and is protected by
 * row-level security (see drizzle/0001_rls.sql). References between tenant-scoped tables use
 * composite (tenant_id, id) foreign keys, so a row can never point at another tenant's data.
 *
 * The model follows the "Mini CRM v2" design: companies and contacts, configurable funnels
 * (one per target persona) with stages, deals that move through a funnel's stages, a product
 * catalog, and an activity history per deal.
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

// ---------------------------------------------------------------- custom fields (CD-15)

/** Values of a record's custom fields, by field id. Validated against the definitions on write. */
export type CustomFieldValues = Record<string, string | number | boolean>;
export const CUSTOM_FIELD_ENTITIES = ['deal', 'company', 'contact'] as const;
export type CustomFieldEntity = (typeof CUSTOM_FIELD_ENTITIES)[number];
export const CUSTOM_FIELD_TYPES = ['text', 'number', 'date', 'select', 'checkbox', 'url'] as const;
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];
/** An option of a single-select field; values store the id, so renaming an option keeps them. */
export interface CustomFieldOption {
  id: string;
  label: string;
}

/**
 * A custom field of deals, companies or contacts, defined by owners and admins. Deleting one sets
 * deleted_at: the field is hidden and its values stay in the records (they are not shown).
 */
export const customFieldDefs = pgTable(
  'custom_field_defs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantId(),
    entity: text('entity', { enum: CUSTOM_FIELD_ENTITIES }).notNull(),
    label: text('label').notNull(),
    type: text('type', { enum: CUSTOM_FIELD_TYPES }).notNull(),
    options: jsonb('options').$type<CustomFieldOption[]>().notNull().default([]),
    required: boolean('required').notNull().default(false),
    position: integer('position').notNull().default(0),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    unique('custom_field_defs_tenant_id_uq').on(t.tenantId, t.id),
    index('custom_field_defs_tenant_entity_idx').on(t.tenantId, t.entity, t.position),
    uniqueIndex('custom_field_defs_label_uq').on(t.tenantId, t.entity, sql`lower(${t.label})`).where(sql`${t.deletedAt} is null`),
  ],
);

// ---------------------------------------------------------------- companies & contacts

export const companies = pgTable(
  'companies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    industry: text('industry'),
    hq: text('hq'),
    teamSize: text('team_size'), // "11–50 staff"
    source: text('source'), // "Referral", "Inbound web form", ...
    domain: text('domain'),
    ownerUserId: uuid('owner_user_id').references(() => users.id, { onDelete: 'set null' }),
    notes: text('notes'),
    /** Custom field values (CD-15), keyed by custom_field_defs.id; see CustomFieldsService. */
    customFields: jsonb('custom_fields').$type<CustomFieldValues>().notNull().default({}),
    ...timestamps,
  },
  (t) => [unique('companies_tenant_id_uq').on(t.tenantId, t.id), index('companies_tenant_name_idx').on(t.tenantId, t.name)],
);

export const BUYER_ROLES = ['Decision maker', 'Economic buyer', 'Champion', 'Influencer', 'Gatekeeper', 'End user'] as const;
export type BuyerRole = (typeof BUYER_ROLES)[number];

export const contacts = pgTable(
  'contacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantId(),
    companyId: uuid('company_id'),
    fullName: text('full_name').notNull(),
    jobTitle: text('job_title'),
    email: text('email'),
    phone: text('phone'),
    linkedin: text('linkedin'),
    buyerRole: text('buyer_role', { enum: BUYER_ROLES }).notNull().default('Influencer'),
    ownerUserId: uuid('owner_user_id').references(() => users.id, { onDelete: 'set null' }),
    /** Custom field values (CD-15), keyed by custom_field_defs.id. */
    customFields: jsonb('custom_fields').$type<CustomFieldValues>().notNull().default({}),
    ...timestamps,
  },
  (t) => [
    unique('contacts_tenant_id_uq').on(t.tenantId, t.id),
    index('contacts_tenant_company_idx').on(t.tenantId, t.companyId),
    foreignKey({ columns: [t.tenantId, t.companyId], foreignColumns: [companies.tenantId, companies.id], name: 'contacts_company_fk' }),
  ],
);

// ---------------------------------------------------------------- funnels (playbooks)

export const CHANNELS = ['RS', 'EM', 'LI', 'WA', 'MT', 'PH', 'NT'] as const; // research, email, linkedin, whatsapp, meeting, phone, note
export type Channel = (typeof CHANNELS)[number];

/**
 * One to-do of a stage's checklist (CD-32). The id is stable across renames, so a deal's progress
 * on it (a deal_tasks row with this checklist_item_id) survives renaming the item.
 */
export interface ChecklistItem {
  id: string;
  label: string;
}

/** A funnel is the playbook for one target persona, e.g. "SMB — CEO decides". */
export const funnels = pgTable(
  'funnels',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantId(),
    key: text('key').notNull(), // stable slug, e.g. "smb"
    label: text('label').notNull(),
    note: text('note'),
    position: integer('position').notNull().default(0),
    ...timestamps,
  },
  (t) => [unique('funnels_tenant_id_uq').on(t.tenantId, t.id), unique('funnels_tenant_key_uq').on(t.tenantId, t.key)],
);

export const funnelStages = pgTable(
  'funnel_stages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantId(),
    funnelId: uuid('funnel_id').notNull(),
    key: text('key').notNull(), // "new", "discovery", "won", ...
    name: text('name').notNull(),
    position: integer('position').notNull(),
    activity: text('activity').notNull(), // next best action on entering the stage
    channel: text('channel', { enum: CHANNELS }).notNull().default('EM'),
    documentOnEntry: text('document_on_entry'), // "Proposal", "Quote", ... or null
    winProbability: integer('win_probability').notNull().default(25),
    /**
     * The stage to-dos (gates). checklist_items is the source of truth; checklist keeps the labels
     * only, in the same order, for code that still reads or writes it. A trigger keeps the two in
     * sync (drizzle/0011_checklist_item_ids.sql).
     */
    checklist: jsonb('checklist').$type<string[]>().notNull().default([]),
    checklistItems: jsonb('checklist_items').$type<ChecklistItem[]>().notNull().default([]),
    isWon: boolean('is_won').notNull().default(false), // the terminal "won" stage
    /**
     * Deleted stages (CD-9) are kept, so the stage history of deals that passed through them stays
     * complete. They hold no deals (a trigger enforces it), are left out of the funnel, and their
     * key gets a "~<id>" suffix so a new stage can reuse it.
     */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    unique('funnel_stages_tenant_id_uq').on(t.tenantId, t.id),
    unique('funnel_stages_funnel_key_uq').on(t.funnelId, t.key),
    foreignKey({ columns: [t.tenantId, t.funnelId], foreignColumns: [funnels.tenantId, funnels.id], name: 'funnel_stages_funnel_fk' }).onDelete('cascade'),
    check('funnel_stages_probability_ck', sql`${t.winProbability} between 0 and 100`),
  ],
);

// ---------------------------------------------------------------- deals

export interface ChampScores {
  C: number; // Challenges
  H: number; // Authority
  M: number; // Money
  P: number; // Prioritisation
}

/** Why a deal was lost (a fixed pick list, plus an optional note on the deal). */
export const LOST_REASONS = ['Price', 'Timing', 'Chose a competitor', 'No budget', 'No decision', 'Other'] as const;
export type LostReason = (typeof LOST_REASONS)[number];

export const deals = pgTable(
  'deals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantId(),
    companyId: uuid('company_id'),
    primaryContactId: uuid('primary_contact_id'),
    funnelId: uuid('funnel_id').notNull(),
    stageId: uuid('stage_id').notNull(),
    ownerUserId: uuid('owner_user_id').references(() => users.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    source: text('source'),
    // Net amount (sum of deal lines once those exist). Money is numeric, never float; Drizzle returns a string.
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull().default('0'),
    currency: text('currency').notNull().default('EUR'),
    closeDate: date('close_date'),
    fitScore: integer('fit_score').notNull().default(0), // CHAMP total, 0–100
    champ: jsonb('champ').$type<ChampScores>(),
    // Discovery notes, merged into the proposal ("What you told us").
    headline: text('headline'),
    need: text('discovery_need'),
    constraint: text('discovery_constraint'),
    decisionMaker: text('decision_maker'),
    discoveryDate: date('discovery_date'),
    lastContactAt: timestamp('last_contact_at', { withTimezone: true }),
    stageEnteredAt: timestamp('stage_entered_at', { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp('closed_at', { withTimezone: true }), // when the deal entered the won stage
    /**
     * Lost deals (CD-60). A deal is lost when lost_at is set; it keeps the stage it was lost in.
     * "Won" is not stored: a deal is won while it is in its funnel's won stage (see dealOutcome).
     */
    lostAt: timestamp('lost_at', { withTimezone: true }),
    lostReason: text('lost_reason', { enum: LOST_REASONS }),
    lostNote: text('lost_note'),
    /** Custom field values (CD-15), keyed by custom_field_defs.id. */
    customFields: jsonb('custom_fields').$type<CustomFieldValues>().notNull().default({}),
    ...timestamps,
  },
  (t) => [
    unique('deals_tenant_id_uq').on(t.tenantId, t.id),
    check('deals_lost_ck', sql`(${t.lostAt} is null) = (${t.lostReason} is null) and (${t.lostNote} is null or ${t.lostAt} is not null)`),
    index('deals_tenant_funnel_stage_idx').on(t.tenantId, t.funnelId, t.stageId),
    foreignKey({ columns: [t.tenantId, t.companyId], foreignColumns: [companies.tenantId, companies.id], name: 'deals_company_fk' }),
    foreignKey({ columns: [t.tenantId, t.primaryContactId], foreignColumns: [contacts.tenantId, contacts.id], name: 'deals_contact_fk' }),
    foreignKey({ columns: [t.tenantId, t.funnelId], foreignColumns: [funnels.tenantId, funnels.id], name: 'deals_funnel_fk' }),
    foreignKey({ columns: [t.tenantId, t.stageId], foreignColumns: [funnelStages.tenantId, funnelStages.id], name: 'deals_stage_fk' }),
    check('deals_fit_score_ck', sql`${t.fitScore} between 0 and 100`),
  ],
);

/** Additional people on a deal (multi-threading), besides the primary contact. */
export const dealContacts = pgTable(
  'deal_contacts',
  {
    tenantId: tenantId(),
    dealId: uuid('deal_id').notNull(),
    contactId: uuid('contact_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.dealId, t.contactId] }),
    foreignKey({ columns: [t.tenantId, t.dealId], foreignColumns: [deals.tenantId, deals.id], name: 'deal_contacts_deal_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.tenantId, t.contactId], foreignColumns: [contacts.tenantId, contacts.id], name: 'deal_contacts_contact_fk' }).onDelete('cascade'),
  ],
);

/** Deal history: emails, meetings, calls, notes, completed to-dos, stage changes. */
export const activities = pgTable(
  'activities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantId(),
    dealId: uuid('deal_id').notNull(),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    channel: text('channel', { enum: CHANNELS }).notNull(),
    title: text('title').notNull(),
    detail: text('detail'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('activities_tenant_deal_idx').on(t.tenantId, t.dealId, t.occurredAt),
    foreignKey({ columns: [t.tenantId, t.dealId], foreignColumns: [deals.tenantId, deals.id], name: 'activities_deal_fk' }).onDelete('cascade'),
  ],
);

// ---------------------------------------------------------------- products & services

export const PRODUCT_TYPES = ['Service', 'Product'] as const;
export const BILLING_KINDS = ['One-off', 'Monthly', 'Yearly', 'Hourly'] as const;

export const products = pgTable(
  'products',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    type: text('type', { enum: PRODUCT_TYPES }).notNull().default('Service'),
    billingKind: text('billing_kind', { enum: BILLING_KINDS }).notNull().default('One-off'),
    unitPrice: numeric('unit_price', { precision: 14, scale: 2 }).notNull().default('0'),
    vatRate: numeric('vat_rate', { precision: 5, scale: 2 }).notNull().default('20'),
    /**
     * ISO 4217 code of the price (CD-77). New products get the workspace currency. A deal line
     * can only use a product in the deal's currency (there are no exchange rates).
     */
    currency: text('currency').notNull().default('EUR'),
    ...timestamps,
  },
  (t) => [unique('products_tenant_id_uq').on(t.tenantId, t.id), index('products_tenant_name_idx').on(t.tenantId, t.name)],
);

// ---------------------------------------------------------------- deal lines & payment schedules

export const PAYMENT_SCHEDULES = ['Full amount on one date', 'Equal monthly instalments', 'Recurring subscription', 'Custom milestones'] as const;

export interface Milestone {
  label: string;
  pct: number; // share of the line's gross amount
  date?: string; // ISO date; defaults to one month after the previous milestone
}

/**
 * What a deal sells: a product at a quantity and price, and when it gets paid. The deal's amount
 * is the sum of its lines' net values (DealLinesService keeps it in sync).
 */
export const dealLines = pgTable(
  'deal_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantId(),
    dealId: uuid('deal_id').notNull(),
    productId: uuid('product_id'),
    position: integer('position').notNull().default(0),
    quantity: numeric('quantity', { precision: 12, scale: 2 }).notNull().default('1'),
    unitPrice: numeric('unit_price', { precision: 14, scale: 2 }).notNull().default('0'),
    vatRate: numeric('vat_rate', { precision: 5, scale: 2 }).notNull().default('0'),
    schedule: text('schedule', { enum: PAYMENT_SCHEDULES }).notNull().default('Full amount on one date'),
    startDate: date('start_date'), // first (or only) payment
    months: integer('months').notNull().default(6), // for monthly instalments
    milestones: jsonb('milestones').$type<Milestone[]>().notNull().default([]),
    ...timestamps,
  },
  (t) => [
    unique('deal_lines_tenant_id_uq').on(t.tenantId, t.id),
    index('deal_lines_tenant_deal_idx').on(t.tenantId, t.dealId),
    foreignKey({ columns: [t.tenantId, t.dealId], foreignColumns: [deals.tenantId, deals.id], name: 'deal_lines_deal_fk' }).onDelete('cascade'),
    // A product used on a deal can't be deleted from the catalog.
    foreignKey({ columns: [t.tenantId, t.productId], foreignColumns: [products.tenantId, products.id], name: 'deal_lines_product_fk' }),
    check('deal_lines_months_ck', sql`${t.months} between 1 and 120`),
  ],
);

// ---------------------------------------------------------------- stage to-dos

/**
 * The to-dos of a deal in a stage. Playbook to-dos come from the stage's checklist and only get a
 * row once someone touches them (keyed by checklist item id; the label follows the item's label);
 * off-playbook to-dos are added per deal.
 */
export const dealTasks = pgTable(
  'deal_tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantId(),
    dealId: uuid('deal_id').notNull(),
    stageId: uuid('stage_id').notNull(),
    label: text('label').notNull(),
    /** The checklist item a playbook to-do belongs to (CD-32); null for off-playbook to-dos. */
    checklistItemId: uuid('checklist_item_id'),
    offPlaybook: boolean('off_playbook').notNull().default(false),
    position: integer('position').notNull().default(0),
    done: boolean('done').notNull().default(false),
    doneAt: timestamp('done_at', { withTimezone: true }),
    doneByUserId: uuid('done_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    outcome: text('outcome'),
    note: text('note'),
    /**
     * Stage to-dos (playbook items and to-dos added on the lead) must be done before the deal can
     * advance. Tasks created from the "New task" dialog don't block, and carry the fields below.
     */
    blocksAdvance: boolean('blocks_advance').notNull().default(true),
    dueDate: date('due_date'),
    assigneeUserId: uuid('assignee_user_id').references(() => users.id, { onDelete: 'set null' }),
    channel: text('channel', { enum: CHANNELS }),
    ...timestamps,
  },
  (t) => [
    index('deal_tasks_tenant_deal_idx').on(t.tenantId, t.dealId),
    index('deal_tasks_tenant_due_idx').on(t.tenantId, t.dueDate).where(sql`${t.dueDate} is not null`),
    uniqueIndex('deal_tasks_playbook_uq').on(t.dealId, t.stageId, t.label).where(sql`not ${t.offPlaybook}`),
    uniqueIndex('deal_tasks_playbook_item_uq').on(t.dealId, t.stageId, t.checklistItemId).where(sql`not ${t.offPlaybook} and ${t.checklistItemId} is not null`),
    foreignKey({ columns: [t.tenantId, t.dealId], foreignColumns: [deals.tenantId, deals.id], name: 'deal_tasks_deal_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.tenantId, t.stageId], foreignColumns: [funnelStages.tenantId, funnelStages.id], name: 'deal_tasks_stage_fk' }).onDelete('cascade'),
  ],
);

// ---------------------------------------------------------------- stage history

/**
 * Why a deal's stage or outcome changed. "created" is the first stage of a new deal (and the
 * backfilled row of deals that existed before this table); "funnel_changed" restarts the deal at
 * the new funnel's first stage; "lost" and "reopened" keep the stage and change the outcome.
 */
export const STAGE_CHANGE_KINDS = ['created', 'moved', 'funnel_changed', 'lost', 'reopened'] as const;
export type StageChangeKind = (typeof STAGE_CHANGE_KINDS)[number];
export const DEAL_OUTCOMES = ['open', 'won', 'lost'] as const;
export type DealOutcome = (typeof DEAL_OUTCOMES)[number];

/**
 * One row per stage or outcome change of a deal, written in the same transaction as the change.
 * The conversion metrics on Overview are computed from it.
 */
export const dealStageHistory = pgTable(
  'deal_stage_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantId(),
    dealId: uuid('deal_id').notNull(),
    kind: text('kind', { enum: STAGE_CHANGE_KINDS }).notNull(),
    fromStageId: uuid('from_stage_id'), // null when the deal was created
    toStageId: uuid('to_stage_id').notNull(),
    outcome: text('outcome', { enum: DEAL_OUTCOMES }).notNull(), // the deal's outcome after the change
    changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
    changedByUserId: uuid('changed_by_user_id').references(() => users.id, { onDelete: 'set null' }), // null for backfilled rows
  },
  (t) => [
    unique('deal_stage_history_tenant_id_uq').on(t.tenantId, t.id),
    index('deal_stage_history_tenant_deal_idx').on(t.tenantId, t.dealId, t.changedAt),
    foreignKey({ columns: [t.tenantId, t.dealId], foreignColumns: [deals.tenantId, deals.id], name: 'deal_stage_history_deal_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.tenantId, t.fromStageId], foreignColumns: [funnelStages.tenantId, funnelStages.id], name: 'deal_stage_history_from_stage_fk' }),
    foreignKey({ columns: [t.tenantId, t.toStageId], foreignColumns: [funnelStages.tenantId, funnelStages.id], name: 'deal_stage_history_to_stage_fk' }),
  ],
);

// ---------------------------------------------------------------- sales bonuses (CD-17)

/** When a bonus counts as earned: the deal is won, or it is won and fully billed. */
export const BONUS_TRIGGERS = ['On contract signed', 'When fully billed'] as const;

/** The workspace's bonus settings (one row per tenant; owners and admins only). */
export const salesBonusSettings = pgTable('sales_bonus_settings', {
  tenantId: uuid('tenant_id')
    .primaryKey()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  trigger: text('trigger', { enum: BONUS_TRIGGERS }).notNull().default('On contract signed'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

/**
 * A salesperson's bonus rule: `rate` % of a won deal's net value, or the flat `fixed` amount on
 * deals under `floor`. The amounts are in the workspace currency. Owners and admins only.
 */
export const salesBonusRules = pgTable(
  'sales_bonus_rules',
  {
    tenantId: tenantId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    rate: numeric('rate', { precision: 5, scale: 2 }).notNull().default('0'),
    floor: numeric('floor', { precision: 14, scale: 2 }).notNull().default('0'),
    fixed: numeric('fixed', { precision: 14, scale: 2 }).notNull().default('0'),
    updatedByUserId: uuid('updated_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.userId] }), check('sales_bonus_rules_rate_ck', sql`${t.rate} between 0 and 100`)],
);

// ---------------------------------------------------------------- documents (CD-13)

/** What a template is for (Settings → Document templates, "Document type"). */
export const DOCUMENT_TYPES = ['Proposal', 'Quote', 'Contract', 'NDA', 'Onboarding brief', 'Invoice'] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

/**
 * A .docx template uploaded by an owner or admin. The file lives in storage under
 * `<tenant>/templates/<id>.docx`; `placeholders` are the merge fields found in it at upload.
 */
export const documentTemplates = pgTable(
  'document_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    docType: text('doc_type', { enum: DOCUMENT_TYPES }).notNull().default('Proposal'),
    fileName: text('file_name').notNull(), // as uploaded
    sizeBytes: integer('size_bytes').notNull(),
    storageKey: text('storage_key').notNull(),
    placeholders: jsonb('placeholders').$type<string[]>().notNull().default([]),
    uploadedByUserId: uuid('uploaded_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [unique('document_templates_tenant_id_uq').on(t.tenantId, t.id), index('document_templates_tenant_idx').on(t.tenantId, t.createdAt)],
);

export const DOCUMENT_STATUSES = ['queued', 'running', 'ready', 'failed'] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

/**
 * A document generated for a deal from a template by the worker (job `crm.generate-document`).
 * The file lives under `<tenant>/documents/<id>.docx` once `status` is "ready". The template may be
 * deleted later: `template_id` is then nulled (the FK is in the documents RLS migration, because it
 * sets only that column to null) and `template_name` keeps saying where the document came from.
 */
export const dealDocuments = pgTable(
  'deal_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantId(),
    dealId: uuid('deal_id').notNull(),
    templateId: uuid('template_id'),
    templateName: text('template_name').notNull(),
    docType: text('doc_type', { enum: DOCUMENT_TYPES }).notNull(),
    name: text('name').notNull(),
    status: text('status', { enum: DOCUMENT_STATUSES }).notNull().default('queued'),
    error: text('error'),
    storageKey: text('storage_key'),
    sizeBytes: integer('size_bytes'),
    /** Merge fields the template uses that the deal had no value for (they were left empty). */
    missingFields: jsonb('missing_fields').$type<string[]>().notNull().default([]),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    unique('deal_documents_tenant_id_uq').on(t.tenantId, t.id),
    index('deal_documents_tenant_deal_idx').on(t.tenantId, t.dealId, t.createdAt),
    foreignKey({ columns: [t.tenantId, t.dealId], foreignColumns: [deals.tenantId, deals.id], name: 'deal_documents_deal_fk' }).onDelete('cascade'),
  ],
);
