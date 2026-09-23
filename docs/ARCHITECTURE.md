# Architecture

## Runtime

```
Users → Cloudflare (DNS, WAF) → Cloudflare Tunnel → cloudflared ─┐   (outbound-only; no open ports)
                                                                 ▼
 Hetzner VPS (Docker Compose)                           frontend (nginx)
                                                        ├── /        → React SPA
                                                        └── /api/*   → api:3000
   edge network:  cloudflared, frontend, api, worker*, backup*        (*outbound internet only)
   data network (internal, no internet): api, worker, postgres, backup
```

- **api**: NestJS HTTP server (`dist/main.js`).
- **worker**: the same image, started as `dist/worker.js`. It processes background jobs and cron schedules.
- **migrate**: the same image as a one-off container (`docker compose run --rm migrate`).
- **postgres**: PostgreSQL 17, only on the internal network.
- **backup**: `pg_dump` on a schedule. Copies go off-server with rclone.

One hostname serves both UI and API (`app.yourdomain.com` and `app.yourdomain.com/api`), so there is no CORS and cookies stay simple.

## Backend layout (modular monolith)

```
backend/src/
  main.ts, app.module.ts        HTTP entry
  worker.ts, worker.module.ts   worker entry; worker/job-handlers.ts registers handlers + cron
  modules/                      business domains — each owns its tables, services, controllers
    identity/                   users, tenants, memberships, auth guard
    crm/                        companies, contacts, funnels, deals (+activities), products
    health/
  shared/                       cross-cutting, domain-free
    database/                   schema/, DatabaseService.withTenant(), migrate.ts, errors
    authorization/              TenantContext, @RequireTenant(role), @Tenant(), @CurrentUser()
    audit/                      AuditService.record(tx, ctx, …)
    events/                     job types, JobsService (pg-boss), tenant provisioning hooks
    validation/                 ZodPipe, shared zod helpers
  infrastructure/               config (env validation), logging (pino), storage (files)
```

**Module boundaries.** Other modules may only import a module through its `index.ts`, and ESLint
enforces this. When one domain needs to react to another (for example, a won deal starting a
project), send a job (`shared/events/job-types.ts`) instead of writing the other module's tables.

## Multi-tenancy: three layers

1. **Membership check.** `AuthGuard` verifies the token and, on `@RequireTenant(role)` routes,
   requires an `X-Tenant-Id` the user belongs to with at least that role (owner > admin > member).
2. **Row-level security.** Every tenant-scoped table has an RLS policy
   (`drizzle/0001_rls.sql`). The API and worker connect as `app_runtime`, which does not own the
   tables, so the policies always apply. `DatabaseService.withTenant(tenantId, tx => …)` sets
   `app.tenant_id` for that transaction only. Without it, queries return nothing.
3. **Composite foreign keys.** References between tenant tables use `(tenant_id, id)`, so a row
   can never point at another tenant's row, even if application code has a bug.

This is verified end to end against real PostgreSQL. A second tenant sees none of the first
tenant's rows, cross-tenant inserts are rejected, and a non-member gets 403.

### Adding a tenant-scoped table

1. Define it in `shared/database/schema/<module>.ts` with a `tenant_id` column, `unique(tenant_id, id)`, and composite FKs.
2. `npm run db:generate -- --name <change>` creates the migration.
3. `npx drizzle-kit generate --custom --name <change>_rls` creates an empty migration. Add the three RLS statements (copy them from `0001_rls.sql`).
4. Access the table only inside `database.withTenant(ctx.tenantId, …)`.

## Auth

The app handles authorization, not authentication. `AUTH_MODE=oidc` verifies JWTs from any
OpenID Connect provider (discovery → JWKS). Users are created on first request
("just-in-time"). Tenants and roles live in our database. `AUTH_MODE=dev` adds a passwordless
`/api/auth/dev-login` for local work, and the app refuses to start with it when `NODE_ENV=production`.

## Background jobs

pg-boss keeps its queue in PostgreSQL (schema `pgboss`), so there is no Redis to run. Pass the
current transaction to `jobs.send(name, data, tx)` so the job exists only if the business change
commits. `DealsService.moveToStage` does this for `crm.deal-won`. Add Redis later only for caching
or very high job volume.

## Frontend: demo store → API

The UI is a faithful port of the Claude Design "Mini CRM v2" prototype. Its state lives in
`frontend/src/store` (`seed.ts` holds the design's sample data, `selectors.ts` the derived logic,
and `store.tsx` the actions). Screens read from `useStore()` only, so the store is the single place to
change.

Suggested order for wiring it to the backend (`frontend/src/lib/api.ts` already has the client,
tenant header and auth):

1. Sign-in + tenant picker: `/api/me`, `/api/tenants` (dev login or OIDC via `lib/auth.ts`).
2. Funnels (`GET /api/crm/funnels`) and the Pipeline board (`GET /api/crm/deals?funnelId=`, `POST /api/crm/deals/:id/move`).
3. Companies, Contacts, Products: plain CRUD endpoints that already exist.
4. Deal screen: `PATCH /api/crm/deals/:id` (CHAMP → fit score), activities (`/api/crm/deals/:id/activities`).

The design includes features the backend doesn't have yet, which are next in the CRM module:
- deal lines with payment schedules
- per-lead stage to-dos
- document templates and generation (worker + storage)
- sales-bonus rules
- team invitations
- custom fields
- notification and integration settings
