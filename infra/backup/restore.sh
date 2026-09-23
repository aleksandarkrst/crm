#!/bin/sh
# Restores a dump into the database. DESTRUCTIVE: replaces existing objects.
# Stop api and worker first (see docs/DEPLOYMENT.md → "Restore").
#
#   docker compose run --rm --entrypoint restore.sh backup /backups/app-20260101T020000Z.dump
set -eu

file="${1:?usage: restore.sh /backups/<file>.dump}"
[ -f "$file" ] || { echo "not found: $file" >&2; exit 1; }

echo "[restore] restoring ${file} into ${PGDATABASE} (existing objects will be replaced)"
pg_restore --clean --if-exists --no-owner --exit-on-error --dbname="${PGDATABASE}" "$file"
echo "[restore] done"
