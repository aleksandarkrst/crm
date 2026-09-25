/** The dev database from docker-compose.dev.yml, as the runtime role (see backend/.env.example). */
export const DEFAULT_DATABASE_URL = 'postgres://app_runtime:dev_runtime_password@localhost:5432/app';
/** The owner role, for tests that must change the schema (e.g. a trigger that refuses a row). */
export const DEFAULT_MIGRATION_DATABASE_URL = 'postgres://app_admin:dev_admin_password@localhost:5432/app';
