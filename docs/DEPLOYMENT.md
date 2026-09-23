# Deployment: Hetzner + Docker + Cloudflare Tunnel

End state: pushing to `main` runs checks, builds versioned images to GitHub Container Registry,
then SSHes to the server and runs `scripts/deploy.sh <sha>`. That script:
1. checks out the commit
2. pulls the images
3. backs up the database
4. migrates
5. restarts the stack
6. waits for `/api/health/ready`

## 1. Server (Hetzner Cloud)

1. Create a server: **Ubuntu 24.04**, CX22 or larger, and add your SSH key.
2. Create a **Cloud Firewall**: inbound **TCP 22 only** (optionally restricted to your IP), and attach it to the server.
   This is the outer layer, and Docker cannot bypass it.
3. Copy and run the bootstrap script as root:
   ```bash
   scp infra/server/bootstrap.sh root@SERVER:/root/ && ssh root@SERVER bash /root/bootstrap.sh
   ```
   It installs Docker, creates the `deploy` user, disables password and root SSH, enables ufw
   (SSH only), and sets up automatic security updates and fail2ban.
4. As `deploy`, clone the repository into `/opt/crm`. For a private repo, add a read-only
   **deploy key** to GitHub.
   ```bash
   ssh deploy@SERVER
   git clone git@github.com:YOU/crm.git /opt/crm && cd /opt/crm
   cp .env.example .env && chmod 600 .env    # fill in — see below
   cp infra/backup/rclone.conf.example infra/backup/rclone.conf && chmod 600 infra/backup/rclone.conf
   ```

## 2. `.env` on the server

| Variable | Value |
|---|---|
| `IMAGE_PREFIX` | `ghcr.io/<github-user-or-org>/<repo>` (lowercase) |
| `POSTGRES_PASSWORD`, `APP_DB_PASSWORD` | `openssl rand -hex 32` each |
| `OIDC_ISSUER`, `OIDC_AUDIENCE`, `OIDC_CLIENT_ID` | from your identity provider (step 4) |
| `CLOUDFLARE_TUNNEL_TOKEN` | from step 3 |
| `BACKUP_RCLONE_REMOTE` | e.g. `offsite-crypt:crm` (step 5) |

For private GHCR images, log the server in once:
`echo <PAT with read:packages> | docker login ghcr.io -u <user> --password-stdin`.

## 3. Cloudflare Tunnel

1. Add your domain to Cloudflare. DNS must be managed by Cloudflare.
2. Go to **Zero Trust → Networks → Tunnels → Create tunnel (Cloudflared)**. Name it and copy the **token** into `CLOUDFLARE_TUNNEL_TOKEN`.
3. Under **Public hostname**, set `app.yourdomain.com` → service `HTTP` → `frontend:80`.
   nginx in the frontend container forwards `/api/*` to the API, so one route covers everything.
4. Optional: in **Cloudflare Access**, protect `app.yourdomain.com` with an access policy while in private beta.

Never route `postgres` through the tunnel. It is only on the internal Docker network.

## 4. Identity provider (OIDC)

Any OIDC provider works. For example, in Auth0:
- **API**: identifier = `OIDC_AUDIENCE` (e.g. `https://app.yourdomain.com/api`).
- **Single Page Application**: allowed callback `https://app.yourdomain.com/auth/callback`,
  logout URL `https://app.yourdomain.com`, web origin `https://app.yourdomain.com`.
  Its client ID goes in `OIDC_CLIENT_ID`.
- `OIDC_ISSUER` is the tenant URL, e.g. `https://your-tenant.eu.auth0.com/` (trailing slash as the provider issues it).

Set the same values as GitHub **variables** (`OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_AUDIENCE`),
because the frontend image bakes them in at build time.

## 5. Backups

- The `backup` container runs `pg_dump` every `BACKUP_INTERVAL_HOURS` into the `backups` volume and keeps `BACKUP_RETENTION_DAYS` days.
- Off-server copies:
  1. Create a Hetzner Object Storage bucket (or a Storage Box).
  2. Fill in `infra/backup/rclone.conf`. The `offsite-crypt` remote encrypts every file before upload.
  3. Store the crypt passphrases in your password manager. Without them the backups cannot be read.
- Run a backup now: `docker compose run --rm backup once`.
- A backup is also taken automatically before every deploy's migrations.

### Restore (practise this before you need it)

```bash
cd /opt/crm
docker compose stop api worker
docker compose run --rm --entrypoint ls backup -lh /backups        # pick a file
# or fetch an off-site copy:  docker compose run --rm --entrypoint rclone backup copy offsite-crypt:crm/<file> /backups/
docker compose run --rm --entrypoint restore.sh backup /backups/app-<timestamp>.dump
docker compose start api worker
```

## 6. GitHub Actions

Repository **secrets** (`Settings → Secrets and variables → Actions`):
- `DEPLOY_HOST` = the server's IP address
- `DEPLOY_USER` = `deploy`
- `DEPLOY_SSH_KEY` = the private key of a key pair whose public key is in `/home/deploy/.ssh/authorized_keys`

Repository **variables**:
- `DEPLOY_ENABLED=true` (deploys are skipped until you set it)
- `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_AUDIENCE`

The first deploy: push to `main`, or run the workflow manually. Watch it with `docker compose logs -f api worker` on the server.

## Operations cheat sheet

```bash
docker compose ps                         # status
docker compose logs -f --tail=100 api     # logs
docker compose run --rm migrate           # migrations by hand
bash scripts/deploy.sh <sha>              # deploy / roll back to any built commit
docker compose exec postgres psql -U app_admin app
```

**Rollback:** run `bash scripts/deploy.sh <previous-sha>`. Migrations should be backward-compatible
(add columns before code uses them, drop them one release later). A destructive migration
can't be undone this way, so restore the pre-deploy backup instead.

**When to outgrow one server:** once backups, restore tests and monitoring are routine and load
grows, move PostgreSQL to its own server or a managed service. Change `DATABASE_URL` and
`MIGRATION_DATABASE_URL`; nothing else changes.
