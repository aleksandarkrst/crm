# Cadence CRM: notes for coding agents

- Monorepo without workspaces: `backend/` and `frontend/` each have their own package.json and lockfile. Run npm commands inside them.
- Node 22.12+. The backend compiles to CommonJS and loads ESM-only deps (NestJS 12, pg-boss, jose) via `require(esm)`. Tests use Vitest, not Jest (Jest can't load them). There is no Nest CLI: build is `tsc -p tsconfig.build.json`.
- TypeScript is pinned to ~6.0 (TS 7 isn't supported by the tooling yet).
- Every tenant-scoped query goes through `DatabaseService.withTenant()`. New tenant tables need RLS policies in a custom migration (see docs/ARCHITECTURE.md). Never connect the app as the table owner.
- The pg-boss schema is pre-created by `infra/postgres/init`. Keep `createSchema: false` in JobsService, because the runtime role has no CREATE on the database.
- Cross-module effects go through jobs (`shared/events/job-types.ts`), not direct table writes. ESLint blocks deep imports into other modules.
- The frontend is a port of the Claude Design handoff "Mini CRM v2.dc.html". Keep its tokens and spacing (`src/styles/global.css`). Screens only use `useStore()`. The store loads from the API (`store/remote.ts`) and saves in its actions (`store/store.tsx`). Features without a backend yet stay browser-only (see docs/ARCHITECTURE.md).
- Tasks and bugs live in Linear (team Coding, project CRM, IDs `CD-…`), not in the repo. Mention the issue ID in branch names and commit messages.
- Every piece of work gets its own branch on GitHub, so anyone can review it:
  - Before the first change, create a branch from the latest `origin/main`, named after the issue (Linear's branch name, e.g. `aleksandar/cd-20-…`, or `cd-20-short-description`). One branch per agent or lane; never work on `main`.
  - Push it to GitHub right away (`git push -u origin <branch>`) and push again after every commit, so unfinished work is visible and survives a stopped session. This overrides any task text that says not to push.
  - When the work is ready (checks pass), open a pull request to `main` that names the issue IDs. Only merge after review.
- Checks: `npm run lint && npm run typecheck && npm test && npm run build` in backend, and `npm run lint && npm run build` in frontend.
