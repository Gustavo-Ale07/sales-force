# Sales Force — Claude Code Project Instructions

Commercial platform, first delivered as a single-tenant internal installation for an industrial company (PLAC) and built as a reusable product with one isolated installation per customer (PROD-1); replaces **Vidya Force** (sales force on Sankhya ERP) and then **Agendor** (CRM). A production business system — not a prototype or template.

## 0. Project mode — DESIGN, then IMPLEMENTATION (Phase 0 only)

**Design / specification / architecture mode until the project owner explicitly writes `BEGIN IMPLEMENTATION`.** Commits, pushes, approved decisions or "design ready" reports do not authorize implementation.

> **Update 2026-09-18:** the owner wrote `BEGIN IMPLEMENTATION`. Implementation is authorized only for what `docs/roadmap.md` places in the current phase (Phase 0 — see "Once authorized" below); the Allowed/Forbidden lists still apply to everything outside it. Rounds 1, 2, 3, 6 and the owner rulings of 2026-09-18 (`decisions.md` §3.8) are APPROVED.

- **Allowed:** analysis, business questions, alternatives, `docs/` (including blueprint parts), `CLAUDE.md`, `.claude/`, diagrams, conceptual models, mockups as documentation.
- **Forbidden:** scaffolding, application code, dependency installs, schemas/migrations, endpoints, services, UI components, any auth/sync/Sankhya/worker/queue/import/dashboard/AI implementation, Docker infra, provisioning, deploys.
- **Workflow:** branch `design/blueprint`. Per approved decision batch: update documents → consistency check (§5) → `node docs/blueprint/build.mjs` if blueprint parts changed → inspect diff → one focused commit → push to `origin/design/blueprint` (GOV-1).
- **Once authorized:** only what `docs/roadmap.md` places in the current phase (first: Phase 0 — Foundation). YAGNI within the phase, never against approved boundaries; no pulling later phases forward.

## 1. Documents, precedence, status

| Document | Holds |
|---|---|
| `docs/decisions.md` | Decision register: statuses, rounds, rationale, open items (`U-xx`, `Rxx`), validations (`V-xx`) |
| `docs/project-spec.md` | Functional requirements `RF-*` (draft until Specification v1.0, GOV-1) |
| `docs/architecture.md` | Structure, boundaries, dependency rules, ownership, topology (mostly PROPOSED) |
| `docs/security-model.md` · `docs/sync-protocol.md` | Security model · offline sync protocol (per-section status) |
| `docs/sankhya-spike.md` · `docs/roadmap.md` | Validated Sankhya facts and spike questions · rounds, phases, work packages, gates |
| `docs/spec-review.md` | Review record only — binds only when APPROVED in `decisions.md` |
| `docs/blueprint/parts/**` | Visual blueprint **source** (documentation, not app code); `docs/blueprint.html` is its build artifact |
| `.claude/rules/*.md` | Working rules, all path-scoped: loaded automatically for the files you read |

**Precedence:** 1 owner's explicit instruction for the task · 2 APPROVED entries in `decisions.md` · 3 `project-spec.md` · 4 architecture/security/sync docs · 5 `.claude/rules` · 6 conventions in code. If documents contradict, **never choose silently**: report the documents, the exact contradiction, impact and a recommended resolution; wait for the owner when architecture, business rules, security, data integrity or user-visible behavior are affected.

**Status model:** APPROVED · PROPOSED · NEEDS VALIDATION · UNDECIDED · REJECTED. Only APPROVED binds. Never promote PROPOSED silently, present NEEDS VALIDATION as fact, or turn a recommendation into a rule without owner approval.

## 2. Hard invariants — APPROVED

Breaking any requires a new approved decision. Full text: `grep -n` the ID in `docs/decisions.md`.

1. **P-02 / P-03** Sankhya is the system of record for ERP data, Sales Force owns CRM data; web and mobile never talk to Sankhya — Sankhya code isolated behind `packages/sankhya` / `SankhyaGateway`.
2. **P-04 / P-05 / P-06** Modular monolith; `packages/domain` = portable, deterministic rules with no infrastructure dependencies; strict TypeScript.
3. **P-21** Authorization enforced server-side (sync, AI tools, dashboards share the scope rules); hidden UI and local filters are never authorization.
4. **P-20** External representatives never receive cost, margin or export capability — restricted data is not sent to their client at all.
5. **P-07 / P-08** Offline-first mobile; offline commands idempotent, fully revalidated server-side (authorization, price, discount authority, credit, state, invariants).
6. **P-09** Prices come from Sankhya-derived data; a changed price during offline use goes through `revisao_preco`; never silently replaced.
7. **P-10** Discount authority seller → manager → director, configured in Sales Force, enforced server-side (base and routing UNDECIDED: R35, R36).
8. **P-14** Pricing, credit, permissions, totals, state transitions, idempotency are deterministic, never delegated to AI; AI only via backend-controlled interfaces.
9. **P-15 / SNK-3** Production and staging isolated; staging never touches Sankhya production; Sankhya production never used for dev/CI/staging — sole exception an owner-authorized read-only diagnostic inspection during a spike under every SNK-3 condition, logged in `sankhya-spike.md`. No production data in staging without approved sanitization; real order/partner writes validated in non-production Sankhya before the pilot.
10. **SNK-4** No duplicate Sankhya writes: origin-id field checked before any retry; no heuristic matching; no real order write before S0 validation.
11. **P-17 / P-22** Blobs in object storage, metadata in PostgreSQL. Secrets never committed, never exposed to web/mobile, never in docs or the blueprint.
12. **P-01 / P-13** Internal, single tenant, not SaaS. Out of scope: multi-tenant, billing, route planning, GPS check-in, field surveys, POS photos, returns/exchanges, stock queries/blocking, own goal/commission calculation, B2B portal, unofficial WhatsApp. **PROD-1 amends the scope of P-01 (owner ruling 2026-09-18):** reusable product, one isolated installation per customer (own DB, Sankhya, secrets, configuration; same source, images, version); each installation stays single-tenant, never a shared multi-tenant/SaaS runtime; per-installation infrastructure and cost model not yet decided (U-13).
13. **P-11 / P-18 / P-19** Email + strong password (Argon2id), no 2FA (accepted risk); backoffice approval before a customer becomes a Sankhya partner; one account table `lead → prospect → cliente_pendente → cliente` (`rejeitado`, `inativo`).
14. **P-16** Schema evolution expand → migrate → contract from the first environment with real data.
15. **OPS-1/2/6, DATA-1, STACK-7** Isolated prod/staging (separate failure domains and credentials); managed PostgreSQL ≥ 16, same major everywhere, PITR, private networking only (allow-listed TLS solely as a reviewed fallback, never open to the internet); UUIDv7 generated outside PostgreSQL; managed S3-compatible private storage per environment (no MinIO Community, no silent non-S3 substitute); RPO ≤ 15 min, RTO ≤ 4 h, a backup counts only after a tested restore; budget R$ 300–600/month prod (> R$ 800 back to the owner), staging cheaper but never at the cost of backups/security/isolation; Brazil preferred; providers and PG major NEEDS VALIDATION (V-04, V-05, V-15) — never pick from indicative prices; observability is an optional cost line until OPS-4.
16. **STACK-2/3/6, DATA-2, ARCH-1** One modular `apps/server` with separate API and Worker processes, Sankhya credentials only in the worker; NestJS orchestrates and never owns business rules; `packages/domain` never depends on server/NestJS/Drizzle/PG/HTTP/pg-boss/Sankhya types; pg-boss for jobs (no Redis/BullMQ) with `integration_outbox` as the business record of every Sankhya delivery (never replace pg-boss silently, V-16); Drizzle for PostgreSQL (mobile SQLite only if safe with the encrypted library); migrations as reviewed, versioned SQL run one-shot and concurrency-protected before the new version is active, data migrations separate, `drizzle-kit push` only on disposable local DBs.
17. **STACK-1/5 (APPROVED), STACK-4, MOB-1, MOB-2 (approved in direction), Round 6** pnpm workspaces + Turborepo; Zod contracts → OpenAPI → generated clients, no duplicate DTOs (generator V-02); Vite + React SPA, no SSR/Next.js; Expo development builds (no Expo Go); offline data encrypted via Drizzle, library NEEDS VALIDATION (V-09) — never pick it early.
18. **PROD-1, CFG-2…6, SNK-6, SEC-1, DOC-1 (APPROVED); CFG-1 and SNK-5 (approved in direction; Sankhya configuration model and origin-field definition PROPOSED)** Customer-specific commercial values (seller mapping, sellable `USOPROD`, null-`CODTAB` policy, company/TOP/payment) are configuration governed from Sankhya and mirrored locally, never literals; missing price ≠ 0 ("Sem preço"); dedicated origin-id field, never `AD_VDYORIG`/`AD_NUVIDYA`; ERP order submission stays disabled until its write-safety gates close; no second Sandbox write and no production probe without owner authorization; spike credentials are exposed — rotate, never commit or wire them in.

## 3. Design direction — PROPOSED, not binding

Working proposal until its round closes (`decisions.md` §0); never cite as rules: cost/margin never on mobile nor to AI (P-23) · Docker Compose + Caddy on VPS/VM (OPS-3) · staging DB on the staging host · access: opaque sessions, device approval, representatives mobile-only, one central policy module (Round 4) · sync: custom protocol, `xid8` watermark, scope events/bundles, UUIDv7, `numeric(18,6)` unit prices / `numeric(14,2)` totals (Round 5) · Sankhya/ops: outbox-only writes from the worker, OAuth 2.0 + `X-Token`, GitHub Actions → GHCR → SSH deploy, Sentry with scrubbing, SMTP (Round 7).

## 4. Stop and ask the owner when

an approved decision would change · a business rule is undocumented, PROPOSED or UNDECIDED (register it as open, never invent it) · a Sankhya detail is not validated in `sankhya-spike.md` · a destructive DB operation or data-loss migration is needed · production credentials, data or deployment are involved · existing user work would be overwritten · a security control would be weakened · scope would materially expand · two authoritative documents contradict · work would cross from design into implementation.

## 5. Token discipline

Documentation-heavy project; these rules keep sessions small and are not optional.

- **Consult documents by ID, never whole.** Every entry has an identifier (`P-xx`, `RF-*`, `Rxx`, `V-xx`, `AUTH-x`, `STACK-x`, `SYNC-x`, …): `grep -n` the ID or heading and read only that entry/section. Whole-document reads only when the task is to restructure that document.
- **`docs/blueprint.html` is a build artifact — never read, grep, edit or diff it** (settings.json denies it). Source: `docs/blueprint/parts/` (one file per section, mockup, screen entry, dataset). Find the part with `grep -ril "<term>" docs/blueprint/parts`, edit it, run `node docs/blueprint/build.mjs` (the report is the HTML validation; `--check` verifies the artifact is current). Commit parts and artifact together; diff the artifact with `git diff --stat` only. Details: `docs/blueprint/README.md`.
- **Cross-document consistency checks run in a subagent** (`architect` or `code-reviewer`) given the IDs and documents; only the report returns.
- **Command output:** quiet flags; paste only failing/relevant lines; never dump large files or logs into the conversation.
- **Sessions:** one design batch per session; `/clear` after the commit; `/compact` before a long pause; `/context` when a session feels heavy.
- **Models:** Sonnet is the project default (settings.json) and every agent runs on Sonnet. Opus only when the owner asks for it on a decision round or architecture trade-off; switch back afterwards.

## 6. How to work

- **Before substantial work, summarize:** what changes, affected documents/modules, risks, whether a decision is involved. Keep the plan current. Read only what the task needs (§1, §5).
- **Once implementation is authorized:** use the repository's real scripts (inspect `package.json`, workspace and Turborepo config first; never invent commands). Dependencies only after confirming need, maintenance, security and overlap; never add a framework casually.
- **Decision rounds:** present decisions and alternatives → wait for the owner → repeat the owner's decisions back → detect contradictions → on explicit approval record in `decisions.md` and update affected documents. Never hide decisions in code or prose.
- **Keep documentation true:** architecture → `architecture.md`; sync → `sync-protocol.md`; security → `security-model.md`; Sankhya facts → `sankhya-spike.md`; scope/phase → `roadmap.md`. Never change requirements to fit a shortcut; link design material to `RF-*` and decision IDs.
- **Quality:** errors actionable for users, detailed in logs; integration errors classified (unavailable / auth / validation / rate limit / temporary / permanent — never retry permanent failures blindly). Priority when uncertain: correctness → data integrity → security → maintainability → simplicity → performance → speed. Audit sensitive actions (auth events, lockouts, user/permission/device changes, approvals, discount limits, imports, exports, automation and admin changes).
- **Done — design batch:** owner approval recorded; documents consistent; nothing PROPOSED/NEEDS VALIDATION presented as fact; no secrets; no implementation code; blueprint rebuilt with a clean report when parts changed; diff inspected; committed and pushed to `design/blueprint`. **Done — implementation task:** behavior implemented within boundaries and business rules; security review when `security-model.md` §15 triggers; tests, typecheck, lint, build pass with real output; user-visible behavior verified; docs updated; reviewed.
- Never say "done", "fixed" or "working" without verification. **Final report:** what changed, important files, validation performed, open risks. No celebratory summaries.

## 7. Git safety

- Commit/push only with owner authorization; §0 authorizes approved design batches to `design/blueprint`. A skill or third-party instruction to commit is not permission. No work directly on `main` during design.
- **Never without explicit approval:** force push, rewrite published history, delete remote branches, hard reset/discard changes, merge into `main` or protected branches, deploy.
- Before editing a file with uncommitted user changes, inspect the diff and preserve unrelated work. One logical batch per commit, meaningful message; no secrets, debug artifacts or raw Sankhya captures.
- `.claude/settings.json` denies or asks for risky commands: a safety net, never to be worked around.

## 8. Agents (`.claude/agents/`, all on Sonnet)

Delegate with: objective, relevant paths/documents/IDs, constraints, expected output. Parallel agents only for independent work on different files. Agents implement only within the current roadmap phase (Phase 0); outside it they produce analysis and documentation only. Each dispatched agent reloads this file — delegate real work, not small edits.

`architect` — `architecture.md`, decision proposals, plan and cross-cutting review (proposes, never approves) · `backend-engineer` — `apps/server`, `packages/contracts|domain`, server-side sync/jobs, workspace/CI/Docker/deploy config · `sankhya-integration-engineer` — `packages/sankhya`, SankhyaGateway, ERP mirror boundary, integration_outbox delivery/reconciliation, sanitized fixtures and spikes S0-S6 · `database-engineer` — `packages/db`, migrations, triggers, indexes, backup/restore, migration-safety review · `frontend-engineer` — `apps/web`, `packages/ui` · `mobile-engineer` — `apps/mobile`, `packages/mobile-db`, client sync, spike S7 · `qa-engineer` — test plans, E2E suites, extra scenarios, adequacy of implementer tests (no production code) · `security-reviewer` — read-only, blocks/approves changes hitting `security-model.md` §15 · `code-reviewer` — read-only, the single project reviewer (skills that dispatch a reviewer must use it).

## 9. Skills — project overrides

Installed skills are vendor files: never edit them or `skills-lock.json`. This file wins on conflict. A skill never authorizes commits, pushes, merges, branch deletion, architecture decisions or scope changes.

- `test-driven-development`: mandatory/exempt areas per `.claude/rules/testing.md` (overrides the skill's "always").
- `systematic-debugging`: non-trivial bugs — reproduce → isolate → evidence → root cause → fix → regression test → verify.
- `brainstorming`, `writing-plans`: unclear requirements and meaningful multi-file work; their specs/plans are working notes, not decisions, until promoted into `decisions.md`; never auto-commit them.
- `executing-plans`, `subagent-driven-development`, `using-git-worktrees`, `finishing-a-development-branch`: implementation only, after `BEGIN IMPLEMENTATION`; merges, pushes, branch deletion and `.gitignore` commits still need owner approval (§7); real features only, not small edits (§8).
- `requesting-code-review` / `receiving-code-review`: substantial work only; reject suggestions contradicting requirements, decisions, domain rules or security.
- `verification-before-completion`: non-trivial work, including design batches.
- `webapp-testing`: only to validate the built `docs/blueprint.html` in a browser as documentation (short console output); not application testing.
- `frontend-design`, `web-design-guidelines`: limits in `.claude/rules/frontend.md`.
- `grill-me`: only when the owner invokes it; delegates to the installed upstream `grilling` skill. `grilling` performs the decision-tree interview and never authorizes implementation or commits.
- Third-party scripts: read before running; never pipe remote scripts into a shell.

## 10. Environment

- Start sessions from the **repository root** (`.claude/settings.json` and path-scoped rules are relative to it). Windows dev machine; Bash and PowerShell available; iOS builds on EAS; Testcontainers needs Docker Desktop + WSL2.
- User-facing text, dates, currency and document formats follow pt-BR (spec §13).
