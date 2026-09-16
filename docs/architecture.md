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

This document describes the **working architecture proposal**. Most of it depends on decisions that are still **PROPOSED** (`decisions.md` Rounds 4–7). Only content backed by an APPROVED decision is binding.

| Section | Status | Backed by |
|---|---|---|
| §1 System context | "Clients never call Sankhya", isolated environments, VPS/VM compute, managed PostgreSQL, external object storage, API/worker process split and worker-only Sankhya credentials APPROVED; Caddy/Compose, Sentry and SMTP details PROPOSED | P-03, OPS-1, STACK-7, STACK-2, STACK-6; OPS-3…5 PROPOSED |
| §2 Principles | APPROVED (the policy-module mechanism is PROPOSED) | P-02…P-05, P-08, P-21; AUTH-4 PROPOSED |
| §3 Data ownership | Sankhya vs Sales Force split APPROVED; per-row write paths PROPOSED; account lifecycle and customer approval APPROVED | P-02, P-18, P-19 |
| §4 Repository layout | `apps/server`, `packages/domain`, `packages/db`, `packages/sankhya` roles and the ARCH-1 dependency direction APPROVED; web, mobile, contracts, UI, tooling and the full dependency table PROPOSED | P-03, P-05, STACK-2, STACK-3, DATA-2, ARCH-1; STACK-1, STACK-4, STACK-5, MOB-1 PROPOSED |
| §5 Server application | Processes, framework constraint, jobs and outbox rule APPROVED; module map PROPOSED (refined in the Phase 0 plan) | STACK-2, STACK-3, STACK-6; V-16 |
| §6 Data storage | PostgreSQL version policy and object storage APPROVED; mobile storage PROPOSED | P-17, DATA-1, STACK-7; MOB-2 PROPOSED |
| §7 Sankhya boundary | Duplicate-proof writes and the outbox write path APPROVED; mirror reads, allowlist and authentication PROPOSED | SNK-4, STACK-6; SNK-1, SNK-2 PROPOSED |
| §8–§9 Web and mobile | PROPOSED | STACK-5, MOB-1, MOB-2, AUTH-1, AUTH-2 |
| §10 Environments | Isolation, hosting direction, database network access and recovery targets APPROVED; providers NEEDS VALIDATION (comparison §10.2, quote checklist §10.3); staging database optimization and local/CI tooling PROPOSED | P-15, SNK-3, OPS-1, OPS-2, OPS-6; V-04, V-05, V-15, V-16 |
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
- Sankhya credentials exist only in the worker runtime (STACK-2); API-side access requires a later approved use case (synchronous allowlist, SNK-1 PROPOSED).
- PostgreSQL holds application data, the Sankhya mirror, job queues (pg-boss) and the audit log.

---

## 2. Architectural principles

Principles and their statuses are listed in `decisions.md` §2. The ones that shape structure most:

| Principle | Structural consequence |
|---|---|
| P-02 ownership | Mirror tables are read-only for application code; CRM tables are owned by Sales Force modules |
| P-03 Sankhya boundary | Only `packages/sankhya` knows Sankhya formats; Sankhya credentials exist only in the worker (STACK-2) |
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
  server/      NestJS; API and Worker entry points (STACK-2, STACK-3 — APPROVED)
  web/         Vite single-page app (STACK-5)
  mobile/      Expo app (MOB-1)
packages/
  domain/      pure deterministic business rules; runs in Node and in the mobile JavaScript runtime (P-05, ARCH-1 — APPROVED)
  db/          persistence: Drizzle PostgreSQL schema per module + versioned SQL migrations (DATA-2 — APPROVED)
  mobile-db/   Drizzle SQLite schema + local migrations (DATA-2 direction; encrypted library per MOB-2/V-09)
  contracts/   Zod schemas: API contracts and sync protocol types; OpenAPI source (STACK-4)
  sankhya/     SankhyaGateway interface, real client, fake, Sankhya mapping, sanitized fixtures
  ui/          web UI components (shadcn/ui based)
  config/      shared TypeScript, lint and formatting presets
```

Workspace tooling: pnpm workspaces + Turborepo, no remote cache (STACK-1).

### 4.1 Dependency direction — APPROVED (ARCH-1)

```text
apps/server ──depends on──► packages/domain      (never the reverse)
apps/server ──depends on──► packages/db          (persistence mechanisms)
packages/domain ──never──► apps/server, NestJS, Drizzle, PostgreSQL clients, HTTP, pg-boss,
                           Sankhya SDK/API types, Node-only APIs (when the rule must also run on mobile)
```

- NestJS orchestrates; it never owns core business rules (STACK-3). Rules are not tied to decorators, HTTP, request objects, controllers or infrastructure services.
- Business rules receive plain data and return plain results; persistence, jobs and integrations stay in `apps/server` and `packages/db`.

### 4.2 Full package dependency table — PROPOSED

The table below refines ARCH-1 for every package. It is still a proposal (web, mobile, contracts and UI are decided in Round 6), including the stricter rule that `packages/domain` uses no Node built-ins at all.

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

### 5.1 Processes — APPROVED (STACK-2, STACK-3)

One modular codebase, two independent runtime entry points, run as separate processes/containers. NestJS is the framework; business rules stay in `packages/domain`.

| Process | Responsibilities | Secrets |
|---|---|---|
| API | HTTP endpoints, authentication, authorization, business orchestration, sync endpoints, inbound webhooks (later phases), OpenAPI generation (exact responsibilities per later rounds) | No Sankhya credentials (STACK-2) |
| Worker | pg-boss job handlers and schedules: Sankhya mirror, integration outbox delivery, reconciliation, email, imports, PDF generation, notifications; AI batches (Phase 3) | Sankhya credentials (only here) |

Shared across both: application modules, domain orchestration, contracts, database access, authorization policies, observability infrastructure. Each module registers only what its process needs. Background processing never blocks HTTP requests.

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

### 5.3 Jobs — APPROVED (STACK-6); connection details NEEDS VALIDATION (V-16)

- Engine: pg-boss in PostgreSQL. No Redis/BullMQ; rate limiting and caches do not assume Redis.
- A job caused by a business write is enqueued **in the same transaction** as that write.
- pg-boss is the **execution mechanism**, never the business record. Where work has business meaning (Sankhya delivery), the record is a business table (`integration_outbox`) written in the same transaction.
- **Connection gate:** the selected managed PostgreSQL must support pg-boss safely (V-16). If a generic pooler is incompatible, the worker uses a dedicated direct connection for pg-boss while API traffic uses the application pool. A fundamental incompatibility returns to the owner; pg-boss is never replaced silently.
- **[PROPOSED]** Handlers are idempotent and classify failures as transient, rate-limited, authentication, authorization, validation or permanent. Only transient and rate-limited failures retry, with exponential backoff.
- Long-running work never runs inside an HTTP request.

### 5.4 Migrations — APPROVED (DATA-2)

```text
merge ─► reviewed SQL migration files (generated + hand-written, all tracked)
deploy ─► one-shot migration step (protected against concurrent execution) ─► new application version becomes active
data migrations ─► separate, tracked, run as their own controlled step
```

- `drizzle-kit push` (or any direct schema sync) only against disposable local development databases — never staging with valuable data, pilot or production.
- Expand → migrate → contract per P-16; contract waits while released mobile clients still depend on the old shape (version policy UNDECIDED, R11).
- The locking mechanism for concurrent-execution protection is chosen in the Phase 0 plan.

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

### 7.2 Writes (Phase 1) — APPROVED path (STACK-6, SNK-4)

```text
business transaction (API) ─► integration_outbox record + pg-boss job   (same transaction)
pg-boss ─► worker ─► check origin-id field in Sankhya (SNK-4) ─► insert via SankhyaGateway ─► Sankhya
worker ─► update integration_outbox: state, attempts, error details, result identifiers
```

`integration_outbox` holds, per delivery: state; attempts; origin identifier (Sales Force entity UUID, SNK-4); idempotency data; error details; operator visibility; retry/reprocessing controls; audit trail. Field-level design is done with the data model (Round 5 / entity pass).

Sankhya writes are not implemented until SNK-4 validations close (V-11, V-13).

### 7.3 Gateway contract

- `SankhyaGateway` is an interface defined per use case, with a real implementation and a fake implementation behind the same interface.
- Inputs and outputs are Sales Force-shaped types. Sankhya service names, table names and field names stay inside `packages/sankhya`.
- Authentication: OAuth 2.0 client credentials + `X-Token`; token cached and renewed (SNK-2).
- Contract tests run the gateway against sanitized recorded responses.

### 7.4 Synchronous call allowlist

Operations the `api` process may call synchronously (read-only, with timeout and graceful degradation). Adding an entry requires a decision in `decisions.md`; Sankhya credentials exist only in the worker runtime (STACK-2, APPROVED); adding an entry here is exactly the kind of later approved use case that could require API-side access.

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
| Staging | separate smaller VPS/VM, different failure domain from production (OPS-1) | separate PostgreSQL instance. **PROPOSED cost optimization:** PostgreSQL running on the staging host (isolated from production, completely different credentials, no unsanitized production data, never the only copy of business data); decided with provider selection. Lower retention and RPO acceptable (OPS-2) | homologation if it exists, otherwise fake gateway (SNK-3) — **never production** | staging bucket + credentials | provider, staging configuration |
| Production | VPS/VM (OPS-1); provider V-04 | managed PostgreSQL with PITR, reached over **private networking** (allow-listed TLS endpoint only as the approved fallback, §10.0); self-hosted only if the fallback is approved | Sankhya production | production bucket + credentials, versioned | provider |

No environment shares credentials, databases, queues, buckets or Sankhya environments with another (P-15).

The existing company Hostinger VPS is not used for Sales Force production merely because it exists (OPS-6); a new, dedicated Hostinger VPS remains a candidate in V-04.

Staging is optimized separately and should cost materially less than production; production and staging are never combined into one failure domain to save cost (OPS-6).

### 10.0 Database network access — APPROVED (OPS-1, batch 3)

| Topology | Status | Conditions |
|---|---|---|
| Private networking between production compute and PostgreSQL (VPC/VNet/private IP) | **Preferred** | — |
| IP-allow-listed endpoint with TLS | **Fallback only** | Provider offers no appropriate private networking; firewall limited to fixed application IPs; TLS certificate verification mandatory; strong unique credentials; rotated credentials; database rejects every other source; **security review approves the topology** |
| PostgreSQL openly reachable from the internet (e.g. `0.0.0.0/0` + password) | **REJECTED** | — |

A combination that splits compute and database across providers when a private-network option exists at one provider does not meet the first fallback condition by choice; it needs explicit owner and security review.

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

Desk research of 2026-09-16 against the OPS-1 criteria and the OPS-6 budget. **No provider is selected** and none may be selected from these indicative numbers. Shortlist (candidates only): AWS São Paulo, Magalu Cloud, Azure Brazil South, and other providers that satisfy the architecture.

**Price labels**

| Label | Meaning |
|---|---|
| VERIFIED | Read on 2026-09-16 from the provider's own price page or price API (list price, before taxes and discounts). Still not a commitment. |
| UNVERIFIED | Third-party mirror, search snippet, estimate or allowance; not confirmed from an official source. Third-party mirrors are never authoritative. |
| NEEDS FORMAL QUOTE | Required before OPS-1 provider approval. **Applies to every total in this section.** |

**Basis:** US$ 1 = R$ 5.15 (BCB PTAX 15/09/2026, rounded; varies). Taxes on USD invoices (IOF, ISS/PIS/COFINS) not included — UNVERIFIED. Sizing assumption: production database 30–64 GB, files ~50 GB, nightly compressed dump ~5 GB kept 30 days. **Observability is a separate optional line** (e.g. Sentry Team + paid uptime monitor ≈ US$ 35 ≈ R$ 180, VERIFIED list price); it is not part of the base infrastructure because OPS-4 is still PROPOSED.

#### 10.2.1 Managed PostgreSQL candidates (Brazil)

| Provider / region | PG 18 | PITR retention | Private networking | Est. production DB / month | Notes |
|---|---|---|---|---|---|
| AWS RDS, sa-east-1 | Yes (RDS since 2025-11; sa-east-1 availability UNVERIFIED) | 0–35 days, ~5 min restore point | VPC / security groups; Lightsail via VPC peering | 2 GB class ~US$ 65 (R$ 335); 4 GB class ~US$ 115 (R$ 592) — instance prices from a third-party mirror, gp3 storage price UNVERIFIED | Multi-AZ ≈ 2× |
| Azure Flexible Server, Brazil South | Yes | 7–35 days; geo-redundant backup **not available** in Brazil South | VNet integration (no public endpoint) | B1ms 1 vCore/2 GiB + 32 GiB ≈ US$ 32.5 (R$ 168); B2s + 64 GiB ≈ US$ 116 (R$ 598; price anomaly to confirm) | New zone-redundant HA temporarily blocked in Brazil South (docs 2026-09-05); burstable tier has no HA |
| Google Cloud SQL, southamerica-east1 | Yes | Enterprise 1–7 days; Enterprise Plus up to 35 | UNVERIFIED | UNVERIFIED | Enterprise edition fails the ≥ 30-day preference |
| Magalu Cloud DBaaS, br-se1/br-ne1 | 16 documented; 17/18 UNVERIFIED | Snapshots 1–30 days; true PITR UNVERIFIED | Private IP only | UNVERIFIED (pricing pages not readable) | All-Brazil, BRL billing; needs a quote |
| Oracle OCI PostgreSQL, São Paulo | 17 (Apr 2026); 18 not found | Backups up to 35 days; PITR UNVERIFIED | Private endpoint only | UNVERIFIED | Service availability in São Paulo UNVERIFIED |
| Neon, aws-sa-east-1 | Yes | Scale plan up to 30 days | IP allow list; PrivateLink only from AWS VPC | Always-on 0.5 CU ≈ US$ 94 (R$ 482) | Compute-hour pricing; HA model UNVERIFIED |
| Supabase, sa-east-1 | UNVERIFIED | PITR add-on: 7 d ~US$ 100, 28 d ~US$ 400 | IP restrictions; PrivateLink on Team plan | 28-day PITR ≈ US$ 480 (R$ 2,473) | Out of budget with ≥ 30-day PITR |
| AWS Lightsail managed DB | No (old majors) | 7 days | Private by default | — | Fails DATA-1 preference and retention |
| Huawei, Aiven, Vultr (São Paulo) | UNVERIFIED | Varies / UNVERIFIED | UNVERIFIED | UNVERIFIED | Not comparable without quotes |
| DigitalOcean, Hetzner, Contabo | — | — | — | — | No Brazil location |
| Locaweb | — | — | — | — | No managed PostgreSQL with PITR found |

#### 10.2.2 Compute candidates (São Paulo)

| Provider | ~2 vCPU / 4 GB+ | ~1–2 vCPU / 2 GB | Private link to managed PG |
|---|---|---|---|
| Hostinger VPS (new server) | KVM 2 (2 vCPU/8 GB) R$ 43,99 on 24-month prepay, renews R$ 77,99 | KVM 1 (1 vCPU/4 GB) R$ 29,99, renews R$ 59,99 | No managed PG; private networking and SLA UNVERIFIED |
| AWS Lightsail | 4 GB US$ 24 | 2 GB US$ 12 | VPC peering to RDS (price parity in São Paulo to confirm) |
| Azure VM, Brazil South | B2als_v2 ≈ US$ 44 + disk | B1ms ≈ US$ 25 | VNet to Flexible Server |
| Vultr São Paulo | US$ 20 | US$ 10–15 | UNVERIFIED |
| GCP e2, southamerica-east1 | ≈ US$ 39 | ≈ US$ 19 | UNVERIFIED |
| Magalu Cloud VMs | exists, price UNVERIFIED | exists, price UNVERIFIED | Yes (private-IP DBaaS) |

#### 10.2.3 Object storage candidates

| Provider | Brazil | S3 API | Indicative price | Notes |
|---|---|---|---|---|
| AWS S3 sa-east-1 | Yes | Native | US$ 0.0405/GB-month; egress US$ 0.15/GB | 50 GB ≈ R$ 21/month with light traffic |
| Magalu Object Storage | Yes | S3-compatible (versioning, pre-signed URLs documented) | UNVERIFIED | Lifecycle rules UNVERIFIED |
| OCI Object Storage São Paulo | Yes | UNVERIFIED | US$ 0.0255/GB-month; generous free egress | S3 compatibility/versioning UNVERIFIED |
| Azure Blob Brazil South | Yes | **No native S3 API** | US$ 0.0326/GB-month | Conflicts with STACK-7 unless a gateway or another provider is used |
| Cloudflare R2, Backblaze B2 | No Brazil region | Yes | B2 US$ 6.95/TB-month | Candidates only for the off-domain backup copy (data outside Brazil — OPS-6 justification needed) |

#### 10.2.4 Indicative combinations (R$ per month, before taxes — NEEDS FORMAL QUOTE)

Base infrastructure excludes the optional observability line (≈ R$ 180). Staging figures assume a managed staging database; the PROPOSED staging optimization (PostgreSQL on the staging host) would reduce them.

| Combination | Production base | + optional observability | Staging | Price label | Fit (OPS-6, batch 3) | Main trade-offs |
|---|---|---|---|---|---|---|
| **D1-lean — all AWS São Paulo** (Lightsail 4 GB + RDS 2 GB class + S3 + off-site copy) | ≈ R$ 485 | ≈ R$ 665 | ≈ R$ 354 | UNVERIFIED (RDS instance prices from a third-party mirror; gp3 storage allowance) | Candidate (≤ R$ 700) | Meets the technical criteria (PG 18, 35-day PITR, private networking, native S3, Brazil) |
| D1-standard (RDS 4 GB class) | ≈ R$ 742 | ≈ R$ 922 | ≈ R$ 354 | UNVERIFIED | Above R$ 700; with observability above R$ 800 → owner review | More database headroom |
| **D2-lean — Azure Brazil South** (VM + Flexible Server B1ms on VNet) | ≈ R$ 471 (Blob) — files must move to an S3-compatible provider (e.g. AWS S3 ≈ R$ 21 + cross-provider transfer) | ≈ R$ 651+ | ≈ R$ 320 | VERIFIED list prices (Azure retail price API); B2s anomaly and public IP UNVERIFIED | Candidate (≤ R$ 700) | Azure Blob does not satisfy STACK-7 → second provider for files; burstable DB without HA; zone-redundant HA blocked for new deployments in Brazil South |
| D3 — new Hostinger VPS + Azure B1ms DB over allow-listed TLS endpoint + S3 sa-east-1 | ≈ R$ 287 (≈ R$ 321 at renewal) | ≈ R$ 467 | ≈ R$ 201 | VERIFIED list prices; cross-provider egress estimated (UNVERIFIED) | Cost fits, **topology does not meet §10.0 preference** | Public allow-listed endpoint although private networking exists at Azure; two providers in series; latency and Hostinger SLA UNVERIFIED |
| D4 — Magalu Cloud (all Brazil, BRL) | UNVERIFIED | UNVERIFIED | UNVERIFIED | NEEDS FORMAL QUOTE (prices not readable) | Unknown | Could rank first if PITR, PG 17/18 and lifecycle rules are confirmed |
| E — OPS-1 fallback: self-hosted PostgreSQL on Hostinger VPS + WAL archiving to S3 + second dump copy | ≈ R$ 83 (≈ R$ 117 at renewal) | ≈ R$ 263 | ≈ R$ 30–60 | VERIFIED list prices; backup volumes estimated | Cost fits; architecture fallback only (PROPOSED) | App and DB in one failure domain; no failover; team owns patching, upgrades, WAL-archive monitoring and restore proof; backup credentials on the production host |

**Growth (2× current sizing, UNVERIFIED):** database storage and dump volume roughly double; enabling HA (Multi-AZ or equivalent) roughly doubles database compute. D1 with 2× data and HA ≈ R$ 1,365 base (≈ R$ 1,545 with observability).

**Research conclusion (not a decision):** under the batch 3 interpretation, D1-lean (AWS São Paulo) and D2-lean (Azure Brazil South, with S3-compatible files elsewhere) are reasonable production candidates at ≈ R$ 470–500 base; Magalu needs a quote before it can be compared; D3 conflicts with the private-networking preference; E remains only the documented fallback. Final pricing depends on formal quotes (§10.3).

**LGPD notes:** AWS and Microsoft publish DPAs covering Brazil/LGPD; DPAs for Magalu, Hostinger, Neon, Supabase, Backblaze and Sentry UNVERIFIED. Sentry data regions are US or EU only, and a Backblaze/R2 off-site copy places data outside Brazil — both need OPS-6 justification.

### 10.3 Provider quote checklist — AWS, Magalu, Azure (before OPS-1 provider approval)

Send the same request to each shortlisted provider and record answers with date and source. Sizing to quote: production app 2 vCPU / 4 GB; production PostgreSQL 2 vCPU / 2–4 GB, 50 GB storage; staging app 1–2 vCPU / 2 GB; staging PostgreSQL smallest tier (or on the staging host); object storage 50 GB production + 10 GB staging; ~150 GB/month backup transfer.

| Item | AWS São Paulo | Magalu Cloud | Azure Brazil South |
|---|---|---|---|
| Compute (prod + staging), region | Lightsail or EC2 in sa-east-1 | VM BV2-4 / BV1-2 in br-se1 (city?) | B-series VM |
| Managed PostgreSQL tier and price | RDS db.t4g.small / medium | DBaaS BV2-4 (single, Multi-AZ) | Flexible Server B1ms / B2s / D2ds_v5 |
| PostgreSQL major versions available (18? 17?) | ask | ask (only 16 documented) | ask |
| PITR: continuous? granularity, maximum window | ask (docs: up to 35 days) | ask (docs: snapshots 1–30 days) | ask (docs: 7–35 days) |
| Backup retention cost beyond free allowance | ask | ask | ask |
| Private networking between compute and database; cost | VPC / Lightsail peering | private IP | VNet integration |
| pg-boss compatibility: direct endpoint available, pooler behavior (V-16) | ask | ask | ask |
| Object storage: S3 API, versioning, lifecycle, encryption, price | S3 sa-east-1 | Object Storage (lifecycle?) | not S3-compatible → which S3 provider? |
| Egress/transfer: internet, cross-zone, to backup location | ask | ask | ask |
| Taxes (IOF, ISS/PIS/COFINS) and **BRL billing** entity | ask | BRL (confirm) | ask |
| SLA (compute, database, storage) | ask | ask | ask (HA restrictions in Brazil South) |
| Support plan and cost | ask | ask | ask |
| LGPD / DPA | published DPA — confirm applicability | ask | published DPA — confirm applicability |
| **Expected production cost / month** | quote | quote | quote |
| **Expected staging cost / month** | quote | quote | quote |
| **Cost at 2× current sizing** | quote | quote | quote |

Also confirm for any other candidate that satisfies the architecture (e.g. a new Hostinger VPS): contract terms, SLA, private networking, DPA. Observability vendors (if OPS-4 is later approved): DPA, data region, whether free tiers are contractually acceptable for company use.

Sources (accessed 2026-09-16): AWS RDS release calendar and backup docs; AWS price-list CSVs (S3, data transfer, sa-east-1); Bytebase RDS price mirror; Azure retail prices API (brazilsouth) and Flexible Server docs (backup, HA, overview); Google Cloud SQL PITR docs; Magalu Cloud DBaaS and object storage docs; Oracle OCI PostgreSQL docs; Neon plans/pricing/regions; Supabase pricing and PITR docs; Hostinger BR VPS page; AWS Lightsail pricing and DB FAQ; Vultr plans API; Backblaze B2 pricing; Cloudflare R2 data-location docs; Sentry and UptimeRobot pricing; AWS Brazil data privacy page; Microsoft DPA.

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
