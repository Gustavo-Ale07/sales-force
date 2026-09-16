# Sales Force — Claude Code Project Instructions

Internal, single-tenant commercial platform for an industrial company. It replaces **Vidya Force** (sales force integrated with Sankhya ERP) and then **Agendor** (CRM). A production business system — not a prototype, demo or generic template.

---

## 0. Project mode — DESIGN

**The project is in DESIGN / SPECIFICATION / ARCHITECTURE mode until the project owner explicitly writes `BEGIN IMPLEMENTATION`.** A commit, a push, an approved decision or a "design ready" report does not authorize implementation.

- **Allowed:** analysis, business questions, alternatives, documentation under `docs/` (including the standalone design blueprint `docs/blueprint.html`), `CLAUDE.md`, `.claude/rules/`, `.claude/agents/`, diagrams, conceptual models, visual mockups as documentation.
- **Forbidden:** scaffolding, application source code, dependency installs or package-manager runs for app setup, real schemas or migrations, endpoints, services, UI components, auth/sync/Sankhya/worker/queue/import/dashboard/AI implementation, Docker infrastructure for running the app, provisioning, deploys.
- **Workflow:** design work on branch `design/blueprint`. Per approved decision batch: update documents → consistency validation → HTML validation (when the blueprint changes) → inspect diff → one focused commit → push to `origin/design/blueprint` (GOV-1).

Current implementation phase once authorized: **Phase 0 — Foundation** (`docs/roadmap.md`).

---

## 1. Documents and precedence

| Document | Responsibility |
|---|---|
| `docs/decisions.md` | Decision register: statuses, rounds, rationale, open items (`U-xx`, `Rxx`), validations (`V-xx`) |
| `docs/project-spec.md` | Functional requirements (`RF-*`). Draft until Specification v1.0 (GOV-1) |
| `docs/architecture.md` | Structure, boundaries, dependency rules, ownership, topology (mostly PROPOSED — see its status table) |
| `docs/security-model.md` | Authentication, devices, authorization, data exposure, processors, accepted risks |
| `docs/sync-protocol.md` | Offline synchronization protocol (per-section status) |
| `docs/sankhya-spike.md` | Sankhya facts, spike questions and validation results |
| `docs/roadmap.md` | Design rounds status, phases, Phase 0 work packages, gates, open scope questions |
| `docs/spec-review.md` | Review record only — its recommendations bind only when APPROVED in `decisions.md` |
| `docs/blueprint.html` | Visual product blueprint (design documentation, not application code) |
| `.claude/rules/*.md` | Working rules; most load automatically for matching paths |

**Precedence when instructions conflict:**
1. The project owner's explicit instruction for the current task.
2. APPROVED entries in `docs/decisions.md`.
3. `docs/project-spec.md`.
4. Architecture, security and sync documents.
5. `.claude/rules/*`.
6. Conventions already established in the code.

If two documents contradict each other, **do not choose silently**. Report the documents, the exact contradiction, the impact and a recommended resolution. Wait for a decision when it affects architecture, business rules, security, data integrity or user-visible behavior.

**Status model:** APPROVED · PROPOSED · NEEDS VALIDATION · UNDECIDED · REJECTED. Only APPROVED binds. Never promote PROPOSED silently, never present NEEDS VALIDATION as fact, never turn a recommendation into a rule without owner approval.

---

## 2. Hard invariants — APPROVED

Breaking any of these requires a new approved decision.

1. **Ownership (P-02).** Sankhya is the system of record for ERP data; Sales Force owns CRM-specific data.
2. **Sankhya boundary (P-03).** Web and mobile never communicate with Sankhya. Sankhya-specific implementation is isolated behind `packages/sankhya` / `SankhyaGateway`.
3. **Modular monolith (P-04).** No microservices unless explicitly approved later.
4. **Pure domain (P-05).** `packages/domain` holds portable, deterministic business rules with no infrastructure dependencies, portable between server and mobile runtime where required.
5. **Strict TypeScript (P-06).**
6. **Server-side authorization (P-21).** Enforced on the server; synchronization, AI tools and dashboards use the same scope rules. Hidden UI and local filters are never authorization.
7. **Representatives (P-20).** External representatives never receive product cost, margin or general export capability. Restricted information is not sent to their client at all — hiding a field in the UI is insufficient.
8. **Offline-first mobile (P-07). Offline commands (P-08):** idempotent; the server revalidates authorization, price, discount authority, credit, state and invariants of every command.
9. **Price integrity (P-09).** Prices come from Sankhya-derived data; a changed price during offline operation uses the `revisao_preco` flow; prices are never silently replaced.
10. **Discount authority (P-10).** Seller → manager → director limits configured in Sales Force, enforced server-side. Calculation base and routing UNDECIDED (R35, R36).
11. **Deterministic rules and AI (P-14).** Pricing, credit, permissions, totals, state transitions and idempotency are deterministic, never delegated to AI. AI runs only through backend-controlled interfaces.
12. **Environments (P-15, SNK-3).** Production and staging are isolated. Staging never connects to Sankhya production; Sankhya production is never an environment for development, CI or staging. The only exception is a **read-only diagnostic inspection during a spike**, explicitly authorized by the owner for that occasion and meeting every SNK-3 condition (no writes, minimum data, sanitized persistence, no credentials in Git, logged in `docs/sankhya-spike.md`). No production data in staging without approved sanitization. Before the pilot, real order and partner writes are validated in a non-production Sankhya environment.
13. **No duplicate Sankhya writes (SNK-4).** Custom origin-id field checked before any retry; native idempotency in addition if confirmed; no heuristic primary matching; no real order write before S0 validation.
14. **Files (P-17).** Blobs in object storage; metadata in PostgreSQL.
15. **Secrets (P-22).** Never committed, never exposed to web/mobile, never in documentation or the blueprint.
16. **Scope (P-01, P-13).** Internal, single tenant, not SaaS. Out of scope: multi-tenant/SaaS, billing, route planning, GPS check-in, field surveys, point-of-sale photos, returns/exchanges, stock queries or blocking, independent goal/commission calculation, B2B portal, unofficial WhatsApp integration.
17. **Authentication (P-11).** Email + strong password, Argon2id; no 2FA (accepted risk).
18. **Accounts (P-18, P-19).** A new customer passes backoffice approval before becoming a Sankhya partner. One account table across `lead → prospect → cliente_pendente → cliente` (alternates `rejeitado`, `inativo`).
19. **Schema evolution (P-16).** Expand → migrate → contract, mandatory from the first environment with real data and whenever a released mobile version depends on the old shape.
20. **Infrastructure (OPS-6, OPS-1, DATA-1, STACK-7, OPS-2).**
    - Isolated production and staging (separate failure domains and credentials); managed PostgreSQL with PITR preferred, never a public unrestricted endpoint; VPS/VM compute allowed.
    - PostgreSQL ≥ 16, same major in every environment, 18 preferred if cleanly supported; UUIDv7 generated outside PostgreSQL.
    - Managed S3-compatible private storage, separate buckets/credentials per environment; no MinIO Community.
    - Production RPO ≤ 15 min, RTO ≤ 4 h; a backup counts only once a restore has been tested.
    - Budget target R$ 300–600/month for production (> R$ 600 justify, > R$ 800 back to the owner) — never at the cost of backups, security, isolation, integrity or recoverability. Brazil strongly preferred for production data. Small internal team: minimal components, documented runbooks.
    - Providers and final PostgreSQL major: NEEDS VALIDATION (V-04, V-05, V-15).

---

## 3. Design direction — PROPOSED, not binding

These appear throughout `docs/` and `.claude/` as the working proposal. They are **not approved** until their decision round closes (`docs/decisions.md` §0). Do not cite them as rules.

- **Cost/margin for all mobile users and AI:** never on mobile for any user, never to AI (P-23).
- **Deployment details:** Docker Compose + Caddy on the VPS/VM hosts (with Round 7, OPS-3).
- **Server (Round 3):** NestJS `apps/server` with `api` and `worker`; pg-boss (no Redis/BullMQ); Drizzle migrations.
- **Access (Round 4):** opaque sessions, device approval, representatives mobile-only, per-permission scope with one central policy module.
- **Sync and data (Round 5):** custom protocol, `xid8` commit-safe watermark, scope events and bundles, UUIDv7, `numeric(18,6)` unit prices / `numeric(14,2)` totals.
- **Clients (Round 6):** Vite + React SPA (not Next.js), Zod → OpenAPI clients, Expo development builds, encrypted SQLite, pnpm + Turborepo.
- **Sankhya and operations (Round 7):** outbox-only writes from the worker, OAuth 2.0 + `X-Token`, GitHub Actions → GHCR → SSH deploy, Sentry with scrubbing, SMTP email.

---

## 4. Phase discipline

- No implementation before `BEGIN IMPLEMENTATION` (§0).
- Once authorized: implement only what `docs/roadmap.md` places in the current phase; do not pull Phase 1–4 functionality forward without approval.
- Apply YAGNI within the phase, but never violate approved boundaries in its name.

---

## 5. Stop conditions

Stop and ask the project owner when:
- an approved decision would have to change;
- a business rule is undocumented, PROPOSED or UNDECIDED (never invent it — register it as open);
- a Sankhya detail is not validated in `docs/sankhya-spike.md`;
- a destructive database operation or data-loss migration is needed;
- production credentials, production data or a production deployment would be involved;
- existing user work would be overwritten;
- a security control would be weakened;
- scope would materially expand;
- two authoritative documents contradict each other;
- work would cross from design into implementation.

---

## 6. How to work

### Before and during work

- **Before substantial work, summarize:** what will change; affected documents or modules; risks; whether a decision is involved.
- Keep the plan current during long tasks.
- Read only the documents relevant to the task (§1). Rules for the paths you touch load automatically; also read the rules an agent file lists.
- Once implementation is authorized: use the repository's real scripts (inspect `package.json`, workspace and Turborepo configuration first; never invent commands). Dependencies: confirm the need, prefer approved libraries, check maintenance and security, avoid overlap. Never add a framework casually.

### Decisions and documentation

- **Decision rounds:** present decisions and alternatives → wait for the owner → repeat back the owner's decisions → detect contradictions → on explicit approval, record in `docs/decisions.md` and update the affected documents. Never hide decisions in code or documentation prose.
- **Keep documentation true:** architecture → `architecture.md`; sync → `sync-protocol.md`; security → `security-model.md`; Sankhya discoveries → `sankhya-spike.md`; scope/phase → `roadmap.md`. Never change requirements to fit a shortcut.
- **Traceability:** link design material to `RF-*` and decision IDs where practical.

### Quality and integrity

- **Errors:** actionable for users, detailed in logs. Integration errors distinguish provider unavailable, authentication, validation, rate limit, temporary and permanent rejection. Never retry permanent failures blindly.
- **Priority when uncertain:** correctness → data integrity → security → maintainability → simplicity → performance → speed.
- **Audit** sensitive actions: logins and failures, lockouts, user/permission/device changes, approvals, discount-limit changes, imports, exports, automation changes, administrative actions.

### Definition of done

- **Design batch:** owner approval recorded; documents consistent; no PROPOSED/NEEDS VALIDATION item presented as fact; no secrets; no implementation code; blueprint validated when changed; diff inspected; committed and pushed to `design/blueprint`.
- **Implementation task (after authorization):** requested behavior implemented; boundaries respected; business rules enforced; security review when `security-model.md` §15 triggers; tests, typecheck, lint and build pass (real output); user-visible behavior verified; docs updated; work reviewed.

Never say "done", "fixed" or "working" without verification. **Final report:** what changed, important files, validation performed, unresolved risks or open items. No celebratory summaries.

---

## 7. Git safety

- Commit and push only when the project owner authorizes it. During the design phase, commits and pushes of approved documentation/configuration batches to `design/blueprint` are authorized by the workflow in §0. A skill or third-party workflow instruction to commit does **not** count as permission.
- Do not work directly on `main` during the design phase.
- **Never, without explicit approval:** force push; rewrite published history; delete remote branches; hard reset or discard changes; merge into `main` or other protected branches; deploy.
- Before editing a file with uncommitted user changes, inspect the diff and preserve unrelated work.
- **Commits:** one logical batch per commit, meaningful message; no secrets, no debug artifacts, no raw Sankhya captures.
- `.claude/settings.json` denies or asks for risky commands. It is a safety net; never work around it.

---

## 8. Agents

Agents live in `.claude/agents/`. When delegating, pass: objective; relevant file paths and documents; constraints; expected output. Use parallel agents only for independent work that does not edit the same files. During design mode, agents produce analysis and documentation only.

| Agent | Implements / owns | Decides | Reviews |
|---|---|---|---|
| `architect` | `docs/architecture.md`, decision proposals | Nothing alone — proposes; owner approves | Plans, cross-cutting design |
| `backend-engineer` | `apps/server`, `packages/contracts`, `packages/domain`, `packages/sankhya`, Sankhya spikes; root workspace config, `packages/config`, CI workflows, Docker/Compose/Caddy/deploy | Implementation details within decisions | — |
| `database-engineer` | `packages/db`, migrations, triggers, indexes, backup tooling and restore tests | Schema details within decisions | Migration safety; mobile schema on request |
| `frontend-engineer` | `apps/web`, `packages/ui` | UI implementation details | — |
| `mobile-engineer` | `apps/mobile`, `packages/mobile-db`, client sync, spike S7 | Mobile implementation details | — |
| `qa-engineer` | Test plans, E2E suites, extra scenarios (no production code). Implementers write their own tests test-first | Test strategy per feature | Adequacy of implementer tests |
| `security-reviewer` | — (read-only) | Block/approve from a security standpoint | Changes hitting `security-model.md` §15 |
| `code-reviewer` | — (read-only) | Approve / request changes | Correctness, regressions, decision adherence, tests |

`code-reviewer` is the single project reviewer. Skills that dispatch their own reviewer prompts (`requesting-code-review`, `subagent-driven-development`) should use it.

---

## 9. Skills — project overrides

Installed skills are vendor files: do not edit them or `skills-lock.json`. Where a skill conflicts with this file, this file wins. A skill never authorizes commits, pushes, merges, branch deletion, architecture decisions or scope changes.

- **`test-driven-development`:** mandatory and exempt areas are defined in `.claude/rules/testing.md`; that list overrides the skill's "always".
- **`systematic-debugging`:** use for non-trivial bugs. Reproduce → isolate → evidence → root cause → fix → regression test → verify.
- **`brainstorming`, `writing-plans`:** use for unclear requirements and meaningful multi-file work; their specs and plans are **working notes**, not decisions, until promoted into `docs/decisions.md`; do not auto-commit them.
- **`executing-plans`, `subagent-driven-development`, `using-git-worktrees`, `finishing-a-development-branch`:** implementation skills — not used before `BEGIN IMPLEMENTATION`; merges, pushes, branch deletion and `.gitignore` commits still require explicit owner approval (§7).
- **`requesting-code-review` / `receiving-code-review`:** use for substantial work; do not accept suggestions that contradict requirements, decisions, domain rules or security.
- **`verification-before-completion`:** use for non-trivial work, including design batches.
- **`webapp-testing`:** allowed for validating `docs/blueprint.html` as documentation; not application testing.
- **`frontend-design`, `web-design-guidelines`:** usage limits in `.claude/rules/frontend.md`.
- **`grill-me`:** use only when the owner invokes it; it delegates to a `grilling` skill that is **not installed**. If it fails, run the structured requirement interview directly.
- **Third-party scripts:** before running any script bundled with a skill, read it. Never pipe remote scripts into a shell.

---

## 10. Environment notes

- Start Claude Code sessions from the **repository root**. `.claude/settings.json` loads only from the launch directory, and path-scoped rules match repository-relative paths.
- Development machine is Windows. Bash and PowerShell are both available; iOS builds run on EAS; Testcontainers needs Docker Desktop with WSL2.
- User-facing text, dates, currency and document formats follow pt-BR (spec §13).
