# Architecture audit (CD-87)

Phase 1 of the production readiness audit: a map of the system as it is on 2026-09-27, checked
against the code on `main` (`1eed43f`) and the live production server. Findings and scores follow
in later phases (see the end of this file).

## At a glance

| | |
|---|---|
| Product | Cadence CRM: multi-tenant CRM for small businesses (deals, companies, contacts, products, funnels, documents) |
| Shape | Modular monolith: one NestJS backend image run as **api**, **worker** and **migrate**; a React SPA served by nginx |
| Hosting | One Hetzner VPS (Ubuntu 26.04), Docker Compose, public traffic only via Cloudflare Tunnel |
| Public URL | https://app.simplicity-labs.com (one hostname for UI and `/api`) |
| Database | PostgreSQL 17 (container, internal network only), row-level security per tenant |
| Auth | External OIDC provider (Auth0), JWTs verified by the API; tenants and roles in our database |
| Deploys | Merge to `main` → GitHub Actions checks → images to GHCR → SSH → `scripts/deploy.sh <sha>` |

## Tech stack and versions

| Layer | Technology |
|---|---|
| Runtime | Node.js 24 LTS (≥ 24.11), TypeScript ~6.0 |
| Backend | NestJS 12 (Express 5), Drizzle ORM 0.45 + drizzle-kit 0.31, `pg` 8, pg-boss 12, zod 4, jose 6, helmet 8, pino 10 (nestjs-pino), nodemailer 10, docxtemplater 3 + PizZip, @sentry/node 11 |
| Backend build | `tsc` to CommonJS (ESM-only deps load via `require(esm)`); no Nest CLI |
| Frontend | React 19, react-router 7, Vite 8 (rolldown), oidc-client-ts 3, @sentry/react 11 (lazy-loaded) |
| Tests | Vitest 5 (backend unit: 9 files; integration: 28 files against real PostgreSQL), Puppeteer 25 + `node:test` browser e2e (27 files) |
| Lint | ESLint 10 + typescript-eslint 8 (backend blocks deep imports across modules) |
| Images | `node:24-alpine` (backend, runs as `node`, tini), `nginx:1.29-alpine` (frontend), `postgres:17-alpine` (db and backup), `cloudflare/cloudflared:2026.9.1` |

## Frontend, backend and how they connect

```
Browser ──HTTPS──► Cloudflare (DNS, TLS, WAF) ──Tunnel──► cloudflared ──► frontend (nginx :80)
                                                                          ├── /        React SPA (static, try_files → index.html)
                                                                          ├── /healthz  nginx liveness
                                                                          └── /api/*   proxy → api:3000 (resolved per request)
```

- **Frontend** (`frontend/`): a port of the "Mini CRM v2" Claude Design handoff. Screens read only
  `useStore()`; `store/remote.ts` loads a workspace from the API, `store/store.tsx` saves in its
  actions (optimistic, debounced typing, reload on failure). Live updates arrive over a `fetch`-based
  SSE stream (`GET /api/events`) read in a dedicated worker (`store/live.worker.ts`). OIDC config and
  the Sentry DSN are baked in at image build time (`VITE_*` build args from GitHub variables).
  One feature is still browser-only: integration settings (CD-79).
- **Backend** (`backend/src/`): ~93 HTTP routes under `/api`, grouped in modules:
  - `identity`: `/me`, tenants, team and invitations, profile, workspace settings, auth guard, dev login (dev mode only)
  - `crm`: companies, contacts, deals (+ lines, tasks, activities, stage history, lost/reopen), funnels and stages, products, custom fields, bonus rules, documents, CSV import, record history, onboarding and sample data
  - `notifications`: digest preview, dev-only digest/mail endpoints
  - `realtime`: `GET /api/events` (LISTEN/NOTIFY → Server-Sent Events)
  - `health`: `/api/health` (liveness), `/api/health/ready` (checks the database)
- **Request pipeline**: helmet → IP rate limit middleware → `AuthGuard` (JWT + membership and role from
  `X-Tenant-Id`) → per-user rate limit interceptor → zod validation pipes → service → `DatabaseService.withTenant()`.
  Errors ≥ 500 are reported to Sentry by `ErrorReportingFilter`.
- **Cross-module effects** go through pg-boss jobs (`shared/events/job-types.ts`), sent in the same
  transaction as the business change.

## Database, schema and data flow

- PostgreSQL 17 in the `postgres` container, on the `data` Docker network (`internal: true`, no internet, never tunnelled).
- **Roles** (`infra/postgres/init/01-roles.sh`): `app_admin` owns the tables and runs migrations only;
  `app_runtime` (NOSUPERUSER, NOBYPASSRLS) is used by api and worker, so RLS always applies. The
  `pgboss` schema is pre-created and owned by `app_runtime` (JobsService uses `createSchema: false`).
- **24 tables**. Platform: `tenants`, `users`, `memberships`, `invitations`, `audit_logs`,
  `sample_records`. CRM: `companies`, `contacts`, `deals`, `deal_contacts`, `deal_lines`,
  `deal_tasks`, `deal_stage_history`, `activities`, `funnels`, `funnel_stages`, `products`,
  `custom_field_defs`, `sales_bonus_rules`, `sales_bonus_settings`, `document_templates`,
  `deal_documents`, `record_changes`. Notifications: `daily_digests`. Plus pg-boss's own tables.
- **Tenant isolation, three layers**: membership check in `AuthGuard`; RLS policies on every
  tenant table keyed on `current_setting('app.tenant_id')`, set per transaction by `withTenant()`;
  composite `(tenant_id, id)` foreign keys. `users`, `tenants`, `memberships` and `invitations` have
  no RLS by design (they decide access before a tenant context exists).
- **Migrations**: 23 ordered SQL files, `backend/drizzle/0000`–`0022`, generated by drizzle-kit plus
  custom files for RLS, triggers and data conversion. Applied by `migrate.js` as the owner, before
  every deploy (after a backup).
- **Triggers** keep invariants in the database: field change history (`record_changes`,
  append-only), `updated_at` versions for optimistic concurrency, `pg_notify('crm_changes')` for
  live updates, lost-not-won and deleted-stage guards.
- **Files**: `.docx` templates and generated documents on disk under `STORAGE_DIR`
  (`app_storage` volume, shared by api and worker, one folder per tenant, streamed only after a
  `withTenant` lookup).

## Auth and sessions

- **Authentication** is external: OIDC (Auth0 in production, `AUTH_MODE=oidc`). The SPA runs the
  authorization-code + PKCE flow with oidc-client-ts and sends `Authorization: Bearer <access token>`.
  The API verifies the token against the issuer's JWKS (issuer and audience checked) and creates the
  user just in time. No server-side sessions and no cookies, so no CSRF surface from cookies.
- **Authorization** is ours: memberships with roles owner > admin > member, `@RequireTenant(role)`
  on routes, `X-Tenant-Id` header checked against memberships on every request.
- Invitations: one-time token (SHA-256 hash stored for lookup, AES-256-GCM sealed copy with
  `APP_SECRET` for resend), 7-day expiry, bound to the invited email (the `email` claim of the access token).
- `AUTH_MODE=dev` (passwordless dev login) is refused at startup when `NODE_ENV=production`.
  Verified live: production answers the dev-login route with 401 "Dev login disabled" after validation.

### Auth0 tenant (read through the Auth0 connector, 2026-09-27)

- Tenant `dev-yz7q4hukh2ycg4il` (US region). Connections in use: Username-Password and Google.
- **Application "CRM"** (SPA, public client, no secret): callback `https://app.simplicity-labs.com/auth/callback`,
  logout URL and web origin `https://app.simplicity-labs.com`, RS256. Grant types still include
  `implicit` and `refresh_token`, although the SPA uses code + PKCE only and never asks for `offline_access`.
- **API "Simplicity CRM API"** (audience `https://app.simplicity-labs.com/api`, matches the SPA's
  `audience` parameter): RS256, no refresh tokens (`allow_offline_access: false`), access tokens from
  the browser last 2 h (`token_lifetime_for_web: 7200`). The SPA sets no `silent_redirect_uri` and
  gets no refresh token, so it cannot renew: after 2 h the token expires mid-session.
- **Action "CRM user details"** (post-login, node22, deployed): for this API only, adds the `email`
  claim only when `email_verified` is true, plus `name`. Invitation binding to email relies on this.
- **Other clients**: "Simplicity CRM API (Test Application)", an M2M client created with the API
  (client credentials, unused by the app); the tenant's "Default App".
- **Logs** (last 50 events, 26–27 Sep): 13 successful logins, 3 signups, 2 users. Four failed code
  exchanges at 11:31–11:32 on 26 Sep were setup-time and stopped after the client was updated at 11:33.
  One warning: the **Google connection uses Auth0 development keys**, which Auth0 says must not be
  used in production.
- Not readable with this connector: MFA, brute-force and breached-password protection, and the
  tenant's environment tag.

## Third-party services

| Service | Use | Status in production (checked 2026-09-27) |
|---|---|---|
| Hetzner Cloud | VPS, Cloud Firewall | Running, 75 GB disk, 7 % used |
| Cloudflare | DNS, TLS, Tunnel, WAF | Tunnel up; HSTS set by Cloudflare |
| Auth0 | OIDC identity provider | In use, tenant `dev-yz7q4hukh2ycg4il`; Google login on Auth0 dev keys (see Auth0 tenant) |
| GitHub + GHCR | Code, CI/CD, private images | Private repo `aleksandarkrst/crm` |
| Sentry (EU, `de.sentry.io`) | Errors: `crm-backend`, `crm-frontend` | Backend DSN set on the server; frontend DSN built into the live bundle (lazy `sentry` chunk); no unresolved issues in 14 days |
| Better Stack | Uptime monitor, backup and disk heartbeats | Heartbeat URLs set on the server |
| Off-site storage (rclone crypt remote `offsite-crypt:crm`) | Encrypted backup copies | Receiving dumps and file archives |
| SMTP provider | Invitation, digest and assignment emails | **Not configured: `MAIL_DRIVER=log`, no `SMTP_URL`** |

Not used: Supabase, Vercel, Redis, payments or billing providers, incoming webhooks.

## Hosting, environments and deployment

- **Environments**: local development (Postgres from `docker-compose.dev.yml`, API/worker/UI on
  the host, `AUTH_MODE=dev`), CI (throwaway Postgres service per job), and **production**.
  There is **no staging environment**.
- **Server hardening** (`infra/server/bootstrap.sh`): `deploy` user, key-only SSH, no root login,
  ufw (SSH only), fail2ban, unattended upgrades; Hetzner Cloud Firewall allows TCP 22 only. No
  container publishes a host port.
- **CI** (`.github/workflows/ci.yml`, on every PR and push to `main`): backend lint, typecheck,
  unit tests and build; frontend lint and build; integration tests against PostgreSQL; browser e2e.
  On `main`: build and push both images tagged with the commit SHA, then deploy if
  `DEPLOY_ENABLED=true` (GitHub environment `production`).
- **Deploy** (`scripts/deploy.sh <sha>`): check out the SHA, pin `APP_VERSION` in `.env`, pull
  images, **back up**, run migrations, `docker compose up -d`, wait up to 60 s for `/api/health/ready`.
- **Rollback**: `deploy.sh <previous-sha>` (application only; destructive migrations need a restore).
- **Live state** (rechecked 2026-09-27): the server runs `1eed43f`, the head of `main` (PR #17);
  `APP_VERSION` matches. The first check had caught that deploy mid-way.

## Background jobs, cron and queues

pg-boss 12 in PostgreSQL (schema `pgboss`), handled by the **worker** container. Jobs are sent in
the business transaction. Mail jobs retry `MAIL_RETRY_LIMIT` (4) times with exponential backoff.

| Job | Trigger | Handler |
|---|---|---|
| `crm.deal-won` | deal enters its won stage | placeholder (logs only) |
| `crm.generate-document` | `POST /api/crm/deals/:id/documents` | fills the .docx, marks ready/failed |
| `crm.deal-assigned` | someone else becomes a deal's owner | "deal assigned to you" email |
| `identity.invitation-email` | invitation created or resent | invitation email |
| `notifications.digest-tick` | cron every 15 min (UTC) | queues digests due in each workspace's morning |
| `notifications.daily-digest` | the tick | one member's digest email (idempotent per day via `daily_digests`) |
| `reporting.nightly` | cron `0 2 * * *` UTC | placeholder |

Other scheduled work: the **backup** container loops every `BACKUP_INTERVAL_HOURS` (24 h): `pg_dump`,
tar of `app_storage`, rclone copy off-site, retention 14 days, Better Stack heartbeat; hourly disk
check. Also once before every deploy's migrations.

**Webhooks**: none, in or out (apart from the outbound Better Stack heartbeat calls).

## Observability

- Logs: pino JSON to stdout (`docker compose logs`), level `info`. No central log store.
- Health: `/api/health` (liveness, Docker healthcheck), `/api/health/ready` (database; Better
  Stack monitor and deploy gate), nginx `/healthz`.
- Errors: Sentry backend (5xx, crashes, jobs out of retries); frontend (only when built with a DSN).
- Alerts: Better Stack uptime, backup and disk heartbeats.

## Not checked in Phase 1

- **GitHub Actions history, branch protection, secrets and variables**: the repo is private, the
  `gh` CLI isn't installed, and the reconnected GitHub connector exposes no tools to this session
  yet. `SENTRY_FRONTEND_DSN` is set as a variable (confirmed by the user and by the live bundle).
- **Cloudflare** (WAF rules, Access policies, tunnel config): connected by the user, but no Cloudflare tools are loaded in this session yet.
- **Better Stack** (monitor and heartbeat state): no access.

## Findings

Phase 2 (audit) and Phase 3 (fixes) are added below as they are completed.
