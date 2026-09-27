#!/bin/sh
# Restores a backup. DESTRUCTIVE: replaces what is there now. A database dump is restored into
# a side database first and swapped in only when it worked; the replaced database is kept as
# <db>_before_restore until you drop it.
# Stop api and worker first (see docs/DEPLOYMENT.md → "Restore").
#
#   a database dump:   docker compose run --rm --entrypoint restore.sh backup /backups/app-20260101T020000Z.dump
#   the files archive: docker compose run --rm --entrypoint restore.sh backup /backups/app-files-20260101T020000Z.tar.gz
#
# Restore the dump and the files archive with the same timestamp together.
set -eu

file="${1:?usage: restore.sh /backups/<file>.dump | /backups/<file>.tar.gz}"
[ -f "$file" ] || { echo "not found: $file" >&2; exit 1; }

case "$file" in
  *.tar.gz)
    storage="${BACKUP_STORAGE_DIR:-/storage}"
    [ -d "$storage" ] || { echo "${storage} is not mounted" >&2; exit 1; }
    tar -tzf "$file" >/dev/null
    echo "[restore] replacing the files in ${storage} with ${file}"
    find "$storage" -mindepth 1 -delete
    # As root, tar keeps the owner the files had (the api's "node" user).
    tar -xzpf "$file" -C "$storage"
    echo "[restore] done"
    ;;
  *)
    # The dump is restored into a fresh side database, checked, and only then swapped in, so a
    # failed restore leaves the current database untouched. (pg_restore --clean over the live
    # database does not work: it can't drop the inherited keys of pg-boss's partitioned tables.)
    app_user="${APP_DB_USER:?APP_DB_USER is required (the role the api and worker use)}"
    db="${PGDATABASE}"
    new="${db}_restore"
    old="${db}_before_restore"
    pg_restore --list "$file" >/dev/null
    admin() { psql -v ON_ERROR_STOP=1 --quiet --dbname=postgres "$@"; }

    echo "[restore] restoring ${file} into a fresh database ${new}"
    admin -v new="$new" -v owner="$PGUSER" <<'SQL'
DROP DATABASE IF EXISTS :"new" WITH (FORCE);
CREATE DATABASE :"new" OWNER :"owner";
SQL
    # --no-owner: everything restored belongs to ${PGUSER}, which is right for the app's tables
    # (the runtime role only has grants on them), and it works when a server's role names differ
    # from the ones in the dump.
    pg_restore --no-owner --exit-on-error --dbname="$new" "$file"

    # The runtime role's access, as infra/postgres/init sets it up (database-level grants are not
    # in a dump). pg-boss must also OWN its schema and tables: it creates and alters them at
    # runtime. Without that the worker gets "permission denied for schema pgboss" and every API
    # write that queues a job fails (CD-89).
    echo "[restore] granting ${app_user} its access and giving it the pgboss schema"
    psql -v ON_ERROR_STOP=1 --quiet --dbname="$new" -v app_user="${app_user}" -v owner="$PGUSER" -v db="$new" <<'SQL'
GRANT CONNECT ON DATABASE :"db" TO :"app_user";
GRANT USAGE ON SCHEMA public TO :"app_user";
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner" IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"app_user";
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner" IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO :"app_user";
SELECT set_config('restore.app_user', :'app_user', false) AS ignored \gset
DO $$
DECLARE
  app_user text := current_setting('restore.app_user');
  obj record;
BEGIN
  IF to_regnamespace('pgboss') IS NULL THEN
    RAISE NOTICE 'no pgboss schema in this backup; pg-boss creates it on start';
    RETURN;
  END IF;
  EXECUTE format('ALTER SCHEMA pgboss OWNER TO %I', app_user);
  -- Tables (including partitioned ones), views, sequences not owned by a table. Indexes and
  -- owned sequences follow their table.
  FOR obj IN
    SELECT c.oid::regclass::text AS name, c.relkind
      FROM pg_class c
     WHERE c.relnamespace = 'pgboss'::regnamespace
       AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
       AND NOT (c.relkind = 'S' AND EXISTS (
             SELECT 1 FROM pg_depend d
              WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype IN ('a', 'i')))
  LOOP
    EXECUTE format('ALTER %s %s OWNER TO %I',
      CASE obj.relkind WHEN 'S' THEN 'SEQUENCE' WHEN 'v' THEN 'VIEW'
                       WHEN 'm' THEN 'MATERIALIZED VIEW' WHEN 'f' THEN 'FOREIGN TABLE'
                       ELSE 'TABLE' END,
      obj.name, app_user);
  END LOOP;
  -- Enum and other standalone types (e.g. pgboss.job_state), not the row types of tables.
  FOR obj IN
    SELECT t.oid::regtype::text AS name
      FROM pg_type t
     WHERE t.typnamespace = 'pgboss'::regnamespace
       AND t.typtype IN ('e', 'd', 'c', 'r', 'm')
       AND (t.typrelid = 0 OR (SELECT relkind FROM pg_class WHERE oid = t.typrelid) = 'c')
  LOOP
    EXECUTE format('ALTER TYPE %s OWNER TO %I', obj.name, app_user);
  END LOOP;
  FOR obj IN
    SELECT p.oid::regprocedure::text AS name, p.prokind
      FROM pg_proc p
     WHERE p.pronamespace = 'pgboss'::regnamespace
  LOOP
    EXECUTE format('ALTER %s %s OWNER TO %I',
      CASE obj.prokind WHEN 'p' THEN 'PROCEDURE' WHEN 'a' THEN 'AGGREGATE' ELSE 'FUNCTION' END,
      obj.name, app_user);
  END LOOP;
END
$$;
SQL

    # The check that matters: the runtime role can use the restored database, including the queue.
    psql -v ON_ERROR_STOP=1 --quiet --dbname="$new" -v app_user="${app_user}" <<'SQL'
SET ROLE :"app_user";
DO $$
BEGIN
  IF to_regclass('pgboss.job') IS NOT NULL THEN
    PERFORM 1 FROM pgboss.job LIMIT 1;
  END IF;
END
$$;
SQL

    # Swap: keep the current database as ${old} until the restore has been checked in the app.
    echo "[restore] swapping ${new} in as ${db}; the previous database is kept as ${old}"
    admin -v db="$db" -v new="$new" -v old="$old" <<'SQL'
DROP DATABASE IF EXISTS :"old" WITH (FORCE);
SELECT pg_terminate_backend(pid) FROM pg_stat_activity
 WHERE datname = :'db' AND pid <> pg_backend_pid() \g /dev/null
ALTER DATABASE :"db" RENAME TO :"old";
ALTER DATABASE :"new" RENAME TO :"db";
SQL
    echo "[restore] done. Once the app works on the restored data, free the space with:"
    echo "  docker compose exec postgres dropdb -U ${PGUSER} ${old}"
    ;;
esac
