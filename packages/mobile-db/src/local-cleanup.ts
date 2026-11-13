import type { SqlDatabase, SqlExecutor, SqlRow } from "./connection";
import { countOutbox } from "./local-orders";

/**
 * Work of this account that never reached the server and would be lost if the device forgot it: orders waiting, being sent
 * or needing attention (rejected, conflict, held), and customers still queued or being sent. A customer already handed to
 * the ERP (`awaiting_erp`) or answered (`confirmed`, `rejected`) is not unsent. Counts only the given account.
 */
export async function countUnsentLocalWork(db: SqlExecutor, ownerAccountId: string): Promise<number> {
  const orders = await countOutbox(db, ownerAccountId);
  const customers = Number(
    (await db.query<SqlRow>("SELECT count(*) AS n FROM pending_customer WHERE owner_account_id = ? AND state IN ('queued', 'sending')", [ownerAccountId]))[0]?.n ?? 0,
  );
  return orders.pending + orders.sending + orders.needsAttention + customers;
}

/**
 * Ordinary sign-out with nothing unsent: the reference cache (customers, products, price tables and its bookkeeping) is
 * dropped so the next account never sees it. Session identity rows, drafts and the outbox are untouched; callers check
 * `countUnsentLocalWork` first and keep the cache when something is pending.
 */
export async function clearReferenceCache(db: SqlDatabase): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute("DELETE FROM cache_customer");
    await tx.execute("DELETE FROM cache_product");
    await tx.execute("DELETE FROM cache_table_price");
    await tx.execute("DELETE FROM sync_metadata WHERE key LIKE 'cache.%'");
  });
}

/**
 * Revocation or deactivation: every row of every table is deleted in one transaction (orders and their items, outbox,
 * pending customers, caches, metadata), for every account. The schema stays so the database is usable at the next sign-in.
 * Destructive on purpose: pending commands are lost, which is the point of a wipe (security rules: on revocation delete the local data).
 */
export async function wipeLocalDatabase(db: SqlDatabase): Promise<void> {
  await db.transaction(async (tx) => {
    for (const table of ["outbox", "local_order_item", "local_order_draft", "pending_customer", "cache_customer", "cache_product", "cache_table_price", "sync_metadata"]) {
      await tx.execute(`DELETE FROM ${table}`);
    }
  });
}
