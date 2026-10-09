---
name: finish-issue
description: Finish the current Linear issue the way docs/WORKFLOW.md asks - run the checks, have the reviewer agents look at the diff, push, open the pull request with the section 4 description, and move the issue to In Review. Never merges.
disable-model-invocation: true
---

Finish the issue on the current branch and hand it over for review. Do the steps in order; stop
at the first failure and report it (a failing check is fixed, never skipped or deleted).

1. **Identify the issue**: the `CD-…` id from the branch name (`git branch --show-current`).
   Refuse to continue on `main` or on a branch without an id.
2. **Bring in `main`** if it moved: `git fetch origin` and, when `git log HEAD..origin/main`
   isn't empty, `git merge origin/main` (resolve conflicts, rerun the checks).
3. **Run the checks** for every package the diff touches (`git diff --name-only origin/main...HEAD`):
   ```
   backend/   npm run lint && npm run typecheck && npm test && npm run build
   backend/   npm run test:integration    (when the dev database is up; otherwise say CI will run it)
   frontend/  npm run lint && npm run typecheck && npm run build
   website/   npm run lint && npm run build
   ```
   Run the backend unit, integration and performance suites one at a time, never in parallel.
4. **Review the diff with the reviewer agents**, in the background, in parallel:
   - `tenant-security-reviewer` when `backend/` changed;
   - `design-fidelity-reviewer` when `frontend/src/` changed.
   Give each the diff range (`origin/main...HEAD`). Fix every blocker and should-fix they report,
   rerun the checks that cover the fix, and keep their notes for the pull request. If one reports
   `No findings.`, say so in the pull request.
5. **Docs**: `docs/ARCHITECTURE.md` (the module's section) and the README where behaviour
   changed. A new tenant table has its RLS migration; from the root, `sh scripts/check-rls.sh`,
   `sh scripts/check-migrations.sh origin/main` and `sh scripts/check-tenant-tests.sh origin/main`
   pass (CI's `guards` job runs them; a destructive migration needs a `migration-plan:` section in the PR).
6. **Commit and push**: commits start with `CD-…:`; `git push` (the branch has an upstream from
   `/start-issue`; otherwise `git push -u origin <branch>`). Nothing may stay unpushed.
7. **Open the pull request** as a draft to `main` with `gh pr create --draft --base main`:
   - Title: `CD-123: what it does` (every issue id this PR closes, no others: a merged PR closes
     each `CD-…` in the title, body and branch name).
   - Body, in this order (WORKFLOW.md section 4):
     ```
     ## What changed and why
     ## Decisions
     ## How it was tested
     (the commands and their numbers: tests passed, duration, what the reviewer agents found)
     ## Left undone
     (or "Nothing.")
     ## Screenshots
     (UI changes only; omit otherwise)
     ```
   Watch CI (`gh pr checks <n> --watch`). When `backend`, `frontend`, `website` and
   `integration / run` are green, mark it ready: `gh pr ready <n>`. If a check fails, fix it in a
   new commit, push, and watch again.
8. **Move the issue to In Review** in Linear (`save_issue` with state `In Review`) and add a
   comment with the pull request link, what was tested, and anything left undone or decided.
9. **Report** to the user: the PR link, the check results, the reviewer findings and their
   outcome, and what is left for the reviewer to decide.

Never merge (`gh pr merge` is refused by a hook anyway), never push to `main`, and don't close
the Linear issue: the merge does that.
