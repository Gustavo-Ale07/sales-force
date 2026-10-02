# Staging stack (SB-1) — configuration and runbook

Status: **configuration only, never deployed or started**. `deploy/docker-compose.staging.yml` plus
`deploy/staging/*`. OPS-3 (Caddy, GHCR, SSH deploy) is PROPOSED; OPS-1/OPS-2/DATA-1/DATA-2/STACK-2/SNK-3 are
APPROVED. Where this document chooses something PROPOSED it says so.

## Blockers before the first start (owner)

1. **Authentication mode (resolved for admin-only access).** Set `API_AUTH_MODE=local` and `WEB_AUTH_MODE=local`:
   Force-local Argon2id login for the `admin` profile only; seller/manager accounts are refused with the uniform
   `invalid_credentials`, there is no external login. `dev` is refused when `NODE_ENV=production`
   (`apps/server/src/config/api-env.ts`); never set `NODE_ENV=development` or `ALLOW_DEV_AUTH` in staging.
   Operational (seller) login stays unavailable until the external verifier exists (STACK-2, not decided).
2. Hosting provider, managed PostgreSQL product and PG major are NEEDS VALIDATION (V-04, V-15).
3. Image registry and deploy transport (OPS-3) are PROPOSED; this compose takes full image references.

## Topology

```
Internet :80/:443 -> edge (Caddy, TLS) -+-> /api/*  -> api:3000   (network edge+backend)
                                        +-> else    -> web:8080   (network edge)
backend network: api, worker, migrate, backup/restore-check, [postgres fallback] -> DATABASE_URL
```

| Service | Role |
|---|---|
| `migrate` | One-shot, same server image: `migrate/cli.js` (advisory-lock protected SQL migrations) then `queue-install.js`. `api` and `worker` start only on `service_completed_successfully`. |
| `api` | `dist/main-api.js`, `NODE_ENV=production`. No `SANKHYA_*`, no `SF_ALLOW_DEMO_ACCOUNTS`, no `ALLOW_DEV_AUTH`. |
| `worker` | `dist/main-worker.js`. Only service with Sankhya settings (`worker.env`). `SANKHYA_MODE=fake` + explicit `ALLOW_FAKE_GATEWAY=1` by default (production mode refuses a silent fake). |
| `web` | Static SPA (nginx). `WEB_AUTH_MODE` required. Not published. |
| `edge` | Caddy: the only published ports (80, 443, 443/udp). |
| `postgres` | Profile `self-hosted-db` only (staging fallback). |
| `backup`, `restore-check` | Profile `ops`, run with `run --rm`. |

Edge routing choice: Caddy sends `/api/*` straight to the API (one trusted hop, `TRUST_PROXY=1`, client address
from Caddy). Going through the web container's nginx would add a second hop and make the API see the proxy
address for every client (rate limiting and audit would collapse). Do not change `TRUST_PROXY` without
changing the routing.

## Database (OPS-1, OPS-2, DATA-1)

- **Preferred:** managed PostgreSQL >= 16, the same major as production, private networking only, PITR where the
  provider offers it for staging, separate credentials from production. `DATABASE_URL` in `database.env` with
  `sslmode=verify-full`. node-postgres reads `sslmode` from the URL; how the provider CA is supplied (system
  store vs a mounted `sslrootcert`) is NEEDS VALIDATION at the first managed rollout.
- **Staging-only fallback (explicit, never a production pattern):** `--profile self-hosted-db` starts the
  `postgres` container on the private `backend` network with a named volume, **no published port**, no WAL
  archiving, no PITR. Recovery point = last logical dump. OPS-2 allows a looser staging RPO; this must be the
  owner's explicit choice. `DATABASE_URL` then targets host `postgres`.
- Never a public or unrestricted database endpoint. Never production data in staging without approved
  sanitization (P-15). Staging holds no seed or demo accounts.

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
| `postgres.env` | postgres (fallback) | `POSTGRES_*` |
| `restore-test.env` | restore-check | `RESTORE_TEST_DATABASE_URL` (disposable DB) |

Examples with placeholders: `deploy/staging/*.env.example` (named so the repository `.gitignore` rule `.env.*`
does not hide them). Rotating a secret = edit the file, `up -d` the affected service. An encrypted off-server
secrets backup is PROPOSED in OPS-2 and not designed here: keep a copy in the team's password manager.

## Sankhya (SNK-3)

Default `SANKHYA_MODE=fake`. Live mode only against a non-production Sankhya (`SANKHYA_ENVIRONMENT`
`sandbox`|`homologation`; the gateway refuses `production`), with `SANKHYA_ALLOWED_HOSTS` set, `SYNC_MIRROR_ENABLED`
explicit, and the owner's authorization. ERP order submission stays disabled (SNK-4/SNK-5 gates). Credentials
only in `worker.env`.

## TLS and certificates

Caddy obtains and renews Let's Encrypt certificates automatically (HTTP-01/TLS-ALPN; needs a public DNS name and
ports 80/443 reachable). State lives in the `caddy_data` volume: back it up or accept re-issuance (mind rate
limits; the Caddyfile documents the ACME staging CA for rehearsals). HSTS is `max-age=86400` (short on purpose
for staging; no preload). If staging must not be public, use an IP allow-list at the host firewall or switch
Caddy to DNS-01 / internal CA: owner decision (open question 3). `X-Robots-Tag: noindex` is set. Access logs
strip Cookie, Authorization, X-Token and Set-Cookie.

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

## Deploy (manual, until OPS-3 is approved)

```sh
export SFC="docker compose --env-file /etc/salesforce/staging/compose.env -f deploy/docker-compose.staging.yml"
$SFC config -q                       # validates interpolation, required variables, file presence
$SFC pull
$SFC run --rm migrate                # explicit; `up` also runs it first through depends_on
$SFC up -d                           # add --profile self-hosted-db for the fallback database
curl -fsS https://$STAGING_DOMAIN/api/v1/ready
```

Never combine with `docker-compose.seed.yml` or `docker-compose.dev.yml`.

## Backup and restore (OPS-2; RPO <= 15 min / RTO <= 4 h are production targets)

Staging targets are looser (OPS-2) and recorded here: managed provider PITR where available, plus a daily
logical dump; with the self-hosted fallback the dump is the only copy (RPO up to the dump interval).

```sh
$SFC --profile ops run --rm backup           # pg_dump -Fc -> $SF_BACKUP_DIR/sf-staging-<UTC>.dump (+ .sha256)
$SFC --profile ops run --rm restore-check    # restores the newest dump into RESTORE_TEST_DATABASE_URL and checks it
```

- Schedule `backup` from the host (cron/systemd timer) and copy `$SF_BACKUP_DIR` to a second failure domain.
- **A dump counts only after `restore-check` passed on it.** Record the date, dump name and elapsed seconds
  (compare with RTO). Repeat monthly and after any migration that changes structure (OPS-2).
- Restoring staging itself: stop `api` and `worker`, restore into the (empty) database with `pg_restore --clean
  --if-exists --no-owner --dbname "$DATABASE_URL" <dump>` run from a postgres client container of the same major,
  start `api` and `worker`, check `/api/v1/ready`. For a PITR restore use the provider's procedure (NEEDS
  VALIDATION per provider, V-04) and point `DATABASE_URL` at the restored instance.
- `ops-restore-check.sh` asserts only generic facts (checksum, restore succeeds, tables exist). A
  business-level check against the deployed migration journal is still to be added after the first real run.

## Rollback (P-16: expand -> migrate -> contract)

- Images are pinned in `compose.env`. Keep the previous `SERVER_IMAGE`/`WEB_IMAGE` values; rollback = restore
  them and `$SFC up -d`. `migrate` re-runs the (idempotent) migration job of the older image: it never reverses
  schema changes.
- Therefore every migration must be backward compatible with the previous application version (expand), data
  moves happen in a separate step (migrate), and destructive changes ship one release later (contract), after
  the previous version can no longer be rolled back to. A contract migration or data-loss change needs the
  owner (CLAUDE.md §4) and a fresh dump verified by `restore-check` first.
- Before every deploy: take a dump (`backup`). If a migration fails, `api`/`worker` do not start (the old
  containers keep running only if you have not recreated them: run `migrate` first, as above).
- If the database must be restored to undo a bad migration, use the restore procedure above; the dump's
  version must match the image you roll back to.

## Open questions for the owner

1. Authentication: when does the production authentication mode land? Until then staging cannot run in
   production mode (Blocker 1). Accept a documented, time-boxed `NODE_ENV=development` staging? (Not done here.)
2. Database for staging: managed PostgreSQL (needs V-04/V-15) or the self-hosted fallback with a dump-only RPO?
3. Is staging public (ACME HTTP-01) or restricted (IP allow-list / DNS-01 / internal CA)? Domain name?
4. Registry and image-tag policy (GHCR by commit SHA is PROPOSED, OPS-3); who deploys and from where?
5. Where does the second-failure-domain copy of staging dumps go, and who runs the monthly restore test?
6. Brand files mount (`/brand`) is not wired in staging; add when a staging brand is wanted.
