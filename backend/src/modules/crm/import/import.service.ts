import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
import { asc, eq, isNotNull, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { AuditService } from '../../../shared/audit/audit.service';
import type { TenantContext } from '../../../shared/authorization';
import { DatabaseService, type Tx } from '../../../shared/database/database.service';
import { activities, BILLING_FREQUENCIES, type BillingFrequency, BUYER_ROLES, companies, contacts, dealStageHistory, deals, funnels, funnelStages, memberships, products, tenants, users } from '../../../shared/database/schema';
import { CreateCompany } from '../companies/companies.service';
import { CreateContact } from '../contacts/contacts.service';
import { CreateDeal } from '../deals/deals.service';
import { CreateProduct } from '../products/products.service';
import { StageHistoryService } from '../deals/stage-history.service';
import type { CsvRow } from '../../../shared/import/csv';
import { ColumnMappingSchema, failureReason as reasonOf, IMPORT_BATCH_SIZE as BATCH_SIZE, normalizeDate, prepareImport, PREVIEW_PROBLEMS, PREVIEW_ROWS, valuesOf } from '../../../shared/import/import-file';
import { type ColumnMapping, IMPORT_FIELDS, type ImportType } from './import-fields';

export { MAX_IMPORT_BYTES, MAX_IMPORT_ROWS, normalizeDate } from '../../../shared/import/import-file';

export const ImportRequest = z.object({
  csv: z.string().min(1, 'The file is empty'),
  /** Field key → column index; omitted on the first preview, which guesses it from the headers. */
  mapping: ColumnMappingSchema.optional(),
  /** What to do with a row that matches an existing record (companies by name, contacts by email). */
  duplicates: z.enum(['skip', 'update']).default('skip'),
  /** Deals: the funnel for rows without a Funnel column value (default: the first funnel). */
  funnelId: z.uuid().optional(),
});
export type ImportRequest = z.infer<typeof ImportRequest>;

type RowStatus = 'create' | 'update' | 'skip' | 'invalid';

interface Funnel {
  id: string;
  key: string;
  label: string;
  stages: { id: string; key: string; name: string; isWon: boolean }[];
}

/** Existing records the rows are matched against; rows created during the import are added. */
interface Lookups {
  /** lower(trim(name)) → id of the oldest company with that name. */
  companiesByName: Map<string, string>;
  /** lower(email) → contact id. */
  contactsByEmail: Map<string, string>;
  /** lower(trim(name)) → id of the oldest product with that name (CD-81). */
  productsByName: Map<string, string>;
  /** Product id → its billing frequency, so a row that leaves the frequency out is checked against it (CD-81). */
  productFrequency: Map<string, BillingFrequency>;
  /** lower(email) → user id, members of this workspace only. */
  members: Map<string, string>;
  funnels: Funnel[];
  /** New deals get this unless the row names a currency, as in the create endpoint. */
  currency: string;
}

/** Writes rows (commit) or pretends to (preview, which returns placeholder ids). */
interface Writer {
  createCompany(input: CreateCompany): Promise<string>;
  updateCompany(id: string, patch: Partial<CreateCompany>): Promise<void>;
  createContact(input: CreateContact): Promise<string>;
  updateContact(id: string, patch: Partial<CreateContact>): Promise<void>;
  createDeal(input: CreateDeal, stage: Funnel['stages'][number], refs: { companyId: string; primaryContactId: string | null }): Promise<string>;
  createProduct(input: CreateProduct): Promise<string>;
  updateProduct(id: string, patch: Partial<CreateProduct>): Promise<void>;
}

interface RowResult {
  status: RowStatus;
  /** Validation problems (invalid) or why the row was skipped. */
  messages: string[];
  /** Side effects worth showing, e.g. "New company: Acme". */
  notes: string[];
  newCompanies: number;
  newContacts: number;
  /** Lookup changes, applied once the row is saved (so a failed row leaves no trace). */
  effects: (() => void)[];
}

interface Prepared {
  type: ImportType;
  headers: string[];
  delimiter: string;
  rows: CsvRow[];
  mapping: ColumnMapping;
  missingRequired: string[];
  warnings: string[];
}

const key = (v: string) => v.trim().toLowerCase();

/** "14000", "14,000.50", "14.000,50", "€ 14 000" → "14000.50"; anything else is passed on for zod to reject. */
export function normalizeAmount(raw: string): string {
  const v = raw.replace(/[\s€$£]|EUR|USD|RSD|GBP/gi, '');
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(v)) return v.replace(/,/g, '');
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(v)) return v.replace(/\./g, '').replace(',', '.');
  if (/^\d+,\d{1,2}$/.test(v)) return v.replace(',', '.');
  return v;
}

/** Only the values that are present, so an update never blanks a field the file left empty. */
function present<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== '')) as Partial<T>;
}

/**
 * CSV import of companies, contacts, deals (CD-64) and products (CD-81). No table of its own: `preview` parses and
 * validates the whole file and writes nothing, `commit` parses it again and saves the rows in
 * batches of 200, each in one `withTenant` transaction: rows are checked in memory, their writes
 * queued and saved with multi-row inserts. If the database refuses a batch, it is redone row by row
 * in savepoints, so one bad row fails alone. Rows are validated with the same zod schemas as the create endpoints.
 */
@Injectable()
export class ImportService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly history: StageHistoryService,
  ) {}

  async preview(ctx: TenantContext, type: ImportType, req: ImportRequest) {
    const prep = this.prepare(type, req);
    const lookups = await this.database.withTenant(ctx.tenantId, (tx) => this.loadLookups(tx, ctx, type));
    const funnel = this.defaultFunnel(type, lookups, req.funnelId);
    let fake = 0;
    const dry: Writer = {
      createCompany: async () => `new-company-${++fake}`,
      updateCompany: async () => undefined,
      createContact: async () => `new-contact-${++fake}`,
      updateContact: async () => undefined,
      createDeal: async () => `new-deal-${++fake}`,
      createProduct: async () => `new-product-${++fake}`,
      updateProduct: async () => undefined,
    };

    const counts = { rows: prep.rows.length, create: 0, update: 0, skip: 0, invalid: 0, newCompanies: 0, newContacts: 0 };
    const rows: { line: number; values: Record<string, string>; status: RowStatus; messages: string[]; notes: string[] }[] = [];
    const problems: { line: number; messages: string[] }[] = [];
    for (const row of prep.rows) {
      const values = this.valuesOf(prep, row);
      const result = await this.handleRow(prep, values, lookups, funnel, req.duplicates, dry);
      result.effects.forEach((apply) => apply());
      counts[result.status]++;
      counts.newCompanies += result.newCompanies;
      counts.newContacts += result.newContacts;
      if (rows.length < PREVIEW_ROWS) rows.push({ line: row.line, values, status: result.status, messages: result.messages, notes: result.notes });
      if (result.status === 'invalid' && problems.length < PREVIEW_PROBLEMS) problems.push({ line: row.line, messages: result.messages });
    }
    return {
      type,
      delimiter: prep.delimiter,
      headers: prep.headers,
      mapping: prep.mapping,
      fields: IMPORT_FIELDS[type],
      missingRequired: prep.missingRequired,
      warnings: prep.warnings,
      counts,
      rows,
      problems,
    };
  }

  async commit(ctx: TenantContext, type: ImportType, req: ImportRequest) {
    const prep = this.prepare(type, req);
    if (prep.missingRequired.length) throw new BadRequestException(`Choose a column for ${prep.missingRequired.join(', ')}`);
    const lookups = await this.database.withTenant(ctx.tenantId, (tx) => this.loadLookups(tx, ctx, type));
    const funnel = this.defaultFunnel(type, lookups, req.funnelId);

    const summary = { created: 0, updated: 0, skipped: 0, failed: 0, newCompanies: 0, newContacts: 0 };
    const failures: { line: number; reason: string; cells: string[] }[] = [];
    const skipped: { line: number; reason: string }[] = [];

    for (let start = 0; start < prep.rows.length; start += BATCH_SIZE) {
      const batch = prep.rows.slice(start, start + BATCH_SIZE);
      let outcomes: Outcome[] = [];
      const audit = (tx: Tx) => {
        const n = (s: string) => outcomes.filter((o) => o.result.status === s).length;
        return this.audit.record(tx, ctx, {
          action: 'crm.imported',
          entityType: type,
          data: { firstLine: batch[0]!.line, lastLine: batch[batch.length - 1]!.line, created: n('create'), updated: n('update'), skipped: n('skip'), failed: n('invalid') + n('failed') },
        });
      };
      const snapshot = cloneLookups(lookups);
      try {
        // Fast path: rows are checked in memory and their writes queued (ids are made here), then
        // the batch is saved with a few multi-row inserts.
        await this.database.withTenant(ctx.tenantId, async (tx) => {
          const queue = emptyQueue();
          const w = this.queueWriter(queue, ctx);
          for (const row of batch) {
            const result = await this.handleRow(prep, this.valuesOf(prep, row), lookups, funnel, req.duplicates, w);
            result.effects.forEach((apply) => apply());
            outcomes.push({ row, result });
          }
          await this.flush(tx, queue);
          await audit(tx);
        });
      } catch {
        // Something in the batch was refused by the database (e.g. a row changed meanwhile).
        // Redo the batch row by row, each in a savepoint, so only the bad rows fail.
        restoreLookups(lookups, snapshot);
        outcomes = [];
      }
      try {
        if (outcomes.length === 0) {
          await this.database.withTenant(ctx.tenantId, async (tx) => {
            for (const row of batch) {
              const values = this.valuesOf(prep, row);
              try {
                const result = await tx.transaction((sp) => this.handleRow(prep, values, lookups, funnel, req.duplicates, this.writer(sp, ctx)));
                result.effects.forEach((apply) => apply());
                outcomes.push({ row, result });
              } catch (err) {
                outcomes.push({ row, result: { status: 'failed', reason: reasonOf(err) } });
              }
            }
            await audit(tx);
          });
        }
      } catch (err) {
        // The batch transaction itself failed: none of its rows were saved, and the lookups may
        // point at rows that don't exist, so stop here and report the rest as not imported.
        const reason = `Not imported: ${reasonOf(err)}`;
        for (const row of prep.rows.slice(start)) failures.push({ line: row.line, reason, cells: row.cells });
        summary.failed += prep.rows.length - start;
        break;
      }
      for (const { row, result } of outcomes) {
        if (result.status === 'failed' || result.status === 'invalid') {
          summary.failed++;
          failures.push({ line: row.line, reason: 'reason' in result ? result.reason : result.messages.join('; '), cells: row.cells });
          continue;
        }
        summary.newCompanies += result.newCompanies;
        summary.newContacts += result.newContacts;
        if (result.status === 'create') summary.created++;
        else if (result.status === 'update') summary.updated++;
        else {
          summary.skipped++;
          skipped.push({ line: row.line, reason: result.messages.join('; ') });
        }
      }
    }
    return { type, ...summary, headers: prep.headers, failures, skippedRows: skipped };
  }

  // ------------------------------------------------------------------ parsing and lookups

  private prepare(type: ImportType, req: ImportRequest): Prepared {
    return { type, ...prepareImport(IMPORT_FIELDS[type], type, req.csv, req.mapping) };
  }

  /** The mapped cells of a row by field key, trimmed, with the export's formula guard removed. */
  private valuesOf(prep: Prepared, row: CsvRow): Record<string, string> {
    return valuesOf(prep.mapping, row);
  }

  private async loadLookups(tx: Tx, ctx: TenantContext, type: ImportType): Promise<Lookups> {
    const companiesByName = new Map<string, string>();
    for (const c of await tx.select({ id: companies.id, name: companies.name }).from(companies).orderBy(asc(companies.createdAt), asc(companies.id))) {
      if (!companiesByName.has(key(c.name))) companiesByName.set(key(c.name), c.id);
    }
    const contactsByEmail = new Map<string, string>();
    for (const c of await tx.select({ id: contacts.id, email: contacts.email }).from(contacts).where(isNotNull(contacts.email)).orderBy(asc(contacts.createdAt), asc(contacts.id))) {
      if (c.email && !contactsByEmail.has(key(c.email))) contactsByEmail.set(key(c.email), c.id);
    }
    const productsByName = new Map<string, string>();
    const productFrequency = new Map<string, BillingFrequency>();
    if (type === 'products') {
      for (const p of await tx
        .select({ id: products.id, name: products.name, billingFrequency: products.billingFrequency })
        .from(products)
        .orderBy(asc(products.createdAt), asc(products.id))) {
        if (!productsByName.has(key(p.name))) productsByName.set(key(p.name), p.id);
        productFrequency.set(p.id, p.billingFrequency as BillingFrequency);
      }
    }
    // memberships has no RLS (it decides access), so filter by tenant explicitly.
    const members = new Map<string, string>();
    for (const m of await tx.select({ userId: memberships.userId, email: users.email }).from(memberships).innerJoin(users, eq(users.id, memberships.userId)).where(eq(memberships.tenantId, ctx.tenantId))) {
      if (m.email) members.set(key(m.email), m.userId);
    }
    let fs: Funnel[] = [];
    if (type === 'deals') {
      const list = await tx.select({ id: funnels.id, key: funnels.key, label: funnels.label }).from(funnels).orderBy(asc(funnels.position), asc(funnels.createdAt));
      const stages = await tx
        .select({ id: funnelStages.id, funnelId: funnelStages.funnelId, key: funnelStages.key, name: funnelStages.name, isWon: funnelStages.isWon })
        .from(funnelStages)
        .where(isNull(funnelStages.deletedAt)) // removed stages stay only for the history
        .orderBy(asc(funnelStages.position));
      fs = list.map((f) => ({ ...f, stages: stages.filter((s) => s.funnelId === f.id) }));
    }
    // tenants has no RLS either.
    const [workspace] = await tx.select({ currency: tenants.currency }).from(tenants).where(eq(tenants.id, ctx.tenantId));
    return { companiesByName, contactsByEmail, productsByName, productFrequency, members, funnels: fs, currency: workspace?.currency ?? 'EUR' };
  }

  private defaultFunnel(type: ImportType, lookups: Lookups, funnelId: string | undefined): Funnel | null {
    if (type !== 'deals') return null;
    if (funnelId) {
      const found = lookups.funnels.find((f) => f.id === funnelId);
      if (!found) throw new BadRequestException('Unknown funnel');
      return found;
    }
    return lookups.funnels[0] ?? null;
  }

  // ------------------------------------------------------------------ rows

  private handleRow(prep: Prepared, v: Record<string, string>, lk: Lookups, funnel: Funnel | null, duplicates: 'skip' | 'update', w: Writer): Promise<RowResult> {
    const result: RowResult = { status: 'create', messages: [], notes: [], newCompanies: 0, newContacts: 0, effects: [] };
    const invalid = (messages: string[]) => ({ ...result, status: 'invalid' as const, messages, effects: [] });
    const labels = Object.fromEntries(IMPORT_FIELDS[prep.type].map((f) => [f.key, f.label]));
    const errors: string[] = [];
    for (const f of IMPORT_FIELDS[prep.type]) if (f.required && !v[f.key]) errors.push(`${f.label} is required`);

    let ownerUserId: string | undefined;
    if (v.ownerEmail) {
      ownerUserId = lk.members.get(key(v.ownerEmail));
      if (!ownerUserId) errors.push(`Owner email: no member of this workspace has the email ${v.ownerEmail}`);
    }
    const zodErrors = (err: z.ZodError, prefix?: string, names: Record<string, string> = labels) =>
      err.issues.map((i) => {
        const field = String(i.path[0] ?? '');
        return `${prefix ?? names[field] ?? field}: ${i.message}`;
      });

    switch (prep.type) {
      case 'companies':
        return this.companyRow(v, lk, duplicates, w, result, errors, ownerUserId, zodErrors, invalid);
      case 'contacts':
        return this.contactRow(v, lk, duplicates, w, result, errors, ownerUserId, zodErrors, invalid);
      case 'deals':
        return this.dealRow(v, lk, funnel, w, result, errors, ownerUserId, zodErrors, invalid);
      case 'products':
        return this.productRow(v, lk, duplicates, w, result, errors, zodErrors, invalid);
    }
  }

  /** A product (CD-81), matched by name like companies. Frequencies are read by label or key. */
  private async productRow(
    v: Record<string, string>,
    lk: Lookups,
    duplicates: 'skip' | 'update',
    w: Writer,
    result: RowResult,
    errors: string[],
    zodErrors: (err: z.ZodError) => string[],
    invalid: (m: string[]) => RowResult,
  ): Promise<RowResult> {
    let billingFrequency: BillingFrequency | undefined;
    if (v.billingFrequency) {
      const want = v.billingFrequency.toLowerCase().replace(/[^a-z]/g, '');
      const aliases: Record<string, BillingFrequency> = { onetime: 'one_time', once: 'one_time', oneoff: 'one_time', weekly: 'weekly', monthly: 'monthly', quarterly: 'quarterly', annually: 'annually', yearly: 'annually', annual: 'annually' };
      billingFrequency = aliases[want] ?? BILLING_FREQUENCIES.find((f) => f === v.billingFrequency);
      if (!billingFrequency) errors.push(`Billing frequency: "${v.billingFrequency}" is not One time, Weekly, Monthly, Quarterly or Annually`);
    }
    // An existing product keeps its frequency when the row leaves it out, so cycles are checked against that.
    const existingId = v.name ? lk.productsByName.get(key(v.name)) : undefined;
    const frequency = billingFrequency ?? (existingId ? lk.productFrequency.get(existingId) : undefined);
    let billingCycles: number | null | undefined;
    if (v.billingCycles) {
      billingCycles = Number(v.billingCycles);
      if (!Number.isInteger(billingCycles)) errors.push(`Billing cycles: "${v.billingCycles}" is not a whole number`);
      else if (!frequency || frequency === 'one_time') errors.push('Billing cycles: only recurring products (weekly, monthly, quarterly or annually) have billing cycles');
    } else if (billingFrequency && billingFrequency !== 'one_time') billingCycles = null;
    const parsed = CreateProduct.safeParse({
      name: v.name,
      description: v.description,
      unit: v.unit,
      unitPrice: v.unitPrice ? normalizeAmount(v.unitPrice) : undefined,
      quantity: v.quantity ? normalizeAmount(v.quantity) : undefined,
      vatRate: v.vatRate ? normalizeAmount(v.vatRate.replace('%', '')) : undefined,
      billingFrequency,
      billingCycles: billingFrequency === 'one_time' ? null : billingCycles,
    });
    if (!parsed.success) errors.push(...zodErrors(parsed.error).filter((m) => !(v.name === '' && m.startsWith('Name:'))));
    if (errors.length || !parsed.success) return invalid(errors);

    const input = parsed.data;
    const existing = lk.productsByName.get(key(input.name));
    if (existing) {
      const patch = present({ ...input, name: undefined });
      // A row that sets the frequency also sets the cycles: none for one time, an empty cell means until canceled.
      if (billingFrequency) patch.billingCycles = input.billingCycles ?? null;
      if (duplicates === 'skip') return { ...result, status: 'skip', messages: [`A product named "${input.name}" already exists`] };
      if (Object.keys(patch).length === 0) return { ...result, status: 'skip', messages: [`"${input.name}" already exists and the row has nothing else to update`] };
      await w.updateProduct(existing, patch);
      if (patch.billingFrequency) result.effects.push(() => lk.productFrequency.set(existing, patch.billingFrequency!));
      return { ...result, status: 'update', notes: [`Updates the existing product "${input.name}"`] };
    }
    const id = await w.createProduct(input);
    result.effects.push(() => {
      lk.productsByName.set(key(input.name), id);
      lk.productFrequency.set(id, input.billingFrequency ?? 'one_time');
    });
    return result;
  }

  private async companyRow(
    v: Record<string, string>,
    lk: Lookups,
    duplicates: 'skip' | 'update',
    w: Writer,
    result: RowResult,
    errors: string[],
    ownerUserId: string | undefined,
    zodErrors: (err: z.ZodError) => string[],
    invalid: (m: string[]) => RowResult,
  ): Promise<RowResult> {
    const parsed = CreateCompany.safeParse({ name: v.name, industry: v.industry, hq: v.hq, teamSize: v.teamSize, source: v.source, domain: v.domain, notes: v.notes, ownerUserId });
    if (!parsed.success) errors.push(...zodErrors(parsed.error).filter((m) => !(v.name === '' && m.startsWith('Name:'))));
    if (errors.length || !parsed.success) return invalid(errors);

    const input = parsed.data;
    const existing = lk.companiesByName.get(key(input.name));
    if (existing) {
      // The name is the match key; the existing company keeps its spelling.
      const patch = present({ ...input, name: undefined });
      if (duplicates === 'skip') return { ...result, status: 'skip', messages: [`A company named "${input.name}" already exists`] };
      if (Object.keys(patch).length === 0) return { ...result, status: 'skip', messages: [`"${input.name}" already exists and the row has nothing else to update`] };
      await w.updateCompany(existing, patch);
      return { ...result, status: 'update', notes: [`Updates the existing company "${input.name}"`] };
    }
    const id = await w.createCompany(input);
    result.effects.push(() => lk.companiesByName.set(key(input.name), id));
    return result;
  }

  private async contactRow(
    v: Record<string, string>,
    lk: Lookups,
    duplicates: 'skip' | 'update',
    w: Writer,
    result: RowResult,
    errors: string[],
    ownerUserId: string | undefined,
    zodErrors: (err: z.ZodError, prefix?: string) => string[],
    invalid: (m: string[]) => RowResult,
  ): Promise<RowResult> {
    const buyerRole = v.buyerRole ? (BUYER_ROLES.find((r) => key(r) === key(v.buyerRole!)) ?? v.buyerRole) : undefined;
    const parsed = CreateContact.safeParse({ fullName: v.fullName, email: v.email, jobTitle: v.jobTitle, phone: v.phone, linkedin: v.linkedin, buyerRole, ownerUserId });
    if (!parsed.success) errors.push(...zodErrors(parsed.error).filter((m) => !(v.fullName === '' && m.startsWith('Full name:'))));
    const company = v.company ? CreateCompany.shape.name.safeParse(v.company) : null;
    if (company && !company.success) errors.push(...zodErrors(company.error, 'Company'));
    if (errors.length || !parsed.success) return invalid(errors);

    const input = parsed.data;
    const existing = input.email ? lk.contactsByEmail.get(key(input.email)) : undefined;
    if (existing && duplicates === 'skip') return { ...result, status: 'skip', messages: [`A contact with the email ${input.email} already exists`] };
    const companyId = company?.success ? await this.companyFor(company.data, lk, w, result) : undefined;
    if (existing) {
      // The email is the match key; the existing contact keeps its spelling.
      const patch = present({ ...input, email: undefined, companyId });
      await w.updateContact(existing, patch);
      return { ...result, status: 'update', notes: [...result.notes, `Updates the existing contact with the email ${input.email}`] };
    }
    const id = await w.createContact({ ...input, companyId });
    if (input.email) result.effects.push(() => lk.contactsByEmail.set(key(input.email!), id));
    return result;
  }

  private async dealRow(
    v: Record<string, string>,
    lk: Lookups,
    fallback: Funnel | null,
    w: Writer,
    result: RowResult,
    errors: string[],
    ownerUserId: string | undefined,
    zodErrors: (err: z.ZodError, prefix?: string, names?: Record<string, string>) => string[],
    invalid: (m: string[]) => RowResult,
  ): Promise<RowResult> {
    let funnel = fallback;
    if (v.funnel) {
      funnel = lk.funnels.find((f) => key(f.label) === key(v.funnel!) || key(f.key) === key(v.funnel!)) ?? null;
      if (!funnel) errors.push(`Funnel: there is no funnel named "${v.funnel}"`);
    } else if (!funnel) errors.push('Funnel: this workspace has no funnel');
    let stage = funnel?.stages[0];
    if (funnel && v.stage) {
      stage = funnel.stages.find((s) => key(s.name) === key(v.stage!) || key(s.key) === key(v.stage!));
      if (!stage) errors.push(`Stage: "${funnel.label}" has no stage named "${v.stage}"`);
    } else if (funnel && !stage) errors.push(`Funnel: "${funnel.label}" has no stages`);

    const parsed = CreateDeal.safeParse({
      title: v.title,
      funnelId: funnel?.id ?? '00000000-0000-4000-8000-000000000000',
      source: v.source,
      amount: v.amount ? normalizeAmount(v.amount) : undefined,
      closeDate: v.closeDate ? normalizeDate(v.closeDate) : undefined,
      ownerUserId,
    });
    const names = { title: 'Deal', amount: 'Value', closeDate: 'Closing date', source: 'Source', ownerUserId: 'Owner email' };
    if (!parsed.success) errors.push(...zodErrors(parsed.error, undefined, names).filter((m) => !(v.title === '' && m.startsWith('Deal:'))));
    const company = v.company ? CreateCompany.shape.name.safeParse(v.company) : null;
    if (company && !company.success) errors.push(...zodErrors(company.error, 'Company'));

    // The primary contact: an existing contact with the email, otherwise a new one when a name is given.
    let contactId = v.contactEmail ? lk.contactsByEmail.get(key(v.contactEmail)) : undefined;
    let newContact: CreateContact | undefined;
    if (!contactId && v.contactName) {
      const c = CreateContact.safeParse({ fullName: v.contactName, email: v.contactEmail, buyerRole: 'Decision maker' });
      if (c.success) newContact = c.data;
      else errors.push(...zodErrors(c.error, undefined, { fullName: 'Contact', email: 'Contact email' }));
    } else if (!contactId && v.contactEmail) {
      errors.push(`Contact email: no contact has the email ${v.contactEmail} (add a Contact name to create one)`);
    }
    if (errors.length || !parsed.success || !stage || !company?.success) return invalid(errors);

    const companyId = await this.companyFor(company.data, lk, w, result);
    if (newContact) {
      const email = newContact.email;
      contactId = await w.createContact({ ...newContact, companyId });
      const id = contactId;
      if (email) result.effects.push(() => lk.contactsByEmail.set(key(email), id));
      result.newContacts++;
      result.notes.push(`New contact: ${newContact.fullName}`);
    }
    await w.createDeal({ ...parsed.data, currency: parsed.data.currency ?? lk.currency }, stage, { companyId, primaryContactId: contactId ?? null });
    return result;
  }

  /** A company by name: the existing one (oldest, if several share the name) or a new one. */
  private async companyFor(name: string, lk: Lookups, w: Writer, result: RowResult): Promise<string> {
    const existing = lk.companiesByName.get(key(name));
    if (existing) return existing;
    const id = await w.createCompany({ name });
    result.effects.push(() => lk.companiesByName.set(key(name), id));
    result.newCompanies++;
    result.notes.push(`New company: ${name}`);
    return id;
  }

  /** Queues the writes of a batch; ids are generated here so later rows can refer to them. */
  private queueWriter(q: Queue, ctx: TenantContext): Writer {
    const tenantId = ctx.tenantId;
    return {
      createCompany: async (input) => {
        const id = randomUUID();
        q.companies.push({ ...input, id, ownerUserId: input.ownerUserId ?? ctx.userId, tenantId });
        return id;
      },
      updateCompany: async (id, patch) => void q.updates.push((tx) => tx.update(companies).set(patch).where(eq(companies.id, id))),
      createContact: async (input) => {
        const id = randomUUID();
        q.contacts.push({ ...input, id, ownerUserId: input.ownerUserId ?? ctx.userId, tenantId });
        return id;
      },
      updateContact: async (id, patch) => void q.updates.push((tx) => tx.update(contacts).set(patch).where(eq(contacts.id, id))),
      createDeal: async (input, stage, refs) => {
        const id = randomUUID();
        const now = new Date();
        q.deals.push({ ...input, ...refs, id, ownerUserId: input.ownerUserId ?? ctx.userId, tenantId, stageId: stage.id, stageEnteredAt: now, closedAt: stage.isWon ? now : null, createdAt: now, updatedAt: now });
        q.history.push({ tenantId, dealId: id, kind: 'created', fromStageId: null, toStageId: stage.id, outcome: stage.isWon ? 'won' : 'open', changedAt: now, changedByUserId: ctx.userId });
        q.activities.push({ tenantId, dealId: id, actorUserId: ctx.userId, channel: 'RS', title: 'Deal created', detail: importedDetail(input.source) });
        return id;
      },
      createProduct: async (input) => {
        const id = randomUUID();
        q.products.push({ ...input, id, tenantId });
        return id;
      },
      updateProduct: async (id, patch) => void q.updates.push((tx) => tx.update(products).set(patch).where(eq(products.id, id))),
    };
  }

  /** Saves a queued batch: parents before children, a few rows per statement. */
  private async flush(tx: Tx, q: Queue): Promise<void> {
    const chunks = <T>(rows: T[], size = 100) => Array.from({ length: Math.ceil(rows.length / size) }, (_, i) => rows.slice(i * size, i * size + size));
    for (const c of chunks(q.products)) await tx.insert(products).values(c);
    for (const c of chunks(q.companies)) await tx.insert(companies).values(c);
    for (const update of q.updates) await update(tx);
    for (const c of chunks(q.contacts)) await tx.insert(contacts).values(c);
    for (const c of chunks(q.deals)) await tx.insert(deals).values(c);
    for (const c of chunks(q.history)) await tx.insert(dealStageHistory).values(c);
    for (const c of chunks(q.activities)) await tx.insert(activities).values(c);
  }

  /** Real writes, inside the row's savepoint. Same defaults as the create endpoints (owner = you). */
  private writer(tx: Tx, ctx: TenantContext): Writer {
    const tenantId = ctx.tenantId;
    return {
      createCompany: async (input) => {
        const [row] = await tx.insert(companies).values({ ...input, ownerUserId: input.ownerUserId ?? ctx.userId, tenantId }).returning({ id: companies.id });
        return row!.id;
      },
      updateCompany: async (id, patch) => {
        await tx.update(companies).set(patch).where(eq(companies.id, id));
      },
      createContact: async (input) => {
        const [row] = await tx.insert(contacts).values({ ...input, ownerUserId: input.ownerUserId ?? ctx.userId, tenantId }).returning({ id: contacts.id });
        return row!.id;
      },
      updateContact: async (id, patch) => {
        await tx.update(contacts).set(patch).where(eq(contacts.id, id));
      },
      createDeal: async (input, stage, refs) => {
        const now = new Date();
        const [row] = await tx
          .insert(deals)
          .values({ ...input, ...refs, ownerUserId: input.ownerUserId ?? ctx.userId, tenantId, stageId: stage.id, stageEnteredAt: now, closedAt: stage.isWon ? now : null })
          .returning({ id: deals.id, createdAt: deals.createdAt });
        const outcome = stage.isWon ? 'won' : 'open';
        await this.history.record(tx, ctx, { dealId: row!.id, kind: 'created', fromStageId: null, toStageId: stage.id, outcome }, row!.createdAt);
        await tx.insert(activities).values({ tenantId, dealId: row!.id, actorUserId: ctx.userId, channel: 'RS', title: 'Deal created', detail: importedDetail(input.source) });
        return row!.id;
      },
      createProduct: async (input) => {
        const [row] = await tx.insert(products).values({ ...input, tenantId }).returning({ id: products.id });
        return row!.id;
      },
      updateProduct: async (id, patch) => {
        await tx.update(products).set(patch).where(eq(products.id, id));
      },
    };
  }
}

const importedDetail = (source: string | null | undefined) => (source ? `Imported from CSV · Source: ${source}` : 'Imported from CSV');

type Outcome = { row: CsvRow; result: RowResult | { status: 'failed'; reason: string } };

/** Writes of one batch, saved together by ImportService.flush. */
interface Queue {
  companies: (typeof companies.$inferInsert)[];
  contacts: (typeof contacts.$inferInsert)[];
  deals: (typeof deals.$inferInsert)[];
  history: (typeof dealStageHistory.$inferInsert)[];
  activities: (typeof activities.$inferInsert)[];
  products: (typeof products.$inferInsert)[];
  updates: ((tx: Tx) => Promise<unknown>)[];
}
const emptyQueue = (): Queue => ({ companies: [], contacts: [], deals: [], history: [], activities: [], products: [], updates: [] });

const cloneLookups = (lk: Lookups) => ({
  companiesByName: new Map(lk.companiesByName),
  contactsByEmail: new Map(lk.contactsByEmail),
  productsByName: new Map(lk.productsByName),
  productFrequency: new Map(lk.productFrequency),
});
function restoreLookups(lk: Lookups, saved: ReturnType<typeof cloneLookups>) {
  lk.companiesByName = saved.companiesByName;
  lk.contactsByEmail = saved.contactsByEmail;
  lk.productsByName = saved.productsByName;
  lk.productFrequency = saved.productFrequency;
}

