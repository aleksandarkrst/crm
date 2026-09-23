/**
 * Applies pending migrations from ./drizzle using the owner connection
 * (MIGRATION_DATABASE_URL). Runs as a one-off container during deployment:
 *   docker compose run --rm migrate
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { join } from 'node:path';
import { Pool } from 'pg';
import { loadEnv } from '../../infrastructure/config/env';

async function main(): Promise<void> {
  const env = loadEnv();
  if (!env.MIGRATION_DATABASE_URL) throw new Error('MIGRATION_DATABASE_URL is not set');

  const pool = new Pool({ connectionString: env.MIGRATION_DATABASE_URL, max: 1 });
  try {
    // Compiled to <backend>/dist/shared/database/migrate.js; migrations live in <backend>/drizzle.
    const migrationsFolder = join(__dirname, '..', '..', '..', 'drizzle');
    await migrate(drizzle(pool), { migrationsFolder });
    console.log('Migrations applied.');
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
