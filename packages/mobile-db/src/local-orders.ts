import type { SqlDatabase, SqlExecutor, SqlRow } from "./connection";
import {
  DatasetUnavailableError,
  isOperationalEligibility,
  operationalDraftSql,
  readExpectedDataset,
  sameDataset,
  type DatasetIdentity,
  type Eligibility,
} from "./dataset-identity";
import { isoNow, type OfflineEnv } from "./offline-env";

/**
 * Local order drafts and the outbox commands that carry them to the server.
 *
 * - The seller's work is durable the moment `saveOrderDraft` resolves: draft, items and outbox command are written
 *   in ONE transaction, so an app kill can never leave a draft without its command or the reverse.
 * - Prices held here are a SNAPSHOT of the cache at edit time (potentially stale). They are never sent as truth: the
 *   server resolves prices again and a difference goes to review, never silently replaced (P-09).
 * - `client_request_id` of the draft is the idempotency key of its create command (same `clientRequestId` the online
 *   `POST /orders` uses). It is minted once and reused on every retry (SNK-4 / P-08).
 * - No cost or margin field exists in these shapes (P-20).
 */

export type DraftStatus = "local_only" | "pending_sync" | "syncing" | "synced" | "sync_error" | "conflict" | "needs_review";
export type OutboxState = "pending" | "sending" | "accepted" | "rejected" | "needs_review" | "conflict";
export type OutboxType = "order.create" | "order.replace";

export interface DraftItemInput {
  readonly productCode: number;
  readonly description: string;
  readonly unit: string;
  /** Decimal string, already validated by `packages/domain` in the editor. */
  readonly quantity: string;
  /** Decimal string; "0" when there is no discount. */
  readonly discountPercent: string;
  /** JSON of the list-price context the seller saw (the cache snapshot). */
  readonly priceJson: string;
  readonly groupCode: number | null;
  readonly groupName: string | null;
}

export interface SaveDraftInput {
  readonly ownerAccountId: string;
  /** Present when editing an existing local draft. */
  readonly localId?: string;
  readonly customerCode: number;
  readonly customerName: string;
  readonly negotiationTypeCode: number | null;
  readonly notes: string | null;
  readonly items: readonly DraftItemInput[];
}

export interface DraftRecord {
  readonly localId: string;
  readonly ownerAccountId: string;
  readonly clientRequestId: string;
  readonly customerCode: number;
  readonly customerName: string;
  readonly negotiationTypeCode: number | null;
  readonly notes: string | null;
  readonly status: DraftStatus;
  readonly remoteId: string | null;
  readonly remoteVersion: number | null;
  readonly remoteDraftNumber: number | null;
  readonly estimatedTotal: string | null;
  readonly lastError: string | null;
  readonly priceReview: PriceReviewEntry[] | null;
  readonly serverSnapshot: unknown;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly itemCount: number;
  /** Dataset the draft was priced against; `null` = LEGACY_LOCAL (created before dataset identity existed). */
  readonly dataset: DatasetIdentity | null;
  readonly eligibility: Eligibility;
}

export interface PriceReviewEntry {
  readonly productCode: number;
  readonly description: string;
  /** Unit price the seller saw offline; null = "Sem preço". */
  readonly cachedUnitPrice: string | null;
  /** Unit price the server resolved; null = "Sem preço". */
  readonly serverUnitPrice: string | null;
  /** Full server price context (JSON), adopted when the seller acknowledges the review. */
  readonly serverPriceJson: string;
}

export interface DraftItemRecord extends DraftItemInput {
  readonly position: number;
}

export interface OutboxRecord {
  readonly localId: string;
  readonly operationId: string;
  readonly idempotencyKey: string;
  readonly type: OutboxType;
  readonly payload: OrderCommandPayload;
  readonly state: OutboxState;
  readonly attempts: number;
  readonly lastError: string | null;
  readonly baseVersion: number | null;
  readonly draftLocalId: string | null;
  readonly nextAttemptAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly dataset: DatasetIdentity | null;
  readonly eligibility: Eligibility;
}

/** What an order command carries: the request body the API accepts, plus the price snapshot used for price review. */
export interface OrderCommandPayload {
  readonly request: {
    readonly customerCode: number;
    readonly negotiationTypeCode: number | null;
    readonly notes: string | null;
    readonly items: readonly { productCode: number; quantity: string; discountPercent?: string }[];
  };
  readonly prices: readonly { productCode: number; description: string; unitPrice: string | null }[];
}

/* ---------- row mapping ---------- */

export const DRAFT_COLUMNS = `d.local_id, d.owner_account_id, d.client_request_id, d.customer_code, d.customer_name,
  d.negotiation_type_code, d.notes, d.status, d.remote_id, d.remote_version, d.remote_draft_number, d.estimated_total,
  d.last_error, d.price_review, d.server_snapshot, d.created_at, d.updated_at, d.dataset_environment, d.dataset_id, d.eligibility,
  (SELECT count(*) FROM local_order_item i WHERE i.draft_local_id = d.local_id) AS item_count`;

function nullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}
function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

export function datasetOf(row: SqlRow): DatasetIdentity | null {
  return row.dataset_environment === null || row.dataset_environment === undefined || row.dataset_id === null || row.dataset_id === undefined
    ? null
    : { environment: String(row.dataset_environment), datasetId: String(row.dataset_id) };
}

export function toDraft(row: SqlRow): DraftRecord {
  return {
    localId: String(row.local_id),
    ownerAccountId: String(row.owner_account_id),
    clientRequestId: String(row.client_request_id),
    customerCode: Number(row.customer_code),
    customerName: String(row.customer_name),
    negotiationTypeCode: nullableNumber(row.negotiation_type_code),
    notes: nullableString(row.notes),
    status: String(row.status) as DraftStatus,
    remoteId: nullableString(row.remote_id),
    remoteVersion: nullableNumber(row.remote_version),
    remoteDraftNumber: nullableNumber(row.remote_draft_number),
    estimatedTotal: nullableString(row.estimated_total),
    lastError: nullableString(row.last_error),
    priceReview: row.price_review === null ? null : (JSON.parse(String(row.price_review)) as PriceReviewEntry[]),
    serverSnapshot: row.server_snapshot === null ? null : (JSON.parse(String(row.server_snapshot)) as unknown),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    itemCount: Number(row.item_count),
    dataset: datasetOf(row),
    eligibility: String(row.eligibility) as Eligibility,
  };
}

export function toOutbox(row: SqlRow): OutboxRecord {
  return {
    localId: String(row.local_id),
    operationId: String(row.operation_id),
    idempotencyKey: String(row.idempotency_key),
    type: String(row.type) as OutboxType,
    payload: JSON.parse(String(row.payload)) as OrderCommandPayload,
    state: String(row.state) as OutboxState,
    attempts: Number(row.attempts),
    lastError: nullableString(row.last_error),
    baseVersion: nullableNumber(row.base_version),
    draftLocalId: nullableString(row.draft_local_id),
    nextAttemptAt: nullableString(row.next_attempt_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    dataset: datasetOf(row),
    eligibility: String(row.eligibility) as Eligibility,
  };
}

/* ---------- reads ---------- */

export async function getDraft(db: SqlExecutor, localId: string): Promise<DraftRecord | null> {
  const rows = await db.query<SqlRow>(`SELECT ${DRAFT_COLUMNS} FROM local_order_draft d WHERE d.local_id = ?`, [localId]);
  const row = rows[0];
  return row === undefined ? null : toDraft(row);
}

export async function listDrafts(db: SqlExecutor, ownerAccountId: string): Promise<DraftRecord[]> {
  const rows = await db.query<SqlRow>(
    `SELECT ${DRAFT_COLUMNS} FROM local_order_draft d WHERE d.owner_account_id = ? ORDER BY d.updated_at DESC, d.local_id`,
    [ownerAccountId],
  );
  return rows.map(toDraft);
}

/**
 * The drafts that are normal work for the CONFIRMED dataset (resume, home). Drafts of another dataset, legacy drafts
 * and quarantined ones are not listed here; they surface only through the attention counter.
 */
export async function listOperationalDrafts(db: SqlExecutor, ownerAccountId: string, dataset: DatasetIdentity | null): Promise<DraftRecord[]> {
  const operational = operationalDraftSql(dataset);
  const rows = await db.query<SqlRow>(
    `SELECT ${DRAFT_COLUMNS} FROM local_order_draft d WHERE d.owner_account_id = ? AND ${operational.sql} ORDER BY d.updated_at DESC, d.local_id`,
    [ownerAccountId, ...operational.params],
  );
  return rows.map(toDraft);
}

export async function getDraftItems(db: SqlExecutor, localId: string): Promise<DraftItemRecord[]> {
  const rows = await db.query<SqlRow>("SELECT * FROM local_order_item WHERE draft_local_id = ? ORDER BY position", [localId]);
  return rows.map((row) => ({
    position: Number(row.position),
    productCode: Number(row.product_code),
    description: String(row.description),
    unit: String(row.unit),
    quantity: String(row.quantity),
    discountPercent: String(row.discount_percent),
    priceJson: String(row.price_json),
    groupCode: nullableNumber(row.group_code),
    groupName: nullableString(row.group_name),
  }));
}

export async function listOutbox(db: SqlExecutor, draftLocalId?: string): Promise<OutboxRecord[]> {
  const rows =
    draftLocalId === undefined
      ? await db.query<SqlRow>("SELECT * FROM outbox ORDER BY created_at, rowid")
      : await db.query<SqlRow>("SELECT * FROM outbox WHERE draft_local_id = ? ORDER BY created_at, rowid", [draftLocalId]);
  return rows.map(toOutbox);
}

export interface OutboxCounts {
  readonly pending: number;
  readonly sending: number;
  readonly needsAttention: number;
}

/**
 * Counts for the sync indicator. `needsAttention` = rejected, conflict, price review or not-eligible commands the
 * seller must look at. `pending`/`sending` count only work that can actually be sent: with a confirmed `dataset` given, a
 * command of another dataset (or a legacy one) is never "pending", whatever state it is still stored in.
 */
export async function countOutbox(db: SqlExecutor, ownerAccountId: string, dataset?: DatasetIdentity | null): Promise<OutboxCounts> {
  const rows = await db.query<SqlRow>(
    `SELECT o.state AS state, o.dataset_environment AS dataset_environment, o.dataset_id AS dataset_id, o.eligibility AS eligibility, count(*) AS n
     FROM outbox o JOIN local_order_draft d ON d.local_id = o.draft_local_id
     WHERE d.owner_account_id = ? AND o.state IN ('pending', 'sending', 'rejected', 'conflict', 'needs_review')
     GROUP BY o.state, o.dataset_environment, o.dataset_id, o.eligibility`,
    [ownerAccountId],
  );
  const counts = { pending: 0, sending: 0, needsAttention: 0 };
  for (const row of rows) {
    const n = Number(row.n);
    const state = String(row.state);
    if (state === "pending" || state === "sending") {
      const own = datasetOf(row);
      const sendable = own !== null && isOperationalEligibility(String(row.eligibility)) && (dataset === undefined || dataset === null || sameDataset(own, dataset));
      if (sendable) counts[state] += n;
      else counts.needsAttention += n;
    } else {
      counts.needsAttention += n;
    }
  }
  return counts;
}

/* ---------- payload ---------- */

export function buildPayload(input: Pick<SaveDraftInput, "customerCode" | "negotiationTypeCode" | "notes" | "items">): OrderCommandPayload {
  return {
    request: {
      customerCode: input.customerCode,
      negotiationTypeCode: input.negotiationTypeCode,
      notes: input.notes,
      items: input.items.map((item) => ({
        productCode: item.productCode,
        quantity: item.quantity,
        ...(item.discountPercent !== "0" ? { discountPercent: item.discountPercent } : {}),
      })),
    },
    prices: input.items.map((item) => ({
      productCode: item.productCode,
      description: item.description,
      unitPrice: unitPriceOf(item.priceJson),
    })),
  };
}

/** The unit price a stored price context carries; `null` for "Sem preço" (a missing price is never 0). */
export function unitPriceOf(priceJson: string): string | null {
  try {
    const parsed = JSON.parse(priceJson) as { state?: string; unitPrice?: string | null };
    return parsed.state === "priced" || parsed.state === "zero" ? (parsed.unitPrice ?? null) : null;
  } catch {
    return null;
  }
}

/* ---------- save ---------- */

const UNRESOLVED: readonly OutboxState[] = ["pending", "sending", "conflict", "needs_review"];

async function insertItems(tx: SqlExecutor, localId: string, items: readonly DraftItemInput[]): Promise<void> {
  await tx.execute("DELETE FROM local_order_item WHERE draft_local_id = ?", [localId]);
  for (const [index, item] of items.entries()) {
    await tx.execute(
      `INSERT INTO local_order_item (draft_local_id, position, product_code, description, unit, quantity, discount_percent, price_json, group_code, group_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [localId, index + 1, item.productCode, item.description, item.unit, item.quantity, item.discountPercent, item.priceJson, item.groupCode, item.groupName],
    );
  }
}

async function insertOp(
  tx: SqlExecutor,
  env: OfflineEnv,
  op: {
    type: OutboxType;
    idempotencyKey: string;
    payload: OrderCommandPayload;
    baseVersion: number | null;
    draftLocalId: string;
    /** Identity stamped on the command: the draft's own (never re-stamped from the current dataset). */
    dataset: DatasetIdentity | null;
  },
): Promise<void> {
  const now = isoNow(env);
  await tx.execute(
    `INSERT INTO outbox (local_id, operation_id, idempotency_key, type, payload, state, attempts, base_version, draft_local_id, created_at, updated_at, dataset_environment, dataset_id, eligibility)
     VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?, ?, ?, ?, ?)`,
    [
      env.newId(),
      env.newId(),
      op.idempotencyKey,
      op.type,
      JSON.stringify(op.payload),
      op.baseVersion,
      op.draftLocalId,
      now,
      now,
      op.dataset?.environment ?? null,
      op.dataset?.datasetId ?? null,
      op.dataset === null ? "unchecked" : "eligible",
    ],
  );
}

async function setOpPayload(tx: SqlExecutor, env: OfflineEnv, op: OutboxRecord, payload: OrderCommandPayload): Promise<void> {
  await tx.execute("UPDATE outbox SET payload = ?, updated_at = ? WHERE local_id = ?", [JSON.stringify(payload), isoNow(env), op.localId]);
}

export class DraftNotEditableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DraftNotEditableError";
  }
}

/**
 * Saves a draft locally and queues (or coalesces) the command that will deliver it. One transaction.
 *
 * Which command an edit produces, and why it never creates a second order:
 * - New draft → `order.create` with a fresh idempotency key.
 * - The create was never attempted (`attempts = 0`) or a replace is still unsent → the pending command is updated in
 *   place (nothing has left the device, so the key still identifies the same payload).
 * - The create was attempted (its outcome may be unknown) or is in flight → its payload is FROZEN; the edit becomes
 *   an `order.replace` queued behind it (resolved to the remote id/version once the create is accepted). A retry of
 *   the create therefore resends byte-identical data under the same key.
 * - The create was definitively rejected → nothing exists on the server; a new `order.create` with a NEW key replaces it.
 * - A synced draft → `order.replace` with `base_version` = the server version the edit started from (`expectedVersion`).
 */
export async function saveOrderDraft(db: SqlDatabase, env: OfflineEnv, input: SaveDraftInput): Promise<string> {
  return db.transaction(async (tx) => {
    const now = isoNow(env);
    const payload = buildPayload(input);

    // The dataset the server last confirmed: a new draft is stamped with it (it was priced against that data). Without a
    // confirmed identity nothing is created: the order could not be tied to a dataset.
    const confirmed = await readExpectedDataset(tx);

    if (input.localId === undefined) {
      if (confirmed === null) throw new DatasetUnavailableError();
      const localId = env.newId();
      const key = env.newId();
      await tx.execute(
        `INSERT INTO local_order_draft (local_id, owner_account_id, client_request_id, customer_code, customer_name, negotiation_type_code, notes, status, created_at, updated_at, dataset_environment, dataset_id, eligibility)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending_sync', ?, ?, ?, ?, 'eligible')`,
        [localId, input.ownerAccountId, key, input.customerCode, input.customerName, input.negotiationTypeCode, input.notes, now, now, confirmed.environment, confirmed.datasetId],
      );
      await insertItems(tx, localId, input.items);
      await insertOp(tx, env, { type: "order.create", idempotencyKey: key, payload, baseVersion: null, draftLocalId: localId, dataset: confirmed });
      return localId;
    }

    const draft = await getDraft(tx, input.localId);
    if (draft === null || draft.ownerAccountId !== input.ownerAccountId) throw new DraftNotEditableError("Rascunho não encontrado neste aparelho.");
    // A draft of another dataset (or a legacy one) is never edited: its commands would carry the old identity and be refused.
    if (!isOperationalEligibility(draft.eligibility) || !sameDataset(draft.dataset, confirmed)) {
      throw new DraftNotEditableError("Este pedido é de outro conjunto de dados e não pode ser alterado.");
    }
    const allOps = await listOutbox(tx, draft.localId);
    const create = allOps.filter((op) => op.type === "order.create").at(-1);
    const createRejected = create?.state === "rejected";
    // A rejected command is history the new save supersedes (every command carries the full order state).
    await tx.execute("DELETE FROM outbox WHERE draft_local_id = ? AND state = 'rejected'", [draft.localId]);
    const ops = allOps.filter((op) => op.state !== "rejected");
    const last = ops.at(-1);

    let status: DraftStatus = "pending_sync";
    let clientRequestId = draft.clientRequestId;

    if (draft.remoteId === null) {
      const openCreate = ops.filter((op) => op.type === "order.create").at(-1);
      const laterReplaces = ops.filter((op) => op.type === "order.replace" && op.state === "pending" && op.attempts === 0);
      if (create === undefined) throw new DraftNotEditableError("Rascunho sem comando de criação.");
      if (openCreate !== undefined && openCreate.state === "pending" && openCreate.attempts === 0) {
        await setOpPayload(tx, env, openCreate, payload);
      } else if (createRejected) {
        // Definite rejection: the server holds nothing for this key. Start over with a new command and key.
        clientRequestId = env.newId();
        await insertOp(tx, env, { type: "order.create", idempotencyKey: clientRequestId, payload, baseVersion: null, draftLocalId: draft.localId, dataset: draft.dataset });
      } else if (laterReplaces.length > 0) {
        await setOpPayload(tx, env, laterReplaces.at(-1) as OutboxRecord, payload);
      } else {
        await insertOp(tx, env, { type: "order.replace", idempotencyKey: env.newId(), payload, baseVersion: null, draftLocalId: draft.localId, dataset: draft.dataset });
      }
    } else if (last !== undefined && last.type === "order.replace" && last.state === "pending" && last.attempts === 0) {
      await setOpPayload(tx, env, last, payload);
    } else if (last !== undefined && last.type === "order.replace" && last.state === "conflict") {
      // Editing while in conflict keeps the conflict: the seller's version is updated, the resolution is still theirs.
      await setOpPayload(tx, env, last, payload);
      status = "conflict";
    } else {
      await insertOp(tx, env, {
        type: "order.replace",
        idempotencyKey: env.newId(),
        payload,
        baseVersion: draft.remoteVersion,
        draftLocalId: draft.localId,
        dataset: draft.dataset,
      });
      if (last !== undefined && last.state === "needs_review") status = "needs_review";
    }

    await tx.execute(
      `UPDATE local_order_draft SET client_request_id = ?, customer_code = ?, customer_name = ?, negotiation_type_code = ?, notes = ?,
         status = ?, last_error = NULL, updated_at = ? WHERE local_id = ?`,
      [clientRequestId, input.customerCode, input.customerName, input.negotiationTypeCode, input.notes, status, now, draft.localId],
    );
    await insertItems(tx, draft.localId, input.items);
    return draft.localId;
  });
}

/** True when the draft has commands the server has not yet accepted (used to keep the seller informed, never to block them). */
export async function hasUnresolvedOps(db: SqlExecutor, draftLocalId: string): Promise<boolean> {
  const ops = await listOutbox(db, draftLocalId);
  return ops.some((op) => UNRESOLVED.includes(op.state));
}
