import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query, Res, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { RequireTenant, Tenant, type TenantContext } from '../../../shared/authorization';
import { UuidParam } from '../../../shared/validation/common';
import { ZodPipe } from '../../../shared/validation/zod-validation.pipe';
import { DOCX_MIME, MAX_TEMPLATE_BYTES, starterTemplate } from './docx';
import { CreateTemplate, DocumentsQuery, DocumentsService, downloadName, GenerateDocument, type UploadedDocx } from './documents.service';
import { ALIASES, LINE_PLACEHOLDERS, LINES_LOOP, PLACEHOLDERS } from './placeholders';

const Id = new ZodPipe(UuidParam);

/** Multipart upload of one .docx, kept in memory (at most MAX_TEMPLATE_BYTES; more is 413). */
const Upload = () =>
  UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_TEMPLATE_BYTES, files: 1, fields: 5, fieldSize: 10_000 },
      defParamCharset: 'utf8', // browsers send UTF-8 file names
    }),
  );

/** Sends a .docx as a download; the name works in every browser (RFC 6266 / 5987). */
function attachment(res: Response, name: string, stream: NodeJS.ReadableStream | Buffer): StreamableFile {
  const file = downloadName(name);
  const ascii = file.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, "'");
  res.setHeader('Content-Type', DOCX_MIME);
  res.setHeader('Content-Disposition', `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file)}`);
  res.setHeader('Cache-Control', 'private, no-store');
  return new StreamableFile(stream as never);
}

/**
 * Document templates and generated documents (CD-13). Everyone in the workspace reads templates,
 * generates documents and downloads them; owners and admins upload and delete templates.
 */
@Controller('crm')
@RequireTenant('member')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  // ------------------------------------------------------------ templates
  @Get('document-templates')
  listTemplates(@Tenant() ctx: TenantContext) {
    return this.documents.listTemplates(ctx);
  }

  /** The merge fields a template can use (the reference in Settings). */
  @Get('document-templates/placeholders')
  placeholders() {
    return { fields: PLACEHOLDERS, loop: LINES_LOOP, lineFields: LINE_PLACEHOLDERS, aliases: ALIASES, delimiters: ['{{', '}}'], maxBytes: MAX_TEMPLATE_BYTES };
  }

  /** A starter .docx that uses the main fields and the deal lines table. */
  @Get('document-templates/starter')
  starter(@Res({ passthrough: true }) res: Response) {
    return attachment(res, 'Cadence proposal starter template', starterTemplate());
  }

  /** Checks a .docx and lists its merge fields without saving it. */
  @Post('document-templates/scan')
  @RequireTenant('admin')
  @HttpCode(200)
  @Upload()
  scan(@UploadedFile() file: UploadedDocx | undefined) {
    return this.documents.scan(file);
  }

  /** multipart/form-data: `file` (.docx), `name`, `docType`. */
  @Post('document-templates')
  @RequireTenant('admin')
  @Upload()
  createTemplate(@Tenant() ctx: TenantContext, @UploadedFile() file: UploadedDocx | undefined, @Body(new ZodPipe(CreateTemplate)) body: CreateTemplate) {
    return this.documents.createTemplate(ctx, file, body);
  }

  @Get('document-templates/:id/file')
  async templateFile(@Tenant() ctx: TenantContext, @Param('id', Id) id: string, @Res({ passthrough: true }) res: Response) {
    const { name, stream } = await this.documents.templateFile(ctx, id);
    return attachment(res, name, stream);
  }

  @Delete('document-templates/:id')
  @RequireTenant('admin')
  @HttpCode(204)
  deleteTemplate(@Tenant() ctx: TenantContext, @Param('id', Id) id: string) {
    return this.documents.deleteTemplate(ctx, id);
  }

  // ------------------------------------------------------------ deal documents
  @Get('deal-documents')
  listDocuments(@Tenant() ctx: TenantContext, @Query(new ZodPipe(DocumentsQuery)) query: DocumentsQuery) {
    return this.documents.listDocuments(ctx, query);
  }

  /** Queues generation (202); poll GET deal-documents/:id until status is "ready" or "failed". */
  @Post('deals/:id/documents')
  @HttpCode(202)
  generate(@Tenant() ctx: TenantContext, @Param('id', Id) dealId: string, @Body(new ZodPipe(GenerateDocument)) body: GenerateDocument) {
    return this.documents.generate(ctx, dealId, body);
  }

  @Get('deal-documents/:docId')
  getDocument(@Tenant() ctx: TenantContext, @Param('docId', Id) id: string) {
    return this.documents.getDocument(ctx, id);
  }

  @Get('deal-documents/:docId/file')
  async documentFile(@Tenant() ctx: TenantContext, @Param('docId', Id) id: string, @Res({ passthrough: true }) res: Response) {
    const { name, stream } = await this.documents.documentFile(ctx, id);
    return attachment(res, name, stream);
  }

  @Delete('deal-documents/:docId')
  @HttpCode(204)
  deleteDocument(@Tenant() ctx: TenantContext, @Param('docId', Id) id: string) {
    return this.documents.deleteDocument(ctx, id);
  }
}
