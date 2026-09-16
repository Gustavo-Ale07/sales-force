# Security Model — Sales Force

**Responsibility of this file:** how identities, sessions, devices, authorization, sensitive data, secrets and third parties are protected, and which risks are accepted.

**Not in this file:** coding-level rules → `.claude/rules/security.md`; protocol mechanics → `sync-protocol.md`; rationale → `decisions.md`.

**Last updated:** 2026-09-16

### Status markers used below

- **No marker:** the statement has the status of the decision or requirement it cites. As of 2026-09-16:
  - **APPROVED:** P-01…P-17, P-20a (representatives never receive cost, margin or general export capability), P-21 (server-side authorization applied to sync, AI and dashboards), P-22 (secrets), SNK-3, SNK-4, MOB-3.
  - **PROPOSED (not binding):** AUTH-1…AUTH-4 (Round 4), SYNC-1…SYNC-3 (Round 5), MOB-1, MOB-2, STACK-5 (Round 6), SNK-1, OPS-1…OPS-5 (Rounds 2 and 7), P-18, P-19, P-20b (cost/margin never on mobile for any user, never to AI).
  - Requirements cited as `spec §x` / `RF-*` are draft until Specification v1.0.
- **[PROPOSED]**: additional baseline control recommended here, to be confirmed in the security decision round. Not binding.
- **[UNDECIDED …]**: open question listed in `decisions.md` §5.

This model is therefore largely a **proposal**: most sections describe the control set recommended for Round 4, built on the APPROVED principles above.

---

## 1. What we protect and from whom

### 1.1 Assets

| Asset | Why it matters |
|---|---|
| Customer portfolio (accounts, contacts, purchase history) | Core commercial asset; exfiltration to competitors |
| Financial titles, credit limits | Confidential customer financial data |
| Prices, discount limits, approval rules | Commercial strategy |
| Cost and margin | Most sensitive commercial data (P-20a APPROVED; P-20b PROPOSED) |
| Personal data of contacts and users | LGPD obligations |
| Sankhya credentials | Full ERP access |
| Sessions, refresh tokens, device keys | Account takeover |

### 1.2 Threats considered

| Threat | Primary controls |
|---|---|
| External representative copying the portfolio to a competitor | Mobile-only (AUTH-3), device approval (AUTH-2), no general export capability (P-20a), scope (AUTH-4), audit |
| Lost or stolen phone | Encrypted local database (MOB-2), revocation + wipe, max offline period |
| Password reuse / credential stuffing | Strong password policy, breached-password check, lockout, rate limiting, device approval |
| User seeing another portfolio | Central policy (AUTH-4), scope-aware sync (SYNC-3), matrix tests |
| Sensitive field leak through API or sync | Explicit response mapping, field rules in §6 |
| Staging touching production | Environment separation (P-15, SNK-3) |
| Compromised dependency or CI | Dependency review, pinned actions, protected production environment (OPS-3) |
| Personal data sent to third parties | Scrubbing (OPS-4), minimization (P-14), processor register (§11) |

---

## 2. Profiles

Defined in `project-spec.md` §2: Admin, Diretoria, Gerente, Vendedor interno, Representante externo (PJ), Cadastro/Financeiro. Default permissions follow the matrix in `project-spec.md` §8.2, applied through the model in §5.

---

## 3. Authentication (P-11, AUTH-1)

### 3.1 Credentials

- Email + password. No 2FA (accepted risk, §12).
- Passwords hashed with Argon2id. Plaintext passwords are never stored or logged.
- Minimum 12 characters (RF-IAM-1).
- New passwords are rejected if found in breached-password data (HIBP k-anonymity range API — only a hash prefix leaves the server) or in a local list of common passwords.
  - **[UNDECIDED — Phase 0 security review]** behavior when the breach API is unavailable.
- Progressive lockout: 5 failures → 15 minutes locked; repeated lockouts → admin unlock (RF-IAM-2).
  - **[UNDECIDED — Phase 0 security review]** number of lockouts that requires admin unlock.
- Password reset by email: single-use link valid for 30 minutes (RF-IAM-3).
- **[PROPOSED]** Login and reset responses do not reveal whether an email is registered.

### 3.2 Sessions

- Session and access/refresh tokens are opaque random values; the server stores only their hashes.
- **Web:** session identifier in an `httpOnly`, `Secure`, `SameSite=Lax` cookie; CSRF protection; expires after 12 hours of inactivity (spec §12.1).
- **Mobile:** short-lived access token (initial value 15 minutes, configurable) and a rotating refresh token (30 days, spec §12.1) kept in the device secure store. Reuse of an already-rotated refresh token invalidates it (spec §12.1); **[PROPOSED]** reuse also revokes the whole session family.
- **Every request** checks:
  - session active and not expired;
  - user active and not locked;
  - session version current;
  - for mobile: device approved and not revoked;
  - channel allowed for the user's profile (§4.2).
- The session version increments on password change or reset, user deactivation and administrative session revocation, which invalidates existing sessions immediately.
- Permission changes take effect on the next request because authorization is evaluated per request from current data.

---

## 4. Devices and channels

### 4.1 Mobile devices (AUTH-2, RF-IAM-7, RF-IAM-8)

- A device registers on its first mobile login. Status: `pending` → `approved` → `revoked`.
- **External representatives:** a new device requires approval by an admin or the representative's manager. At most 1 active device (configurable).
- **Internal users:** devices are auto-approved; the admin is notified.
- A `pending` device receives only authentication and device-status responses — no business data.
- **Revocation:** sessions are invalidated immediately. On its next contact the app deletes its local database and cached files.
- **Max offline period:** 7 days (configurable). After it, the app blocks use until it synchronizes.
- Phase split: device identity and status are part of the Phase 0 session model; approval screens, wipe and offline lock are Phase 1.
- **[UNDECIDED R16]** clock manipulation against the offline lock.

### 4.2 Channel restriction (AUTH-3)

- The external representative profile cannot authenticate on the web application.
- Enforced server-side at login and on every request, not by hiding the web UI.
- **[UNDECIDED — Phase 1, R14]** UX for representative spreadsheet imports (in-app or on-behalf by an internal user).

---

## 5. Authorization (AUTH-4)

### 5.1 Model

- **RBAC:** named permissions `resource.action` (e.g. `order.approve`, `account.export`) grouped into profiles; the admin adjusts profile permissions (RF-IAM-6).
- **Data scope per permission:** `nenhum`, `proprio`, `equipe`, `tudo`.

| Scope | Records visible |
|---|---|
| `nenhum` | none |
| `proprio` | accounts where the user is owner or attendant; records where the user is the responsible person |
| `equipe` | `proprio` of the user and of every member of the teams they manage, including sub-teams |
| `tudo` | all records of the resource |

- **Accounts:** one owner (the Sankhya seller for Sankhya customers) plus zero or more attendants assigned in Sales Force. Attendants never become owners in Sankhya.
- **Child records:** visible when the account is in scope, or when the user is the record's responsible person. Account-derived data (financial titles, orders, contacts, history) inherit account visibility.
- **[PROPOSED]** New permissions default to denied.

### 5.2 Enforcement

- One central policy module in the server computes access decisions and scope filters.
- Every path that returns or changes user-facing data uses it: API endpoints, sync pull and push, exports, dashboards, jobs acting on behalf of a user, AI tools (Phase 3).
- There is no unscoped query path for user-facing data.
- **[PROPOSED]** System jobs run with an explicit system context and are audited.
- Hidden UI, disabled buttons, client route guards and local mobile filters are never authorization.
- PostgreSQL row-level security is not used initially; adding it later requires a decision.
- Every endpoint touching scoped data has authorization matrix tests (profile × scope × ownership).
- **[UNDECIDED R17]** deduplication lookup must not reveal other portfolios.

---

## 6. Sensitive data exposure (P-20a APPROVED; P-20b PROPOSED)

| Data | Rule |
|---|---|
| Cost and margin | Never sent to representatives on any channel (P-20a, APPROVED). Never sent to the mobile app for any user and never sent to AI providers (P-20b, PROPOSED). On the web, only for profiles with explicit permission (Admin, Diretoria; Gerente configurable — spec §8.2). |
| Exports (CSV/XLSX, bulk downloads) | Representatives never receive general export capability (P-20a, APPROVED). Proposed enforcement: no export permission is grantable to the profile and no bulk-download endpoint serves it. Every export is audited. |
| Representative sharing | Limited to the PDF of a quotation or proposal for their own customer (spec §12.2). |
| Cross-portfolio data | Never delivered outside scope, including in sync bundles, error messages and deduplication responses. |

- Field filtering happens in server response mapping from explicit DTOs. Clients never receive a field so that the UI can hide it.
- Database rows are never serialized directly to responses.

---

## 7. Synchronization security

- Sync endpoints use the same policy module as the API (§5.2).
- Scope changes produce removals and additions through scope events (SYNC-3); records leaving scope are deleted from the device.
- Devices that are `pending` or `revoked` receive no business data.
- Offline decisions (price, discount, credit, state) are revalidated by the server (P-08).
- Details: `sync-protocol.md`.

---

## 8. Mobile data protection

- Local database encrypted (MOB-2); the key is kept in the device secure store.
- Tokens only in the secure store.
- EAS updates are code-signed (MOB-1).
- Local schema contains no cost or margin fields.
- **[UNDECIDED R19]** exclusion of app data from OS backups; temporary handling of generated PDFs.
- **[UNDECIDED R45]** behavior when the local encryption key is lost.

---

## 9. Web application protection

- Same-origin single-page app; session cookie only; no tokens in browser storage (STACK-5, AUTH-1).
- HTTPS everywhere with HSTS (spec §12.3).
- **[PROPOSED]** Content Security Policy restricting scripts to the application's own origin.

---

## 10. Server, infrastructure and delivery

- All input validated with Zod contracts; database access parameterized through Drizzle (spec §12.3).
- Rate limiting per IP and per user on login, password reset, sync, webhooks and AI endpoints (spec §12.3).
- Inbound webhooks authenticated by token or signature (spec §12.3; later phases).
- **Secrets:**
  - provided per environment through environment configuration outside the repository;
  - never in client bundles, logs, fixtures or error reports;
  - Sankhya credentials only in the worker container while the synchronous allowlist is empty (SNK-1);
  - backed up in an encrypted store outside the servers (OPS-2).
- The database is never publicly exposed (OPS-1).
- **[PROPOSED]** The migration job uses a database role with DDL rights; the application role has none.
- **[PROPOSED]** The application role cannot update or delete audit log rows.
- **CI/CD (OPS-3):**
  - actions pinned to commit SHA;
  - production deploys require manual approval through a protected GitHub Environment;
  - the deploy user on hosts has only the rights needed to pull images, run the migration job and restart services;
  - dependency update automation and vulnerability scanning in CI.
- **Environment separation (P-15, SNK-3):**
  - no production data or credentials in development, CI or staging;
  - staging never connects to Sankhya production;
  - test fixtures are synthetic or sanitized.

---

## 11. Third-party processors (LGPD)

| Processor | Data | Phase | Status |
|---|---|---|---|
| Sankhya (ERP) | all ERP data | 0 | existing contract |
| Hosting / managed PostgreSQL provider | all application data | 0 | V-04 |
| Object storage provider | files (PDFs, spreadsheets) | 0/1 | V-05 |
| Email provider | recipient addresses, email content | 0 | V-06 |
| Sentry | error events (scrubbed) | 0 | V-08 (region) |
| HIBP range API | 5-character password hash prefix (not personal data) | 0 | PROPOSED (AUTH-1) |
| GitHub, Expo/EAS | source code, build artifacts; no production data | 0 | — |
| CNPJ/CEP providers | company documents, postal codes | 1 | — |
| Google Workspace | user email/calendar content | 2 | — |
| Anthropic | minimized business data (P-14) | 3 | — |

- **[UNDECIDED R67]** legal review of international transfers and processor register — before the pilot.

---

## 12. Accepted risks

| Risk | Accepted because | Compensating controls |
|---|---|---|
| No 2FA (P-11) | Owner decision; user friction | Strong passwords, breached-password check, lockout, rate limits, device approval, audit |
| Remote wipe is best effort | A device that never reconnects cannot be wiped | Encryption at rest, max offline period, immediate session revocation |
| Screen photos and manual copying | Not technically preventable | Scope limits exposure; audit; contractual controls outside the system |

The no-2FA decision is revisited after any unauthorized-access incident or a change in user profile (spec §12.1).

---

## 13. Audit

Recorded events (spec §12.4, extended):
- login success, login failure, lockout, unlock;
- password reset requested/completed;
- user created, changed, deactivated; profile and permission changes;
- device registered, approved, revoked; session revoked;
- order and customer approvals/rejections (Phase 1);
- discount-limit changes (Phase 1);
- imports and exports;
- automation changes (Phase 2);
- administrative actions.

Each entry records actor, action, entity, identifier, summarized before/after, IP, device, timestamp. Minimum retention 1 year.

---

## 14. AI (Phase 3)

- Calls originate only from the backend with the current user's permissions (P-14).
- Minimal necessary data; never passwords, secrets, tokens, cost or margin, or data outside the user's scope.
- Assistant tools are read-only.
- **[UNDECIDED R18]** knowledge-base documents filtered by profile.

---

## 15. Security review triggers

Changes in these areas require a `security-reviewer` pass before completion:

- authentication, sessions, password handling, lockout;
- devices, revocation, wipe, offline lock;
- the authorization policy, scope rules, new permissions;
- sync endpoints or bundle/scope-event logic;
- any response that could include cost, margin, exports or cross-portfolio data;
- secrets handling, environment configuration, CI/CD and deploy;
- Sankhya credentials or gateway authentication;
- new third-party processors or data sent to them.
