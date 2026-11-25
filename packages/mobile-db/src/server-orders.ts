import type { SqlDatabase, SqlExecutor, SqlRow } from "./connection";
import { readExpectedDataset } from "./dataset-identity";
import type { OfflineEnv } from "./offline-env";
import { forgetOrderErpStatus } from "./order-erp-status";
import { ipiJsonOf, priceContextOf, TransportError, type OrderTransport, type RemoteOrder } from "./order-sync";

/**
 * Orders of the signed-in account that exist on the server (made on the site or on another device), merged into the local
 * order list so the app and the site show the same orders (parity matrix, Lote 0).
 *
 * - The server's ids are the identity: an order already held locally (made here, or merged before) is never inserted twice.
 * - Read-only on the device unless the existing rule (`isSubmittedReadOnly`) lets it be edited; a held order is edited like any
 *   synced draft (`order.replace` against its version).
 * - A local row with unfinished work (an open outbox command, a send request, a status other than `synced`) is never overwritten.
 * - Nothing is deleted here (never a row an outbox command references).
 * - No cost or margin: the list item and the detail never carry them (P-20).
 */
export interface ServerOrderSummary {
  readonly id: string;
  readonly version: number;
  /** Server order status (`draft`, `awaiting_approval`, `approved`, `approval_rejected`, `queued`, `sent`, `rejected`, `unknown`). */
  readonly status: string;
  readonly erpNumber: number | null;
  /** Seller-facing reason of the last refused delivery (only on `rejected`); `null` otherwise. */
  readonly deliveryError: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ServerOrdersSource {
  /** Every order of the signed-in account (`GET /orders?mine=true`, all pages). A failed read THROWS. */
  fetchServerOrders?(): Promise<readonly ServerOrderSummary[]>;
}

export interface MergeResult {
  readonly added: number;
  readonly updated: number;
  /** Orders whose detail could not be read now; retried by the next sync. */
  readonly skipped: number;
  /** Local copies dropped because the server no longer reports the order (RT-1). */
  readonly removed: number;
}

async function hasOpenWork(tx: SqlExecutor, localId: string): Promise<boolean> {
  const rows = await tx.query<SqlRow>(
    "SELECT 1 AS hit FROM outbox WHERE draft_local_id = ? AND state IN ('pending', 'sending', 'rejected', 'needs_review', 'conflict') LIMIT 1",
    [localId],
  );
  return rows.length > 0;
}

/**
 * Drops the local copy (lines, cached ERP status) of server orders that no longer exist (RT-1). A row with open work is KEPT:
 * an outbox command (pending, sending, rejected, needs_review, conflict), a send request or a status other than `synced`.
 * Meant to run inside a transaction. Returns how many copies were removed.
 */
export async function dropRemovedServerOrders(db: SqlExecutor, ownerAccountId: string, remoteIds: readonly string[]): Promise<number> {
  let removed = 0;
  for (const remoteId of remoteIds) {
    const rows = await db.query<SqlRow>("SELECT local_id, status, send_state FROM local_order_draft WHERE remote_id = ? AND owner_account_id = ? AND kind = 'saved'", [remoteId, ownerAccountId]);
    for (const row of rows) {
      const localId = String(row.local_id);
      const settled = String(row.status) === "synced" && (row.send_state === null || row.send_state === undefined || String(row.send_state) === "submitted");
      if (!settled || (await hasOpenWork(db, localId))) continue;
      await db.execute("DELETE FROM outbox WHERE draft_local_id = ?", [localId]);
      await db.execute("DELETE FROM local_order_item WHERE draft_local_id = ?", [localId]);
      await db.execute("DELETE FROM local_order_draft WHERE local_id = ?", [localId]);
      removed += 1;
    }
    const left = await db.query<SqlRow>("SELECT 1 AS hit FROM local_order_draft WHERE remote_id = ? AND owner_account_id = ? LIMIT 1", [remoteId, ownerAccountId]);
    if (left.length === 0) await forgetOrderErpStatus(db, remoteId);
  }
  return removed;
}

/** At or above this many settled local copies an EMPTY server list is treated as a glitch, not as "everything was removed" (mass-delete guard). */
const MASS_GUARD = 5;

/**
 * A settled local copy of a server order that the complete list of the account no longer holds was removed on the server: it goes
 * (RT-1). The list is complete here (a failed page throws before this runs).
 */
async function dropAbsentServerOrders(db: SqlDatabase, ownerAccountId: string, present: ReadonlySet<string>): Promise<number> {
  const rows = await db.query<SqlRow>(
    "SELECT DISTINCT remote_id FROM local_order_draft WHERE owner_account_id = ? AND kind = 'saved' AND remote_id IS NOT NULL AND status = 'synced' AND (send_state IS NULL OR send_state = 'submitted')",
    [ownerAccountId],
  );
  const absent = rows.map((row) => String(row.remote_id)).filter((id) => !present.has(id));
  if (absent.length === 0) return 0;
  if (present.size === 0 && rows.length >= MASS_GUARD) return 0;
  return db.transaction((tx) => dropRemovedServerOrders(tx, ownerAccountId, absent));
}

/** `draft` = nothing was sent (no send state); any other server status means the order was handed to the server for Sankhya. */
function sendFields(order: ServerOrderSummary): { state: string | null; code: string | null; error: string | null } {
  if (order.status === "draft") return { state: null, code: null, error: null };
  return { state: "submitted", code: order.status, error: order.status === "rejected" ? order.deliveryError : null };
}

async function writeItems(tx: SqlExecutor, localId: string, order: RemoteOrder): Promise<void> {
  await tx.execute("DELETE FROM local_order_item WHERE draft_local_id = ?", [localId]);
  for (const [index, item] of order.items.entries()) {
    await tx.execute(
      `INSERT INTO local_order_item (draft_local_id, position, product_code, description, unit, quantity, discount_percent, price_json, group_code, group_name, ipi_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)`,
      [localId, index + 1, item.productCode, item.productDescription, item.unit, item.quantity, item.discountPercent, priceContextOf(item), ipiJsonOf(item)],
    );
  }
}

/** Reads the detail of one order; a dead session stops the merge, any other failure only skips this order. */
async function readDetail(transport: OrderTransport, id: string): Promise<RemoteOrder | null> {
  try {
    return await transport.getOrder(id);
  } catch (error) {
    if (error instanceof TransportError && error.kind === "auth") throw error;
    return null;
  }
}

export async function mergeServerOrders(
  db: SqlDatabase,
  env: OfflineEnv,
  source: ServerOrdersSource,
  transport: OrderTransport,
  ownerAccountId: string,
  onProgress?: (done: number, total: number) => void,
): Promise<MergeResult> {
  const result = { added: 0, updated: 0, skipped: 0, removed: 0 };
  if (source.fetchServerOrders === undefined) return result;
  const confirmed = await readExpectedDataset(db);
  if (confirmed === null) return result;
  const list = await source.fetchServerOrders();
  result.removed = await dropAbsentServerOrders(db, ownerAccountId, new Set(list.map((o) => o.id)));
  let done = 0;
  for (const summary of list) {
    onProgress?.(done, list.length);
    done += 1;
    const known = await db.query<SqlRow>(
      "SELECT local_id, status, remote_version, send_state FROM local_order_draft WHERE remote_id = ? AND owner_account_id = ? AND kind = 'saved'",
      [summary.id, ownerAccountId],
    );
    const send = sendFields(summary);
    if (known[0] === undefined) {
      const detail = await readDetail(transport, summary.id);
      if (detail === null) {
        result.skipped += 1;
        continue;
      }
      const added = await db.transaction(async (tx) => {
        // Another writer may have bound this server order meanwhile (the order push): never a second row.
        if ((await tx.query<SqlRow>("SELECT 1 AS hit FROM local_order_draft WHERE remote_id = ? AND owner_account_id = ?", [summary.id, ownerAccountId])).length > 0) return false;
        const localId = env.newId();
        await tx.execute(
          `INSERT INTO local_order_draft (local_id, owner_account_id, client_request_id, customer_code, customer_name, negotiation_type_code, top_code, carrier_code, freight_type, notes,
             status, remote_id, remote_version, remote_draft_number, estimated_total, created_at, updated_at, dataset_environment, dataset_id, eligibility,
             send_state, send_code, send_error, erp_number)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced', ?, ?, ?, ?, ?, ?, ?, ?, 'eligible', ?, ?, ?, ?)`,
          [
            localId, ownerAccountId, `server-${summary.id}`, detail.customerCode, detail.customerName, detail.negotiationTypeCode, detail.topCode, detail.carrierCode, detail.freightType ?? null,
            detail.notes, summary.id, summary.version, detail.draftNumber, detail.estimatedTotal, summary.createdAt, summary.updatedAt, confirmed.environment, confirmed.datasetId,
            send.state, send.code, send.error, summary.erpNumber,
          ],
        );
        await writeItems(tx, localId, detail);
        return true;
      });
      if (added) result.added += 1;
      continue;
    }
    const localId = String(known[0].local_id);
    const localState = known[0].send_state === null || known[0].send_state === undefined ? null : String(known[0].send_state);
    // Only a settled row follows the server: synced, no open command, no send request or definitive refusal of its own.
    if (String(known[0].status) !== "synced" || (localState !== null && localState !== "submitted")) continue;
    const moved = Number(known[0].remote_version ?? 0) !== summary.version;
    const detail = moved ? await readDetail(transport, summary.id) : null;
    if (moved && detail === null) {
      result.skipped += 1;
      continue;
    }
    const changed = await db.transaction(async (tx) => {
      if (await hasOpenWork(tx, localId)) return false;
      const current = (await tx.query<SqlRow>("SELECT status, send_state FROM local_order_draft WHERE local_id = ?", [localId]))[0];
      if (current === undefined || String(current.status) !== "synced" || (current.send_state !== null && String(current.send_state) !== "submitted")) return false;
      if (detail !== null) {
        await tx.execute(
          `UPDATE local_order_draft SET customer_code = ?, customer_name = ?, negotiation_type_code = ?, top_code = ?, carrier_code = ?, freight_type = ?, notes = ?,
             remote_version = ?, remote_draft_number = ?, estimated_total = ? WHERE local_id = ?`,
          [detail.customerCode, detail.customerName, detail.negotiationTypeCode, detail.topCode, detail.carrierCode, detail.freightType ?? null, detail.notes, summary.version, detail.draftNumber, detail.estimatedTotal, localId],
        );
        await writeItems(tx, localId, detail);
      }
      await tx.execute(
        "UPDATE local_order_draft SET send_state = ?, send_code = ?, send_error = ?, erp_number = COALESCE(?, erp_number), updated_at = ? WHERE local_id = ?",
        [send.state, send.code, send.error, summary.erpNumber, summary.updatedAt, localId],
      );
      return true;
    });
    if (changed) result.updated += 1;
  }
  onProgress?.(list.length, list.length);
  return result;
}
