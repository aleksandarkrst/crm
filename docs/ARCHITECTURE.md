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

## Deal stage history

`deal_stage_history` has one row per stage or outcome change of a deal: the deal, `from_stage_id`
(null on creation), `to_stage_id`, the deal's `outcome` after the change, `changed_at` and
`changed_by_user_id`. `kind` says what happened: `created` (the first stage), `moved` (drag and
drop, "Advance", including into the won stage), `funnel_changed` (restarts at the new funnel's first
stage), `lost` and `reopened` (the stage stays the same). `DealsService` writes the row in the same
transaction as the change, through `StageHistoryService.record`, so the history can't disagree with
the deal. Moving a deal to the stage it is already in writes nothing.

- Deals that existed before the table got one `created` row each (their current stage at their
  creation time, no user) in `drizzle/0008_deal_stage_history_rls.sql`.
- The stage references are composite FKs without cascade: a stage that has history can't be deleted
  (the app can't delete stages yet). Deleting a deal deletes its history.
- `GET /api/crm/deal-stage-history` lists the workspace's history oldest first, paged like the other
  lists (`limit` ≤ 200, `offset`; `dealId` narrows it to one deal).

### Conversion metrics (Overview)

The **Stage conversion** card is computed in the browser (`store/metrics.ts`) from the stage history,
which Overview loads each time it opens (`refreshHistory`). The frontend already has every deal
and applies the Overview filters (audience/funnel, salesperson by user id, source, closing-date
range) to them, so the card uses exactly the deals the other panels use. A backend aggregate would
have to repeat those filters in SQL. Revisit this if the history outgrows a page load.

- Only a deal's path through the funnel it's in counts: from its last `created` or
  `funnel_changed` row.
- **Stage-to-stage conversion** for stage N: of the deals that entered N, the share that later
  entered any later stage. Skipping a stage counts as moving on from the stages before it, not as
  having reached the skipped one. Lost deals and deals still sitting in N count as not moved on,
  so this is conversion so far.
- **Win rate** = won / (won + lost) among the deals in view, from their current outcome.
- **Average time in stage**: per visit to the stage; a visit that is still going counts up to now,
  and the clock stops while a deal is lost.
- **Time to proposal**: from entering the funnel to first entering the proposal stage, averaged over
  the deals that got there. The proposal stage is the first stage whose entry document is
  "Proposal" (`documentOnEntry`, the same field that starts the proposal when a deal enters it),
  and otherwise the stage with the template key `proposal`. Neither depends on the stage's name or
  position, so renaming or reordering stages doesn't change it.
- With fewer than 5 deals in view that moved between stages, the card says so instead of
  showing rates.

## Deal outcome: open, won, lost

- **Won is the won stage.** A deal is won while it is in its funnel's won stage
  (`funnel_stages.is_won`). This isn't stored a second time, so the board, the stage tracker and the
  outcome can't disagree: moving a deal into the won stage wins it (and sends `crm.deal-won`), and
  moving it back out makes it open again.
- **Lost is stored** on the deal: `lost_at`, `lost_reason` (a fixed pick list: Price, Timing,
  Chose a competitor, No budget, No decision, Other) and an optional `lost_note`; a check constraint
  keeps them together. The deal keeps the stage it was lost in, so the history shows where deals
  drop out.
- **The database keeps lost out of won** (CD-74): triggers (`drizzle/0010_deal_lost_not_won.sql`)
  refuse a lost deal in a won stage, whichever way it would happen: marking a deal in the won stage
  lost, moving a lost deal into the won stage, inserting one, or turning a stage that holds lost
  deals into the won stage. They raise `check_violation` naming `deals_lost_not_won`, which
  `mapDbError` turns into 409 with the trigger's message.
- `POST /api/crm/deals/:id/lost` `{ reason, note? }` marks an open deal lost (409 for a lost or won
  deal, 400 for a reason outside the list). `POST /api/crm/deals/:id/reopen` makes a lost deal open
  again in the same stage (409 if it isn't lost). A lost deal can't be moved or switched to another
  funnel (409) until it is reopened; other fields can still be edited. Both write a timeline entry
  ("Marked as lost: <reason>" with the note, "Reopened") and a stage history row.
- Every deal response carries `outcome` (`open` / `won` / `lost`), and `GET /api/crm/deals` takes
  `?outcome=`.
- In the UI, the deal screen has **Mark as lost** (a dialog with the reason and a note) and shows
  "Lost · <reason>" with **Reopen**. The Pipeline board hides lost deals unless its last filter chip
  says "Include lost deals" or "Lost deals only". Overview leaves lost deals out of open and weighted
  pipeline, stalled deals, the funnel, payments due and bonuses.

## Auth

The app handles authorization, not authentication. `AUTH_MODE=oidc` verifies JWTs from any
OpenID Connect provider (discovery → JWKS). Users are created on first request
("just-in-time"). Tenants and roles live in our database. `AUTH_MODE=dev` adds a passwordless
`/api/auth/dev-login` for local work, and the app refuses to start with it when `NODE_ENV=production`.

### Teams and invitations

A tenant's members and their roles live in `memberships`. Admins invite people from
**Settings → Team** (`POST /api/team/invitations`). The API returns a one-time token and stores
only its SHA-256 hash; the UI shows the link `/invite/<token>` to copy and send. For now, sending
it is up to you. Emailing it from the worker is the natural next step.

- An invitation is for one email address, expires after 7 days, and works once. Re-inviting the
  same address replaces the pending invitation.
- Accepting (`POST /api/invitations/:token/accept`) requires a signed-in user with that email,
  so a forwarded link is useless to anyone else.
- Owners manage everyone. Admins invite, change roles and remove members, but can't touch owners
  or grant the owner role. Every tenant keeps at least one owner. Anyone can leave.
- `invitations`, like `memberships`, has no RLS because it decides access before tenant context
  exists. `TeamService` filters by tenant explicitly.

## Background jobs

pg-boss keeps its queue in PostgreSQL (schema `pgboss`), so there is no Redis to run. Pass the
current transaction to `jobs.send(name, data, tx)` so the job exists only if the business change
commits. `DealsService.moveToStage` does this for `crm.deal-won`. Add Redis later only for caching
or very high job volume.

## Frontend: store → API

The UI is a port of the Claude Design "Mini CRM v2" prototype. Screens read from `useStore()` only;
the store is the one place that talks to the backend.

- `components/SessionGate.tsx`: sign-in (dev login or OIDC), picking or creating a workspace, and
  loading it. The store is created per workspace.
- `store/remote.ts`: loads funnels, deals, deal lines, stage to-dos, companies, contacts,
  products, the workspace settings and your profile (`lib/api.ts`) and maps
  them onto the design's lead-centric model. A lead is a deal and shows its company and primary
  contact inline. People are primary contacts plus everyone else. Backend ids are kept on the UI
  records (`Lead.companyId`, `Person.contactId`, `Funnel.id`, …).
- `store/store.tsx`: every action updates the screen immediately and then saves. Typing is
  debounced (`saveLater`, one write per field). A failed save names the change that failed and why, then
  reloads the workspace so the screen matches the database. That reload first sends the debounced
  edits still waiting and waits for writes in flight, so it never throws away other unsaved typing;
  only the failed change goes back to its saved value. Changes that touch several records (new deal,
  moving a contact) reload after saving.
- Companies are identified by their backend id, never by name (two companies can share a name):
  routes are `/companies/:id`, and pickers and filters select by id. Where names collide, pickers
  add the HQ (or a number) to tell them apart. Deals without a company aren't listed as a company.
- Deal owners: the deal Summary lists active members. Owners are matched by user id everywhere
  (Salesperson filters, bonus rows); labels come from the team list, with the email added when two
  members share a name. The deal, company, contact and task lists also return the owner's name, so
  a deal whose owner left the workspace shows "<name> (former member)" and can still be filtered.
  The Contacts list and a contact's screen show the contact's own owner, not the owner of a deal
  they are on. The API accepts an `ownerUserId` (deals,
  companies, contacts) only if that user is a member of the tenant, and returns 400 otherwise.
- Updates: every PATCH body goes through `nonEmptyPatch` (`shared/validation/common.ts`), so an
  update with no fields gets 400 "Nothing to update" instead of reaching the database.
- Deleting (owners and admins only; the buttons are hidden for members and the API returns 403):
  - a **deal** takes its lines, to-dos, activity and contact links with it (FK cascade);
  - a **contact** is unlinked from every deal; deals where they were the primary contact are
    kept without one;
  - a **company** with deals is refused with 409 and a message ("… has 2 deals. Delete them or
    move them to another company first."); its contacts are kept without a company.

  After a delete the UI opens the list screen and reloads the workspace.
- Activity history is loaded per deal when a deal, company or contact screen opens (`ensureLog`).
- Deal lines: the backend recalculates the deal amount on every line change. A product that is
  on a deal can't be deleted from the catalog.
- No made-up dates: a deal without a closing date has none (it only matches "Any closing date" on
  Overview), and a deal line without a start date is left out of "Funnel by payment due date"
  (the card says how many lines were left out).
- Stage to-dos: a playbook to-do gets a row on first touch, keyed by deal + stage + checklist label
  (renaming a checklist item in the funnel builder starts that to-do fresh). Off-playbook to-dos
  are rows of their own.
- Tasks from the **New task** dialog are `deal_tasks` rows too (off-playbook, `blocks_advance =
  false`) with a due date, a channel and an owner (`assignee_user_id`, which must be a member of the
  workspace). They show in Today (overdue / today / next up, with a done toggle) and on the lead's
  To-Do list, but don't count towards finishing a stage. Creating one logs "Task added" on the
  deal's timeline and deleting one logs "Task removed" (the timeline is history, so the first entry
  stays); ticking it off logs it like any completed to-do. The store keeps them in
  `leadTasks`; the other to-dos (`blocks_advance = true`) gate "Advance".

- Workspace settings (**Settings → Workspace**): name, currency (ISO 4217), time zone (IANA) and
  fiscal-year start month are columns on `tenants` (`GET/PATCH /api/workspace`). Every member reads
  them; only owners and admins change them (members see the fields disabled; the API returns 403).
  A rename updates the session, so the workspace switcher shows the new name. Nothing else uses
  the values yet (deal amounts keep their own currency).
- Profile (**Profile settings**, `GET/PATCH /api/profile`, always the caller's own): name, job title,
  phone, language, date format and start page live on `users` and apply in every workspace. The
  default funnel and the daily-digest choice live on `memberships`, because funnels and the digest
  belong to one workspace. A name set here wins over the name in the sign-in token
  (`users.display_name_custom`). The start page and the default funnel take effect (the app opens
  on them). Language, date format and the digest are only stored for now, and the UI says so.
  Email and password belong to the sign-in provider and can't be changed here.
- Discovery notes on a deal (headline, need, constraint, decision maker, discovery date) are
  columns on `deals`. They are edited in the deal's **Discovery** card and merged into the proposal
  view, which shows fields that are still empty as bracketed gaps.

Still browser-only (seeded from `store/seed.ts`, lost on reload), because the backend doesn't have
them yet:
- adding and removing funnel stages (blocked in the UI for now; editing existing stages is saved)
- document templates and generation (worker + storage)
- sales-bonus rules (including "Sales bonus earned" on the Workspace tab); they start empty
  (no made-up rate, minimum or flat amount)
- invitation emails (links are copied by hand for now)
- custom fields
- notification and integration settings
