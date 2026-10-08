import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { StorageService } from '../../infrastructure/storage/storage.service';
import { AuditService } from '../../shared/audit/audit.service';
import { hasRole, type TenantContext } from '../../shared/authorization';
import { DatabaseService, type Tx } from '../../shared/database/database.service';
import { mapDbError } from '../../shared/database/errors';
import { MAX_PROJECT_FILE_BYTES, PROJECT_FILE_FOLDERS, projectFiles, projects, users } from '../../shared/database/schema';

/** What multer hands over for one uploaded file (kept in memory). */
export interface UploadedProjectFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/** multipart/form-data fields next to `file`: the folder (default "Client material"). */
export const UploadProjectFile = z.object({ folder: z.enum(PROJECT_FILE_FOLDERS).default('Client material') });
export type UploadProjectFile = z.infer<typeof UploadProjectFile>;

/** PATCH /api/projects/:id/files/:fileId: move it to another folder. */
export const UpdateProjectFile = z.object({ folder: z.enum(PROJECT_FILE_FOLDERS) });
export type UpdateProjectFile = z.infer<typeof UpdateProjectFile>;

const fileColumns = {
  id: projectFiles.id,
  name: projectFiles.name,
  folder: projectFiles.folder,
  contentType: projectFiles.contentType,
  sizeBytes: projectFiles.sizeBytes,
  addedByUserId: projectFiles.addedByUserId,
  addedByName: sql<string | null>`(select coalesce(u.display_name, u.email) from ${users} u where u.id = ${projectFiles.addedByUserId})`,
  createdAt: projectFiles.createdAt,
};

/** A file name a browser and a disk both accept: no path or control characters, at most 200 characters. */
export function cleanFileName(name: string): string {
  const clean = name
    .normalize('NFKC')
    // eslint-disable-next-line no-control-regex -- control characters are exactly what goes
    .replace(/[\\/:*?"<>|\x00-\x1f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
  return clean || 'file';
}

/**
 * A project's files (CD-271, Documents tab). Every member reads, downloads and adds files; the one
 * who added a file, the project lead, owners and admins move it to another folder or delete it.
 * The bytes live in storage (`projects/<projectId>/<fileId>`), written before the row commits and
 * removed after a delete commits. Live updates come from the table's triggers (hint `project`).
 */
@Injectable()
export class ProjectFilesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  list(ctx: TenantContext, projectId: string) {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      await this.project(tx, projectId);
      return tx.select(fileColumns).from(projectFiles).where(eq(projectFiles.projectId, projectId)).orderBy(desc(projectFiles.createdAt));
    });
  }

  async upload(ctx: TenantContext, projectId: string, file: UploadedProjectFile | undefined, input: UploadProjectFile) {
    if (!file) throw new BadRequestException('Choose a file');
    if (file.size > MAX_PROJECT_FILE_BYTES) throw new BadRequestException('A file can be at most 25 MB');
    const id = crypto.randomUUID();
    const storageKey = `projects/${projectId}/${id}`;
    // The project must exist (and be this workspace's) before anything is stored.
    await this.database.withTenant(ctx.tenantId, (tx) => this.project(tx, projectId));
    await this.storage.putBuffer(ctx.tenantId, storageKey, file.buffer);
    try {
      return await this.database.withTenant(ctx.tenantId, async (tx) => {
        await tx.insert(projectFiles).values({
          id,
          tenantId: ctx.tenantId,
          projectId,
          name: cleanFileName(file.originalname),
          folder: input.folder,
          contentType: file.mimetype || 'application/octet-stream',
          sizeBytes: file.size,
          storageKey,
          addedByUserId: ctx.userId,
        });
        await this.audit.record(tx, ctx, { action: 'project.file_added', entityType: 'project', entityId: projectId, data: { fileId: id, name: file.originalname, size: file.size } });
        const [row] = await tx.select(fileColumns).from(projectFiles).where(eq(projectFiles.id, id));
        return row!;
      });
    } catch (err) {
      await this.storage.delete(ctx.tenantId, storageKey);
      return mapDbError(err);
    }
  }

  /** The stored file to send, with its name and type. */
  download(ctx: TenantContext, projectId: string, fileId: string) {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const [row] = await tx.select().from(projectFiles).where(and(eq(projectFiles.id, fileId), eq(projectFiles.projectId, projectId)));
      if (!row) throw new NotFoundException('File not found');
      return { name: row.name, contentType: row.contentType, stream: await this.storage.get(ctx.tenantId, row.storageKey) };
    });
  }

  update(ctx: TenantContext, projectId: string, fileId: string, input: UpdateProjectFile) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        await this.canChange(tx, ctx, projectId, fileId);
        await tx.update(projectFiles).set({ folder: input.folder }).where(eq(projectFiles.id, fileId));
        const [row] = await tx.select(fileColumns).from(projectFiles).where(eq(projectFiles.id, fileId));
        return row!;
      })
      .catch(mapDbError);
  }

  async remove(ctx: TenantContext, projectId: string, fileId: string) {
    const key = await this.database.withTenant(ctx.tenantId, async (tx) => {
      const row = await this.canChange(tx, ctx, projectId, fileId);
      await tx.delete(projectFiles).where(eq(projectFiles.id, fileId));
      await this.audit.record(tx, ctx, { action: 'project.file_deleted', entityType: 'project', entityId: projectId, data: { fileId, name: row.name } });
      return row.storageKey;
    });
    await this.storage.delete(ctx.tenantId, key);
  }

  private async project(tx: Tx, projectId: string) {
    const [p] = await tx.select({ leadUserId: projects.leadUserId }).from(projects).where(eq(projects.id, projectId));
    if (!p) throw new NotFoundException('Project not found');
    return p;
  }

  private async canChange(tx: Tx, ctx: TenantContext, projectId: string, fileId: string) {
    const p = await this.project(tx, projectId);
    const [row] = await tx.select().from(projectFiles).where(and(eq(projectFiles.id, fileId), eq(projectFiles.projectId, projectId)));
    if (!row) throw new NotFoundException('File not found');
    if (row.addedByUserId !== ctx.userId && p.leadUserId !== ctx.userId && !hasRole(ctx.role, 'admin')) {
      throw new ForbiddenException('Only the person who added the file, the project lead, owners and admins can change it');
    }
    return row;
  }
}
