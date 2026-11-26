import type { SqlDatabase, SqlExecutor, SqlRow } from "./connection";

/** Device cache of the notification central (RF-NOT-2). The text comes from the server already scoped; nothing here carries cost or margin (P-20). */
export interface LocalNotification {
  readonly id: string;
  readonly category: string;
  readonly title: string;
  readonly body: string;
  readonly refType: "order" | "customer_registration" | "task";
  readonly refId: string;
  readonly readAt: string | null;
  readonly createdAt: string;
}

function toNotification(row: SqlRow): LocalNotification {
  return {
    id: String(row.id),
    category: String(row.category),
    title: String(row.title),
    body: String(row.body),
    refType: String(row.ref_type) as LocalNotification["refType"],
    refId: String(row.ref_id),
    readAt: row.read_at === null || row.read_at === undefined ? null : String(row.read_at),
    createdAt: String(row.created_at),
  };
}

/** Replaces the owner's cache with the server list. A read made offline (`read_pending`) is kept read until the server confirms it. */
export async function storeNotifications(db: SqlDatabase, ownerAccountId: string, items: readonly LocalNotification[]): Promise<void> {
  await db.transaction(async (tx) => {
    const pending = new Map((await tx.query<SqlRow>("SELECT id, read_at FROM local_notification WHERE owner_account_id = ? AND read_pending = 1", [ownerAccountId])).map((r) => [String(r.id), String(r.read_at)] as const));
    await tx.execute("DELETE FROM local_notification WHERE owner_account_id = ?", [ownerAccountId]);
    for (const item of items) {
      await tx.execute(
        "INSERT INTO local_notification (id, owner_account_id, category, title, body, ref_type, ref_id, read_at, created_at, read_pending) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [item.id, ownerAccountId, item.category, item.title, item.body, item.refType, item.refId, item.readAt ?? pending.get(item.id) ?? null, item.createdAt, pending.has(item.id) && item.readAt === null ? 1 : 0],
      );
    }
  });
}

export async function listLocalNotifications(db: SqlExecutor, ownerAccountId: string): Promise<LocalNotification[]> {
  const rows = await db.query<SqlRow>("SELECT * FROM local_notification WHERE owner_account_id = ? ORDER BY created_at DESC", [ownerAccountId]);
  return rows.map(toNotification);
}

export async function countUnreadLocal(db: SqlExecutor, ownerAccountId: string): Promise<number> {
  const rows = await db.query<SqlRow>("SELECT COUNT(*) AS n FROM local_notification WHERE owner_account_id = ? AND read_at IS NULL", [ownerAccountId]);
  return Number(rows[0]?.n ?? 0);
}

/** Marks as read on the device at once (`ids` absent = all); the ids are listed by `pendingReadIds` for the next sync. */
export async function markReadLocal(db: SqlExecutor, ownerAccountId: string, nowIso: string, ids?: readonly string[]): Promise<void> {
  if (ids === undefined) {
    await db.execute("UPDATE local_notification SET read_pending = 1, read_at = ? WHERE owner_account_id = ? AND read_at IS NULL", [nowIso, ownerAccountId]);
    return;
  }
  for (const id of ids) await db.execute("UPDATE local_notification SET read_pending = 1, read_at = ? WHERE owner_account_id = ? AND id = ? AND read_at IS NULL", [nowIso, ownerAccountId, id]);
}

export async function pendingReadIds(db: SqlExecutor, ownerAccountId: string): Promise<string[]> {
  return (await db.query<SqlRow>("SELECT id FROM local_notification WHERE owner_account_id = ? AND read_pending = 1", [ownerAccountId])).map((r) => String(r.id));
}
