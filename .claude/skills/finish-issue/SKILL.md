---
name: finish-issue
description: Finish the current Linear issue the way docs/WORKFLOW.md asks - run the checks, have the reviewer agents look at the diff, push, open the pull request with the section 4 description, and move the issue to In Review. Never merges. Once the pull request is merged and on staging (QA), starts the next Ready for dev issue.
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
   outcome, whether the pull request touches a protected path (CLAUDE.md lists them; then the
   project owner merges it, otherwise the review routine does), and what is left to check on
   staging (docs/STAGING_CHECK.md). Don't wait for a human code review: once the pull request is
   ready for review with green CI, the hand-over is done.
10. **Wait for QA, then start the next issue.** The rule is one issue in development and one in
    QA. An issue reaches QA when its pull request is merged (Linear's GitHub automation moves it
    to QA) and the new build is on staging. Wait for both in the background, so the session costs
    nothing while the review routine (or the project owner, for a protected path) gets to it:
    ```bash
    # run_in_background: true. It exits when the PR leaves OPEN and staging has the merge commit.
    pr=<n>
    while [ "$(gh pr view $pr --json state -q .state)" = OPEN ]; do sleep 300; done
    [ "$(gh pr view $pr --json state -q .state)" = MERGED ] || { echo "PR $pr closed without merging"; exit 1; }
    sha=$(gh pr view $pr --json mergeCommit -q .mergeCommit.oid)
    until run=$(gh run list --workflow "CI / CD" --commit $sha --json databaseId -q '.[0].databaseId') && [ -n "$run" ]; do sleep 30; done
    gh run watch $run --exit-status >/dev/null
    gh run view $run --json jobs -q '.jobs[] | select(.name | startswith("deploy-staging")) | .conclusion'
    ```
    When it exits:
    - **Closed without merging**, a failed run, or a staging deploy that isn't `success`: start
      nothing. Tell the user what happened (the failed job and `gh run view <run> --log-failed`).
    - **On staging**: make sure the issue is in **QA** (`save_issue` with state `QA` if the
      automation didn't move it) and comment that the build is on staging, with
      `/staging-check <id>` as the tester's next step. Then, in a clean working tree, follow
      `.claude/skills/start-issue/SKILL.md` with no id: it picks the next **Ready for dev** issue
      and starts it. Letting the user test on localhost before the pull request still applies.
    If the session ends first, the next session picks step 10 up again from the PR number.

Never merge (`gh pr merge` is refused by a hook anyway), never push to `main`, and don't close
the Linear issue: the merge does that.
