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
    people/                     employees, departments, teams, functional roles, PeopleAccess (milestone 13)
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
CSV; employees (CD-141) use the same pipeline from the people module (see "People", "Import from
Excel and CSV"). The parts every type shares live in `shared/import/` (`csv.ts`; `import-file.ts`:
the mapping schema, limits, `prepareImport`, header matching, templates, failure reasons). It has no table
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

- **Parsing** (`shared/import/csv.ts`, no dependency): UTF-8, header row, comma or semicolon (whichever the first
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
- **The user's email** (CD-222): Auth0's access tokens carry no `email`, so a Google user's address
  comes from the **ID token** of the token endpoint's answer (scope `openid profile email`, sent for
  the password grant and Google alike; `SessionTokens.identity`, decoded without a signature check
  because it comes straight from the token endpoint over TLS; an address marked
  `email_verified: false` is left out). `SessionCookies.start` saves it on every sign-in **and every
  renewal** (`IdentityService.rememberProfile`), so accounts made before get their address on their
  next sign-in or refresh; Profile, Team and the external minutes' Reply-To read `users.email`. An
  address another account already has is never taken (the one-account rule above), and saving
  never makes a sign-in fail. An access token that does carry the address (`email`, or a namespaced
  claim like `https://pultly.com/email` from an Auth0 Action) fills it in too, on any API call.
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
- **Functional roles on the invitation** (CD-224): the invite dialog has optional "Administration"
  and "Payroll" checkboxes (`roles` in the request, kept in `invitations.assigned_roles`, a checked
  `text[]`). When the invitation is accepted and the new member's employee record is linked,
  identity calls people's `grantInvitedRoles` (through its index) in the same transaction: the
  record gets the roles in the inviting Admin's name (history row field `roles`, audit
  `employee.role_granted`), without the "Role granted" email. Only Admins invite, and Admins are
  the ones who assign these roles (row `org.roles`). Someone who was already a member keeps their roles.
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
`index.ts` (`CrmWorkerModule`, `IdentityWorkerModule`, `NotificationsWorkerModule`).

| Job | Sent by | Handled by |
|---|---|---|
| `crm.deal-won` | CRM, deal enters the won stage | worker placeholder (future projects handover) |
| `crm.deal-assigned` | CRM, someone else becomes a deal's owner (create or change) | notifications: "deal assigned to you" email |
| `crm.meeting-invite` | CRM, someone else adds a member to a planned meeting, or moves, cancels or restores one (one job per member) | CRM worker (`CrmWorkerModule`): the meeting email with an .ics |
| `crm.meeting-minutes-email` | CRM, someone sends a meeting's external minutes, or retries the failed recipients | CRM worker: one email to the send's queued recipients, status per recipient |
| `identity.member-removed` | identity, a member is removed or leaves | CRM worker: off future planned meetings, "Organizer left" where they organized |
| `crm.visit-plan-email` | CRM, someone else creates or changes a salesperson's visit plan (CD-134) | notifications: "your visit plan" email |
| `identity.invitation-email` | identity, invitation created or resent | identity: the invitation email |
| `people.bank-account-changed-email` | people, an employee's IBAN added, changed or removed | people worker (`PeopleWorkerModule`): "Bank account changed" |
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

A message may carry text attachments (`attachments: [{ filename, contentType, content }]`, CD-131,
used for the meeting .ics): the smtp driver hands them to nodemailer; the log driver logs their
names and keeps them, content included, in memory and the outbox, so tests can read them.
A message may also go to several addresses (`to: string[]`), copy people (`cc`), name a
`replyTo`, and carry a `fromName` shown with the `MAIL_FROM` address (CD-133). `send` returns
`{ rejected }`, the addresses the server refused while the others got it; `/api/dev/mail?to=`
matches To and Cc.

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
- **Meeting invitations** (`memberships.notify_meeting_invites`, on by default, CD-207): the email
  with an .ics when someone else adds you to a meeting, or changes or cancels one you're in.
- **Visit plans** (`memberships.notify_visit_plans`, on by default, CD-207): the email when someone
  else creates or changes your visit plan.

The API names them `dailyDigest`, `notifyDealAssigned`, `notifyMeetingInvites` and
`notifyVisitPlans`; the store's `s.profile` calls them `digest`, `dealAssigned`, `meetingInvites`
and `visitPlans`. The tab lists only what is actually sent (the "Coming soon" rows were removed in
CD-207). The old browser-only "Stalled lead nudges" and "Task reminders" became the digest.

### Daily digest

Every 15 minutes `notifications.digest-tick` looks at each workspace's clock (its time zone,
CD-73). Between 8:00 and 11:59 local time it queues `notifications.daily-digest` for each member
with the digest on and an email address, unless `daily_digests` already has a row for them and
that local date. The window lets a worker that was down at 8:00 catch up, without sending a
"morning" email in the afternoon. The digest job claims the day (a new row, or a failed one being
retried), loads the digest inside `withTenant` and:

- sends it when it has something: the member's tasks that aren't done and are due before today
  (overdue) or today, by the workspace's date, on deals that aren't lost; their open deals
  (not won, not lost) with no open task from the "New task" dialog and no planned meeting still
  ahead, i.e. the Pipeline's "No next step" flag; the meetings starting today that they organize
  or take part in (planned or held, CD-130); the planned meetings they organize that ended
  more than 24 hours ago ("Not closed"); and the held meetings they organize that started in the
  last 7 days and have no summary in their internal minutes ("Minutes missing", CD-132). Each section lists up to 20 items linking to
  `/deals/<id>` or `/meetings/<id>`;
- records `skipped` without sending when all sections are empty;
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

## Visit plans (CD-134)

A visit plan says how many customer visits one salesperson should make to which companies in one
month. Plans are **monthly only** (CD-212): a fiscal quarter's progress is the sum of its three
monthly plans (see "Monthly plans, quarters add up" below). Counting the visits actually held is
"Visit plan tracking (CD-135)" below.

- **Tables** (crm module, RLS in `drizzle/0032_visit_plans_rls.sql`): `visit_plans` (salesperson,
  `period_type` `month`|`quarter`, `period_start` = first day, `period_end` = first day after,
  note ≤ 2,000) with unique (tenant, salesperson, period type, period start); `visit_plan_lines`
  (plan → cascade, company, `planned_visits` 1–99, unique per plan and company). The company FK
  has no cascade: deleting a company that is in a plan is refused with 409 ("… is in 1 visit
  plan. Remove it from the plans first."), like a company with deals; "Remove sample data" keeps
  such a company.
- **Periods** (`visit-plans/periods.ts`, pure, unit-tested; the frontend has the same rules in
  `store/visitPlans.ts`): a quarter starts 0, 3, 6 or 9 months after `tenants.fiscal_year_start_month`
  and the fiscal year is named after the calendar year it ends in. Labels: "October 2026";
  "Q4 2026" for a January fiscal year, else "Q1 FY2027 (Oct–Dec 2026)". A `periodStart` that isn't
  the first day of a period is 400. Plans keep their stored dates when the fiscal year setting
  changes later (their label then reads by months, "Oct–Dec 2026").
- **API** (`/api/crm/visit-plans`): `GET ?periodType=&periodStart=&salespersonUserId=&ids=` →
  `{ plans }` (with lines, company names, `totalPlanned`, `periodLabel`, `canEdit`), `GET /:id`,
  `POST`, `PATCH /:id` (`lines` replaces the lines, matched by company; If-Match like deals) and
  `DELETE /:id` (meetings are never touched). Who sees and changes which plans follows the permission
  matrix (CD-142, `visit-plans/visit-scope.ts`, rows `crm.visit_plans.*`): owners and admins all;
  managers see their own plans and their reports' at any depth (list, progress, report rows, Overview
  summary) and create, change and delete only their **direct** reports' (not their own);
  everyone else (Administration and Payroll included) sees only their own, read-only. A plan the
  caller may not see is 404 (also its history), one they see but may not change is 403.
  `GET /scope` → `{ all, manageAll, seesTeam, visibleUserIds, manageableUserIds }` (null = everyone)
  for the store (`s.visitScope`: "New plan", the salesperson picker, Reports in the sidebar);
  reporting lines come from PeopleAccess (`directReportUserIds`, `reportUserIds`), so reports
  without an account have no plans. A second
  plan for the same person and period is 409 ("Mia already has a plan for October 2026…");
  duplicate companies in `lines`, numbers outside 1–99, no lines, unknown companies and a
  salesperson who isn't a member are 400.
- **History and live updates**: `record_changes` rows with `entity_type = 'visit_plan'`
  (salesperson, period type, period start, note; lines as `line_added` / `line_changed` /
  `line_removed` labelled with the company's name, like deal lines). Both tables send `crm_changes`
  hints of type `visit_plan` whose ids are plan ids (lines report their plan), and the store
  re-reads those plans (`?ids=`). Saving lines touches the plan, so its version moves.
- **Email**: when someone other than the salesperson creates a plan, changes it, or hands it to
  another salesperson, `VisitPlansService` queues `crm.visit-plan-email` in the same transaction.
  The notifications worker sends "Your visit plan for October 2026" (or "… was changed") with the
  customers, numbers, note and a link to `/visit-plans/<id>` (`notifications/visit-plan-email.ts`).
  It reads the salesperson's `memberships.notify_visit_plans` (CD-207) when sending and skips
  deleted plans and plans that are now the actor's own.
- **UI**: sidebar "Visit plans" (after Today and Calendar), `/visit-plans` (list with period and,
  for owners and admins, salesperson filters; "New plan") and `/visit-plans/:id` (customers with
  planned visits, edited in place by owners and admins and saved as you go; "Copy to next period";
  Delete; note; History). "New plan" (salesperson, month, customers, note; no period type since
  CD-212) has "Copy from previous period": the same salesperson's plan for the month before fills
  the customers, which can be changed before saving.
  "Schedule visit" opens New meeting prefilled with the company, Customer visit and the salesperson
  as organizer (`meetings.openDialog`). The store keeps the plans in
  `s.visitPlans` (loaded with the workspace).

### Visit plan tracking (CD-135)

Planned vs. held Customer visits. Every number (plan page, list, Reports, the Overview card, the
company card, both CSV exports and the daily digest) comes from **one pure function**,
`countVisits(plan, meetings, now, timeZone)` in `crm/visit-plans/visit-counting.ts`, unit-tested in
`test/visit-counting.spec.ts` (period edges in Belgrade and New York, DST, statuses, capping,
unplanned, shared visits).

- **Rules** (spec 9.1 with the Q5 decision): only `type = 'visit'`; cancelled never counts. A visit
  counts for **one** salesperson (`creditedSalesperson`): the deal's owner when that owner is the
  organizer or an internal participant, else the organizer (also for an old meeting without a deal,
  CD-213) (nobody when
  the organizer left and the deal owner wasn't there). It belongs to the period when its start date
  on the workspace clock is in [`period_start`, `period_end`). Held = status held; upcoming =
  planned and starting after now; not closed = planned and ended over 24 hours ago (a planned visit
  in between is neither). Its line is the meeting's company; held visits at other companies are
  "unplanned" and don't count. Per line `heldCapped = min(held, planned)`, `overPlan = held −
  heldCapped`; plan completion = Σ heldCapped / Σ planned. `expectedPace` is the share of the
  period passed (0 before, 1 after; by the zone's midnights, `zonedDayStart` in
  `shared/time/zoned-time.ts`); `pace` is `done` (100%), `notStarted`, `behind` (completion below
  pace) or `onTrack`. The UI colours them green, grey, amber, plain.
- **Loading** (`visit-progress.service.ts`): `progressOfPlans(tx, plans, timeZone, now)` reads the
  lines of all the plans in one query and the visits of all their periods in another (planned and
  held visits starting between the periods' zone midnights, with the deal owner and the internal
  participants as an array subquery; uses `meetings_tenant_starts_idx`), then counts each plan. No
  migration: the existing indexes cover it.
- **API** (`/api/crm/visit-plans`, before `/:id`): `GET /:id/progress` (visibility as the plan:
  members only their own, else 404) → per line planned, held, heldCapped, upcoming, notClosed,
  overPlan, completion and the meeting ids behind each number; `unplanned`; `totals`; and
  `meetings` (title, start, status of those ids). `GET /progress?ids=` → `{ progress: [{ planId,
  totals }] }` for the list (others' plans left out for members). `GET /report?periodType=
  &periodStart=&salespersonUserId=&companyId=` (owners, admins and managers, CD-142, who get only
  their own and their reports' rows; 403 for other members) → one row per
  salesperson with a plan for the period plus anyone credited with held visits there without one
  (`planId: null`, all unplanned), and `totals` (Σ capped / Σ planned again). With `companyId`
  each row is only that customer, so it shows how often it was visited across salespeople. Every
  row, the totals and the summary carry `meetingIds: { held, upcoming, notClosed, unplanned }`,
  the meetings behind each number (CD-211).
  `GET /progress-summary?periodType=&periodStart=[&salespersonUserId=|&all=1][&companyId=]` sums
  the plans of the period for the Overview card (members always get their own, whatever they ask;
  managers their team: themselves and their reports, CD-142)
  and, with `companyId`, for the company card. A missing `periodStart` means the current period
  on the workspace clock; one that doesn't start a period is 400.
- **Live**: the store's `s.visitRev` goes up on every `meeting` and `visit_plan` hint (this tab's own
  included) and on resync; `useVisitProgress(key, load)` (`store/useVisitProgress.ts`) reloads the
  numbers on screen 400 ms later, so marking a visit held updates every viewer without a reload.
- **UI**: the list shows held (capped, "+N" over plan) and completion with its pace colour; the plan
  page shows per customer held / upcoming / not closed (each number opens the meetings behind it,
  with "Open in Calendar"), "+N over plan", totals, completion, "Unplanned visits", and "Export
  CSV" for owners and admins. **Reports** (`/reports/visit-plans`, sidebar item after Products for
  owners and admins; members are sent to `/`) has the tab "Visit-plan completion": filters plan
  period (month/quarter and period), salesperson and customer in the URL, the table per spec 9.2,
  counts (held, upcoming, not closed, unplanned; rows and totals) linking to the Calendar table
  with exactly the meetings behind them (`ids=`, CD-211; see Calendar), plan links, and CSV export
  (`lib/csv.ts`: BOM, formula guard). Overview has a "Visit-plan progress" card with its own month/quarter
  selector (members: their own, "Open my plan"; owners and admins: the team or one salesperson,
  "Open the report" with the same choice). The company page's Meetings card says "Visits this
  month: held / planned" (held uncapped) when the company is in a plan of this month, and "Visits
  this quarter" when it is in a monthly plan of this fiscal quarter, summed over every plan the
  viewer can see (all for owners and admins, their own for members).
- **Daily digest**: `DigestService` counts the member's plan for this month, and this fiscal
  quarter as the sum of its monthly plans (`planGroupsOf` + `progressOfGroups`), and adds "Visit
  plan progress": "Visits planned this period (October 2026): N of M held" (N = held counted toward
  the plan). The section never makes the digest go out on its own.

### Monthly plans, quarters add up (CD-212)

Nobody makes quarterly plans any more: a quarter is tracked as the sum of its three months.

- **Writes**: `POST /visit-plans` makes a monthly plan (`periodType` may be left out; `'quarter'` is
  400 "Visit plans are monthly. A quarter's progress is the sum of its three monthly plans.").
  `PATCH` refuses `periodType: 'quarter'`, and refuses any change to a quarterly plan saved before
  (400, `QUARTERLY_READ_ONLY`); those stay readable (their page shows a note, no editing, no "Copy
  to next period") and can be deleted. No migration: the column and its values stay.
- **Counting a period** (`visit-progress.service.ts`): `planGroupsOf(tx, period, salesperson?)`
  gives one group per salesperson: for a month, their monthly plan; for a fiscal quarter, their
  monthly plans starting in it. Old quarterly plans are left out of Reports, Overview and the
  company card. `progressOfGroups` sums each group's lines per company (planned visits added up)
  and counts them with `countVisits` over the whole quarter: held, upcoming and not closed across
  the three months, completion capped per company at the quarter's sum (so a third visit in
  November counts toward a customer planned once in October and twice in November).
  `progressOfPlans` is the one-plan case (plan pages, the list).
- **API shape**: report rows carry `plans: [{ id, periodStart, periodLabel }]` (one for a month, up
  to three for a quarter; `planId` is the first) and the summary's `plans` list the monthly plans
  with their month. Reports and the Overview card keep their Month / Quarter choice; a quarter
  row links each of its months and names the months without a plan ("Oct Nov · no December plan",
  CD-224), so a quarter total that is missing a month doesn't look complete.
- **Pace tooltip** (CD-224): the completion badge's title says the expected pace in visits:
  "Behind pace: 3 of 5 visits expected by today, 1 held (60% of the period has passed)", where the
  expected number is the plan times the share of the period passed, rounded down
  (`expectedVisits`, `store/visitPlans.ts`).
- **New plan dialog** (CD-224): a wrong number marks its own row ("A whole number from 1 to 99",
  after leaving the field or saving; 100 is shown as an error, not cut to 10) and the save error
  names the customer; a customer search with no match offers "Clear search"; with one member to
  plan for, they are preselected; the month list reaches 12 months ahead.

## Working together: live updates, conflicts, change history

### Change history (CD-69)

`record_changes` has one row per changed field of a deal, company, contact or meeting (CD-130, see
"Meetings"): `entity_type`,
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
  deal tasks (tasks and to-dos), activities, products, funnels and stages, meetings and their
  participants (CD-130) send `pg_notify` on
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

- Screens are code split (`lazy` in `App.tsx`). A tab opened before a deploy still asks for the old
  chunk file names, which the new build doesn't have (CD-220). `lib/chunks.ts` (`loadChunk`) then
  reloads the page once, at most once a minute per tab, so the new version loads. Anything still
  failing reaches `ScreenErrorBoundary`, which shows "A new version of Pultly is available" (or
  "This page could not be shown") with **Reload**, instead of a blank page.

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
  deal's timeline with the task's channel and deleting one logs "Task removed" (the timeline is history, so the first entry
  stays). **System entries** ("Deal created", "Moved to <stage>", "Moved to funnel", "Task
  removed", and "Task added" without a channel) have `activities.channel` null and show the badge
  "System", not "Research task" (CD-222; older rows were moved by `drizzle/0043_system_activities.sql`); ticking it off logs it like any completed to-do. The store keeps them in
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
  - **Customer email language** (`tenants.customer_email_language`, `'en'` or `'sr'`, default
    `'en'`, CD-208): the language of the fixed text (footer, "sent by …", reply hint) in emails that
    go to customers, today only the external meeting minutes. Internal emails stay in English.
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
  on them). Language and date format are only stored for now and not shown (CD-223); the digest is
  sent (see "Email").
  `memberships.default_funnel_id` has no foreign key (memberships has no RLS), so a trigger clears
  it when its funnel is deleted (0021), and the Profile screen shows "First funnel (…)" when there
  is none.
  Email and password belong to the sign-in provider and can't be changed here.
- Discovery notes on a deal (headline, need, constraint, decision maker, discovery date) are
  columns on `deals`. They are edited in the deal's **Discovery** card and merged into the proposal
  view, which shows fields that are still empty as bracketed gaps.

Settings has no Integrations or Billing tab: both were placeholders that saved nothing and were
removed in CD-207 (`/settings/integrations` and `/settings/billing` go to Settings like any unknown
tab). They come back when a real integration (CD-79) or billing exists.

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

CD-224 additions: the "+" menu has **Employee** (key E) for workspace owners and admins, and for
Administration once the people access is loaded; it opens `/org?new=employee`, where the Org page
opens Add employee (and drops the parameter). Contact pages are addressed by the backend contact id:
`openContact` resolves a person id ("<deal id>:p" for a deal's primary contact) to it, and an old
`/contacts/<deal id>:p` link redirects. Company **Domain** and contact **LinkedIn** are checked when
the field is left (`components/ui.tsx` `CheckedInput`, `lib/validate.ts`): a domain is a host name
(letters, digits, hyphens, dots, a top-level domain; a pasted address keeps only its host, "Saved as
acme.com"), LinkedIn is a linkedin.com address or a profile path ("in/ana" is saved as
"linkedin.com/in/ana"); an invalid value shows an inline message and is not saved. The Org page's
empty states point to the next step: "Add employee" and "Import" when nobody is there, "Clear
filters" when the filters hide everyone, and "Add department" on the department chart and in the
empty Department filter (opens Departments & teams with the new department's form). The deal
composer's WhatsApp and LinkedIn tabs are commented out until those integrations exist.

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
  else is made up); the account menu has Personal preferences, Workspace settings and Sign
  out (Team is a tab of the workspace settings, CD-223). The avatar is not in the sidebar; Settings
  is back at its bottom (CD-223; on phones both are under "More").
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

## Module and workspace switcher (CD-214)

The button under the Pultly mark in the sidebar (it shows the module you're in, CD-223) opens a
420px popover to its right (`components/ModuleSwitcher.tsx`, styles `.mod-*` in
`styles/header.css`); ⌘J / Ctrl J opens it from anywhere. The mark itself links home (`/`, your
start page). It replaces the workspace-only switcher of CD-23.

- **Modules** (`components/modules.ts`, one list, CD-223): Planning, CRM (`/pipeline`), Projects
  and Workforce (`/org`), in that order. Planning and Projects have no target, so they are locked
  with "Coming soon". The reason is a field (`LockReason`), so "Owners and admins" or "Not in your
  plan" can come with roles and plans. There is no Overview or Reporting module: both are CRM pages.
- **Workspaces**: with 2+ workspaces a row above the modules shows the current one ("Switch ›");
  with one, its name sits next to "Modules". Either opens the list: each workspace with its member
  count (`memberCount` in GET /me's `tenants`), the current one checked, and "New workspace".
  Switching and creating reuse the session's `switchTenant` / `createTenant`.
- Arrow keys move focus (two columns in the grid), every item has a focus ring, Escape or an
  outside click closes it and focus goes back to the switcher button. On phones it opens from
  "More" as a bottom sheet. Tested in `e2e/tests/module-switcher.test.mjs`.

### Modules as separate apps (CD-223)

Each module is its own app with its own sidebar (`Sidebar` in `components/Layout.tsx`): the Pultly
mark, the module switcher button (icon and name of the current module), the module's pages, and
Settings at the bottom, as in the Workforce design.

- **Pages per module** (`nav` in `modules.ts`): CRM has Overview, Pipeline, Today, Calendar, Visit
  plans, Companies, Contacts, Products and Reports (Reports only for owners, admins and managers who
  see their team, CD-142: `navFor`); Workforce has Org structure (Timesheets, Time off, Approvals,
  Utilisation later). Add a module's page there and it shows in the sidebar, the phone bar
  (`phone: true`) or its "More".
- **The current module** comes from the route (`screens` prefixes): meetings, deals, companies,
  contacts, products and reports are CRM; `/org` and employee cards (`/people/:id`) are Workforce.
  Settings and the profile belong to none and keep the last module, remembered per user in this
  browser (`localStorage` `crm.module.<userId>`, in try/catch; without storage it falls back to the
  CRM).
- **Desktop overflow**: `useFit` measures the nav's height (a `ResizeObserver`) and the item height;
  when not all pages fit, the ones that don't are hidden (`.nav-overflow`) and a "⋯ More" item
  (`SideMore`) opens a menu to the right with them (the phone sheet's look). It takes focus, arrow
  keys / Home / End move, Escape closes and gives focus back, a pick or an outside click closes it.
- **Command palette**: "Go to" covers every page of every module (Org structure, and Reports for
  those who see it), since the sidebar shows one module at a time.
- The account menu has no Team entry any more (it is a tab of the workspace settings), and the
  profile doesn't show Language and Date format until something applies them (the fields and the
  API stay).

## Meetings (CD-130)

`meetings` (crm module, `modules/crm/meetings/`) are meetings with a customer company: title,
type (`visit` Customer visit, `online`, `office` Meeting at our office, `phone`), `starts_at` /
`ends_at` (instants; `ends_at > starts_at` is a check), location, agenda, the company (required),
a deal of that company (required, CD-213, spec 4.2), the organizer and the status (`planned`,
`held`, `cancelled`, with `held_at`, `cancelled_at` and `cancel_reason`). `meeting_participants` has one row per member
(`internal`, `user_id`) or contact (`external`, `contact_id`), with the person's name (and the
contact's email) saved on the row. RLS, the foreign keys that null one column, the triggers and
the live-update hints are in `drizzle/0029_meetings_rls.sql`; the deal rules (CD-213) in
`drizzle/0037_meeting_deal_required.sql`.

- **Times** are stored as instants and shown in the workspace time zone. Timeline entries format
  them with `shared/time/zoned-time.ts` ("Tue 10 Nov 2026, 10:00–11:00", both days when a meeting
  crosses midnight), daylight saving included.
- **API** (`/api/crm/meetings`, any member): `GET ?from=&to=` returns the meetings overlapping
  `[from, to)` (a meeting crossing midnight is on both days), with `userId` (organizer or
  internal participant), `companyId`, `dealId`, `contactId` (external participant), `type` and
  `status` (comma lists), `notClosed=1`, `missingMinutes=1` (held without a summary in the
  internal minutes, CD-132), `ids=` (≤ 200, for live updates), `sort=asc|desc` by start, `limit` (≤ 1000, default
  500) and `offset`: `{ meetings, more }`. Without a period it needs one of companyId, dealId,
  contactId or ids. `GET/POST/PATCH /:id`, `POST /:id/held | cancel ({ reason? }) | undo-held |
  restore`, and `DELETE /:id` (owners and admins). A meeting comes with its company and deal
  names, the deal's owner, the organizer's name ("Organizer left" when null), its participants
  (`deleted` when the contact was deleted or the member left), `notClosed`, the internal minutes'
  status and version (`internalMinutes`, `minutesUpdatedAt`, CD-132), and the external minutes'
  delivery (`externalDelivery`, `sendsUpdatedAt`, CD-133).
- **Rules** (`meeting-rules.ts`, pure and unit-tested): owners, admins, the organizer and the
  internal participants change a meeting (403 otherwise); only owners and admins change its
  organizer on a PATCH (403 for members, spec 5.3; CD-211; the Edit dialog disables the field for
  them), while anyone creating a meeting may name another member as organizer; held only from the start time on and
  only when planned; cancel only when planned; "Undo held" (held → planned) and "Restore"
  (cancelled → planned); a cancelled meeting is read-only (409) until restored, a held one can be
  corrected. "Not closed" = planned and ended more than 24 hours ago.
- **Validation** (400): title 1–200, location ≤ 300, agenda ≤ 5,000 characters, end after start
  (also when a PATCH sends only one of them), an existing company, a deal of that company
  (required: "Pick a deal" without one; a PATCH can change it but never to null, and one that
  moves the meeting to another company must name a deal of that company too),
  organizer and internal participants who are members of the workspace, existing contacts.
  Duplicate people are dropped; the organizer is always an internal participant (the service
  adds them). `internalUserIds` / `externalContactIds` in a PATCH replace the sets; rows of
  deleted contacts and former members are kept.
- **Deal required** (CD-213): the check `meetings_deal_required` (`deal_id is not null`) is added
  `NOT VALID`, so it holds for every new and changed row while meetings saved without a deal
  before (staging) stay readable: they show "No deal", the Edit dialog asks for one, and any change
  to such a row (an edit, held, cancel) is refused until it has one (400 "Pick a deal", also from
  `mapDbError`). Code that reads meetings stays null-safe for them (left joins to deals, visit
  counting credits their organizer, the member-removed job leaves them alone).
- **UI**: the meeting form (dialog and the deal's Composer) requires the deal: the company's
  deals, open ones first (won and lost ones can be picked too), picked for you when the company
  has exactly one open deal. A company without deals shows "This company has no deals yet" with
  **+ New deal**: the New deal dialog for that company (`s.newLeadForMeeting`, above the meeting
  dialog, company fixed); creating it stays on the meeting, which picks the new deal
  (`s.newLeadMade`). Every entry point (calendar, "+" menu and command palette, company and contact
  cards, Composer, "Schedule visit") uses this form.
- **Deal timeline**, in the same transaction: creating writes "Meeting
  scheduled · <title>" (MT) with the time and place, marking as held "Meeting held · <title>" at
  the meeting's start and moves the deal's last contact there (never back in time,
  `ActivitiesService.record`), cancelling "Meeting cancelled · <title>" with the reason, restoring
  "Meeting restored · <title>" with the time (CD-222). Scheduling doesn't count as contact.
- **Related records**: a company with meetings can't be deleted (409, like deals; "Remove sample
  data" keeps a sample company that has meetings). Neither can a deal with meetings (CD-213): 409
  "<deal> has N meetings. Delete them or move them to another deal first." from `DealsService`,
  backed by the foreign key `meetings_deal_fk` (NO ACTION; `mapDbError` turns a racing violation
  into a 409 too), and "Remove sample data" keeps a sample deal that has meetings, with its
  company and primary contact (`kept.deal`). Deleting a contact keeps their row on the meeting with the
  saved name (`ON DELETE SET NULL (contact_id)`). For upcoming meetings see "Participants" below.
- **Conflicts and history**: `updated_at` is the If-Match version (`crm_touch_version`) and PATCH
  checks field-level conflicts as deals do. `record_changes` gets `entity_type = 'meeting'`: the
  fields (`title`, `type`, `startsAt`, `endsAt`, `location`, `agenda`, `companyId`, `dealId`,
  `organizerUserId`, `status`, `cancelReason`) and `participant_added` / `participant_removed`
  (field `participants`, the person's name as `label`; the people a meeting is created with are
  part of its `created` row). `GET /api/crm/history?entityType=meeting` names the company, deal
  and organizer. A change of people alone also moves the meeting's version.
- **Live updates**: both tables send `crm_changes` hints of type `meeting`; participant rows report
  their meeting's id (`crm_notify_changes` takes the id column as an optional second argument).
- **Daily digest**: see "Daily digest" above (meetings today, not closed, and a planned meeting
  ahead counts as a next step).

### Participants and meeting emails (CD-131)

- **Who**: members (internal; the organizer always, and can't be removed) and contacts (external).
  People can be added and removed while a meeting is planned or held, not while cancelled. A
  meeting is on the calendar of everyone internal (`userId` filter) and on the contact page of
  everyone external (`contactId`).
- **Emails go to internal participants only** (decision on CD-131: customers get no invitations;
  the external minutes, CD-133, are the only email to them). `MeetingsService` queues
  `crm.meeting-invite` `{ tenantId, meetingId, userIds: [one member], actorUserId, kind }` in the
  same transaction, never for the person making the change:
  - `added`: members someone else adds to a planned meeting (on create: everyone but the creator,
    the organizer included when that is someone else; on PATCH: the newly added ones, e.g. a new
    organizer). Subject "You were added to a meeting: <title>".
  - `updated`: a planned meeting's start, end or location changed (other fields send nothing), and
    Restore; to the internal participants not just added. "Meeting changed: <title>".
  - `cancelled`: Cancel, to all internal participants. "Meeting cancelled: <title>".
  `meetings.ics_sequence` goes up with every `updated` and `cancelled`, in the same update.
- **The worker** (`meetings/meeting-jobs.ts`, `CrmWorkerModule`) reads everything again when it
  sends: an `added`/`updated` email goes only while the meeting is planned, `cancelled` only while
  it is cancelled; the member must still be on the meeting, in the workspace, have an email and
  "Meeting invitations" on (`memberships.notify_meeting_invites`). One job per member, so a retry
  never emails the others twice. Body: date and time in the workspace time zone, location,
  company, deal, organizer and a link to `APP_URL/meetings/<id>`.
- **The .ics** (`meetings/meeting-invite.ts`, pure and unit-tested): `meeting.ics` with content type
  `text/calendar; charset=utf-8; method=REQUEST|CANCEL`; one VEVENT with `UID:meeting-<id>@pultly.com`,
  `SEQUENCE` = `ics_sequence`, DTSTART/DTEND/DTSTAMP in UTC, SUMMARY, LOCATION, DESCRIPTION
  (company, deal, link), URL, ORGANIZER (the organizer's name with the `MAIL_FROM` address) and the
  recipient as ATTENDEE (`RSVP=FALSE`); a cancellation is `METHOD:CANCEL` + `STATUS:CANCELLED`.
  Text is escaped and lines folded at 75 octets (RFC 5545), so Google Calendar and Outlook take it.
- **Deleting a contact** removes their rows from planned meetings that start in the future, in the
  contact's delete transaction; held, past and cancelled meetings keep them as "<name> (deleted)".
- **A member leaving** (removed, or leaving themselves): `TeamService.removeMember` queues
  `identity.member-removed` `{ tenantId, userId }`; the CRM worker takes them off planned meetings
  that start in the future and sets `organizer_user_id = null` where they organized one ("Organizer
  left"). Past meetings keep them (`deleted: true`, shown as "(former member)"). Nothing happens if
  they rejoined before the job ran. Owners and admins see **Pick new organizer** on the meeting page
  (a PATCH of `organizerUserId`; the new organizer gets the `added` email).

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

## Meetings: screens (CD-130)

- **Store** (`store/meetings.ts`, `store/useMeetings.ts`): meetings aren't part of the workspace
  load. Screens ask for a query (`useMeetingList`: a date range plus filters, or a company, deal or
  contact) and the store keeps every meeting read in `s.meetings` (by id) and each query's ids in
  `s.meetingLists` (by query key). Saves put the API's answer in the cache and fix every loaded list
  with `matchesQuery` (the same filters as the API), so all views update at once. A `meeting` live
  hint re-reads those ids (`?ids=`); one without ids re-runs the lists on screen. Writes that touch
  a deal's timeline re-read the deal and its timeline (this tab gets no hint for its own change).
  The planned meetings of the coming year stay loaded, so "No next step" knows that a deal with
  an upcoming planned meeting has one (`needsNextStep`).
- **Times** are shown and entered in the workspace time zone (`store/time.ts`: `zonedToInstant`,
  `instantToZoned`, day/week/month ranges via Intl, DST-safe; weeks run Monday to Sunday).
- **Calendar** (`/calendar`, `screens/Calendar.tsx` + `screens/calendar/*`): Day and Week (a
  24-hour grid that opens on 07:00–20:00, overlapping meetings side by side, meetings across
  midnight on both days, the "now" line), Month (three meetings a day and "+N more") and Table
  (start, title, company, organizer, type, status, internal and external minutes; sort by start;
  Not closed and missing-minutes filters). The view, period and filters live in the URL
  (`view`, `date` or `from`/`to`, `user`, `type`, `status`, `company`, `deal`, `contact`,
  `notClosed`, `missingMinutes`, `sort`); switching views keeps them. Salesperson defaults to "Me"
  for members and "Everyone" for owners and admins; status to Planned and Held. Making a meeting
  works like Google Calendar (CD-212): on Day and Week, pressing an empty slot and dragging draws a
  placeholder in 15-minute steps (a click makes an hour from the half hour); the placeholder can be
  moved and resized by its lower edge, and the **quick-create popover** (`calendar/QuickCreate.tsx`,
  the `quick` shape of `MeetingForm`, CD-221) opens next to it, laid out like Google Calendar's:
  title, type chips, date and times on one row, Add guests, location, agenda, organizer, company
  and deal (required), "More options" and Save. Its time belongs to the placeholder (`time` and
  `onDraft` props), so dragging the placeholder and editing the fields stay in step. "More options"
  opens the New meeting page with everything typed so far. Escape or a press
  outside discards it (that press doesn't start another one). Month: a click on a day opens the
  popover at 09:00. The Calendar owns the draft (`CalendarDraft`, kept per view and date) and
  passes the filters as the new meeting's seed. Planned meetings the user may edit can be dragged
  to another time or day and resized by their lower edge (15-minute steps, saved with If-Match; put
  back with the reason when refused; a click on the edge does nothing). On phones Day is the
  default and Week is a list by day; there is no popover (a tap opens the New meeting page) and dragging is off. `?new=1&companyId=…&dealId=…&contactId=…&type=…&organizer=…&start=…`
  opens the prefilled New meeting page. The Table loads 500 rows at a time ("Load more" reads the
  next page with `offset`, CD-211), so a wide range works. **`ids=`** (CD-211) shows exactly those
  meetings (≤ 200) in the Table, whatever the other filters, with the removable chip "N meetings
  from report": every count on a plan page and in Reports (rows, totals, unplanned) links this way
  (`visitsInCalendar` in `store/visitPlans.ts`), so "Held 3" opens 3 rows. Over 200 meetings the
  link falls back to the closest filters (period, salesperson as organizer or participant,
  customer, Customer visit, status) plus `report=N`, and the chip says so.
- **New meeting page** (`/meetings/new`, `screens/NewMeeting.tsx`, CD-221; "More options" and
  every "New meeting": `meetings.openDialog(seed)` navigates there through `modals/MeetingDialog.tsx`,
  a seed with an `id` opens that meeting instead). Laid out like Google Calendar's event page:
  close, the title and Save on top, then date, start "to" end and end date on one row, the type,
  and "Meeting details" (company, deal, location, organizer, agenda) beside "Guests". The URL holds
  the prefill (`paths.newMeeting`: `companyId`, `dealId`, `contactId`, `type`, `organizer`,
  `start`, `end`, `title`); guests, location and agenda from the popover come in the history state
  (`meetingSeedOf`). Close and Save go back where it was opened from (opened from a link, Save
  opens the meeting). The deal Composer's Meeting tab is the same form (`inline` shape, "Schedule
  meeting"). `screens/meeting/MeetingForm.tsx` holds the rules for all three shapes: defaults per
  spec 4.2 (title "Meeting with <company>", Customer visit, an hour, the company's HQ for a visit,
  the company's only open deal, organizer = you, the contact it was opened from); **picking a
  deal invites its primary contact** (also when the only open deal is picked for you); the
  default start is the next full hour in working hours, else 09:00 on the next working day
  (Monday to Friday, 09:00–17:00, B8); "Schedule visit" on a plan starts today if today is in the
  plan's period, else on its first working day (B9). Moving the start keeps the length (a length
  that isn't valid becomes an hour, B7); an end before the start is an error shown at once, and
  Save then sends nothing and keeps everything typed (B1). Warns about colleagues' overlapping
  meetings and about a Customer visit without external participants (the second click saves).
  Those helpers are pure functions in `store/meetingTime.ts`, unit-tested by `npm test` in
  frontend (`frontend/test/*.test.ts`, Node's test runner on the TypeScript as is).
- **Dates and times** (CD-221, `screens/meeting/WhenFields.tsx`): meetings never use the browser's
  date and time inputs (12-hour on some systems). `DateField` shows the app's date style ("Tue 6
  Oct 2026", `dateLabel`), takes typed dates ("6.10.2026", "6 Oct", ISO) and has a month picker;
  `TimeField` is 24-hour, with a quarter-hour list (the end's list shows the length and "next
  day") and typed times ("930", "9:30", "21.15"). A whole value typed or set (ISO date, "HH:MM")
  is taken at once; anything else when the field is left. `data-value` holds the ISO date.
- **Guests** (`screens/meeting/Guests.tsx`, `GuestsField`): one "Add guests" search over the
  workspace's members (internal participants) and the meeting company's contacts (external ones;
  before a company is picked it says to pick one, and changing the company drops contacts of the
  old one), contacts without an email marked "No email"; "+ Add new contact" (CD-131) opens a small
  form (name from the search, email, job title) that creates a contact of the meeting's company
  with the store's `createContact` and adds them. While the workspace has one member it offers
  **Invite a colleague** (owners and admins), which opens Settings → Team with the Invite dialog
  (`/settings/team?invite=1`).
- **Meeting page** (`/meetings/:id`, `screens/Meeting.tsx`): a compact header (CD-221) with the
  title, status, Mark as held (disabled before the start; a timer enables it
  when the start passes while the page is open), Cancel (optional
  reason), Undo held, Restore, and Delete for owners and admins, and the date, start and end on
  one line under the title; below it the New meeting page's two columns, then the minutes tabs.
  There is no Edit button (CD-212):
  every field is edited in place like on the deal page (`screens/meeting/MeetingFields.tsx`):
  the title, the time (`MeetingWhen`; a new start keeps the length, an end before the start is
  refused), type, company and deal (another company is
  saved once one of its deals is picked, or made with "+ New deal"), location (with "Open" when it
  is a URL), organizer (owners and admins), the agenda (`MeetingDetails`) and the guests
  (`MeetingGuests`, the same "Add guests").
  `useField` shows an edit at once and saves it after a 600 ms typing pause (pickers at once, on
  blur too) through `meetings.saveField`, with If-Match on the version shown; a refused save
  (conflict or error) says why and shows the saved value. Read-only for people who can't change
  the meeting and while it is cancelled. Tabs: Internal minutes and
  External minutes (`screens/meeting/*`, CD-132/CD-133) and History (`ChangeHistory`, entity
  `meeting`). Who may change a meeting: `canEditMeeting` (owners, admins, organizer, internal
  participants). Former members show as "<name> (former member)", deleted contacts as
  "<name> (deleted)"; without an organizer it says "Organizer left", and owners and admins pick a
  new one in the Organizer field (CD-131, CD-212).
- **Elsewhere**: a Meetings card on company, contact (as external participant) and deal pages
  (`components/MeetingsCard.tsx`: next three, "Show all" → Table filtered to the record from
  2000-01-01 to five years ahead, "+ Meeting" prefilled; on a company "Visits this month" and
  "Visits this quarter" when the current month's or fiscal quarter's plans include it), "Meetings today" on Today, Calendar in the sidebar (after Today; under
  "More" on phones), "Meeting" (M) in the "+" menu and the command palette. Type colors are CSS
  variables in the CD-130 block of `styles/global.css`.

## Meeting minutes (CD-132)

`meeting_minutes` (crm module, `modules/crm/meetings/meeting-minutes.service.ts`) has at most one
row per meeting (`unique (tenant_id, meeting_id)`, cascades with the meeting), created by the first
save. The internal part: `summary` (≤ 10,000 characters), `agreements` (≤ 5,000) and `next_steps`
(jsonb, ≤ 50 items `{ id, text ≤ 500, ownerUserId | null, dueDate | null, taskId | null }`). The
external part (`external_subject`, `external_body` ≤ 10,000, `external_prefilled_at`) belongs to
CD-133 and is a separate text. RLS, the version trigger, the history trigger and the live-update
hints are in `drizzle/0034_meeting_minutes_rls.sql`.

- **API** (`/api/crm/meetings/:id/minutes`): `GET internal` (any member) →
  `{ summary, agreements, nextSteps, updatedAt, updatedByName }`, empty strings and no steps
  before anyone wrote them. `PUT internal` saves the parts sent (partial; blank text is stored as
  empty, other text as written). `nextSteps` replaces the list; each step keeps the `taskId` the
  server has for its id (the browser can't set or clear it, `mergeNextSteps`). Step owners set
  anew must be members (owners who left since may stay). `POST next-steps/:stepId/task` makes the
  step a deal task: `DealTasksService.insertExtra` in the same transaction, i.e. a "New task" task
  (off-playbook, `blocks_advance` false, "Task added" on the timeline) in the deal's current
  stage, channel `MT`, title = the step's text (cut to 200), assignee = the step's owner or the
  caller, due date = the step's (or none). It answers `{ minutes, task }`; 409 for an old meeting
  without a deal (CD-213) or when the step's task still exists (a deleted task can be made again), 400 for an empty step.
- **Who and when**: the same people who may change the meeting write the minutes and create tasks
  (`MeetingsService.lockForChange(…, 'edit')`: organizer, internal participants, admins, owners;
  403 otherwise), while it is planned (preparation) or held; a cancelled meeting's minutes are
  read-only (409). Every member reads them.
- **Recorded / Missing**: a meeting's `internalMinutes` is `recorded` when the summary is not blank.
  `GET /meetings?missingMinutes=1` = held and not recorded. `minutesUpdatedAt` on the meeting is
  the minutes' version.
- **Conflicts and history**: `updated_at` is the If-Match version (`crm_touch_version`). Before the
  first save the browser sends the epoch, so a first save someone else made meanwhile conflicts.
  The trigger writes `record_changes` rows on the **meeting** (`entity_type = 'meeting'`, the
  meeting's id, fields `summary`, `agreements`, `nextSteps`; the first save counts as a change
  from empty), so the meeting's History tab shows them and `RecordHistoryService.assertNoConflict`
  checks them like meeting fields (lists compare by value). Two people saving the same part:
  the usual 409 conflict message. Only real changes are written (CD-222): the service drops parts
  equal to what is stored (next steps as their canonical JSON) and a save that changes nothing
  keeps the version; the trigger compares next steps by id, trimmed text, owner and due date
  (`crm_minutes_steps`, `drizzle/0044_minutes_history_real_changes.sql`), so linking a task to a
  step ("Create task") is no history row. The History tab shows the steps' text and due dates.
- **Past due dates** (CD-222): "Create task" on a step whose due date is before today (workspace
  zone) asks "This date is in the past. Create anyway?" first; the API accepts it either way.
- **Live updates**: minutes rows send `crm_changes` hints of type `meeting` with the meeting's id;
  the browser re-reads the meeting, and an open minutes tab reads the minutes again when the
  meeting's `minutesUpdatedAt` moved.
- **Never in a customer email** (spec 6.2, AC 2): the internal minutes are read only by this
  service and the digest (which lists meetings, not their text). The external minutes email
  (CD-133) must be built from the external fields (`external_subject`, `external_body`) and the
  meeting's facts only, never from `summary`, `agreements` or `next_steps`; "Copy from internal
  minutes" copies text into the external body in the browser, explicitly. CD-133 adds the test on
  its email builder that proves it.
- **Digest**: "Minutes missing" (see "Daily digest").
- **Screen** (`screens/meeting/InternalMinutes.tsx`, store `meetings.loadMinutes / saveMinutes /
  createStepTask`, `s.meetingMinutes` by meeting id): Summary and Agreements are textareas with a
  small toolbar (Bold, Bullet list, Link) that inserts the Markdown subset; out of the editor (and
  read-only) they show formatted through `RichText`. Next steps: text, owner, due date, remove,
  and "Create task" (then a link to the task's deal; nothing on an old meeting without a deal,
  CD-213). Changes save after a 0.7 s pause (and on blur or leaving), one save at a time,
  each based on the version the previous one returned; "Saving…" / "Saved" next to the heading.
  A conflict shows the API's message and replaces the editor with the minutes read again.
  Read-only for people who can't change the meeting and for cancelled meetings.

### External minutes (CD-133)

A separate text for the customer (`meeting_minutes.external_subject`, `external_body` ≤ 10,000,
with its own version `external_updated_at` / `external_updated_by_user_id`), sent by email.
`meeting_minutes_sends` keeps every send (an exact copy of subject, body and the chrome language,
the sender's name and email); `meeting_minutes_recipients` one row per person (`to`: a contact,
`cc`: a member; name and address used; `status` queued → sent | failed with `error`, `sent_at`).
A meeting with sends can't be deleted (no cascade). RLS, the contact foreign key
(`ON DELETE SET NULL (contact_id)`) and the live-update hints (type `meeting`, the meeting's id,
on every send and every status change) are in `drizzle/0036_meeting_minutes_sends_rls.sql`.
Service `meetings/external-minutes.service.ts`, email builder `meetings/minutes-email.ts`.

- **API** (`/api/crm/meetings/:id/minutes`): `GET external` →
  `{ subject, body, prefilled, updatedAt, updatedByName, language, lastSend, changedSinceLastSend }`.
  The first read by someone who may change the meeting once it is held (`external_prefilled_at`
  null; CD-211) fills in the template (spec 7.1: title, date
  and time, location, both sides' participants, the agreements and the next steps with their due
  dates but without owners; subject "Minutes: <title>, <date>"; in the customer email language)
  and remembers it, with what it was made from (`external_prefill`: the meeting's start and end,
  the subject and body of the template from the meeting alone, and the text it filled in); after
  that nothing is copied automatically. **When the meeting changes** (CD-222; `prefillCheck` in
  `minutes-email.ts`): a later read by an editor compares the template of the meeting as it is now
  with the one stored. A text nobody changed since and never sent is filled in again (a text from
  before `external_prefill` existed, too, while nobody saved it); otherwise it stays and
  `meetingChanged` is `'time'` (it moved) or `'details'` (title, place, people), and the tab shows
  "The meeting time changed since this text was written" with **Update from meeting**
  (`POST external/update-from-meeting`): the meeting lines at the top are replaced and the rest
  kept, or the whole template comes back when those lines were edited; a subject someone changed stays. A read-only viewer, or a read
  before the meeting is held, gets the text as it is (empty, `prefilled: false`) and fixes nothing;
  the open tab reads it again when the meeting's status changes. `PUT external { subject?, body? }`
  (If-Match = `updatedAt`, the epoch before the first save; 409 when someone else changed a part
  sent here since). `POST external/copy-internal` returns `{ subject, body }` of the template from
  the internal minutes as they are now (nothing saved; the browser replaces the text after a
  confirmation). `POST preview` and `POST send` take `{ subject, body, toContactIds, ccUserIds }`
  (strict: unknown fields such as typed addresses are a 400); preview answers the exact email
  `{ from, replyTo, to, cc, subject, text, html }`, send answers 202 with the send. `GET sends`
  (newest first, with recipients) and `POST sends/:sendId/retry` (202; only the failed recipients
  are queued again; 409 when none failed).
- **Rules**: writing, previewing, sending, retrying and "Update from meeting" take the people who may change the meeting
  (403); the text can be written while planned or held (a cancelled meeting is read-only, 409);
  sending only for a **held** meeting (409). `to` = external participants of this meeting whose
  contact has an email (400 otherwise, at least one), `cc` = members of the workspace (400). The
  sender needs an email (the Reply-To). Once anything was sent, **Undo held** and **DELETE** are
  409 (spec 4.3, 4.5); the text stays editable and can be sent again (each send is a new entry).
- **One transaction per send**: the send and its recipient rows (queued), the deal timeline's
  `EM` activity "Minutes sent · <title>" (recipients and subject in the detail) with the deal's
  last contact moved to now (skipped for an old meeting without a deal), and the job `crm.meeting-minutes-email`
  `{ tenantId, sendId }` (a mail job: retried with backoff).
- **The worker** (`MeetingJobs.sendMinutes`) sends **one email per send** to the recipients still
  queued: contacts in To, members in Cc, From `"<sender name>" <MAIL_FROM address>`, Reply-To the
  sender. `Mailer.send` reports the addresses the server refused (`{ rejected }`): those fail
  ("The mail server refused this address."), the others are sent. When the whole send fails, the
  recipients stay queued while pg-boss retries it and fail with the error on the last attempt.
  Retry queues only the failed ones, so the next email goes only to them (nobody gets it twice).
  The log driver refuses `.invalid` addresses one by one (all refused = the send fails). In
  production without a provider (`notDelivered`) they fail with that reason.
- **Delivery on the meeting**: `externalDelivery` = the latest send's recipients: `failed` if any
  failed, `queued` while any is queued, else `sent`; `not_sent` without a send. `sendsUpdatedAt`
  moves with every status change. The calendar's Table shows `externalDelivery`.
- **The email** (`minutesEmail`, pure and unit-tested): the workspace name, a heading, the minutes
  rendered from the Markdown subset (every piece escaped, then bold, bullets and http(s) links;
  a plain-text version too), "Sent by <sender>, <workspace>.", a reply hint and a footer. The fixed
  text is in `tenants.customer_email_language` (CD-208): English, or Serbian Latin ("Zapisnik sa
  sastanka", "Poslao/la: …", "Odgovorite na ovu poruku …"). Its input has no field for the internal
  minutes; the integration test writes a marker into the internal minutes and checks that it is in
  no part of the preview, the email or the send log.
- **Screen** (`screens/meeting/ExternalMinutes.tsx`, store `meetings.loadExternal / saveExternal /
  copyInternal / previewMinutes / sendMinutes / loadSends / retrySend`): subject and body (the
  internal minutes' editor with its toolbar), autosave with "Saved", "Copy from internal minutes"
  (asks before replacing text). Once held: To (the external participants with an email ticked;
  "No email" and deleted ones disabled) and Cc (the internal participants, "+ Copy another member").
  **Send…** opens the preview (from, reply-to, to, cc, subject, and the HTML in a sandboxed
  iframe); **Send** there sends. Under the editor: "Minutes sent to <names> on <date>", "Changed
  since last send" while the text differs from the last send, each recipient's status with the
  error, and **Retry failed**. The meeting page hides Undo held and Delete once sent; the History
  tab lists every send (time, sender, recipients with status, subject, the exact text).

## People: employees and org structure (milestone 13)

Who works in the company, how it is organised, and who may see and do what. The foundation for
every Workforce module (timesheets, time off, travel, lateness, planning). Backend: CD-140
(`backend/src/modules/people/`); screens, departments and teams, managers, import and roles build on
it (CD-137, CD-138, CD-139, CD-141, CD-142). Spec: Linear "Functional spec: Employees and org
structure".

### Model

Tables in `shared/database/schema/people.ts`; RLS, the one-column `SET NULL` foreign keys, triggers
and the backfill in `drizzle/0039_people_rls.sql`.

- **`employees`**: a person who works for the company, with or without an app account. Work fields
  (first/last name, `full_name` generated, work email stored lower-case, employee number, job
  title, department, team, `manager_id`, work phone and location), employment fields (start date,
  type `permanent|fixed_term|contractor|student`, weekly hours 1–60, timesheet required, attendance
  tracked, end date, `deactivated_at`, `leaving_reason`), `user_id` (the linked member, unique per
  workspace) and `first_linked_at`.
  - **Status** is derived: `inactive` when `deactivated_at` is set, `leaving` when an end date is
    set but not applied yet, else `active` (`statusOf`). "Active employee" in queries means
    `deactivated_at is null`.
  - **Account**: `linked` (`user_id`), `invited` (a pending invitation with `invitations.employee_id`),
    `none`.
  - **Search**: `search_text` = accent-free lower case of name, job title and work email, kept by a
    trigger with `people_fold()`. Query with `search_text like '%' || people_fold(q) || '%'`, so
    "petrovic" finds "Petrović". `normalizeForSearch` (TS) has the same mapping for in-memory search.
- **`employee_personal`** (1:1, own table so lists never read it): date of birth, private email and
  phone, address (country shown as "Serbia" when empty), emergency contact, and the bank account:
  `iban_sealed` (SecretBox, purpose `employee-iban`, key from `APP_SECRET`), `iban_last4`,
  `iban_country`, `iban_masked` (`RS35 •••• 1379`), bank name, and the foreign currency account
  (`fx_same_as_iban`, `fx_iban_*` likewise, SWIFT/BIC, bank name and address). The plain IBAN is
  never stored. Losing `APP_SECRET` loses the IBANs.
- **`departments`** (name unique per workspace, lower+trim; code unique; `head_employee_id`) and
  **`teams`** (in one department; name unique within it; `lead_employee_id`). Deleting a
  department with teams is refused by the FK; its employees lose the department.
- **Team-in-department** is a foreign key: `(tenant_id, department_id, team_id) → teams(tenant_id,
  department_id, id)`, `ON UPDATE CASCADE` (moving a team to another department moves its members
  in the same statement) and `ON DELETE SET NULL (team_id)` (deleting a team keeps its members in
  the department). A team without a department is a check violation.
- **`employee_roles`**: `administration` and `payroll`, assigned by an Admin (CD-142 adds the
  endpoints). Manager and Admin are derived, never stored.
- `invitations.employee_id` (the card an invitation was sent from), `tenants.employee_default_weekly_hours`
  (40), `employee_number_required` (off), `employee_self_edit_bank` (on), all in `GET/PATCH
  /api/workspace`; `memberships.notify_org_changes` (on) in `/api/profile`.
- **History**: `record_changes` with entity types `employee`, `department`, `team`
  (`crm_record_changes`). Personal details and bank fields are rows of their employee
  (`people_record_personal_changes`): field names as in the API, IBANs only as the short mask.
  Linking is the `userId` field. Served only by `GET /api/people/history`; the CRM history endpoint
  rejects these types.
- **Versions**: one per card, `employees.updated_at` (If-Match). Saving personal details or the bank
  account touches the employee row.
- **Live updates** on `crm_changes`, ids only: `employee` (employees), `department`, `team`,
  `employee_role` (ids are employee ids). The browser re-reads through the API, which applies the
  access rules.

### Every member is an employee (linking, spec 4.6)

`linking.ts`, called by identity through `modules/people/index.ts` inside its own transaction:

- **Creating a workspace**: the creator gets a record (`IdentityService.createTenant`).
- **Joining** (`TeamService.join`, only when the membership is new), first rule that applies:
  1. the invitation's `employee_id`, if that record is active and has no account;
  2. an active employee without an account whose work email is the member's sign-in email;
  3. a new record from the profile: `people_create_member_employee(tenant, user)` (SQL, the same
     function the migration's backfill used): display name split at the last space (one word = last
     name, first name = email's local part), work email = sign-in email unless taken, job title and
     phone from the profile, Permanent, weekly hours from the setting, no department, manager or
     start date.
- **Removing a member** (or leaving): `unlinkMember` clears `user_id`; the employee stays Active
  with "No account". Deactivation is a separate step.
- The migration created a linked record for every existing membership.

### Access: `PeopleAccess` (spec 9)

Every endpoint of milestone 13 and later Workforce modules checks access through it (import
`PeopleAccess` from `modules/people`; `PeopleModule` exports it):

- `await access.of(ctx)` → `CallerAccess`: `employeeId`, `roles` (`employee`, `manager` = has an
  active direct report, `administration`, `payroll`, `admin` = workspace owner or admin),
  `directReportIds`, `reportIds` (all active reports at any depth). One recursive query on
  `manager_id` (index `(tenant_id, manager_id)`), cached per request (keyed by the request's
  `TenantContext`). Pass `tx` to read inside an open transaction.
- Checks (pure, `caller-access.ts`): `isAdmin`, `isAdministration`, `isPayroll`, `isManager`,
  `isHr` (Administration or Admin), `isSelf(id)`, `isDirectReport(id)` ("Direct" in the matrix),
  `isReport(id)` ("Indirect"), `canSeeEmployment(id)` (self, managers above, HR), `canSeePersonal(id)`
  and `canSeeBank(id)` (self, HR; never managers or Payroll), `canSeeHistory(id)` (self, HR),
  `canSeeLeavingReason` and `canSeeInactive` (HR).
- `access.reportIdsOf(tx, managerId, direct?)`: anyone's subtree. `access.employeeForUser(tenantId,
  userId)`: a member's record.
- Which card fields a caller may change: `editableFields(access, employeeId, selfEditBank)`
  (`field-rules.ts`). Admin: all, own card included. Administration: all on others; on their own,
  work fields, personal details and bank, not employment fields, department, team or manager.
  Others: on their own card only work phone, personal details and (setting on) bank. Nobody but an
  Admin makes themselves someone's manager.
- `GET /api/people/access` returns the caller's `{ employeeId, roles, directReportIds, reportIds, directReportUserIds, reportUserIds }` (the user ids: reports with an account, for CRM data kept per member).

### Approver rule (spec 7.4)

`access.approversFor(tenantId, employeeId, date, tx?)` → `{ kind: 'manager'|'admins'|'self',
reason: 'manager'|'no_manager'|'manager_inactive'|'manager_no_account'|'manager_absent', approvers:
[{ userId, employeeId }], selfApproved }`. The manager if active, linked to a member and not absent;
otherwise every workspace owner and admin except the requester; the requester alone when they are
the only Admin (`selfApproved`, shown "Self-approved (no other Admin)"). Resolved when someone looks
or acts, never stored. The rule itself is `resolveApprovers` (pure, table-tested). Absence comes from
the `ABSENCE_SOURCE` provider (`AbsenceSource.absentOn(tx, tenantId, employeeIds, date)`); the stub
says nobody is absent until Time off (16) provides it.

### Reporting lines

Every change of a manager (card, bulk actions, team-lead dialogs, deactivation, import):

1. `await lockReportingLines(tx, tenantId)`: `pg_advisory_xact_lock` per workspace, **before**
   locking employee rows (two crossing changes then queue instead of deadlocking);
2. `await assertValidManager(tx, employeeId, managerId)`: not yourself (400), an active employee of
   the workspace (400), and no loop: it walks up from the proposed manager; reaching the employee is
   409 `{ code: 'reporting_loop', message: 'This would create a loop: Ana Petrović → Marko Ilić → Ivan
   Jović → Ana Petrović' }`;
3. write in the same transaction.

The database also refuses `manager_id = id`. Covered by a concurrent A → B / B → A test.

### API (`/api/people`, any member; rules per caller)

- `GET /employees?departmentIds=&teamIds=&managerId=&managerScope=direct|indirect&status=active,leaving,inactive&account=linked,invited,none&issues=no_manager,no_start_date,no_department,manager_no_account,no_employee_number&q=&ids=`
  → `{ employees, total }`, sorted by last name, all rows in one response. Default status: active
  and leaving; `inactive` is HR only (403 otherwise), `account` Admin only, `issues` HR only. `q`
  searches name, job title and work email (employee number too for HR). Each row has the directory
  fields (`id, userId, firstName, lastName, fullName, jobTitle, departmentId, departmentName, teamId,
  teamName, managerId, managerName, workEmail, workPhone, workLocation, status`), plus `employment`
  (`employeeNumber, startDate, endDate, type, weeklyHours, timesheetRequired, attendanceTracked,
  deactivatedAt`, and `leavingReason` for HR) only for rows in the caller's scope, `hr: { account,
  dataIssues }` for HR and `roles` for Admins. Never personal details or bank accounts. Someone
  leaving shows as `active` to callers who may not see employment dates.
  **Data issues**: `no_manager`, `no_start_date`, `no_department`, `manager_no_account`,
  `no_employee_number` (when the setting requires it); none for inactive people. "No manager" leaves
  out the top of the organisation (CD-224): when exactly one active employee has no manager, that
  person is the top and not an issue; when several have none, every one of them is flagged (nobody
  can tell which of them is the top).
- `GET /employees/:id` → the card: the directory fields, `version` (send as If-Match), `account`,
  `roles`, `manager` (with `hasAccount` and their own manager), `directReports`, `leadsTeams`,
  `headsDepartments`, `approvals` (with names), `permissions: { editableFields, canRevealBank,
  canSeeHistory, canDelete }`; and only when allowed: `employment`, `hr: { dataIssues }`, `personal`,
  `bank` (`iban: { masked: 'RS35 •••• •••• •••• ••13 79', last4, country, foreign }`, `bankName`,
  `fxSameAsIban`, `fxIban`, `swiftBic`, `fxBankName`, `fxBankAddress`), `appAccess` (Admin: sign-in
  email, workspace role, pending invitation). A section the caller may not see is absent, not empty.
  Inactive employees are 404 for non-HR.
- `POST /employees` (HR) and `PATCH /employees/:id` (field rules above; If-Match like CRM, 409
  naming who changed which field) take the work, employment, personal and bank fields and return
  the card. Validation: names ≤ 100 (Serbian and Cyrillic letters), emails, start date required on
  create and at most a year ahead, weekly hours 1–60, age 15–100, the employee number when the
  setting requires it. Choosing a team sets its department; a team of another department is 400;
  changing the department drops a team that isn't in it.
- **IBAN** input: an IBAN in any spacing or a Serbian domestic number (`260-0056010016113-79`,
  converted to `RS35…`); foreign IBANs by country length and mod 97 (`iban.ts`). Anything else is
  400 "This is not a valid IBAN or Serbian account number". Adding, changing or removing an IBAN (or
  FX IBAN) queues `people.bank-account-changed-email`: masks and who changed it, to the sign-in email
  if linked, else the work email. It can't be turned off.
- `POST /employees/:id/bank/reveal { account: 'iban'|'fxIban' }` → `{ iban, formatted, domestic,
  foreign }` for self and HR (403 otherwise); audit `employee.iban_viewed` each time.
- `DELETE /employees/:id`: Admin; only a record that never had an account (409 "Deactivate
  instead"). Workforce modules add their "has data" checks there.
- `GET /employees/:id/approvers?date=yyyy-mm-dd`: the approver rule with names.
- `GET /history?entityType=employee|department|team&entityId=&limit=&offset=` → `{ entries, more }`:
  an employee's history for self and HR (403 otherwise), without `leavingReason` for non-HR; fields
  the caller may not see are filtered out; ids come with names (employees as "Name (left)" once
  inactive). Departments and teams: HR only.
- `GET /departments`, `GET /teams`: every member; see "Departments, teams and reporting lines" below.

- `POST /employees/bulk { employeeIds (≤5,000), departmentId?, teamId?, managerId? }` → `{ updated }`
  (CD-137, the list's "Set department and team" / "Set manager" and the chart's drag): Administration
  and Admin, one transaction, all or nothing. Every row passes the card's field rules (Administration
  can't include their own row) and the reporting-line rules: the lock first, then one walk up from
  the new manager decides loops for the whole selection, refused with the foundation's
  `assertValidManager` message (409 `reporting_loop`). Department and team go together (a team brings
  its department; a department alone clears the team; both null = No department). Only rows that
  change are written; one audit entry `employee.bulk_updated` with the fields and the count, history
  per employee from the triggers.
- `POST /employees/export { employeeIds }` → `{ employees: [{ id, personal, bank }] }`: the export's
  "Include personal details and bank accounts" (Administration, Admin; 403 otherwise), with full
  IBANs (formatted). Every call writes the audit entry `employee.personal_exported` with the row count.

Friendly messages for the unique constraints and the team rules are in `shared/database/errors.ts`.
Audit entries for employees list the changed field names only, never values.

### Departments, teams and reporting lines (CD-138, CD-139)

`org.controller.ts` / `org.service.ts`. Reading is for every member; every change is for
Administration and Admin (403 otherwise). Nobody but an Admin puts themselves in a department or
team, changes their own manager, or makes themselves someone's manager.

- `GET /departments` → `{ id, name, code, headEmployeeId, headName, version, teams, activeEmployees }[]`
  by name; `GET /teams` → `{ id, departmentId, name, leadEmployeeId, leadName, leadOutside, version,
  activeEmployees }[]` by department and name (`leadOutside`: the lead isn't a member, the chart shows
  them on top with "(lead)").
- `POST /departments { name, code?, headEmployeeId? }`, `PATCH /departments/:id` (rename, code,
  head). Name ≤ 100 (trimmed, unique in any case), code ≤ 20 (unique, `''` clears it); a head or
  lead must be an active employee (400). Renaming changes the one row, so the new name shows
  everywhere; the history keeps the old one. Setting a head or a lead never changes a manager.
- `DELETE /departments/:id`: 409 while it has teams ("Logistics has 2 teams (Trucks, Warehouse).
  Delete them or move them to another department first.") or another module uses it; otherwise its
  members end up with no department. "Used by" comes from the `DEPARTMENT_USAGE` provider
  (`department-usage.ts`, `usedBy(tx, tenantId, departmentId) → ['2 strategic initiatives']`):
  nothing until Projects (14) and Planning (21) provide it, like `ABSENCE_SOURCE`.
  `GET /departments/:id/usage` → `{ teams, usedBy, members }` for the confirmation.
- `POST /teams { departmentId, name, leadEmployeeId? }`; `PATCH /teams/:id { name?, departmentId?,
  leadEmployeeId?, makeMembersReport? }` → `{ team, moved, reassigned, loops }`:
  - **Moving** (`departmentId`) updates the team row; the team-in-department foreign key's `ON UPDATE
    CASCADE` moves its members' department in the same statement. `moved` counts the active ones (the
    confirmation, `GET /teams/:id/usage` → `{ members }`, names them). A name clash in the target is
    409 and nothing moves.
  - **Lead** with `makeMembersReport: true` ("Make team members report to <lead>", ticked by default
    in the dialog): members with no manager or reporting to the previous lead now report to the lead,
    under the reporting-line lock; someone for whom it would close a loop keeps their manager and is
    listed in `loops` with the message; an Administration caller's own record is left alone. Without
    it, nobody's manager changes. `GET /teams/:id/lead-preview?leadEmployeeId=` → `{ members, loops }`
    shows the dialog who would change, without saving.
- `DELETE /teams/:id`: always allowed; members stay in the department without a team.
- **Add people**: `POST /assignments/preview { departmentId, teamId?, employeeIds }` → per employee
  where they are now (`moves`, `teamName`) and, if they have no manager, the suggested Reports to
  (`suggestedManagerId`): the team's active lead, else the department's active head, never themselves
  or a loop. `POST /assignments { departmentId, teamId?, employeeIds, managers?: { [employeeId]:
  managerId|null } }` puts them in the department and team (out of any other team; adding to a
  department alone keeps a team of that department) and sets the managers the user left in the
  dialog, in one transaction → `{ updated, managersChanged }`.
- **Set manager** (one or many): `POST /reporting-lines { employeeIds, managerId|null }` →
  `{ changed }`. All or nothing: one loop refuses the whole change (409 naming it). People who left
  are 400.
- Lists of the panel and the dialogs use `GET /employees` (directory).

**Changing managers in code** (`reporting-lines.ts`, exported from `modules/people`):
`setManagers(tx, tenantId, [{ employeeId, managerId }])` takes the reporting-line lock (take it
yourself first if you lock other rows before), locks each row, checks each change against the
lines already changed (so a bulk change can't build a loop step by step) and returns the
`ManagerChange[]` (`employeeId, oldManagerId, newManagerId`) it wrote. Then
`queueManagerEmails(jobs, tx, tenantId, actorUserId, changes, { employee?, manager? })` queues
`people.reporting-line-changed` in the same transaction: one job per change and recipient, "New
manager" to the employee and "New direct report" to the new manager. Every in-app change calls it
(the card's PATCH and create, `/reporting-lines`, `/assignments`, the list's `POST /employees/bulk`, the team-lead dialog); the import
doesn't; deactivation's reassignment passes `{ manager: false }` (one "New manager" per moved
report). Removing a manager emails nobody.

**The emails** (`org-email.ts`, worker `ReportingLineEmailJob` in `people-jobs.ts`): sent only if
the line is still as it was changed and both people are active, to a member (sign-in email) who
isn't the one who made the change and has "Org changes" on (`memberships.notify_org_changes`, read
when sending, so switching it off stops queued emails). Names and job titles only, a link to the
other person's card. Retried like every email job.

**"Manager has no account"**: the data issue `manager_no_account` (list filter `issues=`, card
`hr.dataIssues`) while an active employee's manager has no linked member; approvals then go to the
Admins (`approvals.reason = 'manager_no_account'`).

**Screens**: the "Departments & teams" panel (`screens/org/DepartmentsPanel.tsx`), opened by
`<DepartmentsPanelButton/>` in the Org structure header (`.org-actions`, shown to Administration and Admins; the panel's CSS classes are `dtp-*`). A list
of departments, expandable to their teams, with head or lead and counts of active employees; add and
rename inline; Edit (name, code, head); Move a team (names how many employees move); Delete with
confirmations naming the members (a department with teams says which to delete or move first); Add
people (searchable multi-select, "moves from <team>", Reports to prefilled with the suggestion and
changeable); Set lead with "Make team members report to <lead>" listing who changes and who keeps
their manager because of a loop. Data: `store/org.ts` `useOrgStructure()` reads departments, teams,
the directory and the caller's access through `lib/orgApi.ts`, and again ~300 ms after any
`employee`, `department`, `team` or `employee_role` hint (`s.orgRev`), so other viewers' changes
show without a reload. Works at 375 px (actions wrap under the name).


### App access and leaving (CD-140, spec 4.6–4.8)

`lifecycle.service.ts` (API), `lifecycle.ts` (shared with the worker), `lifecycle.controller.ts`.
People reaches identity only through `modules/identity/index.ts`: `createInvitation`,
`withdrawEmployeeInvitations`, `removeMembership`, `keepAnOwner`, `membershipRole`
(`identity/membership.ts`, plain functions taking the open transaction, so the worker can use them;
`TeamService` uses the same ones). Every action returns the card.

- `POST /employees/:id/invite { role }` (Admin): an invitation to the work email with
  `employee_id`, so accepting links to this record (linking rule 1). Needs a work email, an
  active or leaving record and no account. A member with that email: 409 `code: 'linked_elsewhere'`
  ("… already has an account linked to <name>") when their own record holds data, else 409
  `code: 'link_instead'` with `userId` (the dialog offers "Link instead of invite"). Returns
  `{ invitation, token, card }`. Resend, Copy link and Withdraw are the Team endpoints.
- Changing the **work email** (PATCH) withdraws the record's pending invitations.
- `POST /employees/invite { employeeIds, role }` (Admin, "Invite selected"; the import queues the
  same job): 202 `{ queued, skipped }`; the job **`people.bulk-invite`** invites each row that still
  has a work email, no account and no pending invitation, whose email isn't a member's or already
  invited, while the requester is still an owner or admin; one transaction each.
- **Link to member** (Admin): `GET /employees/:id/link-candidates` → members with `mergeable` and
  `blockers`; `POST /employees/:id/link { userId }` deletes the member's own record and links this
  one. A record with data of its own (department, manager, reports, a team it leads or department
  it heads, HR roles, personal details or bank account; `mergeBlockers`, Workforce modules add
  theirs) is never merged (409). `POST /employees/:id/unlink`: "No account"; the member gets a new
  automatic record (`people_create_member_employee`).
- **Deactivate** `POST /employees/:id/deactivate { lastWorkingDay, reason?, reportsManagerId?,
  teamLeads?, departmentHeads? }` (Administration and Admin; on their own record only an Admin,
  and not the only Admin). Last working day at most 90 days ago in the workspace's time zone. With
  active direct reports `reportsManagerId` is required (null = "No manager"; the dialog defaults
  to the skip level); the loop rule applies to every report, and a report picked as the new
  manager goes to the skip level. The last owner can't go ("Make someone else an owner first").
  - Today or earlier: applied now (`applyDeactivation`, under the reporting-line lock): end date,
    reason, `deactivated_at`; reports moved; team leads and department heads replaced or cleared;
    pending invitations withdrawn; the membership removed through identity (audit
    `member.deactivated`); job **`people.employee-deactivated`** `{ tenantId, employeeId, userId }`.
    CRM handles it like `identity.member-removed` (off future planned meetings).
  - Later: status Leaving (`employment_end_date` set), the choices in `employees.deactivation_plan`
    (jsonb, `drizzle/0041_employee_deactivation_plan.sql`). The cron job **`people.deactivate-due`** (`5,20,35,50 * * * *` UTC) applies, in each
    workspace where it is 00:05 or later, the plans whose last working day is before the local
    date, leniently: a chosen manager or replacement who left meanwhile (or would now close a
    loop) falls back to the skip level, else nobody. One that can't apply (last owner) stays
    Leaving and is logged. Dev auth: `POST /api/dev/people/deactivate-due { now? }` runs it for
    the caller's workspace.
  - Each moved report gets one "New manager" email (`people.reporting-line-changed`, CD-139).
- **Reactivate** `POST /employees/:id/reactivate { employmentStartDate? }` (Administration, Admin):
  Inactive → Active with the new start date (required), no account until invited; Leaving →
  cancels the plan.
- The card's `permissions` add `canInvite`, `canLink`, `canUnlink` (Admin), `canDeactivate`,
  `canReactivate` (HR); `appAccess.invitation` has `emailStatus` and `hasLink`.
- `GET /api/team` members carry `employeeId` (Settings → Team links to the card).

### Employee card screen (CD-140)

`/people/:id` (`screens/EmployeeCard.tsx`, `screens/employee/*`), store slice
`store/employeeCard.ts` (`useStore().employeeCard`, cards in `s.employeeCards`, pickers in
`s.peoplePickers`, `s.myEmployeeId`), hook `useEmployeeCard(id)`, API client `peopleCardApi` in
`lib/api.ts`.

- Header: initials, name, job, status (Active, Leaving on …, Inactive since …), account and role
  badges; Invite to Pultly, Deactivate or Reactivate / Cancel leaving, and a "⋯" menu (Link to
  member, Delete or "Deactivate instead"). Below 700 px every action is in the menu.
- Sections: Work (with employment fields when returned, "Leads team", "Heads department"),
  Reporting ("Approvals go to" from `GET /employees/:id/approvers`), Roles (read-only badges; the
  `data-slot="role-toggles"` is for CD-142), Personal details and Bank account only when the API
  returned them, App access, History (`GET /people/history`). Two columns, one below 900 px.
- Each section edits in place with Save and Cancel and sends only the changed fields the card's
  `permissions.editableFields` allows, with If-Match; a 409 shows the conflict and the card as it
  is now.
- Bank account: masked; "Show" and "Copy" call the reveal endpoint (audited). The IBAN input
  previews what will be saved (`lib/iban.ts`, the server's rules): a domestic number shows its
  IBAN, a foreign one "Foreign account". The full number never comes back with the card, so the
  input starts empty ("Keep RS35 …") and "Remove IBAN" clears it.
- Live hints `employee`, `department`, `team`, `employee_role` re-read the open cards and the
  pickers only (not the CRM lists).
- Profile → "My employee card"; Settings → Team: "Employee card" column, and removing someone asks
  "<name> also left the company", which opens the card's Deactivate dialog (`?deactivate=1`)
  instead of removing the membership directly.
### Import from Excel and CSV (CD-141, spec 8)

The CSV import's pipeline (`shared/import`, see "CSV import and export") with the type `employees`,
owned by the people module (`employee-import*.ts`). Administration and Admins only: the routes are
`@RequireTenant('member')` and the service checks `PeopleAccess` (`isHr`), so everyone else gets 403.

- `POST /api/people/import/preview` and `/commit` take `{ csv, mapping?, duplicates: 'skip'|'update',
  invite? }` (3 MB JSON body like `/api/crm/import`; 2 MB of text, 5,000 rows). `GET
  /api/people/import/template` is the CSV template (labels and an example row; no "Full name").
- **Excel** is read in the browser (`frontend/src/lib/spreadsheet.ts`, loaded only when an .xlsx is
  picked or the Excel template is downloaded: read-excel-file, write-excel-file and fflate, about
  35 kB gzipped, maintained and without known vulnerabilities; the npm `xlsx` 0.18.5 is not used).
  The chosen sheet (the dialog asks when there are several; default the first) becomes CSV text for
  the same endpoints, so there is one server path with one set of limits. Row N of the sheet is line
  N of the CSV (empty rows stay empty lines, line breaks in cells become spaces), so line numbers
  are the sheet's row numbers; the first non-empty row is the header. Formulas give their saved
  values, merged cells take the top-left value in every cell of the range (read from the sheet's
  `<mergeCells>`), date cells become `YYYY-MM-DD`, numbers keep the digits Excel saved, text keeps
  leading zeros. Refused: `.xls` and other OLE files ("Save the file as .xlsx or .csv and try
  again"), password-protected workbooks (an OLE file with an `EncryptedPackage` stream: "This file
  is protected. Save it without a password and try again"), files over 5 MB. The Excel template is
  built from the CSV template (the employee number as a text cell, the date as a date cell).
- **Columns** (`employee-import-fields.ts`): labels, keys and aliases including WBM's Serbian
  headers (Ime, Prezime, Ime i prezime, E-mail adresa, Broj zaposlenog, Radno mesto, Sektor,
  Odeljenje, Tim, Nadređeni, Rukovodilac, Datum zaposlenja, Vrsta ugovora, Sati nedeljno, Telefon,
  Lokacija, Datum rođenja, Adresa, Poštanski broj, Grad, Privatni email, Mobilni, Tekući račun,
  Banka …). Header matching ignores case, accents (đ = dj), spaces and punctuation, for every
  import type. First and last name are required unless Full name is mapped (split at the last
  space). Values: dates `YYYY-MM-DD`, `DD.MM.YYYY` (with or without the last dot) or an Excel date
  number; employment types in English or Serbian ("neodređeno", "određeno", "ugovor o delu",
  "student"); weekly hours with a decimal comma, default from the workspace setting; IBANs and
  Serbian account numbers as on the card.
- **The plan** (`employee-import-plan.ts`, pure, unit-tested) checks the whole file before anything
  is written: the create rules (`ImportedEmployee`), duplicates within the file ("Same email as line
  14", employee numbers too), an employee number used by someone else, the "Employee number
  required" setting, a team without a department, managers (an existing active employee or any row
  of the file, also later rows; "Manager not found: …", "Manager has left the company", not
  yourself), and reporting loops in the final tree (existing lines with the file's changes): every
  row of a loop is an error ("Reporting loop: lines 5 → 9 → 5", or "line 5 → Marko Ilić → line 5"
  with existing employees), checked again after taking them out. Warnings: no start date, no work
  email, an IBAN converted from an account number, a manager whose row has errors ("Manager is on
  line 3, which has errors: imported without a manager"; the manager's row is found by its email as
  written even when its fields didn't parse, CD-224). Duplicates are matched by work email (active
  or inactive); Skip (default) or Update: only non-empty cells, never the email, never
  (re)activation ("Inactive: not reactivated"). The dialog shows the Skip it / Update it choice only
  when the preview has rows matching existing records, and its Cancel asks before discarding a file
  whose columns were read and mapped (CD-224). Departments are matched by name (case-insensitive) and teams by name within the
  row's department, created if new.
- **Preview** returns the CRM preview's shape plus `counts.warnings / newDepartments / newTeams /
  invitations`, `newDepartments`, `newTeams` ("Sales / Field"), `canInvite` (Admins) and each row's
  `warnings`. The commit plans again (the server never trusts the preview), so an unchanged file
  gives the same counts and errors.
- **Commit**: phase 1 creates the new departments and teams (`on conflict do nothing`), then saves
  employees in batches of 200 without managers (multi-row inserts; a refused batch is redone row by
  row in savepoints); personal details and sealed IBANs go to `employee_personal`; an update that
  changes an IBAN queues "Bank account changed" (new employees' IBANs don't: the import is the
  initial record). One `employee.imported` audit entry per batch. Phase 2 sets the managers of every
  saved row in one transaction under `lockReportingLines`, with the loop check over the tree read
  again under the lock; a row whose manager's row failed (or whose manager left meanwhile) is saved
  without one and listed in `withoutManager`. No "New manager" emails. The result: created,
  updated, skipped, failed (with cells, downloadable), `newDepartments`, `newTeams`,
  `invitationsQueued`, `withoutManager`. 5,000 rows with managers import in under 30 s
  (integration test).
- **History and live updates**: the import's transactions set `app.change_action = 'imported'`
  (the history row of a created employee, department or team says `imported`, not `created`) and
  `app.quiet_notify = 'on'` (no per-statement hints); the last transaction sends one "re-read the
  list" hint (ids null) for `employee`, and for `department` and `team` when some were created
  (`drizzle/0040_employee_import.sql`; every other write path is unchanged).
- **Invitations** (Admins, "Invite imported employees to Pultly", off by default): one
  `people.bulk-invite` job `{ tenantId, actorUserId, employeeIds, role: 'member' }` with the new
  employees that have a work email, the same job as "Invite selected" (see "App access and
  leaving"): each invited like Settings → Team with `invitations.employee_id` set, skipping members,
  pending invitations (of the record or the email), linked and inactive employees, and only while
  the importer is still an owner or admin.
- **UI**: `ImportDialog` with `initialType="employees"` (exported as `EmployeeImportDialog({ onClose,
  onImported })`), opened from "Import" on the Org structure page; `onImported` re-reads the page's
  lists. Store calls in `store/importExport.ts` (`importApi` uses `/people/import` for employees).

### Org structure page (CD-137)

`/org` (`screens/OrgStructure.tsx`, parts in `screens/org/`), sidebar "Org structure" after Products
(under "More" on phones), for every member. In the module switcher (CD-214) it is Workforce
(`components/modules.ts`, current on `/org` and `/people/…`).

- **Data**: the store's people slice (`store/people.ts`, `s.people`) reads `GET /people/access`, then
  the whole directory (inactive too for HR), departments and teams, when a screen watches it
  (`people.watch()`; Ctrl/⌘K calls `people.ensure()`). Live hints `employee`, `department`, `team`,
  `employee_role` read it again (debounced); they don't reload the CRM lists. Everything else
  (filters, search, sort, both charts) runs in the browser on that copy, with the API's rules
  mirrored in pure functions (`filterEmployees`, `reportIdsBelow`, `departmentChart`,
  `reportingTree`). The UI never assumes `employment`, `hr` or `roles` exist on a row: an empty cell
  is what the caller may not see.
- **URL state**: `?tab=chart|list&mode=department|reporting&q=&dept=&team=&manager=&scope=indirect&status=&account=&issues=&sort=&dir=desc`
  (`paths.org(...)`). The search box updates the URL 150 ms after typing stops.
- **Search**: name, job title, work email (and employee number for HR), accent- and case-free
  (`foldName`: "petrovic" finds Petrović, đ → d, and "dj" works too). Ctrl/⌘K lists up to five
  employees ("Employees") and opens their card (`paths.employee(id)` = `/people/:id`).
- **Filters** (both tabs): departments, teams (within the chosen departments), manager (direct, or
  including indirect), status (Active and Leaving by default; Inactive for HR), account (Admin), data
  issues (HR). "Me" sets the manager filter for managers. Phones fold them under "Filters".
- **Chart** (`ChartFrame`): scrolls inside its card, never the page; Fit / 100% / − / + zoom (CSS
  transform, the box takes the scaled size) and pan by dragging the background. Inactive people
  never appear.
  - *By department*: a column per department by name (head on top), a box per team (lead first,
    then by name), "No team", and "No department" last. Filters hide; without filters empty
    departments and teams show. HR on desktop can drag a person onto a team or department box; a
    dialog confirms, then `POST /employees/bulk` with that one id.
  - *Reporting lines*: a tree from `managerId` drawn with CSS connectors; roots side by side,
    biggest first. Two levels open by default; a node's reports fold. Reports that have no reports
    of their own stack in a column (keeps wide teams narrow). Filters dim instead of hiding; the
    search opens the path to every hit, highlights them and scrolls to the first.
  - Phones (≤700px): an indented, foldable list (department → team → people, or manager → reports).
- **List** (`EmployeeList`): virtualised (fixed row height, only rows on screen in the page; tested
  with 5,000), sticky header, sortable columns, default by last name. Columns by caller
  (`screens/org/columns.tsx`): directory columns for all; Start date and Employment type for
  managers and HR; Status and Account for HR; Roles for Admins. Phones get cards (name, job title,
  team).
- **Bulk actions** (HR, ticked rows): Set department and team, Set manager (the server's loop message
  shows in the dialog), Export selected, and "Invite selected" (Admin, CD-140). **Export
  CSV** (HR): the filtered rows with the visible columns (`lib/csv.ts`); "Include personal details and
  bank accounts" adds them from `POST /employees/export` (audited).
- `/people/:id` is the employee card (CD-140, below). The header's "Add employee" (HR) opens a short
  create dialog (`screens/employee/AddEmployeeDialog.tsx`) and then the new card; the bulk bar's
  "Invite selected" (Admin) confirms how many rows qualify (work email, no account or invitation)
  and calls `POST /employees/invite`.
- Measured with a mock API and a production build: 1,000 employees open the department chart in
  ~0.6–1.1 s and the list in ~0.4 s (page load included); 5,000 rows in the list ~0.5 s.

### Roles and permissions (CD-142)

- **One definition** (`people/permissions.ts`): the matrix of spec 9.3 as data, `PERMISSION_MODULES`
  (`crm`, `org`, `projects`, `timesheet`, `time_off`, `travel`, `lateness`, `planning`, `settings`;
  `live` false for the modules still to come). Each row has a stable id (`crm.visit_plans.manage`,
  `org.bank`, …) and a cell per role: `scope` (`none`, `own`, `direct`, `indirect` = direct and
  deeper, `all`) and the `label` the matrix shows ("If setting on", "All except own", …).
  `relationsFor(rowId, roles)` is the union of the cells of the caller's roles (Employee always
  counts: roles are additive) as relations `self`/`direct`/`indirect`/`other`; `allows(rowId, roles,
  relation?)`. `CallerAccess.relationTo(employeeId)` / `relationToUser(userId)` give the relation.
  A change of the matrix is a change of this file (and of the spec).
- **Who uses it**: Settings → Roles & permissions renders it from `GET /api/people/permissions`
  (`{ roles, modules }`), so the screen can't drift from the rules; the visit plan scope
  (`VisitScope`, below) and role assignment check it; `test/integration/permissions-matrix.spec.ts`
  is generated from it: for every row of the live modules and every role (plus Manager + Payroll)
  it calls the API for the caller themselves, a direct report, an indirect report and someone else,
  and expects exactly what the cell says. A new row fails the suite until it has a test (or an
  `it.todo` naming the issue that builds its endpoint). Label conditions the generic rule can't
  express (the bank setting, "All except own", inactive employees) have their own expectations.
- **Assigning Administration and Payroll** (`roles.service.ts`, Admins only, row `org.roles`):
  `PUT /api/people/employees/:id/roles/:role` → `{ employeeId, roles }` and `DELETE …` → 204 for
  `administration` and `payroll` (anything else is 400: Admin is the workspace role, Manager comes
  from reporting lines). Any employee, with or without an account; not someone who left. Granting
  what they have, or removing what they don't, changes nothing and sends nothing. Each change writes
  an employee history row (field `roles`, old and new lists), the audit entry
  `employee.role_granted`/`role_removed`, and queues `people.role-changed-email` ("You now have the
  Administration role in …" / "Your Payroll role in … was removed", to the sign-in email, else the
  work email; can't be turned off; no personal details). It applies on the person's next request:
  PeopleAccess reads `employee_roles` per request. The `employee_role` live hint updates the lists.
- `GET /api/people/roles` (every member): `{ administration, payroll }` (active holders: employee
  id, user id, name, job title, `hasAccount`, `grantedAt`), `admins` (workspace owners and admins,
  with `workspaceRole`) and `managers` (employees with active direct reports, with `reports`).
- **Workspace roles**: changing someone to admin in Settings → Team gives them Admin on their next
  request (it is read from the membership); back to member takes it away.
- **UI**: Settings → Roles & permissions (`screens/settings/RolesTab.tsx`) shows the workspace roles'
  matrix. The functional roles' matrix and "Who has which role" are hidden since CD-224 (commented
  out, the components stay; the product owner may bring them back): Administration and Payroll are
  given in the Team tab's invite dialog (see "Teams and invitations") and on the employee card.
  The matrix's labels are product text: no open spec questions such as "(Q1)" (a unit test checks it).
  `components/RoleToggles.tsx` is the employee card's Roles section: the person's roles as badges
  and, for Admins, an Administration and a Payroll switch (`useSetEmployeeRole`, `store/roles.ts`).
  `s.peopleRev` goes up on every `employee` and `employee_role` hint and on resync; the lists re-read.
- **Settings → Employees** (CD-215, Admins; `screens/settings/EmployeesTab.tsx`): default weekly
  hours (1–60), "Employee number required", "Employees can edit their own bank account", saved through
  `PATCH /api/workspace` (owners and admins) like the other workspace settings. Settings →
  Notifications has "Org changes" (`notifyOrgChanges`).

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
the desktop layout is unchanged. On phones the sidebar becomes a bottom bar with the current
module's everyday pages (CD-223; CRM: Pipeline, Today, Calendar, Companies; Workforce: Org
structure) and **More** (a sheet with the module's other pages, Settings, Profile, the module and
workspace switcher as a bottom sheet, and the workspace switch). The header puts the title on its own row and keeps search and "New…" full
width. Filter bars wrap two per row; tables scroll sideways inside their card; the pipeline board
scrolls with snapping columns; dialogs are bottom sheets with their buttons always visible. On a
deal, the composer and to-dos come before the details, and the stage line names only the current
stage. Contacts have one-tap `mailto:` and `tel:` links (only for a real address or number). The
page itself never scrolls sideways at 390px or 768px (`e2e/tests/phone.test.mjs`).
