# Security rules (all code and configuration)

> **Status (2026-09-16):** design mode — nothing here authorizes application code before the project owner writes `BEGIN IMPLEMENTATION`. Items citing APPROVED decisions bind now; items citing PROPOSED decisions (`STACK-1`, `STACK-4`, `STACK-5`, `DATA-3`, `AUTH-x`, `SYNC-x`, `MOB-1/2`, `SNK-1/2` (except the approved outbox write path), `OPS-3…5`, `P-23` — see `docs/decisions.md` §0) describe the working proposal and bind only once approved.

Model and rationale: `docs/security-model.md`. These are the working rules.

## Never

- Commit, print, log or put in fixtures: passwords, tokens, cookies, session ids, API keys, `client_secret`, `X-Token`, private keys, `.env` contents.
- Send server credentials or third-party keys to web or mobile clients, including via build-time variables.
- Bypass or weaken authorization, validation, rate limits or lockout to fix a bug or make a test pass.
- Use production credentials or production data in development, CI or staging. Sole exception: an owner-authorized read-only Sankhya production diagnostic inspection during a spike (`docs/security-model.md` §10.1) — never in staging or CI, credentials never in Git.
- Try to work around `.claude/settings.json` deny rules. They are a safety net, not the security boundary; if one blocks legitimate work, ask the owner.

## Authorization

- Every read or write of user-facing data goes through the central policy module (AUTH-4). No query path for user data without an actor context.
- New endpoints touching scoped data ship with authorization matrix tests. Deny-by-default for new permissions is PROPOSED (`docs/security-model.md` §5.1) — until confirmed, never grant a new permission to a profile without explicit instruction.
- UI hiding, disabled buttons, route guards and local mobile filters are never authorization.
- The external representative profile cannot use the web app (AUTH-3) — enforce server-side.

## Sensitive data (P-20 APPROVED; P-23 PROPOSED)

- Responses are built from explicit DTOs. Never serialize database rows or ORM entities directly.
- Cost and margin: never in mobile payloads or local schema, never to representatives, never to AI; web only for permitted profiles.
- No export or bulk-download capability is reachable by representatives. Every export is audited.
- Error messages and deduplication responses never reveal data outside the user's scope.

## Authentication and sessions (AUTH-1)

- Argon2id for passwords. Tokens and session ids come from a CSPRNG, are stored only as hashes, and are compared in constant time.
- Web: `httpOnly`, `Secure`, `SameSite=Lax` cookie + CSRF protection. No tokens in browser storage.
- Mobile: tokens only in the device secure store.
- Validate session, user status, session version and device status on every request.

## Input and data access

- Validate all external input with Zod contracts at the boundary (HTTP, webhooks, files, Sankhya responses, job payloads).
- Parameterized access through Drizzle only; no string-built SQL with external values.
- Uploaded files: enforce type and size limits (spreadsheets: `.xlsx`/`.csv`, up to 20 MB / 50,000 rows — RF-IMP-1) before parsing.

## Logging and error reporting

- Structured logs with correlation IDs; log identifiers, not personal data or payloads.
- Never log request bodies of auth, sync or import endpoints.
- Sentry: no request bodies, form data, cookies or authorization headers; user identified only by internal id (OPS-4).

## Secrets and environments

- Configuration via environment, validated at startup; `.env.example` holds placeholders only.
- Sankhya credentials exist only in the worker runtime unless a later explicitly approved use case requires API-side access (STACK-2).
- Staging never connects to Sankhya production (SNK-3).

## Dependencies and supply chain

- Before adding a dependency: need, maintenance, security history, overlap with existing packages (see `CLAUDE.md`).
- Keep package lifecycle scripts disabled unless explicitly allowlisted.
- CI actions pinned to commit SHA.
- Before running a third-party skill script or unknown script: read it first; never pipe remote scripts into a shell.

## Review

Changes hitting `docs/security-model.md` §15 triggers require a `security-reviewer` pass before completion.
