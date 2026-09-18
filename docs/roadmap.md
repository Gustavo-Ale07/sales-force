# Roadmap — Sales Force

**Responsibility of this file:** phase sequencing, Phase 0 work breakdown, parallel non-code tracks, phase gates, and open scope questions. Requirement details stay in `project-spec.md` (referenced by `RF-*` IDs); decisions stay in `decisions.md`.

**Last updated:** 2026-09-16

---

## 1. Current status

| Item | Status |
|---|---|
| Project mode | **IMPLEMENTATION, Phase 0 only** — `BEGIN IMPLEMENTATION` issued by the owner 2026-09-18 (GOV-1); anything outside the current phase, or depending on a PROPOSED/UNDECIDED decision, needs owner approval |
| Implementation phase | Phase 0 — Foundation, **authorized 2026-09-18; no work package executed yet** |
| Decision rounds | Rounds 1, 2 and 3 closed 2026-09-16 (U-08 deferred to the Phase 1 gate; providers, final PostgreSQL major, pg-boss provider compatibility and Drizzle versions NEEDS VALIDATION); Round 4 open; Rounds 5 and 7 not started; Round 6 closed 2026-09-18 and the owner rulings of `decisions.md` §3.8 recorded (`decisions.md` §0) |
| Documentation and Claude Code configuration | Drafted 2026-09-16; statuses corrected; batches 2 and 3 recorded 2026-09-16 |
| Repository | `main` at `05ccc63` (stable); design work on `design/blueprint` |
| Visual blueprint (`docs/blueprint.html`) | **Draft v0.1** published 2026-09-16, brought forward by owner instruction before Rounds 4–7 close. Not an approved specification: every block carries its decision status; screens, mockups, flow sequences and the import, sync-command and outbox state names are proposals; gaps found while drawing are listed as `BP-01…BP-17` in its open-decisions section (not yet recorded in `decisions.md`). Version increments (v0.2, v0.3, …) as decision batches are approved; v1.0 with Specification v1.0 |
| Specification v1.0 | UNDECIDED timing — published after the blocking decision rounds close (GOV-1) |

### 1.1 Design-phase steps

1. Git state verified; `design/blueprint` created and pushed — done 2026-09-16.
2. Decision rounds 1–7 closed with the owner, each batch committed.
3. Complete visual blueprint — Draft v0.1 started early (2026-09-16, owner instruction); completed as rounds close.
4. Full design audit.
5. Red Team review (architecture, security, sync).
6. Resolve resulting issues with the owner.
7. Publish Specification v1.0 and the matching blueprint version.
8. Design readiness report ending in `DESIGN READY FOR IMPLEMENTATION` or `DESIGN NOT READY FOR IMPLEMENTATION`. Implementation still waits for `BEGIN IMPLEMENTATION`.

### 1.2 Blueprint input tracker

Each round keeps enough structured information for the blueprint to be generated later. Readiness: **ready** (approved and structured), **partial** (content exists, statuses mixed), **missing** (to be produced in a later round).

| Blueprint content | Source today | Readiness | Filled by |
|---|---|---|---|
| Architecture diagrams (system context, processes, dependency direction, jobs/outbox, migrations, environments, database network, backup/recovery) | `architecture.md` §1, §4.1, §5, §7.2, §10 | partial — server, persistence and infrastructure approved; clients approved in Round 6 (2026-09-18); delivery PROPOSED | Round 7 |
| Modules, submodules, functions | `project-spec.md` §3, §5 (`RF-*`); `architecture.md` §5.2 (module map PROPOSED) | partial | Module catalog pass |
| Actors, roles, permissions, data visibility | `project-spec.md` §2, §8; `security-model.md` §5 | partial — AUTH-4 PROPOSED | Round 4 |
| User journeys and business processes | `project-spec.md` §5 flows | missing (structured journeys) | Journey pass after Round 5 |
| State machines (account, order, proposal, opportunity, task, import, outbox, sync command) | P-19 lifecycle (approved); `project-spec.md` | partial | Rounds 5, 7 + Phase 1 business rules |
| Data model and relationships | `project-spec.md` §9; `architecture.md` §3 | partial | Round 5 (DATA-3, SYNC) + entity pass |
| Offline sync and mobile flows | `sync-protocol.md` | partial — PROPOSED | Rounds 5, 6 |
| Sankhya integration | `sankhya-spike.md`; SNK-3, SNK-4 | partial — facts NEEDS VALIDATION | Round 7 + spikes |
| Error flows | `project-spec.md`; `security-model.md` | missing | Error-experience pass |
| Screen inventory (`SCR-*`) with `RF-*` traceability | `project-spec.md` §5; proposed catalog of 98 screens in `blueprint.html` Annex A (v0.1) | partial — proposed inventory, not approved (BP-16) | Owner review of the inventory |
| Testing blueprint | `.claude/rules/testing.md`; `sync-protocol.md` §11 | partial — tooling PROPOSED (spec D20; Round 6 took no test-tooling decision) | Testing pass |
| Operations (backups, recovery, environments, costs) | OPS-6, OPS-1, OPS-2; provider comparison and quote checklist (`architecture.md` §10.2–§10.3) | partial — providers NEEDS VALIDATION | V-04, V-05, V-16, Round 7 |
| Background jobs and integration outbox (job catalog, outbox states, operator reprocessing) | STACK-6; `architecture.md` §5.3, §7.2; `sync-protocol.md` §6.2.1 | partial — mechanism approved, job catalog and outbox state machine missing | Round 7 + entity pass |
| API boundaries (API vs worker responsibilities, conceptual endpoints) | STACK-2; `architecture.md` §5.1 | partial — process boundary approved, endpoint catalog missing | Rounds 4–6 + API catalog pass |

---

## 2. Parallel tracks (no code)

| Track | Action | Resolves | Owner | Needed by |
|---|---|---|---|---|
| T1 | Send S0 questions to the Sankhya partner/executive (`sankhya-spike.md` §3 S0) — can start now (SNK-3, SNK-4 APPROVED) | V-11, V-13 | Project owner | Before any real Sankhya connection |
| T2 | Start organizational Apple and Google developer accounts and the D-U-N-S number (S8) — can start now (MOB-3 APPROVED) | V-10 | Project owner | Before the Phase 1 pilot |
| T3 | Send the quote checklist (`architecture.md` §10.3) to AWS, Magalu and Azure; compare formal BRL quotes (production ≤ ~R$ 700 candidate, > R$ 800 owner review; staging separately); then approve providers for compute, managed PostgreSQL with PITR and private networking, S3-compatible storage and the secondary backup location; then fix the PostgreSQL major and confirm pg-boss compatibility | V-04, V-05, V-15, V-16 | Project owner (research assisted) | Before work package 0.6 |
| T4 | Confirm whether the company uses Google Workspace; prepare sending domain (SPF, DKIM, DMARC) | V-06 | Project owner | Before password reset in 0.5 |
| T5 | Legal review of processors and international transfers (LGPD) | R67 | Project owner + legal | Before the Phase 1 pilot |

---

## 3. Phase 0 — Foundation

**Objective:** a secure, deployable foundation — repository, CI, environments, identity and access, audit, Sankhya client and the first mirror — with no Phase 1 business features.

### 3.1 Work packages (in order) — PROPOSED

`BEGIN IMPLEMENTATION` was issued by the owner on 2026-09-18 (Phase 0 only). Round 6 closed the same day (STACK-1, STACK-5 approved; STACK-4, MOB-1, MOB-2 approved in direction) together with the owner rulings of `decisions.md` §3.8 (PROD-1, CFG-1…6, SNK-5, SNK-6, SEC-1, DOC-1). The work packages still assume the PROPOSED decisions of Rounds 4, 5 and 7 and are re-planned when those rounds close; a work package that needs a PROPOSED or UNDECIDED decision stops and asks the owner.

| WP | Content | Decisions / requirements | Depends on |
|---|---|---|---|
| 0.1 | Repository: ~~branch `main`, first commit, GitHub remote~~ (done); merge the approved design from `design/blueprint`; branch protection on `main` (PR + passing CI required) | GOV-1, OPS-3 | owner approval to merge |
| 0.2 | Monorepo skeleton: `apps/server`, `apps/web`, `apps/mobile` shells (mobile only validates the toolchain and never delays web); all `packages/*`; lint, typecheck, test, build scripts; dependency boundary lint | STACK-1…5, MOB-1 (MOB-2 direction only; library V-09 not needed), `architecture.md` §4 | 0.1 (merge approval pending); resolves V-01 and V-03; V-02 only with the first real endpoint. `packages/mobile-db` is a stub (library V-09); the `architecture.md` §4.2 dependency table and test tooling (D20) are PROPOSED — a needed choice stops and goes to the owner |
| 0.3 | CI pipeline: lint, typecheck, test (Testcontainers PostgreSQL, same major as production — DATA-1), build; actions pinned; dependency scanning | OPS-3, spec D20 | 0.2 |
| 0.4 | Database foundation: Drizzle setup; one-shot migration step protected against concurrent execution (DATA-2); conventions; change-tracking trigger and commit-safe watermark with the concurrent-transaction test | DATA-1, DATA-2 (APPROVED); DATA-3, SYNC-2 (PROPOSED) | 0.2; resolves V-07 |
| 0.5 | Identity and access: users, teams (tree), roles, permissions with per-permission scope, central policy module, login, password policy, lockout, password reset, sessions with device identity and session version, representative web block, audit log; authorization matrix tests; security review | RF-IAM-1…6, RF-IAM-9, AUTH-1…4, `security-model.md` | 0.4; V-06 for reset email |
| 0.6 | Environments: staging then production hosts; database; buckets; email domain; Caddy; secrets; deploy pipeline with migration job; Sentry with scrubbing; `/health`; uptime monitor | OPS-6, OPS-1, OPS-2, OPS-3, OPS-4, OPS-5, STACK-7, P-15 | 0.3; V-04, V-05, V-06, V-08, V-15 |
| 0.7 | Web shell: login, password reset, user/team/role administration | RF-IAM-4, RF-IAM-6, STACK-5 | 0.5 |
| 0.8 | Sankhya client and mirror: gateway interface + fake; OAuth client; spike S1 in the SNK-3 environment; mirror of sellers, customers/portfolio, products, price tables with hash-diff upserts and per-entity sync state; reconciliation per S1 findings; installation-configuration mirror (read side) once U-10/U-11 are decided | RF-SNK-1, RF-SNK-2, RF-SNK-8, RF-CFG-1, SNK-1…3, CFG-1 | 0.4, 0.6; V-11, V-12; Q-02 |
| 0.9 | Integration health (last success per entity, lag, errors, alert email) | RF-SNK-6, RF-SNK-7 | 0.8; Q-01 |

> **Note (2026-09-18):** the `CODVEND` link in RF-IAM-4 (WP 0.5, 0.7) follows CFG-2. Until U-10/U-11 are decided that part is deferred or needs owner input; it is never hardcoded to `TSIUSU.CODVEND`.

### 3.2 Phase 0 does not include

Mobile features, sync endpoints, scope events, orders, prices in the domain, discount/credit rules, customer approval, Sankhya writes, notifications, imports.

The mobile app shell in 0.2 exists only to validate the monorepo toolchain (V-01); mobile is not on the critical path of the first implementation slice (MOB-1).

### 3.3 Exit criteria — PROPOSED (confirm with this roadmap)

1. CI runs on every pull request and blocks merge on failure.
2. Staging is deployed through the pipeline; production environment is provisioned and reachable.
3. Login, lockout, password reset and session revocation work in staging; security review of 0.5 completed with findings resolved.
4. Authorization matrix tests pass for all Phase 0 endpoints.
5. The watermark concurrency test passes (V-07).
6. The Phase 0 mirror runs in staging against the SNK-3 environment, with health visible.
7. S0 and S1 findings are recorded in `sankhya-spike.md`.
8. `decisions.md` reflects every decision taken during Phase 0.

---

## 4. Phase 1 gate

Resolve each item before starting the Phase 1 work it blocks.

| Item | Blocks |
|---|---|
| S2 (R30, R31, precision/rounding) | Pricing in `packages/domain`, quotations, orders |
| S3 (R24, R25) | Order submission and status |
| S4 (R26, R38) | Approvals and credit checks |
| S5 (R27) | New customer creation in Sankhya |
| S6 (R28) | Goals, positivization, commissions |
| SNK-4 validations (V-11; V-13 for native idempotency) | Any Sankhya write |
| S7 (V-09, V-14, R12) | Mobile local database and sync sizing |
| R05, R06, R07, R08, R09, R10, R11 | Sync push, conflicts, drafts, OTA/local migrations |
| R16, R17, R19, R45 | Device lock, deduplication, backups, key loss |
| R33, R35, R36, R37 | Price revision details, discount authority, approval routing, credit approver |
| R42 | Sales document mirror depth |
| R48, R60 | Mobile testing strategy, offline quotation PDF |
| R14 (AUTH-3 follow-up) | Representative import UX |
| OPS-2: recovery procedure documented, backups monitored, at least one successful restore test | **Pilot** |
| SNK-3 pilot gate: one real order write and one real partner write validated in a non-production Sankhya environment (otherwise a new decision) | **Pilot** |
| S8 (V-10), R67, V-08, U-08 (store review demo environment, deferred) | **Pilot** |

---

## 5. Phase 1 — Sales Force (replaces Vidya Force)

**Objective:** representatives and internal sellers place orders through Sales Force, offline-capable, integrated with Sankhya; Vidya Force switched off after a parallel pilot.

Scope (spec §3 and `RF-*` tagged F1):

| Area | Requirements |
|---|---|
| Devices and offline security | RF-IAM-7, RF-IAM-8 |
| Mobile offline app and sync | spec §10, `sync-protocol.md` |
| Customer portfolio, customer record, contacts | RF-ACC-1…6, RF-CON-1…2 |
| New customer + CNPJ/CEP lookup + approval queue | RF-ACC-3, RF-ACC-4, RF-INT-1, RF-INT-2 |
| Catalogue, prices, discount limits, cost/margin restriction | RF-CAT-1…4 |
| Quotations and orders, approvals, price revision, repeat order, quotation PDF/share | RF-ORD-1…10 |
| Sankhya outbox, idempotent writes, visible integration errors | RF-SNK-3…5 |
| Goals, positivization, commissions | RF-GOL-1…3 |
| Basic tasks with reminders | RF-ACT-1…3 |
| Notifications (push and in-app) | RF-NOT-1, RF-NOT-2 |
| Imports: customer order spreadsheet, new customers in bulk | RF-IMP-1…3, RF-IMP-5 |
| Seller summary panel in the app | RF-DSH-5 |
| Web equivalents for internal sellers and managers | spec §3 |
| Pilot in parallel with Vidya; shutdown criteria | spec §16 |

---

## 6. Phase 2 — CRM (replaces Agendor)

Scope: leads, pipelines, opportunities, loss reasons, proposals with PDF and email/WhatsApp link, follow-ups and interactions, agenda, predefined automations, lead lists import, Agendor migration, dashboards and exports for authorized profiles, Google Workspace, notification preferences (spec §3, `RF-*` tagged F2).

Gate items: S9 (Agendor export format; defined in `spec-review.md` §L), R34 (lead pricing), R53 (unassigned lead pool), details of D9 and D10.

---

## 7. Phase 3 — Intelligence and channels

Scope: automation rule builder, AI assistant and features (read-only tools), website/ads lead capture, telephony (spec §3, §6).

Gate items: R18 (knowledge base visibility), telephony provider choice, AI cost ceilings configuration.

---

## 8. Phase 4 — Future

Official WhatsApp Cloud API conversations; external customer chatbot. Not planned.

---

## 9. Open scope questions

Do not resolve silently; confirm with the project owner.

| ID | Question | Affects |
|---|---|---|
| Q-01 | `project-spec.md` tags the integration health panel and alerts (RF-SNK-6, RF-SNK-7) as Phase 0, but §3 lists the health panel under Phase 1. Which phase? | WP 0.9 |
| Q-02 | RF-SNK-1 (Phase 0) lists mirror frequencies for financial titles, sales documents and goals/commissions, while §3 Phase 0 lists only sellers, customers/portfolio, products and price tables. Are the extra entities Phase 0 or Phase 1? | WP 0.8, R42 |
