# Staging auto-deploy (GitHub Actions -> SSH -> company VPS)

Status: **implemented as PROPOSED, nothing here was run against GitHub or a VPS.** OPS-3 (Caddy, SSH deploy) is
PROPOSED and awaits the owner's confirmation; ENV-1 (staging and production isolated, `decisions.md` section 3.11) is
APPROVED and is respected: this mechanism deploys **staging only**, never `main`, never production. Companion of
`deploy/README-staging.md` (stack, roles, backup, rollback policy). Files: `.github/workflows/deploy-staging.yml`,
`deploy/scripts/{deploy-staging,rollback-staging,bootstrap-vps,lib-deploy,ci-compose-check}.sh`,
`deploy/docker-compose.staging.external-edge.yml`.

## Flow

```
push to feat/sales-force-evolution  (or manual run from that same branch)
  -> job ci      (no secrets)  install --frozen-lockfile, build, typecheck, lint, openapi:check, tests, shellcheck, compose config
  -> job deploy  (environment `staging`, secrets = SSH transport only)
       ssh $PLAC_VPS_USER@host  /opt/force-staging/repo/deploy/scripts/deploy-staging.sh <github.sha>
         lock -> PREVIOUS_SHA -> git fetch -> commit reachable from origin/feat/sales-force-evolution?
         -> checkout --detach -> compose config -q -> (edge ports check, caddy mode)
         -> postgres up (self-hosted) -> build migrate+web tagged <sha12> -> backup -> migrate
         -> [db-roles if the release adds a table and SF_RUN_DB_ROLES=1]
         -> up -d --no-deps api worker verifier web (+ edge) -> wait healthy -> /api/v1/ready -> write state
       ssh ... deploy-staging.sh --print-deployed-sha   must equal github.sha  -> green / red
```

The first deploy (no state file) is **not** done by the workflow: it fails closed until the operator has run the first
deploy by hand with `SF_FIRST_DEPLOY=1` (plain `migrate`, no backup, as the README-staging rule says).

## Secrets (GitHub environment `staging`, transport only)

| Secret | Content |
|---|---|
| `PLAC_VPS_HOST` | Host name or IP of the company VPS |
| `PLAC_VPS_PORT` | SSH port (numeric) |
| `PLAC_VPS_USER` | Deploy user on the VPS (`force-deploy`) |
| `PLAC_VPS_SSH_KEY` | Private half of an ed25519 key generated **for this VPS only** |
| `PLAC_VPS_HOST_KEY` | The VPS host key line(s) in `known_hosts` format (pins the server; no `ssh-keyscan` in CI) |

No Sankhya, database, session or other application secret is stored in GitHub: those live in the per-role env files
on the VPS, outside the repository (`deploy/staging/*.env.example`).

## Workflow security decisions

- Triggers: `push` on `feat/sales-force-evolution` and `workflow_dispatch`. **No `pull_request`, no `pull_request_target`,
  no forks**: this is a public-repository consideration, a fork or PR can never reach the secrets because the job is
  never triggered by them and `environment: staging` is restricted to the branch (below). A manual run from another ref
  fails in the first step (and the deploy job has its own `if` on the ref).
- `permissions: contents: read`; `concurrency: deploy-staging` with `cancel-in-progress: false` (one deploy at a time,
  no concurrent migrations; a running deploy is never cancelled).
- Secrets only in the `deploy` job, handed to steps through `env:`; no `${{ secrets.* }}` and no user-controlled
  `${{ github.* }}` expression inside any `run:` text (the SHA is read from `$GITHUB_SHA` and regex-checked
  `^[0-9a-f]{40}$` in the workflow and again in the VPS script). The deploy job does not check out or execute repository code.
- SSH: runner's native `ssh`; `~/.ssh` 0700, key 0600 written from env without echo (no `set -x`), `known_hosts`
  only from `PLAC_VPS_HOST_KEY`, `StrictHostKeyChecking=yes`, `GlobalKnownHostsFile=/dev/null`, `IdentitiesOnly`,
  `BatchMode`; key and known_hosts removed in an `always()` step. The remote command is a fixed script path plus the
  validated SHA.
- Actions are pinned by full commit SHA (resolved on 2026-10-02 with `git ls-remote` against the public repositories,
  tags are lightweight so the tag SHA is the commit): `actions/checkout` v6.1.0 `d23441a4...`, `actions/setup-node`
  v6.5.0 `24997072...`. pnpm comes from `packageManager` via Corepack (no third-party action). **Re-verify the two SHAs
  against the upstream release pages before the first run** (resolved by tool, not by browsing). No dependency cache is restored.
- Deployed commit must be reachable from `origin/feat/sales-force-evolution` (checked on the VPS).

## CI gate: what runs and why

| Step | Command | Why |
|---|---|---|
| Install | `pnpm install --frozen-lockfile` | lockfile is authoritative; lifecycle scripts stay denied (`pnpm-workspace.yaml` `allowBuilds`) |
| Build | `pnpm run build` | workspace packages need each other's `dist`; also proves what the Docker build compiles |
| Typecheck, lint | `pnpm run typecheck`, `pnpm run lint` | all workspaces (`-r --if-present`) |
| Contracts | `pnpm --filter @salesforce/contracts run openapi:check` | generated OpenAPI is current (STACK-5) |
| Critical tests | `domain` (includes the boundary check), `contracts`, `sankhya`, `mobile-db`, and `server` **unit** suite (`vitest run test/unit`, 221 tests, ~25 s locally) | pure rules, contracts, gateway and the server unit logic; none needs Docker |
| Shell | `bash -n` on all deploy scripts; `shellcheck` warning level on `deploy/scripts`, error level on the older `deploy/staging/*.sh` | the deploy path is shell |
| Compose | `deploy/scripts/ci-compose-check.sh`: `docker compose config -q` for the base file, all profiles, and the external-edge override, with the `*.env.example` files copied to a scratch dir (fictional values) | interpolation and file presence |

Not in the gate (cost): the server integration suites and `packages/db` tests need Docker/Testcontainers (24 files, minutes
each run); the web per-file run, mobile `jest` and the Expo bundle check. They remain developer-machine checks; adding the
Docker suites is a later decision if staging breaks are traced to them.

## Proxy: Caddy or an existing one (`SF_EDGE_MODE`)

`SF_EDGE_MODE` is **required** (environment or `compose.env`); there is no default, so the stack never grabs 80/443 by accident.

- `caddy`: this stack's `edge` service owns 80/443 (the compose file as is). The deploy refuses when another listener holds
  the ports and the edge container is not already running.
- `external`: an existing proxy on the host keeps 80/443; `edge` is never started. The override file
  `docker-compose.staging.external-edge.yml` publishes `api` and `web` on **127.0.0.1 only** (`SF_API_LOCAL_PORT` default
  13000, `SF_WEB_LOCAL_PORT` default 18080). The existing proxy must replicate the routing of `deploy/staging/Caddyfile`:
  `/api/*` -> api, everything else -> web, TLS there, and it must **set** `X-Forwarded-For` itself and discard any client
  value (the API trusts exactly one hop, `TRUST_PROXY=1`). That proxy configuration is not provided or changed here.

Readiness is checked from inside the `api` container (`GET /api/v1/ready` must answer 200), so it needs neither DNS nor TLS.

## Settings of the VPS scripts (all optional except `SF_EDGE_MODE`)

Read from the environment, else from `compose.env` (non-secret keys only; the file is never sourced or printed):
`SF_ROOT` (`/opt/force-staging`), `SF_REPO_DIR`, `SF_CONFIG_DIR`, `SF_DATA_DIR`, `SF_LOGS_DIR`, `SF_BACKUP_DIR`,
`SF_COMPOSE_ENV` (`$SF_CONFIG_DIR/compose.env`), `SF_COMPOSE_PROJECT` (`salesforce-staging`, the compose file's own name, so the
README commands keep working; use `-p` with it), `SF_DEPLOY_BRANCH`, `SF_DB_MODE` (`self-hosted`|`managed`),
`SF_HEALTH_TIMEOUT` (240 s), `SF_READY_TIMEOUT` (90 s). Per-run switches: `SF_FIRST_DEPLOY=1`, `SF_RUN_DB_ROLES=1`,
`DEPLOY_DRY_RUN=1` / `--dry-run`. Image tags are the first 12 characters of the SHA, set **per invocation** for compose
(`SERVER_IMAGE`/`WEB_IMAGE` override `compose.env`, which is never edited by the scripts; the placeholders there stay unused).
State: `$SF_LOGS_DIR/deployed.state` (`DEPLOYED_SHA`, `DEPLOYED_AT`, `PREVIOUS_SHA`, `ROLLED_BACK_FROM`) and
`deploy-history.log`; lock `$SF_LOGS_DIR/deploy.lock` (held -> immediate failure, never waits).

## Manual steps

### GitHub (repository owner)

1. Settings -> Environments -> New environment `staging`. **Deployment branches: selected branches ->
   `feat/sales-force-evolution` only.** Optional: required reviewers (the deploy then waits for approval).
2. On your machine: `ssh-keygen -t ed25519 -f ./plac_deploy_key -C "sales-force-staging-deploy" -N ""` (a key used for nothing else).
3. Collect the VPS host key **manually**: `ssh-keyscan -p <port> -t ed25519 <host>` and verify the fingerprint out-of-band
   against the one on the VPS (`ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`, read it on the console/provider panel).
   Store the verified line (with `[host]:port` form when the port is not 22) in `PLAC_VPS_HOST_KEY`.
4. Add the five secrets to the `staging` environment. Delete the local private key file afterwards (keep it in the team's secrets manager).

### VPS (operator, as root on the company VPS)

1. `deploy/scripts/bootstrap-vps.sh detect` (read-only). Read the listeners on 80/443 and the existing Docker projects.
2. Decide the proxy: free ports -> `caddy`; anything listening -> `external` (it is never replaced).
3. `SF_EDGE_MODE=<mode> bootstrap-vps.sh apply --deploy-pubkey-file plac_deploy_key.pub [--add-to-docker-group-acknowledging-root-equivalence]`.
   It creates `force-deploy` (locked password, no sudo), `/opt/force-staging/{repo,config,data,backups,logs}` (config 0700)
   and an `authorized_keys` entry with `restrict`. It installs nothing and touches no existing proxy, firewall, container or network.
   **The docker group is root-equivalent**: without the flag the user cannot run Docker. Alternatives (see README-staging
   "SSH and deploy user"): rootless Docker for that user (ports 80/443 need `net.ipv4.ip_unprivileged_port_start`; not validated here),
   or a sudo wrapper that runs only the two fixed scripts. Once the script path is stable, add a forced command to the key.
4. As `force-deploy`: create a **read-only GitHub deploy key** on the VPS (`ssh-keygen -t ed25519` as that user, add the
   public half in the repository Settings -> Deploy keys **without** write access) and
   `git clone git@github.com:<owner>/<repo>.git /opt/force-staging/repo` (the repository may be private); check out the branch.
5. Put outside the repository under `/opt/force-staging/config` (0700, files 0600): `compose.env` (from
   `deploy/staging/compose.env.example`: `SF_SECRETS_DIR=/opt/force-staging/config/secrets`, `SF_BACKUP_DIR=/opt/force-staging/backups`,
   `SF_OPS_USER=<uid:gid printed by apply>`, `SF_EDGE_MODE`, `STAGING_DOMAIN`, `CADDY_IMAGE`, `PG_MAJOR` ...), the per-role env
   files in `config/secrets/`, and `installation.json`. Never commit these.
6. First installation, by hand as `force-deploy` (README-staging "Role bootstrap", "Installation configuration",
   "First admin account"): postgres -> `db-roles` -> `migrate` -> `db-roles` -> `config-bootstrap` -> first admin, then the first
   deploy of the real commit: `SF_FIRST_DEPLOY=1 /opt/force-staging/repo/deploy/scripts/deploy-staging.sh <sha>`. From then on pushes deploy automatically.
7. Releases that add a table need `db-roles` after the migration: set `SF_RUN_DB_ROLES=1` for that deploy (needs `db-admin.env`
   on the host) or the deploy refuses before changing anything.

## Rollback

`deploy/scripts/rollback-staging.sh [<sha>]` (target defaults to `PREVIOUS_SHA`) is manual only; the workflow never calls it.
It rebuilds or reuses the images of that commit and recreates `api worker verifier web` with `--no-deps`: **it never
touches the database** (no migrate, backup, restore or db-roles). Before acting it compares `packages/db/migrations` between
the target and the deployed commit: any difference -> refuses with "MANUAL INTERVENTION REQUIRED" (expand-only
compatibility cannot be proven automatically, P-16). Only an operator may override, naming the newer SHA:
`ROLLBACK_ACK_MIGRATIONS=<deployed sha> rollback-staging.sh <previous sha>`. Undoing data needs the pre-migration dump and
`restore-check` (README-staging "Backup and restore"); contract (destructive) migrations need the owner (CLAUDE.md section 4).
A failed deploy states in its output whether the migration had started and whether the previous containers are still running.

## Honest limits

- Nothing was run against GitHub Actions or a VPS. Locally exercised: YAML parse, `bash -n`, shellcheck (via the official
  image), `docker compose config -q` with fictional env files, and the scripts' dry-run, argument, lock, git
  reachability/checkout, migration-comparison and state logic in WSL Ubuntu against a local bare repository with a
  **stub `docker`** (compose, build, health and readiness behaviour was therefore not exercised).
- `deploy-staging.sh` and `rollback-staging.sh` rewrite themselves via `git checkout` while running; they are written so bash never
  reads the file again after `main` starts, but a changed script takes effect on the *next* deploy.
- If `backup` or `migrate` is interrupted (SSH drop), the process on the VPS is not killed by this design beyond the
  SSH session ending; use the lock file and `docker ps` before re-running. The first start of a real database, ACME/TLS and
  Sankhya behaviour are unverified, as in README-staging "Not exercised".
- `shellcheck` on the older `deploy/staging/*.sh` runs at error level only; warnings there are not gated.
- Image build on the VPS needs outbound access to the package registry and base images.
