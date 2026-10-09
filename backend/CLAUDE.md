# Backend rules (NestJS API and worker)

Read with the root [CLAUDE.md](../CLAUDE.md); these apply inside `backend/`.

- Node 24 LTS (24.11+). The code compiles to CommonJS and loads ESM-only deps (NestJS 12, pg-boss, jose) via `require(esm)`. Tests use Vitest, not Jest (Jest can't load them). There is no Nest CLI: build is `tsc -p tsconfig.build.json`.
- TypeScript is pinned to ~6.0 (TS 7 isn't supported by the tooling yet).
- Every tenant-scoped query goes through `DatabaseService.withTenant()`. New tenant tables need RLS policies in a custom migration: use `/new-tenant-table <name>`, which also runs `check-rls.sh` (see docs/ARCHITECTURE.md "Adding a tenant-scoped table"). Never connect the app as the table owner.
- Migrations are generated (`npm run db:generate`) and applied (`npm run db:migrate`), never pushed with `drizzle-kit push`, and a committed migration is never edited: add a new one. Expand, then contract (docs/WORKFLOW.md section 7).
- The pg-boss schema is pre-created by `infra/postgres/init`. Keep `createSchema: false` in JobsService, because the runtime role has no CREATE on the database.
- Cross-module effects go through jobs (`shared/events/job-types.ts`), not direct table writes. ESLint blocks deep imports into other modules: import another module through its `index.ts`.
- Pure rules get unit tests in `test/*.spec.ts` (database-free); behaviour over HTTP and RLS gets integration tests in `test/integration/` (real PostgreSQL, see README "Tests"); the time report's performance target lives in `test/performance/` and runs nightly.
- Checks: `npm run lint && npm run typecheck && npm test && npm run build`, then `npm run test:integration` with the dev database. Run the unit, integration and performance suites one at a time.
- Before opening a pull request that touches `backend/`, have the `tenant-security-reviewer` agent read the diff (`/finish-issue` does).
