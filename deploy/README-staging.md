# Staging stack (SB-1) — configuration and runbook

Status: **never deployed to a VPS; validated only on a disposable local stack (2026-10-02 certification)**. `deploy/docker-compose.staging.yml` plus
`deploy/staging/*`. OPS-3 (Caddy, SSH deploy) is PROPOSED; OPS-1/OPS-2/DATA-1/DATA-2/STACK-2/SNK-3 are
APPROVED. Where this document chooses something PROPOSED it says so. Owner decisions of 2026-10-02 applied here:
dedicated internal verifier (STACK-2 option C, structure only), least-privilege database roles, staging RPO of 24 h
with an off-VPS copy, real HTTPS on the planned `force-staging` host, SSH deploy by a dedicated non-root user.

**Staging behaves like production** (owner decision): `NODE_ENV=production`, `API_AUTH_MODE=local` and
`WEB_AUTH_MODE=local`, real HTTPS, no demo sellers, no seed overlay, no `SF_ALLOW_DEMO_ACCOUNTS`, no
`ALLOW_DEV_AUTH`, never `NODE_ENV=development`.

## Authentication

`local` = Argon2id login for the administrative/technical profiles only (the role gate is enforced in code, not by
this stack); there is no external login (operational login is OFF). `dev` is refused when `NODE_ENV=production`
(`apps/server/src/config/api-env.ts`). Operational (seller) login stays unavailable until the real Sankhya
verifier exists.

### Internal verifier (STACK-2 option C, structure only)

`Web/Mobile -> Force API -> internal verifier -> Sankhya`. The `verifier` service is the same server image with its
own entry point (`dist/main-verifier.js`) and its own secret file (`verifier.env`):

- **Internal only:** network `verifier` (`internal: true`: no route to or from the outside), **no published port**,
  not on `edge`; the API is the only other member. The worker is not on it and gets none of the verifier
  secrets; the API holds no Sankhya credential; the worker never receives a user password.
- **Disabled mode only:** `VERIFIER_MODE=disabled` is set by the compose file. The real Sankhya adapter is
  **BLOCKED_EXTERNAL_SECRET**: `live` is refused at boot as "not implemented", unknown modes are refused, and the
  process refuses to boot if it finds any Sankhya, database, session, SMTP or Sentry setting. `POST
  /internal/verify` answers a uniform denial (`{"ok":false,"code":"denied"}`, 403); there is no success path in
  this build.
- **Caller authentication:** shared secret (`VERIFIER_SHARED_SECRET`, >= 32 characters, `Authorization: Bearer`),
  compared in constant time; wrong or missing secret = 401 with a minimal body.
- **Hardening:** body limit (2 KiB default), 5 s deadline, in-process throttle (30 requests/minute, 4 concurrent),
  bodies and headers never logged, password only in memory for the duration of the request (JavaScript strings
  cannot be wiped: best effort), fail closed on every error.
- **Not wired yet:** the API client for the verifier is part of the external-login work. `api.env.example` carries
  the reserved `VERIFIER_URL` / `VERIFIER_SHARED_SECRET` lines (not read by the API today).
- A live adapter will need, by a separate reviewed change: the validated Sankhya login mechanism (spike), a minimal
  credential subset in `verifier.env`, a restricted egress path to the Sankhya hosts only (the `verifier` network
  has none today), a per-login failure budget below Sankhya's own lockout threshold, and a security review.

## Open before the first start (owner)

1. DNS for `force-staging.sistemasplac.com.br` (planned `STAGING_DOMAIN`; production later
   `force.sistemasplac.com.br`) is **not created**; no DNS change was made. The record must point at the VPS before
   the first start.
2. VPS provider and host sizing; the host firewall exposes 80/443 publicly and SSH only as in "SSH and deploy user".
3. The off-VPS backup location (bucket, credentials, age recipient key) is **pending infrastructure**; nothing in
   the repository names one. Who runs the restore-check.
4. Managed PostgreSQL remains the target (V-04, V-15); not a blocker for the initial staging.
5. The one-time role bootstrap (`db-roles`) is run by the owner with the database administrator credential.

## Topology

```
Internet :80/:443 -> edge (Caddy, TLS) -+-> /api/*  -> api:3000   (networks edge+backend+verifier)
                                        +-> else    -> web:8080   (network edge)
verifier network (internal, no outbound): api <-> verifier:3002
backend network (private): api, worker, migrate, backup/restore-check/db-roles, postgres (default) -> DATABASE_URL
egress network (outbound only): offsite job
```

| Service | Role |
|---|---|
| `migrate` | One-shot, same server image, **as `force_migrator`** (`migrate.env`): `migrate/cli.js` (advisory-lock protected SQL migrations) then `queue-install.js`. `api` and `worker` start only on `service_completed_successfully`. |
| `api` | `dist/main-api.js`, `NODE_ENV=production`, **as `force_api`** (`api.env`). No `SANKHYA_*`, no demo/dev flags. |
| `worker` | `dist/main-worker.js`, **as `force_worker`** (`worker.env`). Only service with Sankhya settings. `SANKHYA_MODE=fake` + explicit `ALLOW_FAKE_GATEWAY=1` by default. |
| `verifier` | Internal identity verifier, disabled mode (see above). `verifier.env`. |
| `web` | Static SPA (nginx). `WEB_AUTH_MODE` required. Not published. |
| `edge` | Caddy: the only published ports (80, 443, 443/udp). |
| `postgres` | Profile `self-hosted-db`: the default initial staging database (superuser from `postgres.env`, used by nothing else but the owner's bootstrap). |
| `backup`, `restore-check`, `migrate-safe` | Profile `ops`, run with `run --rm`. |
| `offsite` | Profile `offsite`: off-VPS copy of the newest verified dump. |
| `db-roles` | Profile `ops-admin`: one-time role bootstrap by the owner. |

Edge routing choice: Caddy sends `/api/*` straight to the API (one trusted hop, `TRUST_PROXY=1`, client address
from Caddy). Going through the web container's nginx would add a second hop and make the API see the proxy
address for every client (rate limiting and audit would collapse). Do not change `TRUST_PROXY` without
changing the routing.

## Database (OPS-1, OPS-2, DATA-1)

- **Default initial staging database:** PostgreSQL in the `postgres` container on the same VPS, started with
  `--profile self-hosted-db`: private `backend` network only, **no published port**, named volume, same major as
  production (`PG_MAJOR`, V-15), staging-only credentials. It is isolated from production (separate host and
  credentials). There is no WAL archiving and no PITR.
- **Target:** managed PostgreSQL >= 16, same major as production, private networking only, PITR, separate
  credentials (V-04, V-15). Move by omitting the profile and pointing the three `DATABASE_URL`s at it with
  `sslmode=verify-full` and, when the provider uses a private CA, `&sslrootcert=<mounted CA file>` with that file
  mounted read-only in migrate, migrate-safe, api, worker, backup and restore-check (see `migrate.env.example`).
  Whether the provider lets the owner run `db-roles.sql` (GRANT/REVOKE on the database and schema) is NEEDS
  VALIDATION per provider. Never weaken verification to pass a TLS error.
- **Least-privilege roles (owner decision 2026-10-02).** `deploy/staging/db-roles.sql` defines `force_migrator`
  (owns the schema, DDL, used by the one-shot migration jobs only), `force_api` and `force_worker` (DML only on
  what each needs, see the matrix in the file) and `force_backup` (read-only: `pg_read_all_data`, no write, no
  DDL; used by `backup` and by the live-side read of `restore-check`, `backup.env`). None is a superuser. Each
  service has its own `DATABASE_URL` in its own env file. **The PostgreSQL superuser is used by no application
  service.** The restore target is a scratch database with its own credential (`restore-test.env`), created once
  by the administrator; `force_backup` never gets write access or `CREATEDB`.
- Never a public or unrestricted database endpoint. Never production data in staging without approved
  sanitization (P-15). Staging holds no seed or demo accounts.
- Volume and VPS share one failure domain: losing the VPS loses the database and any dump stored only on it
  (see the off-VPS copy below).

### Role bootstrap (once, by the owner)

`db-roles` runs `psql` as the database administrator with the four passwords supplied from `db-admin.env`
(outside the repository, never in the compose file or the arguments). Generate four different passwords
(`openssl rand -hex 32`), put them in `db-admin.env` and in the matching `DATABASE_URL`s (`migrate.env`,
`api.env`, `worker.env`, `backup.env`). An installation that already ran the earlier three-role bootstrap adds
`FORCE_BACKUP_PASSWORD` and re-runs `db-roles` (idempotent) before the next `backup`.

```sh
$SFC --profile self-hosted-db up -d postgres                 # database exists
$SFC --profile ops-admin run --rm db-roles                   # 1: roles, schema pgboss, grants for existing tables
$SFC --profile self-hosted-db run --rm migrate               # 2: tables are created by force_migrator
$SFC --profile ops-admin run --rm db-roles                   # 3: grants for the tables that now exist (idempotent)
```

Step 3 is required because `db-roles.sql` skips tables that do not exist yet; **re-run it after any release whose
migration adds a table** (new tables are deny-by-default for api and worker until the grant matrix names them).
The script refuses a missing variable, an application role as the administrator, weak or reused passwords and
unexpected characters; it was exercised against a throwaway PostgreSQL 17 (see "Validation status").

## Secrets (P-22, SEC-1)

Nothing secret is in the repository. Non-secret interpolation values come from a compose env file
(`deploy/staging/compose.env.example`); secrets from per-role files under `SF_SECRETS_DIR`, outside the
repository, owner-only permissions:

| File | Read by | Content |
|---|---|---|
| `migrate.env` | migrate, migrate-safe | `DATABASE_URL` as `force_migrator` |
| `backup.env` | backup (and migrate-safe through it), restore-check (live side) | `DATABASE_URL` as the read-only `force_backup` |
| `api.env` | api | `DATABASE_URL` as `force_api`, API-only settings |
| `worker.env` | worker | `DATABASE_URL` as `force_worker`; `SANKHYA_*` (empty while fake) |
| `verifier.env` | verifier | `VERIFIER_SHARED_SECRET` (nothing else) |
| `edge.env` | edge | `ACME_EMAIL` |
| `postgres.env` | postgres (default database) | `POSTGRES_*` (superuser) |
| `db-admin.env` | db-roles (owner, one time) | admin connection + the four role passwords |
| `restore-test.env` | restore-check | `RESTORE_TEST_DATABASE_URL` (disposable DB) |
| `offsite.env` | offsite | S3 endpoint/bucket/keys, age recipient (pending infrastructure) |

Examples with placeholders: `deploy/staging/*.env.example` (named so the repository `.gitignore` rule `.env.*`
does not hide them). Rotating a secret = edit the file, `up -d` the affected service (a rotated role password also
needs `db-roles`). An encrypted off-server secrets backup is PROPOSED in OPS-2 and not designed here: keep a copy
in the team's password manager.

## First admin account

Staging has no seed and no demo accounts, so the first admin is created once, by hand, with the account CLI
from the built server image (password read from stdin, never on the command line; never reuse a demo password):

```sh
export SFC="docker compose --env-file /etc/salesforce/staging/compose.env -f deploy/docker-compose.staging.yml"  # same as "Build and deploy"
<secrets-manager command that prints the new admin password> \
  | $SFC run --rm -T --no-deps -e ALLOW_REMOTE_DB=1 \
      api node dist/account-cli.js create --email <admin address> --name "<name>" --role admin --password-stdin
```

`-T` disables the pseudo-terminal so the piped password reaches stdin; the password comes from a secrets manager
or password-manager CLI through the pipe, never typed as an argument and not left in shell history.
`ALLOW_REMOTE_DB=1` is needed only when `DATABASE_URL` is not loopback (the compose network host is not). The CLI
runs as `force_api`, which holds INSERT/UPDATE on the account tables. Keep `SF_ALLOW_DEMO_ACCOUNTS` out of every
secrets file. Without an admin nobody can sign in under `AUTH_MODE=local`. (The invocation was run against a
disposable local stack in the 2026-10-02 certification; repeat it on the VPS.)

## Installation configuration (first start)

A fresh database has **no configuration snapshot**: `GET /api/v1/configuration` serves the conservative disabled
default (`contentHash: null`, `source.version: "unconfigured"`), every commercial route answers `409
installation_not_enabled`, and the worker's mirror jobs fail (`No current installation configuration`, recorded as
`unclassified` in `sync_state` and in the dead-letter queue). The development seed (`pnpm db:seed`) is the only other
writer of the snapshot and refuses `NODE_ENV=production` and any non-loopback database, so staging uses a one-shot
command, **`config-bootstrap`** (`apps/server/src/config-bootstrap.ts`), which reuses the seed's loader
(`BootstrapFileConfigurationSource`) and the `InstallationConfigurationSchema` contract:

```sh
$SFC --profile self-hosted-db run --rm --no-deps \
  -v /etc/salesforce/staging/installation.json:/config/installation.json:ro \
  -e INSTALLATION_CONFIG_FILE=/config/installation.json \
  migrate node dist/config-bootstrap.js
```

- **Runs as `force_migrator`** (the `migrate` service and its `migrate.env`): `force_api` and `force_worker` hold no
  write grant on `installation_configuration_version`, on purpose. The command refuses `NODE_ENV` other than
  `production`, validates the file with the contract schema and the domain consistency rules, and refuses a file that
  carries a demo account address (`DEMO_ACCOUNTS`) or `features.demoMetrics`. The source is always `bootstrap-file`.
- **Idempotent:** the same content is a no-op (`installation configuration unchanged (sha256:...)`; the hash ignores
  `syncedAt`). Changed content becomes the new current version and the previous versions are kept. Re-run it whenever
  the file changes; the API and worker read the snapshot on every use, so no restart is needed.
- **The file is the owner's:** its content (company, TOP, negotiation types, seller links, price-table policy, sellable
  usage values) is customer configuration governed from Sankhya (CFG-1..6) and is **not in this repository**. It holds
  configuration only, never a secret. Keep it outside the repository next to the env files. U-11 (the long-term source
  before the Sankhya-side model exists) stays UNDECIDED: this command is the mechanism, not that decision.
- **Deterministic order for a fresh installation:** `postgres` -> `db-roles` -> `migrate` -> `db-roles` ->
  **`config-bootstrap`** -> first admin (below) -> `up -d` -> `/api/v1/ready`. Starting `worker` before the
  configuration only produces the failed mirror jobs described above (they repeat on the next schedule once the
  configuration exists).

## Sankhya (SNK-3)

`SANKHYA_MODE` is required (no implicit default); `compose.env.example` sets `fake` with the explicit
`ALLOW_FAKE_GATEWAY=1` (staging then serves synthetic data). Live mode only against a non-production Sankhya (`SANKHYA_ENVIRONMENT`
`sandbox`|`homologation`; the gateway refuses `production`), with `SANKHYA_ALLOWED_HOSTS` set, `SYNC_MIRROR_ENABLED`
explicit, and the owner's authorization. ERP order submission stays disabled (SNK-4/SNK-5 gates). Sync credentials
only in `worker.env`; the verifier and the API never hold them.

## TLS and certificates (real HTTPS)

Owner decision: **real HTTPS, public**. Caddy obtains and renews Let's Encrypt certificates automatically
(ACME HTTP-01 / TLS-ALPN) for `STAGING_DOMAIN` (planned `force-staging.sistemasplac.com.br`), which needs the
public DNS record and ports 80 and 443 reachable from the internet. **The mobile app must not depend on an IP
allow-list or a VPN**, so there is no allow-list mode in this stack (a DNS-01 variant would need a Caddy DNS
plugin build and is not configured). State lives in the `caddy_data` volume: back it up or accept re-issuance
(mind rate limits; the Caddyfile documents the ACME staging CA for rehearsals). HSTS is `max-age=86400` (short on
purpose for staging; no preload). Anyone can reach the login page: login is restricted by role in code, and rate
limits and lockout apply. `X-Robots-Tag: noindex` is set. Access logs strip Cookie, Authorization, X-Token and
Set-Cookie. The verifier is never routed through Caddy.

## Health, readiness, logs

- Liveness: API `GET /api/v1/health` (container healthcheck); worker loopback `GET /health`; verifier loopback
  `GET /health`; web `/` (image HEALTHCHECK); edge admin `127.0.0.1:2019`.
- Readiness: API `GET /api/v1/ready` (200 ready/degraded, 503 not_ready; anonymous callers get only the coarse
  verdict). Use it in rollout checks and for the external uptime monitor (OPS-4 PROPOSED):
  `curl -fsS https://$STAGING_DOMAIN/api/v1/ready`.
- Logs: pino JSON on stdout; Docker `json-file` with rotation (10 MB x 5, compressed) on every service.
  Correlation IDs and scrubbing are application behavior (OPS-4). Central aggregation is deferred (R65).
- Containers run with `no-new-privileges`; server containers also `cap_drop: ALL`, read-only root filesystem and
  `tmpfs /tmp`. These were exercised on a disposable local stack (2026-10-02 certification): confirm again on the
  first VPS boot and relax only with a recorded reason.
- Verifier isolation check on first boot (exercised locally; repeat on the VPS): `$SFC ps` must show no published port for `verifier`;
  `$SFC exec api node -e "fetch('http://verifier:3002/health').then(r=>console.log(r.status))"` answers 200;
  `$SFC exec edge wget -qO- http://verifier:3002/health` and `$SFC exec worker ...` must fail (name not resolved).

## Build and deploy (on the VPS, no external registry)

Images are built on the VPS from a checked-out git tag or commit. The image tag carries the commit SHA, so a
running version is always traceable and the previous images remain for rollback. No registry is required (a
registry reference in `SERVER_IMAGE`/`WEB_IMAGE` keeps working if one is adopted later; OPS-3 stays PROPOSED).
The deploy runs as the dedicated deploy user (next section).

```sh
export SFC="docker compose --env-file /etc/salesforce/staging/compose.env -f deploy/docker-compose.staging.yml"
git fetch --tags && git checkout <tag-or-sha>          # detached, exact version; the tree must be clean
export SHA=$(git rev-parse --short=12 HEAD)
# set in compose.env:  SERVER_IMAGE=sales-force-server:$SHA   WEB_IMAGE=sales-force-web:$SHA
$SFC config -q                                         # interpolation, required variables, file presence
$SFC build migrate web                                 # see note
# MANDATORY pre-migration backup, then the migration, in one command: if the dump fails nothing is migrated.
$SFC --profile self-hosted-db --profile ops run --rm migrate-safe
$SFC --profile ops-admin run --rm db-roles             # ONLY if the release adds a table (grants for new tables)
$SFC --profile self-hosted-db up -d
curl -fsS https://$STAGING_DOMAIN/api/v1/ready
```

**Pre-migration backup is part of every deploy**, not an optional courtesy. `migrate-safe` makes it one command
(`backup` is a compose dependency that must complete successfully); doing it by hand is equivalent:
`run --rm backup`, check it printed `wrote ...`, then `run --rm migrate`. Exception: the very first deploy has no
database content yet, use plain `migrate` (see "Role bootstrap" for the first-deploy order). `migrate-safe` was exercised on a
disposable local stack in the 2026-10-02 certification (a failing backup stops the migration); repeat it on the VPS.
`restore-check` drops every non-system schema of its scratch database: it relies entirely on the identity guards
above it, so never point its URL at a database you care about.

Note: `migrate`, `api`, `worker` and `verifier` share the one server image, so building `migrate` builds it
once. No registry `pull` is part of this path (`$SFC pull edge` only fetches the Caddy image).

Tag retention: keep at least the last 5 server/web image tags (`docker image ls sales-force-server`); prune
older ones manually with `docker image rm` only after confirming the current and previous tags are kept. Never
use `docker system prune -a` on this host.

Never combine with `docker-compose.seed.yml` or `docker-compose.dev.yml`.

## SSH and deploy user (OPS-3 PROPOSED; nothing is changed on the VPS by this repository)

Strategy the owner applies by hand when the VPS exists:

- **A dedicated, non-root deploy/ops user** (for example `sfdeploy`), used for builds, `docker compose`, backups
  and restore checks. No routine work as root; no `sudo` rights for this user. The user owns
  `/etc/salesforce/staging` (0700; secret files 0600) and `SF_BACKUP_DIR`.
- **SSH key authentication only:** a key pair generated on the operator's machine (or held in a secrets manager),
  public key in the deploy user's `authorized_keys`; `PasswordAuthentication no`, `PermitRootLogin no`,
  `AllowUsers sfdeploy <admin>`; no password flow for that account (`passwd -l`). **No private key is stored in the
  repository, in CI variables checked into Git, or on the VPS.** A CI-driven deploy (GitHub Actions over SSH) is
  PROPOSED and would use a separate, deploy-only key kept in the CI secret store and a forced command or restricted
  key options; it is not set up here.
- **Least privilege, honestly:** to run Docker the user must be in the `docker` group, which is **root-equivalent
  on the host** (anyone who controls it can mount the host filesystem into a container). That is accepted for
  staging only because the account is single-purpose, key-only, not shared, and its login is audited (`auth.log`).
  Alternatives, with their costs: rootless Docker for that user (no root-equivalence, but binding ports 80/443
  needs `net.ipv4.ip_unprivileged_port_start=80` and some compose features behave differently, not validated here),
  or a small sudo-allowed wrapper that runs only the fixed deploy commands (moves the risk into the wrapper). For
  production this choice is to be revisited (OPS-3 is PROPOSED).
- **Host firewall:** 80/443 public (ACME HTTP-01 and the app), 22 from known addresses where possible (not a
  substitute for key-only auth), nothing else (no PostgreSQL port, no verifier port: both stay on private
  networks).
- Keep the host patched (unattended security updates) and enable SSH login audit; both are host tasks outside this
  repository.

## Backup and restore (OPS-2)

**Honest status against the targets.** RPO <= 15 min and RTO <= 4 h are production targets (OPS-2). For staging the
owner accepted **RPO = 24 h** (2026-10-02): a daily dump, copied off the VPS. With the default self-hosted database
there is no WAL archiving and no PITR, so up to about 24 h of staging data can be lost, and if the VPS is lost, everything since
the last off-VPS copy. Dumps every 15 minutes would not be a sound answer. Meeting 15 min needs continuous WAL
archiving to storage outside the VPS (pgBackRest or WAL-G to private S3-compatible storage) or a managed
PostgreSQL with PITR (V-04): neither is configured here, and the production RPO is not met by this setup. RTO is
**unmeasured** until the first `restore-check` run; record its elapsed seconds.

```sh
$SFC --profile self-hosted-db --profile ops run --rm backup         # pg_dump -Fc -> $SF_BACKUP_DIR/sf-staging-<UTC>.dump (+ .sha256), 14 kept (BACKUP_KEEP)
$SFC --profile self-hosted-db --profile ops run --rm restore-check  # restores the newest dump into RESTORE_TEST_DATABASE_URL and checks it
$SFC --profile offsite run --rm offsite                             # uploads the newest verified dump + .sha256 off the VPS
```

- **Schedule** (host cron or systemd timer, as the deploy user): `backup` daily and before every migration (the
  deploy runs it through `migrate-safe`), then `offsite` right after it succeeds; `restore-check` at least monthly,
  after the first dump, and after any migration that changes structure. Record date, dump name and elapsed
  seconds. The dump verifies `pg_restore --list` and writes a SHA-256 checksum next to it; retention keeps the
  newest 14 locally.
- **A dump counts as a backup only after `restore-check` passed on it** (OPS-2). Point `RESTORE_TEST_DATABASE_URL`
  at a scratch database (a second database in the same `postgres` container is fine) that the administrator
  created once, owned by its own role (see `restore-test.env.example`); it is never `force_backup` or
  `force_migrator`. On success `restore-check` writes `<dump>.restore-ok` (a copy of the dump's checksum line).
- **Ops containers** (`backup`, `restore-check`, `offsite`, `db-roles`) run as `SF_OPS_USER` (compose env: the
  `uid:gid` of the deploy user that owns `SF_BACKUP_DIR` and the checked-out `deploy/` files), with all
  capabilities dropped and no new privileges: without `CAP_DAC_OVERRIDE` root could not read the 0600 dumps of
  another user, so they do not run as root. `edge` keeps only `NET_BIND_SERVICE` (its mounted `Caddyfile` must be
  world-readable, 0644); `web` runs with a read-only root filesystem and a tmpfs `/tmp`.
- **Optional off-site gate:** `OFFSITE_REQUIRE_RESTORE_MARKER=1` in `offsite.env` makes `offsite` upload a dump only
  when its `<dump>.restore-ok` exists and matches the dump's `.sha256` (default `0`: no gate). The job streams the
  `age` ciphertext to the upload instead of staging it locally, so its tmpfs is capped at 16 MB whatever the dump
  size.
- **Restore-check guards**, all before anything is restored (`ops-restore-check.sh`): both URLs go through a strict
  parser (`ops-lib.sh`) that accepts only `postgres://USER:PASSWORD@HOST[:PORT]/DBNAME`, with a database name of
  `A-Za-z0-9_.-`, a bracketed IPv6 host, no `@` or `/` in the path, no host lists, and a query limited to `sslmode`,
  `sslrootcert`, `connect_timeout` (no `%`, so no `host=`/`port=`/`dbname=`/`password=` override in any spelling);
  the parsed host/port/database of the target must differ from `DATABASE_URL`; the target database name must contain
  `restore`, `test` or `scratch` and **the live database name must not**; and, authoritatively, after connecting to
  both, the pair (`pg_control_system().system_identifier`, `current_database()`) of the two connections must
  differ, else it refuses (it also refuses when either identity cannot be read). Same cluster with another
  database is allowed (the pair differs), so the system identifier alone is not the criterion. An optional
  dump-name argument must be a plain `sf-staging-*.dump` name (no `/`, no `..`). `ops-backup.sh` applies the same
  URL parser. Passwords reach `pg_dump`/`pg_restore`/`psql` through the environment of each command, not
  the argument list; percent-encode reserved characters in URL credentials (hex passwords need none).
- **Off-VPS copy (second failure domain), through an S3-compatible interface** (`ops-offsite-sync.sh`, `offsite`
  profile). Chosen mechanism: AWS CLI v2 against `OFFSITE_S3_ENDPOINT` (works with any S3-compatible service, no
  vendor SDK), in an image built from `deploy/staging/Dockerfile.offsite` on a pinned Alpine (`OFFSITE_BASE_IMAGE`;
  a prebuilt pinned image can replace it via `OFFSITE_IMAGE`). **Client-side encryption with `age`** (public-key
  recipient `OFFSITE_AGE_RECIPIENT`; the private key stays with the owner, never on the VPS) is included in that
  image; the job refuses to upload unless a recipient is set or the owner explicitly sets
  `OFFSITE_ALLOW_UNENCRYPTED=1` (provider-side encryption only). It uploads only a dump whose `.sha256` verifies,
  then checks the stored copy: size and, by default, a re-download whose SHA-256 must equal the local one
  (`OFFSITE_VERIFY=size` to skip the download). It refuses to run if the endpoint, bucket or keys are unset, never
  prints keys, and uses no instance-metadata probing. **Retention is the bucket's lifecycle policy**, on purpose
  not this job: give the key write+read but not delete/overwrite (and enable versioning or object lock if the
  provider has it) so a compromised VPS cannot destroy the off-site copies. Restoring from off-site: download the
  `.dump` (decrypt `.age` with the private key), put it and its `.sha256` in `SF_BACKUP_DIR`, run `restore-check`.
  **The real location and credentials are pending infrastructure** (owner item): nothing here names a bucket or
  provider; choose one that meets the OPS-1/STACK-7 criteria (private, Brazil preferred, separate account/provider
  from the VPS).
- Restoring staging itself: stop `api` and `worker`, restore into the (empty) database with `pg_restore --clean
  --if-exists --no-owner --dbname "$DATABASE_URL" <dump>` run from a postgres client container of the same major
  as the owner role (`migrate.env`: `force_backup` is read-only and cannot restore), run `db-roles` again (the dump is taken `--no-privileges`), start `api` and `worker`, check
  `/api/v1/ready`. For a managed PITR restore use the provider's procedure (NEEDS VALIDATION per provider, V-04)
  and point the `DATABASE_URL`s at the restored instance.
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
- Before every deploy: the pre-migration dump (`migrate-safe`). `migrate` runs before `api`/`worker` are
  recreated; if it fails the old containers keep running, because they have not been recreated.
- If the database must be restored to undo a bad migration, use the restore procedure above; the dump's
  version must match the image you roll back to.

## Mobile

Not part of this stack. The mobile app reaches the public HTTPS host and must not depend on an allow-list or VPN.
Mobile staging notes, if useful later, live under `.claude/work/` (working notes, not decisions).

## Validation status (what was and was not exercised)

Exercised against throwaway containers (PostgreSQL 17 on a private Docker network, an `rclone serve s3` S3 endpoint,
Alpine with `aws-cli` + `age`; all removed afterwards): `ops-backup.sh` (dump, listing check, checksum, retention,
URL refusals), `ops-restore-check.sh` (successful restore, every guard refusal listed above, checksum mismatch,
identity guard with a stubbed `psql`), `ops-db-roles.sh` with `db-roles.sql` (refusals; roles created, no
superuser, login works), `ops-offsite-sync.sh` (refusals; plain and age-encrypted upload verified by download and
by size; wrong key rejected). `docker compose config -q` passes for the default set and with all profiles, and the
Caddyfile validates.

Also exercised afterwards (PostgreSQL 16 Alpine, Alpine with `age` and a stub `aws`, `caddy:2`, an nginx-unprivileged
web image, all removed): the four-role bootstrap and `force_backup` (read-only, `pg_dump` works, writes denied) as uid
1001 with `--cap-drop ALL --security-opt no-new-privileges --read-only` and a tmpfs; `backup` and `restore-check`
with that profile against a named volume owned by 1001 (restore into a separate scratch role/database, `.restore-ok`
written); the offsite job as uid 1001 with a 16 MB tmpfs and a 43 MB dump (age streamed, verified by download; gate on
with a valid, stale and missing marker; a failing `age` detected); Caddy with `cap_drop ALL` + `NET_BIND_SERVICE`
(binds 80, writes its volumes, access log without `Proxy-Authorization`, cookies or any query string); the web image
with a read-only root filesystem and a tmpfs `/tmp` (config.json served). Root without `CAP_DAC_OVERRIDE` was shown
unable to read a 0600 dump owned by another uid, which is why the ops containers do not run as root.

Pre-deploy certification (2026-10-02, compose project `sfcert`, fictional secrets outside the repository, no real
domain, DNS, ACME or Sankhya): the server and web images built through this compose file; `postgres` -> `db-roles` ->
`migrate` -> `db-roles` -> `config-bootstrap` -> first admin and technical account (stdin path) -> `api`, `worker`,
`web`, `verifier` all healthy with `NODE_ENV=production`, `read_only`, `cap_drop ALL`, `no-new-privileges`; logins,
`/ready` detail, 403s for the technical account on commercial routes; the verifier reachable only from `api`
(`internal` network, no egress); the worker as `force_worker` (pg-boss under aggressive maintenance timers for 4 minutes
without a DDL permission error, scheduled mirror jobs completing after the configuration load); `WEB_AUTH_MODE`
refused when unset or invalid; `backup` as `force_backup`; `restore-check` (run repeatedly against the same scratch
database); `migrate-safe` ordering (a failing backup stops the migration, exit 1, no partial dump); `offsite` against
a local `rclone serve s3` stub with age (decrypts to the same sha256), the restore-marker gate refused and then
accepted, a tampered dump refused by `offsite` and `restore-check`, the 16 MB tmpfs and read-only mounts.
The edge was proven with the real Caddyfile in a separate container on `localhost` (no ACME).

**Not exercised:** the compose `edge` service with a real domain (ACME/TLS issuance); the `offsite` job on
`amazon/aws-cli` or against a real provider (Alpine's `aws-cli` and an rclone stub only; the AWS-checksum variables
set in the script are for S3-compatible providers that reject the new default checksums); the authoritative identity
check against a real second name for the same database (stubbed); the real `aws` CLI under uid 1001 with
`HOME=/tmp`; `db-roles.sql` with `force_backup` on a managed provider; backup bind-mount ownership on a real Linux VPS
(the rehearsal used a Windows bind mount); any live Sankhya login or sync.

## Open questions for the owner

1. DNS for `force-staging.sistemasplac.com.br` and the VPS (provider, sizing, firewall).
2. Off-VPS backup destination, credentials and the age recipient public key; who runs the monthly restore-check.
3. Restore-target role and scratch database: created once by the administrator (see `restore-test.env.example`);
   who owns that step on the chosen scratch server.
4. Who deploys, from where, and the SSH key custody (see "SSH and deploy user"); OPS-3 deploy transport remains
   PROPOSED, including the docker-group trade-off.
5. Brand files mount (`/brand`) is not wired in staging; add when a staging brand is wanted.
6. Operational (seller) login on staging waits for the real Sankhya verifier adapter (BLOCKED_EXTERNAL_SECRET).
7. Managed PostgreSQL remains the target (V-04, V-15), including whether the provider allows the role bootstrap.
