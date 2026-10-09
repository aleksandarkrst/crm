# Pultly CRM: notes for coding agents

The rules for every agent working here. Package-specific rules load when you touch files there:
[backend/CLAUDE.md](backend/CLAUDE.md) (NestJS API and worker, tenant isolation, jobs),
[frontend/CLAUDE.md](frontend/CLAUDE.md) (the app, a design port) and
[website/CLAUDE.md](website/CLAUDE.md) (pultly.com). Read them before changing those packages.

- Monorepo without workspaces: `backend/`, `frontend/`, `website/` and `e2e/` each have their own package.json and lockfile. Run npm commands inside them.
- Tasks and bugs live in Linear (team Coding, project CRM, IDs `CD-…`), not in the repo. Mention the issue ID in branch names and commit messages. `/start-issue CD-123` sets an issue up; `/finish-issue` hands it over for review.
- Every piece of work gets its own branch on GitHub, so anyone can review it:
  - Before the first change, create a branch from the latest `origin/main`, named after the issue (Linear's branch name, e.g. `aleksandar/cd-20-…`, or `cd-20-short-description`). One branch per agent or lane; never work on `main`.
  - Push it to GitHub right away (`git push -u origin <branch>`) and push again after every commit, so unfinished work is visible and survives a stopped session. This overrides any task text that says not to push.
  - When the work is ready (checks pass), open a pull request to `main` that names the issue IDs. Only merge after review; agents never merge.
  - One Linear issue, one pull request. A merged pull request closes every `CD-…` in its title, body and branch name, so name only the issues it finishes.
  - The whole process (planning, parallel agents, migrations, review, releases) is in docs/WORKFLOW.md.
- Checks: `npm run lint && npm run typecheck && npm test && npm run build` in backend, and `npm run lint && npm run build` in frontend and in website. Run the backend unit, integration and performance suites one at a time.
- docs/ARCHITECTURE.md is long. Read its "Contents" list, then only the section for the module you touch (grep the heading, read to the next heading). The same goes for the README's test section: find the layer you need.
- Automation in this repository (CD-310), all checked in:
  - Hooks (`.claude/settings.json`, scripts in `.claude/hooks/`): after an Edit or Write of a TypeScript file, ESLint, `tsc` and the unit specs that import it run and report problems; edits to `.env`, lockfiles, `backend/drizzle/meta/` and committed migrations are refused; `git push` to main, switching to main, `gh pr merge` and `drizzle-kit push` are refused; ending a turn with unpushed commits is refused once with a reminder.
  - Skills: `/start-issue`, `/finish-issue`, `/new-tenant-table <name>`, `/staging-check CD-123` (user-invoked).
  - Agents: `tenant-security-reviewer` (backend diffs), `design-fidelity-reviewer` (frontend diffs); `/finish-issue` runs them.
  - MCP servers (`.mcp.json`): `linear` (the tracker) and `postgres` (the dev database as the runtime role, read-only: for inspecting data and plans, never for changing data or schema; migrations do that).
