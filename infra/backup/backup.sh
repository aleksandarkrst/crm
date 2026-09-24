#!/bin/sh
# PostgreSQL backups: pg_dump (custom format) to /backups, plus a tar.gz of the file storage
# (/storage: document templates and generated documents), pruned after BACKUP_RETENTION_DAYS,
# and copied off the server with rclone when BACKUP_RCLONE_REMOTE is set.
#
#   backup.sh loop   # default: back up every BACKUP_INTERVAL_HOURS
#   backup.sh once   # one backup now (deploy.sh runs this before migrations)
set -eu

INTERVAL_HOURS="${BACKUP_INTERVAL_HOURS:-24}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
REMOTE="${BACKUP_RCLONE_REMOTE:-}"
STORAGE="${BACKUP_STORAGE_DIR:-/storage}"

run_backup() {
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  file="/backups/${PGDATABASE}-${stamp}.dump"
  echo "[backup] dumping ${PGDATABASE} → ${file}"
  pg_dump --format=custom --no-owner --file="${file}.partial"
  mv "${file}.partial" "${file}"
  # A dump that cannot be listed is useless; fail loudly.
  pg_restore --list "${file}" >/dev/null
  echo "[backup] ok ($(du -h "${file}" | cut -f1))"

  # Files after the dump: a document created in between has its file but no row (harmless), never
  # the other way round.
  files=""
  if [ -d "${STORAGE}" ]; then
    files="/backups/${PGDATABASE}-files-${stamp}.tar.gz"
    echo "[backup] archiving ${STORAGE} → ${files}"
    tar -czf "${files}.partial" -C "${STORAGE}" .
    mv "${files}.partial" "${files}"
    tar -tzf "${files}" >/dev/null
    echo "[backup] ok ($(du -h "${files}" | cut -f1))"
  else
    echo "[backup] WARNING: ${STORAGE} is not mounted — uploaded files are NOT backed up"
  fi

  if [ -n "${REMOTE}" ]; then
    echo "[backup] copying to ${REMOTE}"
    rclone copy "${file}" "${REMOTE}/" --quiet
    [ -n "${files}" ] && rclone copy "${files}" "${REMOTE}/" --quiet
    rclone delete "${REMOTE}/" --min-age "${RETENTION_DAYS}d" --quiet || true
  else
    echo "[backup] WARNING: BACKUP_RCLONE_REMOTE not set — backup exists only on this server"
  fi

  find /backups \( -name '*.dump' -o -name '*.tar.gz' \) -mtime "+${RETENTION_DAYS}" -delete
}

case "${1:-loop}" in
  once) run_backup ;;
  loop)
    while true; do
      run_backup || echo "[backup] FAILED — retrying next cycle"
      sleep "$((INTERVAL_HOURS * 3600))"
    done
    ;;
  *) echo "usage: backup.sh [loop|once]" >&2; exit 2 ;;
esac
