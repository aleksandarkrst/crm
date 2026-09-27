#!/bin/sh
# PostgreSQL backups: pg_dump (custom format) to /backups, plus a tar.gz of the file storage
# (/storage: document templates and generated documents), pruned after BACKUP_RETENTION_DAYS,
# and copied off the server with rclone when BACKUP_RCLONE_REMOTE is set.
#
#   backup.sh loop   # default: back up every BACKUP_INTERVAL_HOURS, check the disk every hour
#   backup.sh once   # one backup now (deploy.sh runs this before migrations)
#
# Alerts (CD-8): each backup reports to BACKUP_HEARTBEAT_URL and each disk check to
# DISK_HEARTBEAT_URL (Better Stack heartbeats). "<url>" means OK, "<url>/fail" means failed, and
# the monitor alerts on a failure or when the reports stop coming.
set -eu

INTERVAL_HOURS="${BACKUP_INTERVAL_HOURS:-24}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
REMOTE="${BACKUP_RCLONE_REMOTE:-}"
STORAGE="${BACKUP_STORAGE_DIR:-/storage}"
BACKUP_HEARTBEAT="${BACKUP_HEARTBEAT_URL:-}"
DISK_HEARTBEAT="${DISK_HEARTBEAT_URL:-}"
DISK_ALERT_PERCENT="${DISK_ALERT_PERCENT:-85}"
DISK_CHECK_MINUTES="${DISK_CHECK_MINUTES:-60}"

# heartbeat <url> ok|fail <message>. A monitor that can't be reached must never fail a backup.
# Better Stack takes the message as JSON (it rejects a plain-text body with 400); the messages
# are this script's own and contain no quotes.
heartbeat() {
  [ -n "$1" ] || return 0
  url="$1"
  [ "$2" = ok ] || url="${1%/}/fail"
  curl -fsS -m 10 --retry 3 -o /dev/null -H 'Content-Type: application/json' --data-raw "{\"message\":\"$3\"}" "$url" \
    || echo "[backup] WARNING: could not reach the heartbeat monitor"
}

# The /backups volume lives on the server's disk, so its usage is the disk's.
check_disk() {
  used="$(df -P /backups | awk 'NR == 2 { sub("%", "", $5); print $5 }')"
  if [ "${used}" -ge "${DISK_ALERT_PERCENT}" ]; then
    echo "[backup] WARNING: disk ${used}% full (alert at ${DISK_ALERT_PERCENT}%)"
    heartbeat "${DISK_HEARTBEAT}" fail "Disk ${used}% full (alert at ${DISK_ALERT_PERCENT}%)"
  else
    heartbeat "${DISK_HEARTBEAT}" ok "Disk ${used}% full"
  fi
}

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
  once)
    # run_backup runs at the top level, so set -e stops it at the first failing step (inside an
    # `if` or `||` the shell would ignore set -e). The exit trap reports how it ended.
    trap 'status=$?; if [ "$status" -eq 0 ]; then heartbeat "${BACKUP_HEARTBEAT}" ok "Backup done"; else heartbeat "${BACKUP_HEARTBEAT}" fail "Backup failed (exit ${status}), see: docker compose logs backup"; fi' EXIT
    run_backup
    ;;
  loop)
    next_backup=0
    while true; do
      check_disk || echo "[backup] WARNING: disk check failed"
      if [ "$(date +%s)" -ge "${next_backup}" ]; then
        # A separate process, for set -e (see "once"); it reports to the heartbeat itself.
        "$0" once || echo "[backup] FAILED — retrying next cycle"
        next_backup="$(($(date +%s) + INTERVAL_HOURS * 3600))"
      fi
      sleep "$((DISK_CHECK_MINUTES * 60))"
    done
    ;;
  *) echo "usage: backup.sh [loop|once]" >&2; exit 2 ;;
esac
