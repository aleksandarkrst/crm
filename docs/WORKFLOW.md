# Development workflow

How work moves from an idea to production in Pultly CRM. It applies to everyone who changes the
code: people and coding agents (Claude, Codex and others). The short rules for agents are in
[CLAUDE.md](../CLAUDE.md); this page explains the whole process and why.

```
Linear issue ──▶ branch ──▶ build + test ──▶ pull request ──▶ CI green ──▶ review routine ──▶ merge
                                                                                               │
             production ◀── promote (by hand) ◀── staging check (a person) ◀── staging ◀───────┘
```

Code review before the merge is automated; the human check is on staging, after it. Production
is promoted by hand. Sections 5 to 7 say who does what.

## 1. Plan the work in Linear

Tasks and bugs live in Linear (team **Coding**, project **CRM**, IDs `CD-…`), grouped by milestone.

- **One issue, one clear outcome.** Write what "done" means: what a user can do afterwards, which
  roles are affected (owner, admin, member), and what must keep working.
- **Add acceptance criteria and the tests you expect.** Agents do their best work against concrete
  criteria, e.g. "a member sees the stage fields read-only; e2e test for it".
- **Keep issues small.** A pull request you can review in 15 to 30 minutes gets a real review.
  Split big features into several issues that each ship on their own.
- **Record decisions in the issue** (e.g. "dismissal is per user, not per workspace"), so later
  agents and reviewers know why.

Issue states: **Backlog / Todo** → **In Progress** (a branch exists) → **In Review** (a pull request
is open) → **Done** (merged; Linear moves it when the pull request is merged).

Linear is the only place plans and milestones live: there is no plan file in the repository.

## 2. One branch per issue

- Create the branch from the **latest `origin/main`**, named after the issue. Linear shows a
  branch name on every issue (`aleksandar/cd-20-…`); `cd-20-short-description` works too.
- **Push it to GitHub right away** and after every commit. Work that only exists on one computer
  or in one session can't be reviewed and is lost if the session stops.
- **Never work on `main` directly.** Everything reaches `main` through a pull request.
- **Commit messages start with the issue ID**: `CD-20: close the live-update stream on pagehide`.
- In Claude Code, `/start-issue CD-20` does all of this: reads the issue, branches from
  `origin/main` with Linear's branch name, pushes, moves the issue to In Progress and prints the
  checks. Hooks (`.claude/settings.json`) refuse pushes to `main`, switching to `main` and
  ending a turn with unpushed commits.

### Several agents at once

- Give parallel agents **areas that don't share files** (e.g. one on the backend of feature A, one
  on the screens of feature B). Shared files like `global.css`, `Layout.tsx` or `store.tsx` cause
  conflicts.
- **Database migrations are numbered in order.** Two branches that each add a migration will clash
  on the number. Whoever merges second regenerates theirs on top of `main`
  (`npm run db:generate`) before merging.
- **Merge one pull request at a time.** After each merge, the other open branches bring in `main`
  and run their checks again.

## 3. Build and test before asking for review

Every change comes with tests: a feature with tests for what it promises, a bug fix with a test
that would have caught the bug. Run the same checks CI runs:

| Where | Command |
|---|---|
| `backend/` | `npm run lint && npm run typecheck && npm test && npm run build` |
| `backend/` | `npm run test:integration` (needs the dev database, see [Tests](../README.md#tests)) |
| `frontend/` | `npm run lint && npm run typecheck && npm run build` |
| `e2e/` | `npm test` against a running API, worker and UI (see [Tests](../README.md#tests)) |

A failing test is never skipped, disabled or deleted to get green: find the cause.

In Claude Code the edit hook already runs ESLint, `tsc` and the unit specs that import a changed
file after every edit, so most problems surface before the full checks. A new tenant-scoped
table goes in with `/new-tenant-table <name>` (schema, migration, paired RLS migration, indexes,
isolation test, docs) and `scripts/check-rls.sh` proves every table has its policy (or a reason in
`scripts/rls-allowlist.txt`).

Also try the change in the app (`npm run dev`), at desktop and phone width when it touches the UI.
Passing tests are not the same as working software.

## 4. Pull request

When the checks pass, open a pull request to `main`:

- **Title** with the issue IDs: `CD-20, CD-69: live updates and change history`.
- **Description**: what changed and why, decisions made, how it was tested (with numbers), and
  anything left undone. Screenshots for UI changes.
- Move the Linear issue to **In Review** and link the pull request (Linear links it automatically
  when the branch name or title contains the issue ID).
- Mark the pull request **ready for review** once CI is green: that is what the review routine
  (section 5) picks up. A draft is left alone.
- In Claude Code, `/finish-issue` does this end to end: the checks, the reviewer agents (below),
  push, a draft pull request with this description layout, ready-for-review once CI is green,
  and the Linear move. It never merges (`gh pr merge` is refused by a hook).

**GitHub CI** then runs five checks on the pull request: `backend`, `frontend`, `website`,
`integration / run` (the database job in `db-tests.yml`, shared with the nightly performance run)
and `guards`. All must be green before merging. `guards` (CD-311) is what used to need a reviewer
reading the SQL, now mechanical:

- `scripts/check-rls.sh`: every table created in `backend/drizzle/*.sql` has row-level security
  turned on and forced and a tenant policy, or is listed with a reason in `scripts/rls-allowlist.txt`.
- `scripts/check-migrations.sh`: the migrations the pull request adds contain no `DROP COLUMN`,
  `DROP TABLE`, `ALTER COLUMN … TYPE`, `RENAME COLUMN`, `RENAME TO` or `SET NOT NULL` on a column
  without a default (section 7, expand then contract). When a change can't follow that, the pull
  request description gets a `migration-plan:` section (a heading or a line starting with it) with
  the maintenance window or the restore plan, and the check accepts the statements.
- `scripts/check-tenant-tests.sh`: a `CREATE TABLE` with `tenant_id` in the pull request comes with
  a spec under `backend/test/integration/` added or changed in the same pull request that names
  the table (`tenant-isolation.spec.ts`, see `/new-tenant-table` step 5).

`scripts/guards-selftest.sh` runs first and proves the three scripts still fail on what they must.
Run any of them locally from the repository root (`sh scripts/check-migrations.sh origin/main`). The `e2e` browser tests (about 16 minutes, workflow
`e2e.yml`) don't run on pull requests or on `main` (CD-218). They run only before a production
deploy (step 4 below). Don't start them for a pull request or after a merge to staging; a change
that touches the flows the e2e tests cover updates or adds tests in `e2e/`, and the run before
production checks them (CD-227).

The image build can also be checked before merging. Run **CI / CD** from the Actions tab against
the branch and enable **Build both Docker images without publishing them**. The checks (`backend`, `frontend`, `website`, `integration / run`) run
first, followed by `images`; verification never pushes an image or starts `deploy`, even on `main`. See [image verification](DEPLOYMENT.md#verify-docker-images-before-merging) for dispatch steps and the default-branch prerequisite.

## 5. Review

Nobody reads a pull request before it merges unless it touches a protected path. Three things
replace that reading, in this order:

1. **The reviewer agents and CI**, before the pull request is ready (section 4): the checked-in
   agents in `.claude/agents/` (`tenant-security-reviewer` reads a backend diff for
   `withTenant()`, paired RLS, module boundaries, jobs, expand-then-contract and permission tests;
   `design-fidelity-reviewer` reads changed `.tsx` against the design-port rules), their findings
   in the description, and the five CI checks, `guards` among them (CD-311), which enforce the
   rules that used to need a reviewer reading the SQL.
2. **The review routine.** A scheduled Claude Code session, set up outside the repository, looks
   at every pull request in **Ready for review** with green CI. It reads the diff against the
   issue's acceptance criteria and the rules in CLAUDE.md, posts a **plain-language summary** of
   what the change does and what to try on staging (for the person doing step 3, who may not read
   code), asks for fixes as review comments when something is wrong, and **merges the ordinary
   ones**. It does not merge a pull request that touches a **protected path**; it says so in its
   summary and the project owner merges it after reading those files:
   - `backend/drizzle/` and `scripts/rls-allowlist.txt`: migrations and row-level security, the
     hardest things to undo once live;
   - `backend/src/shared/database/` and `backend/src/shared/authorization/`: tenant isolation;
   - `backend/src/modules/identity/`: sign-in, accounts, roles and invitations;
   - `.github/workflows/`, `scripts/`, `infra/`, `docker-compose.yml`: CI, deploys, backups, the server;
   - `.claude/`, `.mcp.json` and the `CLAUDE.md` files: the automation and the rules themselves.
   Review comments, from the routine or a person, are answered on the pull request: fixed in a
   new commit, or explained. Agents never merge and never wait for a human review on an ordinary
   pull request: once it is ready for review with green CI, their part is done.
3. **The staging check, by a person**, after the merge (section 7, step 3): the seed workspaces
   and the five yes/no questions in [STAGING_CHECK.md](STAGING_CHECK.md) (CD-313), which
   `/staging-check CD-123` prints with the issue's acceptance criteria filled in. This is the
   step that asks "does it do what the issue asked?" by trying it, with every role, on a phone
   too. Anyone can do it without reading code. A **no** goes back to a branch as a new issue or a
   fix on the same one; nothing is promoted until the five answers are yes.

A second agent in a fresh session can still review a diff before it is ready, e.g. with Claude
Code's `/code-review`; it catches different things than the agent that wrote the code.

## 6. Merge

- **Who merges what.** The review routine merges ordinary pull requests. The project owner merges
  pull requests that touch a protected path (section 5), after reading those files. Agents never
  merge (`gh pr merge` is refused by a hook).
- **When.** Only when CI is green, the branch is **up to date with `main`** (the ruleset requires
  it, so the checks ran against what will actually be on `main`), and every review comment is
  answered.
- **How.** One pull request at a time; after each merge the other open branches bring in `main`
  and run their checks again (section 2). Squash or merge commit as the repository's default
  setting says; never rebase someone else's branch.
- After merging, delete the branch. Linear moves the issue to **Done**.

## 7. From `main` to production

After every merge, CI runs again on `main` and then:

1. **`images`**: builds the backend and frontend Docker images and stores them in GitHub's
   container registry, tagged with the commit (the frontend twice: production and `-staging`,
   because the sign-in app is compiled into it).
2. **`deploy-staging`**: deploys the commit to staging (https://staging.pultly.com,
   same server, own database) and runs the smoke test there.
3. **Check it on staging**: a person (the project owner, or any tester) opens staging and answers
   the five questions in [STAGING_CHECK.md](STAGING_CHECK.md) with the seed accounts
   (`APP_DIR=/opt/crm-staging bash scripts/seed-staging.sh` creates or resets them), guided by
   the review routine's summary of the change. This is the human review step.
4. **Promote to production**, by hand and only after the five answers are yes: Actions →
   *Promote to production* → Run workflow (or `gh workflow run promote.yml`). It first runs the
   e2e browser tests on the commit staging runs now (about 16 minutes); only if they pass does it
   deploy that commit and smoke-test production.
   Only commits that passed staging can be promoted.

Setup and details: [DEPLOYMENT.md, Staging](DEPLOYMENT.md#9-staging). Until
`STAGING_DEPLOY_ENABLED` is `true`, step 1 is followed by a direct production deploy instead
(when `DEPLOY_ENABLED` is `true`).

- **Rollback**: every deploy is an image tagged with its commit; going back means promoting (or
  running `scripts/deploy.sh` with) the previous one. A failed deploy rolls itself back.
- **Migrations that are safe on live data (expand, then contract).** A failed deploy rolls back
  to the previous image automatically, but the migration stays applied, so the previous release
  must keep working on the new schema. Staging runs each migration first, but on its own data,
  so this still matters:
  - add a column, table or index before code uses it; new columns are nullable or have a default;
  - remove or rename a column only in a later release, after no deployed code reads it (a rename
    is: add the new column, write both, backfill, switch reads, then drop the old one);
  - never change a column's type or meaning in place.
  A migration that can't follow this needs a plan in its pull request (maintenance window, or
  restoring the pre-deploy backup on failure).
- **Backups with a practised restore** (CD-5, CD-314): every deploy takes a backup named after
  the commit before it migrates, and the restore runbook
  ([DEPLOYMENT.md, Restore](DEPLOYMENT.md#restore-practise-this-before-you-need-it)) is
  rehearsed on staging and logged in its drill table before real customer data goes in.
- **Secrets never in the repository**: they live in GitHub secrets and on the server. Agents never
  get production credentials.

## 8. Keeping the project's memory

| File | What it holds | Who updates it |
|---|---|---|
| `CLAUDE.md` (root, `backend/`, `frontend/`, `website/`) | The rules every agent follows; the package files load when an agent touches that package | When an agent repeats a mistake, add a line |
| `.claude/` (`settings.json`, `hooks/`, `skills/`, `agents/`) and `.mcp.json` | The automation that enforces the rules: hooks, `/start-issue`, `/finish-issue`, `/new-tenant-table`, the reviewer agents, the Linear and Postgres servers | When the process or the checks change |
| `AGENTS.md` | Points Codex and other agents to CLAUDE.md | Rarely |
| `docs/ARCHITECTURE.md` | How the system works | Every pull request that changes behaviour |
| `docs/WORKFLOW.md` | This process | When the process changes |
| `docs/STAGING_CHECK.md` | The human check on staging | When the seed or the questions change |
| Linear | The only source for plans, milestones and what's done | Continuously |

## 9. Protecting `main` (GitHub settings)

These settings make the rules above enforced rather than agreed. They live in the repository's
settings on GitHub, not in the code:

**Settings → Rules → Rulesets → New ruleset → New branch ruleset**
- Name: `main`; Enforcement status: **Active**.
- Target branches: **Add target → Include default branch**.
- Turn on:
  - **Restrict deletions**
  - **Require a pull request before merging** (required approvals: 0: the review routine merges
    ordinary pull requests on green checks, and GitHub doesn't let you approve your own)
  - **Require status checks to pass**, with **Require branches to be up to date before merging**;
    add the checks `backend`, `frontend`, `website`, `integration / run` and `guards` (`e2e` runs
    only before production deploys, CD-218; don't add it, it would never report on a pull request)
  - **Block force pushes**
- Bypass list: leave empty, so the rules apply to everyone.

For a **private** repository, GitHub enforces rulesets only on paid plans (GitHub Pro for a
personal account, or Team for an organization). On the free plan the ruleset can be created but
is not enforced; the rules then hold by agreement.

## 10. Dependencies and CI supply chain

- **Dependabot** (`.github/dependabot.yml`) opens pull requests every Monday for npm (backend,
  frontend, e2e), GitHub Actions and Docker images. Minor and patch updates come grouped; review
  and merge them like any other pull request (they don't need a Linear issue).
- Turn on **Settings → Advanced Security → Dependabot alerts** (and security updates), so a
  vulnerable dependency is reported as soon as it's published, not only when `npm audit` runs.
- **Actions are pinned by full commit SHA** with the version in a comment
  (`uses: owner/action@<sha> # v1.2.3`). A tag can be moved to other code; a SHA can't. This
  matters most for the deploy step, which receives the production SSH key. Add new actions the
  same way.
