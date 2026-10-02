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
       ssh $PLAC_VPS_USER@host  "deploy <github.sha>"      (forced command: /usr/local/sbin/force-staging-deploy, root-owned)
         wrapper validates the command, starts deploy-staging.sh DETACHED with a log file, and follows the log
         lock -> PREVIOUS_SHA -> git fetch -> commit reachable from origin/feat/sales-force-evolution?
         -> moves forward from the last good deploy? -> checkout --detach -> compose config -q -> (edge ports check, caddy mode)
         -> postgres guard (never recreated before the backup) -> build migrate+web tagged <sha12> -> backup
         -> state marker (ATTEMPTED_SHA, MIGRATED=yes) -> migrate
         -> [db-roles if the release adds database objects and SF_RUN_DB_ROLES=1]
         -> up -d --no-deps api worker verifier web (+ edge) -> wait healthy -> /api/v1/ready -> write state, clear marker
       ssh ... "print-deployed-sha"   must equal github.sha  -> green / red
```

## SSH forced command (finding H1) and the residual risk

`bootstrap-vps.sh apply` copies `deploy/scripts/force-staging-ssh-entry.sh` to `/usr/local/sbin/force-staging-deploy`
(`root:root 0755`, `--root` pinned into the copy) and writes the key as
`[from="..",]command="/usr/local/sbin/force-staging-deploy",restrict ssh-ed25519 ...`. A later `git checkout` cannot change
that file. It reads only `$SSH_ORIGINAL_COMMAND` and accepts exactly `deploy <40 lowercase hex>` and `print-deployed-sha`
(strict parsing, no `eval`, no expansion; anything else exits 126), runs the repository script from a fixed path with a
cleared environment, and has no shell, forwarding, tty or agent (`restrict`).

**Accepted residual risk (honest):** the wrapper runs the repository's `deploy-staging.sh` of the previously deployed commit,
and the deploy user is in the `docker` group (root-equivalent on the host). So **anyone who can push to
`feat/sales-force-evolution` (or approve the `staging` environment) can execute code on the VPS**, as root-equivalent through
Docker. The forced command removes the *key-holder's* free shell; it cannot remove trust in the branch content. Therefore
these are **mandatory prerequisites**, not options:

1. GitHub environment `staging`: **Deployment branches = `feat/sales-force-evolution` only** and **required reviewers**.
2. **Branch protection** on `feat/sales-force-evolution` (no force-push, no deletion, reviewed merges, restricted push access).
3. Least privilege for who may push the branch or edit repository/environment secrets.

Do not enable the workflow before all three are in place. Alternatives that reduce the risk (rootless Docker, a sudo wrapper
for fixed scripts) are not validated here (README-staging "SSH and deploy user").

The first deploy (no state file) is **not** done by the workflow: it fails closed until the operator has run the first
deploy by hand with `SF_FIRST_DEPLOY=1` (plain `migrate`, no backup, as the README-staging rule says).

## Secrets (GitHub environment `staging`, transport only)

| Secret | Content |
|---|---|
| `PLAC_VPS_HOST` | Host name or IPv4 address of the company VPS (only hostnames and IPv4 are supported; IPv6 literals are not, by design) |
| `PLAC_VPS_PORT` | SSH port (numeric) |
| `PLAC_VPS_USER` | Deploy user on the VPS (`force-deploy`) |
| `PLAC_VPS_SSH_KEY` | Private half of an ed25519 key generated **for this VPS only** |
| `PLAC_VPS_HOST_KEY` | The VPS host key line(s) in `known_hosts` format (pins the server; no `ssh-keyscan` in CI) |

No Sankhya, database, session or other application secret is stored in GitHub: those live in the per-role env files
on the VPS, outside the repository (`deploy/staging/*.env.example`).

**Rotation:** if `PLAC_VPS_SSH_KEY` is ever exposed (log, screenshot, chat, a compromised branch), rotate it at once: generate a
new key outside the repo, re-run `bootstrap-vps.sh apply` with the new public key, **delete the old key's line by hand** from
`~force-deploy/.ssh/authorized_keys` (apply only replaces a line carrying the same key), and update the secret.

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
  `BatchMode`; key and known_hosts removed in an `always()` step. The remote command is `deploy <validated sha>` or
  `print-deployed-sha`, which the forced-command wrapper re-validates.
- Actions are pinned by full commit SHA (resolved on 2026-10-02 with `git ls-remote` against the public repositories,
  tags are lightweight so the tag SHA is the commit): `actions/checkout` v6.1.0 `d23441a4...`, `actions/setup-node`
  v6.5.0 `24997072...`. pnpm comes from `packageManager` via Corepack (no third-party action). **Re-verify the two SHAs
  against the upstream release pages before the first run** (resolved by tool, not by browsing). No dependency cache is restored.
- Deployed commit must be reachable from `origin/feat/sales-force-evolution` and must descend from the last good deploy
  (`merge-base --is-ancestor`; checked on the VPS). A late or replayed run of an older commit is refused with a pointer to
  `rollback-staging.sh`; the only override is the manual env var `DEPLOY_ACK_NONFORWARD=<that exact sha>`, never set by the workflow.

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
each run); the web per-file run, mobile `jest` and the Expo bundle check. They remain developer-machine checks.

**Recommended next gate (open owner decisions, nothing below is implemented):**
- the DB-backed suites (server integration, `packages/db`, sync/authorization matrices) with Testcontainers in CI;
- dependency scanning (for example `pnpm audit` and/or a lockfile scanner) as a blocking or advisory step;
- pinning pnpm: Corepack resolves `packageManager` (`pnpm@11.23.0`) but the integrity hash (sha512 suffix) is not set, so the
  pnpm binary itself is not hash-pinned. Adding it is an open item and `package.json` was deliberately not changed.

## Proxy: Caddy or an existing one (`SF_EDGE_MODE`)

`SF_EDGE_MODE` is **required** (environment or `compose.env`); there is no default, so the stack never grabs 80/443 by accident.

- `caddy`: this stack's `edge` service owns 80/443 (the compose file as is). The deploy refuses when another listener holds
  the ports and the edge container is not already running.
- `external`: an existing proxy on the host keeps 80/443; `edge` is never started. The override file
  `docker-compose.staging.external-edge.yml` publishes `api` and `web` on **127.0.0.1 only** (`SF_API_LOCAL_PORT` default
  13000, `SF_WEB_LOCAL_PORT` default 18080). The existing proxy must replicate the routing of `deploy/staging/Caddyfile`:
  `/api/*` -> api, everything else -> web, TLS there, and it must **set** `X-Forwarded-For` itself and discard any client
  value (the API trusts exactly one hop, `TRUST_PROXY=1`). That proxy configuration is not provided or changed here.
  The override removes the `edge` service entirely (`edge: !reset null`, Compose 2.24 or newer), so **`secrets/edge.env` is not
  needed** in this mode. `CADDY_IMAGE` is still **required** in `compose.env`: `${CADDY_IMAGE:?}` in the base file is interpolated
  before the service is dropped (`ci-compose-check.sh` proves `compose config -q` passes without `edge.env`, and that the base file alone fails).

Readiness is checked from inside the `api` container (`GET /api/v1/ready` must answer 200), so it needs neither DNS nor TLS.

## Settings of the VPS scripts (all optional except `SF_EDGE_MODE`)

Read from the environment, else from `compose.env` (non-secret keys only; the file is never sourced or printed):
`SF_ROOT` (`/opt/force-staging`), `SF_REPO_DIR`, `SF_CONFIG_DIR`, `SF_DATA_DIR`, `SF_LOGS_DIR`, `SF_BACKUP_DIR`,
`SF_COMPOSE_ENV` (`$SF_CONFIG_DIR/compose.env`), `SF_COMPOSE_PROJECT` (`salesforce-staging`, the compose file's own name, so the
README commands keep working; use `-p` with it), `SF_DEPLOY_BRANCH`, `SF_DB_MODE` (`self-hosted`|`managed`),
`SF_HEALTH_TIMEOUT` (240 s), `SF_READY_TIMEOUT` (90 s). Per-run switches: `SF_FIRST_DEPLOY=1`, `SF_RUN_DB_ROLES=1`,
`DEPLOY_DRY_RUN=1` / `--dry-run`. Image tags are the first 12 characters of the SHA, set **per invocation** for compose
(`SERVER_IMAGE`/`WEB_IMAGE` override `compose.env`, which is never edited by the scripts; the placeholders there stay unused).
State: `$SF_LOGS_DIR/deployed.state` (`DEPLOYED_SHA`, `DEPLOYED_AT`, `PREVIOUS_SHA`, `ROLLED_BACK_FROM`, `ATTEMPTED_SHA`, `MIGRATED`)
and `deploy-history.log`; lock `$SF_LOGS_DIR/deploy.lock` (held -> immediate failure, never waits). Each workflow deploy also
writes `$SF_LOGS_DIR/deploy-<utc>-<sha12>.log`.

### Environment file path (divergence reconciled)

`README-staging.md` examples use `/etc/salesforce/staging/compose.env`; **the CI/CD path uses
`/opt/force-staging/config/compose.env`** (`SF_COMPOSE_ENV`, created by `bootstrap-vps.sh apply`, owned by the deploy user,
0700). They are two different locations: do not keep two copies. Manual README-staging commands run on this host must use the
same file and project: `docker compose -p salesforce-staging --env-file /opt/force-staging/config/compose.env -f deploy/docker-compose.staging.yml ...`
(and the external-edge override when `SF_EDGE_MODE=external`); otherwise they act on a different project/config than the deploys.

### Deploy state machine

`DEPLOYED_SHA` is always the last **fully successful** deploy. Before `migrate` starts the script writes, atomically,
`ATTEMPTED_SHA=<new sha>` and `MIGRATED=yes`; a full success rewrites the state with the marker cleared (`none`/`no`).

| Where it failed | Schema | Running containers | Recovery |
|---|---|---|---|
| before the marker (fetch, checks, build, backup) | unchanged | previous, untouched | fix the cause and re-run; nothing to roll back |
| after the marker (migrate, db-roles, up, health, readiness) | **may be applied** (marker present) | the last good ones unless `up` was reached | fix forward (next push), or `rollback-staging.sh <last good sha>` when the migration is expand-only, or restore the dump |

`rollback-staging.sh` takes `ATTEMPTED_SHA` as the schema commit when `MIGRATED=yes` (else `DEPLOYED_SHA`), compares the
migrations between target and that commit, and, with a marker, accepts the last good `DEPLOYED_SHA` as target (it restarts the
last good application). The ack names the schema commit. On success the marker is cleared unless an acknowledged migration
difference remains, in which case it is kept so a later rollback still compares against it.

With a marker present (`MIGRATED=yes`) a deploy must target a **descendant-or-equal of both** `DEPLOYED_SHA` and `ATTEMPTED_SHA`
(otherwise it refuses and points to `rollback-staging.sh` or the manual `DEPLOY_ACK_NONFORWARD=<exact sha>`); the migration and
db-roles pre-check inspects the union of the diffs from the last good deploy and from the attempted commit; an existing marker
is never overwritten by an older or unrelated commit (kept until a deploy that descends from it succeeds). Retrying the failed
commit itself is allowed. The rollback target is **operator-trusted**: `rollback-staging.sh` does not judge whether an arbitrary
older commit is safe beyond the migration comparison and its ack.

### Detached run: what survives an SSH drop

The wrapper starts the deploy with `setsid`, output to the log file, and only follows the log. The scripts also ignore `HUP`
and `PIPE`, and the `flock` stays held for the life of the process, so a dropped SSH session or a cancelled runner stops the
*following*, not the deploy; a second deploy cannot start meanwhile. **What remains possible:** `SIGKILL`/OOM of the script, a
host reboot, or the operator killing it can interrupt a started `backup`/`migrate`/compose run mid-way; the state marker then
shows the migration as started, so re-check with `docker ps`, the log and the marker before re-running. The workflow job stops
waiting after its 40-minute timeout even though the deploy may still finish: read `print-deployed-sha` and the log afterwards.

### Postgres guard

The deploy never recreates `postgres` before the backup. If the target commit's postgres definition (image, `PG_MAJOR`, env files:
compose config hash) differs from the running container, it refuses with a message; recreate it by hand (README-staging) after a
backup and re-run. First deploy and an absent container are the only cases where it is started by the script.

**Acknowledging a mismatch (manual, nothing automated):** 1. confirm why it differs (`git diff <last good> <target> -- deploy/ docker-compose` and `compose.env`
changes, new image or `PG_MAJOR`; a major upgrade needs the dump/restore procedure of README-staging, never an in-place recreate);
2. take a backup now (`docker compose -p salesforce-staging --env-file /opt/force-staging/config/compose.env -f deploy/docker-compose.staging.yml --profile ops run --rm backup`);
3. recreate postgres by hand with the same project and env file (`... up -d --no-deps --force-recreate postgres`), check it is healthy and the data is intact;
4. re-run the deploy; the guard now sees the new definition as the running one. The workflow never does steps 1-3.

### Deploy-writable code and compose version

The forced command executes `deploy-staging.sh` from the clone the deploy user can write (residual risk above); the wrapper itself
and `bootstrap-vps.sh` are different: `apply` must run **from a separate trusted checkout**, not from `$root`, because it installs
the wrapper source as root (it refuses when the script lives under `--root`). `apply` also refuses symlinks at `$root`, its
subdirectories, `~/.ssh` and `authorized_keys` and uses exclusive temp files plus rename (residual: a race between check and use
by a hostile deploy user cannot be excluded with shell tools; do not adopt a tree that user already controls). The deploy scripts need
**Docker Compose >= 2.24** (`!reset`, `config --hash`) and fail early with a clear message otherwise. Wrapper logs are created with
`mktemp`; logs older than 30 days (`deploy-*.log`) are pruned at the start of each deploy. Existing users in
sudo/wheel/admin/lxd/disk or named in `/etc/sudoers*` are refused unless `--allow-existing-privileged-user`; membership of `docker`
without the acknowledging flag only warns.

### Database objects needing `db-roles`

Whitespace-normalised and case-insensitive detection of `CREATE TABLE | SEQUENCE | VIEW | MATERIALIZED VIEW | SCHEMA | TYPE` in
added migrations, and **any modified existing migration** (also flagged with a warning; deleted migrations are warned). Such a
release is refused unless `SF_RUN_DB_ROLES=1`. Caveat: the check compares migrations between the last good deploy and the
target, so the **first** automated deploy after the manual first install does not inspect the earlier history (the operator ran
`db-roles` by hand then); objects created in ways the pattern does not match (for example via DO blocks) are not detected.

## Manual steps

### GitHub (repository owner)

1. Settings -> Environments -> New environment `staging`. **Mandatory:** deployment branches -> selected branches ->
   `feat/sales-force-evolution` only; **required reviewers**; and **branch protection** on that branch (see the residual risk above).
2. Generate the key **outside the repository** (for example in a temporary directory outside the checkout; `.gitignore` also
   covers `plac_deploy_key*`, `id_ed25519*`, `*_deploy_key*` as a safety net only):
   `ssh-keygen -t ed25519 -f "$HOME/plac_deploy_key" -C "sales-force-staging-deploy" -N ""` (a key used for nothing else).
3. Collect the VPS host key **manually**: `ssh-keyscan -p <port> -t ed25519 <host>` and verify the fingerprint out-of-band
   against the one on the VPS (`ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`, read it on the console/provider panel).
   Store the verified line (with `[host]:port` form when the port is not 22) in `PLAC_VPS_HOST_KEY`.
4. Add the five secrets to the `staging` environment. **Delete the private key file afterwards** (and the public one once installed
   on the VPS); keep the private key only in the team's secrets manager.

### VPS (operator, as root on the company VPS)

1. `deploy/scripts/bootstrap-vps.sh detect` (read-only). Read the listeners on 80/443 and the existing Docker projects.
2. Decide the proxy: free ports -> `caddy`; anything listening -> `external` (it is never replaced).
3. `SF_EDGE_MODE=<mode> bootstrap-vps.sh apply --deploy-pubkey-file plac_deploy_key.pub [--add-to-docker-group-acknowledging-root-equivalence]`.
   It creates `force-deploy` (locked password, no sudo), `/opt/force-staging/{repo,config,data,backups,logs}` (config 0700),
   installs the root-owned wrapper `/usr/local/sbin/force-staging-deploy` and writes the `authorized_keys` entry
   (`command=...,restrict`, optional `from=`). Safety checks: it **refuses** a pre-existing user that is in sudo/wheel/admin or has
   uid < 1000 (`--allow-existing-privileged-user` overrides knowingly), a symlinked `~/.ssh` or `authorized_keys`, and a
   pre-existing non-empty `--root` it did not create (`--adopt-existing-root` overrides). `authorized_keys` is rewritten through a temp
   file with a trailing newline, replacing a line that carries the same key and never duplicating it. It installs nothing and touches no
   existing proxy, firewall, container or network.
   **The docker group is root-equivalent**: without the flag the user cannot run Docker. Alternatives (see README-staging
   "SSH and deploy user"): rootless Docker for that user (ports 80/443 need `net.ipv4.ip_unprivileged_port_start`; not validated here),
   or a sudo wrapper that runs only the fixed scripts.
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

`deploy/scripts/rollback-staging.sh [<sha>]` (target defaults to `PREVIOUS_SHA`, or to the last good `DEPLOYED_SHA` after a failed
deploy whose migration had started; see the state machine above) is manual only; the workflow never calls it.
It rebuilds or reuses the images of that commit and recreates `api worker verifier web` with `--no-deps`: **it never
touches the database** (no migrate, backup, restore or db-roles). Before acting it compares `packages/db/migrations` between
the target and the deployed commit: any difference -> refuses with "MANUAL INTERVENTION REQUIRED" (expand-only
compatibility cannot be proven automatically, P-16). Only an operator may override, naming the newer SHA:
`ROLLBACK_ACK_MIGRATIONS=<deployed sha> rollback-staging.sh <previous sha>`. Undoing data needs the pre-migration dump and
`restore-check` (README-staging "Backup and restore"); contract (destructive) migrations need the owner (CLAUDE.md section 4).
A failed deploy states in its output whether the migration had started, the schema state, which containers run, and the
exact recovery commands (`rollback-staging.sh <last good sha>` or fix forward).

## Honest limits

- Nothing was run against GitHub Actions or a VPS. Locally exercised: YAML parse, `bash -n`, shellcheck (via the official
  image), `docker compose config -q` with fictional env files, and the scripts' dry-run, argument, lock, git
  reachability/checkout, forward check, migration-comparison, state-machine and postgres-guard logic in WSL Ubuntu against a
  local bare repository with a **stub `docker`** (compose, build, health and readiness behaviour was therefore not exercised);
  the forced-command wrapper (accepted and refused commands, exit-code propagation, a detached job surviving a killed follower) and
  `bootstrap-vps.sh apply` (user/root/symlink refusals, authorized_keys rewrite, wrapper install) in a throwaway WSL root sandbox.
- `deploy-staging.sh` and `rollback-staging.sh` rewrite themselves via `git checkout` while running; they are written so bash never
  reads the file again after `main` starts, but a changed script takes effect on the *next* deploy.
- An SSH drop or runner cancel does not stop a started deploy (see "Detached run"); a kill/OOM/reboot still can. The first start of a real database, ACME/TLS and
  Sankhya behaviour are unverified, as in README-staging "Not exercised".
- `shellcheck` on the older `deploy/staging/*.sh` runs at error level only; warnings there are not gated.
- Image build on the VPS needs outbound access to the package registry and base images.
