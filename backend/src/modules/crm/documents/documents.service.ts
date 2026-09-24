import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { StorageService } from '../../../infrastructure/storage/storage.service';
import { AuditService } from '../../../shared/audit/audit.service';
import { hasRole, type TenantContext } from '../../../shared/authorization';
import { DatabaseService, type Tx } from '../../../shared/database/database.service';
import { mapDbError } from '../../../shared/database/errors';
import { activities, companies, dealDocuments, deals, DOCUMENT_TYPES, documentTemplates } from '../../../shared/database/schema';
import { JobsService } from '../../../shared/events/jobs.service';
import { PaginationQuery } from '../../../shared/validation/common';
import { userNameOf } from '../owner';
import { inspectTemplate, MAX_TEMPLATE_BYTES, TemplateFileError } from './docx';
import { describeTags } from './placeholders';

export const CreateTemplate = z.object({
  name: z.string().trim().min(1, 'Give the template a name').max(120),
  docType: z.enum(DOCUMENT_TYPES).default('Proposal'),
});
export type CreateTemplate = z.infer<typeof CreateTemplate>;

export const GenerateDocument = z.object({
  templateId: z.uuid(),
  /** Defaults to "<template name> — <company or deal title>". */
  name: z.string().trim().min(1).max(160).optional(),
});
export type GenerateDocument = z.infer<typeof GenerateDocument>;

export const DocumentsQuery = PaginationQuery.extend({ dealId: z.uuid().optional() });
export type DocumentsQuery = z.infer<typeof DocumentsQuery>;

/** An uploaded file, as multer hands it over (memory storage). */
export interface UploadedDocx {
  originalname: string;
  size: number;
  buffer: Buffer;
}

export const templateKey = (id: string) => `templates/${id}.docx`;
export const documentKey = (id: string) => `documents/${id}.docx`;

/** A file name that is safe in a Content-Disposition header and on any disk. */
export function downloadName(name: string): string {
  const base = name
    .normalize('NFKC')
    // eslint-disable-next-line no-control-regex -- control characters are exactly what goes
    .replace(/[\\/:*?"<>|\x00-\x1f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 150);
  return `${base || 'document'}.docx`;
}

const templateColumns = {
  id: documentTemplates.id,
  name: documentTemplates.name,
  docType: documentTemplates.docType,
  fileName: documentTemplates.fileName,
  sizeBytes: documentTemplates.sizeBytes,
  placeholders: documentTemplates.placeholders,
  uploadedByUserId: documentTemplates.uploadedByUserId,
  uploadedByName: userNameOf(documentTemplates.uploadedByUserId),
  createdAt: documentTemplates.createdAt,
};

const documentColumns = {
  id: dealDocuments.id,
  dealId: dealDocuments.dealId,
  templateId: dealDocuments.templateId,
  templateName: dealDocuments.templateName,
  docType: dealDocuments.docType,
  name: dealDocuments.name,
  status: dealDocuments.status,
  error: dealDocuments.error,
  sizeBytes: dealDocuments.sizeBytes,
  missingFields: dealDocuments.missingFields,
  createdByUserId: dealDocuments.createdByUserId,
  createdByName: userNameOf(dealDocuments.createdByUserId),
  createdAt: dealDocuments.createdAt,
  completedAt: dealDocuments.completedAt,
};

/**
 * Document templates and the documents generated from them (CD-13). Templates are .docx files with
 * {{merge fields}}; owners and admins manage them, everyone generates and downloads. Generating
 * queues `crm.generate-document`, which the worker runs (DocumentGenerator). Files live in
 * StorageService under the tenant's folder and are only served after their row is found with
 * withTenant, so another workspace gets 404.
 */
@Injectable()
export class DocumentsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly jobs: JobsService,
  ) {}

  // ------------------------------------------------------------ templates

  listTemplates(ctx: TenantContext) {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const rows = await tx.select(templateColumns).from(documentTemplates).orderBy(desc(documentTemplates.createdAt));
      return rows.map(presentTemplate);
    });
  }

  /** Checks a file and lists its merge fields, without saving anything (the dialog's preview). */
  scan(file: UploadedDocx | undefined) {
    const tags = this.checkUpload(file);
    return { fileName: file!.originalname, sizeBytes: file!.size, placeholders: describeTags(tags) };
  }

  async createTemplate(ctx: TenantContext, file: UploadedDocx | undefined, input: CreateTemplate) {
    const tags = this.checkUpload(file);
    const id = randomUUID();
    const key = templateKey(id);
    await this.storage.putBuffer(ctx.tenantId, key, file!.buffer);
    try {
      return await this.database.withTenant(ctx.tenantId, async (tx) => {
        await tx.insert(documentTemplates).values({
          id,
          tenantId: ctx.tenantId,
          name: input.name,
          docType: input.docType,
          fileName: file!.originalname.slice(0, 200),
          sizeBytes: file!.size,
          storageKey: key,
          placeholders: tags,
          uploadedByUserId: ctx.userId,
        });
        await this.audit.record(tx, ctx, { action: 'document_template.created', entityType: 'document_template', entityId: id, data: { name: input.name } });
        const [row] = await tx.select(templateColumns).from(documentTemplates).where(eq(documentTemplates.id, id));
        return presentTemplate(row!);
      });
    } catch (err) {
      await this.storage.delete(ctx.tenantId, key);
      return mapDbError(err);
    }
  }

  async templateFile(ctx: TenantContext, id: string): Promise<{ name: string; stream: Readable }> {
    const row = await this.database.withTenant(ctx.tenantId, async (tx) => {
      const [t] = await tx.select({ name: documentTemplates.name, key: documentTemplates.storageKey }).from(documentTemplates).where(eq(documentTemplates.id, id));
      return t;
    });
    if (!row) throw new NotFoundException('Template not found');
    return { name: row.name, stream: await this.open(ctx.tenantId, row.key) };
  }

  /** Deletes the template and its file. Documents made from it stay (template_id becomes null). */
  async deleteTemplate(ctx: TenantContext, id: string): Promise<void> {
    const key = await this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const [row] = await tx.delete(documentTemplates).where(eq(documentTemplates.id, id)).returning({ key: documentTemplates.storageKey, name: documentTemplates.name });
        if (!row) throw new NotFoundException('Template not found');
        await this.audit.record(tx, ctx, { action: 'document_template.deleted', entityType: 'document_template', entityId: id, data: { name: row.name } });
        return row.key;
      })
      .catch(mapDbError);
    await this.storage.delete(ctx.tenantId, key);
  }

  // ------------------------------------------------------------ deal documents

  listDocuments(ctx: TenantContext, query: DocumentsQuery) {
    return this.database.withTenant(ctx.tenantId, (tx) =>
      tx
        .select(documentColumns)
        .from(dealDocuments)
        .where(query.dealId ? eq(dealDocuments.dealId, query.dealId) : undefined)
        .orderBy(desc(dealDocuments.createdAt), desc(dealDocuments.id))
        .limit(query.limit)
        .offset(query.offset),
    );
  }

  async getDocument(ctx: TenantContext, id: string) {
    const row = await this.database.withTenant(ctx.tenantId, (tx) => this.findDocument(tx, id));
    if (!row) throw new NotFoundException('Document not found');
    return row;
  }

  /** Queues the generation; the worker fills the template and marks the document ready. */
  generate(ctx: TenantContext, dealId: string, input: GenerateDocument) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const [deal] = await tx
          .select({ title: deals.title, company: companies.name })
          .from(deals)
          .leftJoin(companies, and(eq(companies.tenantId, deals.tenantId), eq(companies.id, deals.companyId)))
          .where(eq(deals.id, dealId));
        if (!deal) throw new NotFoundException('Deal not found');
        const [template] = await tx.select().from(documentTemplates).where(eq(documentTemplates.id, input.templateId));
        if (!template) throw new BadRequestException('Unknown template');
        const [row] = await tx
          .insert(dealDocuments)
          .values({
            tenantId: ctx.tenantId,
            dealId,
            templateId: template.id,
            templateName: template.name,
            docType: template.docType,
            name: input.name ?? `${template.name} — ${deal.company || deal.title}`.slice(0, 160),
            createdByUserId: ctx.userId,
          })
          .returning({ id: dealDocuments.id });
        await this.jobs.send('crm.generate-document', { tenantId: ctx.tenantId, documentId: row!.id, actorUserId: ctx.userId }, tx);
        return (await this.findDocument(tx, row!.id))!;
      })
      .catch(mapDbError);
  }

  async documentFile(ctx: TenantContext, id: string): Promise<{ name: string; stream: Readable }> {
    const row = await this.database.withTenant(ctx.tenantId, async (tx) => {
      const [d] = await tx.select({ name: dealDocuments.name, key: dealDocuments.storageKey, status: dealDocuments.status }).from(dealDocuments).where(eq(dealDocuments.id, id));
      return d;
    });
    if (!row) throw new NotFoundException('Document not found');
    if (row.status !== 'ready' || !row.key) throw new NotFoundException('This document has no file yet');
    return { name: row.name, stream: await this.open(ctx.tenantId, row.key) };
  }

  /** Owners, admins and whoever generated it can delete a document; its file goes with it. */
  async deleteDocument(ctx: TenantContext, id: string): Promise<void> {
    const key = await this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const [doc] = await tx.select().from(dealDocuments).where(eq(dealDocuments.id, id));
        if (!doc) throw new NotFoundException('Document not found');
        if (doc.createdByUserId !== ctx.userId && !hasRole(ctx.role, 'admin')) {
          throw new ForbiddenException('Only owners, admins and the person who generated it can delete a document');
        }
        await tx.delete(dealDocuments).where(eq(dealDocuments.id, id));
        await tx.insert(activities).values({ tenantId: ctx.tenantId, dealId: doc.dealId, actorUserId: ctx.userId, channel: 'NT', title: `Document deleted · ${doc.name}`, detail: null });
        await this.audit.record(tx, ctx, { action: 'deal_document.deleted', entityType: 'deal_document', entityId: id, data: { dealId: doc.dealId, name: doc.name } });
        return doc.storageKey;
      })
      .catch(mapDbError);
    if (key) await this.storage.delete(ctx.tenantId, key);
  }

  // ------------------------------------------------------------ helpers

  private async findDocument(tx: Tx, id: string) {
    const [row] = await tx.select(documentColumns).from(dealDocuments).where(eq(dealDocuments.id, id));
    return row;
  }

  private async open(tenantId: string, key: string): Promise<Readable> {
    try {
      return await this.storage.get(tenantId, key);
    } catch {
      // The row exists but the file doesn't (e.g. restored database without the files backup).
      throw new NotFoundException('The file is missing from storage');
    }
  }

  /** Type and size limits, then the template must compile. Returns its merge fields. */
  private checkUpload(file: UploadedDocx | undefined): string[] {
    if (!file) throw new BadRequestException('Choose a .docx file to upload');
    if (!/\.docx$/i.test(file.originalname)) throw new BadRequestException('Templates must be Word documents (.docx)');
    if (file.size > MAX_TEMPLATE_BYTES) throw new BadRequestException(`Templates can be up to ${MAX_TEMPLATE_BYTES / 1024 / 1024} MB`);
    if (file.size === 0) throw new BadRequestException('The file is empty');
    try {
      return inspectTemplate(file.buffer);
    } catch (err) {
      if (err instanceof TemplateFileError) throw new BadRequestException(err.message);
      throw err;
    }
  }
}

function presentTemplate(row: { placeholders: string[] } & Record<string, unknown>) {
  return { ...row, placeholders: describeTags(row.placeholders) };
}
