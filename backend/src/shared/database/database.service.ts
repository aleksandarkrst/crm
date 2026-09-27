import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool, type PoolConfig } from 'pg';
import { ENV, type Env } from '../../infrastructure/config/config.module';
import { requestActor } from './request-context';
import * as schema from './schema';

export type Database = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/** The runtime pool, with per-session time limits (CD-101). 0 leaves a limit off. */
export function poolConfig(env: Pick<Env, 'DATABASE_URL' | 'DATABASE_POOL_MAX' | 'DATABASE_STATEMENT_TIMEOUT_MS' | 'DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_MS'>): PoolConfig {
  return {
    connectionString: env.DATABASE_URL,
    max: env.DATABASE_POOL_MAX,
    ...(env.DATABASE_STATEMENT_TIMEOUT_MS ? { statement_timeout: env.DATABASE_STATEMENT_TIMEOUT_MS } : {}),
    ...(env.DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_MS ? { idle_in_transaction_session_timeout: env.DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_MS } : {}),
  };
}

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  readonly pool: Pool;
  /**
   * Unscoped access. Tenant-scoped tables return no rows here because RLS has no tenant set.
   * Use it only for platform tables (tenants, users, memberships) and health checks.
   */
  readonly db: Database;

  constructor(@Inject(ENV) env: Env) {
    this.pool = new Pool(poolConfig(env));
    this.db = drizzle(this.pool, { schema });
  }

  /**
   * Runs `fn` in a transaction with the tenant set for row-level security. All reads and writes
   * of tenant-scoped tables must go through here. `set_config(..., true)` is transaction-local,
   * so the setting can never leak to another request that reuses the pooled connection.
   * The acting user and browser tab (see request-context.ts) are set the same way, for the
   * change-history and live-update triggers.
   */
  async withTenant<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    const actor = requestActor.getStore();
    return this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select set_config('app.tenant_id', ${tenantId}, true), set_config('app.user_id', ${actor?.userId ?? ''}, true), set_config('app.client_id', ${actor?.clientId ?? ''}, true)`,
      );
      return fn(tx);
    });
  }

  async ping(): Promise<void> {
    await this.db.execute(sql`select 1`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
