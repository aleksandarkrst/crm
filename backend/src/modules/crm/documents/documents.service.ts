import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { StorageService } from '../../../infrastructure/storage/storage.service';
import { AuditService } from '../../../shared/audit/audit.service';
import { hasRole, type TenantContext } from '../../../shared/authorization';
import { DatabaseService, type Tx } from '../../../shared/database/database.service';
import { mapDbError } from '../../../shared/database/errors';
import { activities, companies, dealDocuments, deals, DOCUMENT_TYPES, documentTemplates, UPLOAD_DOCUMENT_TYPES } from '../../../shared/database/schema';
import { JobsService } from '../../../shared/events/jobs.service';
import { PaginationQuery } from '../../../shared/validation/common';
import { resetApproval } from '../deals/proposal-approval';
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

/** The type of each uploaded file, in the order of the files (multipart field `types`, JSON). */
export const UploadDocuments = z.object({
  types: z
    .string()
    .transform((v, c) => {
      try {
        return JSON.parse(v) as unknown;
      } catch {
        c.addIssue({ code: 'custom', message: 'Pick a document type for every file' });
        return z.NEVER;
      }
    })
    .pipe(z.array(z.enum(UPLOAD_DOCUMENT_TYPES, { message: 'Pick a document type for every file' })).min(1).max(10)),
});
export type UploadDocuments = z.infer<typeof UploadDocuments>;

/** Uploaded documents (CD-120): PDF, DOCX or XLSX, up to 25 MB each, ten at a time. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const MAX_UPLOAD_FILES = 10;
const UPLOAD_KINDS = {
  pdf: { mime: 'application/pdf', magic: '%PDF-' },
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', magic: 'PK\u0003\u0004' },
  xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', magic: 'PK\u0003\u0004' },
} as const;
type UploadKind = keyof typeof UPLOAD_KINDS;
/** The file's extension for its type (a generated document is a .docx). */
export const extensionOf = (mimeType: string | null): string => (Object.entries(UPLOAD_KINDS).find(([, k]) => k.mime === mimeType)?.[0] ?? 'docx');
export type DocumentsQuery = z.infer<typeof DocumentsQuery>;

/** An uploaded file, as multer hands it over (memory storage). */
export interface UploadedDocx {
  originalname: string;
  size: number;
  buffer: Buffer;
}

export const templateKey = (id: string) => `templates/${id}.docx`;
export const documentKey = (id: string, ext = 'docx') => `documents/${id}.${ext}`;

/** A file name that is safe in a Content-Disposition header and on any disk. */
export function downloadName(name: string, ext = 'docx'): string {
  const base = name
    .normalize('NFKC')
    // eslint-disable-next-line no-control-regex -- control characters are exactly what goes
    .replace(/[\\/:*?"<>|\x00-\x1f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 150);
  return `${base || 'document'}.${ext}`;
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
  source: dealDocuments.source,
  mimeType: dealDocuments.mimeType,
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
        if (!deal) throw new NotFoundException('Opportunity not found');
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
        // A new proposal isn't the one that was approved (CD-120).
        if (template.docType === 'Proposal') await resetApproval(tx, ctx, dealId, 'A new proposal was generated');
        await this.jobs.send('crm.generate-document', { tenantId: ctx.tenantId, documentId: row!.id, actorUserId: ctx.userId }, tx);
        return (await this.findDocument(tx, row!.id))!;
      })
      .catch(mapDbError);
  }

  async documentFile(ctx: TenantContext, id: string): Promise<{ name: string; mimeType: string | null; stream: Readable }> {
    const row = await this.database.withTenant(ctx.tenantId, async (tx) => {
      const [d] = await tx.select({ name: dealDocuments.name, key: dealDocuments.storageKey, status: dealDocuments.status, mimeType: dealDocuments.mimeType }).from(dealDocuments).where(eq(dealDocuments.id, id));
      return d;
    });
    if (!row) throw new NotFoundException('Document not found');
    if (row.status !== 'ready' || !row.key) throw new NotFoundException('This document has no file yet');
    return { name: row.name, mimeType: row.mimeType, stream: await this.open(ctx.tenantId, row.key) };
  }

  /**
   * "Import my own" (CD-120): proposals and documents made outside Pultly, each with its type. One
   * Proposal per opportunity: the one sent for approval and to the client; the rest support it.
   */
  async upload(ctx: TenantContext, dealId: string, files: UploadedDocx[] | undefined, input: UploadDocuments) {
    if (!files?.length) throw new BadRequestException('Choose the files to upload');
    if (files.length !== input.types.length) throw new BadRequestException('Pick a document type for every file');
    const kinds = files.map((f) => uploadKind(f));
    if (input.types.filter((t) => t === 'Proposal').length > 1) throw new BadRequestException('Only one file can be the Proposal; mark the others as supporting documents.');
    const ids = files.map(() => randomUUID());
    const keys = ids.map((id, i) => documentKey(id, kinds[i]));
    // Files first; their rows only if every file is stored, else the stored ones are removed.
    try {
      for (const [i, f] of files.entries()) await this.storage.putBuffer(ctx.tenantId, keys[i]!, f.buffer);
      return await this.database.withTenant(ctx.tenantId, async (tx) => {
        const [deal] = await tx.select({ id: deals.id }).from(deals).where(eq(deals.id, dealId)).for('update');
        if (!deal) throw new NotFoundException('Opportunity not found');
        if (input.types.includes('Proposal')) {
          const [existing] = await tx
            .select({ name: dealDocuments.name })
            .from(dealDocuments)
            .where(and(eq(dealDocuments.dealId, dealId), eq(dealDocuments.docType, 'Proposal')))
            .limit(1);
          if (existing) throw new ConflictException(`This opportunity already has a proposal (${existing.name}). Delete it first, or upload this file as another type.`);
        }
        const now = new Date();
        await tx.insert(dealDocuments).values(
          files.map((f, i) => ({
            id: ids[i]!,
            tenantId: ctx.tenantId,
            dealId,
            templateName: 'Uploaded',
            docType: input.types[i]!,
            name: f.originalname.replace(/\.(pdf|docx|xlsx)$/i, '').slice(0, 160) || 'Document',
            status: 'ready' as const,
            source: 'uploaded' as const,
            mimeType: UPLOAD_KINDS[kinds[i]!].mime,
            storageKey: keys[i]!,
            sizeBytes: f.size,
            createdByUserId: ctx.userId,
            completedAt: now,
          })),
        );
        await tx.insert(activities).values({ tenantId: ctx.tenantId, dealId, actorUserId: ctx.userId, channel: 'NT', title: files.length === 1 ? 'Document uploaded' : `${files.length} documents uploaded`, detail: files.map((f, i) => `${f.originalname} · ${input.types[i]}`).join('\n') });
        await this.audit.record(tx, ctx, { action: 'deal_document.uploaded', entityType: 'deal', entityId: dealId, data: { documents: ids } });
        return Promise.all(ids.map(async (id) => (await this.findDocument(tx, id))!));
      });
    } catch (err) {
      for (const key of keys) await this.storage.delete(ctx.tenantId, key).catch(() => undefined);
      return mapDbError(err);
    }
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
        if (doc.docType === 'Proposal') await resetApproval(tx, ctx, doc.dealId, `The proposal ${doc.name} was deleted`);
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

/** PDF, DOCX or XLSX, by extension and by its first bytes; a 400 that names the file otherwise. */
export function uploadKind(f: UploadedDocx): UploadKind {
  const ext = /\.(pdf|docx|xlsx)$/i.exec(f.originalname)?.[1]?.toLowerCase() as UploadKind | undefined;
  if (!ext || !f.buffer.subarray(0, 5).toString('latin1').startsWith(UPLOAD_KINDS[ext].magic)) {
    throw new BadRequestException(`${f.originalname}: only PDF, DOCX or XLSX files can be uploaded`);
  }
  if (f.size > MAX_UPLOAD_BYTES) throw new BadRequestException(`${f.originalname} is larger than 25 MB`);
  return ext;
}
