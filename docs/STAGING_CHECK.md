# Staging check: five yes/no questions

The human review of a change happens on staging (https://staging.pultly.com), not in the code.
This page is for whoever does it, in about ten minutes, with no need to read code. It's step 3 of
"From `main` to production" in [WORKFLOW.md](WORKFLOW.md#7-from-main-to-production) and the
"Review" step in section 5: a change is promoted only when every answer below is **yes**.

## Before you start

1. **Know what the change promises.** Open the Linear issue (`CD-…`, linked from the pull request)
   and read its acceptance criteria: what a user can do afterwards, for which roles. In Claude Code,
   `/staging-check CD-123` prints this checklist with those criteria filled in.
2. **Have the test accounts.** Staging has two seed workspaces, **Seed Alpha** and **Seed Bravo**,
   each with an owner, an admin and a member, and sample records in every module (companies,
   deals, a meeting, employees, a project with tasks, a work order, a submitted timesheet week).
   Whoever runs the server seeds or resets them with:
   ```bash
   APP_DIR=/opt/crm-staging bash scripts/seed-staging.sh
   ```
   It takes under a minute, can be run again any time (the workspaces are rebuilt, the accounts
   stay), and prints the six emails and the password at the end. These are test accounts; never
   use them on production.

   | Workspace | Owner | Admin | Member |
   |---|---|---|---|
   | Seed Alpha | `seed-a-owner@…` (Ana Alpha) | `seed-a-admin@…` (Adam Alpha) | `seed-a-member@…` (Mila Alpha) |
   | Seed Bravo | `seed-b-owner@…` (Boris Bravo) | `seed-b-admin@…` (Bela Bravo) | `seed-b-member@…` (Marko Bravo) |

   Everything in Alpha is named "Alpha …", everything in Bravo "Bravo …", so a record from the
   wrong workspace is easy to spot.
3. Use a private browser window per account, so sessions don't mix.

## The five questions

Write the answers (yes or no, and a sentence when it's no) in the pull request or the Linear issue.

| # | Signed in as | Check | Yes / no |
|---|---|---|---|
| 1 | **Seed Alpha member** (Mila) | **Nothing from Bravo is visible anywhere.** Open every list the change touches and the search box; type "Bravo". Open a Bravo record's URL copied from a Bravo session (companies, deals, projects, people): it must say not found, never show the record. | |
| 2 | **Seed Alpha member** (Mila) | **The change does what the issue's acceptance criteria say for a member.** Try each criterion. Where a member isn't allowed to do something, the button is missing or the screen says so. | |
| 3 | **Seed Alpha admin** (Adam) | **The same criteria as an admin.** Including anything the issue says only admins and owners may do (settings, approvals, other people's records). | |
| 4 | **Seed Alpha owner** (Ana) | **The same criteria as the owner.** Including workspace settings and anything that only the owner may do. | |
| 5 | Any account, **phone width** | **The new screen is usable on a phone.** Narrow the browser to about 400 px wide (or use the phone itself): nothing is cut off, every button can be pressed, the page doesn't scroll sideways. | |

If a question is **no**, say what you saw (screen, account, what happened) in the pull request.
The change goes back to a branch; nothing is promoted until all five are yes.

## After the check

- Promote: Actions → *Promote to production* → Run workflow (WORKFLOW.md section 7).
- Re-seed staging whenever the test data got messy: the seed command above resets both workspaces.
