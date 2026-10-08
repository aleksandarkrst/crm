import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Res, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { RequireTenant, Tenant, type TenantContext } from '../../shared/authorization';
import { MAX_PROJECT_FILE_BYTES } from '../../shared/database/schema';
import { RateLimit } from '../../shared/rate-limit';
import { UuidParam } from '../../shared/validation/common';
import { ZodPipe } from '../../shared/validation/zod-validation.pipe';
import { ProjectFilesService, UpdateProjectFile, UploadProjectFile, type UploadedProjectFile } from './project-files.service';

const Id = new ZodPipe(UuidParam);

/**
 * A project's files (CD-271). `{ id, name, folder, contentType, sizeBytes, addedByUserId,
 * addedByName, createdAt }`.
 */
@Controller('projects/:id/files')
@RequireTenant('member')
export class ProjectFilesController {
  constructor(private readonly files: ProjectFilesService) {}

  @Get()
  list(@Tenant() ctx: TenantContext, @Param('id', Id) id: string) {
    return this.files.list(ctx, id);
  }

  /** multipart/form-data: `file` (at most 25 MB; more is 413) and `folder`. */
  @Post()
  @RateLimit('heavy')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_PROJECT_FILE_BYTES, files: 1, fields: 3, fieldSize: 1_000 },
      defParamCharset: 'utf8', // browsers send UTF-8 file names
    }),
  )
  upload(@Tenant() ctx: TenantContext, @Param('id', Id) id: string, @UploadedFile() file: UploadedProjectFile | undefined, @Body(new ZodPipe(UploadProjectFile)) body: UploadProjectFile) {
    return this.files.upload(ctx, id, file, body);
  }

  /** Always a download (`attachment`, `nosniff`), never shown inline, whatever the file claims to be. */
  @Get(':fileId/download')
  async download(@Tenant() ctx: TenantContext, @Param('id', Id) id: string, @Param('fileId', Id) fileId: string, @Res({ passthrough: true }) res: Response) {
    const { name, contentType, stream } = await this.files.download(ctx, id, fileId);
    const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, "'");
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    return new StreamableFile(stream as never);
  }

  @Patch(':fileId')
  update(@Tenant() ctx: TenantContext, @Param('id', Id) id: string, @Param('fileId', Id) fileId: string, @Body(new ZodPipe(UpdateProjectFile)) body: UpdateProjectFile) {
    return this.files.update(ctx, id, fileId, body);
  }

  @Delete(':fileId')
  @HttpCode(204)
  remove(@Tenant() ctx: TenantContext, @Param('id', Id) id: string, @Param('fileId', Id) fileId: string) {
    return this.files.remove(ctx, id, fileId);
  }
}
