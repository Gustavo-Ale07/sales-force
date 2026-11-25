import type { SqlDatabase, SqlExecutor, SqlRow } from "./connection";
import type { OfflineEnv } from "./offline-env";
import { isoNow } from "./offline-env";
import type { DraftErpStage } from "./local-orders";
import { deleteMeta, getMeta, setMeta } from "./reference-cache";
import { dropRemovedServerOrders } from "./server-orders";

/**
 * ERP status of one order the device holds, as the server last read it from the ERP (`GET /orders?ids=`, owner ruling
 * 2026-11-13). Read-only on the device: never edited locally, never derived. `code` / `label` / `invoiceNumber` / `checkedAt`
 * are `null` when the server has not read the ERP status yet (the order may still have an ERP number).
 */
export interface OrderErpStatus {
  readonly orderId: string;
  readonly erpNumber: number | null;
  readonly code: number | null;
  readonly label: string | null;
  readonly invoiceNumber: number | null;
  readonly checkedAt: string | null;
  /** Stage following Sankhya as the server classified it. Absent/`null` = an old server, or not read yet: the last known one is kept. */
  readonly stage?: DraftErpStage | null;
}

/**
 * Answer of one status read. `removedIds` (RT-1): requested orders whose ERP note no longer exists in Sankhya; the device drops its
 * copy of them unless it holds unsent work. Absent on an old server.
 */
export type OrderStatusAnswer = readonly OrderErpStatus[] & { readonly removedIds?: readonly string[] };

/** What the sync manager needs from the source to refresh the statuses. */
export interface OrderStatusSource {
  /** At most `ORDER_STATUS_CHUNK` ids per call. Returns only the orders inside the account's scope; an id not returned is out of scope. */
  fetchOrderStatuses?(orderIds: readonly string[]): Promise<OrderStatusAnswer>;
}

/** The server accepts at most this many ids per request (`MAX_ORDER_IDS_FILTER`). */
export const ORDER_STATUS_CHUNK = 100;

/** Stored in the key/value metadata (no schema change, interim rule); the `cache.` prefix makes the sign-out cache clear remove it. */
const keyOf = (orderId: string) => `cache.order_erp_status.${orderId}`;

/** Removes the cached ERP status of an order (it left the device). */
export async function forgetOrderErpStatus(tx: SqlExecutor, orderId: string): Promise<void> {
  await deleteMeta(tx, keyOf(orderId));
}

async function sentOrderIds(db: SqlExecutor, ownerAccountId: string): Promise<string[]> {
  const rows = await db.query<SqlRow>("SELECT DISTINCT remote_id FROM local_order_draft WHERE owner_account_id = ? AND remote_id IS NOT NULL ORDER BY remote_id", [ownerAccountId]);
  return rows.map((row) => String(row.remote_id));
}

/** The Sankhya number never changes once assigned: only a known number is written (an unknown one never clears a known one). */
async function storeErpNumber(tx: SqlExecutor, ownerAccountId: string, remoteId: string, erpNumber: number | null): Promise<void> {
  if (erpNumber === null) return;
  await tx.execute("UPDATE local_order_draft SET erp_number = ? WHERE owner_account_id = ? AND remote_id = ?", [erpNumber, ownerAccountId, remoteId]);
}

/**
 * Reads the ERP status of every order of this account that exists on the server, in chunks, and stores it. An order the server
 * does not return (outside the scope now) loses its stored status. A failed read THROWS (the caller reports it) and keeps what was
 * stored: nothing is deleted for a chunk that was not answered. Nothing happens without the capability or without sent orders.
 */
export async function refreshOrderErpStatuses(db: SqlDatabase, env: OfflineEnv, source: OrderStatusSource, ownerAccountId: string, onProgress?: (done: number, total: number) => void): Promise<void> {
  if (source.fetchOrderStatuses === undefined) return;
  const ids = await sentOrderIds(db, ownerAccountId);
  for (let start = 0; start < ids.length; start += ORDER_STATUS_CHUNK) {
    const chunk = ids.slice(start, start + ORDER_STATUS_CHUNK);
    const answered = await source.fetchOrderStatuses(chunk);
    const now = isoNow(env);
    const byId = new Map(answered.filter((s) => chunk.includes(s.orderId)).map((s) => [s.orderId, s]));
    const removed = new Set((answered.removedIds ?? []).filter((id) => chunk.includes(id)));
    await db.transaction(async (tx) => {
      for (const id of chunk) {
        const found = byId.get(id);
        if (removed.has(id)) {
          // Deleted in the ERP: the copy goes (kept when it holds unsent work, see `dropRemovedServerOrders`).
          await dropRemovedServerOrders(tx, ownerAccountId, [id]);
        } else if (found === undefined) {
          // Out of scope now: the status and the stage go away with it.
          await deleteMeta(tx, keyOf(id));
          await tx.execute("UPDATE local_order_draft SET erp_stage = NULL, erp_stage_json = NULL WHERE owner_account_id = ? AND remote_id = ?", [ownerAccountId, id]);
        } else {
          const { stage, ...status } = found;
          await setMeta(tx, keyOf(id), JSON.stringify(status), now);
          await storeErpNumber(tx, ownerAccountId, id, status.erpNumber ?? stage?.nunota ?? null);
          // Only a stage the server sent replaces the stored one; without it the last known stage stays (offline-safe, old servers).
          if (stage !== undefined && stage !== null) {
            const { stage: code, ...rest } = stage;
            await tx.execute("UPDATE local_order_draft SET erp_stage = ?, erp_stage_json = ? WHERE owner_account_id = ? AND remote_id = ?", [code, JSON.stringify(rest), ownerAccountId, id]);
          }
        }
      }
    });
    onProgress?.(Math.min(start + ORDER_STATUS_CHUNK, ids.length), ids.length);
  }
}

/** Reads and stores the ERP status of ONE order (the confirm wait polls this for the Sankhya number). A failed read throws. */
export async function refreshOneOrderErpStatus(db: SqlDatabase, env: OfflineEnv, source: OrderStatusSource, ownerAccountId: string, remoteId: string): Promise<OrderErpStatus | null> {
  if (source.fetchOrderStatuses === undefined) return null;
  const answer = await source.fetchOrderStatuses([remoteId]);
  if (answer.removedIds?.includes(remoteId) === true) {
    await db.transaction((tx) => dropRemovedServerOrders(tx, ownerAccountId, [remoteId]));
    return null;
  }
  const answered = answer.find((status) => status.orderId === remoteId);
  if (answered === undefined) return null;
  const now = isoNow(env);
  const { stage, ...status } = answered;
  await db.transaction(async (tx) => {
    await setMeta(tx, keyOf(remoteId), JSON.stringify(status), now);
    await storeErpNumber(tx, ownerAccountId, remoteId, status.erpNumber ?? stage?.nunota ?? null);
    if (stage !== undefined && stage !== null) {
      const { stage: code, ...rest } = stage;
      await tx.execute("UPDATE local_order_draft SET erp_stage = ?, erp_stage_json = ? WHERE owner_account_id = ? AND remote_id = ?", [code, JSON.stringify(rest), ownerAccountId, remoteId]);
    }
  });
  return answered;
}

/** The stored statuses of the given server order ids (those without one are simply absent). */
export async function getOrderErpStatuses(db: SqlExecutor, orderIds: readonly string[]): Promise<OrderErpStatus[]> {
  const found: OrderErpStatus[] = [];
  for (const id of orderIds) {
    const raw = await getMeta(db, keyOf(id));
    if (raw === null) continue;
    try {
      found.push(JSON.parse(raw) as OrderErpStatus);
    } catch {
      // A corrupt row is ignored; the next sync rewrites it.
    }
  }
  return found;
}
