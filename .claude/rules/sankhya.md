---
paths:
  - "packages/sankhya/**"
  - "**/sankhya/**"
  - "**/sankhya-*/**"
  - "apps/server/**/integration/**"
---

# Sankhya integration rules

> **Status (2026-09-16):** design mode — nothing here authorizes application code before the project owner writes `BEGIN IMPLEMENTATION`. Items citing APPROVED decisions bind now; items citing PROPOSED decisions (`STACK-1`, `STACK-4`, `STACK-5`, `DATA-3`, `AUTH-x`, `SYNC-x`, `MOB-1/2`, `SNK-1/2` (except the approved outbox write path), `OPS-3…5`, `P-23` — see `docs/decisions.md` §0) describe the working proposal and bind only once approved.

Decisions: P-02, P-03, SNK-1…4, DATA-3, SYNC-2. Facts and open questions: `docs/sankhya-spike.md` (read it first).

## Never invent

- Services, endpoints, table or field names, TOP, company codes, price rules, mandatory fields, goal/commission sources, limits or error behavior.
- If something is not VALIDATED in `docs/sankhya-spike.md`: add a NEEDS VALIDATION question there and stop that part of the work.

## Boundary

- Only `packages/sankhya` knows Sankhya formats. Inputs and outputs of `SankhyaGateway` are Sales Force-shaped types.
- Only the worker calls the gateway. The API calls Sankhya synchronously only for operations in the allowlist of `docs/architecture.md` §7.4 (empty in Phase 0).
- The gateway interface has a real and a fake implementation; both satisfy the same contract tests.

## Authentication

- OAuth 2.0 client credentials + `X-Token` (F-01). Cache the access token; renew before expiry; handle authentication failure as its own error class.
- Credentials only in the worker's environment. Never log tokens, `client_secret` or `X-Token`.

## Environments

- Development and CI: fake gateway with sanitized fixtures only.
- Staging: Sankhya homologation if it exists; otherwise the fake gateway with sanitized fixtures (SNK-3). An isolated real non-production environment may be added before the pilot and is required for validating real writes before the pilot. **Staging never connects to Sankhya production; production is never an environment for development, CI or staging.**

## Reads (mirror)

- Map responses to Sales Force types; validate them with Zod before use.
- Upsert mirror rows only when the content hash changed; keep per-entity sync state (last success, cursor, last error).
- Read method, cursor and deletion detection per entity come from spike S1; do not guess them.

## Writes

- Only through `integration_outbox`, processed by the worker, with the idempotency check of SNK-4 before every retry.
- **Do not implement Sankhya writes until V-11 and V-13 are closed.**

## Limits and errors

- Use the request limits recorded in `docs/sankhya-spike.md` §5. While unmeasured, serialize requests.
- Back off on rate-limit and server errors; do not retry validation or permanent business rejections; surface them as integration errors with understandable messages.

## Fixtures

- Raw captures only in `.sankhya-raw/` (git-ignored), normally from non-production environments. Sankhya production may be read only inside an owner-authorized read-only diagnostic inspection meeting every condition of `docs/security-model.md` §10.1 and logged in `docs/sankhya-spike.md` §8 — never prepare or perform one without that recorded authorization.
- Commit only sanitized fixtures with provenance (spike, operation, date, environment type). No real CNPJ/CPF, names, addresses, emails, phones, notes, tokens.
