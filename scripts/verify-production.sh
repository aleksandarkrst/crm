#!/usr/bin/env bash
# Smoke-test a deployed production stack from the server. This intentionally uses the same
# Compose project and networks as the deployment; run it as the deploy user from /opt/crm.
set -uo pipefail

APP_DIR="${APP_DIR:-/opt/crm}"
PUBLIC_URL="${1:-}"
failures=0

pass() { printf '[verify] PASS: %s\n' "$*"; }
fail() { printf '[verify] FAIL: %s\n' "$*" >&2; failures=$((failures + 1)); }
run() {
  local description="$1"
  shift
  if "$@"; then
    pass "$description"
  else
    fail "$description"
  fi
}

if ! cd "$APP_DIR"; then
  printf '[verify] ERROR: cannot enter APP_DIR=%s\n' "$APP_DIR" >&2
  exit 2
fi

if [ ! -f .env ]; then
  printf '[verify] ERROR: %s/.env does not exist\n' "$APP_DIR" >&2
  exit 2
fi

# Do not source .env: values such as MAIL_FROM may legitimately contain spaces and shell syntax.
if [ -z "$PUBLIC_URL" ]; then
  PUBLIC_URL="$(sed -n 's/^APP_URL=//p' .env | tail -n 1)"
fi
PUBLIC_URL="${PUBLIC_URL%/}"

printf '[verify] checking Compose stack in %s\n' "$APP_DIR"
run 'Compose configuration is valid' docker compose config --quiet

expected_services=(postgres api worker frontend website cloudflared backup)
running="$(docker compose ps --services --status running 2>/dev/null || true)"
for service in "${expected_services[@]}"; do
  if printf '%s\n' "$running" | grep -Fxq "$service"; then
    pass "$service is running"
  else
    fail "$service is running"
  fi
done

run 'PostgreSQL healthcheck passes' docker compose exec -T postgres \
  sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
run 'API readiness endpoint passes inside its container' docker compose exec -T api node -e \
  "fetch('http://127.0.0.1:3000/api/health/ready').then(r => { if (!r.ok) throw Error(String(r.status)) })"
run 'nginx serves the frontend and can proxy API readiness' docker compose exec -T frontend \
  sh -c "wget -qO- http://127.0.0.1/healthz | grep -qx ok && wget -qO /dev/null http://127.0.0.1/api/health/ready"
run 'nginx serves the website and its blog route' docker compose exec -T website \
  sh -c "wget -qO- http://127.0.0.1/healthz | grep -qx ok && wget -qO /dev/null http://127.0.0.1/blog"

# Production services must not bind ports on the host. An empty HostPort list is expected.
if published_ports="$(
  ids="$(docker compose ps -q 2>/dev/null)"
  [ -n "$ids" ] || exit 1
  docker inspect --format '{{range $p, $bindings := .NetworkSettings.Ports}}{{range $bindings}}{{println $.Name $p .HostIp .HostPort}}{{end}}{{end}}' $ids
)"; then
  if [ -z "$published_ports" ]; then
    pass 'no container ports are published on the host'
  else
    fail "no container ports are published on the host (found:${published_ports//$'\n'/; })"
  fi
else
  fail 'container port bindings could not be inspected'
fi

run 'runtime database role is neither superuser nor allowed to bypass RLS' \
  docker compose exec -T postgres sh -c \
  'row="$(psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select (rolsuper or rolbypassrls) from pg_roles where rolname = '\''$APP_DB_USER'\''")"; [ "$row" = f ]'

# Running migrations again verifies both the image and owner credentials, and is safe by design.
run 'migrations are current and idempotent' docker compose run --rm migrate

before="$(docker compose run --rm --entrypoint sh backup -c \
  "ls -1t /backups/*.dump 2>/dev/null | head -n 1" 2>/dev/null)"
if docker compose run --rm backup once; then
  after="$(docker compose run --rm --entrypoint sh backup -c \
    "ls -1t /backups/*.dump 2>/dev/null | head -n 1" 2>/dev/null)"
  if [[ -n "$after" && "$after" != "$before" ]]; then
    pass 'a new database backup was created and validated'
  else
    fail 'a new database backup was created and validated'
  fi
else
  fail 'a new database backup was created and validated'
fi

# Consume the full stream: grep -q can close the pipe early and make Docker fail with
# SIGPIPE under pipefail even when a registration was found.
if docker compose logs --no-color cloudflared 2>/dev/null | grep 'Registered tunnel connection' >/dev/null; then
  pass 'Cloudflare Tunnel registered a connection'
else
  fail 'Cloudflare Tunnel registered a connection'
fi

if [ -n "$PUBLIC_URL" ]; then
  run "$PUBLIC_URL serves the SPA through the tunnel" curl --fail --silent --show-error \
    --location --max-time 20 --output /dev/null "$PUBLIC_URL/"
  run "$PUBLIC_URL proxies API readiness through nginx and the tunnel" curl --fail --silent \
    --show-error --max-time 20 --output /dev/null "$PUBLIC_URL/api/health/ready"
else
  fail 'APP_URL is set (or a public URL was passed as the first argument)'
fi

# The website's public address (pultly.com); optional, so stacks without it (staging) skip it.
WEBSITE_URL="$(sed -n 's/^WEBSITE_URL=//p' .env | tail -n 1)"
WEBSITE_URL="${WEBSITE_URL%/}"
if [ -n "$WEBSITE_URL" ]; then
  run "$WEBSITE_URL serves the website through the tunnel" curl --fail --silent --show-error \
    --max-time 20 --output /dev/null "$WEBSITE_URL/blog"
fi

if [ "$failures" -ne 0 ]; then
  printf '[verify] %d check(s) failed\n' "$failures" >&2
  exit 1
fi

printf '[verify] all production smoke checks passed\n'
