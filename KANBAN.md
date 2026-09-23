# Kanban

Status of work on Cadence CRM. Move a card by cutting it into another section. Within a status,
cards are grouped by priority:

- **Critical**: blocks going live, or risks losing data.
- **High**: needed soon after launch.
- **Medium**: planned.
- **Low**: polish or later.

Each card is marked as a `Task` (something to build or do) or a `Bug` (something that behaves
wrong).

Last updated: 2026-09-23

---

## To do

### Critical

- [ ] `Task` **Set up the production server.** Create the Hetzner server (Ubuntu 26.04) and its
  Cloud Firewall, run `infra/server/bootstrap.sh`, clone the repo, and fill in `.env`.
  See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) §1–2.
- [ ] `Task` **Set up the Cloudflare Tunnel.** Add the domain to Cloudflare, create the tunnel,
  route `app.<domain>` to `http://frontend:80`, and put the token in `.env`. (§3)
- [ ] `Task` **Set up the identity provider (Auth0 or similar).** Create an SPA app and an
  API/audience, set the `OIDC_*` values, and put the user's email in the access token. Without
  the email, invitations can't be accepted. (§4)
- [ ] `Task` **Set up off-site backups and practise a restore.** Create a Hetzner Object Storage
  bucket or Storage Box, fill in `infra/backup/rclone.conf`, and store the encryption passphrases
  in a password manager. Then do one full restore. (§5)
- [ ] `Task` **Turn on automatic deploys.** Add the GitHub secrets `DEPLOY_HOST`, `DEPLOY_USER`
  and `DEPLOY_SSH_KEY`, the `OIDC_*` variables and `DEPLOY_ENABLED=true`, then do the first
  deploy. (§6)

### High

- [ ] `Task` **Email invitation links.** Choose an email provider and have the worker send the
  invite. For now the admin copies the link by hand.
- [ ] `Task` **Add monitoring and alerts.** Uptime checks on `/api/health/ready`, error tracking,
  and an alert when a backup fails or the disk is filling up.

### Medium

- [ ] `Task` **Add and remove funnel stages.** Both are blocked in the UI with a "not supported
  yet" message. Needs backend endpoints and rules for deals sitting in a removed stage.
- [ ] `Task` **Support more than two funnels.** The UI only shows the `smb` and `ent` funnels.
  Other funnels are ignored, including their deals.
- [ ] `Task` **Save the workspace settings.** Name, currency, timezone and fiscal year are only
  kept until the page is reloaded.
- [ ] `Task` **Save the profile settings.** Title, language, date format, start page, default
  funnel and daily digest aren't saved. The password fields do nothing, since the sign-in
  provider owns passwords, so remove them.
- [ ] `Task` **Documents: templates and generating proposals.** Needs the backend, file storage
  and the worker. Proposal generation is currently a demo animation.
- [ ] `Task` **Save the deal's discovery fields.** Need, constraint, decision maker, discovery
  date and headline are placeholders. The proposal document uses them.
- [ ] `Task` **Custom fields** (Settings → Customize Fields). Currently browser-only.
- [ ] `Task` **Notification and integration settings.** Currently browser-only toggles.
- [ ] `Task` **Sales bonus rules.** Currently browser-only.
- [ ] `Task` **Rate-limit the API.** At minimum on sign-in-related and write endpoints.
- [ ] `Bug` **A failed save can throw away unsaved typing.** After a save error the whole
  workspace reloads, which replaces anything typed but not yet saved.
- [ ] `Bug` **Other people's changes only appear after a reload.** Two users editing the same
  record overwrite each other silently. Needs refresh on focus or live updates, and conflict
  detection.

### Low

- [ ] `Task` **Billing tab.** Plan, seats and invoices are sample data. Needs a payment provider
  when there's a real plan.
- [ ] `Task` **Roadmap board.** Stored only in this browser (`localStorage`).
- [ ] `Task` **Show the workspace switcher in the sidebar.** Today it's only on the Profile page.
- [ ] `Task` **Split the frontend bundle into smaller chunks.** The Vite build warns that the
  bundle is over 500 kB.
- [ ] `Task` **Move the app to Node 24 LTS.** The backend, frontend and Docker images use Node 22.
- [ ] `Task` **Later domains: Projects, Workforce, Reporting, Finance.** These are sibling
  modules to CRM, per the architecture plan. The `crm.deal-won` job is the hook for handing a
  won deal over to delivery.
- [ ] `Task` **Edit a task after creating it.** Title, owner and due date can't be changed in
  the UI (the API supports it).
- [ ] `Task` **Offer Call and Note in the "New task" dialog.** It lists five of the seven
  channels.
- [ ] `Bug` **Deleting a task leaves its "Task added" entry on the deal's timeline.**
- [ ] `Bug` **Salesperson filters match by display name.** Two members with the same name are
  merged, and tasks or deals of a removed member lose their owner name.
- [ ] `Bug` **An update request with no fields returns a server error (500).** For example
  `PATCH /api/crm/deals/:id` with `{}`. It should return 400 or do nothing. The UI never sends
  one.
- [ ] `Bug` **Renaming a checklist item resets that to-do on existing deals.** Playbook to-dos
  are matched by their label.

---

## In progress

_Nothing right now._

---

## Testing

Built, but not yet checked in the real environment.

### Critical

- [ ] `Task` **The production Docker stack on a real server.** Images, Compose, migrations,
  backups and nginx were tested with Docker Desktop, but never on Hetzner with the tunnel.
- [ ] `Task` **The CI/CD pipeline on GitHub.** Checks and image builds should be green after the
  Node 24 action upgrade, but I couldn't confirm it because the repo is private. The new
  integration and e2e jobs were only simulated locally. The deploy job has never run.

### High

- [ ] `Task` **`bootstrap.sh` on Ubuntu 26.04.** The syntax is checked, but it hasn't been run
  on a real server. Changes to verify: the fail2ban journal backend and the SSH config test.
- [ ] `Task` **Sign-in with the real OIDC provider.** Only the dev login has been tested. Check
  sign-in, sign-out, the redirect back after sign-in, and accepting an invitation.

---

## Done

### Critical

- [x] `Task` Architecture template: NestJS modular monolith, PostgreSQL multi-tenancy (row-level
  security, composite foreign keys), pg-boss worker, Docker Compose, Cloudflare Tunnel, backups,
  CI/CD
- [x] `Task` Frontend connected to the API: sign-in, creating and picking a workspace, deals,
  companies, contacts, products, funnel stages, fit score, activity history
- [x] `Bug` nginx kept the API container's old IP address after a deploy, which caused 502 errors

### High

- [x] `Task` Browser tests in the repo (`e2e/`, 45 checks) and backend integration tests against
  PostgreSQL (41 checks: workspace isolation, roles, invitations, deal amounts), both run in CI
- [x] `Task` Delete deals, companies and contacts from the UI (owners and admins; a company with
  deals can't be deleted; deleting a contact keeps their deals)
- [x] `Task` Reassign a deal's owner (the server checks the owner is a workspace member, also on
  companies and contacts)
- [x] `Bug` Companies with the same name were merged: the UI now identifies companies by id
- [x] `Bug` The "New task" dialog saved nothing: tasks now have a due date, owner and channel, and
  show on Today and on the deal
- [x] `Task` Deal lines and payment schedules saved in the database (the deal amount is
  recalculated on the server)
- [x] `Task` Stage to-dos saved: playbook and off-playbook, done, outcome, note, and who
  completed them
- [x] `Task` Team invitations and member management (roles, owner rules, leaving a workspace)
- [x] `Task` Implemented the Claude Design handoff "Mini CRM v2" in React
- [x] `Bug` Scoring the fit score quickly lost updates. It now saves once, with the final value.

### Medium

- [x] `Task` Upgraded the GitHub Actions to Node 24 versions (fixed the deprecation warnings)
- [x] `Task` Target Ubuntu 26.04 LTS: docs updated and the bootstrap script made more reliable
- [x] `Task` The Roles & permissions tab shows the rules the API actually enforces
- [x] `Bug` Empty dropdowns showed their first option (for example "Architecture") instead of "—"
- [x] `Bug` Deal owners and the Salesperson filters showed sample names instead of real team
  members

### Low

- [x] `Task` Pushed the project to GitHub (`aleksandarkrst/crm`)
