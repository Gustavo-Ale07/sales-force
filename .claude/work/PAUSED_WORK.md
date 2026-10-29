# STATUS

PAUSED

Recovered and re-written on 2026-09-21 from the real repository state (git, `.claude/work`, `.claude/agents`, docs, E2E artifacts). Nothing was implemented, fixed, committed, pushed or discarded while producing this file. It replaces the previous checkpoint of the same name.

`.claude/CLAUDE.MD` (untracked, not created by this session) says: read `.claude/work/CURRENT.md`, and resume only a task with `STATUS: ACTIVE`. `CURRENT.MD`, `SALES_FORCE_AUDIT.md`, `SALES_FORCE_PLAN.md`, `SALES_FORCE_PROGRESS.md` in this folder are all 0 bytes (not written by this session), so there is no ACTIVE task registered there. This file is the only checkpoint and is PAUSED: do not auto-resume.

# Tarefa recuperada

**Sales Force — Phase 0 / Foundation plus the first functional slice**, authorized by the owner's `BEGIN IMPLEMENTATION` of 2026-09-21 (recorded in `docs/roadmap.md`, commit 66ac512). Goal: a real, locally runnable foundation of a Sankhya-integrated, reusable (single-tenant per installation, no PLAC hardcode) Sales Force: Web + API + Worker, PostgreSQL + migrations, env validation, auth and initial users, installation-configuration layer, Sankhya adapter/OAuth2 prepared through env vars (works without real credentials), health checks, structured logging, standard errors, mirror-sync structure, queue/job base, essential tests, and a working frontend (Login, Dashboard, Carteira, Cliente, Catálogo, Novo Pedido, Rascunhos) connected front → API → DB. Hard limits: no real Sankhya write, no ERP order submission (only after Spike S3), no credentials in code/docs/commits, no production use.

The task in flight at the pause was the last item of that slice: **Playwright E2E for the critical web flows**, written by a `qa-engineer` subagent, which was on its "second run for flakiness, then cleanup checks" when it was stopped. That was not the whole task: the commits below show the whole slice.

# Branch

`feat/phase-0-foundation` (upstream `origin/feat/phase-0-foundation`; 12 commits ahead, 0 behind; nothing pushed by this session). HEAD `823eefa`.

# Estado encontrado

- `git status`: 5 modified tracked files (E2E-related), untracked `.claude/CLAUDE.MD`, `.claude/work/`, `apps/web/e2e/`. Nothing staged, no stash. Last commit is clean and complete.
- No dev process is running: ports 3000, 3001, 5173, 55498, 3100, 5273 are free. Docker: only `salesforce-dev-postgres-1` (postgres:17, 127.0.0.1:55432, healthy, data only, DB `salesforce` with 3 migrations, mirror synced, 4 demo accounts). `db-plac` exists in state "Created" (not running, unrelated, never touched).
- Subagents: only `a9814ba3e7bb640e6` (qa-engineer) exists, state killed. No other agent is running.
- `.claude/agents/`: architect, backend-engineer, code-reviewer, database-engineer, frontend-engineer, mobile-engineer, qa-engineer, sankhya-integration-engineer, security-reviewer (all Sonnet; definitions untouched).
- No TODO/FIXME markers in `apps/`; no QA or audit report file in the repository other than the Playwright artifacts below.

# Concluído

Committed on `feat/phase-0-foundation` on top of b12c5af ("Phase 0 foundation checkpoint": domain, db, contracts, sankhya gateway fake+real with OAuth2/X-Token from env, ui, web scaffold):

| Commit | Content |
|---|---|
| 66ac512 | docs: roadmap records the owner instruction |
| 4a89cb6 | server foundation: env validation, pino logging + correlation, standard errors, health/ready, config layer, pg-boss base |
| b61ea57 | web: real auth client and the seven screens over the typed API client |
| b87e7ad | auth: Argon2id (hash-wasm), opaque sessions, CSRF defence, lockout/throttle in PostgreSQL, audit, central policy + default-deny guard, seed/account CLIs, migration 0001 |
| fd06201, e6e2305 | Docker: Dockerfiles, nginx, full dev compose (postgres, migrate one-shot, seed, api, worker, web), README |
| 4739a13 | worker mirror sync (six entities), hash diff, soft deactivation, sync_state, `sync.mirror.*` queues, `sync:once`; read-only |
| 698b335 | migration 0002 `sales_order.client_request_hash` (expand-only) |
| e68423f | scoped read endpoints (customers, sellers, catalog with server pricing, dashboard) and order drafts with idempotency and `expectedVersion`; `submitOrder` always 409 `erp_submission_disabled` |
| f74354a, 2a97da9 | security hardening (login DoS limits, atomic counters, sampled audit, TRUST_PROXY, loopback guard, cookies, `/ready`, timeouts, log masking, operator attribution, order scope re-check on the locked row, cron regex, `SEED_DEV_PASSWORD` required in compose) |
| 823eefa | docs: `docs/sankhya-spike.md` §9.43 (mirror sync assumptions and open questions) |

Security reviews done: auth stage and stages 3A/3B/Docker — both APPROVE WITH CONDITIONS, conditions addressed in f74354a/2a97da9. The hardening commits themselves were NOT re-reviewed.

# Em andamento

**Web E2E (Playwright, Chromium) — written, uncommitted, not verified by me.**
- Files: untracked `apps/web/e2e/` (`playwright.config.ts`, `vite.e2e.config.ts`, `global-setup.ts`, `support/{app,env,stack}.ts`, `auth|portfolio|catalog|orders|scope|submit|a11y.e2e.ts`, `README.md`; `playwright-report/` and `test-results/` are generated and git-ignored). Modified: `apps/web/package.json` (scripts `e2e`, `e2e:install`; `@playwright/test` pinned `1.63.0`, was `^1.63.0`), `apps/web/tsconfig.json` (includes `e2e`), `apps/web/eslint.config.js` (ignores report dirs), root `package.json` (script `e2e`), `pnpm-lock.yaml` (specifier pin only).
- Design (from its README): the suite starts its own throwaway stack (`sf-e2e-postgres-55498`, API 127.0.0.1:3100, Vite 127.0.0.1:5273; real `db:migrate`, `db:queue:install`, `db:seed`, one `sync:once` with the fake gateway), random passwords not written to disk, refuses the developer ports, tears everything down. Tests serial, no retries.
- Declared: 37 tests in 7 spec files (scenarios 1–6 of the brief plus an accessibility smoke), pt-BR.
- Missing: review of the E2E code; a verified run; second (flakiness) run; confirmation that root lint/typecheck/build/test stay green with `e2e` added to the web tsconfig/eslint; commit (needs owner authorization); the agent's list of product bugs/UX gaps (its report never arrived).
- Risks: never re-run by me; lockfile change must remain frozen-lockfile consistent; Chromium must be downloaded once (`e2e:install`); requires Docker Desktop.

Not started (no partial code): registering open owner decisions/contract gaps in `docs/decisions.md`/`roadmap.md`; security re-review of the hardening commits; route-level code splitting of the 620 kB web chunk; password reset (needs V-06); user/team/role admin endpoints.

# Arquivos alterados

Compared with HEAD 823eefa:
- **Modificados (tracked, uncommitted):** `apps/web/eslint.config.js`, `apps/web/package.json`, `apps/web/tsconfig.json`, `package.json`, `pnpm-lock.yaml` (8 insertions, 5 deletions in total).
- **Novos (committed):** everything in the 12 commits above.
- **Removidos:** none uncommitted. Earlier in the session the Docker agent's worktree `.claude/worktrees/agent-ac58d8410ac03cbf4` and local branch `worktree-agent-ac58d8410ac03cbf4` were removed after its two commits were cherry-picked.
- **Não rastreados:** `apps/web/e2e/`, `.claude/CLAUDE.MD` (not mine), `.claude/work/` (four empty pre-existing files plus this file).

# Decisões encontradas

Technical/functional decisions taken during the session (owner-approved register entries are not among them; they rest on PROPOSED rounds 4/5/7 or on assumptions to confirm):
- **Password hashing:** `hash-wasm` Argon2id behind a `PasswordHasher` port (`@node-rs/argon2` native binding failed; `crypto.argon2` needs Node ≥ 24.7, repo targets Node 22); concurrency cap `LOGIN_MAX_CONCURRENT_HASHES` (4).
- **Sessions:** opaque SHA-256-hashed tokens, HttpOnly SameSite=Lax cookie `sf_session` (Path=/api/v1; Secure except `NODE_ENV=development`), CSRF via Origin/Sec-Fetch-Site + `ALLOWED_ORIGINS`; login without `Origin` accepted (non-browser clients).
- **Auth mode:** only `dev`, refused with `NODE_ENV=production` (no production start yet); `ALLOW_DEV_AUTH=1` required; `NODE_ENV` has no default; `TRUST_PROXY` explicit, required in production.
- **Lockout:** progressive with 24 h escalation is my assumption (RF-IAM-2 UNDECIDED); global failed-login budget 300/min returns 429 to everyone while exceeded.
- **Authorization (pending R35/R36):** manager/admin see all customers/orders and may create/replace/discard any seller's drafts; sellers only their own portfolio; order visibility by `sales_order.seller_code` snapshot; identical 404 for missing vs out-of-scope; a `clientRequestId` replayed by another account → 409 `idempotency_conflict`.
- **Orders:** client never sends price/totals (strict schema); prices/totals only from `packages/domain`; "Sem preço" is `state:'none'`/`unitPrice:null`, never 0; `submitOrder` inert (audit only, no outbox, no gateway).
- **Mirror/Sankhya:** full snapshot + hash diff only, soft deactivation only after a complete read, empty snapshot refused; default crons PROPOSED until S0.2; live mode requires explicit `SYNC_MIRROR_ENABLED`; missing live reads recorded as `not_implemented` (readiness degraded); `blocked_raw` read as blocked when `S`/`TRUE`/`1` (S4 NEEDS VALIDATION); product groups derived as `Grupo {code}`; dashboard credit/positivation `null`; configuration mirror not implemented (CFG-1 PROPOSED).
- **Infrastructure:** queues installed by a separate one-shot `pnpm db:queue:install` (DATA-2); worker heartbeat kept as reserved `sync_state` row `worker.heartbeat`; `SANKHYA_*` read only by the Worker; API image defaults to `NODE_ENV=production`, dev auth only enabled by compose; seed runs with `network_mode: service:postgres` to keep the loopback guard; images pinned by tag, not digest; no CSP/HSTS yet (OPS-3).
- **Lockfile:** shared `pnpm-lock.yaml` hunks split per commit (`git apply --cached --recount`) so each commit is frozen-lockfile consistent.
- **Workflow:** every `git commit` of this session was a logical commit under the owner's instruction; `.env` writes were denied by settings and not worked around (env passed inline through a scratchpad script).

# Testes

Evidence-based; nothing below is inferred.
- **Executados e aprovados (committed tree, before the pause, my own root runs):** `pnpm -r --if-present run lint`, `typecheck`, `build` clean; `test`: apps/server 344, apps/web 141, packages/domain 188, sankhya 139, contracts 59, db 31, ui 21 — all passed. `pnpm install --frozen-lockfile --offline` was confirmed at b87e7ad only.
- **Falhando/instável:** `apps/server/test/integration/auth.test.ts` "treats a repeated session cookie as no cookie at all" failed once with `login failed with 500` in one parallel root `pnpm -r test`; the 3A agent saw a similar one-off at `auth.test.ts:471`. Not reproduced in 3 isolated + 6 full runs afterwards. Root cause UNKNOWN. The test helper now prints the response body in that message (committed).
- **E2E:** `apps/web/e2e/test-results/.last-run.json` (14:05) says `"status": "passed"`, `"failedTests": []`, i.e. the last completed Playwright run passed. This is the only evidence; pass counts and whether it was the first or second run are not recoverable, and I did not re-run it. Treat as **unverified/partial**. The follow-up "second run for flakiness" was **INTERRUPTED (INCOMPLETO)**.
- **Interrompidos:** the E2E flakiness run (above).
- **Pendentes:** verified E2E run twice; root lint/typecheck/build/test with `e2e` in web tsconfig/eslint; Docker stack with the hardened compose in the default project; visual browser check by the owner; anything against a real Sankhya (never run, no credentials).

# QA / Auditoria

- **qa-engineer `a9814ba3e7bb640e6`** was writing/running the Playwright suite (brief: login/logout and wrong password; seller portfolio and customer detail; catalog search, "Sem preço" never R$ 0,00, no cost/margin; new order → draft → Rascunhos → edit → discard; submit ends in "envio ao ERP desabilitado" and no order becomes submitted; manager vs seller scope and IDOR by URL; accessibility smoke by roles, not axe). Recoverable state: the spec files above (37 tests), a passed `.last-run.json`, and its last message "Second run for flakiness, then cleanup checks." Its final report (product bugs/UX gaps found) was lost when it was stopped.
- Prior audits (in the conversation, not stored as files): `security-reviewer` on b87e7ad (HIGH login DoS; MEDIUMs/LOWs — addressed) and on 3A/3B/Docker (M1 seed password, L1 cron regex, L3.1 order-scope race, L4 log details, L6 nginx headers — addressed; L2/L5/I1 accepted/noted). Contract gaps and owner questions are listed below.
- No QA/audit file exists in the repository (`SALES_FORCE_AUDIT.md` is empty).

# Problemas e decisões pendentes

Owner decisions (none decided by me):
1. Production auth mode (API cannot start with `NODE_ENV=production`).
2. External-representative role (absent from contracts/schema/domain; gates any cost/margin/sync endpoint; P-20).
3. Account lockout policy (RF-IAM-2 UNDECIDED) and the numeric defaults; hash-wasm on the event loop for Phase 0.
4. `ALLOW_REMOTE_DB` override for seed/CLIs.
5. Global login budget trade-off (300 failed checks/min → 429 for everyone).
6. Manager/admin see-all and draft rights on any seller's orders (R35/R36); login accepted without `Origin`.
7. Authorization to push the 12 local commits and to commit the E2E work.

Contract gaps: no `locked`/`saturated` login outcome (429 `rate_limited` + Retry-After); CSRF mechanism not in contract; `ApiError` has no correlation-id field; `ConfigurationSummary` has no installation name; `DraftIssueCode` missing in OpenAPI; `AuthMode` only `dev`; `API_BASE_PATH` duplicated in web; mirror `unit` nullable vs contract string; `ReadyResponse.gatewayMode` lacks "unknown"; no discount/credit/payment fields; `demoMetrics` not implemented.

Other: `deploy/.env` now needs `SEED_DEV_PASSWORD` (compose refuses every command, even `down`, without it); TRUST_PROXY=1 with the API port published on loopback allows local XFF spoofing (dev only); production edge (TLS, CSP, HSTS, unpublished API port) belongs to OPS-3; web bundle 620 kB; password reset needs V-06; everything in `docs/sankhya-spike.md` §9.42/§9.43 is NEEDS VALIDATION; live sync stays off until S0.2 limits are measured; spike credentials are exposed (SEC-1) and must never be wired in; the unexplained login 500 flake; the scratchpad `devenv.sh` used to start the dev stack lives outside the repo and may disappear.

# Próximo passo exato

From `C:\Dev\sales-force`, branch `feat/phase-0-foundation`:

1. `git status` and `git log --oneline -13`; expect HEAD 823eefa plus the uncommitted E2E files above. Do not read whole docs (CLAUDE.md §5).
2. Read the E2E code before running it: `apps/web/e2e/playwright.config.ts`, `vite.e2e.config.ts`, `global-setup.ts`, `support/stack.ts`, `support/env.ts`; confirm it refuses the developer ports, writes no `.env` and no password to disk, and touches only its own container.
3. Start Docker Desktop. Do not touch `salesforce-dev-postgres-1` or `db-plac`. Run `pnpm --filter @salesforce/web run e2e:install` (Chromium download; ask the owner if blocked), then `pnpm e2e` twice; record real pass/fail counts. Any failure: reproduce, find the root cause (systematic-debugging), fix test code only or report a product bug with file:line.
4. Run root `pnpm -r --if-present run lint`, `typecheck`, `build`, `test` and `pnpm install --frozen-lockfile --offline`; expect the unit counts above.
5. With owner authorization, commit as `test(web): Playwright E2E for the critical flows` (lockfile diff limited to the Playwright pin). Push only if the owner authorizes.
6. Dispatch `security-reviewer` on f74354a and 2a97da9 (hash limiter, global login budget, sampled audit, coarse `/ready`, CLI loopback guard) and on `apps/web/e2e/support/stack.ts`.
7. Investigate the login 500 flake: run the full server suite repeatedly under CPU load; the failure message now includes the response body.
8. Register the owner decisions and contract gaps above in `docs/decisions.md` (open items) / `docs/roadmap.md`, then commit as a docs batch. Ask the owner the pending decisions before any production-mode, external-representative or lockout work.
9. To view the system again: recreate env vars (`NODE_ENV=development`, `DATABASE_URL` to 127.0.0.1:55432, `AUTH_MODE=dev`, `ALLOW_DEV_AUTH=1`, `SANKHYA_MODE=fake`, a throwaway `SEED_DEV_PASSWORD`), ensure `salesforce-dev-postgres-1` is up, then `pnpm db:migrate`, `pnpm db:queue:install`, `pnpm dev:api`, `pnpm dev:worker`, `pnpm dev:web`. Frontend http://localhost:5173, API http://127.0.0.1:3000/api/v1 (`/health`, `/ready`), worker health http://127.0.0.1:3001/health; demo logins `admin|gerente|vendedor1|vendedor2@demo.salesforce.local` with the throwaway password used at seed time.
10. Only after the above, continue the backlog: route-level code splitting, password reset (after V-06), admin endpoints, and any phase work that `docs/roadmap.md` places in Phase 0.
