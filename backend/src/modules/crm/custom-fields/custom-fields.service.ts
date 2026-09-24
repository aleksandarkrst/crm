import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, isNull, max, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AuditService } from '../../../shared/audit/audit.service';
import type { TenantContext } from '../../../shared/authorization';
import { DatabaseService, type Tx } from '../../../shared/database/database.service';
import { mapDbError } from '../../../shared/database/errors';
import {
  companies,
  contacts,
  CUSTOM_FIELD_ENTITIES,
  CUSTOM_FIELD_TYPES,
  type CustomFieldEntity,
  type CustomFieldOption,
  type CustomFieldValues,
  customFieldDefs,
  deals,
} from '../../../shared/database/schema';
import { nonEmptyPatch } from '../../../shared/validation/common';

/** At most this many live fields per record type, and options per select field. */
export const MAX_FIELDS = 50;
const MAX_OPTIONS = 100;
const MAX_TEXT = 2000;

const OptionInput = z.object({ id: z.uuid().optional(), label: z.string().trim().min(1).max(100) });
const Options = z
  .array(OptionInput)
  .max(MAX_OPTIONS)
  .refine((o) => new Set(o.map((x) => x.label.toLowerCase())).size === o.length, 'Options must differ');

export const CreateCustomField = z
  .object({
    entity: z.enum(CUSTOM_FIELD_ENTITIES),
    label: z.string().trim().min(1).max(80),
    type: z.enum(CUSTOM_FIELD_TYPES),
    options: Options.optional(),
    required: z.boolean().optional(),
  })
  .refine((f) => f.type !== 'select' || (f.options?.length ?? 0) > 0, { message: 'A single-select field needs at least one option', path: ['options'] })
  .refine((f) => f.type === 'select' || !f.options?.length, { message: 'Only single-select fields have options', path: ['options'] });
/** The type can't change (the values would no longer fit); rename, options and required can. */
export const UpdateCustomField = nonEmptyPatch(z.object({ label: z.string().trim().min(1).max(80).optional(), options: Options.optional(), required: z.boolean().optional() }));
export const ReorderCustomFields = z.object({ entity: z.enum(CUSTOM_FIELD_ENTITIES), fieldIds: z.array(z.uuid()).max(MAX_FIELDS * 4) });
export const CustomFieldsQuery = z.object({ entity: z.enum(CUSTOM_FIELD_ENTITIES).optional() });
/**
 * Values sent with a create or update: field id → value; null or '' clears the field. Anything goes
 * at this point: CustomFieldsService.validate checks each value against its field before it is
 * stored. The output is typed as the stored shape, so code that spreads the create schemas (the
 * CSV import, which sends none) keeps compiling.
 */
export const CustomFieldValuesInput = (z.record(z.string(), z.unknown()) as unknown as z.ZodType<CustomFieldValues>).optional();
export type CreateCustomField = z.infer<typeof CreateCustomField>;
export type UpdateCustomField = z.infer<typeof UpdateCustomField>;
export type ReorderCustomFields = z.infer<typeof ReorderCustomFields>;
export type CustomFieldsQuery = z.infer<typeof CustomFieldsQuery>;

type Def = typeof customFieldDefs.$inferSelect;
const TABLES = { deal: deals, company: companies, contact: contacts } as const;
const ENTITY_LABEL = { deal: 'deal', company: 'company', contact: 'contact' } as const;

/**
 * Custom fields (CD-15). Owners and admins define fields per record type; everyone fills values.
 * Values live in a `custom_fields` jsonb column on deals, companies and contacts, keyed by field
 * id, and are validated here against the definitions on every write.
 */
@Injectable()
export class CustomFieldsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  /** Live fields, in order. */
  list(ctx: TenantContext, query: CustomFieldsQuery) {
    return this.database.withTenant(ctx.tenantId, (tx) => this.defs(tx, query.entity));
  }

  create(ctx: TenantContext, input: CreateCustomField) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const live = await this.defs(tx, input.entity);
        if (live.length >= MAX_FIELDS) throw new ConflictException(`A ${ENTITY_LABEL[input.entity]} can have at most ${MAX_FIELDS} custom fields.`);
        const [last] = await tx.select({ n: max(customFieldDefs.position) }).from(customFieldDefs).where(eq(customFieldDefs.entity, input.entity));
        const [row] = await tx
          .insert(customFieldDefs)
          .values({
            tenantId: ctx.tenantId,
            entity: input.entity,
            label: input.label,
            type: input.type,
            options: (input.options ?? []).map((o) => ({ id: randomUUID(), label: o.label })),
            required: input.required ?? false,
            position: (last?.n ?? -1) + 1,
          })
          .returning();
        await this.audit.record(tx, ctx, { action: 'custom_field.created', entityType: 'custom_field', entityId: row!.id, data: { entity: input.entity, label: input.label, type: input.type } });
        return row!;
      })
      .catch(labelTaken);
  }

  /**
   * Renaming a field or an option keeps every value (they are stored by id). An option still used
   * by a record can't be removed (409), so no value ends up pointing at nothing.
   */
  update(ctx: TenantContext, id: string, input: UpdateCustomField) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const def = await this.live(tx, id);
        const patch: Partial<typeof customFieldDefs.$inferInsert> = {};
        if (input.label !== undefined) patch.label = input.label;
        if (input.required !== undefined) patch.required = input.required;
        if (input.options !== undefined) {
          if (def.type !== 'select') throw new BadRequestException('Only single-select fields have options');
          if (input.options.length === 0) throw new BadRequestException('A single-select field needs at least one option');
          const known = new Set(def.options.map((o) => o.id));
          const unknown = input.options.find((o) => o.id && !known.has(o.id));
          if (unknown) throw new BadRequestException(`Unknown option id ${unknown.id}`);
          const next: CustomFieldOption[] = input.options.map((o) => ({ id: o.id ?? randomUUID(), label: o.label }));
          const kept = new Set(next.map((o) => o.id));
          for (const removed of def.options.filter((o) => !kept.has(o.id))) {
            const used = await this.usage(tx, def, removed.id);
            if (used > 0) throw new ConflictException(`The option "${removed.label}" is used on ${used === 1 ? '1 record' : used + ' records'}. Change those first, or rename the option instead.`);
          }
          patch.options = next;
        }
        const [row] = await tx.update(customFieldDefs).set(patch).where(eq(customFieldDefs.id, id)).returning();
        await this.audit.record(tx, ctx, { action: 'custom_field.updated', entityType: 'custom_field', entityId: id, data: input });
        return row!;
      })
      .catch(labelTaken);
  }

  /** Takes every live field of the record type once, in the new order. */
  reorder(ctx: TenantContext, input: ReorderCustomFields) {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const live = await this.defs(tx, input.entity);
      const ids = new Set(input.fieldIds);
      if (ids.size !== input.fieldIds.length || live.length !== ids.size || live.some((d) => !ids.has(d.id)))
        throw new BadRequestException(`Send every custom field of the ${ENTITY_LABEL[input.entity]} once`);
      for (const [position, fieldId] of input.fieldIds.entries()) await tx.update(customFieldDefs).set({ position }).where(eq(customFieldDefs.id, fieldId));
      await this.audit.record(tx, ctx, { action: 'custom_field.reordered', entityType: 'custom_field', data: input });
      return this.defs(tx, input.entity);
    });
  }

  /**
   * Soft delete: the field disappears from every screen, form and export, and can't be written
   * any more. The values stay in the records, unseen, so nothing is destroyed by a misclick.
   */
  remove(ctx: TenantContext, id: string) {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      await this.live(tx, id);
      await tx.update(customFieldDefs).set({ deletedAt: new Date() }).where(eq(customFieldDefs.id, id));
      await this.audit.record(tx, ctx, { action: 'custom_field.deleted', entityType: 'custom_field', entityId: id });
    });
  }

  /**
   * Validates the custom field values of a create or update against the live definitions and
   * returns what to store: `set` (normalised values) and `clear` (field ids to remove). Unknown or
   * deleted fields and values of the wrong type are rejected (400). A required field can't be
   * cleared once it has a value; on create, `requireAll` rejects a missing required field.
   */
  async validate(tx: Tx, entity: CustomFieldEntity, input: Record<string, unknown> | CustomFieldValues | undefined, opts: { requireAll?: boolean } = {}): Promise<{ set: CustomFieldValues; clear: string[] }> {
    const set: CustomFieldValues = {};
    const clear: string[] = [];
    if (!input && !opts.requireAll) return { set, clear };
    const defs = await this.defs(tx, entity);
    const byId = new Map(defs.map((d) => [d.id, d]));
    for (const [id, raw] of Object.entries(input ?? {})) {
      const def = byId.get(id);
      if (!def) throw new BadRequestException(`Unknown custom field ${id}`);
      const value = normalise(def, raw);
      if (value === null) {
        if (def.required) throw new BadRequestException(`${def.label} is required`);
        clear.push(id);
      } else set[id] = value;
    }
    if (opts.requireAll) {
      const missing = defs.find((d) => d.required && set[d.id] === undefined);
      if (missing) throw new BadRequestException(`${missing.label} is required`);
    }
    return { set, clear };
  }

  /** SQL for the new custom_fields of an update: the current values, merged with `set`, minus `clear`. */
  merged(column: typeof deals.customFields | typeof companies.customFields | typeof contacts.customFields, change: { set: CustomFieldValues; clear: string[] }) {
    return sql`(${column} || ${JSON.stringify(change.set)}::jsonb) - ${sql.param(change.clear)}::text[]`;
  }

  private defs(tx: Tx, entity?: CustomFieldEntity) {
    return tx
      .select()
      .from(customFieldDefs)
      .where(and(isNull(customFieldDefs.deletedAt), entity ? eq(customFieldDefs.entity, entity) : undefined))
      .orderBy(asc(customFieldDefs.entity), asc(customFieldDefs.position), asc(customFieldDefs.createdAt));
  }

  private async live(tx: Tx, id: string): Promise<Def> {
    const [def] = await tx.select().from(customFieldDefs).where(and(eq(customFieldDefs.id, id), isNull(customFieldDefs.deletedAt)));
    if (!def) throw new NotFoundException('Custom field not found');
    return def;
  }

  /** How many records of the field's type hold `value` in it. */
  private async usage(tx: Tx, def: Def, value: string) {
    const table = TABLES[def.entity];
    const [row] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(table)
      .where(sql`${table.customFields} ->> ${def.id} = ${value}`);
    return row?.n ?? 0;
  }
}

/** A value checked against its field type; null means "clear the field". */
export function normalise(def: Pick<Def, 'label' | 'type' | 'options'>, raw: unknown): string | number | boolean | null {
  const bad = (what: string): never => {
    throw new BadRequestException(`${def.label}: ${what}`);
  };
  if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) return def.type === 'checkbox' && raw !== null && raw !== undefined ? bad('must be true or false') : null;
  switch (def.type) {
    case 'text': {
      if (typeof raw !== 'string') return bad('must be text');
      const v = raw.trim();
      return v.length > MAX_TEXT ? bad(`must be at most ${MAX_TEXT} characters`) : v;
    }
    case 'number': {
      const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw.trim()) : NaN;
      if (!Number.isFinite(n) || Math.abs(n) > 1e15) return bad('must be a number');
      return n;
    }
    case 'date': {
      if (typeof raw !== 'string' || !z.iso.date().safeParse(raw.trim()).success) return bad('must be a date (YYYY-MM-DD)');
      return raw.trim();
    }
    case 'checkbox':
      return typeof raw === 'boolean' ? raw : bad('must be true or false');
    case 'url': {
      if (typeof raw !== 'string') return bad('must be a web address');
      const v = raw.trim();
      let url: URL | null;
      try {
        url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(v) ? v : 'https://' + v);
      } catch {
        url = null;
      }
      if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname.includes('.') || v.length > 2000) return bad('must be a web address, e.g. https://example.com');
      return url.href;
    }
    case 'select': {
      if (typeof raw !== 'string') return bad('must be one of the options');
      const option = def.options.find((o) => o.id === raw) ?? def.options.find((o) => o.label.toLowerCase() === raw.trim().toLowerCase());
      return option ? option.id : bad('must be one of the options');
    }
  }
}

function labelTaken(err: unknown): never {
  const e = err as { cause?: { constraint?: string }; constraint?: string };
  if ((e?.cause?.constraint ?? e?.constraint) === 'custom_field_defs_label_uq') throw new ConflictException('A field with this name already exists for this record type');
  return mapDbError(err);
}
