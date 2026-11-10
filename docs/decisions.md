# Decision Register — Sales Force

**Responsibility of this file:** the single register of project decisions — what was decided, why, what is only proposed, and what remains open.
How decisions are applied lives in `architecture.md`, `security-model.md`, `sync-protocol.md` and `roadmap.md`.

**Last updated:** 2026-09-18 · **Project mode:** IMPLEMENTATION, Phase 0 only (`BEGIN IMPLEMENTATION` issued by the project owner 2026-09-18; anything outside the current roadmap phase still needs its own authorization)

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
| 2 | OPS-6 (constraints), OPS-1, DATA-1, STACK-7, OPS-2 | **Closed 2026-09-16** (batch 2; amended batch 3) — providers and final PostgreSQL major NEEDS VALIDATION |
| 3 | STACK-2, STACK-3, STACK-6, DATA-2, ARCH-1 | **Closed 2026-09-16** (batch 3) — pg-boss provider compatibility and Drizzle versions NEEDS VALIDATION |
| 4 | AUTH-4, AUTH-3, AUTH-2, AUTH-1, P-23 | Open — to be presented next |
| 5 | SYNC-1, SYNC-2, SYNC-3, DATA-3 | Not started |
| 6 | STACK-5, STACK-4, MOB-1, MOB-2, STACK-1 | **Closed 2026-09-18** — STACK-1, STACK-5 APPROVED; STACK-4, MOB-1, MOB-2 APPROVED in direction; V-01 and V-03 to be resolved during WP 0.2, V-02 with the first real endpoint, V-09 (MOB-2 library) NEEDS VALIDATION |
| 7 | SNK-1, SNK-2, OPS-3, OPS-4, OPS-5 | Not started |
| Owner rulings | PROD-1, CFG-1…CFG-6, SNK-5, SNK-6, SEC-1, DOC-1 (§3.8) | **Closed 2026-09-18** — taken after Sandbox spikes S1–S3; physical Sankhya configuration model, origin-id field definition and configuration bootstrap remain open (U-10…U-12) |
| Owner rulings 2026-10-02 | AUTH-5, STACK-2a, ROLE-1, AUDIT-1, ENV-1, MOB-7 (§3.11) | **Closed 2026-10-02** — staging auth, verifier topology (amends STACK-2), staging infrastructure, Android identity; real verifier adapter and backup location remain blocked/pending |
| Owner rulings 2026-10-28 | PB-1, SB-1, SB-2 (amends MOB-7), DISC-2, AUTH-6, AUTH-7, AUTH-8 (§3.13) | **Closed 2026-10-28** — STACK-2b approved (verifier egress open, Sandbox only); PB-1, DISC-2, AUTH-6 need a slice plan before code |

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
  - The project stays in design mode until the owner writes `BEGIN IMPLEMENTATION` (satisfied 2026-09-18, Phase 0 only). Commits and pushes do not authorize implementation.
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
| P-01 | unchanged | Scope amended 2026-09-18 by PROD-1 (reusable product, one isolated installation per customer); text unchanged |

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

#### Batch 3 amendments to Round 2 (APPROVED 2026-09-16)

- **OPS-6 budget interpretation:** R$ 300–600/month remains the target, not a reason to weaken the architecture. For planning, a technically sound **production** environment up to approximately **R$ 700/month** may be presented as a reasonable candidate without redesigning the architecture; above **R$ 800/month** requires explicit owner review. Staging is optimized separately and should cost materially less than production. Production and staging are never combined into one failure domain to reduce cost. No provider is chosen from indicative numbers.
- **OPS-1 database network access:**
  - Preferred: **private networking** between production application compute and PostgreSQL. A publicly routable database endpoint is not the preferred production design.
  - Fallback only: an IP-allow-listed TLS endpoint, and only if all hold — the provider offers no appropriate private networking; firewall access limited to fixed application IPs; TLS certificate verification mandatory; strong unique credentials; credentials rotated; the database rejects all other network sources; a security review approves the topology.
  - **REJECTED:** PostgreSQL openly exposed to the internet (e.g. `0.0.0.0/0` + password).
- **OPS-1 staging topology — PROPOSED cost optimization (until provider selection):** a separate small staging VPS with PostgreSQL running on the staging host, provided staging stays isolated from production, is never the only copy of important business data, never receives unsanitized production data, uses completely different credentials, and does not alter the production architecture.
- **OPS-1 provider shortlist (candidates, not decisions):** AWS São Paulo, Magalu Cloud, Azure Brazil South, and other providers that satisfy the architecture. The comparison labels every figure VERIFIED, UNVERIFIED or NEEDS FORMAL QUOTE; third-party price mirrors are never authoritative. A quote checklist for AWS, Magalu and Azure precedes the final provider approval (`architecture.md` §10.3).
- **STACK-7 with other providers:** if Azure is later chosen for compute/database, Azure Blob does **not** replace the S3-compatible abstraction. Files would use AWS S3, a validated Magalu S3-compatible service or another approved S3-compatible provider; avoid unnecessary multi-provider complexity, but never change STACK-7 silently.
- **Observability cost:** Sentry Team or paid uptime monitoring is not an approved dependency. OPS-4 remains PROPOSED (Round 7); comparisons show observability as a separate optional cost line.

### 3.3 APPROVED — Round 3 (server and persistence), batch 3

#### STACK-2 · Server process topology
- **Status:** APPROVED 2026-09-16 · reversibility: cheap before implementation, moderate after
- **Decision:** one modular server codebase with two independent runtime entry points — **API** and **Worker** — running as separate processes/containers.

  ```text
  apps/server
      ├── API entry point
      └── Worker entry point
  ```

  They may share application modules, domain orchestration, contracts, database access, authorization policies and observability infrastructure.
- **Security rule:** Sankhya credentials exist only in the worker runtime unless a later explicitly approved use case requires API-side access. *(Amended 2026-10-02 by STACK-2a, §3.11: authentication-only credentials also live in a dedicated internal verifier; never in the API.)*
- **Rationale:** one codebase; one architectural module graph; less duplicated wiring (R54); background processing cannot block HTTP requests; worker-specific secrets stay unavailable to the API process; easier maintenance for a small team.
- Architecture documentation only — the `apps/server` structure is not created before `BEGIN IMPLEMENTATION`.
- **Supersedes:** spec §7.2 `apps/api` + `apps/worker`.

#### STACK-3 · API / server framework
- **Status:** APPROVED 2026-09-16 · expensive to reverse after implementation
- **Decision:** NestJS.
- **Constraint:** NestJS never owns core business rules. Core deterministic rules stay in `packages/domain`; the framework layer orchestrates them. Business logic is never tied to decorators, HTTP, NestJS request objects, controllers or infrastructure services.
- The HTTP adapter is an implementation detail, decided in the Phase 0 plan unless it materially affects the architecture.
- **Rationale:** fits the modular monolith; clear module boundaries; dependency injection; guards/interceptors for authorization, audit and observability; worker and API reuse modules; well-understood TypeScript ecosystem; maintainable for an AI-assisted small team.

#### STACK-6 · Background job engine
- **Status:** APPROVED 2026-09-16 · provider compatibility NEEDS VALIDATION (V-16)
- **Decision:** pg-boss on PostgreSQL. Redis + BullMQ are not part of the initial architecture; rate limiting and caches do not assume Redis.
- **Outbox rule:** `integration_outbox` is the **business/integration record** of Sankhya delivery; pg-boss is only the execution mechanism and is never the sole source of truth.

  ```text
  business transaction ─► integration_outbox record (+ pg-boss job, same transaction)
                            ─► worker ─► SankhyaGateway ─► Sankhya
  ```

  `integration_outbox` retains: state; attempts; origin identifier; idempotency data (SNK-4); error details; operator visibility; retry/reprocessing; auditability.
- **Validation gate:** some managed PostgreSQL providers or connection poolers can affect connection behavior pg-boss relies on; provider selection verifies this (V-16). Preferred mitigation: the worker uses a dedicated direct PostgreSQL connection for pg-boss while API traffic uses the normal application pool. The architecture is not abandoned because a generic external pooler is incompatible when the provider exposes a safe direct endpoint. If the chosen platform fundamentally cannot support pg-boss safely, the issue returns to the owner as an architecture decision — pg-boss is never replaced silently.
- **Rationale:** no additional infrastructure service; lower operational burden (OPS-6); transactional enqueue with business data; retries and schedules supported (R56).
- **Effect on SNK-1:** the Sankhya **write path** (outbox record → worker → gateway) is approved here; the rest of SNK-1 stays PROPOSED.
- **Supersedes:** spec §7.1/§7.3 Redis + BullMQ.

#### DATA-2 · Database access and migrations
- **Status:** APPROVED 2026-09-16 · expensive to reverse · Drizzle version NEEDS VALIDATION (V-03, V-15)
- **Decision:**
  - **PostgreSQL:** Drizzle ORM — APPROVED.
  - **Mobile SQLite:** Drizzle — APPROVED direction; adapter/library compatibility depends on the mobile database encryption spike (S7, V-09). The ORM choice never weakens the requirement that the mobile database is encrypted: if the selected encrypted SQLite implementation cannot work safely with Drizzle, the conflict returns to the owner. Encryption is never silently downgraded. (MOB-2 itself is decided in Round 6.)
- **Migration policy:**
  1. Schema migrations are versioned SQL migration files.
  2. Generated migrations are reviewed before being committed.
  3. Hand-written SQL is allowed when required for triggers, functions, specialized indexes, views, constraints or PostgreSQL-specific behavior.
  4. Hand-written SQL still exists as a tracked migration.
  5. `drizzle-kit push` or equivalent direct schema synchronization is used only against disposable local development databases — never as the deployment mechanism for staging with valuable data, pilot or production.
  6. Deployment runs migrations through a controlled one-shot migration step before the new application version becomes active.
  7. Migration execution is protected against concurrent execution.
  8. Data migrations are separate from schema migrations (e.g. schema: add `account_status`; data: transform imported accounts to the new lifecycle).
  9. Expand → migrate → contract follows P-16.
  10. Once released mobile clients depend on an old schema/protocol shape, the contract/removal step waits until compatibility rules permit it (version policy UNDECIDED, R11).
- **Supersedes:** spec §14 "migrations executed automatically on deploy" (R61).

#### ARCH-1 · Dependency direction between server, domain and persistence
- **Status:** APPROVED 2026-09-16
- **Decision:**
  - `apps/server` may depend on `packages/domain`.
  - `packages/domain` never depends on `apps/server` or NestJS.
  - `packages/db` provides persistence mechanisms.
  - Domain business rules never import Drizzle, PostgreSQL clients, NestJS, HTTP, pg-boss, Sankhya SDK/API types, or Node-only APIs when the rule must also run on mobile.
- **Still PROPOSED:** the stricter full package dependency table in `architecture.md` §4.1, including "no Node built-ins anywhere in `packages/domain`".

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

### 3.6 APPROVED — Round 6 (clients and tooling), 2026-09-18

Approved by the project owner on 2026-09-18. Library and generator choices that depend on the skeleton or on a spike stay open as validations (V-01, V-02, V-03, V-09).

#### STACK-1 · Monorepo tooling
- **Status:** APPROVED 2026-09-18 (Round 6) · V-01 to be resolved during WP 0.2
- **Decision:** pnpm workspaces + Turborepo, no remote cache initially. `nodeLinker: hoisted` is a fallback used only if V-01 proves it necessary for Expo.

#### STACK-4 · API contracts
- **Status:** APPROVED IN DIRECTION 2026-09-18 (Round 6) · exact Zod → OpenAPI library and client generator NEEDS VALIDATION (V-02), decided with the first real endpoint
- **Decision:** Zod schemas in `packages/contracts` are the source of truth. The server validates against them; OpenAPI is generated from them; typed web and mobile clients are generated from the OpenAPI. No hand-maintained duplicate DTO or type definitions.

#### STACK-5 · Web framework
- **Status:** APPROVED 2026-09-18 (Round 6) · expensive to reverse
- **Decision:** Vite + React single-page app with TanStack Router, TanStack Query, Tailwind CSS and shadcn/ui; static files served by Caddy on the same origin as the API (`/api`); runtime configuration file; no server-side rendering (authenticated internal application, no SEO/SSR need, same-origin cookie sessions, one fewer server process — R58).
- **Supersedes:** spec §7.3 Next.js App Router (spec updated 2026-09-18).

#### MOB-1 · Mobile architecture
- **Status:** APPROVED IN DIRECTION 2026-09-18 (Round 6) · expensive to reverse
- **Decision:** Expo development builds, never Expo Go; the architecture stays compatible with encrypted local storage, EAS Build, EAS Update and update code signing (details in `architecture.md` §9). Over-the-air update rules for local schema and protocol changes remain UNDECIDED (R10, R11).
- **Delivery priority (owner, 2026-09-18):** mobile is not on the critical path of the first implementation slice and must not delay the web application. Phase 0 creates only the mobile foundation required by the approved monorepo and architecture (the shell that validates the toolchain, V-01).

#### MOB-2 · Offline database and encryption
- **Status:** APPROVED IN DIRECTION ONLY 2026-09-18 (Round 6) · library NEEDS VALIDATION (S7, V-09)
- **Decision:** offline mobile data must be encrypted; unencrypted local storage is rejected. Drizzle remains the intended local data-access abstraction (DATA-2). The encrypted SQLite implementation/library is not selected: do not select or implement an unvalidated library before S7. The web application never waits on V-09.

### 3.7 PROPOSED — Round 7 (Sankhya boundary and operations) — not yet presented for approval

#### SNK-1 · Integration boundary
- **Status:** PROPOSED (Round 7) — except the write path through `integration_outbox` and the worker, APPROVED under STACK-6
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

### 3.8 APPROVED — Owner rulings after spikes S1–S3 (2026-09-18)

Recorded from the project owner's instructions of 2026-09-18, after the Sandbox spikes S1–S3 (evidence in `docs/sankhya-spike.md` §9). Where a proposal in the spike document conflicts with an entry below, the entry wins. What is still PROPOSED is labelled per entry.

#### PROD-1 · Reusable product, one isolated installation per customer
- **Status:** APPROVED 2026-09-18
- **Decision:** Sales Force is a reusable product. The first customer (PLAC) is the first installation, not the product. Each customer receives an isolated installation with its own PostgreSQL database, Sankhya environment, secrets, business data and Sales Force configuration, running the same application source, migrations, Docker images and application version. Commercial configuration is governed from Sankhya and mirrored locally (CFG-1). Secrets stay outside the Sankhya business configuration.
- **Amends the scope of P-01 (owner ruling 2026-09-18); P-13 unchanged:** P-01's wording "internal … for an industrial company" now describes the first installation, not the product. It is still not multi-tenancy or SaaS — installations share no runtime, database or secrets, and each installation is single-tenant. A shared multi-customer runtime or a hosted multi-customer offering would need a new decision. P-01's text is kept as written and read together with this entry.
- **Open impact:** the OPS-1/OPS-6/STACK-7 infrastructure, cost and operations model was set for one production environment; the per-installation model is not decided (U-13).
- **Consequence:** no customer-specific value (company code, TOP, table, seller mapping, product-use values, custom-field names) is hardcoded in application code, migrations or fixtures presented as product behavior; such values are installation configuration.

#### CFG-1 · Customer-specific commercial configuration governed from Sankhya
- **Status:** APPROVED IN DIRECTION 2026-09-18 · physical Sankhya configuration model (table/screen) PROPOSED, not designed (U-10) · configuration source before that model exists UNDECIDED (U-11)
- **Decision:** target flow: Sankhya "Configuração Sales Force" → configuration synchronization (worker and `SankhyaGateway`, P-03) → local PostgreSQL configuration mirror/cache → Sales Force. Application code consumes the effective configuration; it never embeds the values.
- **Covers at least:** account → seller mapping (CFG-2), allowed product-use values (CFG-3), customer-without-price-table policy (CFG-4), missing-price visibility and orderability (CFG-5), company, order TOP, quotation TOP if used, default negotiation/payment type and related commercial defaults (CFG-6).
- **Does not cover:** secrets (SEC-1; P-22). Discount authority stays configured in Sales Force (P-10; R35, R36 unchanged). Authorization stays server-side (P-21); configuration never replaces it.

#### CFG-2 · Account → seller (`CODVEND`) mapping
- **Status:** APPROVED 2026-09-18 · supersedes the spike proposal "Option A: Sales Force-owned mapping" (NOT approved) · physical model PROPOSED (U-10)
- **Decision:** the rule linking a Sales Force account to a Sankhya seller is ultimately configured from the customer's Sankhya-side Sales Force configuration (CFG-1) and mirrored locally. `TSIUSU.CODVEND` is not hardcoded as the universal rule. The validated `TSIUSU.CODVEND → TGFVEN.CODVEND` relationship (`sankhya-spike.md` F-33, F-34) remains evidence and may support or default the configuration. Sales Force account ownership is a product-configuration concern.
- **Affects:** RF-IAM-4 (revised 2026-09-18).
- **Security (P-21), proposed guard-rails — NOT approved:** the mapping drives the portfolio scope, so the mirrored configuration is versioned and audited, a configuration change never widens a user's scope without a recorded audit event, and server-side authorization stays the only policy. `security-reviewer` reviews the design when U-10 is designed (`security-model.md` §15).

#### CFG-3 · Sellable product-use values (`USOPROD`)
- **Status:** APPROVED 2026-09-18
- **Decision:** the allowed `USOPROD` values are installation configuration ("Product settings → Allowed product-use values for Sales Force"). The PLAC Sandbox evidence makes `V` and `R` strong candidates but not a universal rule (not approved). The product catalog consumes `configuration.product.sellableUsageValues` (or the equivalent approved domain model); literal `V`/`R` checks must not appear in product, domain or UI code. The unexplained values `S` and `3` stay NEEDS VALIDATION.

#### CFG-4 · Customer without a price table (`CODTAB` null)
- **Status:** APPROVED 2026-09-18
- **Decision:** no hardcoded fallback. The policy is installation pricing configuration, set in the Sankhya-side configuration, conceptually one of: no fallback / no price; a configured default table; another approved strategy. Until a fallback is explicitly configured, **`CODTAB` null = no resolved price table**. Table 5 is never assumed silently.

#### CFG-5 · Missing price
- **Status:** APPROVED 2026-09-18 (first implementation)
- **Decision:** a missing price is not zero. It is shown explicitly as "Sem preço" (or an equivalent localized status), never as R$ 0,00. By default an item without a resolved price is not added to an ERP-submittable order. Whether such items are visible or orderable (catalog browsing, diagnostics) is configurable per installation. ERP submission is disabled in the first slice (SNK-6). Handling the S2 finding that REST returns `valor 0` for both a missing and an explicit-zero price belongs to the mirror design and is not decided here.

#### CFG-6 · Company, TOP and payment type
- **Status:** APPROVED 2026-09-18
- **Decision:** the PLAC Sandbox values used in S3 (company, TOP, negotiation) are test evidence only, never application constants. They become required installation configuration coming from the Sankhya-side model (CFG-1): enabled/default company, order TOP, quotation TOP if used, default negotiation/payment type and related commercial defaults where required. Because real ERP submission is disabled, they need not be fixed before UI implementation and do not block Phase 0.

#### SNK-5 · Dedicated Sales Force origin-id field
- **Status:** APPROVED IN DIRECTION 2026-09-18 · name (`AD_SFORIGINID` or equivalent) and physical definition PROPOSED · not created · needs its own Sankhya configuration implementation and validation (V-11, V-13, U-12)
- **Decision:** `AD_VDYORIG` and `AD_NUVIDYA` are not reused as the permanent Sales Force origin-id field, because Vidya Force and Sales Force may coexist and the fields may collide semantically. A dedicated Sales Force field is created later in Sankhya. Requirements: UUID-compatible; dedicated to Sales Force; efficiently searchable; uniquely constrained/indexed where supported and safe; accepted by the supported `incluirNota` path. The field is NOT created now.
- **Application side:** the outbox and idempotency design expects a dedicated external origin id (SNK-4; identifier per U-07 remains the Sales Force entity UUID).
- **Refines:** SNK-4 ("field names, types and indexing are defined with the Sankhya partner"). SNK-4 stays gated by V-11 and V-13.

#### SNK-6 · Scope of the Sandbox write validation and remaining write gates
- **Status:** APPROVED 2026-09-18
- **Decision:**
  - SNK-4 and V-11/V-13 gate the Sales Force integration write path. They did not prohibit the explicitly authorized, controlled, one-order Sandbox validation S3, which was authorized only to validate behavior needed before implementation. That authorization is not approval of the production or user-facing order-write path.
  - The user-facing ERP order submission path stays disabled until its write-safety gates close (SNK-4, SNK-5, V-11, V-13, and duplicate-prevention validation).
  - A second controlled Sandbox write is NOT authorized now. It may be authorized only after the dedicated origin-id approach is designed, the intended Sankhya configuration contract is clearer, and a specific unresolved write behavior is worth validating — preferably: writing the dedicated origin id, duplicate prevention/retry, and discount/write semantics if still needed. Each such test needs its own owner authorization.
  - The earlier production authentication attempt with Sandbox credentials stays in `sankhya-spike.md` as historical evidence. It was not authorization for production access. No further production authentication or data probe without explicit owner authorization (SNK-3).

#### SEC-1 · Exposed spike credentials
- **Status:** APPROVED 2026-09-18
- **Decision:** the credentials used during the spikes are considered exposed and must be rotated before the implemented Sales Force runtime uses them. No current or replacement credential is stored in the repository. Exposed credentials are never wired into the runnable application. Rotation does not block UI or scaffolding work.

#### DOC-1 · ERP identifiers in documentation
- **Status:** APPROVED 2026-09-18
- **Decision:** technical ERP identifiers and codes (for example `CODPARC`, `CODPROD`, `CODVEND`, `NUNOTA`, TOP, `CODTAB`/`NUTAB`) may remain in spike documentation for reproducibility, provided names, CPF/CNPJ and other legal identifiers and personal employee/customer names are sanitized and no credentials or secrets are present. This refines the identifier-remapping wording of `sankhya-spike.md` §6 rule 2 for documentation (committed fixtures keep the stricter rule).

### 3.9 APPROVED — Owner ruling on interim structural per-item discount (2026-09-28)

#### DISC-1 · Structural per-item discount ahead of R35/R36/R37 (interim, Phase 0)
- **Status:** APPROVED 2026-09-28 (owner ruling, this session) · strictly interim and additive · does not resolve, and is superseded by, R35/R36/R37
- **Decision:** Sales Force implements per-item discount in Phase 0, expressed as a percentage, bounded only by a structural/mathematical validity range of 0% to 99.99%. This range is a data-validity bound, not a commercial ceiling, alçada or discount policy, and must never be presented in the UI, documentation or code as an authorized maximum. There is no discount ceiling, no seller → manager → director routing, and no approval workflow in this phase: no `aguardando_aprovacao`, `aprovado` or `rejeitado` status is created for orders or discounts, and no per-profile limit is invented. The domain/backend stay the sole source of truth for the calculation (P-14); totals and persistence are deterministic. Order-level (global) discount stays out of this decision's scope; only the already-modeled per-item discount is finalized.
- **Relationship to P-10:** P-10 requires discount authority (seller → manager → director) enforced server-side. This entry does not implement or claim to satisfy P-10 — it explicitly defers authority entirely, by owner instruction, rather than approximating it. The feature ships with no ceiling/approval mechanic at all until R35/R36/R37 resolve.
- **Explicitly still open:** R35 (discount authority calculation base), R36 (approval routing, absolute ceiling, substitute approver), R37 (credit exception approver and approval order) — unchanged, UNDECIDED, and still gate full Phase 1 discount authority (§5.2). Resolving them supersedes this entry by adding a real ceiling/approval layer on top of the same per-item mechanism, without expected rework of the money/persistence layer.
- **Scope note:** this is a narrow exception to the Phase 1 gate (`roadmap.md` §4) for one bounded capability, not a reopening of Phase 1 generally.

### 3.10 APPROVED — Owner ruling on Phase 0 scope: mobile UI parity, S7 execution and import pipeline (2026-09-29)

#### MOB-4 · Phase 0 widened to include mobile UI parity (online-only)
- **Status:** APPROVED 2026-09-29 (owner ruling, this session)
- **Decision:** Phase 0 now delivers mobile UI parity with the web slice already in Phase 0 (owner instruction 2026-09-21, `roadmap.md` §1; DISC-1, §3.9): customer list and ficha, catalog, order list and filters, the new-order flow (customer selection, negotiation type, cart, bulk entry, per-item/mass/group discounts per DISC-1, financial summary), and server-side draft persistence (`status: 'draft'` via the same `PUT /orders/{id}` endpoint the web app uses). This is **online-only**: no local persistence, no offline queue, no sync protocol implementation — those stay gated by MOB-5 below. Mobile must reuse `packages/domain` and `packages/contracts` as-is; no duplicated commercial math, pricing, discount or ordering rules on the mobile client (P-04/P-05/P-14). This creates no new commercial rule of its own: it extends Phase 0's existing rules (DISC-1; the 2026-09-21 order-draft instruction) to a second client, nothing more.
- **Explicitly still excluded / unaffected:** ERP order submission (SNK-4/SNK-6, unchanged, still disabled), any Sankhya write, notifications, the customer-approval *workflow* (account-state transitions stay under P-19/CFG rules, unaffected by this entry), and any running sync/offline capability (see MOB-5).
- **Supersedes (in part):** `roadmap.md` §3.2's listing of "Mobile features", "orders" and "discount/credit rules" as Phase 0 exclusions — superseded for the online-only mobile scope above. The original exclusion text is struck through and annotated in `roadmap.md` §3.2, not deleted.

#### MOB-5 · S7 / V-09 spike execution authorized now; `packages/mobile-db` implementation still gated
- **Status:** APPROVED 2026-09-29 (owner ruling, this session)
- **Decision:** the owner authorizes running spike S7 (V-09) now, inside Phase 0, using whatever of emulator, physical device, Expo development build or EAS is technically necessary. **MOB-2 is not weakened**: `packages/mobile-db` gains no real schema, table, migration or dependency until V-09 is closed by a recorded, evidence-based decision here. Required flow: S7 → evidence (`docs/mobile-spike.md`) → decision recorded in this register → `packages/mobile-db` implementation. Every finding must be labeled `VALIDADO EM EMULADOR` or `VALIDADO EM DISPOSITIVO REAL` and must never claim device-level validation that did not happen; anything verifiable only on unavailable physical hardware is recorded as pending QA, not assumed or asserted. Offline behavior and sync (outbox, retry, idempotency, conflicts, incremental sync, reconnect) are Phase 0 scope once V-09 closes; until then they stay unimplemented.
- **Refines:** MOB-2, V-09 (§6: "Needed by" updated from "Phase 1 gate" to reflect this authorization).

#### MOB-6 · S7 / V-09 closed — local encrypted database: `expo-sqlite` (SQLCipher) behind `packages/mobile-db`
- **Status:** RECORDED 2026-09-30 under the owner's S7 mission ("if S7 closes with enough evidence, record the decision") — owner confirmation of the wording requested; MOB-2's encryption requirement is unchanged.
- **Decision:** the offline database is `expo-sqlite` 57.0.x built with `useSQLCipher: true` (SQLCipher 4.7.0 community, SQLite 3.49.1), with Drizzle via `drizzle-orm/expo-sqlite` for typed access. The library is confined to `packages/mobile-db` (`./expo` entry); the rest of the app sees `SqlDatabase`. Key: 256-bit CSPRNG from `expo-crypto`, stored only in `expo-secure-store` (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`), applied as a raw key; a build without SQLCipher fails loudly (no downgrade). Migrations: forward-only via `PRAGMA user_version` in the same transaction; downgrade refused; "drop and recreate" is not an update mechanism. Candidate B (`op-sqlite`) was not needed and not prototyped.
- **Evidence:** `docs/mobile-spike.md` §8 — VALIDADO EM DISPOSITIVO REAL (Samsung SM-M556B, Android 16, local dev build): SQLCipher present, schema v1 applied, persistence across force-stop/relaunch (also with airplane mode on), commit/rollback, Drizzle over the keyed connection, v1→v2 migration preserving data, on-disk encryption (no plaintext header; no-key and wrong-key rejected), 20k-row indicative performance. 18 Node tests for `packages/mobile-db`.
- **Known constraint:** FTS5 virtual tables abort the process natively (SIGABRT) on this build, also on an unkeyed database — FTS5 is NOT usable; product search uses indexed normalized columns/LIKE (17–27 ms on 20k rows). Not root-caused; re-probe with `EXPO_PUBLIC_S7_FTS_PROBE=1` after `expo-sqlite` upgrades.
- **Still open:** V-14 (real volume, entry-level device), 16 KB page size on a release build (this device is 4 KB), iOS, R45 (lost-key policy: code throws `KeyMissingError` and never mints a new key over an existing DB), R10/R11 (outbox vs schema migrations). Offline sync/outbox/idempotency/conflicts are designed in §8 but not implemented.
- **Refines:** MOB-2, MOB-5, V-09.

#### IMP-1 · Import pipeline (CSV/TXT/XLSX/XLSM/PDF textual) pulled into Phase 0
- **Status:** APPROVED 2026-09-29 (owner ruling, this session)
- **Decision:** order import from files is pulled forward into Phase 0, for both web and mobile, sharing one intermediate model and one set of parsing/normalization/validation rules — no duplicated logic between clients. Formats: CSV, TXT, XLSX, XLSM, PDF (textual/text-layer only). RF-IMP-1 (`project-spec.md`) already specs XLSX/CSV up to 20 MB / 50,000 rows; this decision extends that scope to TXT, XLSM and PDF textual, and to mobile, keeping RF-IMP-1's limits as the floor for every format pending a spec update. **XLSM is read-only cell-data extraction — macros/VBA are never executed**, consistent with the project's dependency/script-execution posture (`.claude/rules/security.md` "Never"). **Scanned/OCR PDF import is explicitly deferred** until a validated OCR solution exists; it is not part of this decision. Pipeline shape, shared by web and mobile: file → parser → normalization → product resolution → validation → preview → user correction → cart/draft.
- **Explicitly still open:** exact validation ceilings for TXT/XLSM/PDF (size, rows/pages), and product-resolution matching rules (fuzzy-match tolerance, ambiguous-match handling) — implementation-detail questions to resolve while building the pipeline, not blockers to starting it. A genuinely new commercial rule surfacing during that work (e.g. how to treat an unresolvable product) still stops and asks the owner (CLAUDE.md §4).
- **Supersedes (in part):** `roadmap.md` §3.2's listing of "imports" as a Phase 0 exclusion — superseded for this scope; struck through and annotated in `roadmap.md` §3.2, not deleted.

#### DOD-1 · Definition of Done for commercial features (Phase 0 onward)
- **Status:** APPROVED 2026-09-29 (owner ruling, this session)
- **Decision:** from this point on, a commercial feature (order/cart/discount/pricing-facing) is not COMPLETE on the strength of the web implementation alone. Definition of Done: domain = PASS, backend = PASS, contracts = PASS, web = PASS, mobile = PASS, offline = PASS when applicable, sync = PASS when applicable, tests = PASS, QA = PASS. A PARTIAL state may exist mid-development, but a feature is not reported or recorded as COMPLETE while a relevant Web/Mobile gap remains. "When applicable" for offline/sync defers to MOB-5: a feature otherwise complete on web+mobile+backend is not held open by offline/sync only because V-09 has not closed yet — that dimension is marked "pending S7" rather than blocking the rest, and the feature record says so explicitly rather than silently marking COMPLETE.
- **Applies to:** DISC-1 discount work going forward — per-item, mass and group discount are not COMPLETE until mobile ships them at parity with web, per MOB-4.

#### MOB-4a · Mobile "group discount" means catalog-group bucketing, same as web (2026-09-29)
- **Status:** APPROVED 2026-09-29 (owner ruling, this session)
- **Context:** mobile Slice 2 (apps/mobile) shipped a manual multi-select "apply one percent to the selected lines" as its first cut of "group discount," flagged by code review as behaviorally different from web's `GroupDiscountDialog` (`apps/web/src/components/discount-dialogs.tsx`), which automatically buckets cart lines by product catalog group (`groupCode`/`groupName`) and lets the user set a different percentage per group in one action.
- **Decision:** mobile's "group discount" must implement the same catalog-group bucketing as web — automatic grouping by product `groupCode`/`groupName`, one percentage per group, not a manual ad-hoc line selection. The manual multi-select UI shipped in Slice 2 does not satisfy DOD-1/MOB-4 group-discount parity and is superseded by this entry; it may be kept only if repurposed as a distinct, separately-labeled capability (not presented as "group discount"), at the implementer's discretion, since nothing here forbids an additional manual-selection convenience.
- **Refines:** MOB-4, DOD-1 (§3.10). Group-discount parity for DISC-1/MOB-4 remains PARTIAL until this is implemented and reviewed.

### 3.11 APPROVED — Owner rulings on staging authentication, verifier topology, staging infrastructure and Android identity (2026-10-02)

Recorded from the project owner's explicit approval of 2026-10-02. Only structure and configuration are authorized for the verifier; the real Sankhya adapter stays `BLOCKED_EXTERNAL_SECRET`. Nothing here approves production credentials, DNS changes, deploys or production data.

#### AUTH-5 · `AUTH_MODE=local` for admin and technical profiles only; readiness gates
- **Status:** APPROVED 2026-10-02 (owner ruling)
- **Decision:** `AUTH_MODE=local` is production-valid and is used in staging while operational Sankhya authentication is blocked. It authenticates **only** the `admin` and `technical` (ROLE-1) profiles with local Argon2id. There is never local login for operational sellers (nor managers); no demo bypass, no `ALLOW_DEV_AUTH`. Operational production still depends on real external authentication (STACK-2a).
- **Readiness gates:** `AUTH_READY_FOR_STAGING_ADMIN = YES` once local admin/technical login is validated. `AUTH_READY_FOR_STAGING_OPERATIONAL = NO` until a real `ExternalIdentityVerifier` is wired. Operational seller: no demo, no `AUTH_MODE=local`.
- **Refines:** AUTH-1, P-11; formalizes the implementation note in `security-model.md` §3.0.

#### STACK-2a · STACK-2 amendment — dedicated internal verifier (option C)
- **Status:** APPROVED 2026-10-02 (owner ruling) · amends the security rule of STACK-2
- **Decision:** operational login flow is Web/Mobile → Force API → **internal verifier** → Sankhya. The verifier is a dedicated internal component. The API does not hold the Sankhya integration credentials used by the verifier; the worker never receives user passwords for authentication. Verifier requirements: internal network only, never public; user password only in memory, never persisted or logged; timeout; throttle; fail closed; minimal response (identity result only); no Sankhya token delivered to the API or any client.
- **Scope now:** structure and configuration only. The real Sankhya adapter stays `BLOCKED_EXTERNAL_SECRET`.
- **Amends STACK-2:** "Sankhya credentials exist only in the worker runtime unless a later explicitly approved use case requires API-side access" now reads: Sankhya credentials exist only in the worker runtime and, for authentication only, the verifier runtime; never in the API, web or mobile. The two-entry-point topology of STACK-2 is otherwise unchanged; the verifier is an additional internal runtime with its own credentials. STACK-2's rationale (secrets unavailable to the API) is preserved. P-03 and SNK-1 unchanged (clients never call Sankhya; no API-side Sankhya access is created).

#### ROLE-1 · `technical` profile, separate from `admin`
- **Status:** APPROVED 2026-10-02 (owner ruling)
- **Decision:** new profile/role `technical`, not equivalent to `admin`. It may access health, diagnostics, integration status, sync status and permitted technical configuration. It does **not** automatically get global portfolio scope, commercial changes, discount authority, impersonation or full administration. The role set becomes `admin | manager | seller | technical`. Data scope remains per resource permission under the central policy module (AUTH-4 PROPOSED); P-20/P-21 unchanged.

#### AUDIT-1 · Login audit failure policy (successful privileged vs invalid login)
- **Status:** APPROVED 2026-10-02 (owner ruling)
- **Decision:** (a) **Successful local admin/technical login:** the audit record is mandatory; if it cannot be recorded, **no privileged session is created** (fail closed). (b) **Invalid login:** an audit failure must not change the response into something enumerable, break the throttle, break lockout, reveal account existence or remove time padding; throttle and lockout work independently of audit persistence. The two paths differ deliberately.
- **Supersedes** the earlier "failure-path audit writes are best effort" note in `security-model.md` §3.1 only for successful privileged logins; the best-effort rule stays for refused logins.

#### ENV-1 · Staging domain, access, database, backup and SSH
- **Status:** APPROVED 2026-10-02 (owner ruling) · real backup location pending infrastructure · refines OPS-1, OPS-2, OPS-3 (PROPOSED), P-15
- **Domains:** staging `force-staging.sistemasplac.com.br`; future production `force.sistemasplac.com.br`. No DNS changes by the implementation mission.
- **Access:** staging is reached over real HTTPS; it must not depend on IP allow-list, VPN, LAN, Metro, ADB, `adb reverse` or cleartext traffic; protection is authentication and authorization.
- **Database:** staging PostgreSQL is initially isolated on the VPS with separate roles `force_api`, `force_worker`, `force_migrator` (least privilege; no shared superuser credential). Same PostgreSQL major as everywhere (DATA-1). Self-hosting staging does not change OPS-1's managed-PostgreSQL direction for production.
- **Backup (staging):** RPO 24 h accepted for staging only (OPS-2 production targets unchanged; production policy later); backup immediately before relevant migrations; daily dump with hash, retention and periodic restore-check; copy to a second failure domain outside the VPS through an S3-compatible (or equivalent) storage interface. The real location is pending infrastructure; no fictional bucket is documented. A backup counts only after a tested restore (OPS-2).
- **SSH:** dedicated deploy/ops user, key authentication, no private key in the repository, no password flow, no root for routine deploy, least privilege.

#### MOB-7 · Android staging identity and signing (staging id amended 2026-10-28 by SB-2, §3.13)
- **Status:** APPROVED 2026-10-02 (owner ruling) · production signing key is a separate, later decision
- **Decision:** staging application id `br.com.plac.salesforce.staging`; future production `br.com.plac.salesforce` or a definitive id documented before launch. The staging profile is HTTPS only against the force-staging URL, with a standalone bundle: no Metro, dev-client, cleartext, LAN IP or debug signing key. Staging has its own signing; `debug.keystore` is never used; keystores, passwords and EAS credentials are never committed; EAS-managed credentials for staging are allowed if documented. Refines MOB-1, SEC-1, P-22.

#### Status notes (no new rule)
- **R35/R36** remain PENDING_BUSINESS_DECISION (UNDECIDED); not blocking staging infrastructure. DISC-1 unchanged.
- **Photos:** the photos infrastructure remains valid; the real source stays `BLOCKED_EXTERNAL_SECRET`; no fixture or fake may declare `PHOTOS_READY`.

### 3.12 APPROVED — Owner ruling on product photo thumbnails (2026-10-06)

Recorded from the project owner's instruction of 2026-10-06 (details and runbook: `docs/implementation/product-media.md`; Sankhya photo facts: `docs/sankhya-spike.md`).

#### MEDIA-1 · Product photo thumbnails generated with Sharp
- **Status:** APPROVED 2026-10-06
- **Decision:** the worker generates a real thumbnail for every stored product photo with `sharp` pinned to the exact version `0.35.5` (`apps/server` only; prebuilt binaries, lifecycle/build scripts stay disabled). Rendition: longest side 256 px, `fit: inside`, **no upscaling**, EXIF orientation applied then **all metadata removed**, **WebP quality 80**, output limit 256 KiB (larger output is refused, never served as a fallback). Original and thumbnail are separate objects; web list and mobile use the thumbnail and never fall back to the full image.
- **Consequence:** changing the library version, size, format, quality or output limit is a new decision. The staging branding icons are accepted as they are (`icon-512.png` is an upscale of a 173 px source: visual debt in `docs/implementation/web-assets.md`, not a blocker).
- **Not decided here:** the interim filesystem volume store for photos (STACK-7 still requires managed S3-compatible storage) remains pending owner acceptance, as stated in `docs/implementation/product-media.md`.

---

### 3.13 APPROVED — Owner rulings on non-dev auth mode, staging compose, mobile identity, discount authority and seller login (2026-10-28)

Recorded from the owner's explicit answers of 2026-10-28 to the decisions table in `.claude/work/CURRENT.md`. Nothing here authorizes deploys, production data, flag changes in staging or Sankhya writes. Items marked "plan first" have no code yet.

#### PB-1 · Non-dev authentication mode
- **Status:** APPROVED 2026-10-28 (owner ruling: option a) · refines AUTH-5 · implementation: plan in slices first
- **Decision:** create a non-dev `AUTH_MODE` with the Sankhya verifier (STACK-2a) for operational users and local Argon2id for `admin`/`technical` only. The temporary hybrid is not the target; no demo bypass.

#### SB-1 · Staging compose is a versioned artifact
- **Status:** APPROVED 2026-10-28 (owner ruling: option a)
- **Decision:** `deploy/docker-compose.staging.yml` and `deploy/staging/*.example` are the official staging base, versioned in Git. The real `compose.env` and every secret file live only on the host and are never committed.

#### SB-2 · Android application id and EAS staging profile (amends MOB-7)
- **Status:** APPROVED 2026-10-28 (owner ruling: option a) · **amends the staging id of MOB-7**
- **Decision:** production application id `br.com.plac.force`; the `staging` EAS profile uses the production id plus the suffix `.staging` → `br.com.plac.force.staging` (replaces `br.com.plac.salesforce.staging`). The development id `br.com.plac.salesforce.dev` is unchanged. The rest of MOB-7 stands (HTTPS only, standalone bundle, own signing, no debug keystore, no committed credentials). Changing a published id later means a new app: the production id is now fixed before launch.

#### STACK-2b · STACK-2a addendum — verifier adapter live, egress accepted for the Sandbox only
- **Status:** APPROVED 2026-10-28 (owner ruling: option b) · amends STACK-2a
- **Decision (owner text):** (1) The verifier's real adapter has operated since 07/10 against the Sandbox (placfestas-teste.sankhyacloud.com.br); the `BLOCKED_EXTERNAL_SECRET` state of STACK-2a is superseded. (2) The verifier's network egress (`verifier_egress`) is open and that is accepted only for the Sandbox. Before pointing the verifier at any other environment, production included, the egress must be restricted by proxy or firewall to an explicit list of Sankhya hosts, verified at deploy. (3) The remaining STACK-2a requirements stand.

#### DISC-2 · Discount authority base and routing (resolves part of R35/R36)
- **Status:** APPROVED 2026-10-28 (owner ruling: option a) · implementation: plan in slices first · refines P-10, DISC-1
- **Decision:** the discount authority base is the customer's price table; routing is seller → manager → director, configured in Sales Force and enforced server-side (P-10, P-21).
- **Still open:** absolute ceiling, substitute approver (R36 remainder) and R37. DISC-1 stays interim until those close.

#### AUTH-6 · Operational sellers must authenticate against Sankhya
- **Status:** APPROVED 2026-10-28 (owner ruling: SIM) · implementation: plan in slices first · extends AUTH-5
- **Decision:** a seller never signs in with a local password. When Sankhya (the verifier) is unavailable: an existing session keeps working until it expires or is revoked; a new login is refused (fail closed, no local fallback).
- **Addendum 2026-10-28 (owner):** a stale directory mirror (beyond `EXTERNAL_DIRECTORY_MAX_AGE_MINUTES`) or a failing sync never revokes a `sankhya_auto` link nor drops a session. Revocation happens only on a successful directory read showing the user without CODVEND or blocked. The TSIUSU blocking field is not yet validated: the hook is prepared and tested with a stub until the owner brings the field from DBExplorer. Slice order: AUTH-6 → PB-1 → DISC-2 (DISC-2 only base + routing; R36 ceiling and R37 stay open); security-reviewer at the end of each slice.

#### AUTH-7 · `external_user_id` fill tool (PRE_LINKED)
- **Status:** APPROVED in direction 2026-10-28 (owner ruling: option b) · **waits for the idusu ↔ CODUSU proof**
- **Decision:** the way to link sellers is `VERIFIED_AUTO_PROVISION` from the `erp_directory_user` mirror, enabled only after the proofs (`EXTERNAL_IDUSU_IS_CODUSU_VALIDATED`, mirror health, cause of the GUSTAVO refusal). No manual-link tool is built now.

#### AUTH-8 · Login field is `username` only, no e-mail window
- **Status:** APPROVED 2026-10-28 (owner ruling: option b) · already the implemented state
- **Decision:** `POST /auth/login` accepts only `{ username, password }` (`strictObject`); `{ email }` bodies get 400 and there is no compatibility window. Refines P-16 for this contract.

### 3.14 APPROVED — Owner rulings D1-D12, closing AUTH-6/PB-1/DISC-2 follow-ups (2026-10-28, second session)

Source: the project owner (Gustavo) in the session of 2026-10-28; recorded here before implementation so no agent stalls on "decision not approved". Items touching secrets, production or the unvalidated TSIUSU blocking field remain stopped.

#### AUTH-9 · Seller never has a local password (seed and CLI) — owner D1
- **Status:** APPROVED 2026-10-28 · extends AUTH-6
- **Decision:** the dev seed creates demo seller accounts with no usable password hash (data only); the account CLI refuses to create or change a password for role `seller`. In dev and tests a seller session is opened by the direct-session fixture (AUTH-6 option c). No fake verifier: AUTH-5 ("no demo bypass") stands.

#### AUTH-10 · `user_blocked` applies to every `sankhya_auto` link — owner D2
- **Status:** APPROVED 2026-10-28 · refines AUTH-6 addendum
- **Decision:** the blocked check (hook still stubbed until the TSIUSU field is validated) applies to every `sankhya_auto` link regardless of `EXTERNAL_AUTO_PROVISION` (the flag governs creation, not revocation). Manual links are never touched. Revocation only on a fresh successful read.

#### AUTH-11 · Database error while re-evaluating a link is not a refusal — owner D3
- **Status:** APPROVED 2026-10-28 · refines AUTH-6
- **Decision:** the session continues until it expires; log/audit without PII with reason `link_reevaluation_error` and a metric. A NEW login hitting a database error stays refused (fail closed).

#### AUTH-12 · Usernames that match a local seller always go to the verifier — owner D4
- **Status:** APPROVED 2026-10-28
- **Decision:** Sankhya is the source of truth: such a name is always forwarded to the verifier; the local seller hash is never used; invalid credentials answer a uniform 401 that does not reveal whether an account exists.

#### MOB-6a · MOB-6 wording approved as written — owner D5
- **Status:** APPROVED 2026-10-28

#### CFG-7 · Seller reads a safe configuration subset — owner D6
- **Status:** APPROVED 2026-10-28
- **Decision:** `GET /configuration` for a seller is served as an endpoint or filter returning only the subset "Novo pedido" needs; no secret, cost or margin (a test guarantees it); no 403 on that path.

#### SEC-2 · CSP with `react-remove-scroll-bar` — owner D7
- **Status:** APPROVED 2026-10-28
- **Decision:** `script-src` stays strict. If the web is served by something that injects a per-response nonce, use it (get-nonce/setNonce); otherwise allow `'unsafe-inline'` ONLY in `style-src`, recording why. No other relaxation.

#### DISC-3 · Discount ceilings (R36) — owner D8
- **Status:** APPROVED 2026-10-28 (defaults provisional, "adjust by the owner")
- **Decision:** limits are configuration editable by the admin in the administration screen, per level: seller alone up to X%, manager up to Y%, above that director. Provisional defaults X=5, Y=15. If the `director` role does not exist, admin approves the director level for now, with a note.

#### DISC-4 · Substitute approver (R37) — owner D9
- **Status:** APPROVED 2026-10-28
- **Decision:** any user holding the level's role approves (pool), not a named manager; no automatic time escalation in v1; the audit records who approved.

#### SNK-7 · Order submission to Sankhya, Sandbox only — owner D10
- **Status:** APPROVED 2026-10-28 · narrows SNK-4/SNK-3 for the Sandbox; production stays forbidden
- **Decision:** authorized ONLY against the Sandbox (`placfestas-teste.sankhyacloud.com.br` / `api.sandbox.sankhya.com.br`), behind a flag off by default (`SANKHYA_ORDER_WRITE_ENABLED`), a host allow-list refusing any other host, per-order idempotency, a documented dry-run before the first write, and a slice plan before coding. Never enabled in staging by an agent; the command goes to "Só o dono roda".

#### SNK-8 · ERP commercial history (phase B), Sandbox read only — owner D11
- **Status:** APPROVED 2026-10-28 · read only, Sandbox only, same allow-list

#### TEST-1 · E2E migration — owner D12
- **Status:** APPROVED 2026-10-28
- **Decision:** migrate commit `2a836a0` into the evolution worktree, replacing the seller password login by the session fixture through the test API. Afterwards `C:\Dev\sales-force` is retired.


### 3.15 APPROVED — Owner answers Q1-Q13 and rulings D13-D20 (2026-10-29)

Source: the project owner (Gustavo), session of 2026-10-29; recorded before implementation. D1-D12 (§3.14) were re-confirmed line by line against the owner's original text on 2026-10-29: no divergence found. Nothing here authorizes deploys, staging flag changes, production or Sankhya writes.

#### Q1-Q13 · Answers to the open questions
- **Q1 (AUTH-MODE-HYBRID):** `AUTH_MODE=local` + `EXTERNAL_LOGIN_ENABLED=1` is not refused at boot; the API logs a "transition mode" warning. This is the current staging state.
- **Q2:** in `external` mode `WEB_AUTH_MODE=standard`, as documented; the login screen asks for the Sankhya username, not an e-mail.
- **Q3:** pre-existing local seller sessions are revoked once, when staging switches to `external`; the command is in `.claude/work/CURRENT.md` ("Só o dono roda"); agents do not run it.
- **Q4:** the owner switches staging to `external` after the suite is green and the new SHA is deployed. Precondition: an active local admin account exists in staging as emergency access.
- **Q5 (= AUTH-11/D3):** a session is kept when the link re-check fails with a database error.
- **Q6 (DISC-3 note):** in v1 the admin approves the director level, labelled "Diretoria" in the UI. No new role; `technical` stays blocked from approvals.
- **Q7:** limits are inclusive (`<=`): a discount equal to a level's limit is within that level.
- **Q8:** per-user limits (RF-CAT-3) are NOT built now — post-pilot backlog; the configuration shape must accept a per-user override later without a migration.
- **Q9:** always three limits (seller, manager, director). The director's limit is the absolute ceiling; above it nobody approves and the order stays `blocked`.
- **Q10:** the base is the item's effective price in the order, from the customer's table or the fallback table (CFG-4/5); the order records which table was used.
- **Q11:** the PLAC values are brought by the owner. Until then provisional 5 / 15 / 30 (seller / manager / director), marked "ajustar pelo dono" in configuration and in the admin screen.
- **Q12:** a blocked draft stays saved and marked `blocked`; only submission is refused. At submission the authority is recomputed from the stored lines.
- **Q13:** ceiling = the director's limit.

#### AUTH-13 · Blocked-field recheck covers every external login — owner D13
- **Status:** APPROVED 2026-10-29 · refines AUTH-10
- **Decision:** once the TSIUSU blocking field exists, `user_blocked` drops the session of any external login, automatic or manual (`PRE_LINKED`). What is never touched in a manual link is the link record itself. Until the field arrives the hook stays prepared for both modes.

#### AUTH-14 · `AUTH_CONFIG` is mandatory — owner D14
- **Status:** APPROVED 2026-10-29
- **Decision:** the authentication module requires `AUTH_CONFIG`; if absent the server does not start (closes the reviewer finding on the `@Optional` in `AccountService`). A test covers it.

#### OPS-7 · Directory mirror age — owner D15
- **Status:** APPROVED 2026-10-29
- **Decision:** a warning log and a metric when the mirror is older than `EXTERNAL_DIRECTORY_MAX_AGE_MINUTES`. No external alert in v1.

#### DISC-5 · Draft edited by a manager — owner D16
- **Status:** APPROVED 2026-10-29
- **Decision:** the discount status is computed with the role of the draft's owner (seller), never of who saved it. Approval happens only by an explicit approve action, audited with who approved (DISC-4).

#### ORD-1 · Order editing rule (R07) — owner D17
- **Status:** APPROVED 2026-10-29
- **Decision:** an order is editable only as draft and rejected-by-approver; editing an order awaiting approval returns it to draft and invalidates the pending approval; approve and reject are online only.

#### DISC-6 · Approval in v1 — owner D18
- **Status:** APPROVED 2026-10-29
- **Decision:** no push. The approver sees the queue (W-20, web); the seller sees the state on the order (web) and in the app (M-14). A comment is mandatory on rejection, optional on approval. Nothing more.

#### ORD-2 · Order states — owner D19
- **Status:** APPROVED 2026-10-29
- **Decision:** order states follow SM-2 of the blueprint, keeping the contract's current names (`draft`, `queued`, `sent`, `rejected`, `cancelled`) and adding the approval states. `rejected` stays the ERP-submission rejection; a discount reprovação is its own state and never reuses it. `revisao_preco` is out for now.

#### MOB-8 · Offline mobile is not rebuilt this cycle — owner D20
- **Status:** APPROVED 2026-10-29
- **Decision:** local draft, outbox and sync already exist and were validated on device (`docs/mobile-spike.md` §8.8, `.claude/work/MOBILE_PARITY.md`). This cycle only the approval flow (M-14) enters the mobile app; the §8.8 finishing touches wait for the next session.

#### AUTH-15 · Known accepted risk — user enumeration during verifier outage
- **Status:** APPROVED 2026-10-29 (risk accepted for v1)
- **Decision:** during a verifier outage the distinct 503 can reveal that a login was forwarded to the verifier; accepted in v1 and recorded as a known risk.
### 3.16 APPROVED — Owner rulings D-A..D-M, SNK-7 D-1..D-10 and P2-P5 (2026-10-30)

Source: the project owner (Gustavo), prompt of 2026-10-30 part 1 (`.claude/work/PROMPT_2026-10-30_parte1.md`), after the Vidya Force audit and gap analysis (`.claude/work/auditoria-vidya-force.md`, `.claude/work/VIDYA_GAP_ANALYSIS_2026-10-29.md`). Recorded before implementation. Where a ruling below conflicts with §3.13-§3.15 for the pilot, this section prevails. Nothing here authorizes a Sankhya write, a flag change in staging or a deploy.

#### Pilot scope rulings D-A..D-L
- **D-A (TOPs for the seller):** 1001 and 1000. `sales.eligibleOrderTopCodes` lists them; `sales.orderTopCode` is the default (1001). 1051, 1061 and ZFM stay out until decided.
- **D-B (quotation):** a quotation is an order with TOP 1000, sent to Sankhya as 1000 and not confirmed. "Convert to order" = duplicate as 1001. No new state machine (closes BP-03 for the pilot).
- **D-C (carrier):** optional header field, no default; list = carrier partners (`TGFPAR.TRANSPORTADORA = 'S'`) from the mirror.
- **D-D (estimated IPI in totals):** yes, labelled "estimado" — part 2.
- **D-E (ERP status labels):** the Vidya labels: CONFIRMADO, AGUARDANDO LIBERAÇÃO, FATURADO, NEGADO, CANCELADO, NÃO CONFIRMADO, AGUARDANDO FATURAMENTO, DESCONHECIDO.
- **D-F:** no discount on the order total (R35). **D-G:** alternative units (CX) postponed. **D-H:** per-product discount limit postponed.
- **D-I:** customer financials in the pilot are read-only, no automatic block — part 2.
- **D-J:** order PDF uses an own template (PLAC brand, never cost/margin), not the Sankhya report.
- **D-K:** self-approval rule becomes backlog of the `force` mode.
- **D-L (vocabulary):** user-facing text says "Enviar ao Sankhya" and "Sankhya", not "ERP".

#### D-M · Discount/credit release belongs to Sankhya in the pilot (resolves R26 for the pilot)
- **Decision:** release of discount and credit is done by Sankhya through the TOP events (TSILIB), as with Vidya today. The Force approval flow (DISC-3/4/5/6: limits, W-39, W-20, approval states, M-14) stays OFF by configuration: `sales.discountAuthority.mode = 'erp'` (default). Mode `'force'` keeps existing, with the already reviewed code, for a future installation.
- **In `erp` mode:** no order waits for approval or is blocked by discount in Force; only structural validity (0-99.99 %) and "sem preço" apply; the order goes to the Sankhya queue and its state comes from Sankhya (P2). W-39 and W-20 are hidden and their routes disabled. The recompute of authority runs only in `force` mode. Cart footer text: "Descontos acima do permitido passam pela liberação no Sankhya depois do envio."
- **Consequences:** the immutability trigger (security finding 3) and D-K are `force`-mode backlog; the "real limit values 5/15/30" owner pendency is dropped. SNK-7 D-9 does not exist in `erp` mode.

#### SNK-7 plan rulings D-1..D-10 (`docs/implementation/snk-7-order-submission-plan.md` §6)
- **D-1:** one extra marker `SANKHYA_ORDER_WRITE_GATES_CLOSED=1`, read only by the worker; `live` mode without it fails boot; `dry_run` does not need it. `live` also requires `SANKHYA_ORDER_ORIGIN_FIELD` (name of the origin field in TGFCAB, created by the owner in the Sandbox); empty = write refused.
- **D-2:** attempts exhausted on a temporary error → order `rejected` (SM-2 integration error) with class `exhausted`, visible in W-32 for reprocessing, alert on the integration panel. `unknown` is reserved for an ambiguous result (sent without answer).
- **D-3:** keep the 5 outbox values in the database. SM-7 sub-steps (`verificando_origem`, `enviando`, `aguardando_retry`, `vinculado_existente`) go to the log and to an informational `last_step` column (expand-only migration), not to the state machine.
- **D-4:** Force confirms. Flow `incluirNota` → `confirmarNota`, two idempotent steps. `sent` = included and confirmed. Failure only at confirmation = intermediate state "incluído, aguardando confirmação" (outbox `unknown` + NUNOTA stored); reprocess redoes only the confirmation, never the inclusion. Quotation TOP 1000 is NOT confirmed. Native TOP releases (TSILIB) stay in Sankhya; Force only shows the state (P2). `confirmarNota` is part of the D-10 test.
- **D-5:** cancel with outbox `pending` (including retry without ambiguous result): allowed; in the same transaction the outbox goes to `rejected` with class `cancelled_by_user`. With `processing` or `unknown`: refused ("aguarde a conclusão do envio"). After `sent`: no Force-side cancel in v1; the state mirrors Sankhya (P2).
- **D-6:** dry-run record retained 30 days, purged by a job; payload keeps only codes, UUIDs, quantities and values; `OBSERVACAO` replaced by its hash; no token, name, CPF/CNPJ.
- **D-7:** discount by `PERCDESC` on the item, list price computed by Sankhya (`INFORMARPRECO False`). After writing, the worker rereads the item and checks `VLRUNIT` = table price and `PERCDESC` = sent; divergence = validation error, order `rejected`. If test #1 shows Sankhya ignores `PERCDESC` with `INFORMARPRECO False`: fallback `INFORMARPRECO True` with `VLRUNIT` = table price + `PERCDESC`, recorded in the spike.
- **D-8:** nothing literal in code: CODEMP = `general.defaultCompanyCode`; CODTIPOPER = order header TOP; CODTIPVENDA = chosen negotiation type; CODLOCALORIG = `sales.orderStockLocationCode` (PLAC 209, to confirm); CODVOL = product unit in the mirror; CODVEND = linked seller; CODPARC = customer; DTNEG = order date; TIPMOV = P; OBSERVACAO = order note cut at 2000 chars; CODPARCTRANSP = header carrier when given.
- **D-9:** no effect in `erp` mode (D-M).
- **D-10:** authorization for the first Sandbox test is given by the owner in writing ("AUTORIZO") after the dry-run is reviewed. The script is prepared in `docs/implementation/snk-7-dry-run.md` (order A: 1 item, no discount, TOP 1001, cash 11; order B: 1 item with 8 % PERCDESC, TOP 1001, negotiation 2; resend of A must link, not duplicate; cleanup `excluirNotas`, fallback `cancelarNota`; budget ≤ 40 requests). Nothing runs without that written "AUTORIZO".
- **S9 modelling:** column `erp_order_number` (integer, null until sent, immutable afterwards) on orders; in the detail and list DTOs.
- **Texts:** queued = "Na fila para o Sankhya"; included but unconfirmed = "Enviado, aguardando confirmação"; sent = "Enviado ao Sankhya"; rejected = "Falha no envio" (never "Rejeitado" for technical errors); unknown = "Envio em verificação".

#### P2-P5 · ERP order state, carriers, origin field, decimals
- **P2:** pure function `mapErpOrderStatus` in `packages/domain` reproduces EXACTLY the precedence of Vidya's `GETCODSTATUS_VIDYA`, including NEGADO overriding FATURADO when `STATUSNFE <> 'A'` (known behaviour, audit F-03; documented). Codes: 0 CANCELADO, 1 NÃO CONFIRMADO, 2 CONFIRMADO, 3 AGUARDANDO FATURAMENTO, 4 FATURADO, 5 NEGADO, 6 AGUARDANDO LIBERAÇÃO, -1 DESCONHECIDO (7 EM COTAÇÃO, TOP 900 only, unused). Worker job `sync.erp.orderStatus` every 15 min for `sent` orders in a non-final state (≠ 0 and ≠ 4, up to 90 days), reading TGFCAB, TGFCAN, TGFVAR→TGFCAB child and TSILIB through the gateway SQL read path (SNK-8 authorizes Sandbox reads); stores `erp_status_code`, `erp_status_label`, `erp_invoice_number`, `erp_status_checked_at` (expand-only migration).
- **P3:** carrier mirror from `TGFPAR` with `TRANSPORTADORA = 'S'` (52 active in the Sandbox). "Expedição" = `TGFCAB.AD_EXPEDICAO` (VARCHAR2 10, values to confirm) — part 2. The origin field is never `AD_NUVIDYA` nor `AD_VDYORIG` (Vidya's, in use during the pilot); its name comes from `SANKHYA_ORDER_ORIGIN_FIELD`.
- **P4:** `TGFPRO.DECQTD = 4` for products 4158, 1440 and 2804 (four decimal places; unit PT): decimal quantities end to end. PLAC rule: laminated plates/trays sell by box (1.0) and pack (0.2), multiples of 0.2 only; white tray by pack of 10 (quantity = number of packs). Per-product step is later; now only guarantee decimals work.
- **P5:** IPI rate from `TGFPRO.CODIPI` → `TGFIPI` — part 2.

#### Staging facts 2026-10-29 (status note)
- Deploy of `bd6d593` done by `deploy-staging.sh` as force-deploy with `SF_RUN_DB_ROLES=1`; migrations 0012 and 0013 applied; db-roles OK; `DEPLOYED_SHA=bd6d593`. Staging runs `API_AUTH_MODE=external` + `WEB_AUTH_MODE=standard` since 2026-10-29 19:14Z; the owner's seller login worked in external mode.
- First attempt failed at the web health check: nginx `open() /etc/nginx/conf.d/default.conf failed (13: Permission denied)` — the script's checkout left `deploy/nginx/default.conf` at mode 0600 and the web image copies it preserving the mode. Fixed by hand (`chmod 644`) and permanently in this cycle (A2).
- Host layout: `/opt/force-staging/repo`, `/opt/force-staging/config/compose.env`, `/opt/force-staging/config/secrets/*.env`, `/opt/force-staging/logs`; user `force-deploy`; `SF_EDGE_MODE=external`; `SF_DB_MODE=self-hosted`. (Earlier docs cited `/etc/salesforce/staging`: wrong.)

### 3.17 APPROVED — Configuration read from Sankhya: CFG-8, U-10-a..d, U-11 (2026-10-30, part 2)

Source: the project owner (Gustavo), prompt of 2026-10-30 part 2 (`.claude/work/PROMPT_2026-10-30_parte2_config-sankhya.md`). Recorded before implementation. Resolves U-10 and U-11 for the pilot. Nothing here authorizes a Sankhya write, a flag change in staging or a deploy.

#### Facts — VALIDATED (env) 2026-10-30 (source: DBExplorer read by the owner; details in `.claude/work/VIDYA_SANKHYA_CONFIG_MAP_2026-10-30.md` and `docs/sankhya-spike.md` §9.49)
- Vidya has no configuration screen of its own: its whole configuration lives in Sankhya — one row in `AD_TVDYCFGFRC` (370 columns, 88 filled, `NUCFG = 1`), child tables by `NUCFG` (`AD_TVDYFRCSTS` statuses, `AD_TVDYGRUOP`/`AD_TVDYTOPGRU` TOP groups), `AD_MOBILIDADE` flags on the standard registers (`TGFTOP`, `TGFTPV`, `TGFNTA`, `TGFPRO`, `TGFLOC`, `TSIEMP`), `TSIEMP.AD_CODTIPOPERPAD`, and rules in `*_VIDYA` functions/views.
- `TGFTOP` and `TGFTPV` are versioned by `DHALTER`; the current version is `DHALTER = MAX(DHALTER)` per code (what the Vidya views do; `TGFCAB.DHTIPOPER`/`DHTIPVENDA` point to the version used by a document).
- PLAC values today: TOPs with `AD_MOBILIDADE = S`: 1000, 1001, 1009, 1051, 1061, 2209, 2309; 1000 has `AD_PULARCONFIRMACAO = S`. Company 1 enabled with `AD_CODTIPOPERPAD = 1001`, company 2 off. 35 negotiation types with `AD_MOBILIDADE = S` (including returns 23 and 24; `TGFTPV.AD_VENDA` empty everywhere). `AD_TVDYCFGFRC`: `CODLOCALPEDIDOS` 209, `TABPADCSLTPROD` 5, `CODTABALT` 5, `TIPDESC` P, `VALDESCMAX` A (validate and warn, does not block), `USADECQTD` S, `DECVLR` 2, `DIASCONSULTAVENDAS` 90, `QTDDIASPRODCOMPRADOS` 90, `UTILFINANC` S, `ALTTIPNEG` S, `PERMALTPRECOPROD` N, `APLICDESCMSS` S, credit blocks (`BLOQVEND*`) empty. `AD_TVDYFRCSTS`: 8 statuses (codes equal to `GETCODSTATUS_VIDYA`) with name, description, hex colour and `PERMEDIT`/`PERMDUPLIC`/`PERMEXC`.
- `AD_STATUS`/`AD_LIBORD`/`AD_FAROL` are PLAC customization; Force neither writes nor interprets them. TSILIB release events seen: 44, 2, 18, 13 (names of 2 and 13 pending).
- The parameters, dictionary and log exports came from PRODUCTION Sankhya (log with that day's orders); the catalogue came from the Sandbox. The Sandbox may lag production: the sync reports key by key what it read and what was missing, never presumes.
- **Security finding:** `AD_TVDYLOGPED.BASICAUTH` stores Base64 credentials. `AD_TVDYCFGFRC` has credential columns (`BASICAUTH`, `CLIENTSECRET*`, `KEY*`, `CERT*`). Force never selects them and never persists Authorization/token/password/X-Token in the outbox, dry-run record, log or configuration snapshot (explicit test).

#### Rulings
- **U-10-a PONTE:** during the pilot Force reads the same tables and flags Vidya uses. Nothing is re-registered; PLAC keeps configuring in the Sankhya screens it already uses.
- **U-10-b:** own `AD_PLACFORCE*` tables in Sankhya are DEFERRED. What is Force-only stays in the base file (ex-bootstrap). The proposed model is documented as "next stage" in `docs/implementation/sankhya-configuration-contract.md`, with no executable DDL.
- **U-10-c:** Sankhya enables 7 TOPs, Force offers only the owner's list (D-A: 1000 and 1001). Optional Force-only key `sales.topAllowlist`: present → `eligibleOrderTopCodes` = Sankhya list ∩ allowlist; absent → the whole Sankhya list. An allowlisted TOP not enabled in Sankhya is dropped with a warning in the report.
- **U-10-d:** negotiation types = current `TGFTPV` with `AD_MOBILIDADE = S` minus optional Force-only `sales.negotiationTypeExclusions` (pilot: 23 and 24, returns). "Return" is never inferred from the description.
- **U-11 (resolved for the pilot):** source before an own model = base file (the current config-bootstrap) + Sankhya overlay. The file stops being "the configuration" and becomes "defaults + Force-only keys".
- **CFG-8 (precedence and security):** a PONTE key successfully read from Sankhya overrides the base file; a failed/partial/invalid read = no new version, the current version stays, failure recorded in `sync_state` (entity `configuration`) and an alert on the integration panel; a sync never regresses to "not configured". Secrets never enter the snapshot. Force never writes configuration to Sankhya (P-02/P-03). Job off by default (`CONFIG_SYNC_FROM_SANKHYA=0`).


**Status note 2026-11-03 (owner).** (a) Staging runs Part 1 (`df923a8`, migrations 0014–0017); `CONFIG_SYNC_FROM_SANKHYA` is still absent from `compose.env` (= off). (b) `customers.creditFeatures.showCreditLimit` stays with the base file; the `OCLTLIMCRED` value read from Sankhya is informational only (sync report), until the owner confirms Sankhya owns it (closes reviewer finding M2 for now). (c) Release events: only 44 ("liberação exigida pela TOP") and 18 ("confirmação de nota") are named; 2 and 13 show as "evento 2"/"evento 13" until the owner names them (`erp.liberationEventLabels` in the base file). (d) Reviewer finding M1 (overlay widening the order scope) is resolved by the base file: `sales.topAllowlist`, `negotiationTypeExclusions` and the eligible TOPs are set there.

### 3.18 APPROVED — Owner rulings D-D, D-I, D-O, D-P, D-Q, D-R (2026-11-03, part 2b)

- **D-D (estimated IPI):** the order totals show an estimated IPI, labelled "estimado". It is display only: never part of the validation, the price, the discount authority or the Sankhya payload. Rates come from the `TGFIPI` mirror (`TGFPRO.CODIPI`); validated rates: CODIPI 5 = 3.25, 6 = 9.75 (`sankhya-spike.md` §9.50).
- **D-I (financial, read-only):** the customer record shows open titles, overdue titles and credit limits from the ERP mirror (`TGFFIN`, `TGFPAR`). No automatic block: Sales Force does not decide credit from it. The credit limit is visible per `customers.creditFeatures.showCreditLimit`. Mobile financial summary is not part of this batch.
- **D-O (expedição):** no field on any seller screen. An order is born with expedição NOT marked and is sent as `AD_EXPEDICAO='N'`. The value comes from `sales.expedicaoDefault` (pilot "N"), is stored on the order, and is shown only in the order detail for admin/technical (read-only) and in the dry-run record.
- **D-P (release reason):** the release reason (TSILIB event codes, with the optional `erp.liberationEventLabels` names) is visible to the seller and the manager in the order detail; an external representative sees it like a seller. Detail only; the list item stays small.
- **D-Q (error text masking):** text stored in `sync_state.last_error_message`, `integration_outbox.last_error_message` and dry-run records is masked before it is written: no Authorization header, token, password, secret, URL with credentials or Sankhya host; only class, code and a short text remain. Implemented in `observability/mask-error-message.ts`; the worker registers the hosts and literal credentials at start.
- **D-R:** showing the Sankhya status on mobile is part 3 (needs `erpStatus` in the sync protocol).

### 3.19 APPROVED — Owner rulings D-S..D-W, deployment-environment gate (2026-11-04, part 2c)

- **J1 (gate):** the ERP order switches are gated by `SF_DEPLOY_ENVIRONMENT=staging|production` (required at boot under `NODE_ENV=production`), not by `NODE_ENV`. `ERP_ORDER_ENQUEUE_ENABLED=true` and the worker's order write are accepted only with `staging`; in the worker the condition is added to the Sandbox gates. Amends the SNK-6 wording "refused when NODE_ENV=production".
- **D-S (catalogue):** `products.mobilityFilter` mode `enforced`, validation `validated`; `products.productWithoutPrice.visible=false` (orderable already false). Products outside the mobility flag, or without a price in the customer's resolved table, leave the catalogue; a saved order that already holds one still opens (the product just cannot be added again). Without a customer, the reference table is used. The products sync report counts those left out by mobility.
- **D-T (vocabulary):** the word "rascunho" leaves the seller screens. Labels follow the header TOP: TOP in `sales.quoteTopCodes` = "orçamento" (Salvar orçamento, Enviar orçamento ao Sankhya, "Orçamento nº N"); any other TOP = "pedido" (Salvar pedido, Enviar ao Sankhya, "Pedido nº N"). "Salvo, não enviado" becomes the badge "não enviado". The two cart footer texts are removed; only "IPI estimado" and "Total estimado (com IPI)" remain. Applies to web, mobile and PDF.
- **D-U (convert quote):** "Converter em pedido" on a quote, web and mobile, seller and manager. (a) Not yet sent: converted in place (TOP becomes `sales.orderTopCode`, same record). (b) Already sent (has NUNOTA): native conversion through the `convert_quote` outbox action (same states, idempotency and SNK-7 gates); the worker first reads TGFVAR for a child and only links if one exists (never converts twice); the call is the billing service (`SelecaoDocumentoSP.faturar`, NEEDS VALIDATION, never called by the agent; dry_run records the request; live only with the owner's AUTORIZO as test #3). The worker then re-reads TGFVAR → new NUNOTA, reads TGFCAB/TGFITE and creates a linked order in Force ("Pedido nº M (do orçamento nº N)"); the quote shows "Convertido em pedido nº M". Item-by-item divergence (quantity, unit price, discount) is flagged on both. (c) `mapErpOrderStatus`: a document whose TOP is in `sales.quoteTopCodes` and has a TGFVAR child shows "CONVERTIDO EM PEDIDO" — a conscious deviation from GETCODSTATUS_VIDYA for quotes.
- **D-W (PDF):** one template for web and mobile, A4 portrait, 15 mm margins, 10.5 pt, brand colours, company block from the new base-file key `brand.company` (absent = block omitted), never cost, margin, credit limit or financial data (P-20). Fixes the clipped left margin.
- **D-V (Sankhya is the only source; prevails over J2/J3 and over D-A/U-10-c/U-10-d where they conflict):** no fixed code lists in the base file. (1) `sales.topAllowlist` leaves the base file: absent = every TOP with `AD_MOBILIDADE='S'`, `TIPMOV='P'`, current version; the selector lists them with the Sankhya `DESCROPER`; quote TOPs = group "ORÇAMENTO" (`AD_TVDYGRUOP`/`AD_TVDYTOPGRU`, `sales.quoteTopCodes`); all others are orders; default = `TSIEMP.AD_CODTIPOPERPAD`. (2) `sales.negotiationTypeExclusions` leaves the base file: list = current TGFTPV with `AD_MOBILIDADE='S'` and `ATIVO='S'` (returns 23/24 appear until the owner disables Mobilidade on them in Sankhya). (3) Products: `AD_MOBILIDADE='S'` and a price in the resolved table. (4) Customers: `customers.eligibility` in the base file (`activeOnly`, `requiredFlags ["CLIENTE"]`, `columnIn [{column "CLASSIFICMS", values ["R"]}]` — `R` is an initial hypothesis to confirm in the Sandbox), applied by the gateway with columns discovered through `USER_TAB_COLUMNS`; missing column = fail closed naming it; a customer leaving the rule becomes inactive in the mirror, saved orders keep it. (5) Carriers: `TRANSPORTADORA='S'` and `ATIVO='S'`. Each sync report states how many were left out per criterion.

### 3.20 APPROVED — Owner rulings D-X and D-Y (2026-11-04, part 2d)

- **D-X (ERP environment vocabulary; closes the open item "values of `erp_environment`"):** `SF_ERP_ENVIRONMENT` uses the Sankhya vocabulary `sandbox` | `production`; staging is `sandbox`. The worker target stays `sandbox` (hardcoded, `apps/server/src/main-worker.ts`); the API stamps `erp_environment` from `SF_ERP_ENVIRONMENT`; `erpSubmissionBlock` (`packages/domain/src/erp-eligibility.ts`) compares both before any delivery. The deploy aborts when `SF_ERP_ENVIRONMENT` and `SANKHYA_ENVIRONMENT` differ (K2). A rejected order shows why the last delivery failed (class + code), and a 409 on submit shows one text per reason (K3, K4).
- **D-Y (no discarded state; supersedes the cancel-a-queued-order behaviour of D-5):** the seller deletes the quote/order. "Excluir" exists only when the document never reached Sankhya: no `erp_number` and no delivery pending, processing or unknown (status draft, awaiting approval, approved, approval rejected, or rejected without a created note). Physical deletion of `sales_order`, its items, approval requests and terminal deliveries, with one audit event `order.deleted` (who, when, number, customer, total). `cancelled` leaves the status list, the contract, the web and the dashboard; migration 0024 deletes existing cancelled orders, 0025 drops the status. The web asks "Excluir orçamento nº X? Isso não pode ser desfeito." and returns to the list. The seller deletes their own; manager and admin delete any visible eligible one. `force_api` gets DELETE on `sales_order` and `integration_outbox`. Mobile follows in part 3.
- **D-AA (salvar = enviar; owner ruling 2026-11-05):** the seller confirms and the document goes to Sankhya in the same action. There is no separate "Enviar ao Sankhya" and no seller-visible queue: the word "fila" is gone from every screen, PDF and message. States: `queued` reads "Enviando ao Sankhya…" and, after 2 minutes, "Aguardando envio — será reenviado automaticamente" (`DELIVERY_OVERDUE_MS`, `orderDeliveryLabel`/`orderStatusView`); delivered shows the Sankhya status with the number; a terminal failure shows "Falha no envio" with the reason (K3) and **Reenviar** (`POST /orders/{id}/submit` on a `rejected` order: same checks as a first send, same outbox row and origin id, SNK-4; a `dry_run` row is never resent) and **Excluir** (D-Y). With the write gate off the document stays saved and the screen says "Envio ao Sankhya desligado". The client sequences create/replace + the idempotent submit with one `clientRequestId`. Approval gates: in `erp` mode (default) nothing in Sales Force blocks the send and Sankhya decides (D-M, release reason D-P); the `force` mode (P-10) stays an opt-in configuration and still routes to approval. Quotes: saving sends `incluirNota` without `confirmarNota`; a never-sent quote converts in place (D-U a); for an already-sent quote the interim is "Duplicar como pedido" (a NEW order, order TOP, same lines), and the quote shows "CONVERTIDO EM PEDIDO nº M" in Sales Force only (`convertedInto`). LIMITATION: no TGFVAR link between the two documents in Sankhya; the native faturar (J3 b) remains NEEDS VALIDATION.
- **D-AB (feedback of the action, "Atualizar dados" for real, loading everywhere; owner ruling 2026-11-06):** (B1) vocabulary: "Confirmar pedido"/"Confirmar orçamento", corrected simulation notice. (B2) confirming opens a blocking "Enviando ao Sankhya…" dialog that ends with the outcome (delivered with number / failure with reason and Reenviar / simulated / gate off). (B3) "Atualizar dados" now reads Sankhya on demand without breaking STACK-2: `POST /sync/refresh` (any operational profile; technical profile denied) only records a row in `sync_refresh` (one pending/running at a time, enforced by the partial unique index `sync_refresh_active_uq`; a second click returns the same `refreshId`; 60 s per-installation cooldown returns the last finished request with `reused: true`) and the worker (poller 2 s → pg-boss queue `sync.refresh.on-demand`, singleton per refreshId, retryLimit 0) runs, in order, configuration, sellers, customers, products, price tables, price table versions, list prices, carriers, IPI, open receivables and Sankhya order status, reusing the same sync services as the scheduled jobs (same eligibility filters, fail-closed, read-only toward Sankhya). A failed entity never stops the next ones, keeps its old rows and reports a masked reason (D-Q) plus the time of its last success; steps whose service is not wired in this installation are `skipped` with a reason, never silent. `GET /sync/refresh/{id}` returns per-entity status/rows read/duration/reason; `GET /sync/status` returns `dataAsOf` (the OLDEST last success among the mirrored entities), shown discreetly in the user menu as "Dados do Sankhya de HH:MM". A run left `running` for more than 30 minutes (worker restart) is closed with its unfinished steps failed so the next click works. The existing cron schedules are unchanged. New table `sync_refresh` (migration 0028) and its GRANT in `deploy/staging/db-roles.sql` (force_api: SELECT, INSERT; force_worker: SELECT, UPDATE). (B4) rule "toda ação assíncrona mostra estado imediato" in `.claude/rules/frontend.md`: loading+disabled buttons, skeletons, "Gerando PDF…", network error with "Tentar de novo". (The earlier note that every operational profile sees the step reason is reversed by D-AC.)
- **D-AC (the seller sees only the basics of a data refresh; owner ruling 2026-11-06; reverses the "ACCEPTED NOTE" of D-AB):** open receivables, IPI rates, order status, entity names, counts and technical reasons are sensitive: only manager, admin and technical see them. Enforced on the server, per role, in `SyncRefreshService` (hiding in the screen is never enough, P-21): `POST /sync/refresh` and `GET /sync/refresh/{id}` return the detail (steps, counts, masked reasons D-Q) to `admin`, `manager` and `technical` (`SYNC_REFRESH_DETAIL_ROLES`) and `SyncRefreshBasic` to everyone else: `{ id, status, progressPercent 0-100, phase "cadastros"|"precos"|"pedidos"|"concluido", finishedAt, hasWarnings }` (+ `reused`), with no entity name, count or reason. The technical profile may now call both routes (it sees the detail). `GET /sync/status` is unchanged (`dataAsOf` only). Authorization matrix and `sync-refresh.test.ts` assert a seller never receives `steps`. Visual language (C2): `ProgressSteps`, `StepRow`, `StepGroup`, `OutcomeMark` in `@salesforce/ui`; `DialogContent dismissible={false}` = no X, dimmed and blurred backdrop, initial focus on the dialog, ring only on `:focus-visible`; the refresh and "Enviando ao Sankhya…" dialogs share it; the seller view is a bar plus one sentence per phase, the manager/admin/technical view has three blocks (Cadastros, Preços, Financeiro e pedidos). The `CONFIG_SYNC_FROM_SANKHYA` pass-through to the staging worker is recorded in the C3 commit.
- **D-AD (the loading is the protagonist; details collapsed; it never looks stuck; a stuck refresh expires; owner ruling 2026-11-06):** the refresh and "Enviando ao Sankhya…" dialogs center a progress ring (`LoadingHero`, navy→red gradient, indeterminate arc at 0%, check/attention at the end; without a percentage — sending — the ring keeps turning with a send icon and never shows "0%"); the per-entity list is collapsed behind "Ver detalhes" (opens by itself on failure). Never stuck (web): 15 s with no step started → "Aguardando o serviço de atualização…"; 60 s with no advance (percent, step or status) → the dialog stops blocking and says "Está demorando mais que o normal. Os dados anteriores continuam disponíveis." with "Tentar de novo" and "Fechar" (seller sees only that phrase); the state clears by itself if the run advances again. Never stuck (server): `sync_refresh` pending without pickup for more than 2 min, or running without progress for more than 5 min (new column `progress_at`, migration 0029, nullable/expand-only, stamped at claim and at every step write), becomes `done` with its unfinished steps `failed` and the masked reason "O serviço de atualização não respondeu"; `finished_at` is stamped with the last moment it was alive, so neither the partial unique index nor the 60 s cooldown holds the next click. The sweep (`expireStuckRefreshes`) runs in the worker poller (every 2 s) and in `POST /sync/refresh` (API), which replaces the 30-minute close of D-AB. `force_api` gains UPDATE on `sync_refresh` in `deploy/staging/db-roles.sql` (the API closes a stuck row). A step that alone exceeds 5 minutes without writing would be expired; the longest observed step is far below that.
- **D-AE (loading is a full opaque screen, not a box; same screen for refresh and send; owner ruling 2026-11-06):** `FullScreenLoading` (`@salesforce/ui`) replaces the box dialog (`LoadingHero` removed): fixed, inset-0, above the header, 100% opaque navy (theme `--sf-navy` to `--sf-navy-strong` gradient; Radix overlay is a solid colour, no blur/scrim/box/border/shadow/title bar). Discreet "Force PLAC" brand at the top, ring (clamp 168–200 px) with the large percentage, action line and meta below (meta only for manager/admin/technical), end actions on the screen itself ("Concluir"; "Tentar de novo"/"Fechar"). "Ver detalhes" (manager/admin/technical only) opens a dark panel inside the screen (max 560 px, thin scrollbar only inside it), opens by itself on failure. `role=dialog`, `aria-modal`, focus trapped with initial focus on the screen, body scroll locked, Esc and X absent while running. "Enviando ao Sankhya…" uses the same component (indeterminate ring with send icon; no percentage). `DialogContent` loses `dismissible`.
- **D-AF (Force shows no sync record counts on screen; owner ruling 2026-11-06):** the details list shows only the step name and its state (waiting, running, done, failed with the masked reason and "Mantidos os dados de HH:MM", not applicable); no "N lidos", no totals, no "11 etapas concluídas com N registros". Defense in depth: `GET`/`POST /sync/refresh` never return `rowsRead` for any profile (contract, OpenAPI and web updated); the worker keeps it in `sync_refresh.steps` and in logs for diagnosis. Test: no response of `/sync/refresh`, for any profile, contains `rowsRead`, "linhas" or a count.
- **D-AG (timeout of `incluirNota` and reconciliation window; owner request 2026-11-09, live Sandbox order nº 10):** (1) The include (the order write only) has its own HTTP timeout, `SANKHYA_INCLUDE_TIMEOUT_MS` (default 120 s, accepted 1 s–10 min, `packages/sankhya/src/factory.ts`); reads and the token request keep `SANKHYA_REQUEST_TIMEOUT_MS` (default 30 s). Per-environment worker env only; `compose.env`, flags and overrides unchanged. (2) After a `timeout` in the include phase the outbox row goes `unknown` and, for `RECONCILE_WINDOW_MS` (10 min, `order-delivery.policy.ts`), each attempt (every `RECONCILE_INTERVAL_MS` = 1 min, attempt not consumed) only VERIFIES by the origin field and never includes (SNK-4). A note that appears is adopted (its NUNOTA goes on to confirmation). A window that ends with no note rejects the delivery with the masked reason `include_timeout_unconfirmed` and the person may use Reenviar. `reconcileSince` lives in the row's `payload` jsonb (no migration). (3) Every attempt logs `durationMs` ('order delivery attempt finished') and the transport timeout message states the applied `timeoutMs`.
- **D-AH (order stuck in "Envio em verificação"; owner request 2026-11-09, live Sandbox order nº 10):** (1) An order in `unknown` no longer tells the seller to check Sankhya. The label is "Verificando envio…" (list and detail, same tone as "Enviando ao Sankhya…") and the detail says "Estamos verificando o envio com o Sankhya. Isso se resolve sozinho em instantes." with a "Verificar agora" button. (2) `POST /orders/{id}/verify-delivery` (`verifyOrderDelivery`, scope of the order: owner, manager chain, admin) makes the SAME `unknown` `send_order` outbox row due now; it creates no second row and no second note, because the worker still verifies by the origin field before any include (SNK-4). At most one request per 60 s per order (`payload.lastVerifyRequestedAt`, no migration; `rate_limited` 429 with `retryAfterSeconds`). Audited as `order.delivery_verify_requested` with the actor; Reenviar now records the actor too (the CLI keeps null). (3) A delivery that ends `rejected` (including `include_timeout_unconfirmed`) always shows "Falha no envio" with the masked reason, Reenviar and Excluir. (4) The order screen refetches every 5 s while `unknown` or `queued`, so the button disappears when the delivery concludes. No Sankhya access, no flags, no `compose.env` change.
- **D-AI (several ERP notes with the same origin id; owner request 2026-11-09, live Sandbox NUNOTA 2495, 2496, 2497 for order nº 10):** (1) The origin lookup that finds MORE THAN ONE note raises `AmbiguousOriginError` (`ambiguous_origin`, permanent; carries the NUNOTA list, numbers only) in both the real gateway (`packages/sankhya/src/real/real-gateway.ts`, `findOrderByOrigin`) and the fake (`fake-order-book.ts`, which used to return the first match). Before this the real gateway threw `duplicate_origin`, the policy PARKED the order (outbox `unknown`, no next attempt, order "Envio em verificação" with no action). (2) The worker adopts none and includes none: the delivery ends `rejected` with code `ambiguous_origin`; the NUNOTA go to the worker log and to the `order.erp_rejected` audit event (`erpOrderNumbers`). (3) The order shows "Falha no envio" with "Há mais de uma nota com este pedido no Sankhya. Peça à TI para conferir." and NO Reenviar (editor and send dialog); Excluir stays. The server also refuses the resend (`POST /orders/{id}/submit` on such an order → 409 `conflict`, reason `ambiguous_origin`) and `ops-order-resend` (`requeueDeliveredOrder`) refuses an order whose delivery recorded `ambiguous_origin`; that tool never talks to Sankhya, so after a re-queue the worker's own lookup decides. (4) One note keeps being adopted; zero notes inside the reconciliation window (D-AG) keep only verifying. No migration, no flags, no `compose.env` change. The duplicate notes themselves are cleaned in Sankhya by IT; the Force never deletes or cancels ERP notes.
- **D-AJ (the Force does not confirm the ERP note; owner ruling 2026-11-09 — items 1-3 SUPERSEDED by D-AL on 2026-11-10; items 4-5 stand; after order nº 11 stuck on `confirmOrder` `not_implemented`):** (1) The delivery has no confirm phase any more (`DeliveryPhase` = verify | include | reread; setting `unconfirmedTops` removed from the service; `ORDER_DELIVERY_UNCONFIRMED_TOPS` is now unused). Confirmation and release are done inside Sankhya by the customer's internal team. The `SankhyaGateway.confirmOrder` port method stays unused by the worker. (2) The include with a known NUNOTA (or a single note found by origin) is the final state of the send: the D-7 reread check runs, then the order is `sent` with `erpNumber` and the outbox `confirmed`. `ambiguous_origin` (D-AI) is unchanged. (3) Seller text after `sent`: "Enviado ao Sankhya — nº N. A conferência é feita pela Plac."; an `unknown` order with a linked number reads "Verificando envio…". (4) Self-recovery: each worker sweep gives a due date to `unknown` outbox rows with `nextAttemptAt` null, `erpReference` set and `lastErrorMessage` starting `not_implemented:` (parked by the old confirm failure); the normal attempt finds the note by origin, never re-includes, rereads and ends `sent`. "Verificar agora" does the same on demand. (5) Logs per phase with `durationMs`: `order included in the ERP` (phase include, erpNumber) and `order read back from the ERP` (phase reread). No migration, no flags.
- **D-AK (discount sent as informed price; D-7 reread compares price, discount, IPI and total; owner ruling 2026-11-09, APPROVED).** The first real write with a discount (order B, note 2499) was stored with `PERCDESC 0` / `VLRDESC 0` because it was sent with `INFORMARPRECO "False"`. A note with at least one discounted item now sends `INFORMARPRECO "True"` and `VLRUNIT` (Force table price) on ALL items, plus `PERCDESC` on discounted items; never `VLRDESC`. A note with no discount keeps `"False"` and no `VLRUNIT`. Sankhya rule (note 2500, hand-made in the Sandbox): `VLRDESC = QTDNEG × ROUND(VLRUNIT × PERCDESC/100, 2)`; net line = `QTDNEG × (VLRUNIT − rounded unit discount)`; IPI = rate × net line (2 places); `VLRNOTA` = Σ net lines + IPIs. The Force aligns to this rule in one place (`packages/domain/src/money.ts`: `computeUnitDiscount`, `computeLineDiscountAmount`, `computeDiscountedLineTotal`, `computeNetUnitPrice`); the IPI estimate already follows the net line. D-7 reread (`verifyWrittenOrder`) compares `VLRUNIT` with the table price, `PERCDESC` with the value sent, `VLRDESC` with the rule within cents, and, when every line has a rate or is exempt, `VLRIPI` (lines and header) and `VLRNOTA` within cents; IPI/total divergences are rejections with their own codes (`ipi_divergence`, `total_divergence`). A rejected order whose ERP note exists with a divergence is not resent: server 409 (`delivery_diverged`), web hides "Reenviar" and tells the seller to ask IT. The include phase logs `priceMode`, `discountedItems` and per-line `vlrunit`/`percdesc`. Real validation of the corrected write is pending (SNK-4, no second Sandbox write without owner authorization). **Stale price (owner ruling 2026-11-09):** because `INFORMARPRECO "True"` makes the ERP keep the price sent, the reread also compares the stored `VLRUNIT` with the CURRENT effective table price in the ERP mirror; a difference rejects as `price_divergence` ("the table price changed after the order was created; create the order again"), the note is kept and not resent; no auto-correction and no new `revisao_preco` rule. **Addendum (2026-11-09, order 16, APPROVED by the owner's instruction):** the first corrected write (13 items, `INFORMARPRECO "True"`, 4 items without discount) was refused by Sankhya with `erp_refused_order`: "O campo 'Perc. desconto' deve ser informado." With `"True"` every item needs `PERCDESC`. `buildIncluirNotaBody` therefore sends `VLRUNIT` and `PERCDESC` on EVERY item when the note is `"True"` (the percentage, or `"0"` for an item without discount); a note with no discount stays `"False"` with neither field. The D-7 reread already accepts `PERCDESC 0` / `VLRDESC 0` (or null) on an item without discount (`discount_divergence` only when the stored value differs from the one sent). The refusal text of Sankhya (masked, ≤ 200 characters) is now logged (`reason` in "order delivery rejected") and shown on the rejected order (`erpDelivery.message`, only for `erp_refused_order`). The corrected write was NOT yet validated when this addendum was first written; see the validation record that follows. **VALIDATED in the Sandbox (2026-11-09, owner-run, pasted results):** order 16 (customer 2490, TOP 1001, 13 items: 4 without discount sent with `PERCDESC "0"`, 4 with 5 %, 5 with 8 %, IPI 3.25 % and 9.75 %) was included as NUNOTA 2506 (`VLRNOTA` 3,797.11, `VLRDESCTOT` 0, `STATUSNOTA` A). The 13 `TGFITE` rows (`PERCDESC`, `VLRDESC`, gross `VLRTOT`, `VLRIPI`) matched the `money.ts` calculation to the cent, and the D-7 reread passed with no divergence. The resend of order A (NUNOTA 2498) through `ops-order-resend` linked the existing note by its origin without creating a second one (log "order already in the ERP: linked, not resent"; duplicate query by `AD_FORCEORIGEM` returned 0 extra rows, SNK-4 confirmed for the resend path). NUNOTA 2504 and 2505 were consumed by the two refused attempts (Sankhya sequence, no note exists). Test notes for IT to clean in the Sandbox: 2499, 2500, 2501, 2502, 2503, 2506 (and 2498 if the owner wants). The decimal-quantity item of the order C script is NOT part of this evidence: it is to be confirmed (it may already be covered by orders A and B with products 4158/4159; not verified here).
- **D-AL (the Force confirms the ERP note after include + reread; owner ruling 2026-11-10; SUPERSEDES D-AJ items 1-3 "the Force does not confirm"; the request shape is NEEDS VALIDATION).** (1) After the include and the successful D-7 reread, the worker confirms the note in Sankhya like Vidya does (Vidya confirms ~3 s after sending). The Force NEVER writes `AD_STATUS` (the trigger `INX_TSILIB_STATUS_APROVACAO` does). (2) Service: `CACSP.confirmarNota`, module mgecom, body `{ nota: { NUNOTA: { $: "<number>" } } }` — from an UNOFFICIAL community SDK (`gabrielnfc/sankhya-sales-sdk`), NOT observed in the Sandbox; the response format (warnings, generated releases, "already confirmed" as error or as success depending on the SDK variant) is unknown, so `parseConfirmarNotaResponse` reads it defensively (`packages/sankhya/src/write/confirmar-nota.ts`) and the MASKED response is logged (`order confirmation answered by the ERP`, field `response`) for the owner to inspect in the Sandbox test. (3) Behavior: confirming is idempotent (a note already `STATUSNOTA = 'L'` skips the call; an "already confirmed" answer is success). A confirmation held by a pending release is NOT an error: the order is `sent`, the note stays A with release lines, and the release read cycle shows "Aguardando liberação" ("Enviado ao Sankhya. Aguardando liberação."). Any other refusal (e.g. insufficient stock) is a `validation` error after the number is known: the delivery is PARKED (outbox `unknown`, no next attempt; the order shows "Verificando envio…") with the readable ERP reason in the existing masked error filter, and the note is NEVER re-included; only the confirmation is repeated (the origin lookup runs on every attempt, SNK-4), by "Verificar agora" (seller) or the sweep. Timeout/5xx/network: the note stays included and the worker repeats only the confirmation (`DeliveryPhase` gains `confirm`; backoff; parked after the last attempt). (4) Configuration: installation key `erp.confirmAfterInclude` (boolean, absent/false = off), in the installation configuration file (`erp` section) that `config-bootstrap` loads into `installation_configuration_version`; read per attempt. OFF by default until validated in the Sandbox; no `compose.env*`, flag or `enable-*` involved. (5) The real adapter exists (`RealSankhyaGateway.confirmOrder`, same Sandbox-only gate as the include); `SankhyaWritePort.confirmOrder` returns `{ outcome: confirmed | already_confirmed | release_pending, maskedResponse }`. (6) Tests: gateway parsing and fake scenarios (pending release, insufficient stock, already confirmed, timeout, reconfirmation), policy for the `confirm` phase, delivery integration scenarios (written; need Docker). Not validated: the request/response of `confirmarNota` and how the TIPFRETE/release interplay behaves in the Sandbox.

- **D-AM (product filter by group hierarchy Grupo > Subgrupo > Linha; owner ruling 2026-11-10; WEB ONLY).** (1) New mirror table `erp_product_group` (TGFGRU: code, name, `parent_code` from CODGRUPAI, `degree`, `analytic`, `active`), add-only migration 0031 (P-16), mirror entity `productGroups` appended last to `MIRROR_ENTITIES`, on the products cron and in "Atualizar dados" (phase Cadastros). Group 0 is NOT mirrored and `CODGRUPOPROD > 0` is unchanged. (2) `GET /product-groups` now returns `parentCode`, `degree`, `hasChildren` per group plus `hierarchical` and `hasUngrouped`; only ACTIVE groups with an active product in or below them are listed; a group whose parent is hidden/absent, or inside a cycle, is promoted to top level (anomaly, never a hang). While the table is EMPTY (after deploy, before the first sync) the answer is the flat list derived from `erp_product` (`hierarchical: false`). (3) `GET /products?group=N` filters by N and all its descendants of any depth, resolved on the SERVER by `parent_code` (depth limit 10, visited set), never by code prefix; `group=0` = "Sem grupo" (products with null/0 group), offered by the client only when `hasUngrouped`. (4) Web: one shared `GroupCascadeFilter` (Grupo > Subgrupo > Linha; Linha only when the chosen subgrupo has children; changing a level clears the lower ones) used by the product browser, the multi-select and the order product filter, selection kept in host state, AND with text search. (5) Mobile unchanged (flat filter; mobile-db, local schema and sync protocol untouched); the catalog page `routes/products.tsx` keeps its single select, now listing every visible group of any level.
- **D-AN (order billing status; owner block 3, 2026-11-10).** (1) Read-only billing facts join the release read cycle (`readOrderReleaseFacts`): cancelled (note absent from TGFCAB and present in TGFCAB_EXC/TGFCAN — a missing note alone is never a cancellation), invoiced (TGFVAR link to a sale note TIPMOV 'V', STATUSNOTA 'L'; earliest DTFATUR; NF-e authorized = STATUSNFE 'A' with DHPROTOC), per-item invoiced = QTDENTREGUE and cut = QTDNEG − QTDENTREGUE when the item is not pending. (2) Precedence in `packages/domain/src/billing-status.ts`: Cancelado > Negado > Aguardando liberação > Faturado > Aguardando faturamento (STATUSNOTA 'L' + PENDENTE 'S') > Enviado (sem confirmação) (STATUSNOTA 'A'). (3) Follow-up window 60 days (was 90 for the release cycle); an order is read until invoiced or cancelled. (4) Stored in `sales_order.erp_status_detail` as versioned JSON v2 (no migration); additive contract field `erpBilling` (items only on the detail). (5) A failed billing query never fails silently nor guesses: the batch keeps the stored state and one warning with the error code is logged. (6) Web and mobile share labels/colors (Faturado green, Aguardando faturamento light blue, Cancelado gray, Negado red, Aguardando liberação amber, Enviado neutral); "NF-e autorizada" only when true. Pending validation: the cut rule in a Sandbox case and cancellation of an already invoiced order (`sankhya-spike.md` §9.55).
- **D-AO (addendum to P4: quantity step per product from AGRUPMIN; owner block 5, 2026-11-10; WEB and server only).** (1) The quantity accepts at most 2 decimal places. (2) When the product has `TGFPRO.AGRUPMIN` > 0 the quantity must be a multiple of it (exact decimal arithmetic, never float); laminates PT 1453/1440 have 0,2 in production. (3) `AGRUPMIN` null or <= 0 means step 0,01. (4) Mirrored read-only in `erp_product.quantity_step numeric(14,4)` (migration 0032, additive) and exposed as `ProductListItem.quantityStep` (optional, nullable). (5) Enforced server-side by `validateDraftInvariants` with the stable code `invalid_quantity_step`; the web checks locally with the same rule and skips the check when the step of a saved line is unknown (the server decides). (6) The domain `validateQuantity` still allows 4 decimals (P4 `DECQTD = 4`); the 2-decimal limit lives in the step check, so a caller that passes no product lookup is not limited. (7) Line total rounding is unchanged (D-AK). (8) Mobile, `mobile-db` and sync are untouched in this block. Open: whether Sankhya accepts a fraction for product 4158 (integer-only?) is NEEDS VALIDATION in the Sandbox; see `sankhya-spike.md` §9.56.
- **D-Z (a simulated delivery is terminal; owner ruling 2026-11-04, L2):** when the dry-run record is stored, the `integration_outbox` row becomes terminal (`status=dry_run`, origin id released, no next attempt) and the order returns from `queued` to `draft` (version bumped). The detail shows the mark `dryRun {at, payloadHash}` ("Simulado em dd/mm hh:mm — não enviado"), derived from `integration_order_dry_run` and therefore gone after the 30-day purge. A real send needs a new "Enviar ao Sankhya", which creates a NEW outbox record; a `dry_run` row is never picked up by the sweep and nothing simulated is delivered when the mode turns live. Before D-Z the row stayed `pending` (no next attempt, step `dry_run`), holding the origin id and leaving the order `queued` (`storeDryRun`, `apps/server/src/integration/order-delivery.service.ts`). Migration 0026 adds the status; data migration 0027 converts rows already parked (e.g. order 7) and returns their orders to draft. Deleting a draft deletes its `dry_run` rows (D-Y).

## 4. Status of the specification's decisions (spec §4)

The spec is a draft. Its decisions are binding only where an APPROVED entry above covers them.

| Spec | Status | Notes |
|---|---|---|
| D1 | APPROVED | P-01 (scope amended by PROD-1) |
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
| D15 | APPROVED in part | Modular monolith (P-04), strict TypeScript (P-06), NestJS (STACK-3), Drizzle (DATA-2), pnpm + Turborepo (STACK-1), Zod contracts direction (STACK-4) and the Vite + React SPA replacing Next.js (STACK-5) APPROVED; BullMQ/Redis and MinIO superseded (STACK-6, STACK-7); sync engine and remaining stack choices PROPOSED (SYNC-1) |
| D16 | APPROVED | P-11; compensating controls (AUTH-1, AUTH-2) PROPOSED |
| D17 | APPROVED | P-09; detection details UNDECIDED (R33) |
| D18 | APPROVED | P-14 |
| D19 | AMENDED | OPS-1 (VPS/VM compute kept; managed PostgreSQL with PITR preferred; isolated staging) |
| D20 | PROPOSED | CI blocks merge; no global coverage target; high coverage in domain, sync and permissions |
| D21 | APPROVED | P-10; calculation base and routing UNDECIDED (R35, R36); interim ceiling-free structural per-item discount APPROVED (DISC-1, §3.9) |

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
| R35 | **Base decided 2026-10-28 (DISC-2): customer price table.** Discount authority calculation base (interim ceiling-free per-item discount shipped in Phase 0 — DISC-1, §3.9; full authority still gates Phase 1) |
| R36 | **Routing seller → manager → director decided 2026-10-28 (DISC-2); ceiling and substitute approver still open.** Approval routing, absolute ceiling, substitute approver (unaffected by DISC-1) |
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

### 5.5 Follow-ups from the 2026-09-18 owner rulings — UNDECIDED

| ID | Topic | Depends on | Status |
|---|---|---|---|
| U-10 | Physical design of the Sankhya-side "Configuração Sales Force" (table/screen, fields, who edits, versioning, audit, synchronization cadence); security review of the account → seller scope path | CFG-1…CFG-6 | RESOLVED for the pilot 2026-10-30 (§3.17: PONTE; own AD_PLACFORCE* tables deferred) |
| U-11 | Source of the installation configuration before that model exists (development, CI, staging with the fake gateway; bootstrap of the first installation) | CFG-1 | RESOLVED for the pilot 2026-10-30 (§3.17: base file + Sankhya overlay) |
| U-12 | Dedicated origin-id field: final name, type and length, uniqueness/index, creation in Sandbox, acceptance by `incluirNota` | SNK-5, V-11, V-13 | NEEDS VALIDATION |
| U-13 | Per-installation infrastructure, cost budget and release/operations model — the OPS-1/OPS-6/STACK-7 budgets were set for one production environment | PROD-1 | UNDECIDED — owner to decide before a second installation |

---

## 6. Validation register — all NEEDS VALIDATION

| ID | Question | Resolves | Needed by |
|---|---|---|---|
| V-01 | Expo + pnpm isolated installs work in the skeleton (fallback `nodeLinker: hoisted` only if proven necessary)? | STACK-1 (APPROVED) | Phase 0 skeleton (WP 0.2) |
| V-02 | Which Zod → OpenAPI library and which typed client generator? | STACK-4 | Phase 0 first endpoint |
| V-03 | Which Drizzle version line to pin (server and mobile)? | DATA-2 | Phase 0 skeleton |
| V-04 | Provider combination under OPS-6: VPS/VM compute + managed PostgreSQL with PITR (retention and cost), private networking, Brazil region preferred; itemized monthly cost (production, staging, database, storage, backup, monitoring, growth); secondary backup location | OPS-1, OPS-2 | Before provisioning environments |
| V-05 | Object storage provider/region (Brazil preferred; AWS S3 São Paulo compared), versioning and lifecycle support, cost; local S3-compatible emulator chosen separately | STACK-7 | Before provisioning environments |
| V-06 | Does the company use Google Workspace? | OPS-5 | Before password reset |
| V-07 | Commit-safe watermark proven by concurrent-transaction test | SYNC-2 | With the first synchronizable table |
| V-08 | Sentry data region; processor registration | OPS-4 | Before real personal data (pilot) |
| V-09 | Spike S7: SQLCipher library, Android 16 KB pages, FTS5, safe Drizzle compatibility with the encrypted library (conflict returns to the owner), performance | MOB-2, DATA-2 (mobile) | Execution authorized now, Phase 0 (owner ruling 2026-09-29, MOB-5, §3.10); `packages/mobile-db` implementation stays gated until this closes **S7 executed 2026-09-30, closed by MOB-6** (FTS5 unusable; 16 KB, iOS, V-14 pending) |
| V-10 | Spike S8: organizational accounts, D-U-N-S, Google Play private/unlisted options and Managed Play device-management requirements, Apple unlisted distribution acceptance, Android developer verification | MOB-3 | Before the pilot |
| V-11 | Spike S0: homologation existence; availability of an isolated real test environment; whether read-only API credentials exist (for U-03 inspections); request limits; integration cost; authorization and feasibility of custom origin-id fields | SNK-3, SNK-4 | Before any real Sankhya connection |
| V-12 | Spike S1: API per operation, incremental reads, deletion detection | SNK-2 | Before the Phase 0 mirror |
| V-13 | Native Sankhya idempotency support | SNK-4 (D) | Before real order writes |
| V-14 | Real data volumes: portfolio size per representative, prices per customer, item history (R12) | SYNC-3 sizing, spec §13 targets | Phase 1 gate (with S7) |
| V-15 | Final PostgreSQL major: newest mature version supported cleanly by the selected provider, Drizzle, backup tooling and required extensions (18 preferred, 17 acceptable, 16 floor) | DATA-1 | After V-04, before the Phase 0 skeleton |
| V-16 | pg-boss compatibility with the selected managed PostgreSQL (connection poolers, direct endpoint availability for the worker, required privileges) | STACK-6, OPS-1 | With provider selection (V-04) |
