#!/bin/sh
# Runs once, when the PostgreSQL data volume is first initialised.
#
# POSTGRES_USER (the owner/superuser) runs migrations. The API and worker connect as
# APP_DB_USER, a plain role that does NOT own the tables, so row-level security applies to it.
set -eu

: "${APP_DB_USER:?APP_DB_USER is required}"
: "${APP_DB_PASSWORD:?APP_DB_PASSWORD is required}"

psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v app_user="$APP_DB_USER" -v app_password="$APP_DB_PASSWORD" \
  -v owner="$POSTGRES_USER" -v db="$POSTGRES_DB" <<'SQL'
CREATE ROLE :"app_user" LOGIN PASSWORD :'app_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
GRANT CONNECT ON DATABASE :"db" TO :"app_user";
GRANT USAGE ON SCHEMA public TO :"app_user";

-- Tables the owner creates later (via migrations) are automatically readable/writable by the app.
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner" IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"app_user";
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner" IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO :"app_user";

-- pg-boss (background job queue) manages its own tables in this schema.
CREATE SCHEMA pgboss AUTHORIZATION :"app_user";
SQL

echo "Created application role ${APP_DB_USER}"
