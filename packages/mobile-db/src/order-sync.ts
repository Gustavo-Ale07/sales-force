import type { SqlDatabase, SqlExecutor, SqlRow } from "./connection";
import {
  CUSTOMER_UNAVAILABLE_MESSAGE,
  getDraft,
  getDraftItems,
  isNeverSent,
  listOutbox,
  quarantineReasonOf,
  toOutbox,
  type DraftItemInput,
  type DraftStatus,
  type OrderCommandPayload,
  type OutboxRecord,
  type PriceReviewEntry,
} from "./local-orders";
import { classifyEligibility, ineligibleMessage, readExpectedDataset, sameDataset, type DatasetIdentity, type IneligibleReason } from "./dataset-identity";
import { isoNow, type OfflineEnv } from "./offline-env";
import { isCustomerUnavailable } from "./reference-cache";

/**
 * Push side of the offline slice: delivers outbox order commands to the server, one request at a time, and applies
 * the outcome to the local draft.
 *
 * Invariants (P-08, SNK-4, P-09):
 * - The idempotency key travels unchanged on every retry; an outcome of "unknown" (connection lost after the request
 *   left) is retried with the same key and the same, frozen payload, so the server can only ever create one order.
 * - The server outcome is authoritative. A price that differs from what the seller saw offline is never replaced
 *   silently: the draft goes to `needs_review` with both prices until the seller acknowledges it.
 * - A version conflict is never resolved by last-write-wins: both sides are kept and the seller picks explicitly.
 */

export interface RemoteOrderItem {
  readonly productCode: number;
  readonly productDescription: string;
  readonly unit: string;
  readonly quantity: string;
  /** `null` = "Sem preço" (a missing price is never 0). */
  readonly unitListPrice: string | null;
  readonly priceState: "priced" | "zero" | "none";
  readonly priceTableCode: number | null;
  readonly priceVersionId: number | null;
  readonly discountPercent: string;
}

/** The slice of the server order the client needs. Never contains cost or margin (P-20). */
export interface RemoteOrder {
  readonly id: string;
  readonly version: number;
  readonly draftNumber: number;
  readonly customerCode: number;
  readonly customerName: string;
  readonly negotiationTypeCode: number | null;
  readonly notes: string | null;
  readonly estimatedTotal: string;
  readonly items: readonly RemoteOrderItem[];
}

export type TransportErrorKind =
  | "network"
  | "auth"
  | "validation"
  | "rate_limit"
  | "server"
  | "version_conflict"
  | "not_editable"
  | "idempotency_conflict"
  | "not_found"
  | "dataset_mismatch"
  /** The server refused because the customer is no longer eligible (inactive, blocked, unavailable). */
  | "customer_ineligible";

export class TransportError extends Error {
  constructor(
    readonly kind: TransportErrorKind,
    message: string,
    readonly status = 0,
  ) {
    super(message);
    this.name = "TransportError";
  }
}

/** HTTP surface of the order commands. The adapter in `apps/mobile` maps `ApiRequestError` to `TransportError`. */
export interface OrderTransport {
  /** `expectedDataset` is ALWAYS the identity stored on the outbox row (the dataset the draft originated under), never the current one. */
  createOrder(clientRequestId: string, request: OrderCommandPayload["request"], expectedDataset: DatasetIdentity): Promise<RemoteOrder>;
  replaceOrder(id: string, expectedVersion: number, request: OrderCommandPayload["request"], expectedDataset: DatasetIdentity): Promise<RemoteOrder>;
  getOrder(id: string): Promise<RemoteOrder>;
}

/* ---------- error classification ---------- */

export type FailureClass = "transient" | "auth" | "permanent" | "conflict" | "dataset";

export function classifyFailure(kind: TransportErrorKind): FailureClass {
  switch (kind) {
    case "network":
    case "server":
    case "rate_limit":
      return "transient";
    case "auth":
      return "auth";
    case "version_conflict":
      return "conflict";
    case "validation":
    case "not_editable":
    case "idempotency_conflict":
    case "not_found":
    case "customer_ineligible":
      return "permanent";
    case "dataset_mismatch":
      return "dataset";
  }
}

export const BACKOFF_BASE_MS = 5_000;
export const BACKOFF_CAP_MS = 15 * 60_000;

/** 5 s, 10 s, 20 s … capped at 15 min; `attempts` is the number of attempts already made (≥ 1). */
export function backoffDelayMs(attempts: number): number {
  return Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1));
}

/** Seller-facing text; technical detail never reaches the screen ("Network request failed" etc.). */
export function describeFailure(error: TransportError): string {
  switch (error.kind) {
    case "network":
      return "Sem conexão com o servidor. Vamos tentar de novo automaticamente.";
    case "server":
      return "O servidor está indisponível no momento. Vamos tentar de novo automaticamente.";
    case "rate_limit":
      return "Muitas tentativas seguidas. Vamos tentar de novo em instantes.";
    case "auth":
      return "Sua sessão expirou. Entre novamente para sincronizar.";
    case "version_conflict":
      return "Este pedido foi alterado por outra pessoa. Escolha qual versão manter.";
    case "not_editable":
      return "Este pedido não pode mais ser alterado.";
    case "not_found":
      return "O pedido não existe mais no servidor.";
    case "idempotency_conflict":
      return "Este envio já foi registrado com outros dados e não pôde ser repetido.";
    case "dataset_mismatch":
      return ineligibleMessage("dataset_mismatch");
    case "customer_ineligible":
      return CUSTOMER_UNAVAILABLE_MESSAGE;
    case "validation":
      return error.message !== "" ? error.message : "O servidor recusou este pedido. Revise os dados.";
  }
}

/* ---------- draft status derivation ---------- */

/** Derives the seller-visible status from the commands still attached to the draft. Priority is deliberate. */
export function deriveDraftStatus(ops: readonly OutboxRecord[]): { status: DraftStatus; lastError: string | null } {
  const conflict = ops.find((op) => op.state === "conflict");
  if (conflict !== undefined) return { status: "conflict", lastError: conflict.lastError };
  const lastRejectedIndex = ops.map((op) => op.state).lastIndexOf("rejected");
  const lastRejected = lastRejectedIndex < 0 ? undefined : ops[lastRejectedIndex];
  const laterActive = lastRejected === undefined ? false : ops.some((op) => op.state !== "rejected" && op.createdAt > lastRejected.createdAt);
  if (lastRejected !== undefined && !laterActive) {
    // The reason is the ROOT of the trailing run of rejected commands: later ones are cascade fallout of the first.
    let rootIndex = lastRejectedIndex;
    while (rootIndex > 0 && ops[rootIndex - 1]?.state === "rejected") rootIndex -= 1;
    return { status: "sync_error", lastError: (ops[rootIndex] ?? lastRejected).lastError };
  }
  const review = ops.find((op) => op.state === "needs_review");
  // A quarantined (not eligible) command explains itself; a plain price review carries no text.
  if (review !== undefined) return { status: "needs_review", lastError: review.lastError };
  if (ops.some((op) => op.state === "sending")) return { status: "syncing", lastError: null };
  const pending = ops.filter((op) => op.state === "pending");
  if (pending.length > 0) {
    const failed = pending.find((op) => op.lastError !== null);
    return failed === undefined ? { status: "pending_sync", lastError: null } : { status: "sync_error", lastError: failed.lastError };
  }
  return { status: "synced", lastError: null };
}

async function refreshDraftStatus(tx: SqlExecutor, localId: string): Promise<void> {
  const ops = await listOutbox(tx, localId);
  const { status, lastError } = deriveDraftStatus(ops);
  await tx.execute("UPDATE local_order_draft SET status = ?, last_error = ? WHERE local_id = ?", [status, lastError, localId]);
}

/* ---------- price review ---------- */

/** Stored price context of a server line (same shape the editor keeps; a missing price is never 0). */
export function priceContextOf(item: RemoteOrderItem): string {
  if (item.priceState !== "none" && item.unitListPrice !== null && item.priceTableCode !== null && item.priceVersionId !== null) {
    return JSON.stringify({ state: item.priceState, unitPrice: item.unitListPrice, tableCode: item.priceTableCode, versionId: item.priceVersionId });
  }
  return JSON.stringify({ state: "none", tableCode: item.priceTableCode, versionId: item.priceVersionId, noPriceReason: "no_price_row" });
}

function samePrice(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  return Number(a) === Number(b);
}

/** Lines whose server-resolved price differs from what the seller saw offline (P-09). */
export function comparePrices(payload: OrderCommandPayload, remote: RemoteOrder): PriceReviewEntry[] {
  const entries: PriceReviewEntry[] = [];
  const serverByProduct = new Map(remote.items.map((item) => [item.productCode, item]));
  for (const cached of payload.prices) {
    const server = serverByProduct.get(cached.productCode);
    if (server === undefined) continue;
    const serverPrice = server.priceState === "none" ? null : server.unitListPrice;
    if (!samePrice(cached.unitPrice, serverPrice)) {
      entries.push({
        productCode: cached.productCode,
        description: cached.description,
        cachedUnitPrice: cached.unitPrice,
        serverUnitPrice: serverPrice,
        serverPriceJson: priceContextOf(server),
      });
    }
  }
  return entries;
}

/* ---------- push ---------- */

export type PushStop = "idle" | "offline" | "auth" | "limit" | "dataset_unconfirmed" | "dataset_mismatch";

export interface PushResult {
  readonly attempted: number;
  readonly accepted: number;
  /** Commands that failed in this run (transient non-network failures, conflicts, rejections). */
  readonly failed: number;
  readonly stoppedBy: PushStop;
  /** Commands moved to `needs_review` because they do not belong to the current account/dataset (never sent). */
  readonly quarantined?: number;
}

export interface PushOptions {
  /**
   * The dataset the server confirmed for this session. REQUIRED for anything to be sent: `null`/absent = unknown, so
   * nothing is delivered (fail closed). Every command is compared with it right before its request.
   */
  readonly currentDataset?: DatasetIdentity | null;
  /** Skip commands whose backoff has not elapsed (automatic timer). Manual/reconnect syncs pass `false`. */
  readonly respectBackoff?: boolean;
  readonly maxOperations?: number;
  readonly onUnexpectedError?: (error: unknown) => void;
}

const DEFAULT_MAX_OPERATIONS = 50;

/** Commands that were mid-flight when the app died have an unknown outcome: return them to `pending` (frozen, attempts kept). */
export async function recoverInterrupted(db: SqlDatabase, env: OfflineEnv): Promise<number> {
  return db.transaction(async (tx) => {
    const stuck = await tx.query<SqlRow>("SELECT local_id, draft_local_id FROM outbox WHERE state = 'sending' AND eligibility IN ('unchecked', 'eligible')");
    for (const row of stuck) {
      await tx.execute(
        "UPDATE outbox SET state = 'pending', last_error = ?, next_attempt_at = NULL, updated_at = ? WHERE local_id = ?",
        ["Envio interrompido; será repetido com a mesma identificação.", isoNow(env), String(row.local_id)],
      );
      if (row.draft_local_id !== null) await refreshDraftStatus(tx, String(row.draft_local_id));
    }
    return stuck.length;
  });
}

async function nextEligible(
  db: SqlExecutor,
  env: OfflineEnv,
  ownerAccountId: string,
  respectBackoff: boolean,
  heldDrafts: ReadonlySet<string>,
): Promise<OutboxRecord | null> {
  const rows = await db.query<SqlRow>(
    `SELECT o.* FROM outbox o JOIN local_order_draft d ON d.local_id = o.draft_local_id
     WHERE d.owner_account_id = ? AND o.state IN ('pending', 'sending', 'conflict')
     ORDER BY o.created_at, o.rowid`,
    [ownerAccountId],
  );
  const blocked = new Set<string>(heldDrafts);
  const nowIso = isoNow(env);
  for (const row of rows) {
    const op = toOutbox(row);
    const draftId = op.draftLocalId ?? "";
    if (blocked.has(draftId)) continue;
    if (op.state !== "pending") {
      blocked.add(draftId);
      continue;
    }
    if (respectBackoff && op.nextAttemptAt !== null && op.nextAttemptAt > nowIso) {
      blocked.add(draftId);
      continue;
    }
    return op;
  }
  return null;
}

async function markSending(db: SqlDatabase, env: OfflineEnv, op: OutboxRecord): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute("UPDATE outbox SET state = 'sending', attempts = attempts + 1, eligibility = 'eligible', updated_at = ? WHERE local_id = ?", [isoNow(env), op.localId]);
    if (op.draftLocalId !== null) await refreshDraftStatus(tx, op.draftLocalId);
  });
}

async function applyAccepted(db: SqlDatabase, env: OfflineEnv, op: OutboxRecord, remote: RemoteOrder): Promise<void> {
  await db.transaction(async (tx) => {
    const draftId = op.draftLocalId as string;
    const review = comparePrices(op.payload, remote);
    await tx.execute(
      "UPDATE local_order_draft SET remote_id = ?, remote_version = ?, remote_draft_number = ?, estimated_total = ?, server_snapshot = NULL WHERE local_id = ?",
      [remote.id, remote.version, remote.draftNumber, remote.estimatedTotal, draftId],
    );
    if (review.length > 0) await tx.execute("UPDATE local_order_draft SET price_review = ? WHERE local_id = ?", [JSON.stringify(review), draftId]);
    if (review.length > 0) {
      await tx.execute("UPDATE outbox SET state = 'needs_review', last_error = NULL, next_attempt_at = NULL, updated_at = ? WHERE local_id = ?", [isoNow(env), op.localId]);
    } else {
      await tx.execute("DELETE FROM outbox WHERE local_id = ?", [op.localId]);
    }
    await refreshDraftStatus(tx, draftId);
  });
}

async function applyTransient(db: SqlDatabase, env: OfflineEnv, op: OutboxRecord, error: TransportError): Promise<void> {
  await db.transaction(async (tx) => {
    // `op` is the record as sent: its attempt count already includes this attempt.
    const next = new Date(env.now().getTime() + backoffDelayMs(op.attempts)).toISOString();
    await tx.execute(
      "UPDATE outbox SET state = 'pending', last_error = ?, next_attempt_at = ?, updated_at = ? WHERE local_id = ?",
      [describeFailure(error), next, isoNow(env), op.localId],
    );
    await refreshDraftStatus(tx, op.draftLocalId as string);
  });
}

async function applyAuth(db: SqlDatabase, env: OfflineEnv, op: OutboxRecord, error: TransportError): Promise<void> {
  await db.transaction(async (tx) => {
    // An auth failure says nothing about the payload; do not penalize it with backoff.
    await tx.execute("UPDATE outbox SET state = 'pending', last_error = ?, next_attempt_at = NULL, updated_at = ? WHERE local_id = ?", [
      describeFailure(error),
      isoNow(env),
      op.localId,
    ]);
    await refreshDraftStatus(tx, op.draftLocalId as string);
  });
}

async function applyPermanent(db: SqlDatabase, env: OfflineEnv, op: OutboxRecord, error: TransportError): Promise<void> {
  await db.transaction(async (tx) => {
    const now = isoNow(env);
    await tx.execute("UPDATE outbox SET state = 'rejected', last_error = ?, next_attempt_at = NULL, updated_at = ? WHERE local_id = ?", [
      describeFailure(error),
      now,
      op.localId,
    ]);
    if (op.type === "order.create") {
      // Nothing exists on the server for this key, so commands queued behind it have nothing to apply to.
      await tx.execute(
        `UPDATE outbox SET state = 'rejected', last_error = ?, updated_at = ? WHERE draft_local_id = ? AND state = 'pending' AND local_id <> ?`,
        [
          // An unavailable customer stays the stated reason for the whole chain; other causes keep the generic text.
          error.kind === "customer_ineligible" ? CUSTOMER_UNAVAILABLE_MESSAGE : "O envio inicial deste pedido foi recusado; esta alteração não foi enviada.",
          now,
          op.draftLocalId,
          op.localId,
        ],
      );
    }
    await refreshDraftStatus(tx, op.draftLocalId as string);
  });
}

async function applyConflict(db: SqlDatabase, env: OfflineEnv, op: OutboxRecord, error: TransportError, snapshot: RemoteOrder | null): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute("UPDATE outbox SET state = 'conflict', last_error = ?, next_attempt_at = NULL, updated_at = ? WHERE local_id = ?", [
      describeFailure(error),
      isoNow(env),
      op.localId,
    ]);
    await tx.execute("UPDATE local_order_draft SET server_snapshot = ? WHERE local_id = ?", [snapshot === null ? null : JSON.stringify(snapshot), op.draftLocalId]);
    await refreshDraftStatus(tx, op.draftLocalId as string);
  });
}

/**
 * Takes every unsent command of a draft out of delivery for good: `needs_review` + the reason, draft mirrored. Nothing is
 * deleted and nothing here ever re-queues it (only an explicit future seller action could).
 */
async function quarantineDraft(db: SqlDatabase, env: OfflineEnv, draftLocalId: string, reason: IneligibleReason): Promise<void> {
  await db.transaction(async (tx) => {
    const now = isoNow(env);
    await tx.execute(
      `UPDATE outbox SET state = 'needs_review', eligibility = ?, last_error = ?, next_attempt_at = NULL, updated_at = ?
       WHERE draft_local_id = ? AND state IN ('pending', 'sending', 'conflict', 'needs_review')`,
      [reason, ineligibleMessage(reason), now, draftLocalId],
    );
    await tx.execute("UPDATE local_order_draft SET eligibility = ? WHERE local_id = ?", [reason, draftLocalId]);
    await refreshDraftStatus(tx, draftLocalId);
  });
}

/** Marks every unsent command of the draft as held for an unavailable customer (state `pending`, no attempt counted). */
async function holdForCustomer(db: SqlDatabase, env: OfflineEnv, draftLocalId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(
      "UPDATE outbox SET last_error = ?, next_attempt_at = NULL, updated_at = ? WHERE draft_local_id = ? AND state = 'pending'",
      [CUSTOMER_UNAVAILABLE_MESSAGE, isoNow(env), draftLocalId],
    );
    await refreshDraftStatus(tx, draftLocalId);
  });
}

/** Moves every draft of the owner with unresolved commands that is definitely not eligible (legacy, other dataset) out of delivery. */
async function quarantineIneligible(db: SqlDatabase, env: OfflineEnv, ownerAccountId: string, current: DatasetIdentity | null): Promise<number> {
  const rows = await db.query<SqlRow>(
    `SELECT DISTINCT d.local_id AS local_id FROM local_order_draft d JOIN outbox o ON o.draft_local_id = d.local_id
     WHERE d.owner_account_id = ? AND o.state IN ('pending', 'sending', 'conflict', 'needs_review') AND d.eligibility IN ('unchecked', 'eligible')`,
    [ownerAccountId],
  );
  let count = 0;
  for (const row of rows) {
    const draft = await getDraft(db, String(row.local_id));
    if (draft === null) continue;
    const verdict = classifyEligibility({ rowOwnerAccountId: draft.ownerAccountId, currentOwnerAccountId: ownerAccountId, rowDataset: draft.dataset, current });
    if (verdict !== "eligible" && verdict !== "unconfirmed") {
      await quarantineDraft(db, env, draft.localId, verdict);
      count += 1;
    }
  }
  return count;
}

/**
 * Sends pending commands in creation order, per draft, one at a time (no bursts). Stops at the first sign that the
 * network is unusable so a dead connection costs one attempt, not one per queued command.
 */
export async function pushOutbox(
  db: SqlDatabase,
  env: OfflineEnv,
  transport: OrderTransport,
  ownerAccountId: string,
  options: PushOptions = {},
): Promise<PushResult> {
  const respectBackoff = options.respectBackoff ?? true;
  const max = options.maxOperations ?? DEFAULT_MAX_OPERATIONS;
  let attempted = 0;
  let accepted = 0;
  let failed = 0;
  let quarantined = 0;
  const heldDrafts = new Set<string>();
  const startedUnder = options.currentDataset ?? null;
  quarantined += await quarantineIneligible(db, env, ownerAccountId, startedUnder);

  while (attempted < max) {
    // The confirmation can change mid-run (a config fetch elsewhere, a null answer): re-read it before EVERY command.
    // Vanished or different from the one this run started under = stop; nothing further is sent (retryable, not quarantined).
    const op = await nextEligible(db, env, ownerAccountId, respectBackoff, heldDrafts);
    if (op === null) return { attempted, accepted, failed, stoppedBy: "idle", quarantined };
    const fresh = await readExpectedDataset(db);
    if (fresh === null || !sameDataset(fresh, startedUnder)) return { attempted, accepted, failed, stoppedBy: "dataset_unconfirmed", quarantined };
    const current = fresh;
    const draft = await getDraft(db, op.draftLocalId as string);
    if (draft === null) {
      await db.execute("DELETE FROM outbox WHERE local_id = ?", [op.localId]);
      continue;
    }
    // PUSH GUARD: nothing reaches the transport unless the command (and its draft) belong to this account and to the
    // dataset the server confirmed. A row without identity is LEGACY_LOCAL; a mismatch is permanent, never retried.
    const verdicts = [draft.dataset, op.dataset].map((rowDataset) =>
      classifyEligibility({ rowOwnerAccountId: draft.ownerAccountId, currentOwnerAccountId: ownerAccountId, rowDataset, current }),
    );
    const blocking = verdicts.find((verdict) => verdict !== "eligible");
    if (blocking === "unconfirmed") return { attempted, accepted, failed, stoppedBy: "dataset_unconfirmed", quarantined };
    if (blocking !== undefined) {
      await quarantineDraft(db, env, draft.localId, blocking);
      quarantined += 1;
      continue;
    }
    // CUSTOMER GUARD (indicative; the server stays authoritative): a customer the cache says is inactive or blocked is
    // not sent to. The command is kept untouched (same key, same payload, zero attempts) and re-evaluated on every run,
    // so it goes out by itself if the customer becomes available again. Nothing is converted, rewritten or deleted.
    if (await isCustomerUnavailable(db, draft.customerCode)) {
      await holdForCustomer(db, env, draft.localId);
      heldDrafts.add(draft.localId);
      continue;
    }
    // The guard above proved op.dataset equals the confirmed dataset; the request states the ROW's own identity.
    const sentUnder = op.dataset as DatasetIdentity;
    attempted += 1;
    await markSending(db, env, op);
    const sent: OutboxRecord = { ...op, attempts: op.attempts + 1 };

    try {
      let remote: RemoteOrder;
      if (op.type === "order.create") {
        remote = await transport.createOrder(op.idempotencyKey, op.payload.request, sentUnder);
      } else {
        if (draft.remoteId === null || draft.remoteVersion === null) throw new TransportError("validation", "O pedido ainda não foi criado no servidor.");
        remote = await transport.replaceOrder(draft.remoteId, draft.remoteVersion, op.payload.request, sentUnder);
      }
      await applyAccepted(db, env, sent, remote);
      accepted += 1;
    } catch (caught) {
      const error = caught instanceof TransportError ? caught : new TransportError("server", "Falha inesperada.");
      if (!(caught instanceof TransportError)) options.onUnexpectedError?.(caught);
      const failure = classifyFailure(error.kind);
      if (failure === "transient") {
        await applyTransient(db, env, sent, error);
        failed += 1;
        if (error.kind === "network") return { attempted, accepted, failed, stoppedBy: "offline", quarantined };
        continue;
      }
      if (failure === "auth") {
        await applyAuth(db, env, sent, error);
        failed += 1;
        return { attempted, accepted, failed, stoppedBy: "auth", quarantined };
      }
      if (failure === "dataset") {
        // The server refused before any effect: this draft belongs to another dataset. Permanent for the draft (quarantine,
        // never re-queued); the run stops so no other command is POSTed until the dataset is re-confirmed.
        await quarantineDraft(db, env, draft.localId, "dataset_mismatch");
        quarantined += 1;
        failed += 1;
        return { attempted, accepted, failed, stoppedBy: "dataset_mismatch", quarantined };
      }
      if (failure === "conflict") {
        let snapshot: RemoteOrder | null = null;
        try {
          if (draft.remoteId !== null) snapshot = await transport.getOrder(draft.remoteId);
        } catch {
          snapshot = null; // fetched again when the seller opens the conflict
        }
        await applyConflict(db, env, sent, error, snapshot);
        failed += 1;
        continue;
      }
      await applyPermanent(db, env, sent, error);
      failed += 1;
    }
  }
  return { attempted, accepted, failed, stoppedBy: "limit", quarantined };
}

/* ---------- seller actions on sync outcomes ---------- */

/** The seller has seen the price differences: local price snapshots take the server values and the review is closed. */
export async function acknowledgePriceReview(db: SqlDatabase, env: OfflineEnv, draftLocalId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const draft = await getDraft(tx, draftLocalId);
    if (draft === null || draft.priceReview === null) return;
    const items = await getDraftItems(tx, draftLocalId);
    const review = new Map(draft.priceReview.map((entry) => [entry.productCode, entry]));
    for (const item of items) {
      const entry = review.get(item.productCode);
      if (entry === undefined) continue;
      await tx.execute("UPDATE local_order_item SET price_json = ? WHERE draft_local_id = ? AND position = ?", [entry.serverPriceJson, draftLocalId, item.position]);
    }
    await tx.execute("DELETE FROM outbox WHERE draft_local_id = ? AND state = 'needs_review' AND eligibility IN ('unchecked', 'eligible')", [draftLocalId]);
    await tx.execute("UPDATE local_order_draft SET price_review = NULL WHERE local_id = ?", [draftLocalId]);
    await refreshDraftStatus(tx, draftLocalId);
  });
}

export type ConflictResolution = "keep_local" | "use_server";

export class ConflictResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConflictResolutionError";
  }
}

/**
 * Explicit, seller-driven resolution. Nothing here runs automatically.
 * - `keep_local`: the seller's version is re-queued against the server's current version (new command, new key: the
 *   409 was a definite non-application, so no order can be duplicated).
 * - `use_server`: the local edit is discarded in favor of the server's version.
 */
export async function resolveConflict(
  db: SqlDatabase,
  env: OfflineEnv,
  transport: OrderTransport,
  draftLocalId: string,
  resolution: ConflictResolution,
): Promise<void> {
  const draft = await getDraft(db, draftLocalId);
  if (draft === null || draft.remoteId === null) throw new ConflictResolutionError("Não há conflito para resolver neste rascunho.");
  const conflicted = (await listOutbox(db, draftLocalId)).find((op) => op.state === "conflict");
  if (conflicted === undefined) throw new ConflictResolutionError("Não há conflito para resolver neste rascunho.");
  const server = (draft.serverSnapshot as RemoteOrder | null) ?? (await transport.getOrder(draft.remoteId));

  await db.transaction(async (tx) => {
    const now = isoNow(env);
    if (resolution === "keep_local") {
      await tx.execute(
        `UPDATE outbox SET state = 'pending', attempts = 0, last_error = NULL, next_attempt_at = NULL, base_version = ?, idempotency_key = ?, updated_at = ?
         WHERE local_id = ?`,
        [server.version, env.newId(), now, conflicted.localId],
      );
      await tx.execute("UPDATE local_order_draft SET remote_version = ?, server_snapshot = NULL WHERE local_id = ?", [server.version, draftLocalId]);
    } else {
      const previous = await getDraftItems(tx, draftLocalId);
      const groupByProduct = new Map(previous.map((item) => [item.productCode, item]));
      await tx.execute("DELETE FROM outbox WHERE draft_local_id = ? AND state IN ('conflict', 'pending', 'rejected')", [draftLocalId]);
      await tx.execute("DELETE FROM local_order_item WHERE draft_local_id = ?", [draftLocalId]);
      for (const [index, item] of server.items.entries()) {
        const known = groupByProduct.get(item.productCode);
        const input: DraftItemInput = {
          productCode: item.productCode,
          description: item.productDescription,
          unit: item.unit,
          quantity: item.quantity,
          discountPercent: item.discountPercent,
          priceJson: priceContextOf(item),
          groupCode: known?.groupCode ?? null,
          groupName: known?.groupName ?? null,
        };
        await tx.execute(
          `INSERT INTO local_order_item (draft_local_id, position, product_code, description, unit, quantity, discount_percent, price_json, group_code, group_name)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [draftLocalId, index + 1, input.productCode, input.description, input.unit, input.quantity, input.discountPercent, input.priceJson, input.groupCode, input.groupName],
        );
      }
      await tx.execute(
        `UPDATE local_order_draft SET remote_version = ?, customer_code = ?, customer_name = ?, negotiation_type_code = ?, notes = ?,
           estimated_total = ?, server_snapshot = NULL, price_review = NULL, updated_at = ? WHERE local_id = ?`,
        [server.version, server.customerCode, server.customerName, server.negotiationTypeCode, server.notes, server.estimatedTotal, now, draftLocalId],
      );
    }
    await refreshDraftStatus(tx, draftLocalId);
  });
}

export class DraftDiscardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DraftDiscardError";
  }
}

/**
 * Removes a local draft that the server has never seen (or definitively refused). A draft whose create was sent at
 * least once may exist on the server, so it cannot be dropped locally without leaving an orphan.
 */
export async function discardLocalDraft(db: SqlDatabase, ownerAccountId: string, localId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const draft = await getDraft(tx, localId);
    if (draft === null || draft.ownerAccountId !== ownerAccountId) return;
    const ops = await listOutbox(tx, localId);
    if (!isNeverSent(draft, ops)) {
      throw new DraftDiscardError("Este pedido já foi enviado ao servidor e não pode ser descartado aqui.");
    }
    await tx.execute("DELETE FROM outbox WHERE draft_local_id = ?", [localId]);
    await tx.execute("DELETE FROM local_order_item WHERE draft_local_id = ?", [localId]);
    await tx.execute("DELETE FROM local_order_draft WHERE local_id = ?", [localId]);
  });
}

/**
 * Explicit, local-only removal of a retained (quarantined) draft. Unlike `discardLocalDraft` it refuses anything that is
 * not in quarantine, so an operational order can never be dropped through this path. It never contacts the server.
 */
export async function discardQuarantinedDraft(db: SqlDatabase, ownerAccountId: string, localId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const draft = await getDraft(tx, localId);
    if (draft === null || draft.ownerAccountId !== ownerAccountId) return;
    const ops = await listOutbox(tx, localId);
    const unresolved = ops.some((op) => ["pending", "sending", "conflict", "needs_review"].includes(op.state));
    if (quarantineReasonOf(draft, unresolved) === null) throw new DraftDiscardError("Este pedido não está retido e não pode ser descartado aqui.");
    if (!isNeverSent(draft, ops)) throw new DraftDiscardError("Este pedido já foi enviado ao servidor e não pode ser descartado aqui.");
    await tx.execute("DELETE FROM outbox WHERE draft_local_id = ?", [localId]);
    await tx.execute("DELETE FROM local_order_item WHERE draft_local_id = ?", [localId]);
    await tx.execute("DELETE FROM local_order_draft WHERE local_id = ?", [localId]);
  });
}
