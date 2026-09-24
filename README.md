# Cadence CRM

Multi-tenant SMB business platform. A modular monolith (Node.js + TypeScript) on PostgreSQL,
deployed with Docker Compose on a Hetzner server behind a Cloudflare Tunnel. CRM is the first
domain; Projects, Workforce, Reporting and Finance come later as sibling modules.

```
frontend/   React + Vite UI (the "Mini CRM v2" design), served by nginx
backend/    NestJS API + background worker (same image), Drizzle ORM, pg-boss job queue
e2e/        browser end-to-end tests (Puppeteer + node:test)
infra/      Postgres init (roles), backup container, server bootstrap
scripts/    deploy.sh — run on the server by CI
docs/       ARCHITECTURE.md, DEPLOYMENT.md
```

## Run it locally

Prerequisites: Node.js 22.12+ and Docker Desktop.

```bash
# 1. Database (PostgreSQL 17 on localhost:5432, with the app roles pre-created)
docker compose -f docker-compose.dev.yml up -d

# 2. Backend — API on :3000
cd backend
cp .env.example .env
npm install
npm run build && npm run db:migrate
npm run dev                 # API with reload
npm run dev:worker          # (second terminal) background worker

# 3. Frontend — UI on :5173 (proxies /api to :3000)
cd frontend
npm install
npm run dev
```

Open http://localhost:5173.

Sign in with any email (dev mode, no password), create a workspace, and start adding deals.
To try teamwork locally, invite a second email in **Settings → Team**, then open the invite link in
a private window and sign in as that email.

> **Current state of the UI:** deals (with their product lines, payment schedules, stage to-dos,
> fit scores, discovery notes, activity and stage history, and whether they were won or lost),
> companies, contacts, products and funnel stages are saved in the database, and so are the team, invitations, workspace settings and your
> profile. Some design features have no backend yet and
> only last until you reload the page: documents and the remaining settings tabs. See
> [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#frontend-store--api).

**Import and export (owners and admins):** Companies, Contacts and Pipeline have **Import**, which
takes a CSV of companies, contacts or deals (comma or semicolon separated, up to 5,000 rows and
2 MB; the dialog has a template for each), and **Export**, which downloads the list as it is
filtered on screen, as an Excel-friendly CSV. Details in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#csv-import-and-export).

Try the API directly (dev auth, no password):

```bash
TOKEN=$(curl -s localhost:3000/api/auth/dev-login -H 'content-type: application/json' \
  -d '{"email":"you@example.com","name":"You"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).accessToken')
curl -s localhost:3000/api/tenants -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"name":"My Studio"}'
# → use the returned id as X-Tenant-Id on /api/crm/* calls
```

## Commands

| Where | Command | What |
|---|---|---|
| backend | `npm run dev` / `npm run dev:worker` | API / worker with reload |
| backend | `npm test` · `npm run lint` · `npm run typecheck` | checks (also run in CI) |
| backend | `npm run test:integration` | API tests against the real database (see [Tests](#tests)) |
| e2e | `npm test` | browser tests against a running UI + API (see [Tests](#tests)) |
| backend | `npm run db:generate -- --name <change>` | new migration from schema changes |
| backend | `npm run build && npm run db:migrate` | apply migrations |
| backend | `npm run db:studio` | browse the database |
| frontend | `npm run dev` · `npm run build` · `npm run lint` | UI |

## Tests

Three layers, all run in CI (`.github/workflows/ci.yml`):

- **Unit tests** (`backend`, `npm test`): fast, no database.
- **Integration tests** (`backend/test/integration`, `npm run test:integration`): build the API,
  start `dist/main.js` on port 3101 (dev auth) and test it over HTTP against PostgreSQL:
  tenant isolation through RLS (API and raw SQL as the runtime role), composite-FK rejection of
  cross-tenant references, member/admin/owner rules and last-owner protection, invitations
  (invited email only, single use, withdraw, replace), deal-amount recalculation from lines,
  deal stage history (a row per creation, move, funnel change, loss and reopening, isolated per
  tenant) and lost deals (reason pick list, reopen, no moves while lost), and CSV import (roles,
  per-row validation, duplicates skipped or updated, deal matching, size and row limits, tenant
  isolation, quoting edge cases).
- **Browser tests** (`e2e/`, Puppeteer with its bundled Chrome, run by `node:test`): sign-in,
  workspace, products, new deal, closing date, notes, drag between stages, reload, every screen
  renders; deal lines and stage to-dos persist; CHAMP fit score; team invitations with two
  browser contexts (invite, accept, roles, wrong account, withdraw, remove); marking a deal lost,
  the Pipeline's lost view and reopening; stage conversion on Overview; importing companies and
  deals through the import dialog, and the exported contacts CSV (downloaded to a temp folder).

Both suites create their own users and workspaces with unique emails, so they can run against
the dev database without resetting it. The database must be migrated first.

```bash
# Integration tests (the dev database from docker-compose.dev.yml, migrated)
cd backend
npm run test:integration
#   DATABASE_URL          runtime role, default postgres://app_runtime:dev_runtime_password@localhost:5432/app
#                         (the suite refuses to run as a role that bypasses RLS)
#   INTEGRATION_API_PORT  port for the API it starts, default 3101
#   API_URL               test an already running API instead of starting one

# Browser tests: start the API and the UI, then run the suite
cd backend && npm run build && PORT=3101 node dist/main.js                    # terminal 1
cd frontend && VITE_PORT=5174 VITE_API_PROXY=http://localhost:3101 npm run dev   # terminal 2
cd e2e && npm ci && E2E_BASE_URL=http://localhost:5174 npm test                # terminal 3
#   E2E_BASE_URL   where the UI runs (default http://localhost:5173); /api must reach the API
#   E2E_HEADLESS   false to watch the browser; E2E_SLOW_MO=100 slows every action down
#   E2E_TIMEOUT    per-action timeout in ms (default 10000)
#   E2E_NO_SANDBOX 1 to launch Chrome with --no-sandbox (automatic when CI is set)
#   PUPPETEER_EXECUTABLE_PATH  use another Chrome instead of the bundled one
```

A failing browser step saves full-page screenshots to `e2e/artifacts/` (uploaded by CI) and
skips the rest of that journey.

## Connecting the tools (checklist)

Details and exact values are in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

- [ ] **GitHub**: create a repository and push. CI runs lint/tests/build on every PR. On `main`, it also builds images to GHCR and deploys.
- [ ] **Hetzner Cloud**: create an Ubuntu 26.04 LTS server and a Cloud Firewall (allow TCP 22 only), then run `infra/server/bootstrap.sh`.
- [ ] **Cloudflare**: add the domain, create a Tunnel, route `app.yourdomain.com` → `http://frontend:80`, and copy the tunnel token into `.env`.
- [ ] **Identity provider** (Auth0, Zitadel, Keycloak, Entra ID…): create an SPA app and an API/audience, and set the `OIDC_*` values.
- [ ] **Off-site backups**: use Hetzner Object Storage or a Storage Box, fill in `infra/backup/rclone.conf`, and test a restore.
- [ ] **GitHub secrets/variables**: add `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`, then `DEPLOY_ENABLED=true` plus the `OIDC_*` variables.
