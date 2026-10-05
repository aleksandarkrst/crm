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
- **backup**: `pg_dump` and a tar.gz of the file storage (`app_storage`: templates and generated
  documents) on a schedule. Copies go off-server with rclone.

One hostname serves both UI and API (`app.yourdomain.com` and `app.yourdomain.com/api`), so there is no CORS and cookies stay simple.

## Backend layout (modular monolith)

```
backend/src/
  main.ts, app.module.ts        HTTP entry
  worker.ts, worker.module.ts   worker entry; worker/job-handlers.ts registers handlers + cron
  modules/                      business domains — each owns its tables, services, controllers
    identity/                   users, tenants, memberships, auth guard
    realtime/                   GET /api/events: live change hints (LISTEN/NOTIFY → SSE)
    crm/                        companies, contacts, funnels, deals (+activities), products, documents
    health/
  shared/                       cross-cutting, domain-free
    database/                   schema/, DatabaseService.withTenant(), migrate.ts, errors
    authorization/              TenantContext, @RequireTenant(role), @Tenant(), @CurrentUser()
    audit/                      AuditService.record(tx, ctx, …)
    database/request-context.ts who acts (user, browser tab), handed to PostgreSQL by withTenant
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

Two tables are **append-only** for the app: `record_changes` (change history) and `audit_logs`
(`0024_audit_logs_append_only.sql`). Their policies allow SELECT and INSERT only, and the runtime
role has no UPDATE, DELETE or TRUNCATE on `audit_logs`, so neither a bug nor a compromised API can
rewrite history.

**Time limits on runtime connections (CD-101).** The API's and worker's pool sets
`statement_timeout` (30 s, `DATABASE_STATEMENT_TIMEOUT_MS`) and
`idle_in_transaction_session_timeout` (60 s, `DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_MS`; 0 turns
either off). A runaway query or a transaction a bug leaves open is cancelled instead of holding a
pooled connection and its locks until a restart. Keep slow work (rendering, sending mail, calls to
other services) outside `withTenant` transactions. Migrations, pg-boss and the live-update
listener use their own connections without these limits.

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
the deal. Moving a deal to the stage it is already in writes nothing. A funnel change also writes
"Moved to funnel <label>" on the deal's timeline, with the stage it restarts at.

- Deals that existed before the table got one `created` row each (their current stage at their
  creation time, no user) in `drizzle/0008_deal_stage_history_rls.sql`.
- The stage references are composite FKs without cascade. Deleting a stage (CD-9) therefore keeps
  its row, marked `deleted_at` (see below), so the history is never nulled or rewritten. Deleting a
  deal deletes its history.
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
- A stage deleted since (CD-9) isn't in the funnel any more: a visit to it counts nowhere, and a
  deal that went through it counts as having skipped it. The path still starts at the deal's last
  `created` / `funnel_changed` row, even when that row names a deleted stage.

## Funnels and stages

A workspace has any number of funnels (CD-10); new workspaces get two (`default-funnels.ts`).
Everyone reads them (`GET /api/crm/funnels`, deleted stages left out); owners and admins change
them (members get 403). The frontend keys funnels by id everywhere (`State.funnels`, `Lead.segment`,
the Overview audience filter).

- `POST /api/crm/funnels` `{ label, note?, copyFromFunnelId? }` creates a funnel after the others:
  a copy of another funnel's stages (new stage and checklist item ids, no deals) or a small default
  set (New deal, Discovery, Proposal, Won). `PATCH /api/crm/funnels/:id` renames it or changes the
  note; the key (a slug) stays. In the UI: **Settings → Funnel builder → New funnel**, and the name
  and "How they buy" fields above the stages.
- `DELETE /api/crm/funnels/:id` only deletes a funnel that never had deals: none in it, and no
  stage history row pointing at its stages (a deal moved to another funnel still does). The last
  funnel stays. A profile whose default funnel was deleted falls back to the first funnel.
- `POST /api/crm/funnels/:id/stages` `{ name, position?, … }` adds a stage (by default just before
  the won stage); `PUT /api/crm/funnels/:id/stages/order` `{ stageIds }` takes every stage once, in
  the new order. The builder has "+ Add stage" and ↑/↓ per stage.
- `DELETE /api/crm/funnels/:id/stages/:stageId?moveDealsTo=<stageId>` deletes a stage. If it holds
  deals (lost ones included), `moveDealsTo` is required and must be another stage of the funnel;
  each deal gets a `moved` stage history row by the caller and a timeline entry ("Moved to X · The
  stage Y was deleted."). Moving into the won stage wins them (as a drag would, including
  `crm.deal-won`); lost deals can't go there (409). The funnel's last stage and its only won stage
  can't be deleted (409). Playbook and stage to-dos of the stage go with it; tasks from the
  "New task" dialog move to the target stage (or the stage before). The builder's **Remove** asks
  where the deals go.
- **Deleted stages are soft-deleted** (`funnel_stages.deleted_at`, key suffixed with `~<id>` so it
  can be reused). Why not `ON DELETE SET NULL` on the history FKs: `to_stage_id` is NOT NULL, and a
  nulled stage would erase where deals were and for how long, which the conversion metrics read.
  Keeping the row keeps every history row valid and meaningful. Triggers
  (`drizzle/0012_stage_soft_delete.sql`) keep deals out of deleted stages and refuse to delete a
  stage that still holds deals, whatever code writes the rows. Code that reads `funnel_stages`
  directly must filter `deleted_at is null` (FunnelsService and DealsService do).

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

## CSV import and export

### Import (CD-64)

`backend/src/modules/crm/import/` imports companies, contacts, deals and (CD-81) products from a
CSV. It has no table
of its own, so nothing about an import is stored between requests: the browser keeps the file's
text and sends it with each call as JSON (`{ csv, mapping?, duplicates?, funnelId? }`).

- `POST /api/crm/import/:type/preview` (`companies`, `contacts`, `deals`, `products`) parses and validates the
  whole file and writes nothing. Without a `mapping` it guesses one from the header names (field
  label, key or an alias such as "Website" → domain, ignoring case and punctuation). It returns the
  headers, the mapping, the field list, counts over every row (new, update, skip, errors, new
  companies and contacts), the first 20 rows with their status and messages, and up to 100 rows with
  errors.
- `POST /api/crm/import/:type/commit` takes the same body and imports. It returns created, updated,
  skipped and failed counts, and each failed row with its line, reason and original cells (the
  dialog offers them as a CSV download).
- `GET /api/crm/import/:type/template` is a CSV with the field labels and an example row.
- All three are for owners and admins (`@RequireTenant('admin')`); members get 403.

Rules:

- **Parsing** (`csv.ts`, no dependency): UTF-8, header row, comma or semicolon (whichever the first
  line has more of outside quotes), `"` quoting with `""` inside, line breaks inside quotes, CRLF or
  LF, a BOM is dropped, blank lines are skipped. An unclosed quote rejects the file (400). Cells are
  trimmed; a leading `'` before `= + - @` (the export's formula guard) is dropped.
- **Validation**: each row goes through the create endpoints' zod schemas (`CreateCompany`,
  `CreateContact`, `CreateDeal`), with messages that name the column's field, e.g.
  "Email: Invalid email address". Values are normalised first: amounts like `14,000.50`,
  `14.000,50` or `€ 14 000`, dates as `DD.MM.YYYY`, buyer roles in any case. An owner is matched
  by the email of a member of this workspace; without one, the importer owns the row, as with the
  normal create endpoints.
- **Duplicates**: companies by name (trimmed, case-insensitive), contacts by email
  (case-insensitive; contacts without an email are never duplicates). Rows earlier in the same file
  count too. The dialog asks whether to **skip** them (default) or **update** them. An update only
  sets the fields the row has a value for, so an empty cell never blanks existing data, and it
  never renames (the name or email is the match key). When several companies share a name, the
  oldest is used. Deals are never treated as duplicates.
- **Deals**: the company is matched by name or created. The funnel is matched by label or key, and
  rows without one use the funnel picked in the dialog (the Pipeline's funnel), or the first funnel.
  The stage is matched by name or key within that funnel; empty means its first stage. An unknown
  funnel or stage is an error, not a silent default. The contact is an existing contact with the
  given email, or a new one when a name is given (linked to the deal's company). Each deal gets a
  `created` stage-history row and a "Deal created · Imported from CSV" activity, like a deal made
  in the app. Importing straight into the won stage does not send `crm.deal-won`, because imports
  are history, not new wins.
- **Limits**: 2 MB of UTF-8 text (413) and 5,000 data rows (400). `main.ts` gives
  `/api/crm/import` a 3 MB JSON body limit (JSON escaping adds some overhead); every other route
  keeps the 100 kB default.
- **Writes**: the commit parses the file again (the server never trusts the preview) and loads the
  lookups once (company names, contact emails, members, funnels) inside `withTenant`. Rows are then
  saved in batches of 200, each batch in its own `withTenant` transaction: the rows are validated in
  memory, their writes queued with ids generated up front, and the batch is written with a few
  multi-row inserts. If the database refuses a batch, that batch is rolled back and redone row by
  row, each row in a savepoint, so only the bad rows fail. 5,000 deals with new companies and
  contacts take about 8 seconds locally. Batches that were saved stay saved if a later one fails.
  Each batch writes one `crm.imported` audit entry with its line range and counts (not one per row).
- **Tenant isolation**: every read and write runs in `withTenant`, so RLS limits matching to the
  current workspace: an import can't find, update or link another workspace's companies, contacts
  or funnels, and a `funnelId` from another workspace is "Unknown funnel" (400). Owners must be
  members of the workspace.

The dialog (`frontend/src/modals/ImportDialog.tsx`) opens from **Import** on Companies, Contacts and
Pipeline, preset to that type: pick the type (and the funnel for deals) and a file, or download the
template; check the column mapping; preview the rows with errors and duplicates and choose skip or
update; import, and see the summary with the failed rows to download. After an import the store
reloads the workspace. The API calls live in `store/importExport.ts`.

### Export (CD-65)

**Export filter results** in the "⋯" menu of Pipeline, Companies, Contacts and Products (CD-81,
next to **Import data**) downloads the list the screen shows, with its filters applied (Pipeline:
the funnel on screen and the lost-deals view too), as `pultly-<list>-<date>.csv`. Owners and
admins only; the menu is hidden for members. The menu is only on those four list screens.

Products (CD-81) are matched by name like companies (skip or update). Their columns are name,
description, unit price, unit, quantity, tax %, billing frequency ("One time", "Monthly", …, also
"yearly" or the API keys) and billing cycles (recurring only; empty renews until canceled). The
product export has the same columns plus the id, so an exported file imports back.

The file is built in the browser (`store/exportCsv.ts`, `lib/csv.ts`), not on the server, because
"what the screen shows" is defined by filters that exist only in the UI (stalled days, value bands,
company industry on deals, the lost view, owner labels for former members). A server export would
have to repeat them in SQL and could drift. Members can already read these rows through the list
endpoints, so a server export would not protect any data; the owner/admin rule is a product rule,
applied in the UI. Revisit this if exports need an audit trail or outgrow the data the browser has.

Columns: deals have the deal and company ids, deal, company, contact and their email, funnel,
stage, outcome, lost reason, value (a plain number), closing date, owner, source, fit score and days
since contact. Companies have the id, name, industry, HQ, team size, source, owner, contacts,
opportunities, open value, latest stage and last touch. Contacts have the contact and company ids,
name, job title, company, email, phone, LinkedIn, buyer role and owner.

The file is Excel-friendly: UTF-8 with a BOM, CRLF line ends, and fields quoted when they contain a
comma, semicolon, quote or line break. To guard against CSV (formula) injection, text cells that
start with `=`, `+`, `-`, `@`, a tab or a carriage return get a leading `'`; numbers are written as
numbers. The import drops that `'` again, so an exported file imports back unchanged.

## Documents: templates and generation (CD-13)

`backend/src/modules/crm/documents/`. Owners and admins upload Word (.docx) templates with merge
fields; anyone in the workspace generates a document on a deal from one and downloads it.

- **Tables** (`drizzle/0015_documents.sql`, RLS in `0016_documents_rls.sql`):
  `document_templates` (name, document type from the design's list, original file name, size, the
  merge fields found at upload, storage key, uploader) and `deal_documents` (deal, template id and
  a copy of its name and type, document name, `status` queued → running → ready | failed, error,
  storage key, size, `missing_fields`, who and when). `deal_documents.template_id` is a composite FK
  with `ON DELETE SET NULL (template_id)` (PostgreSQL 15+; written in the custom migration because
  Drizzle can't express the column list), so deleting a template keeps the documents made from it.
  Deleting a deal deletes its documents (FK cascade).
- **Merge fields** (`placeholders.ts`, the single source for the API, the upload scan and the
  reference in Settings): double braces, as the design's template dialog says, e.g.
  `{{company.name}}`, `{{contact.first_name}}`, `{{deal.headline}}`, `{{deal.amount}}` (net),
  `{{deal.vat}}`, `{{deal.total}}`, `{{deal.closing_date}}`, `{{discovery.need}}` and the other
  discovery notes (CD-14), `{{owner.name}}`, `{{workspace.name}}`, `{{today}}`. Deal lines repeat
  with `{{#lines}} … {{/lines}}` (`{{line.product}}`, `{{line.quantity}}`, `{{line.unit_price}}`,
  `{{line.total}}`, …); with the opening tag in a table row's first cell and the closing tag in its
  last, the row repeats. The design's short forms (`{{company}}`, `{{contact_name}}`, `{{price}}`,
  `{{total}}`, `{{need}}`) work too. `GET /api/crm/document-templates/placeholders` lists them all.
- **Formatting**: amounts in the deal's currency, written in the locale of the workspace currency
  like the UI (`€14,000`, `US$2,500` in a euro workspace), whole amounts without decimals; calendar
  dates as "31 October 2026" (not shifted by time zones); `{{today}}` in the workspace time zone.
  A known field without a value becomes empty (never "null") and is listed in `missing_fields`
  ("Left empty: Constraint") on the document and its timeline entry. An unknown field
  (`{{deal.amoutn}}`) stays in the document as written, so a typo is visible, and the upload
  dialog flags it as "not recognised" before saving.
- **Library**: [docxtemplater](https://docxtemplater.com/) (free core, MIT) and PizZip (MIT). No
  paid modules: the parser is our own (flat dotted keys, see `docx.ts`), and the starter template is
  generated in code (`starterTemplate()`), so it always matches the fields.
- **Upload** (`POST /api/crm/document-templates`, multipart `file`, `name`, `docType`; owners and
  admins): `.docx` only, at most 5 MB (multer's limit answers 413), not empty, a real Word zip that
  unpacks to at most 60 MB in at most 2,000 parts, and a template docxtemplater can compile (an unclosed loop is a 400 with
  the reason). The 60 MB is measured by inflating every part with a capped zlib before PizZip
  reads it, not taken from the sizes the zip claims, which a crafted file can forge (CD-104); the
  worker runs the same check before rendering. The api and worker containers also have memory
  limits (`API_MEM_LIMIT`, `WORKER_MEM_LIMIT`, 768 MB by default). `POST …/scan` runs the same checks and returns the fields without saving (the
  dialog's "Parameters found"). `GET …/starter` is the starter template; `GET …/:id/file`
  downloads a template; `DELETE …/:id` deletes it and its file.
- **Generate** (`POST /api/crm/deals/:id/documents` `{ templateId, name? }`, any member): inserts a
  `queued` document and sends `crm.generate-document` in the same transaction (202). The worker
  (`DocumentGenerator`) marks it `running`, reads the deal, company, primary contact, owner, lines and
  workspace with `withTenant`, fills the template, stores the file, marks it `ready` and writes
  "Document generated · <name>" on the deal's timeline (from the template, by whom, what was left
  empty). A broken or missing template marks it `failed` with a readable reason; it isn't retried.
  If the worker stops mid-job (a deploy, a crash), pg-boss delivers the job again and that retry
  takes over the `running` document; a first delivery only claims `queued` ones (CD-100). As a
  backstop, the nightly job (`reporting.nightly`) marks documents `running` for over an hour as
  `failed` ("Generation was interrupted. Try again.").
  The UI polls `GET /api/crm/deal-documents/:id` until it is ready or failed.
  `GET /api/crm/deal-documents?dealId=` lists a deal's documents, `…/:id/file` downloads one, and
  `DELETE …/:id` (owners, admins and whoever generated it) deletes it with its file and writes
  "Document deleted" on the timeline.
- **Files** (`infrastructure/storage/storage.service.ts`): on disk under `STORAGE_DIR`, one folder
  per tenant: `<tenant>/templates/<id>.docx` and `<tenant>/documents/<id>.docx`, written to a
  temporary name and renamed. There is no static route: a file is only streamed after its row was
  found with `withTenant`, so it needs a signed-in member (401/403 otherwise) and another workspace
  gets 404. Deleting a template, a document or a deal removes the files after the transaction
  commits. In production `STORAGE_DIR` is the `app_storage` volume, shared by api and worker, and
  the backup container archives it next to each database dump (see
  [DEPLOYMENT.md](DEPLOYMENT.md#5-backups)).
- **UI**: Settings → Document templates lists the uploaded templates (fields, uploader, Download,
  Delete for owners/admins), keeps the built-in "Proposal v4" browser preview, and has the merge
  field reference with **Download starter template**. **New template** (owners/admins) takes the
  type, name and file, scans it and shows the fields before **Save template**. On a deal, the
  composer's **Documents** tab picks a template (the stage's document type first), generates, and
  lists the documents with their state, template, who, when and what was left empty, with Download
  and Delete. Entering a stage whose entry document is a Proposal opens the generation dialog, which
  follows the real job (queued, filling in, saved) and offers the download; with no templates it
  offers the built-in preview and, for admins, the way to upload one. A contact's screen lists the
  documents of their deal.
- **Not done yet**: PDF output (it needs LibreOffice or a conversion service in the worker; a
  follow-up), emailing a document, and "sent/signed" states (the built-in preview's "Mark as sent"
  is still session-only).

## Auth

The app handles authorization, not authentication. `AUTH_MODE=oidc` verifies JWTs from any
OpenID Connect provider (discovery → JWKS). Users are created on first request
("just-in-time"). Tenants and roles live in our database. `AUTH_MODE=dev` adds a passwordless
`/api/auth/dev-login` for local work, and the app refuses to start with it when `NODE_ENV=production`.

### Sessions that don't end mid-work (CD-88)

Signing in happens on Pultly's own pages; the backend talks to the provider (`identity/sessions.ts`,
`session.controller.ts`):

- **Password**: `POST /api/auth/login {email, password}` uses Auth0's password-realm grant with the
  sign-in application (`AUTH0_LOGIN_CLIENT_*`) and the visitor's address in `auth0-forwarded-for`,
  so the provider's brute-force protection counts per visitor. Its errors become messages that
  don't tell whether an account exists.
- **Google**: `GET /api/auth/google` redirects to the provider with `connection=` and PKCE (verifier
  and state in a 10-minute `crm_oauth` cookie); `/api/auth/callback` exchanges the code and
  redirects to `/auth/callback?result=ok|cancelled|failed|unavailable`.
- **The session**: the refresh token (`offline_access`, rotating) lives in the httpOnly `crm_session`
  cookie (SameSite=Strict, path `/api/auth`, 30 days). The browser keeps only the access token, in
  memory (`frontend/src/lib/auth.ts`), and gets a new one from `POST /api/auth/refresh` shortly
  before it expires; a reload does the same. Tabs take turns renewing (`navigator.locks`), because
  each use replaces the refresh token. `POST /api/auth/logout` revokes it and clears the cookie.
  These endpoints only accept JSON, which a cross-site form can't send.

The access token lasts 2 hours, so:

- **Renewal.** `getAccessToken()` renews one that is about to expire or has expired anyway (a
  laptop that slept).
- **401 anywhere.** Every API call goes through `authorizedFetch()` (`lib/api.ts`): on 401 it
  renews once and sends the request again. If that fails too, the session has ended:
  `SessionEndedDialog` opens over the app and requests wait (`lib/session.ts`) instead of failing.
  An edit is therefore neither reset nor lost; it is saved once the user signs in again, with the
  password right in the dialog or Google in a popup (`/auth/callback` posts the result back to the
  page), so the page and its unsaved edits stay; signing in as someone else doesn't release the
  waiting edits. **Sign out** in the dialog discards them. Before the app is open (start-up) a 401
  goes to the sign-in screen as before. The live-update stream reconnects with a fresh token on its own.
- Covered by `e2e/tests/session-expiry.test.mjs` (dev mode: an invalid token, the dialog, the edit
  saved after signing in again).

### Creating an account and signing in (CD-114)

- Signed out, every address shows the sign-in page (`/login`); `/signup` is "Create account". No
  CRM data loads before sign-in (`SessionGate`). Screens: `components/AuthScreens.tsx`.
- **Google**: "Continue with Google" (shown when `GET /api/auth/signup/options` says so) goes through
  `/api/auth/google`, for signing in and creating an account alike. A cancelled or refused sign-in
  comes back to `/auth/callback` with a result, which the sign-in page explains.
- **Email**: Pultly confirms the address itself, before any password exists:
  1. `POST /api/auth/signup {email}` always answers 202 `{sent:true}`, so it can't tell whether the
     address has an account. The worker (`identity.signup-email`) emails a link, or, when the address
     already has an account, "You already have a Pultly account" with how that account signs in.
  2. The link is `/signup/verify#<token>` (after `#`, so it stays out of server logs). The token is
     stored as a SHA-256 hash (plus sealed with `APP_SECRET`, so a retried job can email it), works for
     24 hours and once. A new email replaces older links; asking again within 60 s sends nothing.
  3. `check` shows the address; `complete {token, password}` creates the user at the provider with
     `email_verified: true` (Auth0 Management API, `accounts.ts`) and uses the link up. A password the
     provider refuses doesn't use it up. Pultly never stores the password.
  4. `complete` also signs in (the session cookie above), so the new account opens right away.
- **Forgot password**: `POST /api/auth/password/forgot {email}` works the same way (always 202,
  `purpose='reset'` rows in `signup_requests`): a one-hour link `/reset-password#<token>`, then
  `reset {token, password}` sets it with the Management API (`update:users`) and signs in. An
  address without a password account gets an email saying how it signs in.
- **One account per email**: `IdentityService.resolveUser` refuses (409 `account_exists`) a sign-in
  subject it hasn't seen whose email already belongs to a user with another subject (e.g. Google
  after email and password). The app says how that account signs in and offers **Sign out**.
- Covered by `backend/test/integration/signup.spec.ts` and `e2e/tests/signup.test.mjs` (dev mode).

### Teams and invitations

A tenant's members and their roles live in `memberships`. Admins invite people from
**Settings → Team** (`POST /api/team/invitations`). The API returns a one-time token, which the
invite dialog shows as the link `/invite/<token>` to copy, and the worker emails the same link
(CD-7, see "Email" below). The token is found by its SHA-256 hash (`token_hash`); it is also
kept encrypted with `APP_SECRET` (`token_sealed`, AES-256-GCM), so the worker can build the email
and admins can resend or copy it later.

- **Email status**: `invitations.email_status` is `queued` (waiting for the worker, or retrying
  after a failed send, with `email_error` set), `sent` (`email_sent_at`) or `failed` (every retry
  failed; `email_error` says why). The Team tab shows it under the address ("Email sent 24 Sep",
  "Sending email…", "Email not delivered: …") and polls every 3 s while one is on its way.
- **Resend** (`POST /api/team/invitations/:id/resend`, admins) queues the email again with the same
  link and gives the invitation another 7 days. **Copy link** (`GET /api/team/invitations/:id/link`,
  admins) returns the token, for when the email doesn't arrive. Both answer 404 for an invitation
  that was accepted, withdrawn or expired (or belongs to another workspace), and 409 for one from
  before CD-7 (no stored link: withdraw it and invite again) or when `APP_SECRET` changed since.
- The email names the workspace, who invited them and the role, and links to
  `APP_URL/invite/<token>`. `APP_URL` is configured, never taken from the request, so a spoofed
  Host header can't redirect invite links.

- An invitation is for one email address, expires after 7 days, and works once. Re-inviting the
  same address replaces the pending invitation.
- Accepting (`POST /api/invitations/:token/accept`) requires a signed-in user with that email,
  so a forwarded link is useless to anyone else. Onboarding also offers the invitations pending for
  the user's email without the link (`POST /api/me/invitations/:id/accept`, CD-115).
- Owners manage everyone. Admins invite, change roles and remove members, but can't touch owners
  or grant the owner role. Every tenant keeps at least one owner. Anyone can leave.
- `invitations`, like `memberships`, has no RLS because it decides access before tenant context
  exists. `TeamService` filters by tenant explicitly.

### Rate limits (CD-18)

`shared/rate-limit` caps how fast one client can call the API. Over a limit, the API answers
**429** with `Retry-After` and "Too many requests. Try again in N seconds.", which the UI shows
like any other error.

| Limit | Counted per | Allowance | Where |
|---|---|---|---|
| Every request | client IP | 1200 / minute | all routes except `/api/health` |
| Sign-in | client IP | 20 / 10 minutes | `@RateLimit('signIn')`: dev login, opening and accepting an invitation, creating an account |
| Changes | user | 120 / minute | every POST, PUT, PATCH and DELETE by a signed-in user |
| Email | user | 20 / hour | `@RateLimit('email')`: inviting, resending an invitation |
| Heavy | user | 30 / 10 minutes | `@RateLimit('heavy')`: CSV import, document templates and generation, sample data, new workspaces |

- The IP limit is a middleware, so it runs before `AuthGuard` and also counts requests with bad
  tokens. The others are a global interceptor, which runs after it and knows the user, so
  colleagues behind one office address don't use up each other's allowance.
- The client IP is `req.ip`: nginx sets `X-Forwarded-For` to Cloudflare's `CF-Connecting-IP`,
  and the API can only be reached through nginx.
- Counters are fixed windows in the API's memory (`RateLimiter`). They reset when the API
  restarts, and more than one API replica would need a shared store.
- Mark a new route that sends email or does expensive work with `@RateLimit('email')` or
  `@RateLimit('heavy')`. Sign-in is handled by the identity provider, which has its own limits.
- `RATE_LIMIT_ENABLED=false` switches it all off. Only the integration and browser test runs do
  that, because they sign in fresh users from one address all the time.

## Background jobs

pg-boss keeps its queue in PostgreSQL (schema `pgboss`), so there is no Redis to run. Pass the
current transaction to `jobs.send(name, data, tx)` so the job exists only if the business change
commits. `DealsService.moveToStage` does this for `crm.deal-won`, and `DocumentsService.generate`
for `crm.generate-document` (the worker fills the template, see "Documents" above). Add Redis later only for caching
or very high job volume.

The worker fetches up to 10 jobs of a queue at a time (and again straight away while batches come
back full) and settles each job on its own, so one failing email doesn't retry the others. A
handler gets `{ retryCount, retryLimit, lastAttempt }` to tell a final failure from one that will
be retried. Modules register their own handlers through a worker module exported from their
`index.ts` (`IdentityWorkerModule`, `NotificationsWorkerModule`).

| Job | Sent by | Handled by |
|---|---|---|
| `crm.deal-won` | CRM, deal enters the won stage | worker placeholder (future projects handover) |
| `crm.deal-assigned` | CRM, someone else becomes a deal's owner (create or change) | notifications: "deal assigned to you" email |
| `identity.invitation-email` | identity, invitation created or resent | identity: the invitation email |
| `notifications.digest-tick` | cron, every 15 minutes | notifications: queues the digests that are due |
| `notifications.daily-digest` | the tick (or `POST /api/dev/digest`) | notifications: one member's digest |
| `reporting.nightly` | cron, 02:00 UTC | placeholder |

## Email (CD-7, CD-16)

Only the worker sends email, through `Mailer` (`infrastructure/mail/`), whose driver `MAIL_DRIVER`
picks:

- `log` (the default; development and tests): writes each email to the log (recipient and subject
  at info, the text at debug) and keeps the last ones in memory. Outside production it also
  appends them to `$STORAGE_DIR/dev-mail/outbox.jsonl`, which `GET /api/dev/mail?to=<address>`
  returns newest first (only with `AUTH_MODE=dev`; the API and worker are separate processes, so
  the file is what they share). Addresses at the reserved `.invalid` domain fail, so failed sends
  and their retries can be tried without a provider. In production the driver reports
  `notDelivered`, and the jobs record invitations and digests as failed instead of sent (CD-84).
- `smtp`: nodemailer with `SMTP_URL` (e.g. `smtps://USER:PASSWORD@smtp.postmarkapp.com:465`) and
  `MAIL_FROM`; any provider with SMTP works (Postmark, Resend, SES, Mailgun).

Mail jobs (`MAIL_JOBS` in `job-types.ts`) are retried `MAIL_RETRY_LIMIT` times (default 4) with
exponential backoff from `MAIL_RETRY_DELAY_SECONDS` (default 30). Emails are plain text plus a
simple HTML version with inline styles (`infrastructure/mail/html.ts` escapes everything).
Links use `APP_URL`.

| Variable | Default | |
|---|---|---|
| `APP_URL` | `http://localhost:5173` | public address for links; required in production |
| `APP_SECRET` | `DEV_JWT_SECRET` outside production | ≥ 32 characters; encrypts invite links; required in production |
| `MAIL_DRIVER` | `log` | `log` or `smtp` |
| `SMTP_URL` | | required with `smtp` |
| `MAIL_FROM` | `Pultly <no-reply@localhost>` | sender |
| `MAIL_RETRY_LIMIT`, `MAIL_RETRY_DELAY_SECONDS` | `4`, `30` | retries of a failed send |

Production values are listed in `docs/DEPLOYMENT.md` and the root `.env.example`.

### Notification settings

**Settings → Notifications** shows your own settings for the current workspace. They are columns
on your membership, read and saved through `GET/PATCH /api/profile` like the rest of the profile
(so they are per user and per workspace, and nobody else can change them):

- **Daily digest email** (`memberships.daily_digest`, the setting the profile already had since
  CD-12; the Profile screen shows the same switch).
- **Deal assigned to you** (`memberships.notify_deal_assigned`, on by default).
- "Document activity" and "Weekly pipeline report" are listed as **Coming soon**: nothing sends
  them yet. The old browser-only "Stalled lead nudges" and "Task reminders" became the digest.

### Daily digest

Every 15 minutes `notifications.digest-tick` looks at each workspace's clock (its time zone,
CD-73). Between 8:00 and 11:59 local time it queues `notifications.daily-digest` for each member
with the digest on and an email address, unless `daily_digests` already has a row for them and
that local date. The window lets a worker that was down at 8:00 catch up, without sending a
"morning" email in the afternoon. The digest job claims the day (a new row, or a failed one being
retried), loads the digest inside `withTenant` and:

- sends it when it has something: the member's tasks that aren't done and are due before today
  (overdue) or today, by the workspace's date, on deals that aren't lost; and their open deals
  (not won, not lost) with no open task from the "New task" dialog, i.e. the Pipeline's "No next
  step" flag. Each section lists up to 20 items linking to `/deals/<id>`;
- records `skipped` without sending when all three are empty;
- records `failed` with the error when the send throws; pg-boss retries it.

`daily_digests` (tenant-scoped, RLS in `drizzle/0018_daily_digests_rls.sql`) holds one row per
workspace, member and local date with its status (`sending`, `sent`, `skipped`, `failed`), item
count and error. `GET /api/notifications/digest` returns what your digest for this workspace
contains right now; with `AUTH_MODE=dev`, `POST /api/dev/digest` sends yours now, whatever the time.
The content and the email are pure functions in `modules/notifications/digest-content.ts`.

### Deal assigned to you

`DealsService` queues `crm.deal-assigned` in the same transaction when a deal gets an owner who
isn't the person making the change: a new deal created for someone else, or an owner change.
Saving the same owner again or taking a deal yourself sends nothing, and neither does the CSV
import. The worker checks the assignee's setting when it sends (so switching it off stops emails
still in the queue), and skips deals that were deleted or given to someone else again meanwhile.

## Working together: live updates, conflicts, change history

### Change history (CD-69)

`record_changes` has one row per changed field of a deal, company or contact: `entity_type`,
`entity_id`, `action` (`created`, `updated`, `deleted`, and for deals `line_added`, `line_changed`,
`line_removed`), `field` (the API's name: `title`, `stageId`, `ownerUserId`, `lostReason`, …),
`old_value` / `new_value` (jsonb), a `label` (the record's name on created/deleted, the product's
name on a line), `actor_user_id`, `client_id` (the browser tab) and `changed_at`.

- **Written by triggers** (`drizzle/0020_record_changes_rls.sql`), not by services, so every write
  path is covered: the API, CSV import (one `created` row per imported record) and worker jobs.
  Stage changes, owner changes, lost/reopen (`lostReason` set / cleared, with `lostNote`), the
  amount following the lines, and line changes (only the fields that changed) are all rows.
  Lines deleted together with their deal aren't recorded; the deal's `deleted` row says it.
- **Who**: `DatabaseService.withTenant` sets `app.user_id` and `app.client_id` next to
  `app.tenant_id`, from the request (`RequestActorInterceptor`, an AsyncLocalStorage store: the
  signed-in user and the `X-Client-Id` header). Outside a request (jobs) they are empty: "System".
- **Why not `audit_logs`**: the audit log has one row per action with the request body as `data`,
  no old value, and misses writes that don't go through those service calls (line changes'
  effect on the amount, imports, stage deletes moving deals). A field history needs old → new per
  field, written wherever the row changes, and indexed per record; the audit log stays what it is
  (a coarse record of business actions).
- **RLS**: tenant isolation as everywhere, and append-only: the policies allow SELECT and INSERT
  only, so the app can't rewrite history.
- `GET /api/crm/history?entityType=deal|company|contact&entityId=…&limit=50&offset=0` (any member),
  newest first, `{ entries, more }` (limit ≤ 200). Ids come with names (`oldLabel` / `newLabel`:
  stage, funnel, company, contact, owner); people are named only while they are members of the
  workspace, otherwise "Former member". History starts with this migration; older changes aren't
  known.
- UI (`components/ChangeHistory.tsx`): the deal's **History** card has **Activity | Changes**; the
  company and contact screens have a **Changes** card. Values are readable (stage names, amounts
  in the deal's currency, dates, "empty"), 30 at a time with **Show older changes**, and the list
  re-reads when the record changes.

### Optimistic concurrency (CD-20)

`PATCH` of a deal, company or contact takes `If-Match: "<updatedAt>"`, the version the client
edited. The database sets `updated_at` (`crm_touch_version` trigger): whole milliseconds, strictly
increasing per row, and the same moment as the history rows of that change.

- If the row is newer than the version, the update locks the row and looks in `record_changes` for
  changes after that version **to the fields this update sends**. A field someone changed since,
  to a value other than the one sent, is a conflict: 409 with `message` ("Ana changed this deal
  while you were editing. Your change to the title wasn't saved."), `conflicts` (field, current
  value and its name, who, when) and `current` (the record).
- Changes to other fields are merged (two people editing different fields don't conflict).
  Changes made earlier by the same browser tab (`X-Client-Id`) never conflict, so quick typing
  whose saves overlap is fine; another tab of the same user is told "You changed this deal in
  another window…".
- No `If-Match` (or `*`) keeps last-write-wins for API clients from before; a malformed one is 400.
- Field-level rather than "any change → 409", because the deal row changes all the time without
  anyone touching the fields being edited (a line changes the amount, logging a call sets
  `last_contact_at`, a move sets the stage), which would make most edits fail.
- The store keeps each record's version (`State.versions`) from its last load and sends it with
  every deal, company and contact edit. On a 409 the toast shows the message and the current
  value ("It now says “…”") and the workspace is reloaded, so the field shows it.

### Live updates (CD-20)

- **Database**: statement-level triggers on deals, companies, contacts, deal contacts, deal lines,
  deal tasks (tasks and to-dos), activities, products, funnels and stages send `pg_notify` on
  channel `crm_changes` when the transaction commits: `{ t: tenant, type, op, ids, dealIds,
  client }`, one per statement and tenant, ids only (null when more than 50 rows changed, e.g. an
  import: "re-read the list"). A rolled-back change sends nothing.
- **API**: each API process holds one extra connection that LISTENs (`modules/realtime`) and hands
  each notification to the streams of that tenant only. `GET /api/events` (any member) is a
  Server-Sent Events stream: `ready`, then `change` events, a comment every 20 s (nginx closes
  idle proxied connections after 60 s, Cloudflare after 100 s) and `X-Accel-Buffering: no`. It
  ends when the token expires and when the user is no longer a member (checked every 30 s). If the
  LISTEN connection drops, it reconnects with backoff and sends `resync` to every stream. It works
  with several API processes because every process listens to the database, not to each other.
- **Authentication**: the browser reads the stream with `fetch`, not `EventSource`, so it sends
  the same `Authorization`, `X-Tenant-Id` and `X-Client-Id` headers as every other call. With
  EventSource the token would have to go in the URL (kept in proxy and access logs) or a
  short-lived stream token would need its own endpoint and expiry handling; fetch needs neither,
  and each reconnect picks up a refreshed OIDC token.
- **Browser**: the stream runs in a dedicated worker (`store/live.worker.ts`, `liveStream.ts`); the
  page answers its requests for headers. Off the page, the long-lived request doesn't keep the
  page "busy" for tools that wait for network idle (the e2e tests). It reconnects with backoff
  (1 s doubling to 30 s, with jitter) and shows nothing when the stream drops; after a reconnect,
  and when the window gets focus (at most every 10 s), it re-reads everything.
- **Merging** (`store.tsx`, live updates): a hint is skipped if this tab made the change; others
  are gathered for 300 ms, then only the lists they affect are re-read (`loadWorkspace(parts)`
  re-reads those and reuses the rest of the last load), and loaded timelines of the deals
  involved. Within a list, only the rows the hints name are read (CD-98): deals, companies,
  contacts and products by `?ids=`, deal lines and to-dos by `?dealIds=` (at most 200; the API
  returns only rows of the workspace that still exist). They replace their old copies in place
  (a row that didn't come back was deleted), and deals and products are sorted as the API sorts
  them. A hint without ids (over 50 rows changed), more than 200 ids, funnels and the checklist
  are read whole, as is everything after a reconnect or on focus. Like the reload after a failed save, it waits until this tab's own edits are saved
  (debounced typing is not sent early) and discards its result if an edit started while it loaded,
  so it never overwrites what someone is typing. An edit based on an older version is caught by
  the API (409 above).

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
- Deal products: the backend recalculates the deal amount when they are saved (CD-83). A product
  that is on a deal can't be deleted from the catalog.
- No made-up dates: a deal without a closing date has none (it only matches "Any closing date" on
  Overview), and a payment without a date is left out of "Funnel by payment due date" (the card
  says how many deals had payments left out). Payments are dated by the installments, or from each
  line's billing start date (CD-83).
- Stage to-dos: a playbook to-do gets a row on first touch, keyed by deal + stage + checklist item
  id (CD-32). A stage's checklist is `funnel_stages.checklist_items` (`[{ id, label }]`); renaming
  an item in the funnel builder keeps its id, so every deal keeps its tick, note and outcome, and
  the to-do rows take the new label. Labels must differ within a stage. Removing an item hides
  its to-dos; they aren't deleted. Off-playbook to-dos are rows of their own.
  - Item ids are the only key (CD-78): the labels-only `funnel_stages.checklist` column, the
    triggers that kept it in sync and the unique index on `deal_tasks (deal_id, stage_id, label)`
    were dropped in `drizzle/0021_onboarding_cleanup.sql`.
  - `PATCH /api/crm/funnels/:id/stages/:stageId` takes `checklistItems` (keep `id` to rename,
    leave it out for a new item). `PUT /api/crm/deals/:id/tasks/playbook` takes `checklistItemId`;
    a label alone is refused (400).
- Tasks from the **New task** dialog are `deal_tasks` rows too (off-playbook, `blocks_advance =
  false`) with a due date, a channel and an owner (`assignee_user_id`, which must be a member of the
  workspace). They show in Today (overdue / today / next up, with a done toggle) and on the lead's
  To-Do list, but don't count towards finishing a stage. Creating one logs "Task added" on the
  deal's timeline and deleting one logs "Task removed" (the timeline is history, so the first entry
  stays); ticking it off logs it like any completed to-do. The store keeps them in
  `leadTasks`; the other to-dos (`blocks_advance = true`) gate "Advance".
  - A task can take any of the seven channels (`CHANNELS`), labelled as on the timeline. Its
    title, owner, due date, channel and note can be edited (the same dialog, in edit mode, from
    Today or the deal screen; `PATCH /api/crm/deal-tasks/:id`); its deal and stage can't.
  - **Overdue**: not done and due before the workspace's today. Today lists them first, the
    sidebar's Today icon shows how many, and the deal screen highlights them. The funnel's own
    tasks (each deal's stage activity) have no due date, so they are never overdue.
  - **No next step**: an open deal with no open dated task gets that flag on its Pipeline card and
    deal screen (the flag opens the New task dialog). Stage to-dos don't count: a next step is a
    scheduled action, and the flag's tooltip says so (CD-76).

- Workspace settings (**Settings → Workspace**): name, currency (ISO 4217), time zone (IANA) and
  fiscal-year start month are columns on `tenants` (`GET/PATCH /api/workspace`). Every member reads
  them; only owners and admins change them (members see the fields disabled; the API returns 403).
  A rename updates the session, so the workspace switcher shows the new name.
  - **Currency**: a new deal takes the workspace currency unless `POST /api/crm/deals` names one
    (`deals.currency`); existing deals keep theirs when the workspace currency changes. The UI
    writes amounts with `Intl.NumberFormat` in the deal's currency (`money`, `curOf` in
    `store/selectors.ts`), in an English locale that fits the workspace currency (`en-IE` for EUR,
    `en-US` for USD, `en-GB` for GBP, …; `en-US` otherwise), so a euro workspace still reads
    "€14,000" and a CAD one writes USD as "US$". Totals are summed per currency and listed side by
    side, workspace currency first ("$14,000 + €2,500"), never added together (`moneyTotal`). There
    are no exchange rates. Products have no currency (CD-83, see below).
  - **Time zone**: "today" (Today, overdue, a new task's default due date, the closing-date
    filters) and the dates of timeline entries and completed to-dos use the workspace time zone,
    not the browser's (`todayIso(tz)`, `momentLabel`). Due dates and closing dates are calendar
    dates and aren't converted.
  - **Fiscal year**: Overview's "this quarter", "next quarter" and "this year" closing-date filters
    count from the fiscal-year start month (`closeRangeOf`). When it isn't January they read
    "Closing this fiscal quarter" / "… fiscal year" (`dateRangeLabel`); the stored filter value
    stays the same.
- Profile (**Profile settings**, `GET/PATCH /api/profile`, always the caller's own): name, job title,
  phone, language, date format and start page live on `users` and apply in every workspace. The
  default funnel and the notification settings (daily digest, deal assigned) live on
  `memberships`, because funnels and notifications belong to one workspace. A name set here wins over the name in the sign-in token
  (`users.display_name_custom`). The start page and the default funnel take effect (the app opens
  on them). Language and date format are only stored for now, and the UI says so; the digest is
  sent (see "Email").
  `memberships.default_funnel_id` has no foreign key (memberships has no RLS), so a trigger clears
  it when its funnel is deleted (0021), and the Profile screen shows "First funnel (…)" when there
  is none.
  Email and password belong to the sign-in provider and can't be changed here.
- Discovery notes on a deal (headline, need, constraint, decision maker, discovery date) are
  columns on `deals`. They are edited in the deal's **Discovery** card and merged into the proposal
  view, which shows fields that are still empty as bracketed gaps.

Still browser-only (seeded from `store/seed.ts`, lost on reload), because the backend doesn't have
them yet:
- integration settings (CD-79)

## Custom fields (CD-15)

Owners and admins define extra fields for deals, companies and contacts in **Settings → Customize
Fields**; everyone fills them in. Definitions live in `custom_field_defs` (tenant-scoped, RLS in
`drizzle/0014_custom_fields_bonus_rls.sql`): record type (`deal`, `company`, `contact`), label, type
(`text`, `number`, `date`, `select`, `checkbox`, `url`), options (select only, `[{ id, label }]`),
`required` and `position`. Labels are unique per record type among live fields (case-insensitive).

- **Values** are a `custom_fields jsonb` column on `deals`, `companies` and `contacts`, keyed by
  field id (`{ "<field id>": "PO-7", "<other id>": 12.5 }`). Why a column rather than a values table:
  a record and its values are read and written together (lists, record screens, exports), so they
  come with the row at no extra query or join, and a PATCH merges into the column in one statement
  (`custom_fields || new - cleared`). A values table would pay off for querying and indexing by
  value (filters, reports on custom fields), which nothing does yet; a GIN index on the column or a
  move to a table is the path if that comes.
- **Validation** (`CustomFieldsService.validate`): every create or update that sends `customFields`
  is checked against the live definitions: unknown or deleted field ids are 400; text ≤ 2,000
  characters, numbers finite, dates `YYYY-MM-DD`, checkboxes true/false, URLs http(s) with a host
  (a missing `https://` is added), select values an option id (an option label is accepted and
  stored as its id). `null` or `''` clears a value. The PATCH merges: fields not sent are kept.
- **Required**: a required field can't be cleared once it has a value (400). A create that sends
  `customFields` (the New deal and New contact forms do) must fill every required field of that
  record type; creates that don't send any (quick "Add company", the New deal dialog's inline new
  company, the CSV import, other API clients) still work and leave the field empty, and the record
  shows the field marked with `*`. Enforcing it everywhere would make every record source
  (import, quick add) know every field first.
- **Renaming** a field or an option keeps the values (they are stored by id). An option still used
  by a record can't be removed (409, with the count); the type of a field can't change.
- **Deleting** is soft (`deleted_at`): the field disappears from the screens, forms and exports, its
  name can be reused, and writes to it are refused (400). The values stay in the records, unseen.
  The UI asks first and says exactly that.
- Endpoints: `GET /api/crm/custom-fields[?entity=]` (members too), `POST /api/crm/custom-fields`,
  `PATCH /api/crm/custom-fields/:id` (label, options, required), `PUT /api/crm/custom-fields/order`
  (`{ entity, fieldIds }`, every live field once), `DELETE /api/crm/custom-fields/:id`; all but the
  GET are owners and admins only (403 for members). At most 50 live fields per record type.
- UI: the fields show under the standard ones on the deal Summary, the company screen and the
  contact screen (saved as you type, `setCustomValue`), and in the New deal and New contact
  dialogs. Companies have no create dialog, so company fields are filled on the company screen.
  CSV **export** adds one column per live field (option labels, Yes/No, numbers as numbers).
  CSV **import** doesn't map columns to custom fields yet (a follow-up: the import field list is
  static and the row writers would need the definitions and a merge on update).

## Sales bonus rules (CD-17)

"Add the sales bonus rules in the workspace settings, so admin can only set it up or the manager
for their team. We don't want users to view it." There is no manager role yet, so owners and admins
only; a manager scoped to their team is a follow-up (it needs teams first).

- `sales_bonus_rules` (tenant, user, `rate` %, `floor` = minimum deal, `fixed` = flat amount under
  the minimum) and `sales_bonus_settings` (one row per tenant: `trigger`, "On contract signed" or
  "When fully billed"), both with RLS. Amounts are in the workspace currency.
- `GET /api/crm/bonus-rules` → `{ trigger, rules }`, `PATCH /api/crm/bonus-rules` `{ trigger }`,
  `PUT /api/crm/bonus-rules/:userId` `{ rate, floor, fixed }` (the user must be a member),
  `DELETE /api/crm/bonus-rules/:userId`. The whole controller requires the admin role, reading
  included, so members get 403 and never receive a rule. Nothing about bonuses is on
  `GET /api/workspace` (which members read).
- UI: **Settings → Sales bonuses** (owners and admins; the tab and its route don't exist for
  members) holds the trigger and a rate / minimum / flat amount per active member, saved as you
  type. Overview's **Sales bonuses** card is shown to owners and admins only, read-only, with a link
  to the tab; it computes earned and pending bonuses in the browser from the stored rules, grouped
  by the deal's `ownerId` (CD-30). The store doesn't even ask for the rules as a member
  (`remote.ts` treats the 403 as "no rules").
- A deal in another currency than the workspace's gets the rate only: the minimum and the flat
  amount are in the workspace currency and there are no exchange rates.
- Members can still read deals and their owners (as before), so a determined member could apply a
  rate they know; what is protected is the rules and the bonus figures.

## Products, deal products and currency (CD-83)

Replaces the CD-77 model (products with a currency of their own, payment schedules and
milestones on lines); `drizzle/0022_products_deal_billing.sql` converts existing data.

- **Currencies**: the workspace has one main currency, picked when the owner creates the workspace
  (`POST /api/tenants { name, currency }`) and used for reporting. Each deal has its own
  (`deals.currency`). **Products have no currency**: a deal reads their prices in its currency, so
  any product fits any deal and changing a deal's currency keeps the numbers (no exchange rates).
- **Products** (`products`): name, description, unit ("hour", "seat"), unit price, default
  quantity (the product's price is unit price × quantity), tax rate, billing frequency
  (`one_time`, `weekly`, `monthly`, `quarterly`, `annually`) and, when recurring, billing cycles
  (a number, or null for "renew until canceled"; one-time products have none, a check constraint
  keeps that). The Products screen lists them; a row opens the product dialog, which also adds
  new ones. A product on a deal can't be deleted.
- **Deal products** are saved as a whole by the deal's products dialog:
  `PUT /api/crm/deals/:id/products { currency?, taxMode, lines, discounts, installments }`
  (`deal-lines.service.ts`). Lines keep their ids (sent back unchanged are updated, new ones are
  inserted, missing ones deleted), so the change history shows only what changed. A line has the
  product, description, billing start date, quantity, unit price, a discount (percent or amount),
  tax rate, billing frequency and cycles.
- **Tax mode** (`deals.tax_mode`): the prices on the deal exclude tax, include it, or have none.
- **Deal discounts** (`deals.discounts`, jsonb `[{ id, label, kind, value }]`) apply to the
  one-time products only, spread over them proportionally.
- **Installments** (`deals.installments`, jsonb `[{ id, description, date, amount }]`) split the
  one-time products into dated payments. A deal with installments can't have recurring products
  (400, both in the API and in the dialog). The dialog warns when they don't add up to the one-time
  products with tax.
- **Money** (`deals/deal-value.ts` in the API, the same rules in `store/dealMath.ts`): a line bills
  quantity × unit price less its discount per cycle; one-time lines once, recurring ones for their
  cycles, "until canceled" counts one year of cycles. The **deal value** (`deals.amount`) is the
  contract value without tax, recalculated on every save. MRR, ARR and ACV (the first year) come
  from the same numbers.
- **Payments** (Overview's "Funnel by payment due date", "When fully billed" bonuses, the proposal
  preview): a deal's installments when it has them, otherwise each line's billings from its
  billing start date (`billingDates`). Payments without a date are left out and counted.
- **Documents**: `{{line.schedule}}` is the billing ("Monthly, 4 cycles"), `{{line.description}}`,
  `{{line.discount}}` and `{{deal.discount}}` are new, and `{{deal.total}}` is labelled
  "Total with tax".

## Header, command palette and record pages (CD-80)

- **Header** (`Screen` in `components/Layout.tsx`): the screen's name on the left ("Companies /
  Company" on a record, the parent is a link), search and the "+" menu in the middle,
  notifications and the account menu on the right; the same on every screen, Settings included.
  Records show their own name in the page, never in the header. The list screens no longer have
  their own search box or "New …" button (empty states still offer one).
- **Command palette** (`components/CommandPalette.tsx`): Ctrl K / ⌘K from anywhere, or a click on
  the header search. It searches deals, companies and contacts in the loaded workspace
  (`store/search.ts`) and the app's actions (`components/commands.ts`): create a deal, contact,
  company, task or product, go to a screen, or open a setting. Arrows move, Enter runs, Escape
  closes.
- **"+" menu** (`components/NewMenu.tsx`): the same create actions, each with a letter that runs
  it while the menu is open (D deal, P contact, O company, T task, R product). On a deal's screen a
  new task or contact is for that deal.
- **Notifications**: the bell lists your own open tasks that are overdue or due today (nothing
  else is made up); the account menu has Personal preferences, Workspace settings, Team and Sign
  out. The sidebar no longer has Settings and the avatar (on phones they stay under "More").
- **Company and contact pages** look like the deal page: a record header (name, owner, "+ Deal",
  which opens the New deal dialog with this company or contact, and a menu with Delete for owners
  and admins), on the left Summary and Details with icons, Deals (open ones, won and lost with
  their share and value), the company's contacts or the contact's company and documents; on the
  right Focus (open tasks on their deals) and History (activity on their deals, and changes).
  Companies and contacts can now be handed to another owner there.
- The company's **Domain** and **Notes** and the contact's **LinkedIn** (CD-209) edit in place there
  like the other fields (saved after a pause, with If-Match). A domain such as `acme.com`, or a
  LinkedIn value that is a web address (`linkedin.com/in/…` or http(s)), gets an **Open** link next
  to the field, like Email and Call; other text stays plain. Only http(s) links are made.

## Deal page (CD-83)

- The header shows the funnel and stage ("SMB → Proposal"), the deal name (editable), the owner,
  **Won** (moves the deal to the funnel's won stage) and **Lost**, a menu with **Delete deal**
  (owners and admins), and the stage bar: stages as chevrons, the current one with its days in
  the stage; clicking a stage moves the deal there. The screen title is "Deal", not the name.
- On the side: **Summary** (icons instead of labels, the deal value first with a "+ Products" or
  "N products" link and ACV, ARR and MRR), **Company**, **Products** (each product with its
  quantity, amount and billing, the installments when there are any, and a pencil to open the
  products dialog), **Discovery** and **Fit score**. The activity composer no longer has a
  Products tab.

## Onboarding after sign-up (CD-115)

After the first sign-up (email or Google), a new user goes through onboarding before the app
(`components/Onboarding.tsx`, shown by `SessionGate`). Returning users go straight to the app.

| Step | Who | Fields | Can be skipped |
|---|---|---|---|
| 1. **Workspace** | everyone | Join a workspace an invitation waits for, **or** create one: name (required, ≤100), main currency (required, EUR by default), time zone (required, the browser's by default) | no |
| 2. **About you** | everyone | Full name (required, the sign-in's name by default), job title (optional) | no |
| 3. **Invite your team** | whoever created the workspace (owners) | Up to 10 email addresses, each Member or Admin | yes, "Skip for now" |

- **Saved progress.** `users.onboarding_steps` lists the finished stored steps (`profile`, `team`);
  the workspace step is done once the user has a membership. A refresh or a new session resumes at
  the first unfinished step. When every step that applies is done, `users.onboarded_at` is set and
  onboarding never comes back (not for a second workspace either). The migration
  (`drizzle/0026_user_onboarding.sql`) marks everyone who already had a workspace as onboarded.
- `GET /api/me` carries `onboarding` (`required`, `steps` with `done` and `skippable`,
  `invitations`); `GET /api/me/onboarding` returns the same. `PUT /api/me/onboarding/profile`
  `{ name, jobTitle? }` saves "About you"; `POST /api/me/onboarding/team` finishes or skips the team
  step (the invitations themselves go through `POST /api/team/invitations`). `POST /api/tenants`
  takes an optional `timezone`.
- **Invited users join, they don't duplicate.** An invite link is remembered for the tab and
  handled first ("Join <workspace>"). Without the link (the sign-up confirmation email opens in
  another tab), onboarding lists the invitations still pending for the user's email address:
  `POST /api/me/invitations/:id/accept` joins one, with the same rules as the link (the signed-in
  email must be the invited one; someone else's invitation id is 404). Creating a separate
  workspace stays possible behind "Create a new workspace instead". Invited users don't get the
  team step; after "About you" they land in the workspace they joined.
- Someone onboarded who later has no workspace left (they left it) sees only the workspace step.

## First-run onboarding (CD-68)

Owners and admins of a workspace see a getting-started checklist above the main screens
(`components/GettingStarted.tsx`), backed by `OnboardingService` in the CRM module
(`modules/crm/onboarding/`). All routes are `@RequireTenant('admin')`:

- `GET /api/onboarding` returns the workspace's four activation steps (CD-115), each derived from
  the workspace's own records, never stored: **invite** (another member, or an invitation that
  isn't revoked), **records** (at least one contact, company, product and deal that isn't sample
  data; `items` says which of the four are there, and the checklist links to the first missing
  one), **template** (a document template was uploaded) and **funnel** (any `funnel.*` action in
  `audit_logs`, i.e. someone changed the playbook). It also returns `dismissed` and the
  sample-data counts.
- `PUT /api/onboarding/dismissed` `{ dismissed }` hides or shows the checklist. Dismissal is stored
  per user (`memberships.onboarding_dismissed_at`), not per workspace: each owner or admin finishes
  or hides their own checklist without hiding it for the others. It also disappears once every
  step is done. Settings → Workspace can show it again.
- `POST /api/onboarding/sample-data` creates, in one transaction, 4 companies, 5 contacts,
  3 products and 6 deals (with lines, an extra contact, stage history, timeline entries and 4
  dated tasks: one overdue, one today, two ahead) in the first funnel, owned by the caller
  (`sample-data.ts`). Amounts come from the lines; there are no figures of its own, so Overview
  measures them like any deals. Dates follow the workspace time zone. Loading twice is refused (409).
- `DELETE /api/onboarding/sample-data` deletes exactly those records. Each one is listed in
  `sample_records (tenant_id, kind, record_id)`, an RLS table, so the CRM tables need no flag.
  Deals go first (their lines, tasks, activities and history cascade); a sample company, contact
  or product that a real record now uses is kept and becomes an ordinary record (the response
  counts `removed` and `kept`). A per-workspace advisory lock serializes load and remove.

Each main screen (Pipeline, which is also the deals list, Companies, Contacts, Products, Today,
Overview) shows an empty state with the one action that fills it (`components/EmptyState.tsx`),
plus "Or load sample data" for owners and admins. A filter that matches nothing says so in the
table instead.

## Phones and tablets (CD-70)

Media queries at the end of `styles/global.css` (≤1024px and ≤700px) adapt the desktop styles;
the desktop layout is unchanged. On phones the sidebar becomes a bottom bar with Pipeline, Today,
Companies, Contacts and **More** (a sheet with Overview, Products, Settings, Profile and the
workspace switch). The header puts the title on its own row and keeps search and "New…" full
width. Filter bars wrap two per row; tables scroll sideways inside their card; the pipeline board
scrolls with snapping columns; dialogs are bottom sheets with their buttons always visible. On a
deal, the composer and to-dos come before the details, and the stage line names only the current
stage. Contacts have one-tap `mailto:` and `tel:` links (only for a real address or number). The
page itself never scrolls sideways at 390px or 768px (`e2e/tests/phone.test.mjs`).
