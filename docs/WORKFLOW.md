# Development workflow

How work moves from an idea to production in Cadence CRM. It applies to everyone who changes the
code: people and coding agents (Claude, Codex and others). The short rules for agents are in
[CLAUDE.md](../CLAUDE.md); this page explains the whole process and why.

```
Linear issue ──▶ branch ──▶ build + test ──▶ pull request ──▶ CI green ──▶ review ──▶ merge
                                                                                       │
                     production ◀── release (tag or approval) ◀── staging ◀────────────┘
```

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

## 2. One branch per issue

- Create the branch from the **latest `origin/main`**, named after the issue. Linear shows a
  branch name on every issue (`aleksandar/cd-20-…`); `cd-20-short-description` works too.
- **Push it to GitHub right away** and after every commit. Work that only exists on one computer
  or in one session can't be reviewed and is lost if the session stops.
- **Never work on `main` directly.** Everything reaches `main` through a pull request.
- **Commit messages start with the issue ID**: `CD-20: close the live-update stream on pagehide`.

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

Also try the change in the app (`npm run dev`), at desktop and phone width when it touches the UI.
Passing tests are not the same as working software.

## 4. Pull request

When the checks pass, open a pull request to `main`:

- **Title** with the issue IDs: `CD-20, CD-69: live updates and change history`.
- **Description**: what changed and why, decisions made, how it was tested (with numbers), and
  anything left undone. Screenshots for UI changes.
- Move the Linear issue to **In Review** and link the pull request (Linear links it automatically
  when the branch name or title contains the issue ID).

**GitHub CI** then runs four checks on the pull request: `backend`, `frontend`, `integration` and
`e2e`. All four must be green before merging.

The image build can also be checked before merging. Run **CI / CD** from the Actions tab against
the branch and enable **Build both Docker images without publishing them**. The four checks run
first, followed by `images`; verification never pushes an image or starts `deploy`, even on `main`. See [image verification](DEPLOYMENT.md#verify-docker-images-before-merging) for dispatch steps and the default-branch prerequisite.

## 5. Review

The reviewer (today: the project owner) checks:

- **Does it do what the issue asked?** Try it, don't only read the test results.
- **Database migrations**, line by line: they are the hardest thing to undo once live.
- **Permissions**: who can see or change what (owner, admin, member), and that one workspace can
  never see another's data.
- **Scope**: changes outside the issue need a reason.
- **Docs**: `docs/ARCHITECTURE.md` and the README updated where behaviour changed.

A second agent in a fresh session can review too, e.g. with Claude Code's `/code-review`; it
catches different things than the agent that wrote the code.

Review comments are answered on the pull request: fixed in a new commit, or explained.

## 6. Merge

- Merge only when CI is green and the review is done.
- The branch must be **up to date with `main`** first, so the checks ran against what will
  actually be on `main`.
- After merging, delete the branch. Linear moves the issue to **Done**.

## 7. From `main` to production

After every merge, CI runs again on `main` and then:

1. **`images`**: builds the backend and frontend Docker images and stores them in GitHub's
   container registry, tagged with the commit (the frontend twice: production and `-staging`,
   because the sign-in app is compiled into it).
2. **`deploy-staging`**: deploys the commit to staging (https://staging.simplicity-labs.com,
   same server, own database) and runs the smoke test there.
3. **Check it on staging**: whoever merged opens staging and tries the change.
4. **Promote to production**: Actions → *Promote to production* → Run workflow (or
   `gh workflow run promote.yml`). It deploys the commit staging runs now and smoke-tests
   production. Only commits that passed staging can be promoted.

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
- **Backups with a practised restore** (CD-5) before real customer data goes in.
- **Secrets never in the repository**: they live in GitHub secrets and on the server. Agents never
  get production credentials.

## 8. Keeping the project's memory

| File | What it holds | Who updates it |
|---|---|---|
| `CLAUDE.md` | The rules every agent follows | When an agent repeats a mistake, add a line |
| `AGENTS.md` | Points Codex and other agents to CLAUDE.md | Rarely |
| `docs/ARCHITECTURE.md` | How the system works | Every pull request that changes behaviour |
| `docs/WORKFLOW.md` | This process | When the process changes |
| `KANBAN.md` | A snapshot of the plan by milestone | When a milestone starts or ends |
| Linear | The source of truth for what's planned and done | Continuously |

## 9. Protecting `main` (GitHub settings)

These settings make the rules above enforced rather than agreed. They live in the repository's
settings on GitHub, not in the code:

**Settings → Rules → Rulesets → New ruleset → New branch ruleset**
- Name: `main`; Enforcement status: **Active**.
- Target branches: **Add target → Include default branch**.
- Turn on:
  - **Restrict deletions**
  - **Require a pull request before merging** (required approvals: 0 while you are the only
    reviewer; GitHub doesn't let you approve your own pull request)
  - **Require status checks to pass**, with **Require branches to be up to date before merging**;
    add the checks `backend`, `frontend`, `integration` and `e2e`
  - **Block force pushes**
- Bypass list: leave empty, so the rules apply to everyone.

For a **private** repository, GitHub enforces rulesets only on paid plans (GitHub Pro for a
personal account, or Team for an organization). On the free plan the ruleset can be created but
is not enforced; the rules then hold by agreement.
