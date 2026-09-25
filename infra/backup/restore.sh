#!/bin/sh
# Restores a backup. DESTRUCTIVE: replaces what is there now.
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
    echo "[restore] restoring ${file} into ${PGDATABASE} (existing objects will be replaced)"
    pg_restore --clean --if-exists --no-owner --exit-on-error --dbname="${PGDATABASE}" "$file"
    echo "[restore] done"
    ;;
esac
