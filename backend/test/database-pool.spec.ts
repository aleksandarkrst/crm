import { describe, expect, it } from 'vitest';
import type { Env } from '../src/infrastructure/config/config.module';

import { DatabaseService, poolConfig } from '../src/shared/database/database.service';

const base = { DATABASE_URL: 'postgres://app_runtime:x@localhost:5432/app', DATABASE_POOL_MAX: 10 };

describe('poolConfig (CD-101)', () => {
  it('limits statements and idle transactions on the runtime connections', () => {
    expect(poolConfig({ ...base, DATABASE_STATEMENT_TIMEOUT_MS: 30_000, DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_MS: 60_000 })).toEqual({
      connectionString: base.DATABASE_URL,
      max: 10,
      statement_timeout: 30_000,
      idle_in_transaction_session_timeout: 60_000,
    });
  });

  it('leaves a limit off when it is 0', () => {
    const config = poolConfig({ ...base, DATABASE_STATEMENT_TIMEOUT_MS: 0, DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_MS: 0 });
    expect(config).not.toHaveProperty('statement_timeout');
    expect(config).not.toHaveProperty('idle_in_transaction_session_timeout');
  });
});

describe('the database pool (CD-205)', () => {
  it('survives Postgres closing an idle connection instead of crashing the process', async () => {
    const database = new DatabaseService({ ...base, DATABASE_STATEMENT_TIMEOUT_MS: 0, DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_MS: 0 } as Env);
    // What pg emits when a restart drops an idle client (Sentry CRM-BACKEND-2). With no listener,
    // EventEmitter throws it, which is an uncaught exception in the server.
    expect(() => database.pool.emit('error', new Error('terminating connection due to administrator command'))).not.toThrow();
    await database.onModuleDestroy();
  });
});
