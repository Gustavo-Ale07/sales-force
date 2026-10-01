# STAGING_READINESS_PLAN (working note, not a decision, do not commit) — 2026-10-01

Plan only. Nothing here is deployed, provisioned or approved. Status labels: **APPROVED** (binds) · **PROPOSED** · **NEEDS VALIDATION** · **OWNER** (owner decision required).
Sources: P-15, SNK-3, SNK-4, SNK-6, SEC-1, OPS-1, OPS-2, OPS-6, DATA-1, DATA-2, STACK-2, STACK-6, STACK-7, V-04, V-05, V-15, V-16, U-13 (`docs/decisions.md`); OPS-3/OPS-4 are PROPOSED (Round 7, not started). Current repo state: `deploy/docker-compose.dev.yml` is local-only; no staging/production files exist (`deploy/README.md`).

## 1. Approved constraints that frame staging

- P-15 / OPS-1: staging isolated from production: own credentials, database, job queue, object storage, Sankhya environment. Separate failure domain.
- SNK-3: staging never touches Sankhya production (reads or writes). Staging uses homologation if it exists (V-11), otherwise fake gateway with sanitized fixtures. No production data in staging without approved sanitization.
- SNK-6 / SNK-4: ERP order submission stays disabled; the staging worker is **read-only toward Sankhya** (no outbox delivery enabled). No second Sandbox write without owner authorization.
- STACK-2: API and Worker are separate processes of one image; `SANKHYA_*` only in the worker (see VERIFIER_DESIGN.md for the identity-verification exception that needs an owner decision).
- DATA-2: migrations are reviewed SQL, one-shot, concurrency-protected, run before the new version is active; data migrations separate.
- OPS-1/DATA-1: PostgreSQL >= 16, same major as production (V-15), private networking; UUIDv7 generated outside PG. STACK-7: managed S3-compatible private storage per environment (V-05).
- OPS-2: RPO <= 15 min / RTO <= 4 h are production targets; staging may be cheaper but never at the cost of backups, security or isolation (OPS-6).
- SEC-1: spike credentials are exposed: rotate; never commit or wire into staging.
- U-13: per-installation infra/cost model UNDECIDED; staging for the PLAC installation is planned as installation #1 only.

## 2. Target topology (PROPOSED, OPS-3 / OPS-1 staging cost note; NEEDS VALIDATION V-04)

One small staging host (VPS/VM) running Docker Compose; separate from the production host.

| Service | Staging role | Notes |
|---|---|---|
| `proxy` | TLS edge, only public listener (80/443) | PROPOSED: Caddy (OPS-3 text) with automatic certificates; alternative nginx + certbot. OWNER/NEEDS VALIDATION |
| `web` | `sales-force-web` image (unprivileged nginx, SPA, runtime `/config.json`) | Not published; reached via proxy. `WEB_AUTH_MODE` must be `standard` for the auth criterion |
| `api` | `sales-force-server`, command API; no `SANKHYA_*` | Not published; `/api` routed by proxy (same-origin as web today) |
| `worker` | same image, `main-worker.js`; read-only Sankhya | `SANKHYA_MODE=fake` until staging Sankhya environment is chosen; loopback `/health` only |
| `migrate` | one-shot job, same image | Runs before api/worker are (re)started |
| Postgres | managed or on host (section 3) | Not published to the internet |
| Object storage | managed S3-compatible bucket, staging only | V-05; needed only when blob features ship |

No `seed` service in staging (dev demo accounts and `SEED_DEV_PASSWORD` are dev-only). Staging data is created through the real admin flow or an approved sanitized import.

Compose: separate files, e.g. `deploy/docker-compose.staging.yml` (PROPOSED name), no `ports:` on api/worker/web other than the proxy; images referenced by immutable tag (commit SHA, OPS-3 PROPOSED), never `build:`; `restart: unless-stopped`; resource limits; log rotation (OPS-4 PROPOSED, Docker `json-file` max-size). Secrets by file/env injected at deploy from the host secret store, never in the compose file or repository.

## 3. PostgreSQL placement (no provider chosen)

| Option | Status | Trade-off |
|---|---|---|
| A. Managed PostgreSQL with PITR, private network, staging-specific instance | OPS-1 approved direction; provider NEEDS VALIDATION (V-04) | Most faithful to production (same major, pooler, pg-boss compatibility V-16); extra monthly cost |
| B. PostgreSQL on the staging host | PROPOSED cost optimization (decisions.md OPS-1 staging topology) | Cheapest; allowed only if isolated, never the sole copy of important data, no unsanitized production data, different credentials; does not exercise managed-provider behaviour (poolers, direct endpoint for worker) |

Recommendation: decide the staging DB placement together with V-04/V-15; do not provision before the production provider is chosen, because V-16 (pg-boss on the managed endpoint) and the PG major must be validated against the same stack. If B is chosen: Postgres in a container with named volume on a dedicated disk, listens on the compose-internal network only, scheduled `pg_dump`/base backups to a separate object-storage bucket (OPS-2 spirit; restore tested). Reversible. OWNER: A vs B.

## 4. Release sequence (PROPOSED, OPS-3)

1. CI builds and scans images, tags by commit SHA, pushes to registry (GHCR proposed). 2. Deploy user (restricted) pulls the tag. 3. Pre-deploy backup/snapshot marker. 4. `migrate` one-shot runs (advisory lock, then pg-boss schema/queues); failure aborts the deploy, old version keeps running (expand/contract, P-16, keeps the old version compatible with the new schema). 5. `api` and `worker` started with the new tag; `web` last. 6. Smoke check (section 6). 7. Record version + migration set.

## 5. Network, domain, HTTPS, mobile URL

- Domain: a dedicated staging subdomain of a company-owned domain (e.g. `staging.<domain>`, `api` same origin under `/api` as today). The domain and DNS owner are OWNER decisions; never reuse the production hostname or certificate.
- HTTPS only: proxy redirects 80 to 443, HSTS on, TLS 1.2+, certificates automated (ACME). Firewall: only 22 (restricted source/key-only) and 80/443 inbound; DB, api, worker, web ports never exposed. `ALLOWED_ORIGINS` set to the staging origin only.
- Mobile: the staging build gets its API base URL from the build profile (EAS profile `staging`, OPS-3 PROPOSED); **https only**: the app/build must refuse `http://` outside dev builds (verify a guard exists; else a Phase task). No cleartext traffic exception on Android (`usesCleartextTraffic=false`) and no ATS exception on iOS for staging.
- Android signing: staging APK/AAB signed with a staging upload key kept in the owner's secret store/EAS credentials; distinct from the production key; never in the repo. Production Play signing is a separate decision. Distribution for staging testers (internal track/EAS internal distribution) OWNER. Key custody and backup of the keystore: OWNER (losing it cannot be recovered).

## 6. Health, readiness, logs

- Existing: API `GET /api/v1/health` (liveness/healthcheck), worker loopback `GET /health` inside the container.
- Needed (gap to confirm in code, not assumed): a **readiness** signal distinct from liveness that checks DB connectivity and that migrations are at the expected version; the proxy/deploy smoke test uses it. Exposed publicly only in minimal form (no versions, no detail).
- Logs: pino JSON with correlation id (exists per README); Docker log rotation; no passwords, tokens, cookies, `Authorization`, Sankhya payloads in logs (scrub verified). Central aggregation deferred (OPS-4 PROPOSED, R65). Sentry is not an approved dependency (OPS-4 PROPOSED, V-08).
- Uptime monitor: optional cost line (OPS-4), OWNER.

## 7. Backup, restore, rollback

- Backup: managed PITR (option A) or scheduled dumps to separate storage (option B); object-storage versioning (V-05). Retention NEEDS VALIDATION (V-04).
- Restore: OPS-2 "a backup counts only after a tested restore": before staging is called ready, one restore drill into a scratch database, recorded (date, duration, row-count check). This also rehearses the production runbook.
- Rollback: application rollback = redeploy the previous image tag; allowed only while the schema is expand-compatible (P-16). Destructive/contract migrations are never rolled back in place: restore from backup/PITR (staging data is disposable, but the drill is the point). Document per release whether it is rollback-safe.
- Secrets backup: encrypted secrets backup outside the servers is PROPOSED with OPS-3 (decisions.md OPS-2 note); OWNER.

## 8. Secrets

Inventory for staging (values never written here): `DATABASE_URL` (api, migrate, worker; ideally separate DB roles: migrator vs runtime, NEEDS VALIDATION with V-16), session/cookie secrets, object-storage keys, SMTP (OPS-5 not decided), `SANKHYA_*` (worker only; only if a staging Sankhya environment exists; currently BLOCKER-SNK-CREDENTIALS). Delivery: host-side file with 0600 owner-only permissions or Docker secrets, injected at deploy; GitHub Environments secrets for CI/SSH (PROPOSED). Rotation: Sankhya spike credentials exposed (SEC-1) must be rotated before reuse. No staging secret equals a production or dev secret.

## 9. Readiness criteria

### INFRA_READY_FOR_STAGING (all must hold; none depends on auth or Sankhya)
1. Staging host/subdomain/DNS exist; separate from production (P-15). OWNER decisions in section 10 closed.
2. Staging compose file and images tagged by SHA; only the proxy publishes ports; verified from outside by port scan.
3. HTTPS valid, HTTP redirects, HSTS; certificate renewal verified.
4. Postgres placement decided; PG major equals production target (V-15); not internet-reachable; pg-boss verified on that endpoint (V-16).
5. `migrate` one-shot runs from a clean database and from the previous release; failure blocks api/worker.
6. api, worker, web healthy via compose healthchecks; readiness endpoint verified.
7. Backup configured and one **restore drill** passed and recorded (OPS-2).
8. Rollback rehearsed (previous tag redeploy).
9. Secrets injected from host store; repository/image/`docker inspect` scan shows none baked; logs scrubbed.
10. Worker has no order-delivery path active (SNK-6), `SANKHYA_MODE=fake` or a documented non-production target (SNK-3).
11. Mobile staging build points to the https URL; cleartext refused; Android staging signing key in place.

### AUTH_READY_FOR_STAGING (required before any real user or real data; independent gate)
1. **`AUTH_MODE=dev` is a staging blocker**: it must not run in staging. Today `AUTH_MODE` accepts only `dev` and the API refuses it when `NODE_ENV=production` (`apps/server/src/config/api-env.ts`), so a production-mode staging API cannot start until a real mode exists. Do NOT work around by running staging with `NODE_ENV=development` or `ALLOW_DEV_AUTH=1`; the env guards stay.
2. A non-dev auth mode implemented, with Argon2id passwords, lockout/throttling in API, sessions and device approval per Round 4 status (check which parts are APPROVED; PROPOSED access items cannot be assumed).
3. `WEB_AUTH_MODE=standard` in staging; no seed, no demo accounts, no `SEED_DEV_PASSWORD`.
4. First admin bootstrap path defined (OWNER; CFG bootstrap U-12 open): no default password.
5. If Sankhya-verified login is required for sellers: external identity verification working end-to-end (VERIFIER_DESIGN.md) and the STACK-2 amendment decided. Blocked by BLOCKER-SNK-CREDENTIALS and V-11.
6. Security review per `security-model.md` section 15 passed (auth, sessions, CORS, cookies, headers).

Staging may be INFRA_READY while not AUTH_READY: in that state it may only host a smoke environment with no real users, no real data and no external reachability beyond an IP/owner allow-list (OWNER).

## 10. Owner decisions needed

1. Approve or amend OPS-3 (CI/CD, proxy choice, registry, deploy method) and OPS-4 (observability) as Round 7 items; until then everything above is PROPOSED.
2. Staging DB: managed (A) vs on host (B); provider via V-04/V-05/V-15 (no price-based pick).
3. Staging domain/subdomain, DNS ownership, certificate issuer.
4. Staging Sankhya target: homologation (V-11), fake gateway, or the Sandbox for read-only use; and the rotation/re-issue of Sankhya credentials (SEC-1, BLOCKER-SNK-CREDENTIALS).
5. Staging access restriction while not AUTH_READY (IP allow-list or VPN).
6. Android staging distribution channel and signing-key custody.
7. How staging runs the production-mode guard (a `NODE_ENV` value for staging must not weaken the dev-auth refusal).
8. Budget line for staging (OPS-6: staging cheaper, not at cost of backups/security) and whether U-13 must be settled first.
9. Secrets store/encrypted backup approach.

## Addendum — final security review

- AUTH criterion "no demo accounts" must be enforced (boot refusal in production mode and/or a smoke-test assertion), not only a startup warning.
- The mobile staging build must prove it carries no dev cleartext flags: the fail-closed guard (`SF_ALLOW_CLEARTEXT=1` + explicit dev profile) covers it; the build log/prebuild check is the evidence.
- Never copy the dev compose defaults (known DB password) into a staging compose; staging requires `POSTGRES_PASSWORD` with the `:?` form and no default.
- Revocation/forced logout must call the product-image cache purge when that path is built (LOW-2).
