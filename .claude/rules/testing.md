---
paths:
  - "apps/**"
  - "packages/**"
  - ".github/**"
  - "**/*.test.*"
  - "**/*.spec.*"
  - "**/e2e/**"
  - "**/tests/**"
---
# Testing rules (all code)

> **Status (2026-09-16):** design mode — nothing here authorizes application code before the project owner writes `BEGIN IMPLEMENTATION`. Items citing APPROVED decisions bind now; items citing PROPOSED decisions (`STACK-1`, `STACK-4`, `STACK-5`, `DATA-3`, `AUTH-x`, `SYNC-x`, `MOB-1/2`, `SNK-1/2` (except the approved outbox write path), `OPS-3…5`, `P-23` — see `docs/decisions.md` §0) describe the working proposal and bind only once approved.

Strategy source: `docs/project-spec.md` §15 and `docs/decisions.md` (spec D20). Sync-specific cases: `docs/sync-protocol.md` §11.

## Pyramid

| Layer | Target | Tooling |
|---|---|---|
| Unit | `packages/domain`: price, discount, approval authority, credit, state transitions, deduplication, automation rules | Vitest |
| API integration | Endpoints against real PostgreSQL (same major as production, DATA-1); authorization matrix | Vitest + Testcontainers |
| Sync | Watermark concurrency, idempotent push, scope events and bundles, tombstones, revocation, price revision | Vitest + Testcontainers |
| Sankhya contract | `SankhyaGateway` against sanitized recorded responses (CI uses only the fake gateway — SNK-3) | Vitest |
| Worker | Outbox failures, retry classification, backoff, reprocessing, automation loop protection | Vitest + Testcontainers |
| Web E2E | Critical flows | Playwright |
| Mobile E2E | Critical offline flows (platform coverage UNDECIDED R48) | Maestro |

- Real-Sankhya smoke tests (spec §15) never run in GitHub Actions: Sankhya credentials exist only in the worker runtime (STACK-2). They run manually or on a schedule from the staging environment against the SNK-3 environment, and only after V-11 closes.

- CI blocks merge on any failing PR suite. No global coverage target; high coverage required in `packages/domain`, sync and permissions.
- Tool names come from the spec. Playwright, Maestro and Testcontainers are established; Vitest is confirmed when the Phase 0 skeleton proves it works with NestJS (WP 0.2).

## Test-driven development

- **Mandatory (test first):** `packages/domain`, authorization/policy, sessions and auth, sync (server and client), Sankhya mapping, bug fixes (regression test first).
- **Exempt:** exploratory spikes, configuration, documentation, generated code, purely visual changes. Spike code that becomes production code gets tests before merge.

## Mandatory cases

- Every endpoint touching scoped data: allowed and denied cases per profile and scope, including representative restrictions.
- Every response type that could carry cost, margin or export data: assert the fields are absent for restricted profiles and absent from all mobile payloads.
- Every synchronizable table: included in the watermark concurrency test.

## Test data and determinism

- Synthetic data only. Sankhya fixtures sanitized (`docs/sankhya-spike.md` §6). Never real customer data.
- Inject clock and randomness; no real network in unit or integration tests; the fake Sankhya gateway in CI.
- Never run tests against shared, staging or production databases.

## Integrity

- Never skip, weaken or delete a failing test to get green; report it.
- Completion claims require the actual command output from the repository's real scripts.
