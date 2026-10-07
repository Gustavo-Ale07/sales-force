# VERIFIER_DESIGN (working note, not a decision, do not commit) — 2026-10-01

Design only. **No real adapter is implemented, and none may be implemented while BLOCKER-SNK-CREDENTIALS exists** (Sankhya credentials reach the container empty; the real login mechanism is unproven, `apps/server/src/iam/external-identity.ts`). Only the `ExternalIdentityVerifier` port and the `loginExternal` flow up to the Sankhya boundary exist, disabled (503). Everything below is PROPOSED / NEEDS VALIDATION. Relevant: P-02, P-03, P-11, P-21, STACK-2, SNK-3, SNK-6, SEC-1; Sankhya facts in `docs/sankhya-spike.md` (TSIUSU.CODVEND -> TGFVEN.CODVEND must be re-checked there before use).

## 1. Purpose

Let a Sankhya user authenticate to Sales Force with Sankhya credentials without Sales Force ever holding a copy of the Sankhya password, and obtain a validated identity: `CODUSU`, `CODVEND` (from `TSIUSU.CODVEND`, resolved to `TGFVEN.CODVEND`), plus active/blocked state. Web and mobile never talk to Sankhya (P-03); they talk to the Force API only.

## 2. Flow

```text
client --(login, password over HTTPS)--> Force API --(internal call)--> Verifier --(Sankhya login/query)--> Sankhya
                                          |  <-- validated identity or refusal <--|
                                          v
                                   Force session (opaque, own policy P-21)
```

1. API applies throttling/lockout first (per account and per source) and only then calls the verifier.
2. API sends `{login, password}` to the verifier over the internal network, once, in the request body (never URL/headers/log context).
3. Verifier authenticates against Sankhya, reads the user's `CODUSU`, `CODVEND`, active flag, resolves `TGFVEN.CODVEND` (exists, active), and returns only the identity. The password is discarded immediately (no persistence, no cache, no log, no error echo, no metrics label, no crash dump; best-effort zeroing of buffers; request body logging disabled at framework level).
4. API maps the identity to the Force account by the stored link (CODUSU), applies Force authorization/scope (P-21; Sankhya identity never grants Force permissions), creates a Force session. Sankhya tokens obtained by the verifier are not returned to the API or client and are dropped after the check unless the owner approves a use case.

## 3. Properties required

| Property | Requirement |
|---|---|
| Network | Not public: no published port, internal network shared only with the API; refuses any other caller; outbound only to the Sankhya host allow-list |
| Caller authentication | API-to-verifier mutual authentication (service token or mTLS); verifier rejects unauthenticated calls. Mechanism NEEDS VALIDATION |
| Credentials | Only what verification needs: the Sankhya application credentials (`SANKHYA_*` subset) required for login/identity queries. No DB credentials, no object storage, no session secrets. Prefer a Sankhya account with read-only, minimal permissions (read-only support NEEDS VALIDATION, S0.7/V-11) |
| Data in | login + password at authentication time only |
| Data out | `{codusu, codvend, active, verifiedAt}` or a classified refusal. Never cost, margin or other ERP data (P-20) |
| Timeout | Hard end-to-end deadline (proposed 5 s, NEEDS VALIDATION against Sankhya latency) on the verifier call and on the API side; no retry of a password submission on timeout |
| Fail closed | Timeout, unreachable, 5xx, malformed response, missing CODVEND for a seller, inactive/blocked user, any exception: login refused. No fallback to local password, no cached "last good" acceptance, no dev mode |
| Errors | Classified: invalid credentials / user inactive / Sankhya unavailable / auth-config error / rate limited / identity inconsistent. The client sees a generic message for credential failures (no user enumeration); detail only in logs without secrets |
| Throttling | Stays in the API (P-11 lockout, audit of auth events). The verifier adds only a coarse global circuit breaker/concurrency cap to protect Sankhya from lockouts of the service account |
| Audit | API audits every attempt/outcome (without password); the verifier logs correlation id, outcome class, latency |
| Environment | One verifier per environment, pointed at that environment's Sankhya (SNK-3): staging never at production |
| Logging | Allow-list structured logging; request body never logged; error serializers strip bodies; tests assert the password never appears in logs/errors |

## 4. Identity and CODVEND rules

- The Force account stores the Sankhya link (CODUSU) set by an admin/approved flow, not taken from the login form.
- CODVEND mismatch **fails closed**: if the verified CODVEND differs from the CODVEND recorded in Force (seller mapping, CFG), is null for a seller role, does not resolve in `TGFVEN`, or `TGFVEN` is inactive, login is refused, a security audit event is written, and an admin must reconcile. Never auto-update the mapping from the login response.
- Seller mapping stays configuration governed from Sankhya and mirrored locally (CFG decisions), no literals.

## 5. Reconciliation with STACK-2 (flag for owner)

STACK-2 (APPROVED): Sankhya credentials exist only in the worker runtime "unless a later explicitly approved use case requires API-side access". The design puts the credentials in a dedicated verifier, which is neither API nor Worker. Options:

### 5.1 Technical comparison — RECOMMENDATION (PROPOSED), not a decision; the owner decides

Labels in this subsection (A/B/C) supersede the earlier labelling of this note: A = API direct, B = worker synchronous, C = dedicated verifier.

| Criterion | A. API talks to Sankhya directly | B. Worker verifies synchronously (internal RPC; never via pg-boss, which persists payloads) | C. Dedicated internal verifier (third entry point of `apps/server`, own container) |
|---|---|---|---|
| Secret surface | Worst: `SANKHYA_*` in the internet-facing process; API compromise exposes ERP credentials (defeats STACK-2 intent) | Medium: no new holder, but the worker holds the full set (sync/outbox credentials) and now also handles user passwords and an interactive listener | Smallest: only the minimal identity subset, no DB/storage/session secrets; API holds none; worker unchanged |
| Latency | Lowest (one hop) | One extra internal hop; shares CPU/event loop with sync jobs, so a heavy mirror run can delay logins | One extra internal hop, dedicated capacity, predictable; Sankhya latency dominates either way (5 s deadline NEEDS VALIDATION) |
| Availability | Login depends only on API + Sankhya | Login coupled to worker health/restarts/long jobs; a stuck worker blocks logins | Independent failure domain; verifier down = new logins fail closed, existing sessions and sync unaffected |
| Operational simplicity | Simplest | No new container, but an RPC endpoint and caller auth must still be built in the worker | One more container, health check, caller auth and secret subset; modest cost in Compose |
| Isolation | None between web-facing code and ERP credentials | Password handling and delivery credentials share a runtime | Strong: network-internal, outbound allow-listed to Sankhya only, password never touches the worker or DB |
| STACK-2 | Needs the "later approved use case" clause: amendment | Fits the letter (credentials only in worker) | Third holder of credentials: amendment needed |

RECOMMENDATION (PROPOSED): C. It is the only option that keeps both the API and the delivery-capable worker away from user passwords and keeps the Sankhya credential subset minimal. B is the acceptable fallback if the owner wants zero new containers (accept the coupling and wider blast radius). A is not recommended. **If A or C is chosen, a STACK-2 amendment (new decision entry, owner approval) is required** before any implementation; B needs none but does need the security review (`security-model.md` section 15). Nothing is implemented while BLOCKER-SNK-CREDENTIALS exists. Reversibility: moderate (a process boundary).

Draft amendment for option C: Sankhya credentials exist only in the worker and in the identity verifier; the verifier holds the minimal subset, is not publicly reachable, and the API holds none. The amendment is needed because STACK-2 is approved (CLAUDE.md section 4). Ready-to-approve text (draft only, not approved):

> **STACK-2 amendment (proposal):** a third runtime entry point, Identity Verifier, may exist in `apps/server`, on an internal-only network, holding only the Sankhya credentials needed to verify a user's identity. It receives credentials only during authentication, never persists or logs them, fails closed, and returns a validated identity. The API still holds no Sankhya credentials. Reversibility: moderate (a process boundary).

Also check: ARCH-1 / `architecture.md` section 4.1 dependency rules and `security-model.md` (new trust boundary, password in transit between two internal services; section 15 triggers a security review).

## 6. Revocation and re-verification without aggressive polling

Goal: a user inactivated/blocked in Sankhya loses Force access in bounded time without hammering Sankhya.

1. **Event-driven by mirror (preferred, uses existing worker, read-only):** the periodic read-only mirror of users/sellers (already low frequency) refreshes `active`/blocked state per CODUSU and CODVEND; a change to inactive marks the Force account `inativo`/suspended, revokes sessions and devices, and audits. Cadence NEEDS VALIDATION (e.g., 15–60 min; a sync, not per-request).
2. **Bounded session lifetime:** Force sessions have a maximum age after which the user must pass the verifier again (sensitive-action re-auth too: approvals, discount limits, exports). Value is an OWNER decision (security vs offline-first field use, P-07: offline mobile cannot require Sankhya reachability for every action).
3. **Offline grace:** offline devices keep working only within a configured grace window since last successful verification/sync; after it, the device is locked until reconnect. When online, sync revalidates account state server-side (P-08, P-21), so a revoked user's queued commands are refused.
4. **On-demand check:** admin "re-verify now" action; also after repeated anomalies. No per-request verification.
5. Unavailable Sankhya at re-verification time: existing sessions continue until max age (documented risk), new logins fail closed.

Passwords are not stored, so re-verification of an existing session cannot use the password; the mirror state (item 1) plus session expiry are the only revocation signals. Password change in Sankhya takes effect at next login, not mid-session (accepted behaviour, OWNER to confirm).

## 7. Testing and gating (when unblocked)

- Contract tests with the fake verifier (exists as port + fake); a real adapter only after BLOCKER-SNK-CREDENTIALS is closed with newly issued credentials (SEC-1 rotation), the mechanism proven in non-production Sankhya (SNK-3), and spike S-notes recorded in `docs/sankhya-spike.md`.
- Tests: password absent from logs/errors/metrics, timeout fails closed, CODVEND mismatch refuses, inactive refuses, unreachable refuses, no outbound call to non-allow-listed hosts.
- Security review before merge (`security-model.md` section 15).

## 8. Open owner decisions

1. Approve the STACK-2 amendment (option A) or choose B/C.
2. Is Sankhya-verified login required for sellers at all, or are Force-native passwords (P-11 Argon2id) enough with Sankhya used only for mapping? This changes whether the verifier is needed (it is the larger risk surface).
3. Maximum session age, offline grace window, re-auth for sensitive actions.
4. Mirror cadence for user active/blocked state and who reconciles CODVEND mismatches.
5. Whether a read-only Sankhya service account exists/is permitted (V-11, S0.7) and who issues and rotates it.
6. Verifier timeout and circuit-breaker values after latency is measured.
7. Closing BLOCKER-SNK-CREDENTIALS (new credentials delivered through a secret store, not Git).

## 9. Auth readiness by account class (PB-1) — PROPOSED / documentation of current state

| Class | Authentication | Status |
|---|---|---|
| ADMIN / TECHNICAL | Local Force login (email + Argon2id password, P-11; lockout, audit). No Sankhya involvement | Needs the non-dev auth mode (today only `AUTH_MODE=dev`, refused in production mode) |
| OPERATIONAL (sellers, managers, backoffice using Sankhya identity) | External verifier (this note). The **real verifier stays OFF** (port disabled, 503) until Sankhya credentials are reissued (SEC-1) and the login method is proven in non-production Sankhya (SNK-3, V-11) | Blocked: BLOCKER-SNK-CREDENTIALS |

**Admin-only staging is structurally possible**, because the external flow is a separate branch (`loginExternal`) that is disabled and the local login does not depend on it. Requirements: non-dev local auth implemented, first-admin bootstrap with no default password (U-12 open), no seed/demo accounts, `SANKHYA_MODE=fake`, worker read-only, access restricted by allow-list (STAGING_READINESS_PLAN section 9).

- **Can test:** infrastructure (HTTPS, proxy, migrate, health/readiness, backup/restore drill, rollback), local login/lockout/session/device-approval behaviour, admin screens and configuration, audit, the web build in `standard` mode, CORS/cookies/headers, the security review, the mobile staging build reaching the HTTPS API (admin-class login only, if the role allows mobile).
- **Cannot test:** seller/operational login, CODVEND mapping and mismatch refusal, seller-scoped data and permissions with real identities, offline sync for sellers, revocation via mirror, anything depending on real Sankhya identity or ERP data. Scope/authorization tests for sellers stay in automated tests with the fake verifier.
- **Rules:** demo sellers must NOT substitute real auth (no demo/seed accounts in staging; boot refusal in production mode). No fake Sankhya authentication in staging or production: the fake verifier exists only for automated tests and dev, never reachable from a staging deployment. An operational user in staging appears only after the real verifier is proven.

## 10. Pending business decisions that do not block this design

R35 (discount authority calculation base) and R36 (approval routing, absolute ceiling, substitute approver) are UNDECIDED business decisions, pending with the owner. They gate full Phase 1 discount authority (P-10) only; the interim per-item discount (DISC-1) is approved. They must not block technical finalization of auth, verifier design, staging or mobile staging. Never invent a rule for them.

## Addendum — final security review (MEDIUM-2 and gaps)

- **Sankhya end-user lockout (MEDIUM-2).** Every submitted login/password reaches Sankhya, so an attacker below the Force rate limits could still lock a real ERP user out of the ERP. Required before any adapter: a per-login failure budget well below Sankhya's own lockout threshold (threshold to be measured in the V-11 spike, never guessed), plus a global circuit breaker on the verifier. Throttling stays in the API, before the verifier call.
- **Uniform failure.** A link/CODVEND reconciliation failure after a valid directory answer returns the same uniform invalid-credentials response as a wrong password (same padding, counted by the throttles); the specific reason lives in the audit row only.
- **Revocation bound.** Define an end-to-end maximum time for a Sankhya-side deactivation or password change to affect existing Force sessions (session max age + mirror cadence); owner decision (items 12/13 above).
- **ExternalAccountLinks.** Needs a maintainer and an audit path; linking by login text stays forbidden (identity = CODUSU/CODVEND only).
- **Status:** design only. No adapter is implemented while BLOCKER-SNK-CREDENTIALS exists.
