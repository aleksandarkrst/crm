import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { Client } from 'pg';
import { ENV, type Env } from '../../infrastructure/config/config.module';

/** The PostgreSQL channel the live-update triggers notify (drizzle/0020_record_changes_rls.sql). */
export const CHANGES_CHANNEL = 'crm_changes';

/**
 * A hint that records changed; the browser re-reads them. `ids` is null when many rows changed
 * at once (re-read the list). `type: 'resync'` means events may have been missed: re-read everything.
 */
export interface ChangeEvent {
  type: string;
  op?: 'insert' | 'update' | 'delete';
  ids?: string[] | null;
  dealIds?: string[] | null;
  /** The browser tab (X-Client-Id) that made the change, so it can skip its own echo. */
  client?: string | null;
}
type Listener = (event: ChangeEvent) => void;

/**
 * Live updates (CD-20). Each API process holds one connection that LISTENs on crm_changes and
 * forwards every notification to the event streams of its tenant only. Notifications are sent by
 * triggers when a transaction commits, so it works whichever process (or the worker) made the
 * change, and with any number of API processes. If the connection drops, it reconnects with
 * backoff and tells every stream to resync, because notifications sent meanwhile are lost.
 */
@Injectable()
export class RealtimeService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(RealtimeService.name);
  private readonly listeners = new Map<string, Set<Listener>>();
  private client: Client | null = null;
  private attempt = 0;
  private stopped = false;
  private everConnected = false;
  private retryTimer?: ReturnType<typeof setTimeout>;

  constructor(@Inject(ENV) private readonly env: Env) {}

  onApplicationBootstrap(): void {
    void this.connect();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.retryTimer);
    const client = this.client;
    this.client = null;
    await client?.end().catch(() => undefined);
  }

  /** Streams of this tenant get its events until the returned function is called. */
  subscribe(tenantId: string, listener: Listener): () => void {
    let set = this.listeners.get(tenantId);
    if (!set) this.listeners.set(tenantId, (set = new Set()));
    const own = set;
    own.add(listener);
    return () => {
      own.delete(listener);
      if (own.size === 0 && this.listeners.get(tenantId) === own) this.listeners.delete(tenantId);
    };
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    const client = new Client({ connectionString: this.env.DATABASE_URL });
    let failed = false;
    const fail = (err?: unknown) => {
      if (failed) return;
      failed = true;
      if (this.client === client) this.client = null;
      client.end().catch(() => undefined);
      if (this.stopped) return;
      const delay = Math.min(30_000, 500 * 2 ** this.attempt++);
      this.logger.warn(`Live updates: database listener lost (${err instanceof Error ? err.message : 'closed'}); retrying in ${delay} ms`);
      this.retryTimer = setTimeout(() => void this.connect(), delay);
    };
    client.on('error', fail);
    client.on('end', () => fail());
    client.on('notification', (msg) => {
      if (msg.channel === CHANGES_CHANNEL && msg.payload) this.dispatch(msg.payload);
    });
    try {
      await client.connect();
      await client.query(`LISTEN ${CHANGES_CHANNEL}`);
    } catch (err) {
      fail(err);
      return;
    }
    this.client = client;
    this.attempt = 0;
    if (this.everConnected) this.broadcast({ type: 'resync' });
    this.everConnected = true;
  }

  private dispatch(payload: string): void {
    let parsed: ChangeEvent & { t?: string };
    try {
      parsed = JSON.parse(payload) as ChangeEvent & { t?: string };
    } catch {
      return;
    }
    const { t: tenantId, ...event } = parsed;
    if (!tenantId) return;
    for (const listener of this.listeners.get(tenantId) ?? []) listener(event);
  }

  private broadcast(event: ChangeEvent): void {
    for (const set of this.listeners.values()) for (const listener of set) listener(event);
  }
}
