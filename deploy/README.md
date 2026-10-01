# Local development stack (Docker)

Brings the whole product up on a developer machine: PostgreSQL 17, one-shot migrations, the API, the
Worker and the web app. Everything here is **local-only**: throwaway passwords, development
authentication, the synthetic Sankhya gateway. Production and staging deployment (TLS edge, managed
PostgreSQL, secrets, deploy pipeline) are a separate work package (OPS-3) and use their own files.

## Run

```sh
cp deploy/.env.example deploy/.env   # then set SEED_DEV_PASSWORD (git-ignored file)
docker compose -f deploy/docker-compose.dev.yml up --build -d
docker compose -f deploy/docker-compose.dev.yml -f deploy/docker-compose.seed.yml run --rm seed   # demo accounts (dev only)
```

`SEED_DEV_PASSWORD` is required by the seed overlay (`deploy/docker-compose.seed.yml`) and has no default:
choose a local password of 12 or more characters (not a common one). The overlay is separate so every other
command on `docker-compose.dev.yml` (up, one-off mirror runs) does not need the variable.

Open <http://localhost:8080> and sign in with a seeded demo account, for example
`admin@demo.salesforce.local` (also `gerente@`, `vendedor1@`, `vendedor2@`, same domain) and the
password you put in `deploy/.env`.

Stop: `docker compose -f deploy/docker-compose.dev.yml down` (keeps the database volume; add `-v` only
if you want to drop the local database).

## Services

| Service | Role | Published on the host |
|---|---|---|
| `postgres` | PostgreSQL 17, named volume `pgdata` | `127.0.0.1:55432` |
| `migrate` | One-shot: SQL migrations (advisory-lock protected, DATA-2), then the pg-boss schema and queues. Idempotent | none |
| `seed` | One-shot, development only, in the overlay `docker-compose.seed.yml` (run it explicitly): installation configuration and demo accounts. Idempotent | none |
| `api` | NestJS/Fastify API; healthcheck `GET /api/v1/health` | `127.0.0.1:3000` (debugging only) |
| `worker` | Worker process; healthcheck = its loopback `GET /health` inside the container; `SANKHYA_MODE=fake` | none |
| `web` | nginx serving the SPA build; `/api` proxied to `api` so the browser is same-origin | `127.0.0.1:8080` |

`api` and `worker` start only after `migrate` completed successfully; neither migrates on start.
`web` starts after `api` is healthy. The `api` and `worker` never appear on a public interface; all
published ports are bound to loopback.

Change the host ports with `WEB_HOST_PORT`, `API_HOST_PORT`, `POSTGRES_HOST_PORT` (shell or `deploy/.env`).
`ALLOWED_ORIGINS` of the API follows `WEB_HOST_PORT` automatically.

## How the seed satisfies its loopback guard

`apps/server/src/seed.ts` refuses any `DATABASE_URL` whose host is not loopback. The `seed` service
therefore runs in the network namespace of the `postgres` container (`network_mode: "service:postgres"`)
and connects to `127.0.0.1:5432`. The guard is untouched: the seed still cannot reach any other database.

## Images

Two images, generic names, built from the repository root:

- `sales-force-server` (`deploy/Dockerfile.server`): one image for `api`, `worker` and the one-shot jobs
  (same source and version, different command). Multi-stage; production dependencies only
  (`pnpm deploy --prod`); non-root `node` user; no source, tests or tooling. `NODE_ENV=production` is the
  image default, so the image never enables development authentication by itself: only the compose file
  sets `NODE_ENV=development` and `ALLOW_DEV_AUTH=1`.
- `sales-force-web` (`deploy/Dockerfile.web`): static build served by unprivileged nginx. `/config.json`
  is generated at container start from `INSTALLATION_NAME` (default `Sales Force`), `WEB_AUTH_MODE` and the
  optional brand (`BRAND_LOGO_URL`, `BRAND_MARK_URL`, `BRAND_ACCENT`); no environment value is baked into the
  bundle. The brand is per installation: the logo and mark are files the installation mounts read-only at
  `/usr/share/nginx/html/brand/` (never in the image or the repository), referenced as `/brand/<file>.(png|svg|
  webp|jpg|jpeg)`; the accent is `#rrggbb` and is ignored by the web app when it is too light: white text on it needs 5.5:1, so that the accent also
  reads as text on the pale surfaces (WCAG AA). Malformed values stop the container at start. nginx serves `/brand/` with `sandbox` CSP and every
  response with a same-origin CSP.

Dependency lifecycle scripts remain denied (`pnpm-workspace.yaml`); the Dockerfiles enable none.

## Sankhya

Only the `worker` receives `SANKHYA_*` (STACK-2). The compose file carries no value: the default is
`SANKHYA_MODE=fake`, and every other `SANKHYA_*` is an env pass-through with an empty default. Live mode
needs values from your own secret store and a non-production Sankhya (SNK-3); never write them in a file
that is committed.

## Useful commands

```sh
docker compose -f deploy/docker-compose.dev.yml ps -a
docker compose -f deploy/docker-compose.dev.yml logs -f api worker      # JSON logs (pino)
docker compose -f deploy/docker-compose.dev.yml run --rm migrate         # re-run migrations after pulling new ones
docker compose -f deploy/docker-compose.dev.yml build --no-cache api     # rebuild the server image from scratch
```

To run several copies side by side (for example to verify a change) use a distinct project name and other
host ports: `docker compose -p my-check -f deploy/docker-compose.dev.yml up --build` with
`WEB_HOST_PORT`, `API_HOST_PORT` and `POSTGRES_HOST_PORT` set.
