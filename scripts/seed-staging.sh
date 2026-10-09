#!/usr/bin/env bash
# Seeds (or resets) the two test workspaces on staging (CD-313): Seed Alpha and Seed Bravo, each with
# an owner, an admin and a member, and sample records in every module. Run on the server as deploy:
#
#   APP_DIR=/opt/crm-staging bash scripts/seed-staging.sh
#
# It runs backend/src/seed-staging.ts inside the api image (same env as the API: database, Auth0
# Management API for the accounts). The accounts and the password are printed at the end; the
# password is new on every run unless SEED_PASSWORD is set. The command refuses a stack whose
# APP_URL doesn't contain "staging" (SEED_ALLOW_PRODUCTION=yes overrides, which you don't want).
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/crm-staging}"
cd "$APP_DIR"
docker compose run --rm \
  ${SEED_PASSWORD:+-e SEED_PASSWORD="$SEED_PASSWORD"} \
  ${SEED_ALLOW_PRODUCTION:+-e SEED_ALLOW_PRODUCTION="$SEED_ALLOW_PRODUCTION"} \
  ${SEED_EMAIL_DOMAIN:+-e SEED_EMAIL_DOMAIN="$SEED_EMAIL_DOMAIN"} \
  api node dist/seed-staging.js
