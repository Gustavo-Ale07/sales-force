import type { SqlDatabase, SqlExecutor, SqlRow } from "./connection";
import type { OfflineEnv } from "./offline-env";
import { isoNow } from "./offline-env";
import { deleteMeta, getMeta, setMeta } from "./reference-cache";

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
}

/** What the sync manager needs from the source to refresh the statuses. */
export interface OrderStatusSource {
  /** At most `ORDER_STATUS_CHUNK` ids per call. Returns only the orders inside the account's scope; an id not returned is out of scope. */
  fetchOrderStatuses?(orderIds: readonly string[]): Promise<readonly OrderErpStatus[]>;
}

/** The server accepts at most this many ids per request (`MAX_ORDER_IDS_FILTER`). */
export const ORDER_STATUS_CHUNK = 100;

/** Stored in the key/value metadata (no schema change, interim rule); the `cache.` prefix makes the sign-out cache clear remove it. */
const keyOf = (orderId: string) => `cache.order_erp_status.${orderId}`;

async function sentOrderIds(db: SqlExecutor, ownerAccountId: string): Promise<string[]> {
  const rows = await db.query<SqlRow>("SELECT DISTINCT remote_id FROM local_order_draft WHERE owner_account_id = ? AND remote_id IS NOT NULL ORDER BY remote_id", [ownerAccountId]);
  return rows.map((row) => String(row.remote_id));
}

/**
 * Reads the ERP status of every order of this account that exists on the server, in chunks, and stores it. An order the server
 * does not return (outside the scope now) loses its stored status. A failed read THROWS (the caller reports it) and keeps what was
 * stored: nothing is deleted for a chunk that was not answered. Nothing happens without the capability or without sent orders.
 */
export async function refreshOrderErpStatuses(db: SqlDatabase, env: OfflineEnv, source: OrderStatusSource, ownerAccountId: string): Promise<void> {
  if (source.fetchOrderStatuses === undefined) return;
  const ids = await sentOrderIds(db, ownerAccountId);
  for (let start = 0; start < ids.length; start += ORDER_STATUS_CHUNK) {
    const chunk = ids.slice(start, start + ORDER_STATUS_CHUNK);
    const answered = await source.fetchOrderStatuses(chunk);
    const now = isoNow(env);
    const byId = new Map(answered.filter((s) => chunk.includes(s.orderId)).map((s) => [s.orderId, s]));
    await db.transaction(async (tx) => {
      for (const id of chunk) {
        const found = byId.get(id);
        if (found === undefined) await deleteMeta(tx, keyOf(id));
        else await setMeta(tx, keyOf(id), JSON.stringify(found), now);
      }
    });
  }
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
