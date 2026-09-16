# Decision Register — Sales Force

**Responsibility of this file:** the single register of project decisions — what was decided, why, what is only proposed, and what remains open.
How decisions are applied lives in `architecture.md`, `security-model.md`, `sync-protocol.md` and `roadmap.md`.

**Last updated:** 2026-09-16 · **Project mode:** DESIGN (no implementation until the project owner writes `BEGIN IMPLEMENTATION`)

---

## 0. How to read this register

### Status values

Every decision carries exactly one of these statuses.

| Status | Meaning |
|---|---|
| **APPROVED** | Explicitly approved by the project owner and recorded here. Binding. May list validations (`V-xx`) whose results fill in values the rule depends on. |
| **PROPOSED** | Recommended (by the spec draft, the review or a decision session) but **not approved**. Not binding. Never implement, never cite as a rule. |
| **NEEDS VALIDATION** | Cannot be decided without a spike or an external fact. |
| **UNDECIDED** | Known open question; no recommendation has been accepted. |
| **REJECTED** | Considered and explicitly rejected by the project owner. |

"Supersedes" / "would supersede" is a relationship, not a status: content replaced by an APPROVED decision is named in that decision's "Supersedes" line (spec decisions D1–D21 are summarized in §4); content that a PROPOSED decision would replace stays in force as spec draft until that decision is approved.

### Precedence

1. Explicit instruction from the project owner for the current task.
2. **This register** (APPROVED entries only).
3. `docs/project-spec.md` — requirements baseline, still a *draft* (header). Consolidation into Specification v1.0 happens under GOV-1.
4. `docs/architecture.md`, `docs/security-model.md`, `docs/sync-protocol.md`.
5. `.claude/rules/*`.

`docs/spec-review.md` is a **review record**. Its recommendations (`R01`–`R68`) bind only when recorded here as APPROVED.

### Decision rounds

Phase 0 blocking decisions are taken in rounds. A round closes only when the project owner explicitly approves it.

| Round | Items | Status |
|---|---|---|
| 1 | GOV-1, baseline principles, SNK-3, SNK-4, MOB-3 | **Closed 2026-09-16**; clarifications U-01…U-09 closed 2026-09-16 (batch 2), U-08 deferred to the Phase 1 gate |
| 2 | OPS-6 (constraints), OPS-1, DATA-1, STACK-7, OPS-2 | **Closed 2026-09-16** (batch 2) — providers and final PostgreSQL major NEEDS VALIDATION |
| 3 | STACK-2, STACK-3, STACK-6, DATA-2 | Open — to be presented next |
| 4 | AUTH-4, AUTH-3, AUTH-2, AUTH-1 | Not started |
| 5 | SYNC-1, SYNC-2, SYNC-3, DATA-3 | Not started |
| 6 | STACK-5, STACK-4, MOB-1, MOB-2, STACK-1 | Not started |
| 7 | SNK-1, SNK-2, OPS-3, OPS-4, OPS-5 | Not started |

> **Correction 2026-09-16.** An earlier uncommitted draft of this file marked every Round 2–7 item as APPROVED. That was wrong: only Round 1 was closed. Those items are recorded below as PROPOSED, with their content kept as the proposal to be discussed in their rounds.

---

## 1. Governance

### GOV-1 · Decision governance and specification versioning
- **Status:** APPROVED 2026-09-16 (Round 1, option A; versioning and design workflow confirmed by owner instruction the same day)
- **Decision:**
  - New or changed decisions follow: problem → realistic alternatives → trade-offs → recommendation → explicit owner approval → entry in this file with date.
  - A decision is binding only when recorded here as APPROVED. An APPROVED decision is never changed silently; work that cannot follow it stops and proposes a change.
  - PROPOSED items are never promoted silently; recommendations never become project rules without owner approval.
  - `project-spec.md` is consolidated into **Sales Force Specification v1.0** once the blocking decisions close.
  - After v1.0, material product changes are recorded as explicit change decisions here (with the reason) and, when necessary, published as a new specification version (v1.1, v1.2, …). Previously approved behavior is never rewritten silently.
- **Design workflow:**
  - The project stays in design mode until the owner writes `BEGIN IMPLEMENTATION`. Commits and pushes do not authorize implementation.
  - Design work happens on branch `design/blueprint` (created from `main` at `05ccc63`); `main` is the stable branch.
  - Each approved decision batch: update documents → consistency validation → HTML validation (when `docs/blueprint.html` changes) → diff inspection → one focused commit → push to `origin/design/blueprint`.
  - No force push, history rewrite, hard reset or remote branch deletion.

---

## 2. Baseline principles

| ID | Principle | Origin | Status |
|---|---|---|---|
| P-01 | Internal, single-tenant system for ~20–100 users initially, for an industrial company. Not SaaS, not multi-tenant. | spec D1 | APPROVED (Round 1) |
| P-02 | Sankhya is the system of record for ERP data; Sales Force owns CRM-specific data. | spec D2 | APPROVED (Round 1) |
| P-03 | Web and mobile never communicate with Sankhya. Sankhya-specific implementation is isolated behind `packages/sankhya` / `SankhyaGateway`. | spec §7.1, RF-SNK-8 | APPROVED (Round 1) |
| P-04 | Modular monolith. No microservices unless explicitly approved later. | spec D15 | APPROVED (Round 1) |
| P-05 | `packages/domain` holds portable, deterministic business rules, infrastructure-independent, portable between server and mobile runtime where required. | spec §7.2, RF-ORD-2 | APPROVED (Round 1) |
| P-06 | TypeScript with strict type checking. | spec D15 | APPROVED (owner instruction 2026-09-16) |
| P-07 | Mobile operation for representatives is offline-first; web for the other profiles. | spec D3 | APPROVED (Round 1) |
| P-08 | Offline commands are idempotent. The server revalidates every offline command (authorization, price, discount authority, credit, current state, invariants). | spec §10.2 | APPROVED (Round 1) |
| P-09 | Prices come from Sankhya-derived data. An offline order whose applicable price changed goes to `revisao_preco`; prices are never silently replaced. | spec D4, D17 | APPROVED (Round 1) |
| P-10 | Discount rules are enforced server-side. Limits are configured in Sales Force: seller limit, manager limit, director above manager; defaults per profile with per-user override. | spec D21 | APPROVED (Round 1) |
| P-11 | Authentication by email + strong password, Argon2id hashing. No 2FA (accepted risk, with compensating controls). | spec D16 | APPROVED (Round 1) |
| P-12 | Phase order: foundation → sales force → CRM → intelligence/channels → future. | spec D14 | APPROVED (Round 1) |
| P-13 | Out of scope: multi-tenant/SaaS, billing, route planning, GPS check-in, field surveys, point-of-sale photos, returns/exchanges, stock queries or blocking, independent goal/commission calculation, B2B portal, unofficial WhatsApp integration. | spec §3, D5, D6 | APPROVED (Round 1) |
| P-14 | Critical business rules are deterministic. AI runs only through backend-controlled interfaces, receives minimal data, uses read-only tools in Phase 3, and never replaces pricing, credit, permissions, totals, state transitions or idempotency. | spec D18 | APPROVED (Round 1) |
| P-15 | Production and staging are isolated: credentials, databases, job queues, object storage and Sankhya environments. | spec §11, §14 | APPROVED (Round 1) |
| P-16 | Schema evolution follows expand → migrate → contract; mandatory from the first environment holding real data (pilot) and whenever a released mobile app version depends on the old shape (U-09). | spec §14 | APPROVED (Round 1; scope batch 2) |
| P-17 | Files/blobs live in object storage; metadata stays in PostgreSQL. | spec §9.2 | APPROVED (Round 1) |
| P-18 | A new customer passes backoffice approval before becoming a Sankhya partner. | spec D7 | APPROVED (batch 2, U-01) |
| P-19 | One account table across the lifecycle `lead → prospect → cliente_pendente → cliente` (alternates `rejeitado`, `inativo`). | spec D8 | APPROVED (batch 2, U-01) |
| P-20 | External representatives never receive product cost, margin or general export capability. Restricted information is not sent to their client at all; hiding a field in the interface is insufficient. | spec D12, §6.2 | APPROVED (owner instruction 2026-09-16) |
| P-21 | Authorization is enforced server-side; synchronization, AI tools and dashboards use the same scope rules. (Mechanism: AUTH-4, PROPOSED.) | owner instruction 2026-09-16 | APPROVED (owner instruction 2026-09-16) |
| P-22 | Secrets are never committed, never exposed to web or mobile clients, never written into documentation or the visual blueprint. | owner instruction 2026-09-16 | APPROVED (owner instruction 2026-09-16) |
| P-23 | Cost and margin never reach the mobile app for **any** user, and are never sent to AI providers. | spec D12, RF-CAT-4, §6.2 | **PROPOSED** (decide in Round 4) |

**Count:** 22 APPROVED (P-01…P-22), 1 PROPOSED (P-23). An earlier working note mentioned "17" principles approved in Round 1; the register content is authoritative (16 in Round 1 + P-06 and P-20…P-22 by owner instruction + P-18, P-19 in batch 2). No principle was added to reconcile the old count.

**P-18 scope note:** P-18 is only the sentence above. Whether a pending customer may receive quotations, and what blocks order submission before approval, are Phase 1 business rules still to be written and approved (RF-ACC-3, RF-ACC-4).

#### Principle ID traceability

| Old ID (commit `4c10bb3`) | New ID (batch 2) | Change |
|---|---|---|
| P-20 (original draft, combined) | P-20 + P-23 | Split on 2026-09-16: representative part approved, all-users/AI part proposed |
| P-20a | P-20 | Renumbered, text unchanged |
| P-20b | P-23 | Renumbered, text unchanged, still PROPOSED |
| P-01…P-19, P-21, P-22 | unchanged | P-16 text extended with the U-09 scope; P-18, P-19 status changed to APPROVED |

---

## 3. Phase 0 decisions

Each entry: status · decision or proposal · rationale · consequences · validations · relationship to the spec.

### 3.1 APPROVED — Round 1

#### SNK-3 · Sankhya environment for staging and development
- **Status:** APPROVED 2026-09-16 (Round 1) · depends on V-11 (NEEDS VALIDATION)
- **Decision:**
  - Staging uses Sankhya homologation if it exists.
  - If it does not exist, staging and local development use the fake `SankhyaGateway` with sanitized recorded fixtures. CI always uses the fake gateway.
  - If an isolated real (non-production) Sankhya test environment can be obtained, it is added before the pilot.
  - **Pilot gate (U-04, batch 2):** before the pilot, at least one real order write and one real partner write are validated end-to-end in a non-production Sankhya environment (homologation or an isolated test environment). If no such environment can be obtained, a new decision is required before the pilot. A read-only production inspection (below) never substitutes for this validation. Reversible; availability of the environment NEEDS VALIDATION (V-11).
  - Staging never connects to Sankhya production (reads or writes).
  - No production data in staging without an approved sanitization process.
- **REJECTED:** Sankhya production as an environment strategy for development, CI or staging — including read-only use as a staging data source.
- **Exception — read-only diagnostic inspection of Sankhya production during a spike (U-03, batch 2, amends the Round 1 wording):** allowed only when **all** of these are true:
  1. the project owner explicitly authorizes that specific occasion;
  2. there is no adequate homologation/test environment for the question being investigated;
  3. no write operation is performed;
  4. credentials are read-only where technically possible;
  5. only the minimum required information is inspected;
  6. real customer/business data is not copied unnecessarily;
  7. any fixture or response persisted in the repository is sanitized first;
  8. credentials and tokens are never written to Git;
  9. staging is never connected to Sankhya production;
  10. the inspection is recorded in `docs/sankhya-spike.md` (§8 inspection log).
  
  It is an exceptional diagnostic mechanism, **not** an environment strategy. Reversible. Whether Sankhya supports read-only API credentials NEEDS VALIDATION (S0.7).
- **Refines:** P-15; spec §14 ("staging connected to Sankhya homologation") (R22).

#### SNK-4 · Duplicate-proof Sankhya writes
- **Status:** APPROVED 2026-09-16 (Round 1) · foundational · depends on V-11 (NEEDS VALIDATION) and V-13 (NEEDS VALIDATION)
- **Decision:**
  - **Required (B):** custom Sankhya field(s) holding the Sales Force origin identifier, filled at insert and checked before any retry. Field names, types and indexing are defined with the Sankhya partner.
  - **In addition (D):** native Sankhya idempotency, if spike S0 confirms it exists.
  - Heuristic matching (e.g. by customer, date and total) is **REJECTED** as the primary duplicate check.
  - An identifier in an observation field is only an emergency fallback:
    - **Authority (U-05, batch 2):** each use requires explicit authorization by the project owner for that incident, recorded in this register (date, scope, reason). Reversible.
    - **Scope (U-06, batch 2):** only order headers and partner records created while the custom origin-id field is unavailable; the fallback ends when the field is available again. Reversible. Whether suitable observation fields exist on order header and partner NEEDS VALIDATION (S0.8).
    - **Identifier (U-07, batch 2):** the value written — in the custom field or in the fallback — is the Sales Force entity UUID of the order or account, stable across retries; never an attempt or job id. Cheap to change before the first real write, foundational afterwards. Whether the Sankhya field type/length can hold a UUID NEEDS VALIDATION (S0.4, S0.8, S5.4).
  - Validated in S0 before any real order write. If the custom field is not feasible, a new decision is required before Sankhya writes.
- **Supersedes:** RF-SNK-4 identifier in an observation field as the primary mechanism (R23).

#### MOB-3 · App distribution
- **Status:** APPROVED 2026-09-16 (Round 1) · depends on V-10 (NEEDS VALIDATION)
- **Decision:**
  - **Android:** prefer normal Google Play distribution with in-app authentication if Managed Google Play would require managing personal devices; check unlisted/private distribution options.
  - **iOS:** Unlisted App Store distribution preferred; Apple Business Manager custom app as fallback; TestFlight only for beta testing.
  - Start the organizational Apple and Google developer accounts early.
- **Deferred (U-08, batch 2):** the demo environment and demo account for Apple/Google store review stay UNDECIDED until the Phase 1 gate; they depend on device approval (AUTH-2) and on which API environment the store build targets.
- **Supersedes:** spec §14 Managed Google Play / "ABM or TestFlight" (R46, R47).

### 3.2 APPROVED — Round 2 (infrastructure), batch 2

#### OPS-6 · Infrastructure planning constraints
- **Status:** APPROVED 2026-09-16 (Round 2 inputs)
- **Budget (planning target, not an approved ceiling):**
  - Target R$ 300–600/month for the initial **production** architecture.
  - Above R$ 600/month requires a clear justification.
  - Above R$ 800/month must return to the project owner before being treated as the recommended architecture.
  - The budget never justifies sacrificing backups, security, environment isolation, data integrity or recoverability. If the safest reasonable architecture costs more, show the cost and why.
  - Estimates must itemize: production, staging, managed database, object storage, backup, monitoring, likely growth. Do not optimize for hyperscale; scale remains ~20–100 users.
- **Existing accounts:** the company already uses a Hostinger VPS. AWS, Azure, GCP, Oracle Cloud, Magalu Cloud and paid Cloudflare are **not** assumed. Hostinger is an available option, not a mandatory choice. Sales Force production is never placed on an unrelated existing production server merely because it exists.
- **Data residency:** keeping production data in Brazil is a **strong preference**, not currently an absolute legal requirement. The primary production PostgreSQL database preferentially stays in Brazil. An external region/provider may be recommended only with explicit justification that it still satisfies LGPD, adequate contractual/privacy protections, encryption, acceptable latency, security and operational reliability.
- **Operations:** run internally by a small technical team / project maintainer with AI-assisted operations. Minimize infrastructure components; prefer managed services where they materially reduce operational risk; no architecture that requires a dedicated DevOps team; every operational procedure has a documented runbook; recovery never depends on undocumented knowledge.

#### OPS-1 · Hosting, environments and database placement
- **Status:** APPROVED 2026-09-16 (direction) · provider and exact topology NEEDS VALIDATION (V-04)
- **Decision:**
  - Production and staging are isolated environments; production does not share a failure domain with staging.
  - PostgreSQL preferably managed, with point-in-time recovery (PITR).
  - Application compute may run on VPS/VM infrastructure.
  - The database never exposes a public unrestricted endpoint.
  - Production and staging credentials are separate.
  - No lock-in to AWS, Azure or GCP at this stage.
- **Provider selection criteria (in order):** reliability; managed PostgreSQL; PITR; Brazil/São Paulo region when possible; private networking/security; predictable cost; operational simplicity; fit for the initial scale (OPS-6).
- **Fallback:** if this direction cannot fit reasonably within OPS-6, the best "self-hosted PostgreSQL on VPS" design (continuous WAL archiving to external storage) is **presented** to the owner as a fallback — PROPOSED only, never adopted silently, and production recovery targets (OPS-2) are never downgraded without telling the owner.
- **Label note:** the owner approved this as "Option C"; the content approved is the one listed above, which corresponds to option A of the 2026-09-16 presentation (VPS/VM compute + managed PostgreSQL with PITR). The managed container platform (presented as C) and on-premise (D) were not selected.
- **Amends:** spec D19 (R62).

#### DATA-1 · PostgreSQL version policy
- **Status:** APPROVED 2026-09-16 (policy) · final major version NEEDS VALIDATION (V-15, after V-04)
- **Decision:**
  - Minimum PostgreSQL 16 (compatibility floor).
  - Local, CI, staging and production use the same major version.
  - Choose the newest mature major version normally supported by the selected production provider and the required tooling.
  - Prefer PostgreSQL 18 if the selected provider, Drizzle, backup tooling, extensions and operational ecosystem support it cleanly; otherwise PostgreSQL 17 is acceptable.
  - UUIDv7 must be generatable outside PostgreSQL; the project never depends on PostgreSQL 18 solely for UUIDv7.
- **Supersedes:** spec §7.3 "PostgreSQL 16+" (R39).

#### STACK-7 · File / object storage
- **Status:** APPROVED 2026-09-16 · provider NEEDS VALIDATION (V-05, together with V-04)
- **Decision:** managed S3-compatible object storage with:
  - private buckets;
  - separate production and staging buckets and credentials;
  - encryption;
  - short-lived pre-signed URLs;
  - object metadata in PostgreSQL, blob content in object storage (P-17);
  - versioning where useful and lifecycle/retention rules where appropriate;
  - a standard S3-compatible abstraction in the application architecture.
- Prefer a Brazil-region provider for production files when practical; AWS S3 São Paulo is included in the comparison.
- A lightweight S3-compatible emulator for local development may be selected later; it does not define the production provider.
- **REJECTED:** MinIO Community in the new design (repository archived, official images no longer published — R57). Self-hosted object storage (Garage, SeaweedFS) is not selected.
- **Supersedes:** spec §7.1/§7.3/§14 MinIO.

#### OPS-2 · Backups and recovery
- **Status:** APPROVED 2026-09-16 · retention window and cost per provider NEEDS VALIDATION (V-04)
- **Production targets:** RPO ≤ 15 minutes; RTO ≤ 4 hours. For orders, approvals, CRM interactions, customer changes and sync commands, 24 hours of potential data loss is not acceptable.
- **Strategy when managed PostgreSQL is selected:**
  - provider PITR;
  - encrypted automatic backups;
  - ≥ 30 days recovery retention where economically reasonable;
  - independent periodic logical dump;
  - secondary backup copy outside the primary failure domain;
  - backup monitoring;
  - documented recovery runbook;
  - monthly restore test.
- A backup is not valid merely because a backup job reports success; recovery must be tested.
- **Before pilot/production:** recovery procedure documented; backups monitored; at least one restore test succeeded.
- **Staging:** lower retention and a less aggressive RPO are acceptable; staging is never the only copy of valuable production/business information.
- **Still PROPOSED (not part of this approval):** self-hosted WAL-archiving branch (only if the OPS-1 fallback is later approved); encrypted secrets backup outside the servers and reproducible provisioning scripts (to be decided with OPS-3 in Round 7, subject to the OPS-6 runbook rule).
- **Supersedes:** spec §12.3 daily dump and §13 RPO ≤ 24 h (R63, R64).

### 3.3 PROPOSED — Round 3 (server structure) — not yet presented for approval

#### STACK-2 · Server application topology
- **Status:** PROPOSED (Round 3)
- **Proposal:** one NestJS application `apps/server` with two entry points — `api` and `worker` — built into one image and run as two containers.
- **Rationale:** avoids duplicated module wiring between two apps (R54). Sankhya credentials would be given only to the worker container (see SNK-1).
- **Would supersede:** spec §7.2 `apps/api` + `apps/worker`.

#### STACK-3 · API framework
- **Status:** PROPOSED (Round 3) · expensive to reverse
- **Proposal:** NestJS for `apps/server` (as in the spec draft).
- **Rationale:** modules and dependency injection fit the modular monolith; guards/interceptors fit authorization and audit; worker reuses the same modules. Business rules stay in `packages/domain`.

#### STACK-6 · Job queue and scheduling
- **Status:** PROPOSED (Round 3)
- **Proposal:** pg-boss on PostgreSQL; jobs enqueued in the same database transaction as the business write that causes them; Redis and BullMQ removed. `integration_outbox` remains the business record of Sankhya writes; pg-boss jobs only trigger processing. Rate limiting and caches must not assume Redis.
- **Rationale:** removes the database/queue double write and one operated service (R56). pg-boss transactional enqueue with a Drizzle adapter checked 2026-09-16.
- **Would supersede:** spec §7.1/§7.3 Redis + BullMQ.

#### DATA-2 · ORM and migration policy
- **Status:** PROPOSED (Round 3) · expensive to reverse · depends on V-03
- **Proposal:** Drizzle ORM for PostgreSQL (`packages/db`) and mobile SQLite (`packages/mobile-db`). SQL migrations generated, reviewed and committed; `drizzle-kit push` never used outside a disposable local database; hand-written SQL as its own migration; migrations run in a single one-shot locked job before the new version starts; data migrations separate from schema migrations; the contract step waits until no active device depends on the old shape (tracking mechanism UNDECIDED, R11).
- **Would supersede:** spec §14 "migrations executed automatically on deploy" (R61).

### 3.4 PROPOSED — Round 4 (security and access) — not yet presented for approval

#### AUTH-1 · Sessions and tokens
- **Status:** PROPOSED (Round 4)
- **Proposal:**
  - Opaque server-side sessions for web and mobile; tokens stored hashed; built in-house on vetted primitives, with mandatory security review and tests.
  - Web: session identifier in an `httpOnly`, `Secure`, `SameSite=Lax` cookie with CSRF protection.
  - Mobile: short-lived opaque access token + rotating refresh token with reuse detection, stored in the device secure store.
  - Every request validates session, user, session version and device status.
  - New passwords checked against breached-password data (HIBP k-anonymity range API) plus a local common-password list.
- **Rationale:** at ≤ 100 users a per-request lookup is negligible; JWT adds revocation lag and key management without benefit (R15).
- **Would supersede:** spec §12.1 mobile JWT access token.

#### AUTH-2 · Device approval
- **Status:** PROPOSED (Round 4)
- **Proposal:** a representative's new mobile device must be approved (admin or the representative's manager) before any business data is sent; at most 1 active device per representative (configurable); internal users' devices auto-approved with admin notification.
- **Rationale:** compensates the accepted absence of 2FA (R13).

#### AUTH-3 · Representatives on the web
- **Status:** PROPOSED (Round 4)
- **Proposal:** the external representative profile cannot authenticate on the web application, enforced server-side. Representative imports (RF-IMP-5) happen in the mobile app or by an internal user on their behalf (UX UNDECIDED, R14).

#### AUTH-4 · Authorization model
- **Status:** PROPOSED (Round 4) · foundational
- **Proposal:**
  - a. Data scope per resource permission (not per profile): `nenhum`, `proprio`, `equipe`, `tudo`.
  - b. Teams form a tree; `equipe` includes sub-teams.
  - c. An account has one owner (from Sankhya for Sankhya customers) plus zero or more attendants assigned in Sales Force; attendants never become owners in Sankhya.
  - d. A child record is visible when its account is in scope or the user is the record's responsible person; account-derived data inherit account visibility.
  - e. One central policy module used by API endpoints, sync, exports, dashboards, jobs acting for a user and AI tools; PostgreSQL row-level security not used initially.
- **Rationale:** one implementation of the most sensitive rule, testable as a matrix (R49–R52). Implements approved principle P-21.
- **Would supersede:** spec D11 and §8.1 per-profile scope.

### 3.5 PROPOSED — Round 5 (offline synchronization and data conventions) — not yet presented for approval

#### SYNC-1 · Sync engine
- **Status:** PROPOSED (Round 5) · foundational
- **Proposal:** custom synchronization protocol specified in `sync-protocol.md`; PowerSync (self-hosted or cloud) not used.
- **Rationale:** PowerSync would express data scope a second time in its own rule language, adds a service and logical replication, and the cloud option sends customer data to a third party. Matches spec D15.

#### SYNC-2 · Change tracking and cursor
- **Status:** PROPOSED (Round 5) · depends on V-07
- **Proposal:** synchronizable rows record the writing transaction id (`xid8`); pull delivers only changes from transactions finished before the server snapshot (commit-safe watermark); mirror upserts write only when content changed (content hash).
- **Rationale:** a global sequence cursor skips rows under concurrent transactions (R01); unconditional mirror rewrites force full downloads (R02).
- **Would supersede:** spec §9.1 `change_seq` from a global sequence.

#### SYNC-3 · Scope changes and removals
- **Status:** PROPOSED (Round 5) · foundational
- **Proposal:** visibility changes recorded as scope events; account entering scope delivered as a full bundle, leaving scope as a bundle deletion; record-level events for responsible-person visibility; role/team/permission changes force a full resync; every account-scoped synchronizable table carries non-null `account_id`; data aging out of retention cleaned locally.
- **Rationale:** otherwise child records leak to the previous owner or never reach the new one (R03, R04).
- **Would supersede:** spec §10.1 removal by portfolio comparison.

#### DATA-3 · Data conventions
- **Status:** PROPOSED (Round 5) · foundational
- **Proposal:**
  - UUIDv7 entity identifiers generated by client or server; business logic never orders by identifier; server rejects UUIDv7 values more than 1 day in the future.
  - Rows mirrored from Sankhya use deterministic UUIDv5 from the Sankhya natural key, plus a unique constraint on that key.
  - Unit prices `numeric(18,6)`; monetary totals `numeric(14,2)`; money computed with exact decimal arithmetic on server and mobile, never JavaScript `number`.
  - `timestamptz` for events; `date` for business dates; business calculations in `America/Sao_Paulo`.
  - Soft delete and audit columns on synchronizable tables.
  - Schema organized per module; dependency lint rule in CI; cross-module reporting through read-only SQL views.
  - Precision of percentages and quantities and the rounding rule: NEEDS VALIDATION (spike S2).
- **Would supersede:** spec §9.1 `numeric(14,2)` for unit prices (R32); adopts R40, R41, R43, R55.

### 3.6 PROPOSED — Round 6 (clients and tooling) — not yet presented for approval

#### STACK-5 · Web framework
- **Status:** PROPOSED (Round 6) · expensive to reverse
- **Proposal:** Vite + React SPA with TanStack Router, TanStack Query, Tailwind CSS, shadcn/ui; static files served by Caddy on the same origin as the API (`/api`); runtime configuration file; no server-side rendering.
- **Rationale:** internal authenticated app with no SEO/SSR need; same-origin cookie sessions; one fewer server process; smaller attack surface (R58).
- **Would supersede:** spec §7.3 Next.js App Router.

#### STACK-4 · API contracts
- **Status:** PROPOSED (Round 6) · depends on V-02
- **Proposal:** Zod schemas in `packages/contracts` as the source of truth; server validates with them; OpenAPI generated from them; typed web/mobile clients generated from OpenAPI.

#### MOB-1 · Mobile architecture
- **Status:** PROPOSED (Round 6) · expensive to reverse
- **Proposal:** Expo with continuous native generation and development builds (no Expo Go); EAS Build and EAS Update with update code signing; iOS builds on EAS. Over-the-air update rules for local schema and protocol changes UNDECIDED (R10, R11).

#### MOB-2 · Offline database and encryption
- **Status:** PROPOSED (Round 6) · library NEEDS VALIDATION (V-09)
- **Proposal:** encrypted SQLite through Drizzle; unencrypted local storage rejected; library chosen by spike S7 between expo-sqlite + SQLCipher and op-sqlite + SQLCipher.

#### STACK-1 · Monorepo tooling
- **Status:** PROPOSED (Round 6) · depends on V-01
- **Proposal:** pnpm workspaces + Turborepo, no remote cache. Fallback for Expo with isolated installs: `nodeLinker: hoisted`.

### 3.7 PROPOSED — Round 7 (Sankhya boundary and operations) — not yet presented for approval

#### SNK-1 · Integration boundary
- **Status:** PROPOSED (Round 7)
- **Proposal:** all writes to Sankhya through `integration_outbox`, processed by the worker; user-facing reads from the PostgreSQL mirror; synchronous read-only API calls only from an allowlist (`architecture.md` §7.4, empty; additions require a decision); gateway exposes Sales Force-shaped types; Sankhya credentials only in the worker container while the allowlist is empty.
- **Refines:** P-03.

#### SNK-2 · Sankhya API and authentication
- **Status:** PROPOSED (Round 7) · API per operation NEEDS VALIDATION (V-12)
- **Proposal:** OAuth 2.0 client credentials + `X-Token`, access token cached and renewed; legacy appkey/token model not implemented; REST v1 vs gateway services decided per operation by spike S1.
- **Evidence:** Sankhya developer documentation (`sankhya-spike.md` F-01 — documentation level only).
- **Would supersede:** spec §1.4/§11 "appkey/token" (R20, R21).

#### OPS-3 · CI/CD
- **Status:** PROPOSED (Round 7)
- **Proposal:** GitHub Actions with actions pinned to commit SHA; images in GitHub Container Registry tagged by commit SHA; SSH deploy by a restricted deploy user (one-shot locked migration job, then `docker compose up`); staging deploys on merge to `main`, production on version tag with manual approval (GitHub Environments); `main` protected (PR + passing CI, spec D20); EAS build profiles and update channels per environment; dependency update automation and vulnerability scanning.

#### OPS-4 · Observability
- **Status:** PROPOSED (Round 7) · depends on V-08
- **Proposal:** Sentry SaaS for server, web and mobile with strict scrubbing (no bodies, form data, cookies or authorization headers; internal user id only); pino JSON logs with correlation IDs propagated to jobs; Docker log rotation; `/health`; external uptime monitor; in-app integration health panel; central log aggregation deferred (R65).

#### OPS-5 · Transactional email
- **Status:** PROPOSED (Round 7) · depends on V-06
- **Proposal:** SMTP; Google Workspace SMTP relay if the company uses Google Workspace, otherwise Amazon SES (São Paulo); SPF, DKIM and DMARC; no sensitive business data in email bodies (R59).

---

## 4. Status of the specification's decisions (spec §4)

The spec is a draft. Its decisions are binding only where an APPROVED entry above covers them.

| Spec | Status | Notes |
|---|---|---|
| D1 | APPROVED | P-01 |
| D2 | APPROVED | P-02 |
| D3 | APPROVED | P-07. Representatives mobile-only (AUTH-3) is PROPOSED |
| D4 | APPROVED | P-09 |
| D5 | APPROVED | P-13 |
| D6 | APPROVED | P-13; source of positivization NEEDS VALIDATION (S6, R28) |
| D7 | APPROVED | P-18; partner mandatory fields NEEDS VALIDATION (S5) |
| D8 | APPROVED | P-19 |
| D9 | PROPOSED | Phase 2 scope; details decided in Phase 2 |
| D10 | PROPOSED | Phase 2 scope; details decided in Phase 2 |
| D11 | PROPOSED | AUTH-4 would replace it (Round 4) |
| D12 | APPROVED in part | P-20 APPROVED; P-23 PROPOSED; AUTH-2/AUTH-3 extensions PROPOSED |
| D13 | PROPOSED | wa.me link + manual registration (Phase 2); official API Phase 4. The ban on unofficial WhatsApp integration is APPROVED (P-13) |
| D14 | APPROVED | P-12 |
| D15 | APPROVED in part | Modular monolith (P-04) and strict TypeScript (P-06) APPROVED; stack choices PROPOSED (STACK-1…7, SYNC-1) |
| D16 | APPROVED | P-11; compensating controls (AUTH-1, AUTH-2) PROPOSED |
| D17 | APPROVED | P-09; detection details UNDECIDED (R33) |
| D18 | APPROVED | P-14 |
| D19 | AMENDED | OPS-1 (VPS/VM compute kept; managed PostgreSQL with PITR preferred; isolated staging) |
| D20 | PROPOSED | CI blocks merge; no global coverage target; high coverage in domain, sync and permissions |
| D21 | APPROVED | P-10; calculation base and routing UNDECIDED (R35, R36) |

---

## 5. Open items

Not decided. Never implement behavior that depends on them.

### 5.1 Round 1 clarifications — closed 2026-09-16 (batch 2)

Kept for traceability. The binding text lives in the entry named in "Recorded in".

| ID | Question | Outcome | Final status | Recorded in |
|---|---|---|---|---|
| U-01 | Approve P-18 and P-19? | Approved with the exact wording shown in §2 | APPROVED | §2 P-18, P-19 |
| U-02 | Change control after v1.0 | Explicit change decision + new spec version | APPROVED | GOV-1 |
| U-03 | Read-only access to Sankhya production during spikes | Production as an environment stays REJECTED; exceptional read-only diagnostic inspection under 10 owner conditions | APPROVED (read-only credential support NEEDS VALIDATION) | SNK-3 |
| U-04 | Real non-production Sankhya environment before the pilot | Mandatory: one real order write and one real partner write validated outside production; otherwise new decision | APPROVED (availability NEEDS VALIDATION, V-11) | SNK-3 |
| U-05 | SNK-4 fallback authority | Project owner, per incident, recorded here | APPROVED | SNK-4 |
| U-06 | SNK-4 fallback scope | Only order headers and partners created while the custom field is unavailable | APPROVED (observation fields NEEDS VALIDATION) | SNK-4 |
| U-07 | SNK-4 identifier | Sales Force entity UUID of the order or account, never an attempt or job id | APPROVED (field capacity NEEDS VALIDATION) | SNK-4 |
| U-08 | Store review demo environment | Deferred to the Phase 1 gate | UNDECIDED (scheduled) | MOB-3, §5.2 |
| U-09 | When expand → migrate → contract is mandatory | From the first environment with real data (pilot) and whenever a released mobile version depends on the old shape | APPROVED | P-16 |

### 5.2 Phase 1 gate — UNDECIDED

| Ref | Topic |
|---|---|
| R05 | Concurrent edit rules for CRM records (spec's per-field `updated_at` rule is not workable) |
| R06 | Offline command ordering and dependencies; rejected parent (e.g. customer rejected with pending order) |
| R07 | Editing an order awaiting approval; which states allow edits |
| R08 | Whether drafts sync to the server |
| R09 | Naming/roles of `command_id`, `entity_id`, outbox idempotency key |
| R10 | Local database migration with pending outbox under OTA updates |
| R11 | Sync protocol version policy and device-version tracking |
| R14 | UX for representative imports (depends on AUTH-3) |
| R16 | Clock tampering against the max-offline lock |
| R17 | CNPJ/CPF deduplication lookup leaking other portfolios |
| R19 | Excluding app data from OS backups |
| R24, R25 | Order lifecycle in Sankhya (confirmation, partial invoicing) — spike S3 |
| R26 | Single source of approvals vs Sankhya native limit release — spike S4 |
| R27 | Partner mandatory fields — spike S5 |
| R28 | Goals, positivization, commissions sources — spike S6 |
| R30 | Taxes (IPI/ICMS-ST) in quotations and proposals — spike S2 |
| R31 | Real price resolution rule — spike S2 |
| R33 | Price snapshot content for revision detection |
| R35 | Discount authority calculation base |
| R36 | Approval routing, absolute ceiling, substitute approver |
| R37 | Credit exception approver and approval order |
| R38 | Offline available-credit calculation |
| R42 | Server history depth — decide before the first sales-document mirror load |
| R45 | Lost local encryption key |
| R48 | Mobile E2E and iOS testing without macOS |
| R60 | Offline quotation PDF |

### 5.3 Phase 2 and later — UNDECIDED

| Ref | Topic |
|---|---|
| R34 | Proposal pricing for leads without Sankhya link |
| R53 | Pool for unassigned leads |
| R18 | AI knowledge base visibility per profile (Phase 3) |

### 5.4 Parallel (non-technical) — UNDECIDED

| Ref | Topic |
|---|---|
| R67 | LGPD international data transfer — legal review before the pilot |

---

## 6. Validation register — all NEEDS VALIDATION

| ID | Question | Resolves | Needed by |
|---|---|---|---|
| V-01 | Expo + pnpm isolated installs work in the skeleton (fallback `nodeLinker: hoisted`)? | STACK-1 | Phase 0 skeleton |
| V-02 | Which Zod → OpenAPI library and which typed client generator? | STACK-4 | Phase 0 first endpoint |
| V-03 | Which Drizzle version line to pin? | DATA-2 | Phase 0 skeleton |
| V-04 | Provider combination under OPS-6: VPS/VM compute + managed PostgreSQL with PITR (retention and cost), private networking, Brazil region preferred; itemized monthly cost (production, staging, database, storage, backup, monitoring, growth); secondary backup location | OPS-1, OPS-2 | Before provisioning environments |
| V-05 | Object storage provider/region (Brazil preferred; AWS S3 São Paulo compared), versioning and lifecycle support, cost; local S3-compatible emulator chosen separately | STACK-7 | Before provisioning environments |
| V-06 | Does the company use Google Workspace? | OPS-5 | Before password reset |
| V-07 | Commit-safe watermark proven by concurrent-transaction test | SYNC-2 | With the first synchronizable table |
| V-08 | Sentry data region; processor registration | OPS-4 | Before real personal data (pilot) |
| V-09 | Spike S7: SQLCipher library, Android 16 KB pages, FTS5, Drizzle, performance | MOB-2 | Phase 1 gate |
| V-10 | Spike S8: organizational accounts, D-U-N-S, Google Play private/unlisted options and Managed Play device-management requirements, Apple unlisted distribution acceptance, Android developer verification | MOB-3 | Before the pilot |
| V-11 | Spike S0: homologation existence; availability of an isolated real test environment; whether read-only API credentials exist (for U-03 inspections); request limits; integration cost; authorization and feasibility of custom origin-id fields | SNK-3, SNK-4 | Before any real Sankhya connection |
| V-12 | Spike S1: API per operation, incremental reads, deletion detection | SNK-2 | Before the Phase 0 mirror |
| V-13 | Native Sankhya idempotency support | SNK-4 (D) | Before real order writes |
| V-14 | Real data volumes: portfolio size per representative, prices per customer, item history (R12) | SYNC-3 sizing, spec §13 targets | Phase 1 gate (with S7) |
| V-15 | Final PostgreSQL major: newest mature version supported cleanly by the selected provider, Drizzle, backup tooling and required extensions (18 preferred, 17 acceptable, 16 floor) | DATA-1 | After V-04, before the Phase 0 skeleton |
