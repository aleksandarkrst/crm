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
    checklist: jsonb('checklist').$type<string[]>().notNull().default([]), // stage to-dos (gates)
    isWon: boolean('is_won').notNull().default(false), // the terminal "won" stage
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
    lastContactAt: timestamp('last_contact_at', { withTimezone: true }),
    stageEnteredAt: timestamp('stage_entered_at', { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    unique('deals_tenant_id_uq').on(t.tenantId, t.id),
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
    ...timestamps,
  },
  (t) => [unique('products_tenant_id_uq').on(t.tenantId, t.id), index('products_tenant_name_idx').on(t.tenantId, t.name)],
);
