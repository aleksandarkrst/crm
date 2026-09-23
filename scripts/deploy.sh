#!/usr/bin/env bash
# Deploys a specific version on the server. Called by GitHub Actions over SSH:
#   bash /opt/crm/scripts/deploy.sh <git-sha>
#
# Steps: check out the commit (compose + infra files) → pull the prebuilt images → back up
# the database → run migrations → roll the stack → wait for the readiness check.
set -euo pipefail

VERSION="${1:?usage: deploy.sh <git-sha>}"
APP_DIR="${APP_DIR:-/opt/crm}"
cd "$APP_DIR"

log() { printf '\n[deploy] %s\n' "$*"; }

log "checking out ${VERSION}"
git fetch --quiet origin
git checkout --quiet --force "${VERSION}"

# Pin the version in .env so manual `docker compose` commands use the same images.
if grep -q '^APP_VERSION=' .env; then
  sed -i "s/^APP_VERSION=.*/APP_VERSION=${VERSION}/" .env
else
  echo "APP_VERSION=${VERSION}" >> .env
fi
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
docker compose up -d --remove-orphans

log "waiting for readiness"
for i in $(seq 1 30); do
  if docker compose exec -T api node -e "fetch('http://127.0.0.1:3000/api/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then
    log "healthy — ${VERSION} is live"
    docker image prune -f >/dev/null
    exit 0
  fi
  sleep 2
done

log "API did not become ready. Recent logs:"
docker compose logs --tail=80 api
exit 1
