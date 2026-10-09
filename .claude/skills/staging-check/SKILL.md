---
name: staging-check
description: Print the staging checklist (docs/STAGING_CHECK.md) for a Linear issue (CD-…) with its acceptance criteria filled in, so the person checking the change on staging knows what to look for.
disable-model-invocation: true
argument-hint: CD-123
---

Prepare the staging check for the Linear issue **$ARGUMENTS** (a `CD-…` id). Don't change any
file; the output is for the person who tests the change on staging, who may not read code.

1. **Read the issue** with the Linear MCP server (`get_issue` on `$ARGUMENTS`): title, description
   and its acceptance criteria (the "Acceptance criteria" section or the bullet list that reads
   like one). If the Linear server isn't available, say so and ask for the issue text; don't guess.
   Also read the pull request linked to the issue, if any, for "How it was tested" and screenshots.
2. **Turn the criteria into checks** a tester can do by clicking: for each criterion, where to
   go in the app (module, screen, button), what to do, and what they should see. Say which roles
   it applies to (member, admin, owner) when the issue does; otherwise all three.
3. **Print the checklist** from `docs/STAGING_CHECK.md`, in this shape, with the criteria from
   step 2 under questions 2, 3 and 4 and the screens the change touches named in questions 1 and 5:
   ```
   Staging check for CD-123: <title>
   Accounts: run `APP_DIR=/opt/crm-staging bash scripts/seed-staging.sh` on the server; it prints them.
   1. As Seed Alpha member (Mila): nothing from Bravo on <screens>, in search, or by URL.   yes / no
   2. As Seed Alpha member: <the criteria, one line each>                                    yes / no
   3. As Seed Alpha admin (Adam): the same, plus <admin-only criteria>                       yes / no
   4. As Seed Alpha owner (Ana): the same, plus <owner-only criteria>                        yes / no
   5. Phone width (about 400 px): <the new screen> is usable.                                yes / no
   Answers go in the pull request. Promote only when all five are yes.
   ```
4. Keep it short: a tester reads it on a phone next to the browser. No code, no file names.
