---
name: start-issue
description: Start work on a Linear issue (CD-…) the way docs/WORKFLOW.md asks - read the issue, branch from origin/main with Linear's branch name, push the branch, move the issue to In Progress, and list the checks to run before review. Without an id, picks the top Ready for dev issue.
disable-model-invocation: true
argument-hint: "[CD-123]"
---

Start the Linear issue **$ARGUMENTS** (a `CD-…` id). Do these steps in order and stop at the first
one that fails; say what failed.

0. **No id given: pick the next issue.** The rule is one issue in development and one in QA.
   - If another issue in team Coding is already **In Progress**, start nothing: name it and stop.
   - Take the top issue in **Ready for dev**, in the board's manual order. The Linear MCP server
     can't read that order, so with `LINEAR_API_KEY` set, ask Linear's API for it:
     ```bash
     curl -s https://api.linear.app/graphql -H "Authorization: $LINEAR_API_KEY" \
       -H 'Content-Type: application/json' --data '{"query":"{ issues(first: 50, filter: { team: { key: { eq: \"CD\" } }, state: { name: { eq: \"Ready for dev\" } } }) { nodes { identifier title sortOrder } } }"}'
     ```
     and pick the lowest `sortOrder` (the top of the column). Without the key, use `list_issues`
     (team Coding, state `Ready for dev`) and pick by priority (Urgent first, no priority last),
     then the oldest; say that you did, so the user can add the key.
   - Nothing in Ready for dev: say so and stop.
   - Say which issue you picked and why, then go on with it as `$ARGUMENTS`.

1. **Read the issue** with the Linear MCP server (`get_issue` on `$ARGUMENTS`): title,
   description, acceptance criteria, parent issue, state, and its suggested branch name
   (`gitBranchName`). If the Linear server isn't available, say so and ask the user to paste the
   issue; don't guess its content.
2. **Check the working tree is clean** (`git status --porcelain`). If it isn't, stop and show the
   changes: switching branches with edits in flight mixes two issues.
3. **Branch from the latest `origin/main`**:
   ```bash
   git fetch origin
   git checkout -b <gitBranchName> origin/main
   git push -u origin <gitBranchName>
   ```
   Use Linear's branch name as it is (`aleksandar/cd-123-short-description`). If a branch with that
   name already exists locally or on origin, check it out instead and say so; never reuse `main`.
   Never work on `main`.
4. **Move the issue to In Progress** in Linear (`save_issue` with state `In Progress`) and
   assign it to the user if it has no assignee.
5. **Print a short plan**: the acceptance criteria as a checklist, the files or modules you
   expect to touch, and the checks that must pass before review:
   ```
   backend/   npm run lint && npm run typecheck && npm test && npm run build
   backend/   npm run test:integration        (dev database; see README "Tests")
   frontend/  npm run lint && npm run typecheck && npm run build
   website/   npm run lint && npm run build   (only when website/ changes)
   ```
   Remind yourself: commit messages start with `$ARGUMENTS:`, push after every commit, one pull
   request for this issue, and `/finish-issue` when the checks pass.

Then begin the work. If the issue is a parent with sub-issues, start the sub-issue instead and
keep the parent's id out of the branch name (a merged pull request closes every `CD-…` id in its
title, body and branch name).
