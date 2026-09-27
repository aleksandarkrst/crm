#!/usr/bin/env bash
# Deploys a specific version on the server. Called by GitHub Actions over SSH:
#   bash /opt/crm/scripts/deploy.sh <git-sha>
#
# Steps: check out the commit (compose + infra files) → pull the prebuilt images → back up
# the database → run migrations → roll the stack → wait for the readiness check.
#
# If any step fails, the previous version is put back: its commit is checked out and pinned in
# .env again, and if the new containers were already started, the previous images are started
# and must pass the readiness check. The script still exits 1, so CI goes red. Migrations are not
# undone; they must stay backward-compatible (see docs/WORKFLOW.md), so the previous image keeps
# working on the new schema.
set -euo pipefail

# Everything runs inside main(): `git checkout` below replaces this file while it runs, and bash
# has to have parsed the whole script before that happens.
main() {
  VERSION="${1:?usage: deploy.sh <git-sha>}"
  APP_DIR="${APP_DIR:-/opt/crm}"
  cd "$APP_DIR"

  PREV_COMMIT="$(git rev-parse HEAD)"
  PREV_VERSION="$(sed -n 's/^APP_VERSION=//p' .env | tail -1)"
  STACK_STARTED=0
  trap on_exit EXIT

  log "checking out ${VERSION} (running: ${PREV_VERSION:-none})"
  git fetch --quiet origin
  git checkout --quiet --force "${VERSION}"
  pin_version "${VERSION}"
  [ -f infra/backup/rclone.conf ] || touch infra/backup/rclone.conf

  log "pulling images"
  # api, worker and migrate share the backend image.
  docker compose pull api worker frontend

  log "pre-migration backup"
  docker compose up -d postgres
  docker compose build backup
  docker compose run --rm backup once

  log "running migrations"
  docker compose run --rm migrate

  log "starting stack"
  STACK_STARTED=1
  docker compose up -d --remove-orphans

  log "waiting for readiness"
  if ! wait_ready; then
    log "API did not become ready. Recent logs:"
    docker compose logs --tail=80 api
    exit 1
  fi
  log "healthy — ${VERSION} is live"
  docker image prune -f >/dev/null
  DEPLOYED=1
}

log() { printf '\n[deploy] %s\n' "$*"; }

# Pin the version in .env so manual `docker compose` commands and reboots use the same images.
pin_version() {
  if grep -q '^APP_VERSION=' .env; then
    sed -i "s/^APP_VERSION=.*/APP_VERSION=$1/" .env
  else
    echo "APP_VERSION=$1" >> .env
  fi
}

wait_ready() {
  for _ in $(seq 1 30); do
    if docker compose exec -T api node -e "fetch('http://127.0.0.1:3000/api/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then
      return 0
    fi
    sleep 2
  done
  return 1
}

on_exit() {
  local status=$?
  trap - EXIT
  if [ "${DEPLOYED:-0}" = 1 ]; then exit 0; fi
  set +e
  if [ -z "${PREV_VERSION:-}" ]; then
    log "deploy of ${VERSION:-?} failed; no previous version recorded, nothing to roll back to"
    exit "$status"
  fi

  log "deploy of ${VERSION} failed; rolling back to ${PREV_VERSION}"
  git checkout --quiet --force "${PREV_COMMIT}"
  pin_version "${PREV_VERSION}"
  if [ "${STACK_STARTED}" = 1 ]; then
    docker compose up -d --remove-orphans
    if wait_ready; then
      log "rolled back — ${PREV_VERSION} is live again"
    else
      log "ROLLBACK FAILED: ${PREV_VERSION} did not become ready either. Recent logs:"
      docker compose logs --tail=80 api
    fi
  else
    log "the stack was not restarted; ${PREV_VERSION} is still running"
  fi
  exit 1
}

main "$@"
exit
