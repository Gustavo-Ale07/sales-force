# Architecture — Sales Force

**Responsibility of this file:** the structure of the system — components, boundaries, dependency rules, data ownership, runtime and deployment topology.

**Not in this file:**
- *why* something was chosen → `decisions.md` (referenced by ID);
- security controls → `security-model.md`;
- synchronization protocol → `sync-protocol.md`;
- Sankhya facts and open questions → `sankhya-spike.md`;
- phases and sequencing → `roadmap.md`;
- functional requirements → `project-spec.md`.

**Last updated:** 2026-09-16

### Document status

This document describes the **working architecture proposal**. Most of it depends on decisions that are still **PROPOSED** (`decisions.md` Rounds 3–7). Only content backed by an APPROVED decision is binding.

| Section | Status | Backed by |
|---|---|---|
| §1 System context | "Clients never call Sankhya", isolated environments, VPS/VM compute, managed PostgreSQL and external object storage APPROVED; process split and worker-only Sankhya access PROPOSED | P-03, OPS-1, STACK-7; STACK-2, SNK-1 PROPOSED |
| §2 Principles | APPROVED (the policy-module mechanism is PROPOSED) | P-02…P-05, P-08, P-21; AUTH-4 PROPOSED |
| §3 Data ownership | Sankhya vs Sales Force split APPROVED; per-row write paths PROPOSED; account lifecycle and customer approval APPROVED | P-02, P-18, P-19 |
| §4 Repository layout | PROPOSED, except the isolation of `packages/domain` and `packages/sankhya` (APPROVED) | P-03, P-05; STACK-1…5, MOB-1, DATA-2 PROPOSED |
| §5 Server application | PROPOSED | STACK-2, STACK-3, STACK-6 |
| §6 Data storage | PostgreSQL version policy and object storage APPROVED; mobile storage PROPOSED | P-17, DATA-1, STACK-7; MOB-2 PROPOSED |
| §7 Sankhya boundary | Duplicate-proof writes APPROVED; outbox, allowlist and authentication PROPOSED | SNK-4; SNK-1, SNK-2 PROPOSED |
| §8–§9 Web and mobile | PROPOSED | STACK-5, MOB-1, MOB-2, AUTH-1, AUTH-2 |
| §10 Environments | Isolation, hosting direction and recovery targets APPROVED; providers NEEDS VALIDATION; local/CI tooling PROPOSED | P-15, SNK-3, OPS-1, OPS-2, OPS-6; V-04, V-05, V-15 |
| §11–§13 Delivery, operations, observability | Backups/recovery APPROVED (OPS-2); delivery pipeline, Compose/Caddy details and observability PROPOSED | OPS-2; OPS-3, OPS-4, OPS-5 PROPOSED |

---

## 1. System context

```text
                       ┌──────────────────── environment host (Docker Compose) ────────────────────┐
 Browser ──HTTPS──────►│ Caddy ── /api ──► server:api ─────┐                                        │
  (web SPA)            │   └──── /    ──► static web build  │                                        │
                       │                                    ▼                                        │
 Mobile app ──HTTPS───►│ Caddy ── /api ──► server:api ──► PostgreSQL ◄── server:worker ──► Sankhya API │
  (Expo, encrypted     │                                  (managed, PITR;    │   (OAuth 2.0,         │
   SQLite)             │                                   OPS-1)            │    via SankhyaGateway)│
                       └─────────────────────────────────────────────────────┼───────────────────────┘
                                                                             ├──► Object storage (S3-compatible, external)
                                                                             ├──► SMTP provider
                                                                             └──► Other providers by phase (§7.5)
 Sentry ◄── server, web, mobile
```

- The web app and the mobile app talk **only** to `server:api` (P-03).
- Sankhya is reached only by `server:worker` in Phase 0 (SNK-1).
- PostgreSQL holds application data, the Sankhya mirror, job queues (pg-boss) and the audit log.

---

## 2. Architectural principles

Principles and their statuses are listed in `decisions.md` §2. The ones that shape structure most:

| Principle | Structural consequence |
|---|---|
| P-02 ownership | Mirror tables are read-only for application code; CRM tables are owned by Sales Force modules |
| P-03 Sankhya boundary | Only `packages/sankhya` knows Sankhya formats; only the worker calls it (worker-only: SNK-1, PROPOSED) |
| P-04 modular monolith | One server codebase with explicit modules; no network hops between modules |
| P-05 pure domain | `packages/domain` has no framework or I/O; used by server and mobile |
| P-08 server authority | Clients may pre-validate; the server decides |
| P-21 server-side authorization (mechanism AUTH-4, PROPOSED) | One authorization policy module used by every data path |

---

## 3. Data ownership

| Data | Owner | Write path in Sales Force | Notes |
|---|---|---|---|
| Sellers, products, price tables, payment terms, operation types (TOP) | Sankhya | Mirror only (worker) | Read-only in Sales Force |
| Customers (`cliente`) — partner data | Sankhya | Mirror only | CRM fields on the same account (tags, attendants, custom fields — later phases) are Sales Force-owned |
| Pending customers (`cliente_pendente`) | Sales Force | Account module | Becomes Sankhya-owned after partner creation through the outbox |
| Leads, prospects, rejected accounts | Sales Force | Account module (Phase 2 for leads/prospects) | P-19 single account table |
| Contacts mirrored from Sankhya | Sankhya | Mirror only | Read-only |
| Contacts created in Sales Force | Sales Force | Contact module | Stay only in Sales Force (RF-CON-2) |
| Orders — before submission | Sales Force | Order module | States in `packages/domain` |
| Orders — after submission, invoices | Sankhya | Mirror + status tracking | Lifecycle mapping NEEDS VALIDATION (spike S3) |
| Financial titles, credit limits | Sankhya | Mirror only | |
| Goals, commissions, positivization | Sankhya | Mirror only | Sources NEEDS VALIDATION (spike S6) |
| Discount limits, approvals, users, teams, roles, devices, audit | Sales Force | IAM / approval modules | |
| Opportunities, pipelines, proposals, activities, automations | Sales Force | CRM modules (Phase 2+) | |

A table has exactly one owning module. Other modules never write to it.

---

## 4. Repository layout

```text
apps/
  server/      NestJS; entry points `api` and `worker` (STACK-2, STACK-3)
  web/         Vite single-page app (STACK-5)
  mobile/      Expo app (MOB-1)
packages/
  domain/      pure business rules; runs in Node and in the mobile JavaScript runtime (Hermes)
  db/          Drizzle PostgreSQL schema organized per module + SQL migrations (DATA-2)
  mobile-db/   Drizzle SQLite schema + local migrations (MOB-2)
  contracts/   Zod schemas: API contracts and sync protocol types; OpenAPI source (STACK-4)
  sankhya/     SankhyaGateway interface, real client, fake, Sankhya mapping, sanitized fixtures
  ui/          web UI components (shadcn/ui based)
  config/      shared TypeScript, lint and formatting presets
```

Workspace tooling: pnpm workspaces + Turborepo, no remote cache (STACK-1).

### 4.1 Package dependency rules

| Package | May depend on (internal) | Must never depend on |
|---|---|---|
| `domain` | — | any framework, database driver, HTTP, file system, Node built-ins, DOM, Sankhya, other internal packages |
| `contracts` | `domain` (types only) | `db`, `sankhya`, apps |
| `db` | `domain` (types only) | `sankhya`, apps |
| `sankhya` | `domain` (types only) | `db`, `contracts`, apps |
| `mobile-db` | `domain`, `contracts` | `db`, `sankhya`, server code |
| `ui` | `config` | `db`, `sankhya`, `domain` rules |
| `apps/server` | `domain`, `contracts`, `db`, `sankhya` | `mobile-db`, `ui` |
| `apps/web` | `contracts`, `ui`, `domain` | `db`, `sankhya`, `mobile-db` |
| `apps/mobile` | `domain`, `contracts`, `mobile-db` | `db`, `sankhya`, `ui` |

`domain` may use pure third-party libraries (e.g. exact decimal arithmetic) that run unchanged in Node and Hermes.
These rules are enforced by a dependency lint rule in CI (DATA-3).

---

## 5. Server application (`apps/server`)

### 5.1 Processes

| Process | Responsibilities |
|---|---|
| `api` | REST endpoints, authentication, authorization, business orchestration, sync endpoints, inbound webhooks (later phases), OpenAPI generation |
| `worker` | pg-boss job handlers and schedules: Sankhya mirror, integration outbox, reconciliation, email, imports, PDF generation, notifications; AI batches (Phase 3) |

Both processes load the same modules; each module registers only what its process needs.

### 5.2 Modules

Initial module map for Phase 0 (refined in the Phase 0 implementation plan, reviewed by the architect agent):

| Module | Owns |
|---|---|
| `iam` | users, teams (tree), roles, permissions with scope, sessions, devices, discount-limit configuration (Phase 1) |
| `access-policy` | the central authorization policy (AUTH-4); owns no business data; produces scope filters from ownership, attendant and team data exposed by their owning modules |
| `audit` | audit log |
| `sankhya-mirror` | mirror tables and sync state per entity (worker only) |
| `integration` | `integration_outbox`, integration health (worker writes, api reads) |
| `platform` | configuration, health endpoint, files metadata, email sending |

Rules:
- Modules communicate through exported application services, never through each other's tables.
- Controllers are thin; business rules live in `packages/domain`; orchestration lives in application services.
- Each module's schema lives in its own file group in `packages/db`.
- Cross-module reporting (Phase 2 dashboards) reads through read-only SQL views owned by a reporting module.

### 5.3 Jobs

- Queue: pg-boss in PostgreSQL (STACK-6).
- A job caused by a business write is enqueued **in the same transaction** as that write.
- Handlers are idempotent and classify failures as transient, rate-limited, authentication, authorization, validation or permanent. Only transient and rate-limited failures retry, with exponential backoff.
- Long-running work never runs inside an HTTP request.

---

## 6. Data storage

| Store | Content | Decision |
|---|---|---|
| PostgreSQL (major per DATA-1: ≥ 16, same in every environment, 18 preferred; final NEEDS VALIDATION V-15) | application data, Sankhya mirror, pg-boss queues, audit log, scope events | DATA-1 |
| Managed S3-compatible object storage (private, per-environment buckets; provider NEEDS VALIDATION V-05) | generated PDFs, uploaded spreadsheets, import error reports, product images | STACK-7 |
| Mobile encrypted SQLite | per-user authorized subset + local outbox | MOB-2, `sync-protocol.md` |

Conventions (identifiers, money, time, soft delete, audit columns, change tracking) are defined in DATA-3 and SYNC-2 and operationalized in `.claude/rules/database.md`.

---

## 7. Sankhya integration boundary

### 7.1 Reads

```text
worker schedule → SankhyaGateway (packages/sankhya) → Sankhya API
               → map to Sales Force types → upsert mirror only if content hash changed
               → update per-entity sync state → integration health
```

Read method, cursor and deletion detection per entity: NEEDS VALIDATION (spike S1) (`sankhya-spike.md`).

### 7.2 Writes (Phase 1)

```text
business action (api) ──same transaction──► integration_outbox row + pg-boss job
worker ──► check idempotency field in Sankhya (SNK-4) ──► insert via gateway ──► record result/status
```

Sankhya writes are not implemented until SNK-4 validations close (V-11, V-13).

### 7.3 Gateway contract

- `SankhyaGateway` is an interface defined per use case, with a real implementation and a fake implementation behind the same interface.
- Inputs and outputs are Sales Force-shaped types. Sankhya service names, table names and field names stay inside `packages/sankhya`.
- Authentication: OAuth 2.0 client credentials + `X-Token`; token cached and renewed (SNK-2).
- Contract tests run the gateway against sanitized recorded responses.

### 7.4 Synchronous call allowlist

Operations the `api` process may call synchronously (read-only, with timeout and graceful degradation). Adding an entry requires a decision in `decisions.md`; while this list is empty, Sankhya credentials exist only in the worker container.

| Operation | Decision | Status |
|---|---|---|
| — (none) | — | — |

### 7.5 Other external providers

| Provider | Purpose | Phase | Called from |
|---|---|---|---|
| SMTP provider (OPS-5) | password reset, alerts, notifications | 0 | worker |
| Object storage (STACK-7) | files | 0/1 | api (pre-signed URLs), worker |
| Sentry (OPS-4) | error tracking | 0 | server, web, mobile |
| HIBP range API (AUTH-1) | breached-password check | 0 | api |
| BrasilAPI / ViaCEP | CNPJ and CEP lookup | 1 | server (placement decided in Phase 1) |
| Push notification services | mobile push | 1 | worker |
| Google Workspace | Gmail, Calendar | 2 | server |
| Anthropic Claude API | AI features | 3 | server only |
| Meta / Google Ads, telephony | lead capture, calls | 3 | server |

---

## 8. Web application (`apps/web`)

- Single-page app served as static files by Caddy on the same origin as the API.
- Authenticates with the session cookie; holds no tokens in browser storage.
- Calls the API through the client generated from OpenAPI.
- Reads environment values from a runtime configuration file served with the static bundle; the bundle contains no secrets.
- No server-side rendering and no server runtime of its own.
- UI visibility rules are convenience only; the server enforces authorization.

---

## 9. Mobile application (`apps/mobile`)

- Expo with generated native projects and development builds; EAS Build/Update with signed updates (MOB-1).
- Local encrypted SQLite through Drizzle (`packages/mobile-db`) holding only authorized data (MOB-2).
- Business rules evaluated offline with `packages/domain`; the server revalidates everything (P-08).
- Writes are recorded as commands in a local outbox and pushed per `sync-protocol.md`.
- Credentials in the device secure store; device status governs data access (AUTH-2).

---

## 10. Environments

| Environment | Host | PostgreSQL | Sankhya | Object storage | Email |
|---|---|---|---|---|---|
| Local development | developer machine (Windows + Docker Desktop/WSL2) | PostgreSQL container, same major as production (DATA-1) | fake gateway + sanitized fixtures | S3-compatible emulator (V-05) | local capture (tool chosen in Phase 0) |
| CI | GitHub Actions runners | PostgreSQL via Testcontainers, same major as production (DATA-1) | fake gateway + sanitized fixtures | emulator or none | none |
| Staging | separate smaller VPS/VM, different failure domain from production (OPS-1) | separate PostgreSQL instance; managed or containerized on the staging host is UNDECIDED (cost comparison, V-04); lower retention and RPO acceptable (OPS-2) | homologation if it exists, otherwise fake gateway (SNK-3) — **never production** | staging bucket + credentials | provider, staging configuration |
| Production | VPS/VM (OPS-1); provider V-04 | managed PostgreSQL with PITR, no public unrestricted endpoint (OPS-1); self-hosted only if the fallback is approved | Sankhya production | production bucket + credentials, versioned | provider |

No environment shares credentials, databases, queues, buckets or Sankhya environments with another (P-15).

The existing company Hostinger VPS is not used for Sales Force production merely because it exists (OPS-6); a new, dedicated Hostinger VPS remains a candidate in V-04.

### 10.1 Backup and recovery topology — APPROVED (OPS-2); providers NEEDS VALIDATION

```text
                      primary failure domain (production provider/region)
  production PostgreSQL ── provider PITR + encrypted automatic backups (≥ 30 days where economically reasonable)
          │
          └─ scheduled logical dump job ──► secondary backup location OUTSIDE the primary failure domain
                                                          (different provider or region; encrypted; retention per runbook)
  production object storage ── versioning where useful + lifecycle rules

  monitoring: backup job results + PITR status + dump freshness ──► alert
  verification: monthly restore test into a temporary instance ──► restore report (a backup counts only after a successful restore)
```

| Item | Production | Staging |
|---|---|---|
| RPO / RTO | ≤ 15 min / ≤ 4 h | relaxed; never the only copy of business data |
| PITR retention | ≥ 30 days where economically reasonable (V-04) | lower acceptable |
| Independent logical dump + off-domain copy | required | optional [PROPOSED] |
| Restore test | before pilot/production, then monthly | as needed [PROPOSED] |
| Runbook | recovery runbook documented and followed in each restore test (OPS-6) | same runbook |

Selecting providers, the dump frequency and the secondary location is part of V-04.

### 10.2 Provider comparison — NEEDS VALIDATION (V-04, V-05, V-15)

Research started 2026-09-16 against the OPS-1 criteria and OPS-6 budget. Results are recorded here as a comparison with sources and dates; no provider is selected until the owner approves one after confirming prices and contracts. Not yet filled.

---

## 11. Deployment topology and delivery

```text
GitHub (PR) ──► Actions: lint · typecheck · test · build
merge to main ──► image (tag = commit SHA) ──► GHCR ──► SSH deploy to staging:
                                                          1. one-shot migration job (locked)
                                                          2. docker compose up (caddy, api, worker[, postgres])
version tag ──► manual approval (GitHub Environment) ──► same steps on production
mobile ──► EAS Build / EAS Update channels: staging, production
```

- Compose services per host: `caddy` (serves web build, reverse proxy), `api`, `worker`, and `postgres` only if the self-hosted fallback of OPS-1 is ever approved.
- Rollback: redeploy the previous image tag; schema changes stay backward compatible (P-16).
- Backups and recovery: OPS-2.

---

## 12. Operational constraints

- Scale target: 20–100 users; a single `api` and a single `worker` instance per environment initially.
- In-memory rate limiting or caching is acceptable only while `api` runs as one instance; scaling out requires moving them to PostgreSQL.
- Long-running transactions on synchronizable tables are forbidden: they delay sync delivery (SYNC-2). Batch jobs commit in chunks.
- Sankhya request concurrency is limited by the worker according to limits recorded in `sankhya-spike.md`.

---

## 13. Observability

- Structured JSON logs (pino) with a correlation ID from request to job.
- Sentry in server, web and mobile with scrubbing (OPS-4).
- `/health` reports api, worker heartbeat, database and Sankhya connectivity.
- In-app integration health: last success per entity, lag, recent errors, outbox size (RF-SNK-6).
- External uptime monitor.

---

## 14. Glossary

| Term | Meaning |
|---|---|
| Representante externo / PJ | External autonomous sales representative; mobile-only, strongest restrictions |
| Vendedor interno | Internal seller (inside sales) |
| Gerente | Manager of a team (tree) |
| Diretoria | Commercial directors |
| Cadastro/Financeiro | Backoffice approving new customers |
| Carteira | Portfolio — accounts assigned to a seller |
| Positivação | Positivization — portfolio customers who bought in the period |
| TOP | Sankhya operation type |
| NUNOTA | Sankhya document number, as named in the spec (RF-ORD-4); its behavior in the order lifecycle NEEDS VALIDATION (spike S3) |
| Parceiro | Sankhya partner (customer record) |
