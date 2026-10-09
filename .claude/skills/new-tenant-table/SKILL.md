---
name: new-tenant-table
description: Add a tenant-scoped table to the backend (Drizzle schema, generated migration, paired RLS migration, indexes, isolation test, docs) and verify every table has a policy
disable-model-invocation: true
argument-hint: <table_name>
---

# New tenant-scoped table: `$ARGUMENTS`

Add the table `$ARGUMENTS` (snake_case, plural, e.g. `task_limit_alerts`) to the backend. Every
tenant table is protected by three layers (docs/ARCHITECTURE.md "Multi-tenancy: three layers"):
RLS, composite `(tenant_id, id)` foreign keys, and `DatabaseService.withTenant()`. All six pieces
below are required; do not skip the RLS migration or the test. Work in `backend/` for npm commands.

## 1. Drizzle schema

File: `backend/src/shared/database/schema/<module>.ts` of the owning module (crm, people, projects,
timesheet, notifications; platform is for non-tenant tables). Each file already defines a local
`tenantId()` helper (`uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' })`)
and a `timestamps` spread; reuse them. Pattern (see `timeEntries` in `schema/timesheet.ts`):

```ts
export const taskLimitAlerts = pgTable(
  'task_limit_alerts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantId(),
    taskId: uuid('task_id').notNull(),
    ...timestamps,
  },
  (t) => [
    // Only if other tables will reference this one with a composite FK:
    unique('task_limit_alerts_tenant_id_uq').on(t.tenantId, t.id),
    index('task_limit_alerts_task_idx').on(t.tenantId, t.taskId),
    foreignKey({ columns: [t.tenantId, t.taskId], foreignColumns: [tasks.tenantId, tasks.id], name: 'task_limit_alerts_task_fk' }).onDelete('cascade'),
  ],
);
```

- Every reference to another tenant table is a composite `foreignKey({ columns: [t.tenantId, t.<col>], foreignColumns: [parent.tenantId, parent.id], name: '<table>_<parent>_fk' })`,
  never a plain `.references()`. The parent must have `unique('<parent>_tenant_id_uq').on(t.tenantId, t.id)`.
- References to `users` (platform, not tenant-scoped) stay plain: `.references(() => users.id, { onDelete: 'set null' })`.
- Use `check(...)` for enums and lengths, as the neighbouring tables do.
- New schema files must be exported from `schema/index.ts` (`export * from './<module>'`); tables in an existing file are picked up automatically.

## 2. Generated migration

```sh
npm run db:generate -- --name <name>
```

drizzle-kit (0.31) writes `backend/drizzle/NNNN_<name>.sql`, `drizzle/meta/NNNN_snapshot.json` and
appends `{ idx, version: "7", when, tag: "NNNN_<name>", breakpoints: true }` to `drizzle/meta/_journal.json`.
Read the SQL: it must only contain your change. Do not edit generated SQL by hand except to add statements at the end.

## 3. Paired RLS migration (hand-written)

Generated migrations never carry policies, so the next number is a custom migration:

```sh
npx drizzle-kit generate --custom --name <name>_rls
```

This creates an empty `drizzle/NNNN+1_<name>_rls.sql`, registers it in `_journal.json` the same way as step 2,
and copies the previous snapshot under a new id (that is how `0086_hour_limits_rls` was made; see the journal).
Fill the file from `rls.sql.template` in this skill's folder, replacing `{{table}}` (and the header
placeholders). Per table, exactly these three statements:

```sql
ALTER TABLE "{{table}}" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "{{table}}" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "{{table}}" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
```

Statements are separated by `--> statement-breakpoint` on the same line; the last statement of the
file has none. Several tables go in one file (repeat the block, breakpoint after each policy except
the last). Triggers for the table (`crm_touch_version`, `crm_notify_changes`) belong in this file too.
Never put the policy in the generated file: `db:generate` would not know about it.

## 4. Indexes

An index on every foreign-key column, always led by `tenant_id`, in the schema from step 1:
`index('<table>_<col>_idx').on(t.tenantId, t.<col>)`. Lookups the services make by other columns
(a date, a status) get the same form. Composite primary keys `(tenant_id, …)` cover their own columns.

## 5. Tenant-isolation integration test

`backend/test/integration/tenant-isolation.spec.ts` runs against real PostgreSQL. Its second
`describe` ("in SQL, as the runtime role") opens a `pg` client as the runtime role and uses
`asTenant(tenantId, fn)` (a transaction with `set_config('app.tenant_id', …)`, rolled back) and
`sqlError(promise)` (resolves to the SQLSTATE). Add the new table there:

- append it to the table list in "sees no tenant rows at all without a tenant set" (expects `count = 0` with no tenant);
- an insert for tenant A while running as tenant B must fail with `42501` (RLS WITH CHECK), like "rejects writing rows into another tenant";
- an insert that points at tenant A's parent row from tenant B must fail with `23503`, as in "rejects cross-tenant references".

If the table needs fixtures that spec does not create (projects, employees, work orders), add a
small `describe` to the module's own spec (e.g. `task-limits.spec.ts`) with the same `asTenant` pattern
instead of growing the shared `beforeAll`. Run with the dev database up:
`docker compose -f docker-compose.dev.yml up -d` at the root, then `npm run test:integration` in backend.

## 6. docs/ARCHITECTURE.md

In the owning module's section, add the table to its tables list or a short paragraph: what a row
is, the columns that carry rules, and the migrations, in the house style
(`` `task_limit_alerts` (RLS in `drizzle/0086`) ``). No separate "tables" document; the module
section is the reference.

## Finish

```sh
bash .claude/skills/new-tenant-table/check-rls.sh      # from the repo root
cd backend && npm run lint && npm run typecheck && npm test && npm run build
```

`check-rls.sh` fails (exit 1) naming every table created with a `tenant_id` column that has no
`CREATE POLICY` in `backend/drizzle/*.sql`. The only intended exceptions are `memberships` and
`invitations`, which decide access before a tenant context exists (ARCHITECTURE.md "Teams and
invitations"); do not add more.
