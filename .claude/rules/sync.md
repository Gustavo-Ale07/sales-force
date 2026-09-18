---
paths:
  - "apps/server/**/sync/**"
  - "apps/server/**/*sync*"
  - "apps/mobile/**/sync/**"
  - "apps/mobile/**/*sync*"
  - "packages/mobile-db/**"
  - "packages/contracts/**/*sync*"
  - "packages/domain/**/*sync*"
---

# Offline synchronization rules

> **Status (2026-09-18):** `BEGIN IMPLEMENTATION` issued by the owner (current roadmap phase only). APPROVED items bind (including `MOB-1/2` in direction); `SYNC-1…3`, `AUTH-1…4`, `DATA-3`, P-23 and unresolved `R*` items remain PROPOSED/UNDECIDED where `docs/decisions.md` says so. The per-section status in `docs/sync-protocol.md` is authoritative.

Decisions: P-07, P-08, P-09, P-20, P-21, AUTH-1…4, SYNC-1…3, DATA-3. Protocol: `docs/sync-protocol.md`. Open items include R05…R11, R16, R45; validations include V-07, V-09, V-14.

## Boundaries

- Same server-side authorization policy as the API; local filtering is never authorization (P-21).
- Mobile local outbox and server `integration_outbox` are different mechanisms. Never merge their responsibilities.
- Sankhya delivery is downstream of accepted server state; mobile never talks to Sankhya.
- Restricted fields are excluded before serialization/sync. Representatives never receive cost, margin or general export data (P-20); P-23 is still PROPOSED for all-mobile/AI scope.

## Commands and idempotency

- Every offline business write is a command and is fully revalidated server-side for authorization, current price, discount authority, credit, state and invariants (P-08).
- `entity_id` identifies the logical entity. `command_id` identifies one logical command and is reused across retries; attempt/job IDs are execution details only. Treat these identifier semantics as PROPOSED until DATA-3/SYNC round status closes.
- Same `command_id` + same payload returns the stored outcome; same `command_id` + different payload is an idempotency conflict. Never create a second business effect to make a retry "work".
- Do not invent ordering/dependency behavior while R06 is open.

## Pull, cursor and scope

- Implement only protocol sections whose status permits implementation. SYNC-2 commit-safe cursor/watermark remains PROPOSED and depends on V-07; never replace it with a naive global sequence that can skip concurrent commits.
- Initial load, resumable pagination, tombstones and deletion/removal must preserve authorization and not leak records outside scope.
- Scope gain/loss must converge: entering scope delivers the required bundle/dataset; leaving scope removes local unauthorized data. Major team/permission/profile changes may require full resync as specified by SYNC-3 proposal.
- Never delete local rows still referenced by pending outbox commands. Retention cleanup is subordinate to command durability and authorization cleanup.

## Conflicts and authoritative data

- Sankhya-mirrored ERP data is server-authoritative. Never silently overwrite it from mobile.
- A stale price must not be silently substituted; route through `revisao_preco` (P-09).
- Critical state/ownership changes require explicit commands and deterministic rules; unresolved CRM merge semantics stay open under R05.
- Revoked devices cannot push or pull; offline remote wipe is impossible until reconnect, so enforce the approved/proposed device/offline controls rather than pretending otherwise.

## Local security and lifecycle

- Local business data must be encrypted (MOB-2; library choice V-09). Keys/tokens live only in secure storage.
- Enforce the configured max-offline policy and device approval/revocation semantics from AUTH-2 / `docs/security-model.md`; do not weaken them to improve UX.
- Protocol/schema migrations with pending outbox commands remain UNDECIDED under R10/R11; do not guess a migration or compatibility policy.
- Lost local encryption key behavior remains R45 until decided.

## Required verification

For sync work, cover the applicable cases from `docs/sync-protocol.md` §11: duplicate/conflicting command IDs, retry, concurrent pull transactions, interrupted/resumed initial sync, scope gain/loss, team/permission change, tombstones/removal, price review, rejected dependencies, revocation, and no sensitive-data leakage. V-07 is required before treating the watermark design as proven.
