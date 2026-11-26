import type { SqlDatabase, SqlExecutor, SqlRow } from "./connection";
import { DatasetUnavailableError, readExpectedDataset, sameDataset, type DatasetIdentity } from "./dataset-identity";
import { isoNow, type OfflineEnv } from "./offline-env";
import { classifyFailure, TransportError } from "./order-sync";

/**
 * Offline edit of an existing customer (owner 2026-11-26). The change is stored on the device the moment the seller saves; the sync
 * sends it AFTER the customer creations and BEFORE the orders, one request at a time, in the order the seller made them.
 *
 * - `client_request_id` is minted once and reused on every retry (the server's `force-edit:<id>` origin id), so a lost reply never
 *   applies the edit twice (SNK-4).
 * - `base_contact_version` is the fingerprint of the phone and e-mail the seller saw. A 409 `customer_edit_conflict` means the customer
 *   changed in the ERP meanwhile: nothing is lost, the row becomes `conflict` and keeps both versions until the seller chooses.
 * - The server outcome is authoritative; only phone, e-mail and notes can be edited (D-AP). No cost or margin (P-20).
 */

export type CustomerEditState = "queued" | "sending" | "conflict" | "rejected";

export interface CustomerEditChanges {
  readonly phone?: string;
  readonly email?: string;
  readonly notes?: string;
}

/** The ERP's version of the contact data when a conflict was detected. */
export interface CustomerEditServerVersion {
  readonly phone: string;
  readonly email: string;
  readonly contactVersion: string;
}

export interface CustomerEditRecord {
  readonly seq: number;
  readonly clientRequestId: string;
  readonly ownerAccountId: string;
  readonly dataset: DatasetIdentity;
  readonly customerCode: number;
  readonly customerName: string;
  readonly changes: CustomerEditChanges;
  readonly baseContactVersion: string | null;
  readonly state: CustomerEditState;
  /** Present while `state` is `conflict`. */
  readonly serverVersion: CustomerEditServerVersion | null;
  readonly lastError: string | null;
  readonly attempts: number;
}

/** HTTP surface of the edit (`PATCH /customers/{code}`). The adapter in `apps/mobile` maps `ApiRequestError` to `TransportError`. */
export interface CustomerEditTransport {
  updateCustomer(clientRequestId: string, customerCode: number, changes: CustomerEditChanges, baseContactVersion: string | null): Promise<void>;
}

export class CustomerEditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CustomerEditError";
  }
}

export const CUSTOMER_EDIT_NOT_FOR_LOCAL_TEXT = "Este cliente ainda não foi enviado ao Sankhya. Aguarde o envio para alterá-lo.";

function toRecord(row: SqlRow): CustomerEditRecord {
  const server = row.server_version === null || row.server_version === undefined ? null : (JSON.parse(String(row.server_version)) as CustomerEditServerVersion);
  return {
    seq: Number(row.seq),
    clientRequestId: String(row.client_request_id),
    ownerAccountId: String(row.owner_account_id),
    dataset: { environment: String(row.dataset_environment), datasetId: String(row.dataset_id) },
    customerCode: Number(row.customer_code),
    customerName: String(row.customer_name),
    changes: JSON.parse(String(row.changes)) as CustomerEditChanges,
    baseContactVersion: row.base_contact_version === null || row.base_contact_version === undefined ? null : String(row.base_contact_version),
    state: String(row.state) as CustomerEditState,
    serverVersion: server,
    lastError: row.last_error === null || row.last_error === undefined ? null : String(row.last_error),
    attempts: Number(row.attempts),
  };
}

export interface EnqueueCustomerEditInput {
  readonly ownerAccountId: string;
  readonly customerCode: number;
  readonly customerName: string;
  readonly changes: CustomerEditChanges;
  /** `contactVersion` of the customer as the seller saw it; `null` when the cached copy has none. */
  readonly baseContactVersion: string | null;
}

/**
 * Stores an edit. A second edit of the same customer that is still waiting (`queued`) is MERGED into the first (later values win, the
 * first base version stays): the ERP receives one change, never two racing requests. A local (negative) customer code cannot be edited.
 */
export async function enqueueCustomerEdit(db: SqlDatabase, env: OfflineEnv, input: EnqueueCustomerEditInput): Promise<CustomerEditRecord> {
  if (input.customerCode < 0) throw new CustomerEditError(CUSTOMER_EDIT_NOT_FOR_LOCAL_TEXT);
  return db.transaction(async (tx) => {
    const dataset = await readExpectedDataset(tx);
    if (dataset === null) throw new DatasetUnavailableError();
    const now = isoNow(env);
    const waiting = await tx.query<SqlRow>(
      "SELECT * FROM pending_customer_edit WHERE owner_account_id = ? AND customer_code = ? AND dataset_environment = ? AND dataset_id = ? AND state = 'queued' ORDER BY seq LIMIT 1",
      [input.ownerAccountId, input.customerCode, dataset.environment, dataset.datasetId],
    );
    const first = waiting[0];
    if (first !== undefined) {
      const merged = { ...(JSON.parse(String(first.changes)) as CustomerEditChanges), ...input.changes };
      await tx.execute("UPDATE pending_customer_edit SET changes = ?, updated_at = ? WHERE seq = ?", [JSON.stringify(merged), now, Number(first.seq)]);
      return toRecord((await tx.query<SqlRow>("SELECT * FROM pending_customer_edit WHERE seq = ?", [Number(first.seq)]))[0] as SqlRow);
    }
    const id = env.newId();
    await tx.execute(
      `INSERT INTO pending_customer_edit (client_request_id, owner_account_id, dataset_environment, dataset_id, customer_code, customer_name, changes, base_contact_version, state, attempts, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', 0, ?, ?)`,
      [id, input.ownerAccountId, dataset.environment, dataset.datasetId, input.customerCode, input.customerName, JSON.stringify(input.changes), input.baseContactVersion, now, now],
    );
    return toRecord((await tx.query<SqlRow>("SELECT * FROM pending_customer_edit WHERE client_request_id = ?", [id]))[0] as SqlRow);
  });
}

export async function listCustomerEdits(db: SqlExecutor, ownerAccountId: string, dataset: DatasetIdentity | null, customerCode?: number): Promise<CustomerEditRecord[]> {
  if (dataset === null) return [];
  const rows = await db.query<SqlRow>(
    `SELECT * FROM pending_customer_edit WHERE owner_account_id = ? AND dataset_environment = ? AND dataset_id = ?${customerCode === undefined ? "" : " AND customer_code = ?"} ORDER BY seq`,
    customerCode === undefined ? [ownerAccountId, dataset.environment, dataset.datasetId] : [ownerAccountId, dataset.environment, dataset.datasetId, customerCode],
  );
  return rows.map(toRecord);
}

/** `pending`: waiting to be sent; `needsAttention`: a conflict or a refusal the seller must resolve. */
export async function countCustomerEdits(db: SqlExecutor, ownerAccountId: string, dataset: DatasetIdentity | null): Promise<{ pending: number; needsAttention: number }> {
  const all = await listCustomerEdits(db, ownerAccountId, dataset);
  return {
    pending: all.filter((edit) => edit.state === "queued" || edit.state === "sending").length,
    needsAttention: all.filter((edit) => edit.state === "conflict" || edit.state === "rejected").length,
  };
}

export interface CustomerEditPushOptions {
  readonly currentDataset: DatasetIdentity | null;
  readonly maxOperations?: number;
}

export interface CustomerEditPushResult {
  readonly attempted: number;
  readonly sent: number;
  readonly conflicts: number;
  readonly rejected: number;
  readonly stoppedBy: "idle" | "limit" | "offline" | "auth" | "dataset_unconfirmed";
}

/** The edit was applied, or the server already had it (idempotent replay): the local row is no longer needed. */
async function drop(db: SqlExecutor, seq: number): Promise<void> {
  await db.execute("DELETE FROM pending_customer_edit WHERE seq = ?", [seq]);
}

/** Sends the owner's queued edits in the order they were made. Stops at the first dead network or session. */
export async function pushCustomerEdits(
  db: SqlDatabase,
  env: OfflineEnv,
  transport: CustomerEditTransport,
  ownerAccountId: string,
  options: CustomerEditPushOptions,
): Promise<CustomerEditPushResult> {
  const max = options.maxOperations ?? 20;
  const started = options.currentDataset;
  let attempted = 0;
  let sent = 0;
  let conflicts = 0;
  let rejected = 0;
  if (started === null) return { attempted, sent, conflicts, rejected, stoppedBy: "dataset_unconfirmed" };
  const rows = (await listCustomerEdits(db, ownerAccountId, started)).filter((edit) => edit.state === "queued" || edit.state === "sending");
  for (const edit of rows) {
    if (attempted >= max) return { attempted, sent, conflicts, rejected, stoppedBy: "limit" };
    if (!sameDataset(await readExpectedDataset(db), started)) return { attempted, sent, conflicts, rejected, stoppedBy: "dataset_unconfirmed" };
    attempted += 1;
    await db.execute("UPDATE pending_customer_edit SET state = 'sending', attempts = attempts + 1, updated_at = ? WHERE seq = ?", [isoNow(env), edit.seq]);
    try {
      await transport.updateCustomer(edit.clientRequestId, edit.customerCode, edit.changes, edit.baseContactVersion);
      await drop(db, edit.seq);
      sent += 1;
    } catch (error) {
      if (!(error instanceof TransportError)) {
        await db.execute("UPDATE pending_customer_edit SET state = 'queued', updated_at = ? WHERE seq = ?", [isoNow(env), edit.seq]);
        throw error;
      }
      const kind = classifyFailure(error.kind);
      if (kind === "conflict" && error.kind === "edit_conflict") {
        const fields = error.fields ?? {};
        const server: CustomerEditServerVersion = { phone: fields.phone ?? "", email: fields.email ?? "", contactVersion: fields.contactVersion ?? "" };
        await db.execute("UPDATE pending_customer_edit SET state = 'conflict', server_version = ?, last_error = ?, updated_at = ? WHERE seq = ?", [JSON.stringify(server), error.message, isoNow(env), edit.seq]);
        conflicts += 1;
        continue;
      }
      if (kind === "permanent" || kind === "conflict") {
        await db.execute("UPDATE pending_customer_edit SET state = 'rejected', last_error = ?, updated_at = ? WHERE seq = ?", [error.message, isoNow(env), edit.seq]);
        rejected += 1;
        continue;
      }
      // Transient, auth or dataset: back to the queue, same request id on the next run.
      await db.execute("UPDATE pending_customer_edit SET state = 'queued', last_error = ?, updated_at = ? WHERE seq = ?", [error.message, isoNow(env), edit.seq]);
      if (kind === "auth") return { attempted, sent, conflicts, rejected, stoppedBy: "auth" };
      return { attempted, sent, conflicts, rejected, stoppedBy: "offline" };
    }
  }
  return { attempted, sent, conflicts, rejected, stoppedBy: "idle" };
}

/** Puts back in the queue what was `sending` when the app closed: the same request id is asked again (idempotent on the server). */
export async function recoverInterruptedCustomerEdits(db: SqlExecutor, env: OfflineEnv): Promise<void> {
  await db.execute("UPDATE pending_customer_edit SET state = 'queued', updated_at = ? WHERE state = 'sending'", [isoNow(env)]);
}

/**
 * The seller's choice on a conflict. `mine`: the edit is sent again over the ERP's current version (the server's contact version
 * becomes the new base). `theirs`: the local edit is discarded and the ERP's data stays. Anything else about the row is untouched.
 */
export async function resolveCustomerEditConflict(db: SqlDatabase, env: OfflineEnv, ownerAccountId: string, clientRequestId: string, choice: "mine" | "theirs"): Promise<void> {
  await db.transaction(async (tx) => {
    const rows = await tx.query<SqlRow>("SELECT * FROM pending_customer_edit WHERE owner_account_id = ? AND client_request_id = ? AND state = 'conflict'", [ownerAccountId, clientRequestId]);
    const row = rows[0];
    if (row === undefined) return;
    const edit = toRecord(row);
    if (choice === "theirs" || edit.serverVersion === null) {
      await drop(tx, edit.seq);
      return;
    }
    await tx.execute("UPDATE pending_customer_edit SET state = 'queued', base_contact_version = ?, server_version = NULL, last_error = NULL, updated_at = ? WHERE seq = ?", [edit.serverVersion.contactVersion, isoNow(env), edit.seq]);
  });
}

/** Discards an edit the seller gave up on (refused by the ERP). A queued edit may also be discarded. */
export async function discardCustomerEdit(db: SqlExecutor, ownerAccountId: string, clientRequestId: string): Promise<void> {
  await db.execute("DELETE FROM pending_customer_edit WHERE owner_account_id = ? AND client_request_id = ? AND state IN ('queued', 'rejected')", [ownerAccountId, clientRequestId]);
}
