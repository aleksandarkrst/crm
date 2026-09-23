# Cadence CRM: notes for coding agents

- Monorepo without workspaces: `backend/` and `frontend/` each have their own package.json and lockfile. Run npm commands inside them.
- Node 22.12+. The backend compiles to CommonJS and loads ESM-only deps (NestJS 12, pg-boss, jose) via `require(esm)`. Tests use Vitest, not Jest (Jest can't load them). There is no Nest CLI: build is `tsc -p tsconfig.build.json`.
- TypeScript is pinned to ~6.0 (TS 7 isn't supported by the tooling yet).
- Every tenant-scoped query goes through `DatabaseService.withTenant()`. New tenant tables need RLS policies in a custom migration (see docs/ARCHITECTURE.md). Never connect the app as the table owner.
- The pg-boss schema is pre-created by `infra/postgres/init`. Keep `createSchema: false` in JobsService, because the runtime role has no CREATE on the database.
- Cross-module effects go through jobs (`shared/events/job-types.ts`), not direct table writes. ESLint blocks deep imports into other modules.
- The frontend is a port of the Claude Design handoff "Mini CRM v2.dc.html". Keep its tokens and spacing (`src/styles/global.css`). Screens only use `useStore()`. The store loads from the API (`store/remote.ts`) and saves in its actions (`store/store.tsx`). Features without a backend yet stay browser-only (see docs/ARCHITECTURE.md).
- Checks: `npm run lint && npm run typecheck && npm test && npm run build` in backend, and `npm run lint && npm run build` in frontend.
