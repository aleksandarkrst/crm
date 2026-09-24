import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ENV, type Env } from '../config/config.module';

/**
 * File storage for documents and attachments. Keys are always prefixed with the tenant id so
 * files from different tenants never share a path: `<STORAGE_DIR>/<tenantId>/<key>`.
 *
 * Starts on the local disk (a Docker volume, backed up by the backup container). To move to
 * S3-compatible object storage (Hetzner Object Storage, Cloudflare R2), reimplement these
 * methods — callers don't change.
 *
 * Nothing here checks who is asking: callers serve a file only after finding its row with
 * `withTenant` (so RLS has confirmed it belongs to the caller's tenant).
 */
@Injectable()
export class StorageService {
  private readonly root: string;

  constructor(@Inject(ENV) env: Env) {
    this.root = resolve(env.STORAGE_DIR);
  }

  /** Writes to a temporary file first and renames it, so a reader never sees half a file. */
  async put(tenantId: string, key: string, body: Readable): Promise<void> {
    const path = this.pathFor(tenantId, key);
    await mkdir(dirname(path), { recursive: true });
    const partial = `${path}.${randomUUID()}.partial`;
    try {
      await pipeline(body, createWriteStream(partial));
      await rename(partial, path);
    } catch (err) {
      await rm(partial, { force: true });
      throw err;
    }
  }

  putBuffer(tenantId: string, key: string, body: Buffer): Promise<void> {
    return this.put(tenantId, key, Readable.from([body]));
  }

  async get(tenantId: string, key: string): Promise<Readable> {
    const path = this.pathFor(tenantId, key);
    await stat(path);
    return createReadStream(path);
  }

  getBuffer(tenantId: string, key: string): Promise<Buffer> {
    return readFile(this.pathFor(tenantId, key));
  }

  async exists(tenantId: string, key: string): Promise<boolean> {
    return stat(this.pathFor(tenantId, key)).then(
      (s) => s.isFile(),
      () => false,
    );
  }

  async delete(tenantId: string, key: string): Promise<void> {
    await rm(this.pathFor(tenantId, key), { force: true });
  }

  private pathFor(tenantId: string, key: string): string {
    const path = resolve(this.root, tenantId, key);
    if (!path.startsWith(resolve(this.root, tenantId) + sep)) {
      throw new Error('Invalid storage key');
    }
    return path;
  }
}
