---
paths:
  - "packages/domain/**"
---

# Domain rules (packages/domain)

> **Status (2026-09-18):** `BEGIN IMPLEMENTATION` issued by the owner — implementation only within the current roadmap phase (Phase 0). Items citing APPROVED decisions bind now (including Round 6: `STACK-1/4/5`, `MOB-1/2`; the `MOB-2` library NEEDS VALIDATION, V-09); items citing PROPOSED decisions (`DATA-3`, `AUTH-x`, `SYNC-x`, `SNK-1/2` (except the approved outbox write path), `OPS-3…5`, `P-23` — see `docs/decisions.md` §0) describe the working proposal and bind only once approved.

Decisions: P-05, P-08, P-09, P-10, ARCH-1, STACK-3, DATA-3. Invariants summary: `CLAUDE.md`.

## Purity and portability

- **APPROVED (ARCH-1):** never import from `apps/server`, NestJS, Drizzle, PostgreSQL clients, HTTP, pg-boss or Sankhya SDK/API types; never use Node-only APIs in a rule that must also run on mobile. Rules are never tied to decorators, request objects or controllers (STACK-3).
- No framework, database, HTTP, file system, environment, logging or Sankhya dependencies.
- **PROPOSED (stricter, `architecture.md` §4.2):** no `node:` built-ins anywhere in the package, so every rule runs unchanged in Node and Hermes; no DOM APIs.
- Third-party libraries only when pure and portable (e.g. exact decimal arithmetic), added under dependency discipline.
- Time and randomness are injected; functions are deterministic.

## Money and numbers

- Money and percentages use one exact decimal type; JavaScript `number` is never used for money.
- Rounding rules and precision for percentages/quantities are NEEDS VALIDATION (spike S2) — do not invent them; leave the rule injectable/explicitly unimplemented and flag it.

## Business rules

- Order, proposal, opportunity and account state transitions are defined here only and consumed by server and mobile.
- Price integrity: a changed applicable price produces a review outcome (`revisao_preco`), never a silent replacement (P-09).
- Discount authority: seller limit, manager limit, director above; profile defaults with per-user override (P-10). Calculation base, routing, ceiling and credit approver are UNDECIDED (R35, R36, R37) — do not decide them in code.
- Credit and overdue checks produce indicative results offline; the server re-evaluates (P-08).
- Never use AI or heuristics for deterministic rules (pricing, discounts, credit, permissions, transitions, totals).

## Testing

- Test-first for every rule. Exhaustive transition tests (allowed and forbidden transitions).
- Spike S2 recorded price cases become acceptance tests when available.

## Configuration

- Installation-specific commercial values arrive as typed configuration input (CFG-1…6), for example `configuration.product.sellableUsageValues`. The domain holds no customer-specific literals and never reads configuration from Sankhya or the database.
