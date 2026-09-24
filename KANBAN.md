# Kanban

Tasks and bugs are tracked in Linear: team **Coding**, project **CRM**
(https://linear.app/eazy-budget/project/crm-e2524915935f). Issue IDs start with `CD-`.
Linear is the source of truth; this file is a snapshot of the plan by milestone.

Work is planned by **milestone**, one at a time. The plan is in the project document
"Product plan: making Cadence better".

Put the issue ID in the branch name and in the commit or PR message, so the work links back to
the issue. Each issue shows its branch name.

## 0 · Foundation (done)

Architecture, the React port of the design, the API connection, tests in CI, invitations and the
first round of fixes: CD-37 to CD-55.

## 1 · Trustworthy basics (done)

Everything on screen is real, and everything labeled "saved" is saved.

- CD-56 Overview shows made-up numbers
- CD-57 The date filter on Overview does nothing
- CD-58 Success messages for actions that save nothing
- CD-11 Save the workspace settings
- CD-12 Save the profile settings
- CD-19 A failed save can throw away unsaved typing
- CD-29, CD-30, CD-31, CD-59, CD-72: small bugs and leftover demo values
- CD-71 Remove the Roadmap page

## 2 · Close the sales loop (done)

Deals end as won or lost, the funnel can be shaped freely, and Overview measures real conversion.

- CD-60 Mark a deal as lost, with a reason
- CD-61 Record stage history for every deal
- CD-62 Real conversion metrics on Overview
- CD-9 Add and remove funnel stages
- CD-10 Support more than two funnels
- CD-14 Save the deal's discovery fields
- CD-73 Use the workspace currency, time zone and fiscal year
- CD-27, CD-28, CD-32, CD-74: task, checklist and follow-up fixes

## 3 · Find and move faster (done)

- CD-63 Global search (Ctrl/⌘+K)
- CD-64 Import companies, contacts and deals from CSV
- CD-65 Export lists to CSV
- CD-66 Quick "New…" button in the header
- CD-67 Overdue tasks and reminders
- CD-23 Workspace switcher in the sidebar
- CD-24 Smaller frontend bundle
- CD-75 Reliable browser tests (dev proxy fix)

## 4 · Ready for a team (next)

Several people working in one workspace.

- CD-20 Other people's changes appear without a reload
- CD-69 Change history on records
- CD-68 First-run onboarding for a new workspace
- CD-70 Works on tablets and phones
- CD-7 Email invitation links
- CD-16 Notification settings
- CD-13 Documents: templates and generating proposals
- CD-15 Custom fields
- CD-17 Sales bonus rules
- CD-76 Small bugs found while building milestones 2 and 3
- CD-77 Currency: product prices and changing a deal's currency
- CD-78 Cleanup: checklist label compatibility and missing tests

## 5 · UX/UI improvements

- CD-80 Global search and New button: remove the per-screen New buttons and search fields (and the
  New button in Workspace settings); Ctrl/⌘+K opens a command palette to search and run any action
- CD-81 Import & Export: move them from the list screens to Workspace settings, for managers, admins
  and owners

## Go live (needs the server)

Starts once the server is bought, alongside the product milestones.

- CD-2 Set up the production server
- CD-3 Set up the Cloudflare Tunnel
- CD-4 Set up the identity provider (Auth0 or similar)
- CD-5 Set up off-site backups and practise a restore
- CD-6 Turn on automatic deploys
- CD-8 Add monitoring and alerts
- CD-18 Rate-limit the API
- CD-25 Move the app to Node 24 LTS
- CD-33 to CD-36: verify the Docker stack, CI/CD, bootstrap.sh and sign-in on the real server

## Later (not planned yet)

- CD-79 Integrations: prepare backend and frontend for Outlook & Calendar, Microsoft Nav, Gmail,
  Google Calendar, Google Drive, WhatsApp Business, LinkedIn and Slack; unconnected channels show a
  "connect your …" message on the deal
- CD-21 Billing tab
- CD-26 Later domains: Projects, Workforce, Reporting, Finance
