import { defineConfig } from 'drizzle-kit';

try {
  process.loadEnvFile();
} catch {
  // no .env file — rely on the real environment
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/shared/database/schema/index.ts',
  out: './drizzle',
  dbCredentials: {
    // drizzle-kit (studio, introspection) needs owner rights, so use the migration URL.
    url: process.env.MIGRATION_DATABASE_URL ?? '',
  },
  strict: true,
});
