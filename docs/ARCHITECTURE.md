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
    crm/                        companies, contacts, funnels, deals (+activities), products, documents
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

`backend/src/modules/crm/import/` imports companies, contacts and deals from a CSV. It has no table
of its own, so nothing about an import is stored between requests: the browser keeps the file's
text and sends it with each call as JSON (`{ csv, mapping?, duplicates?, funnelId? }`).

- `POST /api/crm/import/:type/preview` (`companies`, `contacts`, `deals`) parses and validates the
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

**Export** on Pipeline, Companies and Contacts downloads the list the screen shows, with its search
and filters applied (Pipeline: the funnel on screen and the lost-deals view too), as
`cadence-<list>-<date>.csv`. Owners and admins only; the buttons are hidden for members.

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

- **Tables** (`drizzle/0013_documents.sql`, RLS in `0014_documents_rls.sql`):
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
  unpacks to at most 60 MB, and a template docxtemplater can compile (an unclosed loop is a 400 with
  the reason). `POST …/scan` runs the same checks and returns the fields without saving (the
  dialog's "Parameters found"). `GET …/starter` is the starter template; `GET …/:id/file`
  downloads a template; `DELETE …/:id` deletes it and its file.
- **Generate** (`POST /api/crm/deals/:id/documents` `{ templateId, name? }`, any member): inserts a
  `queued` document and sends `crm.generate-document` in the same transaction (202). The worker
  (`DocumentGenerator`) marks it `running`, reads the deal, company, primary contact, owner, lines and
  workspace with `withTenant`, fills the template, stores the file, marks it `ready` and writes
  "Document generated · <name>" on the deal's timeline (from the template, by whom, what was left
  empty). A broken or missing template marks it `failed` with a readable reason; it isn't retried.
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
commits. `DealsService.moveToStage` does this for `crm.deal-won`, and `DocumentsService.generate`
for `crm.generate-document` (the worker fills the template, see "Documents" above). Add Redis later only for caching
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
  Overview), and a payment without a date is left out of "Funnel by payment due date" (the card
  says how many lines were left out). Payments are dated from the line's start date, but a
  milestone with its own date counts even when its line has no start date.
- Stage to-dos: a playbook to-do gets a row on first touch, keyed by deal + stage + checklist item
  id (CD-32). A stage's checklist is `funnel_stages.checklist_items` (`[{ id, label }]`); renaming
  an item in the funnel builder keeps its id, so every deal keeps its tick, note and outcome, and
  the to-do rows take the new label (`deal_tasks.label` stays unique per deal and stage, so a
  swap goes through a temporary label). Labels must differ within a stage. Removing an item hides
  its to-dos; they aren't deleted. Off-playbook to-dos are rows of their own.
  - `checklist` (labels only) is kept in sync with `checklist_items` by a trigger
    (`drizzle/0011_checklist_item_ids.sql`), and a playbook to-do written by label is linked to
    the item with that label, so code that still uses labels keeps working. The migration gave
    every existing label an id and linked the existing to-dos by label.
  - `PATCH /api/crm/funnels/:id/stages/:stageId` takes `checklistItems` (keep `id` to rename,
    leave it out for a new item) or, as before, `checklist`. `PUT /api/crm/deals/:id/tasks/playbook`
    takes `checklistItemId` (or, as before, `label`).
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
  - **No next step**: an open deal with no open task gets that flag on its Pipeline card and deal
    screen (the flag opens the New task dialog).

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
    are no exchange rates. Products have no currency of their own; their prices are in the workspace
    currency.
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
- sales-bonus rules (including "Sales bonus earned" on the Workspace tab); they start empty
  (no made-up rate, minimum or flat amount)
- invitation emails (links are copied by hand for now)
- custom fields
- notification and integration settings
