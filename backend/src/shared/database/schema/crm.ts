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
    notes: text('notes'),
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
    /** The stage to-dos (gates), with stable ids (CD-32). */
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

/** How a deal's line prices are meant (CD-83). */
export const TAX_MODES = ['exclusive', 'inclusive', 'none'] as const;
export type TaxMode = (typeof TAX_MODES)[number];
export const DISCOUNT_KINDS = ['percent', 'amount'] as const;
export type DiscountKind = (typeof DISCOUNT_KINDS)[number];

/** A discount on the whole deal: a percentage of, or an amount off, its one-time products. */
export interface DealDiscount {
  id: string;
  label: string;
  kind: DiscountKind;
  value: number;
}

/** One part of an installment plan: what it is for, when it is billed, how much (incl. tax). */
export interface Installment {
  id: string;
  description: string;
  date: string | null; // ISO date
  amount: number;
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
    /** How the line prices are meant (CD-83): tax on top, tax included, or no tax. */
    taxMode: text('tax_mode', { enum: TAX_MODES }).notNull().default('exclusive'),
    /** Discounts on the whole deal; they apply to one-time products only (CD-83). */
    discounts: jsonb('discounts').$type<DealDiscount[]>().notNull().default([]),
    /** When a deal with only one-time products is paid, in parts (CD-83). Empty: on each line's date. */
    installments: jsonb('installments').$type<Installment[]>().notNull().default([]),
    /** Custom field values (CD-15), keyed by custom_field_defs.id. */
    customFields: jsonb('custom_fields').$type<CustomFieldValues>().notNull().default({}),
    ...timestamps,
  },
  (t) => [
    unique('deals_tenant_id_uq').on(t.tenantId, t.id),
    check('deals_lost_ck', sql`(${t.lostAt} is null) = (${t.lostReason} is null) and (${t.lostNote} is null or ${t.lostAt} is not null)`),
    index('deals_tenant_funnel_stage_idx').on(t.tenantId, t.funnelId, t.stageId),
    // For the foreign keys: company and contact pages, the owner filter, stage removal (CD-87).
    index('deals_tenant_company_idx').on(t.tenantId, t.companyId),
    index('deals_tenant_contact_idx').on(t.tenantId, t.primaryContactId),
    index('deals_tenant_stage_idx').on(t.tenantId, t.stageId),
    index('deals_tenant_owner_idx').on(t.tenantId, t.ownerUserId),
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
    // Deleting a contact cascades here by contact (CD-87).
    index('deal_contacts_tenant_contact_idx').on(t.tenantId, t.contactId),
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

/** How often a product is billed (CD-83). Recurring products bill every period, for their cycles. */
export const BILLING_FREQUENCIES = ['one_time', 'weekly', 'monthly', 'quarterly', 'annually'] as const;
export type BillingFrequency = (typeof BILLING_FREQUENCIES)[number];

/**
 * The catalog (CD-83). A product is priced per unit (`unit`, e.g. "hour") and comes with a default
 * `quantity`: its price is unit price × quantity. It has no currency: a deal line takes the number
 * in the deal's currency. `billing_cycles` null means a recurring product renews until canceled.
 */
export const products = pgTable(
  'products',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    description: text('description'),
    unit: text('unit'),
    unitPrice: numeric('unit_price', { precision: 14, scale: 2 }).notNull().default('0'),
    quantity: numeric('quantity', { precision: 12, scale: 2 }).notNull().default('1'),
    vatRate: numeric('vat_rate', { precision: 5, scale: 2 }).notNull().default('20'),
    billingFrequency: text('billing_frequency', { enum: BILLING_FREQUENCIES }).notNull().default('one_time'),
    billingCycles: integer('billing_cycles'),
    ...timestamps,
  },
  (t) => [
    unique('products_tenant_id_uq').on(t.tenantId, t.id),
    index('products_tenant_name_idx').on(t.tenantId, t.name),
    check('products_billing_cycles_ck', sql`${t.billingCycles} is null or ${t.billingCycles} between 1 and 1000`),
  ],
);

// ---------------------------------------------------------------- deal lines & payment schedules

/**
 * What a deal sells (CD-83): a product at a quantity and price, with a discount and tax, billed
 * from `start_date` once or every period for its cycles. Prices are in the deal's currency and read
 * with the deal's tax mode. The deal's amount is its value (see deals/deal-value.ts), kept in sync
 * by DealLinesService.
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
    discountKind: text('discount_kind', { enum: DISCOUNT_KINDS }).notNull().default('percent'),
    discountValue: numeric('discount_value', { precision: 14, scale: 2 }).notNull().default('0'),
    billingFrequency: text('billing_frequency', { enum: BILLING_FREQUENCIES }).notNull().default('one_time'),
    billingCycles: integer('billing_cycles'), // null: renews until canceled (recurring only)
    startDate: date('start_date'), // billing start date
    description: text('description'),
    ...timestamps,
  },
  (t) => [
    unique('deal_lines_tenant_id_uq').on(t.tenantId, t.id),
    index('deal_lines_tenant_deal_idx').on(t.tenantId, t.dealId),
    // Deleting a product checks this foreign key (CD-87).
    index('deal_lines_tenant_product_idx').on(t.tenantId, t.productId),
    foreignKey({ columns: [t.tenantId, t.dealId], foreignColumns: [deals.tenantId, deals.id], name: 'deal_lines_deal_fk' }).onDelete('cascade'),
    // A product used on a deal can't be deleted from the catalog.
    foreignKey({ columns: [t.tenantId, t.productId], foreignColumns: [products.tenantId, products.id], name: 'deal_lines_product_fk' }),
    check('deal_lines_billing_cycles_ck', sql`${t.billingCycles} is null or ${t.billingCycles} between 1 and 1000`),
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
    // Stage removal moves and deletes to-dos by stage; the daily digest reads them by assignee (CD-87).
    index('deal_tasks_tenant_stage_idx').on(t.tenantId, t.stageId),
    index('deal_tasks_tenant_assignee_idx').on(t.tenantId, t.assigneeUserId),
    index('deal_tasks_tenant_due_idx').on(t.tenantId, t.dueDate).where(sql`${t.dueDate} is not null`),
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

// ---------------------------------------------------------------- meetings (CD-130)

/** Customer visit, online meeting, meeting at our office, phone call. Only visits count toward visit plans. */
export const MEETING_TYPES = ['visit', 'online', 'office', 'phone'] as const;
export type MeetingType = (typeof MEETING_TYPES)[number];
export const MEETING_STATUSES = ['planned', 'held', 'cancelled'] as const;
export type MeetingStatus = (typeof MEETING_STATUSES)[number];
export const MEETING_PARTICIPANT_KINDS = ['internal', 'external'] as const;
export type MeetingParticipantKind = (typeof MEETING_PARTICIPANT_KINDS)[number];

/**
 * A meeting with a customer company (CD-130): times are instants, shown in the workspace time
 * zone. The company can't be deleted while it has meetings (no cascade); deleting the deal only
 * unlinks it (ON DELETE SET NULL (deal_id), in the custom migration because Drizzle can't express
 * a column list). organizer_user_id null means "Organizer left". updated_at is the If-Match version
 * (crm_touch_version), like deals.
 */
export const meetings = pgTable(
  'meetings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantId(),
    title: text('title').notNull(),
    type: text('type', { enum: MEETING_TYPES }).notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    location: text('location'),
    agenda: text('agenda'),
    companyId: uuid('company_id').notNull(),
    dealId: uuid('deal_id'),
    organizerUserId: uuid('organizer_user_id').references(() => users.id, { onDelete: 'set null' }),
    status: text('status', { enum: MEETING_STATUSES }).notNull().default('planned'),
    cancelReason: text('cancel_reason'),
    heldAt: timestamp('held_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    // The .ics SEQUENCE (RFC 5545): raised with each update or cancellation emailed to the
    // internal participants, so their calendars take the newest version (CD-131).
    icsSequence: integer('ics_sequence').notNull().default(0),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [
    unique('meetings_tenant_id_uq').on(t.tenantId, t.id),
    index('meetings_tenant_starts_idx').on(t.tenantId, t.startsAt),
    index('meetings_tenant_company_idx').on(t.tenantId, t.companyId),
    index('meetings_tenant_deal_idx').on(t.tenantId, t.dealId),
    index('meetings_tenant_organizer_idx').on(t.tenantId, t.organizerUserId),
    foreignKey({ columns: [t.tenantId, t.companyId], foreignColumns: [companies.tenantId, companies.id], name: 'meetings_company_fk' }),
    check('meetings_time_ck', sql`${t.endsAt} > ${t.startsAt}`),
    check('meetings_type_ck', sql`${t.type} in ('visit', 'online', 'office', 'phone')`),
    check('meetings_status_ck', sql`${t.status} in ('planned', 'held', 'cancelled')`),
  ],
);

/**
 * The people at a meeting: members (internal, user_id) and contacts (external, contact_id). The
 * organizer is always an internal participant (MeetingsService keeps it so). `name` and `email`
 * are snapshots, so a deleted contact still shows as "<name> (deleted)": deleting the contact sets
 * contact_id to null (ON DELETE SET NULL (contact_id), in the custom migration).
 */
export const meetingParticipants = pgTable(
  'meeting_participants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantId(),
    meetingId: uuid('meeting_id').notNull(),
    kind: text('kind', { enum: MEETING_PARTICIPANT_KINDS }).notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    contactId: uuid('contact_id'),
    name: text('name').notNull(),
    email: text('email'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('meeting_participants_tenant_id_uq').on(t.tenantId, t.id),
    index('meeting_participants_tenant_meeting_idx').on(t.tenantId, t.meetingId),
    index('meeting_participants_tenant_user_idx').on(t.tenantId, t.userId),
    index('meeting_participants_tenant_contact_idx').on(t.tenantId, t.contactId),
    uniqueIndex('meeting_participants_user_uq').on(t.meetingId, t.userId).where(sql`${t.userId} is not null`),
    uniqueIndex('meeting_participants_contact_uq').on(t.meetingId, t.contactId).where(sql`${t.contactId} is not null`),
    foreignKey({ columns: [t.tenantId, t.meetingId], foreignColumns: [meetings.tenantId, meetings.id], name: 'meeting_participants_meeting_fk' }).onDelete('cascade'),
    check('meeting_participants_kind_ck', sql`${t.kind} in ('internal', 'external') and (${t.kind} = 'internal' or ${t.userId} is null) and (${t.kind} = 'external' or ${t.contactId} is null)`),
  ],
);

// ---------------------------------------------------------------- visit plans (CD-134)

export const VISIT_PLAN_PERIOD_TYPES = ['month', 'quarter'] as const;
export type VisitPlanPeriodType = (typeof VISIT_PLAN_PERIOD_TYPES)[number];

/**
 * How many customer visits a salesperson should make to which companies in one month or fiscal
 * quarter. `period_start` is the first day of the period, `period_end` the first day after it
 * (quarters follow tenants.fiscal_year_start_month when the plan is saved). One plan per
 * salesperson, period type and period.
 */
export const visitPlans = pgTable(
  'visit_plans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantId(),
    salespersonUserId: uuid('salesperson_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    periodType: text('period_type', { enum: VISIT_PLAN_PERIOD_TYPES }).notNull(),
    periodStart: date('period_start').notNull(),
    periodEnd: date('period_end').notNull(),
    note: text('note'),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [
    unique('visit_plans_tenant_id_uq').on(t.tenantId, t.id),
    unique('visit_plans_period_uq').on(t.tenantId, t.salespersonUserId, t.periodType, t.periodStart),
    index('visit_plans_tenant_period_idx').on(t.tenantId, t.periodStart),
    check('visit_plans_period_type_ck', sql`${t.periodType} in ('month', 'quarter')`),
    check('visit_plans_period_ck', sql`${t.periodEnd} > ${t.periodStart}`),
  ],
);

/** One customer of a visit plan and how often to visit it (1–99). A company is in a plan once. */
export const visitPlanLines = pgTable(
  'visit_plan_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantId(),
    planId: uuid('plan_id').notNull(),
    companyId: uuid('company_id').notNull(),
    plannedVisits: integer('planned_visits').notNull(),
    ...timestamps,
  },
  (t) => [
    unique('visit_plan_lines_tenant_id_uq').on(t.tenantId, t.id),
    unique('visit_plan_lines_company_uq').on(t.planId, t.companyId),
    // Deleting a company checks this foreign key (it is refused while the company is in a plan).
    index('visit_plan_lines_tenant_company_idx').on(t.tenantId, t.companyId),
    foreignKey({ columns: [t.tenantId, t.planId], foreignColumns: [visitPlans.tenantId, visitPlans.id], name: 'visit_plan_lines_plan_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.tenantId, t.companyId], foreignColumns: [companies.tenantId, companies.id], name: 'visit_plan_lines_company_fk' }),
    check('visit_plan_lines_planned_ck', sql`${t.plannedVisits} between 1 and 99`),
  ],
);

// ---------------------------------------------------------------- change history (CD-69)

export const HISTORY_ENTITY_TYPES = ['deal', 'company', 'contact', 'meeting', 'visit_plan'] as const;
export type HistoryEntityType = (typeof HISTORY_ENTITY_TYPES)[number];
export const RECORD_CHANGE_ACTIONS = ['created', 'updated', 'deleted', 'line_added', 'line_changed', 'line_removed', 'participant_added', 'participant_removed'] as const;
export type RecordChangeAction = (typeof RECORD_CHANGE_ACTIONS)[number];

/**
 * Who changed which field of a deal, company, contact or visit plan (CD-134), and when (old → new). Written by
 * database triggers (drizzle/0020_record_changes_rls.sql), so every write path is covered: the API,
 * CSV import and worker jobs. The actor is the user set by DatabaseService.withTenant
 * (app.user_id); null means the system. No foreign key to the record: the history outlives it.
 * `field` uses the API's field names (title, ownerUserId, …); labels keep names that were true at
 * the time (product names on deal lines).
 */
export const recordChanges = pgTable(
  'record_changes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantId(),
    entityType: text('entity_type', { enum: HISTORY_ENTITY_TYPES }).notNull(),
    entityId: uuid('entity_id').notNull(),
    action: text('action', { enum: RECORD_CHANGE_ACTIONS }).notNull(),
    field: text('field'),
    oldValue: jsonb('old_value'),
    newValue: jsonb('new_value'),
    label: text('label'),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    /** The browser tab that made the change (X-Client-Id), so a tab's own edits never conflict with each other. */
    clientId: text('client_id'),
    changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('record_changes_entity_idx').on(t.tenantId, t.entityType, t.entityId, t.changedAt)],
);

// ---------------------------------------------------------------- sample data

export const SAMPLE_KINDS = ['company', 'contact', 'product', 'deal'] as const;
export type SampleKind = (typeof SAMPLE_KINDS)[number];

/**
 * The records "Load sample data" created (CD-68), so "Remove sample data" deletes exactly those.
 * A table of ids rather than a flag on each table: the CRM tables stay as they are, and the
 * marks go away with the records. Deal tasks, lines, activities and history cascade with deals.
 */
export const sampleRecords = pgTable(
  'sample_records',
  {
    tenantId: tenantId(),
    kind: text('kind', { enum: SAMPLE_KINDS }).notNull(),
    recordId: uuid('record_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.kind, t.recordId] })],
);
