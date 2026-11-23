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

## Permissions (proposal, deny by default)

New permission `release_queue.read:<sector>` decided by `visibleReleaseQueueSectors` (domain) and enforced in the service, with the route grant `listReleaseQueue`/`getReleaseQueueCount` in `ROUTE_POLICY` for `admin`, `manager`, `seller` (technical refused).
- `admin`, `manager`: every sector (owner decision). This does grant the new permission to these two existing profiles.
- `seller`: refused (403) unless the installation configuration lists the account's Sankhya user code under a sector.
- Configuration key `erp.releaseQueue.sectorUsers`: `{ "Pedidos": [CODUSU...], "Financeiro": [CODUSU...] }`. CODUSU is matched to `account.external_user_id` (the directory login stores the Sankhya user code there). Absent = nobody beyond admin/manager.

User link findings: the only Force-to-Sankhya user link is `account.external_user_id` = CODUSU (directory login, AUTH-6; `erp_directory_user` mirrors CODUSU -> CODVEND). The Force roles are `admin`, `manager`, `seller`, `technical`; there are NO Pedidos/Financeiro profiles. NEEDS VALIDATION/BLOCKER for staff access: directory auto-provisioning creates only `seller` accounts and refuses a user with no seller (`no_seller`), and local login is limited to admin/technical, so a pure Pedidos/Financeiro person cannot sign in today. Owner choice needed: (a) a new role (e.g. `operations`, widening `account_role_chk`, channels and the matrix) or (b) letting configured sector users sign in through the directory without a seller. Until then the queue works for admin/manager and for seller accounts listed in configuration.

## Notification (4.5, not built)

Ready: `first_seen_at` is the "entered the queue" marker and `notified_at` is the hook (a future notifier selects `notified_at is null`, sends, sets it, in the same transaction). Needed later: SMTP configuration (OPS decision, none in the repo for this), per-user preference and recipient mapping (sector -> users already in `erp.releaseQueue.sectorUsers`, plus an e-mail per account), and push tokens for web (none exist; web push is not designed).

## Force approval vs Sankhya cascade (4.2.6)

The Force discount approval (DISC-2, `awaiting_approval`, seller -> manager -> director) happens BEFORE the order reaches Sankhya and never appears in this queue, which lists only notes already in Sankhya; staff can confuse them only by name ("liberação"), so the screen labels this queue "Liberação no Sankhya".

## NEEDS VALIDATION

`CODUSULIB`, request-time column, `SEQCASCATA` readable by the worker user; meaning of null `CODUSULIB`; event 13 sectors; releaser name; staff sign-in path (above); deep link; stale-row retention beyond 90 days.

## Deploy order

Apply migration 0041 and the `deploy/staging/db-roles.sql` grants, then server (API + worker), then web. The contract and configuration changes are additive; without `erp.releaseQueue` only admin/manager see the queue.

## Tests needed (final stage)

Queue by sector and by profile (admin/manager all, configured seller only its sector, unlisted seller and technical 403, forbidden `sector` filter 403, authorization matrix rows for the two operationIds); mirror update from the fake gateway state machine (`stageFacts` with pending lines, event 13 in both sectors, assignee soft-failure via `assigneeReadErrorCode`); pending -> released leaves the queue; read failure keeps rows; counts (orders once in `total`); no cost/margin fields; migration 0041 + grants; domain `sectorsOfPendingRelease` and `visibleReleaseQueueSectors` unit tests.
