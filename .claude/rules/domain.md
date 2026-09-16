---
paths:
  - "packages/domain/**"
---

# Domain rules (packages/domain)

> **Status (2026-09-16):** design mode — nothing here authorizes application code before the project owner writes `BEGIN IMPLEMENTATION`. Items citing APPROVED decisions bind now; items citing PROPOSED decisions (`STACK-1…6`, `DATA-2`, `DATA-3`, `AUTH-x`, `SYNC-x`, `MOB-1/2`, `SNK-1/2`, `OPS-3…5`, `P-23` — see `docs/decisions.md` §0) describe the working proposal and bind only once approved.

Decisions: P-05, P-08, P-09, P-10, DATA-3. Invariants summary: `CLAUDE.md`.

## Purity and portability

- No framework, database, HTTP, file system, environment, logging or Sankhya dependencies.
- Must run unchanged in Node and in Hermes (mobile): no `node:` built-ins, no DOM APIs.
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
