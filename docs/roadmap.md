# Roadmap — Sales Force

**Responsibility of this file:** phase sequencing, Phase 0 work breakdown, parallel non-code tracks, phase gates, and open scope questions. Requirement details stay in `project-spec.md` (referenced by `RF-*` IDs); decisions stay in `decisions.md`.

**Last updated:** 2026-09-16

---

## 1. Current status

| Item | Status |
|---|---|
| Project mode | **DESIGN** — no implementation until the owner writes `BEGIN IMPLEMENTATION` (GOV-1) |
| Implementation phase | Phase 0 — Foundation, **not started and not authorized** |
| Decision rounds | Round 1 closed 2026-09-16 (clarifications U-01…U-09 open); Round 2 open; Rounds 3–7 not started (`decisions.md` §0) |
| Documentation and Claude Code configuration | Drafted 2026-09-16; statuses corrected 2026-09-16 (only Round 1 and owner-stated principles are APPROVED) |
| Repository | `main` at `05ccc63` (stable); design work on `design/blueprint` |
| Visual blueprint (`docs/blueprint.html`) | Not started |
| Specification v1.0 | UNDECIDED timing — published after the blocking decision rounds close (GOV-1) |

### 1.1 Design-phase steps

1. Git state verified; `design/blueprint` created and pushed — done 2026-09-16.
2. Decision rounds 1–7 closed with the owner, each batch committed.
3. Complete visual blueprint.
4. Full design audit.
5. Red Team review (architecture, security, sync).
6. Resolve resulting issues with the owner.
7. Publish Specification v1.0 and the matching blueprint version.
8. Design readiness report ending in `DESIGN READY FOR IMPLEMENTATION` or `DESIGN NOT READY FOR IMPLEMENTATION`. Implementation still waits for `BEGIN IMPLEMENTATION`.

---

## 2. Parallel tracks (no code)

| Track | Action | Resolves | Owner | Needed by |
|---|---|---|---|---|
| T1 | Send S0 questions to the Sankhya partner/executive (`sankhya-spike.md` §3 S0) — can start now (SNK-3, SNK-4 APPROVED) | V-11, V-13 | Project owner | Before any real Sankhya connection |
| T2 | Start organizational Apple and Google developer accounts and the D-U-N-S number (S8) — can start now (MOB-3 APPROVED) | V-10 | Project owner | Before the Phase 1 pilot |
| T3 | Confirm infrastructure budget and residency requirement; then select providers for hosts, PostgreSQL and object storage (after Round 2 closes) | V-04, V-05 | Project owner | Before work package 0.6 |
| T4 | Confirm whether the company uses Google Workspace; prepare sending domain (SPF, DKIM, DMARC) | V-06 | Project owner | Before password reset in 0.5 |
| T5 | Legal review of processors and international transfers (LGPD) | R67 | Project owner + legal | Before the Phase 1 pilot |

---

## 3. Phase 0 — Foundation

**Objective:** a secure, deployable foundation — repository, CI, environments, identity and access, audit, Sankhya client and the first mirror — with no Phase 1 business features.

### 3.1 Work packages (in order) — PROPOSED

The work packages below assume the PROPOSED decisions of Rounds 2–7; they are re-planned when those rounds close. None starts before `BEGIN IMPLEMENTATION`.

| WP | Content | Decisions / requirements | Depends on |
|---|---|---|---|
| 0.1 | Repository: ~~branch `main`, first commit, GitHub remote~~ (done); merge the approved design from `design/blueprint`; branch protection on `main` (PR + passing CI required) | GOV-1, OPS-3 | owner approval to merge |
| 0.2 | Monorepo skeleton: `apps/server`, `apps/web`, `apps/mobile` shells; all `packages/*`; lint, typecheck, test, build scripts; dependency boundary lint | STACK-1…5, MOB-1, DATA-3, `architecture.md` §4 | 0.1; resolves V-01, V-02, V-03 |
| 0.3 | CI pipeline: lint, typecheck, test (Testcontainers PostgreSQL 18), build; actions pinned; dependency scanning | OPS-3, spec D20 | 0.2 |
| 0.4 | Database foundation: Drizzle setup; migration job with lock; conventions; change-tracking trigger and commit-safe watermark with the concurrent-transaction test | DATA-1…3, SYNC-2 | 0.2; resolves V-07 |
| 0.5 | Identity and access: users, teams (tree), roles, permissions with per-permission scope, central policy module, login, password policy, lockout, password reset, sessions with device identity and session version, representative web block, audit log; authorization matrix tests; security review | RF-IAM-1…6, RF-IAM-9, AUTH-1…4, `security-model.md` | 0.4; V-06 for reset email |
| 0.6 | Environments: staging then production hosts; database; buckets; email domain; Caddy; secrets; deploy pipeline with migration job; Sentry with scrubbing; `/health`; uptime monitor | OPS-1, OPS-3, OPS-4, OPS-5, STACK-7, P-15 | 0.3; V-04, V-05, V-06, V-08 |
| 0.7 | Web shell: login, password reset, user/team/role administration | RF-IAM-4, RF-IAM-6, STACK-5 | 0.5 |
| 0.8 | Sankhya client and mirror: gateway interface + fake; OAuth client; spike S1 in the SNK-3 environment; mirror of sellers, customers/portfolio, products, price tables with hash-diff upserts and per-entity sync state; reconciliation per S1 findings | RF-SNK-1, RF-SNK-2, RF-SNK-8, SNK-1…3 | 0.4, 0.6; V-11, V-12; Q-02 |
| 0.9 | Integration health (last success per entity, lag, errors, alert email) | RF-SNK-6, RF-SNK-7 | 0.8; Q-01 |

### 3.2 Phase 0 does not include

Mobile features, sync endpoints, scope events, orders, prices in the domain, discount/credit rules, customer approval, Sankhya writes, notifications, imports.

The mobile app shell in 0.2 exists only to validate the monorepo toolchain (V-01).

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
| OPS-2 implemented and restore tested | **Pilot** |
| S8 (V-10), R67, V-08, U-04 (real non-production Sankhya environment), U-08 (store review demo environment) | **Pilot** |

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
