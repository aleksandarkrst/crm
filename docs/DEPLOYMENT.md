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

1. Create a server: **Ubuntu 26.04 LTS**, CX22 or larger, and add your SSH key.
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
| `APP_URL` | the public address, e.g. `https://app.yourdomain.com` (links in emails) |
| `APP_SECRET` | `openssl rand -hex 32` (encrypts invite links at rest; changing it breaks "Resend" for older invitations) |
| `MAIL_DRIVER`, `SMTP_URL`, `MAIL_FROM` | `smtp`, your provider's SMTP URL, and a sender on a domain verified with it (see below) |
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
- **Put the user's email in the access token.** Accepting a team invitation matches the invited
  address against the `email` claim of the access token (`backend/src/modules/identity/token.service.ts`).
  Auth0 leaves it out by default: add a post-login Action that sets the claim from a verified
  `event.user.email`. If your provider only allows namespaced custom claims, read that claim name in
  `token.service.ts`. Test it once by inviting yourself on a second email.

Set the same values as GitHub **variables** (`OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_AUDIENCE`),
because the frontend image bakes them in at build time.

## 4a. Email (SMTP)

The worker sends invitation emails, the daily digest and "deal assigned to you" emails through any
SMTP provider: Postmark, Resend, Amazon SES, Mailgun and most others offer SMTP.

1. Create an account, verify your sending domain (add the SPF/DKIM DNS records it gives you in
   Cloudflare DNS) and create SMTP credentials.
2. Set `MAIL_DRIVER=smtp`, `SMTP_URL=smtps://USER:PASSWORD@HOST:465` (or `smtp://…:587`;
   URL-encode special characters in the password) and `MAIL_FROM="Cadence <no-reply@yourdomain.com>"`.
3. Restart the worker (`docker compose up -d worker`), invite yourself on a second address and check
   that **Settings → Team** says "Email sent". A failed send is retried `MAIL_RETRY_LIMIT` times
   (default 4, backoff from 30 s) and then shown as "Email not delivered" with the reason; the logs
   have it too (`docker compose logs worker`).

With `MAIL_DRIVER=log` nothing is delivered: emails only go to the worker's log.

## 5. Backups

- The `backup` container runs `pg_dump` every `BACKUP_INTERVAL_HOURS` into the `backups` volume and keeps `BACKUP_RETENTION_DAYS` days.
- Each run also archives the file storage (the `app_storage` volume, mounted at `/storage`: uploaded
  document templates and generated documents) as `<db>-files-<timestamp>.tar.gz` next to the dump,
  right after it, and copies it off-server the same way. The database rows point at these files, so
  keep and restore the two together.
- Off-server copies:
  1. Create a Hetzner Object Storage bucket (or a Storage Box).
  2. Fill in `infra/backup/rclone.conf`. The `offsite-crypt` remote encrypts every file before upload.
  3. Store the crypt passphrases in your password manager. Without them the backups cannot be read.
- Run a backup now: `docker compose run --rm backup once`.
- A backup is also taken automatically before every deploy's migrations.
- **How much can be lost (CD-94).** A dump runs every `BACKUP_INTERVAL_HOURS` (6 by default; older
  `.env` files say 24, change it), so at most about 6 hours of work. If that is too much once
  customers rely on it, the next step is continuous WAL archiving (pgBackRest or WAL-G to the same
  bucket, point-in-time recovery to any second) or a managed PostgreSQL; both are decisions, not
  set up.
- **Retention.** Local and off-site daily copies: `BACKUP_RETENTION_DAYS` (14). Off-site also keeps
  one copy a week under `weekly/` for `BACKUP_WEEKLY_RETENTION_DAYS` (90), for problems noticed
  late.

### Protect the off-site copies from the server (CD-94)

`backup.sh` holds credentials that can delete, so root on the server (or a bug) could wipe the
off-site copies too. Make the bucket keep what was deleted:

1. Create the bucket with **Object Lock** enabled (it can only be turned on when the bucket is
   created, and it turns on versioning). For an existing bucket, create a new one, copy the backups
   over (`rclone copy offsite:old-bucket offsite:new-bucket`) and point `rclone.conf` at it.
2. Set a **default retention** of 30 days in **governance** mode (compliance mode can't be shortened
   even by you; switch to it once the setup has settled). Every uploaded version is then
   undeletable for 30 days: a delete from the server only adds a delete marker.
3. Add a **lifecycle rule** that expires noncurrent versions after 31 days, so deleted and pruned
   backups don't pile up. It needs no prefix, which matters because the crypt remote encrypts
   file and folder names.
4. If the provider supports it, give the server a key that can write and list but not delete. If
   not, Object Lock still protects every version for the lock period.
5. Run `docker compose run --rm backup once` and check the upload works (some providers want a
   checksum on uploads to locked buckets; rclone sends MD5).

To recover a backup that was deleted or pruned, list old versions with
`docker compose run --rm --entrypoint rclone backup lsl --s3-versions offsite-crypt:crm` and copy
the one you need to `/backups/` (try this during a restore drill).

### Restore (practise this before you need it)

```bash
cd /opt/crm
docker compose stop api worker
docker compose run --rm --entrypoint ls backup -lh /backups        # pick a file
# or fetch an off-site copy:  docker compose run --rm --entrypoint rclone backup copy offsite-crypt:crm/<file> /backups/
docker compose run --rm --entrypoint restore.sh backup /backups/app-<timestamp>.dump
# the files from the same run (replaces everything in the app_storage volume):
docker compose run --rm --entrypoint restore.sh backup /backups/app-files-<timestamp>.tar.gz
docker compose start api worker
```

How the database restore works: `restore.sh` restores the dump into a fresh database
(`app_restore`), grants the runtime role its access, gives it back the `pgboss` schema (pg-boss must
own its tables), checks that the runtime role can read the job queue, and only then swaps it in.
The database it replaced is kept as `app_before_restore`. If any step fails, the current database
is left untouched.

Check the restore before you throw away the old database:
1. `docker compose logs --tail=50 api worker` shows no `permission denied` errors.
2. Sign in and open a restored record.
3. Send an invitation (or generate a document) and check that `docker compose logs worker` shows
   the job being processed. This proves the job queue works, not only the tables.
4. Then free the space: `docker compose exec postgres dropdb -U app_admin app_before_restore`.
   To undo the restore instead, stop api and worker and rename the databases back.

Record each restore drill (date, backup used, which checks passed) in the table below.

| Date | Backup | Where | Result |
|---|---|---|---|
| | | | |

## 6. GitHub Actions

Repository **secrets** (`Settings → Secrets and variables → Actions`):
- `DEPLOY_HOST` = the server's IP address
- `DEPLOY_USER` = `deploy`
- `DEPLOY_SSH_KEY` = the private key of a key pair whose public key is in `/home/deploy/.ssh/authorized_keys`

Repository **variables**:
- `DEPLOY_ENABLED=true` (deploys are skipped until you set it)
- `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_AUDIENCE`

The server also needs access to GitHub, because `deploy.sh` fetches the commit it deploys:
- **Fetching the repo:** a read-only **deploy key** (`Settings → Deploy keys`, "Allow write access" off) whose private key is `/home/deploy/.ssh/crm_github`. Point git at it in `/home/deploy/.ssh/config`:
  ```
  Host github.com
    User git
    IdentityFile ~/.ssh/crm_github
    IdentitiesOnly yes
  ```
  Check it with `ssh -T git@github.com` as `deploy`: it should greet you by the repository name.
- **Pulling images:** nothing to set up. The images are private, so the `deploy` job logs the server in to GHCR with the job's own token, which expires when the job ends, and logs out again after the deploy. A manual `docker compose pull` on the server needs its own `docker login ghcr.io` with a token that has `read:packages`.

Use a separate key pair for `DEPLOY_SSH_KEY`, not a personal key, so it can be revoked on its own.

The first deploy: merge an approved pull request to `main`, or run the workflow manually on `main` with `verify_images` disabled. Watch it with `docker compose logs -f api worker` on the server.

### Verify Docker images before merging

On the CD-34 branch, open **Actions → CI / CD → Run workflow**, select that branch, and
check **Build both Docker images without publishing them** (`verify_images=true`). The
`backend`, `frontend`, `integration`, and `e2e` jobs must pass before `images` builds both
Dockerfiles with the configured frontend OIDC build arguments. Confirm both builds pass and
`deploy` is skipped. This verifies image builds; it does not run a production stack.

Verification skips GHCR login, image publishing, and deployment, even if `main` is selected
accidentally. An ordinary push to a feature branch does not start this workflow; open a pull
request for the four standard checks, or dispatch explicitly for image verification. If GitHub
does not offer **Run workflow**, the dispatch-enabled workflow must first exist on the default
branch. After review, normal pushes to `main` (and manual runs with verification disabled)
retain the existing image publishing and `DEPLOY_ENABLED`-gated deployment behavior.

## 7. Production server verification

Run this checklist on the Hetzner server after the first deploy, and again after changing the
Compose file, deployment script, tunnel, or backup setup. Docker Desktop is not a substitute for
this check: it does not exercise the server firewall, Linux volume permissions, GHCR login, or the
real Cloudflare Tunnel.

Before starting, record the date, server name, public hostname and deployed commit in the issue or
release notes. Do not paste secrets or the contents of `.env` into the record.

### Automated smoke test

After the first deploy, run the production smoke test **on the server as `deploy`**:

```bash
cd /opt/crm
bash scripts/verify-production.sh
# To check a different hostname than APP_URL:
bash scripts/verify-production.sh https://app.yourdomain.com
```

The test validates the rendered Compose configuration; confirms that PostgreSQL, the API, worker,
nginx, tunnel, and backup service are running; exercises health endpoints both inside Docker and
through the public tunnel; checks that no container publishes a host port; confirms the runtime
database role cannot bypass row-level security; reruns migrations to prove they are idempotent; and
creates and validates a fresh database backup. It exits non-zero if any check fails, making the
output suitable for attaching to the deployment issue.

The smoke test proves that a backup can be *created*, not that it can be restored. Complete the
restore drill in [Backups](#5-backups) separately, using a disposable server or during a planned
maintenance window. Also confirm the new dump and matching files archive exist in off-site storage;
that requires access to the storage provider and cannot be inferred from the local Docker volume.

The checks below cover the remaining production acceptance steps and troubleshooting.

### Stack and network

From `/opt/crm`, confirm that Compose resolves the production configuration and that every
long-running service is up. `migrate` is a one-shot tool and is not expected in `docker compose ps`.

```bash
cd /opt/crm
docker compose config --quiet
docker compose ps
docker compose images
git rev-parse HEAD
grep '^APP_VERSION=' .env
```

The commit from Git and `APP_VERSION` must match, and the frontend/backend images must carry that
version. `postgres`, `api`, `frontend`, `worker`, `cloudflared`, and `backup` should be running;
health-checked services should be healthy. Check that no container publishes a host port—the
`PORTS` column may show internal ports such as `3000/tcp` or `80/tcp`, but must not contain a host
mapping such as `0.0.0.0:3000->3000/tcp`:

```bash
docker compose ps --format 'table {{.Service}}\t{{.Status}}\t{{.Ports}}'
sudo ss -lntup
sudo ufw status verbose
```

Only SSH should be listening publicly. Also confirm in the Hetzner console that the attached Cloud
Firewall permits inbound TCP 22 only. Docker's internal listeners and loopback/system services are
acceptable; investigate any unexpected listener on `0.0.0.0` or `[::]` before continuing.

### Application, tunnel and worker

Test readiness inside the private Compose network and then through the actual public hostname:

```bash
docker compose exec -T api node -e \
  "fetch('http://127.0.0.1:3000/api/health/ready').then(async r => { console.log(r.status, await r.text()); process.exit(r.ok ? 0 : 1) })"
curl --fail --show-error --silent https://app.yourdomain.com/api/health/ready
docker compose logs --since=15m api worker frontend cloudflared
```

The two health checks must succeed, and the recent logs must not show a restart loop, database
authentication/migration failures, nginx upstream errors, or tunnel connection failures. In a
browser, sign in through the production OIDC provider and exercise one write/read path (for
example, create and then edit a test contact). This checks the frontend configuration, API proxy,
OIDC token, database runtime role and row-level-security path together. Trigger a worker-backed
action such as sending a test invitation, confirm it is processed in `worker` logs, keep the test record and an uploaded file for the persistence and restore checks below.

### Migrations and persistence

Migrations must be repeatable, and application data must survive a container replacement:

```bash
docker compose run --rm migrate
docker compose run --rm migrate
docker compose up -d --force-recreate api worker frontend
docker compose exec -T api node -e \
  "fetch('http://127.0.0.1:3000/api/health/ready').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
```

Both migration runs must exit successfully. Sign in again and confirm the test record still exists
after recreation. Keep it until the restore drill is complete, then remove the test data. Do not use `docker compose down -v`: `-v` deletes production
database, file and backup volumes.

### Backup and restore drill

Create a backup and verify both artifacts locally and off-server. The dump and files archive from
the same run share a timestamp and must be kept together.

```bash
docker compose run --rm backup once
docker compose run --rm --entrypoint sh backup -c \
  'ls -lh /backups && pg_restore --list "$(ls -1t /backups/*.dump | head -1)" >/dev/null && tar -tzf "$(ls -1t /backups/*-files-*.tar.gz | head -1)" >/dev/null'
docker compose run --rm --entrypoint sh backup -c 'rclone lsl "$BACKUP_RCLONE_REMOTE"'
```

All commands must succeed and the remote listing must contain the new pair. Complete the restore
test before enabling automatic deploys: use a fresh disposable server or an agreed maintenance
window, follow the [Restore](#restore-practise-this-before-you-need-it) procedure with that pair,
and verify login plus the restored test record and uploaded file. A backup has not been validated
until it has been restored successfully. Never perform an unplanned restore over live production.

### Deployment and rollback

Finally, verify the same path GitHub Actions will use rather than only running Compose commands by
hand:

1. Run the deploy workflow for a known commit and confirm its `scripts/deploy.sh` output includes a
   successful backup, migration and readiness check.
2. Confirm `git rev-parse HEAD`, `APP_VERSION`, and the image tags in `docker compose images`
   match the deployed SHA; both internal and public readiness URLs must return healthy responses.
3. Deploy the previous known-good image SHA with `bash scripts/deploy.sh <previous-sha>`, repeat the
   health and browser smoke tests, then deploy the intended SHA again. This tests application
   rollback only; it does not reverse a destructive database migration.
4. Check `docker compose ps` and the last 15 minutes of logs once more after the final deploy.

Record pass/fail and relevant non-secret output for each section. If any check fails, leave
`DEPLOY_ENABLED` unset or `false`, retain the failing container logs, and fix the production path
before enabling automatic deploys.

## 8. Monitoring and alerts

Three things tell you something is wrong before a user does (CD-8). Set up alert delivery (email,
and the Better Stack app for push notifications) under **Better Stack → Uptime → Who's on call**.

| What | Service | Alerts when |
|---|---|---|
| The app is reachable | Better Stack monitor on `/api/health/ready` | the check fails (app down, database down, tunnel down) |
| Backups | Better Stack heartbeat from `backup.sh` | a backup fails, or none arrives for a day |
| Disk space | Better Stack heartbeat from `backup.sh` (hourly) | the disk is 85% full, or the checks stop |
| Errors | Sentry (EU), backend and frontend projects | new unexpected errors (5xx, crashes, jobs out of retries) |

### Uptime (Better Stack)

**Uptime → Monitors → Create monitor**:
- URL `https://app.yourdomain.com/api/health/ready`, alert when **the URL becomes unavailable**
  (it returns 503 when the database is down).
- Check every 3 minutes, and confirm from 2 locations before alerting (avoids one-off blips).
- The rate limits never apply to `/api/health` (docs/ARCHITECTURE.md, "Rate limits").

### Backup and disk heartbeats (Better Stack)

**Uptime → Heartbeats → Create heartbeat**, twice:
- `crm backups`: expected every **1 day**, grace period **2 hours**.
- `crm disk`: expected every **1 hour**, grace period **30 minutes**.

Put their URLs in `/opt/crm/.env` as `BACKUP_HEARTBEAT_URL` and `DISK_HEARTBEAT_URL`, then run
`docker compose up -d --build backup`. After each backup, `backup.sh` calls the URL, or `<url>/fail`
when any step fails, including the off-site copy. Every hour it reports the disk use, and reports
a failure from `DISK_ALERT_PERCENT` (default 85). Better Stack also alerts when the calls stop,
so a stopped backup container is caught too. Test it with
`docker compose run --rm backup once`: the `crm backups` heartbeat should show a new success.

### Errors (Sentry)

Create an organization in the **EU data region** (sentry.io → "Data storage location: EU"), then
two projects: **Node.js** (`crm-backend`) and **React** (`crm-frontend`).
- Backend: put its DSN in `/opt/crm/.env` as `SENTRY_DSN`, then `docker compose up -d api worker`.
- Frontend: add the repository **variable** `SENTRY_FRONTEND_DSN` (a browser DSN is public by
  design). It is built into the next image, so it takes effect with the next deploy.
- Each error carries the deployed commit as its release.
- **Settings → Security & Privacy**: turn on **Data scrubbing** and **Prevent storing IP addresses**.
  The app already sends no request bodies, headers, cookies, IP addresses or local variables, and
  cuts invitation tokens and query strings out of URLs; the user appears only as an internal id.
- Set up alerts under **Alerts → Create alert → Issues**: "a new issue is created" → email.

What gets reported: API responses of 500 and above, crashes of the API and worker, background jobs
that failed their last retry (e.g. an email that could not be sent), and browser errors that break
the page. Client mistakes (4xx, including 429) are not reported.

## Operations cheat sheet

```bash
docker compose ps                         # status
docker compose logs -f --tail=100 api     # logs
docker compose run --rm migrate           # migrations by hand
bash scripts/deploy.sh <sha>              # deploy / roll back to any built commit
bash scripts/verify-production.sh         # smoke-test the live stack and tunnel
docker compose exec postgres psql -U app_admin app
```

**Rollback:** run `bash scripts/deploy.sh <previous-sha>`. Migrations should be backward-compatible
(add columns before code uses them, drop them one release later). A destructive migration
can't be undone this way, so restore the pre-deploy backup instead.

**When to outgrow one server:** once backups, restore tests and monitoring are routine and load
grows, move PostgreSQL to its own server or a managed service. Change `DATABASE_URL` and
`MIGRATION_DATABASE_URL`; nothing else changes.
