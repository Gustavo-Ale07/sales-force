---
paths:
  - "apps/server/**"
  - "packages/contracts/**"
---

# Backend rules (apps/server, packages/contracts)

> **Status (2026-09-16):** design mode — nothing here authorizes application code before the project owner writes `BEGIN IMPLEMENTATION`. Items citing APPROVED decisions bind now; items citing PROPOSED decisions (`STACK-1…6`, `DATA-2`, `DATA-3`, `AUTH-x`, `SYNC-x`, `MOB-1/2`, `SNK-1/2`, `OPS-3…5`, `P-23` — see `docs/decisions.md` §0) describe the working proposal and bind only once approved.

Structure: `docs/architecture.md` §5. Decisions: STACK-2, STACK-3, STACK-4, STACK-6, SNK-1, AUTH-4.

## Structure

- One NestJS app with `api` and `worker` entry points. A module registers in each process only what that process needs.
- Controllers are thin: parse/validate, call an application service, map to a response DTO.
- Business rules live in `packages/domain`. Application services orchestrate; they do not reimplement domain rules.
- A module owns its tables. Other modules use its exported services, never its tables.

## Contracts

- `packages/contracts` Zod schemas are the source of truth for requests, responses and sync messages. Server validation and OpenAPI both derive from them.
- Responses are explicit DTOs; never return database rows or ORM entities.
- Breaking contract changes need a compatibility plan (web deploys with the server; mobile devices lag behind).

## Authorization

- Obtain access decisions and scope filters from the central policy module for every user-facing read or write, including jobs acting for a user.
- Enforce the representative web block and device status on every request (AUTH-1, AUTH-3).

## Transactions and jobs

- Keep transactions short; never call external services inside a database transaction.
- Enqueue pg-boss jobs caused by a business write in the same transaction as that write.
- Job handlers are idempotent. Classify failures: transient, rate limit, authentication, authorization, validation, permanent (same classes as `docs/architecture.md` §5.3). Retry only transient and rate-limit failures, with exponential backoff; surface permanent failures.
- No long-running work inside HTTP requests.
- Record audit events in the same transaction as the audited change.

## Sankhya

- Only the worker uses `SankhyaGateway`; writes only through `integration_outbox` (SNK-1). See `.claude/rules/sankhya.md`.

## Money, time, identifiers

- Money uses the domain decimal type, never `number`.
- Never order business logic by UUID (DATA-3). Whether business timestamps of offline commands use server receive time is UNDECIDED R05.

## Errors and logging

- Typed application errors mapped to HTTP status codes and stable error codes; user-facing messages are understandable; technical detail stays in logs.
- Integration errors distinguish provider unavailable, authentication failure, validation error, rate limit, temporary failure, permanent business rejection.
- pino JSON logs with correlation ID propagated to jobs. No silent catch blocks.

## Configuration

- Validate configuration at startup and fail fast. Each environment has its own values; nothing environment-specific in code.

## Phase discipline

- Implement only what `docs/roadmap.md` places in the current phase.
