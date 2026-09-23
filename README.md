# Cadence CRM

Multi-tenant SMB business platform. A modular monolith (Node.js + TypeScript) on PostgreSQL,
deployed with Docker Compose on a Hetzner server behind a Cloudflare Tunnel. CRM is the first
domain; Projects, Workforce, Reporting and Finance come later as sibling modules.

```
frontend/   React + Vite UI (the "Mini CRM v2" design), served by nginx
backend/    NestJS API + background worker (same image), Drizzle ORM, pg-boss job queue
infra/      Postgres init (roles), backup container, server bootstrap
scripts/    deploy.sh — run on the server by CI
docs/       ARCHITECTURE.md, DEPLOYMENT.md
```

## Run it locally

Prerequisites: Node.js 22.12+ and Docker Desktop.

```bash
# 1. Database (PostgreSQL 17 on localhost:5432, with the app roles pre-created)
docker compose -f docker-compose.dev.yml up -d

# 2. Backend — API on :3000
cd backend
cp .env.example .env
npm install
npm run build && npm run db:migrate
npm run dev                 # API with reload
npm run dev:worker          # (second terminal) background worker

# 3. Frontend — UI on :5173 (proxies /api to :3000)
cd frontend
npm install
npm run dev
```

Open http://localhost:5173.

> **Current state of the UI:** every screen from the design is implemented, but it runs on an
> in-browser demo store (`frontend/src/store`) seeded with the design's sample data, so nothing
> is saved yet. The backend already has the matching API (companies, contacts, funnels, deals,
> activities, products). Switching screens to the API is the next step; see
> [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#frontend-demo-store--api).

Try the API directly (dev auth, no password):

```bash
TOKEN=$(curl -s localhost:3000/api/auth/dev-login -H 'content-type: application/json' \
  -d '{"email":"you@example.com","name":"You"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).accessToken')
curl -s localhost:3000/api/tenants -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"name":"My Studio"}'
# → use the returned id as X-Tenant-Id on /api/crm/* calls
```

## Commands

| Where | Command | What |
|---|---|---|
| backend | `npm run dev` / `npm run dev:worker` | API / worker with reload |
| backend | `npm test` · `npm run lint` · `npm run typecheck` | checks (also run in CI) |
| backend | `npm run db:generate -- --name <change>` | new migration from schema changes |
| backend | `npm run build && npm run db:migrate` | apply migrations |
| backend | `npm run db:studio` | browse the database |
| frontend | `npm run dev` · `npm run build` · `npm run lint` | UI |

## Connecting the tools (checklist)

Details and exact values are in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

- [ ] **GitHub**: create a repository and push. CI runs lint/tests/build on every PR. On `main`, it also builds images to GHCR and deploys.
- [ ] **Hetzner Cloud**: create an Ubuntu 24.04 server and a Cloud Firewall (allow TCP 22 only), then run `infra/server/bootstrap.sh`.
- [ ] **Cloudflare**: add the domain, create a Tunnel, route `app.yourdomain.com` → `http://frontend:80`, and copy the tunnel token into `.env`.
- [ ] **Identity provider** (Auth0, Zitadel, Keycloak, Entra ID…): create an SPA app and an API/audience, and set the `OIDC_*` values.
- [ ] **Off-site backups**: use Hetzner Object Storage or a Storage Box, fill in `infra/backup/rclone.conf`, and test a restore.
- [ ] **GitHub secrets/variables**: add `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`, then `DEPLOY_ENABLED=true` plus the `OIDC_*` variables.
