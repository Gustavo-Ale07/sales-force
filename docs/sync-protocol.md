# Offline Synchronization Protocol — Sales Force

**Responsibility of this file:** the normative protocol between the server and the mobile app — what data reaches a device, how changes and removals are delivered, how offline commands are applied, and which parts are still open.

**Not in this file:** authorization rules themselves (`security-model.md` §5), mobile implementation details (`.claude/rules/mobile.md`), rationale (`decisions.md`).

**Last updated:** 2026-09-16

### Section status

Each section or item is marked **APPROVED** (backed by an APPROVED decision in `decisions.md`), **PROPOSED** (working proposal — the sync decisions SYNC-1…SYNC-3 are Round 5 and not yet approved), **UNDECIDED** (open question) or **NEEDS VALIDATION**. Only APPROVED content is binding. Nothing here is implemented before `BEGIN IMPLEMENTATION`.

---

## 1. Principles — status per item

1. The server is authoritative (P-08, APPROVED). The device holds a filtered, disposable copy plus its own pending commands (PROPOSED).
2. A device receives only data the user is authorized to see, using the same scope rules as the API (P-21, APPROVED); computed by the same policy module (AUTH-4, PROPOSED).
3. Records leaving the user's scope are removed from the device (SYNC-3, PROPOSED).
4. Data mirrored from Sankhya is read-only on the device (P-02, APPROVED).
5. Every offline write is an idempotent command; replaying it never duplicates effects (P-08, APPROVED). Key naming UNDECIDED (R09).
6. The server revalidates authorization, prices, discount authority, credit, current state and invariants for every command (P-08, APPROVED).
7. Cost and margin never reach representatives (P-20, APPROVED) and are never part of any synchronized dataset for any user (P-23, PROPOSED).
8. `pending` or `revoked` devices receive no business data (AUTH-2, PROPOSED).
9. The protocol is custom; no third-party sync engine (SYNC-1, PROPOSED).

---

## 2. Datasets on the device

### 2.1 Dataset classes — PROPOSED

| Class | Visibility basis | Contents (spec §9.3) |
|---|---|---|
| Account-scoped | account in scope (owner or attendant, team scope) | accounts, contacts, financial title summaries, sales history summary, orders, account-linked tasks |
| Record-scoped | user is the responsible person of a record whose account is out of scope | the record itself (e.g. a task) |
| User-scoped | the user | goals, positivization, commissions, own tasks without account, notifications |
| Reference | applicability to the user | applicable products, applicable price tables and items, payment terms, operation types |

### 2.2 Retention windows — PROPOSED (spec §9.3)

| Data | Window on device |
|---|---|
| Financial titles and purchase history | last 12 months |
| Orders | last 90 days + all open |
| Tasks | open + last 30 days |

Windows are applied by local cleanup (§4.5), never by server deletions.

### 2.3 Local-only tables — PROPOSED (outbox, sync state) / UNDECIDED (drafts)

- `sync_state`: protocol version, cursor, initial-load progress.
- `outbox`: pending commands in creation order.
- Drafts: whether drafts are local-only or synchronized — **UNDECIDED R08**.

---

## 3. Change tracking on the server — PROPOSED (SYNC-2)

To be validated by the mandatory concurrent-transaction test (V-07, NEEDS VALIDATION) that ships with the first synchronizable table.

### 3.1 Row stamping

- Every synchronizable table has a column holding the writing transaction id (`xid8`), set by trigger on insert and update from `pg_current_xact_id()`.
- Logical deletes set `deleted_at` (an update, therefore stamped).
- When a mirrored row is physically removed, a tombstone row (table, row id, account id when applicable, stamped `xid8`) is written in the same transaction.
- Mirror upserts write only when the content hash differs from the stored hash; no-op updates are forbidden because they would re-stamp rows and inflate downloads.

### 3.2 Commit-safe watermark

A pull page is computed inside one `REPEATABLE READ` transaction:

1. `W_now = pg_snapshot_xmin(pg_current_snapshot())` — every transaction with id below `W_now` has finished (committed or aborted) and its committed rows are visible in this snapshot.
2. The page selects changes with `W_prev ≤ xid < W_now`, filtered by the user's scope, ordered by (`xid`, dataset order, row id).
3. When the window is fully consumed, the next cursor carries `W_now` as the new `W_prev`.

Guarantees:
- A transaction still running during a pull has an id ≥ `W_now`, so its rows are delivered by a later window, never skipped.
- Windows partition transaction ids, so each row version is delivered in the window of the transaction that last wrote it. A row rewritten later moves to a later window; the device applies the newest state.
- Delivery is at-least-once across retries; applying the same upsert or delete twice is harmless.

Operational constraints:
- A long-running transaction holds `W_now` back and delays delivery for everyone. Long transactions on synchronizable tables are forbidden; batch jobs commit in chunks; the age of the oldest open transaction is monitored.
- Pulls read from the primary database.

### 3.3 Cursor — PROPOSED

The cursor is opaque to the device. It contains at least: protocol version, `W_prev`, the fixed `W_now` of the window in progress, and a continuation key within the window.

---

## 4. Scope changes — PROPOSED (SYNC-3)

### 4.1 Scope events

- Every change that alters who can see an account or record writes scope events **in the same transaction** as the change.
  - Examples: owner change, attendant added/removed, record responsible changed, team membership or manager change.
- Event content: user, object type (`account` or `record`), object id, change (`entered` / `left`), stamped `xid8`.
- Role, team or permission changes that affect a user broadly write a `resync_required` event for that user.
- Changes to which reference data applies to a user (e.g. applicable price tables) write a reference-dataset resync event for affected users.
- The central policy module (AUTH-4) determines affected users; scope logic is not reimplemented in sync code.

### 4.2 Account-scoped data requirement

Every account-scoped synchronizable table has a non-null `account_id`. This is what makes a complete account bundle computable.

### 4.3 Processing a window

For a user, within one window, in `xid` order:

1. `resync_required` → the device discards all synchronized datasets (never the outbox) and performs an initial load.
2. `left` (account) → `bundle_delete(account_id)`: the device deletes the account and all account-scoped rows. `left` (record) → delete that record.
3. `entered` (account) → full bundle: the account and all its account-scoped rows within retention windows, regardless of their `xid`. `entered` (record) → that record.
4. Reference-dataset resync → full replacement of that dataset.
5. Regular upserts, deletes and tombstones, filtered by the user's current scope.

### 4.4 Initial load

A full scoped download in pages, resumable from the last completed page, with progress shown to the user. It establishes the first `W_prev`.

### 4.5 Local cleanup

On every sync the device deletes local rows that fall outside retention windows (§2.2), except rows referenced by pending outbox commands.

---

## 5. Pull endpoint — PROPOSED (shape)

```text
GET /sync/pull?cursor=<opaque>&limit=<n>
Headers: protocol version, device identity (session per AUTH-1)

200 {
  changes: [ upsert | delete | bundle_delete | record_delete | dataset_reset | resync_required ],
  cursor:  <opaque>,
  has_more: boolean
}
```

- Devices below the minimum supported protocol version are refused with an explicit "update required" response. Version policy: **UNDECIDED R11**.

---

## 6. Push — APPROVED (idempotency and revalidation, P-08) / PROPOSED (shape) / UNDECIDED (ordering, conflicts)

### 6.1 Commands — PROPOSED

- The device records commands in its outbox in creation order, e.g. `createOrder`, `updateOrder`, `createAccount`, `createContact`, `createActivity`, `completeActivity`.
- Each command carries:
  - `command_id` (UUIDv7): idempotency key;
  - `entity_id` (UUIDv7): identity of the affected record;
  - command type and payload;
  - client creation time (informational only).
- `POST /sync/push` sends commands in batches.

### 6.2 Processing — APPROVED (P-08) except the DATA-3 identifier rules (PROPOSED)

- The server stores each command's outcome keyed by `command_id`. A repeated `command_id` returns the stored outcome with no new effect.
- Each command is revalidated: device status, authorization and scope, prices, discount authority, credit, current state, invariants (P-08).
- UUIDv7 identifiers timestamped more than 1 day in the future are rejected (DATA-3).
- Business logic never orders by identifier (DATA-3).

### 6.2.1 Background work caused by pushed commands — APPROVED (STACK-6)

- Work that must happen after a command is accepted (e.g. submitting an order to Sankhya) is recorded in a business table in the same transaction as the command's effect — for Sankhya, an `integration_outbox` record — together with its pg-boss job.
- pg-boss jobs are execution triggers only. The command outcome (keyed by `command_id`, P-08) and the outbox record are the durable records. A replayed job is harmless because delivery checks the SNK-4 origin identifier first; **[PROPOSED]** a periodic sweep re-creates jobs for outbox records left pending without a job.
- Later Sankhya results (accepted, rejected, integration error) change the business record and reach the device through normal pull (mechanics PROPOSED, §3–§5).

### 6.3 Outcomes — PROPOSED (spec §10.2)

| Outcome | Meaning |
|---|---|
| `accepted` | Applied; resulting state returned |
| `rejected` | Not applied; human-readable reason |
| `needs_review` | Applied into a review state (e.g. `revisao_preco`) requiring user action |

### 6.4 Open items — UNDECIDED

| Ref | Topic |
|---|---|
| R06 | Processing order per device; declared dependencies between commands; outcome of dependents when a parent is rejected (e.g. customer rejected with pending order) |
| R05 | Base version sent with edits; rule when a field changed on the server after that version; which fields reject instead of applying |
| R05 | Whether business timestamps use server receive time |
| R07 | Which order states accept edits; edits arriving while awaiting approval |
| R09 | Final naming and roles of `command_id`, `entity_id` and the Sankhya outbox idempotency key |

---

## 7. Conflict rules

| Case | Rule | Status |
|---|---|---|
| Data mirrored from Sankhya | Read-only on device; server always wins | APPROVED (P-02) |
| Applicable price changed since offline creation | Order goes to `revisao_preco`; user sees previous price, current price and affected items; approval rules re-evaluated after confirmation | APPROVED (P-09); displayed content PROPOSED (spec §10.3) |
| Order already submitted to Sankhya | Not editable in Sales Force | PROPOSED (spec §10.3) |
| CRM record edited on two sides | Spec's per-field "latest `updated_at`" rule is not approved | UNDECIDED R05 |
| Account left scope with a pending command | Command rejected with reason; local data removed per §4.3 | PROPOSED (spec §10.3, R06) |

---

## 8. Device lifecycle interplay — PROPOSED (AUTH-2, RF-IAM-7, RF-IAM-8)

| Device state | Sync behavior |
|---|---|
| `pending` | Pull and push refused with a device-status response; no business data |
| `approved` | Normal |
| `revoked` | Refused; the app deletes its local database and cached files |
| Offline longer than max period (7 days, configurable) | App blocks use until a successful sync (clock tampering: UNDECIDED R16) |

---

## 9. Local database — PROPOSED (MOB-2) / UNDECIDED (migrations)

- Encrypted SQLite through Drizzle; library per spike S7 (MOB-2, V-09).
- Synchronized datasets are disposable caches: they can always be rebuilt by resync.
- The outbox (and drafts, if R08 keeps them local) is the only data that cannot be rebuilt.
- Local schema migration with pending commands under OTA updates: **UNDECIDED R10**. Interim rule (PROPOSED, conservative): until decided, a change to the local schema or to this protocol ships only in a new app binary with a protocol version bump.
- Lost encryption key: **UNDECIDED R45**.

---

## 10. Sync triggers on the device — PROPOSED (spec §10.4)

- App opened.
- Connectivity regained.
- Every 15 minutes in foreground.
- Manual "sync now".
- After saving an order, when online.

---

## 11. Required tests — PROPOSED

| Area | Tests |
|---|---|
| Watermark | Concurrent transactions committing out of id order: no row skipped; long transaction delays but does not lose rows (V-07) |
| Mirror | Unchanged Sankhya rows produce no new stamps |
| Scope | Account reassignment: new owner receives full bundle, previous owner receives `bundle_delete`; attendant add/remove; record responsible change; team change → `resync_required` |
| Authorization | Pull never returns out-of-scope rows for each profile; no cost/margin fields in any dataset |
| Push | Replay of the same `command_id` returns the same outcome without duplicate effects; revalidation of price, discount authority and credit |
| Price revision | Changed price produces `needs_review` with previous/current prices |
| Device | `pending` and `revoked` devices receive no data; revocation triggers wipe on the device |
| Initial load | Resumes after interruption without duplicates |

---

## 12. Open items summary

R05, R06, R07, R08, R09, R10, R11, R16, R45, and data volume sizing V-14 — all at the Phase 1 gate (`roadmap.md`).
