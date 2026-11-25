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
/** The one definition of "sent to Sankhya" (list group and counters). */
/**
 * Same split as the server (`ORDER_GROUP_STATUSES`, owner 2026-11-25): once the server told its status (`send_code`), only `sent` is "Enviados"; rejected,
 * unknown, queued and the approval states are "Não enviados". Without a code (older rows) the previous rule holds: handed over, or a known Sankhya stage.
 */
const SENT_SQL =
  "(d.status = 'synced' AND CASE WHEN d.send_state = 'submitted' AND d.send_code IS NOT NULL THEN d.send_code = 'sent' ELSE (COALESCE(d.send_state, '') = 'submitted' OR d.erp_stage IS NOT NULL) END)";

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
  /** Last known Sankhya stage codes (any of); only meaningful for sent orders. */
  readonly erpStages?: readonly string[];
  /** ISO timestamps on the LOCAL creation date (`created_at`): inclusive start, exclusive end. */
  readonly createdFrom?: string;
  readonly createdBefore?: string;
  /** Which date the period applies to; `createdAt` (default) or `updatedAt`. */
  readonly dateField?: "createdAt" | "updatedAt";
  /** Product codes (at most 20): orders with a line for those products; `productMatch` `any` (default) or `all`. */
  readonly productCodes?: readonly number[];
  readonly productMatch?: "any" | "all";
  /** Text of a product description (or a product code): orders with a line that contains it. Combines with `productCodes`. */
  readonly productSearch?: string;
  /** Customer name (contains), customer code or Force order number (exact), local id (prefix). */
  readonly text?: string;
}

function marks(values: readonly unknown[]): string {
  return values.map(() => "?").join(", ");
}

function whereOf(filter: DraftFilter): { sql: string; params: SqlValue[] } {
  // A recovery record (an order still being built) is never part of the seller's sales.
  const clauses = ["d.owner_account_id = ?", "d.kind = 'saved'"];
  const params: SqlValue[] = [filter.ownerAccountId];
  if (filter.dataset !== undefined) {
    const operational = operationalDraftSql(filter.dataset);
    clauses.push(operational.sql);
    params.push(...operational.params);
  }
  if (filter.group !== undefined) {
    // "Enviados" = taken by the server for Sankhya (or with a known Sankhya stage). A plain saved order, even one the Force backend already
    // holds as a draft ("Salvo no aparelho"), is still "Não enviados": it never went to Sankhya.
    clauses.push(filter.group === "unsent" ? `NOT ${SENT_SQL}` : SENT_SQL);
  }
  if (filter.statuses !== undefined && filter.statuses.length > 0) {
    clauses.push(`d.status IN (${marks(filter.statuses)})`);
    params.push(...filter.statuses);
  }
  // The stage only exists for sent orders; counting the other group under it would zero that tab.
  if (filter.group !== "unsent" && filter.erpStages !== undefined && filter.erpStages.length > 0) {
    clauses.push(`d.erp_stage IN (${marks(filter.erpStages)})`);
    params.push(...filter.erpStages);
  }
  if (filter.customerCode !== undefined) {
    clauses.push("d.customer_code = ?");
    params.push(filter.customerCode);
  }
  const dateColumn = filter.dateField === "updatedAt" ? "d.updated_at" : "d.created_at";
  if (filter.createdFrom !== undefined) {
    clauses.push(`${dateColumn} >= ?`);
    params.push(filter.createdFrom);
  }
  if (filter.createdBefore !== undefined) {
    clauses.push(`${dateColumn} < ?`);
    params.push(filter.createdBefore);
  }
  const codes = [...new Set(filter.productCodes ?? [])].slice(0, 20);
  if (codes.length > 0) {
    if (filter.productMatch === "all") {
      for (const code of codes) {
        clauses.push("EXISTS (SELECT 1 FROM local_order_item i WHERE i.draft_local_id = d.local_id AND i.product_code = ?)");
        params.push(code);
      }
    } else {
      clauses.push(`EXISTS (SELECT 1 FROM local_order_item i WHERE i.draft_local_id = d.local_id AND i.product_code IN (${marks(codes)}))`);
      params.push(...codes);
    }
  }
  const productText = filter.productSearch?.trim() ?? "";
  if (productText !== "") {
    const like = escapeLike(productText.toLowerCase());
    const parts = ["lower(i.description) LIKE ? ESCAPE '\\'"];
    const textParams: SqlValue[] = [`%${like}%`];
    if (/^\d{1,9}$/.test(productText)) {
      parts.push("i.product_code = ?");
      textParams.push(Number(productText));
    }
    clauses.push(`EXISTS (SELECT 1 FROM local_order_item i WHERE i.draft_local_id = d.local_id AND (${parts.join(" OR ")}))`);
    params.push(...textParams);
  }
  const text = filter.text?.trim() ?? "";
  if (text !== "") {
    const like = escapeLike(text.toLowerCase());
    const parts = ["lower(d.customer_name) LIKE ? ESCAPE '\\'", "d.local_id LIKE ? ESCAPE '\\'"];
    const textParams: SqlValue[] = [`%${like}%`, `${like}%`];
    if (/^\d{1,9}$/.test(text)) {
      // The Sankhya number is the only order number the seller knows (the internal Force number is never shown).
      parts.push("d.customer_code = ?", "d.erp_number = ?");
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

