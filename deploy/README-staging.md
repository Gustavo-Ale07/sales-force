# Staging stack (SB-1) — configuration and runbook

Status: **configuration only, never deployed or started**. `deploy/docker-compose.staging.yml` plus
`deploy/staging/*`. OPS-3 (Caddy, SSH deploy) is PROPOSED; OPS-1/OPS-2/DATA-1/DATA-2/STACK-2/SNK-3 are
APPROVED. Where this document chooses something PROPOSED it says so.

**Staging behaves like production** (owner decision): `NODE_ENV=production`, `API_AUTH_MODE=local` and
`WEB_AUTH_MODE=local`, real HTTPS, no demo sellers, no seed overlay, no `SF_ALLOW_DEMO_ACCOUNTS`, no
`ALLOW_DEV_AUTH`, never `NODE_ENV=development`.

## Authentication

`local` = Argon2id login for the `admin` profile only; seller/manager accounts are refused with the uniform
`invalid_credentials` and there is no external login (operational login is OFF). `dev` is refused when
`NODE_ENV=production` (`apps/server/src/config/api-env.ts`). Operational (seller) login stays unavailable until the
external verifier exists: STACK-2 option C (a dedicated verifier) is chosen in direction but **not implemented**,
so the compose file has no verifier service; it will be added when the verifier exists.

## Open before the first start (owner)

1. Domain name (`STAGING_DOMAIN` is a placeholder) and whether staging is public or allow-listed (see TLS).
2. VPS provider and host sizing; the host's firewall must expose only 80/443 (and SSH from known addresses).
3. Where the off-VPS copy of dumps goes (see Backup) and who runs the restore-check.
4. Managed PostgreSQL remains the target (V-04, V-15); not a blocker for the initial staging.

## Topology

```
Internet :80/:443 -> edge (Caddy, TLS) -+-> /api/*  -> api:3000   (network edge+backend)
                                        +-> else    -> web:8080   (network edge)
backend network (private): api, worker, migrate, backup/restore-check, postgres (default) -> DATABASE_URL
```

| Service | Role |
|---|---|
| `migrate` | One-shot, same server image: `migrate/cli.js` (advisory-lock protected SQL migrations) then `queue-install.js`. `api` and `worker` start only on `service_completed_successfully`. |
| `api` | `dist/main-api.js`, `NODE_ENV=production`. No `SANKHYA_*`, no `SF_ALLOW_DEMO_ACCOUNTS`, no `ALLOW_DEV_AUTH`. |
| `worker` | `dist/main-worker.js`. Only service with Sankhya settings (`worker.env`). `SANKHYA_MODE=fake` + explicit `ALLOW_FAKE_GATEWAY=1` by default (production mode refuses a silent fake). |
| `web` | Static SPA (nginx). `WEB_AUTH_MODE` required. Not published. |
| `edge` | Caddy: the only published ports (80, 443, 443/udp). |
| `postgres` | Profile `self-hosted-db`: the default initial staging database. |
| `backup`, `restore-check` | Profile `ops`, run with `run --rm`. |

Edge routing choice: Caddy sends `/api/*` straight to the API (one trusted hop, `TRUST_PROXY=1`, client address
from Caddy). Going through the web container's nginx would add a second hop and make the API see the proxy
address for every client (rate limiting and audit would collapse). Do not change `TRUST_PROXY` without
changing the routing.

## Database (OPS-1, OPS-2, DATA-1)

- **Default initial staging database:** PostgreSQL in the `postgres` container on the same VPS, started with
  `--profile self-hosted-db`: private `backend` network only, **no published port**, named volume, same major as
  production (`PG_MAJOR`, V-15), staging-only credentials, `DATABASE_URL` targeting host `postgres`. It is
  isolated from production (separate host and credentials). There is no WAL archiving and no PITR.
- **Target:** managed PostgreSQL >= 16, same major as production, private networking only, PITR, separate
  credentials (V-04, V-15). Move by omitting the profile and pointing `DATABASE_URL` at it with
  `sslmode=verify-full` (how the provider CA is supplied is NEEDS VALIDATION at that rollout).
- Never a public or unrestricted database endpoint. Never production data in staging without approved
  sanitization (P-15). Staging holds no seed or demo accounts.
- Volume and VPS share one failure domain: losing the VPS loses the database and any dump stored only on it.

## Secrets (P-22, SEC-1)

Nothing secret is in the repository. Non-secret interpolation values come from a compose env file
(`deploy/staging/compose.env.example`); secrets from per-role files under `SF_SECRETS_DIR`, outside the
repository, owner-only permissions:

| File | Read by | Content |
|---|---|---|
| `database.env` | migrate, api, worker, backup, restore-check | `DATABASE_URL` |
| `api.env` | api | API-only overrides (may be empty; must exist) |
| `worker.env` | worker | `SANKHYA_*` (empty while fake) |
| `edge.env` | edge | `ACME_EMAIL` |
| `postgres.env` | postgres (default database) | `POSTGRES_*` |
| `restore-test.env` | restore-check | `RESTORE_TEST_DATABASE_URL` (disposable DB) |

Examples with placeholders: `deploy/staging/*.env.example` (named so the repository `.gitignore` rule `.env.*`
does not hide them). Rotating a secret = edit the file, `up -d` the affected service. An encrypted off-server
secrets backup is PROPOSED in OPS-2 and not designed here: keep a copy in the team's password manager.

## Sankhya (SNK-3)

Default `SANKHYA_MODE=fake`. Live mode only against a non-production Sankhya (`SANKHYA_ENVIRONMENT`
`sandbox`|`homologation`; the gateway refuses `production`), with `SANKHYA_ALLOWED_HOSTS` set, `SYNC_MIRROR_ENABLED`
explicit, and the owner's authorization. ERP order submission stays disabled (SNK-4/SNK-5 gates). Credentials
only in `worker.env`.

## TLS and certificates (real HTTPS)

Caddy obtains and renews Let's Encrypt certificates automatically (HTTP-01/TLS-ALPN; needs a public DNS name and
ports 80/443 reachable). State lives in the `caddy_data` volume: back it up or accept re-issuance (mind rate
limits; the Caddyfile documents the ACME staging CA for rehearsals). HSTS is `max-age=86400` (short on purpose
for staging; no preload).

Owner choice, public vs restricted: **public** (default of this file: anyone can reach the login page, admin-only
login, rate limits and lockout apply) or **allow-list** (host firewall/provider firewall restricting 80/443 to known
addresses; ACME HTTP-01 then needs port 80 open to the CA, so use DNS-01 or an internal CA instead; that needs a
Caddy DNS plugin build and is not configured here). `X-Robots-Tag: noindex` is set. Access logs strip Cookie,
Authorization, X-Token and Set-Cookie.

## Health, readiness, logs

- Liveness: API `GET /api/v1/health` (container healthcheck); worker loopback `GET /health` (container
  healthcheck); web `/` (image HEALTHCHECK); edge admin `127.0.0.1:2019` (container healthcheck).
- Readiness: API `GET /api/v1/ready` (200 ready/degraded, 503 not_ready; anonymous callers get only the coarse
  verdict). Use it in rollout checks and for the external uptime monitor (OPS-4 PROPOSED):
  `curl -fsS https://$STAGING_DOMAIN/api/v1/ready`.
- Logs: pino JSON on stdout; Docker `json-file` with rotation (10 MB x 5, compressed) on every service.
  Correlation IDs and scrubbing are application behavior (OPS-4). Central aggregation is deferred (R65).
- Containers run with `no-new-privileges`; server containers also `cap_drop: ALL`, read-only root filesystem and
  `tmpfs /tmp`. These were **not exercised at runtime**: confirm on the first staging boot and relax only with a
  recorded reason.

## Build and deploy (on the VPS, no external registry)

Images are built on the VPS from a checked-out git tag or commit. The image tag carries the commit SHA, so a
running version is always traceable and the previous images remain for rollback. No registry is required (a
registry reference in `SERVER_IMAGE`/`WEB_IMAGE` keeps working if one is adopted later; OPS-3 stays PROPOSED).

```sh
export SFC="docker compose --env-file /etc/salesforce/staging/compose.env -f deploy/docker-compose.staging.yml"
git fetch --tags && git checkout <tag-or-sha>          # detached, exact version; the tree must be clean
export SHA=$(git rev-parse --short=12 HEAD)
# set in compose.env:  SERVER_IMAGE=sales-force-server:$SHA   WEB_IMAGE=sales-force-web:$SHA
$SFC config -q                                         # interpolation, required variables, file presence
$SFC --profile self-hosted-db --profile ops run --rm backup   # dump BEFORE changing anything
$SFC build migrate web                                 # see note
$SFC --profile self-hosted-db run --rm migrate         # explicit; `up` also runs it first via depends_on
$SFC --profile self-hosted-db up -d
curl -fsS https://$STAGING_DOMAIN/api/v1/ready
```

Note: `migrate`, `api` and `worker` share the one server image, so building `migrate` builds it once. No registry
`pull` is part of this path (`$SFC pull edge` only fetches the Caddy image). The one-shot `backup` needs the database running: on the very first deploy skip it.

Tag retention: keep at least the last 5 server/web image tags (`docker image ls sales-force-server`); prune
older ones manually with `docker image rm` only after confirming the current and previous tags are kept. Never
use `docker system prune -a` on this host.

Never combine with `docker-compose.seed.yml` or `docker-compose.dev.yml`.

## Backup and restore (OPS-2)

**Honest status against the targets.** RPO <= 15 min and RTO <= 4 h are production targets (OPS-2). With the
default self-hosted database, **this setup does not meet RPO <= 15 min**: the only recovery source is a logical
dump, so the real RPO is the time since the last good dump, i.e. up to the dump interval (daily dump = up to
about 24 h of data lost; if the dump is only on the VPS and the VPS is lost, everything since the last off-VPS
copy). Dumps every 15 minutes would not be a sound answer (load, size, no point-in-time choice). Meeting 15 min
needs continuous WAL archiving to storage outside the VPS (e.g. pgBackRest or WAL-G to private S3-compatible
storage) or a managed PostgreSQL with PITR (V-04): neither is configured here. OPS-2 allows staging a looser
target; this is the recorded staging position, to be confirmed by the owner. RTO is **unmeasured** until the
first `restore-check` run; record its elapsed seconds.

```sh
$SFC --profile self-hosted-db --profile ops run --rm backup         # pg_dump -Fc -> $SF_BACKUP_DIR/sf-staging-<UTC>.dump (+ .sha256), 14 kept (BACKUP_KEEP)
$SFC --profile self-hosted-db --profile ops run --rm restore-check  # restores the newest dump into RESTORE_TEST_DATABASE_URL and checks it
```

- **Schedule** `backup` from the host (cron/systemd timer), at least daily and before every deploy. The dump
  verifies `pg_restore --list` and writes a SHA-256 checksum next to it; retention keeps the newest 14.
- **Off-VPS copy (owner item):** copy `$SF_BACKUP_DIR` (dump and `.sha256`) to a second failure domain (other
  provider/account, access separated from the VPS) and verify the checksum after copying. The destination,
  credentials and encryption are not defined here.
- **Restore-check is required and scheduled**, not optional: run it monthly, after any migration that changes
  structure and after the first dump, from a cron/timer, and record date, dump name and elapsed seconds
  (compare with RTO). **A dump counts as a backup only after `restore-check` passed on it** (OPS-2). Point
  `RESTORE_TEST_DATABASE_URL` at a scratch database (a second database in the same `postgres` container is fine;
  it must differ from `DATABASE_URL`, the script refuses otherwise).
- Restoring staging itself: stop `api` and `worker`, restore into the (empty) database with `pg_restore --clean
  --if-exists --no-owner --dbname "$DATABASE_URL" <dump>` run from a postgres client container of the same major,
  start `api` and `worker`, check `/api/v1/ready`. For a managed PITR restore use the provider's procedure
  (NEEDS VALIDATION per provider, V-04) and point `DATABASE_URL` at the restored instance.
- `ops-restore-check.sh` asserts only generic facts (checksum, restore succeeds, tables exist). A
  business-level check against the deployed migration journal is still to be added after the first real run.

## Rollback (P-16: expand -> migrate -> contract)

- Rollback = previous tag: set `SERVER_IMAGE`/`WEB_IMAGE` in `compose.env` back to the previous SHA tags (still
  present locally, see tag retention) and `$SFC --profile self-hosted-db up -d`. If the old tag is gone, check
  out its git tag and rebuild. `migrate` re-runs the (idempotent) migration job of the older image: it never
  reverses schema changes.
- Therefore every migration must be backward compatible with the previous application version (expand), data
  moves happen in a separate step (migrate), and destructive changes ship one release later (contract), after
  the previous version can no longer be rolled back to. A contract migration or data-loss change needs the
  owner (CLAUDE.md §4) and a fresh dump verified by `restore-check` first.
- Before every deploy: take a dump (`backup`). Run `migrate` before recreating `api`/`worker`; if it fails the
  old containers keep running, because they have not been recreated.
- If the database must be restored to undo a bad migration, use the restore procedure above; the dump's
  version must match the image you roll back to.

## Mobile

Not part of this stack. Mobile staging notes, if useful later, live under `.claude/work/` (working notes, not
decisions); nothing here changes for mobile.

## Open questions for the owner

1. Domain name, and public vs allow-list access for staging (TLS section).
2. Confirm the staging recovery position (dump-only, RPO = dump interval) or fund WAL archiving / managed
   PostgreSQL (V-04, V-15) for staging.
3. Destination, credentials and encryption of the off-VPS dump copy; who runs the monthly restore-check.
4. VPS provider/sizing and who deploys (SSH access) and from where; OPS-3 deploy transport remains PROPOSED.
5. Brand files mount (`/brand`) is not wired in staging; add when a staging brand is wanted.
6. Operational (seller) login on staging waits for the external verifier (STACK-2 option C, not implemented).
