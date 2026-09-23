import { Inject, Injectable } from '@nestjs/common';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ENV, type Env } from '../config/config.module';

/**
 * File storage for documents and attachments. Keys are always prefixed with the tenant id so
 * files from different tenants never share a path.
 *
 * Starts on the local disk (a Docker volume). To move to S3-compatible object storage
 * (Hetzner Object Storage, Cloudflare R2), reimplement these methods — callers don't change.
 */
@Injectable()
export class StorageService {
  private readonly root: string;

  constructor(@Inject(ENV) env: Env) {
    this.root = resolve(env.STORAGE_DIR);
  }

  async put(tenantId: string, key: string, body: Readable): Promise<void> {
    const path = this.pathFor(tenantId, key);
    await mkdir(dirname(path), { recursive: true });
    await pipeline(body, createWriteStream(path));
  }

  async get(tenantId: string, key: string): Promise<Readable> {
    const path = this.pathFor(tenantId, key);
    await stat(path);
    return createReadStream(path);
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
