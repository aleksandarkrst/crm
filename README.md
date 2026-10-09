# Pultly CRM

Multi-tenant SMB business platform. A modular monolith (Node.js + TypeScript) on PostgreSQL,
deployed with Docker Compose on a Hetzner server behind a Cloudflare Tunnel. CRM is the first
domain; Projects, Workforce, Reporting and Finance come later as sibling modules.

```
frontend/   React + Vite UI (the "Mini CRM v2" design), served by nginx
backend/    NestJS API + background worker (same image), Drizzle ORM, pg-boss job queue
e2e/        browser end-to-end tests (Puppeteer + node:test)
infra/      Postgres init (roles), backup container, server bootstrap
scripts/    deploy.sh — run on the server by CI
docs/       ARCHITECTURE.md, DEPLOYMENT.md, WORKFLOW.md (issue to production), STAGING_CHECK.md
```

## Contributing: from an issue to production

Every change starts as a Linear issue (`CD-…`) and goes out on its own branch and pull request.
CI runs the checks, including the `guards` job that enforces row-level security and safe
migrations. Nobody reads an ordinary pull request before it merges: a review routine (a scheduled
Claude Code session) reviews pull requests that are ready for review with green CI, posts a
plain-language summary and merges them. Pull requests that touch migrations, tenant isolation,
sign-in, CI, deploys or the automation itself wait for the project owner. Every merge goes to
staging, where a person answers the five questions in
[docs/STAGING_CHECK.md](docs/STAGING_CHECK.md) with the seed workspaces; production is promoted
by hand after that. The whole process, and the rules coding agents follow, are in
[docs/WORKFLOW.md](docs/WORKFLOW.md) and [CLAUDE.md](CLAUDE.md).

## Run it locally

Prerequisites: Node.js 24 LTS (24.11+) and Docker Desktop.

```bash
# 1. Database (PostgreSQL 17 on localhost:5432, with the app roles pre-created)
docker compose -f docker-compose.dev.yml up -d

# 2. Backend — API on :3000
cd backend
cp .env.example .env
npm install
npm run build && npm run db:migrate
npm run dev                 # API with reload
npm run dev:worker          # (second terminal) background worker: emails, digests, other jobs

# 3. Frontend — UI on :5173 (proxies /api to 127.0.0.1:3000; VITE_PORT and VITE_API_PROXY override)
cd frontend
npm install
npm run dev
```

Open http://localhost:5173.

Sign in with any email (dev mode, no password), create a workspace, and start adding deals.
A new workspace opens with a getting-started checklist (for owners and admins) and empty screens
that say what fills them. To look around first, click **Load sample data**; **Remove sample data**
deletes exactly those records again. The app also works on tablets and phones (bottom bar,
one-tap call and email on contacts).
To try teamwork locally, invite a second email in **Settings → Team**, then open the invite link in
a private window and sign in as that email. Emails aren't delivered in development (`MAIL_DRIVER=log`):
the worker logs them, and `GET /api/dev/mail?to=<address>` shows what it "sent". Email settings are
described in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#email-cd-7-cd-16).

> **Current state of the UI:** deals (with their products, billing, discounts and installments, stage to-dos,
> fit scores, discovery notes, activity and stage history, and whether they were won or lost),
> companies, contacts, products (with their billing frequency), funnels (any number) and their stages are saved in the database, and so are custom fields, sales bonus rules (owners and admins only), the team, invitations, workspace settings, your
> profile and your notification settings. Document templates and the documents generated from them
> on a deal are saved too (the files under `STORAGE_DIR`). The worker generates documents and emails
> invitations, a morning digest and "deal assigned to you" notices. Some design features have no
> backend yet and only last until you reload the page: the remaining settings tabs. See
> [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#frontend-store--api).

**Documents:** owners and admins upload Word (.docx) templates with `{{merge fields}}` in
**Settings → Document templates** (there is a starter template and a field reference there). On a
deal, the **Documents** tab generates a document from a template; the worker fills it in with the
deal's company, contact, discovery notes, lines and amounts in the deal currency, and it is listed on
the deal to download. Details in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#documents-templates-and-generation-cd-13).

**Working together:** changes made by others appear without a reload; editing a field someone
else just changed tells you plainly that your change wasn't saved and shows theirs; deals,
companies and contacts show who changed which field (**History → Changes** on a deal). Details in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#working-together-live-updates-conflicts-change-history).

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

Four layers: unit and integration tests run on every pull request (`.github/workflows/ci.yml`),
the browser tests before a production deploy (`promote.yml`) and the performance tests every
night (`nightly.yml`):

- **Unit tests** (`backend`, `npm test`): fast, no database.
- **Integration tests** (`backend/test/integration`, `npm run test:integration`): build the API,
  start `dist/main.js` on port 3101 (dev auth) and the worker (`dist/worker.js`, log mail driver,
  fast retries) and test them over HTTP against PostgreSQL. One spec file per area; find yours
  by name rather than reading this list whole:
  - *Tenancy and access*: tenant isolation through RLS (API and raw SQL as the runtime role),
    composite-FK rejection of cross-tenant references, member/admin/owner rules and last-owner
    protection, the permissions matrix and people visibility, invitations (invited email only,
    single use, withdraw, replace), sign-up and onboarding.
  - *Deals and pipeline*: deal-amount recalculation from lines, stage history (a row per creation,
    move, funnel change, loss and reopening, isolated per tenant), lost deals (reason pick list,
    reopen, no moves while lost), funnels and stages (create, copy, rename, delete; add, reorder
    and delete stages with their deals moved and the moves in the history; roles and isolation),
    checklist items keeping to-dos across renames, the database guards (no lost deal in a won
    stage, no deal in a deleted stage), deal products (billing, tax modes, discounts,
    installments, currency), sales bonus rules (members get 403).
  - *Import, export, custom fields, documents*: CSV import (roles, per-row validation, duplicates
    skipped or updated, deal matching, size and row limits, tenant isolation, quoting edge cases),
    custom fields (definitions and roles, value validation per type, required, option renames,
    soft delete, isolation), documents (template upload limits and roles, generation by the worker
    with the deal's values checked in the .docx, downloads behind auth with another workspace
    getting 404, files removed with their template, document or deal).
  - *Email and notifications*: invitation emails (sent, resent, copy link, roles, failed after
    retries), notification settings per user and workspace, the daily digest's content by the
    workspace's date (and skipped when empty), "deal assigned to you" only when someone else
    assigns it, meeting invitations and minutes emails.
  - *Working together*: the live event stream (a member gets their workspace's changes, never
    another's), conflicting updates (409 per field, merges, same tab, no If-Match) and the change
    history (who, what, old → new, former members, paging, isolation).
  - *Meetings, visit plans, people, projects, timesheet*: each module's spec files
    (`meetings*.spec.ts`, `visit-plans`, `people-*`, `projects*`, `tasks*`, `time-*`,
    `timesheet*`) cover the rules described in their docs/ARCHITECTURE.md section.
- **Browser tests** (`e2e/`, Puppeteer with its bundled Chrome, run by `node:test`): sign-in,
  workspace, products, new deal, closing date, notes, drag between stages, reload, every screen
  renders; deal lines and stage to-dos persist; CHAMP fit score; team invitations with two
  browser contexts (invite, accept, roles, wrong account, withdraw, remove); marking a deal lost,
  the Pipeline's lost view and reopening; stage conversion on Overview; a third funnel with a deal
  in it, adding and removing stages; renaming a checklist item without losing the tick; importing
  companies and deals through the import dialog, and the exported contacts CSV (downloaded to a
  temp folder); the command palette (Ctrl+K, records and actions, keyboard navigation), the "+" menu and its letters, the account menu, the company and contact pages, and the sidebar
  workspace switcher; a custom field added in Settings and filled on a deal (after a reload, by a
  member too, and deleted); the sales bonus tab and Overview card hidden from members; changing a
  the deal currency in the products dialog; products, deal discounts and installments; downloading the starter template, uploading it as
  a template, generating a proposal on a deal and downloading it; the Team tab's invitation email
  status, Resend and Copy link, and the Notifications tab's settings surviving a reload (the worker must be
  running); two members in two browsers: a change appears for the other without a reload,
  editing the same field at once explains the refused change, and the deal's change history;
  a session that ends mid-edit opens "Your session ended" and saves the edit after signing in again.

- **Performance tests** (`backend/test/performance`, `npm run test:performance`): the same setup
  as the integration tests, with generated data (100,000 time entries, 2,000 tasks, 200 people)
  against the time report's 2-second target. Too slow for every pull request: the `Nightly`
  workflow (`.github/workflows/nightly.yml`) runs them every night and on demand.

The integration, browser and performance tests create their own users and workspaces with unique
emails, so they can run against the dev database without resetting it. The database must be
migrated first.

For trying the app by hand, `node dist/seed-staging.js` (after `npm run build`, with the dev
database in `backend/.env`) creates the two test workspaces the staging check uses
([docs/STAGING_CHECK.md](docs/STAGING_CHECK.md)); in dev auth mode the printed emails sign in with
any password.

```bash
# Integration tests (the dev database from docker-compose.dev.yml, migrated)
cd backend
npm run test:integration
#   DATABASE_URL          runtime role, default postgres://app_runtime:dev_runtime_password@localhost:5432/app
#                         (the suite refuses to run as a role that bypasses RLS)
#   INTEGRATION_API_PORT  port for the API it starts, default 3101
#   API_URL               test an already running API instead of starting one (run its worker too;
#                         set STORAGE_DIR to its storage folder for the file checks)
#   Files go to STORAGE_DIR (or the one in backend/.env, else backend/storage), the folder a dev
#   worker from this checkout uses too, in case it picks up a generation job first.

# Browser tests: start the API, the worker and the UI, then run the suite
cd backend && npm run build && PORT=3101 RATE_LIMIT_ENABLED=false node dist/main.js   # terminal 1 (the suite signs in more often than the rate limits allow)
cd backend && node dist/worker.js                                             # terminal 1b (documents, emails)
cd frontend && VITE_PORT=5174 VITE_API_PROXY=http://127.0.0.1:3101 npm run dev   # terminal 2
cd e2e && npm ci && E2E_BASE_URL=http://localhost:5174 npm test                # terminal 3
#   E2E_BASE_URL   where the UI runs (default http://localhost:5173); /api must reach the API
#   E2E_HEADLESS   false to watch the browser; E2E_SLOW_MO=100 slows every action down
#   E2E_TIMEOUT    per-action timeout in ms (default 10000)
#   E2E_NO_SANDBOX 1 to launch Chrome with --no-sandbox (automatic when CI is set)
#   PUPPETEER_EXECUTABLE_PATH  use another Chrome instead of the bundled one
```

A failing browser step saves full-page screenshots to `e2e/artifacts/` (uploaded by CI) and
skips the rest of that journey.

The `/api` proxy (`vite` and `vite preview`, `frontend/vite.config.ts`) keeps connections to the
API open and reuses them, and targets `127.0.0.1` even when `VITE_API_PROXY` says `localhost`
(the API listens on IPv4 only). Before this, every proxied request opened and closed its own
connection; on Windows a full e2e run now and then hit a port still in TIME_WAIT and got a 502
(`AggregateError [ECONNREFUSED]`, with `EADDRINUSE` for 127.0.0.1 inside) (CD-75).

## Connecting the tools (checklist)

Details and exact values are in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

- [ ] **GitHub**: create a repository and push. CI runs lint/tests/build on every PR. On `main`, it also builds images to GHCR and deploys.
- [ ] **Hetzner Cloud**: create an Ubuntu 26.04 LTS server and a Cloud Firewall (allow TCP 22 only), then run `infra/server/bootstrap.sh`.
- [ ] **Cloudflare**: add the domain, create a Tunnel, route `app.yourdomain.com` → `http://frontend:80`, and copy the tunnel token into `.env`.
- [ ] **Identity provider** (Auth0, Zitadel, Keycloak, Entra ID…): create an SPA app and an API/audience, and set the `OIDC_*` values.
- [ ] **Off-site backups**: use Hetzner Object Storage or a Storage Box, fill in `infra/backup/rclone.conf`, and test a restore.
- [ ] **GitHub secrets/variables**: add `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`, then `DEPLOY_ENABLED=true` plus the `OIDC_*` variables.
- [ ] **Staging** (optional, recommended): a second stack in `/opt/crm-staging` with its own tunnel and Auth0 app, then `STAGING_DEPLOY_ENABLED=true`. Merges then go to staging, and production gets a commit through the "Promote to production" workflow ([docs/DEPLOYMENT.md, Staging](docs/DEPLOYMENT.md#9-staging)).
