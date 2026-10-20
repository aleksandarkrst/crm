# Agent instructions

Read and follow [CLAUDE.md](CLAUDE.md): it holds the rules for every coding agent in this repository
(Claude, Codex and others), including the branch and push rules.

## Cursor Cloud specific instructions

- Node.js 24.22.0 is on `PATH` (`/usr/local/bin`). The backend requires `>=24.11.0`.
- PostgreSQL 17 is installed on the VM and started on boot. It listens on `127.0.0.1:5432` with the same roles as `docker-compose.dev.yml`: database `app`, owner `app_admin` / `dev_admin_password`, runtime `app_runtime` / `dev_runtime_password`. Docker is not installed, so do not start `docker-compose.dev.yml` (it would also take port 5432).
- `backend/.env` is created from `backend/.env.example` when missing. Dev sign-in is passwordless (`AUTH_MODE=dev`).
- Boot starts tmux sessions `crm-api` (port 3000), `crm-worker`, `crm-web` (CRM on port 5173) and `crm-site` (marketing site on port 5174). Logs: `/tmp/crm-api.log`, `/tmp/crm-worker.log`, `/tmp/crm-web.log`, `/tmp/crm-site.log`.
- Lint, test and build commands are the ones in the README. Integration tests use this database.
