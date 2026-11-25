# Release queue "Aguardando liberação" (backend, 2026-11-23)

Status: implemented backend/worker/contract (no UI yet, no notification). Owner decision of 2026-11-23: the release stays in Sankhya (event 44 cascade: level 1 Pedidos, level 2 Financeiro; events 2, 3, 13). The Force does NOT write any release; it shows internal staff who must release what. Facts and open validations: `docs/sankhya-spike.md` 9.60 and 9.61.

## Flow

1. Worker `OrderErpStatusJob` and the on-demand `orderStatus` step (`POST /sync/refresh`, 60 s reuse) call `runOrderStageOnce` (see `order-status-following-sankhya.md`). `readOrderStageFacts` (SELECT only) also returns, per pending TSILIB line, the event, `SEQCASCATA` and (soft query) `CODUSULIB`.
2. For orders classified `in_review` or `financial_check`, `syncReleaseQueue` replaces the order's rows in `sales_order_release_pending` (migration 0041, expand-only): one row per line and sector, `first_seen_at` and `notified_at` preserved, rows no longer pending deleted (released in Sankhya, or the order moved on).
3. `GET /api/.../release-queue` and `/release-queue/count` read the mirror; nothing calls Sankhya from the API.

Orders covered: those the Force sent (`sales_order.status='sent'`, with `erp_number`), not every note of the ERP. Orders older than 90 days are no longer read (their rows would stay stale): a retention clean-up is not built (NEEDS DECISION if wanted).

## Sector mapping (configuration, never literals)

`erp.orderStage` (existing) names the sectors: `reviewSector` (default `Pedidos`) and `financialSector` (default `Financeiro`). Per pending line: a review event (default 44 at cascade 1, and event 2) -> review sector; any other event (44 level 2/3, 3, ...) -> financial sector; an event in `erp.orderStage.bothSectorsEvents` (default `[13]`, PROPOSAL, owner survey says 13 = both) -> a row in each sector, counted once in `total`. The stage the seller sees is unchanged (13 stays "Conferência financeira").

## Contract (additive)

- `listReleaseQueue` GET `/release-queue` query `page`, `pageSize`, `sector`, `sellerCode`, `assignedUserCode`; response `ReleaseQueueResponse` (`items`, `page`, `pageSize`, `total`). Sorted oldest waiting first (`waitingSince`, then NUNOTA).
- `getReleaseQueueCount` GET `/release-queue/count` query `sector`; response `ReleaseQueueCountResponse` {`total`, `sectors[{sector,count}]`, `lastCheckedAt`} for the menu counter.
- Item: `nunota` (unique Sankhya note number to search in Sankhya), `orderId`, `draftNumber`, `sector`, `event`, `cascadeSequence`, `eventLabel`, `customerCode/Name`, `sellerCode/Name`, `estimatedTotal` (Force estimate, not the ERP value), `topCode`, `orderedAt`, `waitingSince`, `waitingSinceSource` (`order_time` today), `waitingMinutes`, `firstSeenAt`, `assignedUserCode`, `checkedAt`. No cost, margin or customer contact data.
- "Atualizar agora" = existing `POST /sync/refresh` (any signed-in profile may call it).
- No deep link: none is documented for Sankhya; the row shows NUNOTA only (spike 9.61 e).

## Release level "Nível N" (owner decision 2026-11-25; fact in `sankhya-spike.md` 9.63, informed by the owner)

The level an order awaits is `TSILIB.SEQCASCATA` of its EVENTO 44 lines: the order waits for the LOWEST level still pending (`DHLIB` null). `TSILIM` and `erp.releaseQueue.sectorUsers` NEVER define the level (TSILIM is not read at all). Any TOP. An order with no TSILIB line is "Ainda não confirmado no Sankhya", a normal state. The Force releases nothing.

- Domain: `awaitedReleaseLevel(lines)` -> `{ state: 'awaiting'|'none'|'not_confirmed', level }`, and `releaseLevelText(state)` ("Nível N" / "Ainda não confirmado no Sankhya" / `null`), `packages/domain/src/release-level.ts`. Reproved lines do not alter the level (Barrado stays a stage).
- Worker: `readOrderStageFacts` returns `releaseLines` (every TSILIB line: event, cascadeSequence, released, reproved); the worker stores `release_state` and `awaited_level` on `sales_order_erp_stage` (migration 0047, expand-only, nullable; outside the content hash, so a level change never moves `updatedAt`). Absent `releaseLines` keeps the stored level. Null state in the contract = not read with the level yet.
- Stage and sectors are UNCHANGED (event 44 cascade 1 -> Pedidos, other pending -> Financeiro, Barrado beats review): see "Contradictions" below.

### Contract for the site and the app (additive; old clients ignore it)

`ReleaseLevel` = `{ state: 'awaiting' | 'none' | 'not_confirmed', level: number | null, text: string | null }`.

| Where | Field |
|---|---|
| Release queue item (`GET /release-queue`) | `releaseLevel` (nullable, optional): the level the ORDER awaits, repeated on each row of the order |
| Order list/detail (`GET /orders`, `GET /orders/{id}`) | `erpStage.releaseLevel` (nullable, optional) |

Show `releaseLevel.text` AS IS, in both site and app (never rebuild the text): "Nível 1", "Nível 2", ... when `awaiting`; "Ainda não confirmado no Sankhya" when `not_confirmed`; nothing when `text` is null (`none`, or `releaseLevel` null/absent). Show it only while the order is in the queue or in review/financial check; on a barred, dispatched or invoiced order the clients may hide it. No cost, margin or Sankhya identifier is involved. Offline app: the field comes with the order the server returns; cache `text` like the rest of `erpStage`.

### Contradictions with earlier approved material (kept as approved, for the owner to rule)

1. `erp.releaseQueue.sectorUsers` is APPROVED access control for the `operations` profile (D-AS), not a level source; ignoring it would lock `operations` out of the queue. Kept for access only; it plays no part in the level. The owner can remove it by a new decision that also says who sees which sector.
2. `erp.orderStage.reviewEvents` default `{ event: 44, cascadeSequence: 1 }` and `sectorsOfPendingRelease` map level 1 -> Pedidos and levels 2/3 -> Financeiro, and `in_review`/`financial_check` follow that. The 2026-11-25 decision only defines the level, not who owns level 3 or the stage name; stage and sector logic untouched.
3. The queue lists one row per line AND sector; the level is per ORDER (lowest pending), so a row for level 2 of an order awaiting level 1 shows "Nível 1".
4. Old orders with `SEQCASCATA` 0 show "Nível 0".

## Permissions (owner ruling 2026-11-23, option A; deny by default)

New permission `release_queue.read:<sector>` decided by `visibleReleaseQueueSectors` (domain) and enforced in the service, with the route grant `listReleaseQueue`/`getReleaseQueueCount` in `ROUTE_POLICY` for `admin`, `manager` and `operations` (seller and technical refused).
- `admin`, `manager`: every sector.
- `operations` (new role, owner ruling 2026-11-23, option A): only the sectors under which the installation configuration lists its Sankhya user code (CODUSU = `account.external_user_id`). Not listed = 403.
- `seller`: NEVER (403), even when its CODUSU is listed in configuration. The earlier seller exception is removed.
- Configuration key `erp.releaseQueue.sectorUsers` (access of `operations` to a sector only; NOT the release level, 2026-11-25): `{ "Pedidos": [CODUSU...], "Financeiro": [CODUSU...] }`. Absent = nobody beyond admin/manager.

### The `operations` role (owner ruling 2026-11-23, option A; to be recorded in decisions.md by the owner)

Internal staff of Pedidos/Financeiro. Web only (never mobile). Deny by default: the only routes granted are login/logout, the session refresh (`startSyncRefresh`, `getSyncRefresh`, "Atualizar agora"), `listReleaseQueue` and `getReleaseQueueCount`. No orders, customers, products, prices, cost/margin, dashboard, approvals, configuration, admin or export. It never carries a seller link (database trigger, migration 0042). It is an external-only role like manager: no local password, it signs in through the Sankhya directory login (AUTH_MODE external guards and `assertSafeAuthConfig` refuse it as a local-password role).

Provisioning: `account create-external --role operations` (no seller code) with the person's CODUSU, then add that CODUSU to `erp.releaseQueue.sectorUsers` under "Pedidos" and/or "Financeiro" in `installation.json` and rerun `config-bootstrap` (deploy/README-staging.md). An operations account with no listed sector signs in but sees 403 on the queue.

## Notification (4.5, not built)

Ready: `first_seen_at` is the "entered the queue" marker and `notified_at` is the hook (a future notifier selects `notified_at is null`, sends, sets it, in the same transaction). Needed later: SMTP configuration (OPS decision, none in the repo for this), per-user preference and recipient mapping (sector -> users already in `erp.releaseQueue.sectorUsers`, plus an e-mail per account), and push tokens for web (none exist; web push is not designed).

## Force approval vs Sankhya cascade (4.2.6)

The Force discount approval (DISC-2, `awaiting_approval`, seller -> manager -> director) happens BEFORE the order reaches Sankhya and never appears in this queue, which lists only notes already in Sankhya; staff can confuse them only by name ("liberação"), so the screen labels this queue "Liberação no Sankhya".

## NEEDS VALIDATION

`CODUSULIB`, request-time column, `SEQCASCATA` readable by the worker user; meaning of null `CODUSULIB`; event 13 sectors; releaser name; deep link; stale-row retention beyond 90 days.

## Deploy order

Apply migrations 0041 and 0042 (0042 only widens `account_role_chk` and the seller-link guard triggers; no new grant) and the `deploy/staging/db-roles.sql` grants, then server (API + worker), then web. The contract and configuration changes are additive; without `erp.releaseQueue` only admin/manager see the queue. Web must know the `operations` role before such accounts are created.

## Tests needed (final stage)

Queue by sector and by profile (admin/manager all, configured operations only its sector, unlisted operations, seller (even if listed) and technical 403, forbidden `sector` filter 403, authorization matrix rows for the two operationIds); mirror update from the fake gateway state machine (`stageFacts` with pending lines, event 13 in both sectors, assignee soft-failure via `assigneeReadErrorCode`); pending -> released leaves the queue; read failure keeps rows; counts (orders once in `total`); no cost/margin fields; migration 0041 + grants; domain `sectorsOfPendingRelease` and `visibleReleaseQueueSectors` unit tests.
