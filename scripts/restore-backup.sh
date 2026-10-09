#!/usr/bin/env bash
# Restores a backup into a stack (staging or production) the way docs/DEPLOYMENT.md "Restore"
# describes, in one command, timing it (CD-314). Run on the server as the deploy user:
#
#   APP_DIR=/opt/crm-staging bash scripts/restore-backup.sh app-20260101T020000Z-deploy-abc1234.dump
#   APP_DIR=/opt/crm         bash scripts/restore-backup.sh app-20260101T020000Z.dump --yes --verify
#   bash scripts/restore-backup.sh --list          # the backups the stack has
#
# Steps: stop api and worker → restore the dump (into a side database, swapped in only when it
# worked; the old one stays as <db>_before_restore) → restore the files archive with the same
# timestamp, if there is one → start api and worker → wait for readiness → with --verify, run
# scripts/verify-production.sh. It asks before changing anything unless --yes is given.
#
# DESTRUCTIVE on the stack it runs in: everything written after the backup is gone from the live
# database (kept in <db>_before_restore until you drop it) and the uploaded files are replaced.
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/crm}"
file=""
yes=0
verify=0
list=0
for arg in "$@"; do
  case "$arg" in
    --yes|-y) yes=1 ;;
    --verify) verify=1 ;;
    --list) list=1 ;;
    -*) echo "unknown option: $arg" >&2; exit 2 ;;
    *) file="$arg" ;;
  esac
done

log() { printf '\n[restore] %s\n' "$*"; }
in_backup() { docker compose run --rm --entrypoint sh backup -c "$1"; }

cd "$APP_DIR"
if [ "$list" = 1 ]; then
  in_backup 'ls -lh /backups'
  exit 0
fi
[ -n "$file" ] || { echo "usage: APP_DIR=/opt/crm-staging bash scripts/restore-backup.sh <name>.dump [--yes] [--verify] | --list" >&2; exit 2; }

dump="/backups/$(basename "$file")"
case "$dump" in *.dump) ;; *) echo "expected a .dump file, got $file" >&2; exit 2 ;; esac
in_backup "test -f '$dump'" || { echo "not found in the backups volume: $dump (use --list)" >&2; exit 1; }
# app-<stamp>.dump → app-files-<stamp>.tar.gz (the archive from the same run).
db="$(sed -n 's/^POSTGRES_DB=//p' .env | tail -1)"
rest="${dump#/backups/${db}-}"
files="/backups/${db}-files-${rest%.dump}.tar.gz"
if in_backup "test -f '$files'"; then has_files=1; else has_files=0; fi

project="$(sed -n 's/^COMPOSE_PROJECT_NAME=//p' .env | tail -1)"
echo "Stack:   ${APP_DIR} (compose project ${project:-$(basename "$APP_DIR")})"
echo "Dump:    ${dump}"
if [ "$has_files" = 1 ]; then echo "Files:   ${files}"; else echo "Files:   none with this timestamp (uploaded files are left as they are)"; fi
echo "The live database is replaced (kept as ${db}_before_restore) and api and worker restart."
if [ "$yes" != 1 ]; then
  read -r -p "Continue? [y/N] " answer
  case "$answer" in y|Y|yes) ;; *) echo "aborted"; exit 1 ;; esac
fi

started=$(date +%s)
log "stopping api and worker"
docker compose stop api worker

log "restoring the database from ${dump}"
docker compose run --rm --entrypoint restore.sh backup "$dump"

if [ "$has_files" = 1 ]; then
  log "restoring the files from ${files}"
  docker compose run --rm --entrypoint restore.sh backup "$files"
fi

log "starting api and worker"
docker compose start api worker
ready=0
for _ in $(seq 1 30); do
  if docker compose exec -T api node -e "fetch('http://127.0.0.1:3000/api/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
    ready=1
    break
  fi
  sleep 2
done
if [ "$ready" != 1 ]; then
  log "the API did not become ready after the restore. Recent logs:"
  docker compose logs --tail=80 api worker
  exit 1
fi

if [ "$verify" = 1 ]; then
  log "running the smoke test"
  APP_DIR="$APP_DIR" bash "$APP_DIR/scripts/verify-production.sh"
fi

seconds=$(( $(date +%s) - started ))
log "done in ${seconds}s (api and worker were down for about that long)"
echo "Next: sign in and open a restored record; check 'docker compose logs --tail=50 api worker' for"
echo "permission errors; then free the space with:"
echo "  docker compose exec postgres dropdb -U \"\$(sed -n 's/^POSTGRES_USER=//p' .env | tail -1)\" ${db}_before_restore"
echo "Record the date, the backup and ${seconds}s in docs/DEPLOYMENT.md (Restore drills)."
