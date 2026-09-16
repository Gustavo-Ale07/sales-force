---
paths:
  - "apps/mobile/**"
  - "packages/mobile-db/**"
---

# Mobile rules (apps/mobile, packages/mobile-db)

> **Status (2026-09-16):** design mode — nothing here authorizes application code before the project owner writes `BEGIN IMPLEMENTATION`. Items citing APPROVED decisions bind now; items citing PROPOSED decisions (most `STACK-x`, `DATA-x`, `AUTH-x`, `SYNC-x`, `MOB-1/2`, `SNK-1/2`, `OPS-x` — see `docs/decisions.md` §0) describe the working proposal and bind only once approved.

Decisions: MOB-1, MOB-2, MOB-3, AUTH-1, AUTH-2, SYNC-1…3, P-07, P-08, P-20a, P-20b. Protocol: `docs/sync-protocol.md`.

## Platform

- Expo with generated native projects and development builds. Expo Go is not a supported runtime.
- Native `android/` and `ios/` directories are generated, not committed.
- iOS builds run on EAS (development happens on Windows). EAS updates are code-signed.
- Business rules come from `packages/domain`, which must run in Hermes.

## Offline-first

- Never assume connectivity. Handle intermittent networks, retries, background/foreground transitions.
- Every write is a command in the local outbox; show pending, accepted, rejected and needs-review states.
- The server outcome is authoritative; offline checks (price, discount, credit) are indicative only.
- Show sync status and data freshness; enforce the max-offline lock (7 days, configurable).

## Synchronization

- Implement only APPROVED sections of `docs/sync-protocol.md`. UNDECIDED items (R05–R11, R16, R45) are not implemented by assumption.
- Process pull responses exactly as specified: resync, bundle deletes, bundles, dataset resets, regular changes.
- Local cleanup by retention windows must never delete rows referenced by pending outbox commands.
- Until R10/R11 are decided, follow the interim rule for local schema and protocol changes in `docs/sync-protocol.md` §9.

## Local data and security

- Local database encrypted (MOB-2). The SQLCipher-capable library is chosen by spike S7 — do not choose it earlier.
- Database key and tokens only in the device secure store; never AsyncStorage or plain files.
- No cost or margin fields in the local schema or UI; no export features for representatives (P-20a APPROVED; P-20b PROPOSED).
- On revocation: delete the local database and cached files. A `pending` device shows its approval state and holds no business data.
- Generated files (e.g. quotation PDFs) are temporary; OS backup exclusion UNDECIDED R19.

## Testing

- Unit tests for client sync logic and outbox behavior (test-first).
- Maestro E2E (platform coverage UNDECIDED R48): offline order → reconnect → submitted; offline new customer; revocation wipes data.
- State explicitly what was not verified (e.g. iOS device behavior without macOS — R48).
