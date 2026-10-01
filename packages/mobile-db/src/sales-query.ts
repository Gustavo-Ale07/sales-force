import type { SqlExecutor, SqlRow, SqlValue } from "./connection";
import { operationalDraftSql, type DatasetIdentity } from "./dataset-identity";
import { DRAFT_COLUMNS, toDraft, type DraftRecord, type DraftStatus } from "./local-orders";
import { escapeLike } from "./offline-env";

/**
 * Queries behind the sales list (Central de Vendas). Everything is filtered, counted and paged in SQL.
 *
 * "Não enviados" = anything the Force backend has not fully accepted yet, including a synced order whose later edit is
 * still queued (its status goes back to `pending_sync`). "Enviados" = accepted by the Force backend — NOT delivered to
 * the ERP (ERP submission is disabled).
 */
export type SalesGroup = "unsent" | "sent";
export const UNSENT_STATUSES: readonly DraftStatus[] = ["local_only", "pending_sync", "syncing", "sync_error", "conflict", "needs_review"];
export const SENT_STATUSES: readonly DraftStatus[] = ["synced"];

export interface DraftFilter {
  readonly ownerAccountId: string;
  /**
   * When present (the app always passes it), only drafts that are normal work for this confirmed dataset are listed;
   * `null` (no confirmed dataset) lists none. Omitted = raw query (tests, diagnostics).
   */
  readonly dataset?: DatasetIdentity | null;
  readonly group?: SalesGroup;
  readonly statuses?: readonly DraftStatus[];
  readonly customerCode?: number;
  /** ISO timestamps on the LOCAL creation date (`created_at`): inclusive start, exclusive end. */
  readonly createdFrom?: string;
  readonly createdBefore?: string;
  /** Customer name (contains), customer code or Force order number (exact), local id (prefix). */
  readonly text?: string;
}

function marks(values: readonly unknown[]): string {
  return values.map(() => "?").join(", ");
}

function whereOf(filter: DraftFilter): { sql: string; params: SqlValue[] } {
  const clauses = ["d.owner_account_id = ?"];
  const params: SqlValue[] = [filter.ownerAccountId];
  if (filter.dataset !== undefined) {
    const operational = operationalDraftSql(filter.dataset);
    clauses.push(operational.sql);
    params.push(...operational.params);
  }
  if (filter.group !== undefined) {
    const statuses = filter.group === "unsent" ? UNSENT_STATUSES : SENT_STATUSES;
    clauses.push(`d.status IN (${marks(statuses)})`);
    params.push(...statuses);
  }
  if (filter.statuses !== undefined && filter.statuses.length > 0) {
    clauses.push(`d.status IN (${marks(filter.statuses)})`);
    params.push(...filter.statuses);
  }
  if (filter.customerCode !== undefined) {
    clauses.push("d.customer_code = ?");
    params.push(filter.customerCode);
  }
  if (filter.createdFrom !== undefined) {
    clauses.push("d.created_at >= ?");
    params.push(filter.createdFrom);
  }
  if (filter.createdBefore !== undefined) {
    clauses.push("d.created_at < ?");
    params.push(filter.createdBefore);
  }
  const text = filter.text?.trim() ?? "";
  if (text !== "") {
    const like = escapeLike(text.toLowerCase());
    const parts = ["lower(d.customer_name) LIKE ? ESCAPE '\\'", "d.local_id LIKE ? ESCAPE '\\'"];
    const textParams: SqlValue[] = [`%${like}%`, `${like}%`];
    if (/^\d{1,9}$/.test(text)) {
      parts.push("d.customer_code = ?", "d.remote_draft_number = ?");
      textParams.push(Number(text), Number(text));
    }
    clauses.push(`(${parts.join(" OR ")})`);
    params.push(...textParams);
  }
  return { sql: clauses.join(" AND "), params };
}

export interface DraftRows {
  readonly rows: DraftRecord[];
  readonly total: number;
}

/** One page of the seller's orders, newest update first. */
export async function queryDrafts(db: SqlExecutor, filter: DraftFilter, page: { limit: number; offset: number }): Promise<DraftRows> {
  const { sql, params } = whereOf(filter);
  const count = await db.query<SqlRow>(`SELECT count(*) AS n FROM local_order_draft d WHERE ${sql}`, params);
  const rows = await db.query<SqlRow>(
    `SELECT ${DRAFT_COLUMNS} FROM local_order_draft d WHERE ${sql} ORDER BY d.updated_at DESC, d.local_id LIMIT ? OFFSET ?`,
    [...params, page.limit, page.offset],
  );
  return { rows: rows.map(toDraft), total: Number(count[0]?.n ?? 0) };
}

/** Counts of both groups under the same non-group filters, so the two tabs always agree with the list. */
export async function countDraftsByGroup(db: SqlExecutor, filter: Omit<DraftFilter, "group">): Promise<Record<SalesGroup, number>> {
  const counts: Record<SalesGroup, number> = { unsent: 0, sent: 0 };
  for (const group of ["unsent", "sent"] as const) {
    const { sql, params } = whereOf({ ...filter, group });
    const rows = await db.query<SqlRow>(`SELECT count(*) AS n FROM local_order_draft d WHERE ${sql}`, params);
    counts[group] = Number(rows[0]?.n ?? 0);
  }
  return counts;
}

