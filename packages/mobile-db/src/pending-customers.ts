import type { SqlDatabase, SqlExecutor, SqlRow } from "./connection";
import { DatasetUnavailableError, readExpectedDataset, sameDataset, type DatasetIdentity } from "./dataset-identity";
import { isoNow, normalizeSearchText, escapeLike, type OfflineEnv } from "./offline-env";
import { backoffDelayMs, classifyFailure, TransportError } from "./order-sync";
import { deleteMeta, getMeta, setMeta, upsertCustomer, type CustomerLike } from "./reference-cache";

/** Seller-facing text while the server says customer creation is switched off on this installation. The customer stays queued. */
export const CUSTOMER_CREATION_NOT_RELEASED = "Cadastro de cliente ainda não liberado, vamos tentar de novo";

/**
 * "0" while customer creation is switched off. The source of truth is `general.clientCreationEnabled` of the order-entry
 * configuration, re-read at every sync (owner 2026-11-13); a 409 `customer_write_disabled` may also set it until the next sync.
 * No expiry: only a sync (or an accepted answer) turns it back on.
 */
const CREATION_OFF_META = "customers.creation_enabled";

/**
 * Customers the seller created in the app that the ERP has not confirmed yet (customer-write plan A2, F7).
 *
 * - The local row is durable the moment `createPendingCustomer` resolves; delivery is `POST /customers` with the row's
 *   `client_request_id`, minted once and reused on EVERY retry (SNK-4 / P-08), so a lost reply can never create a
 *   second customer. A 202 / `pending` / `unknown` answer is "waiting for the ERP": the same key is asked again.
 * - The server outcome is authoritative. A refusal (duplicate document, validation, ERP refusal) keeps everything the
 *   seller typed and states the reason; it is never retried blindly (permanent failures are not resent).
 * - A pending customer has a NEGATIVE local code (`-seq`): it can never collide with an ERP code, and an order refuses it
 *   (`PENDING_CUSTOMER_MESSAGE`). When the ERP confirms, drafts that pointed to it are re-pointed to the real code
 *   (name kept) and the row disappears once the normal mirror pull delivers the real customer, so the list never shows both.
 * - No credit limit, price table or status is ever stored here: the seller does not send them (P-20 / plan A1).
 */

export type PendingCustomerState = "queued" | "sending" | "awaiting_erp" | "confirmed" | "rejected";

/** The body of `POST /customers` minus the idempotency key (kept in its own column). Same field names as the contract. */
export interface PendingCustomerRequest {
  readonly document: string;
  readonly name: string;
  readonly tradeName: string | null;
  readonly icmsClassification: "C" | "I" | "P" | "R" | "T" | "X";
  readonly stateRegistration: string | null;
  readonly phone: string | null;
  readonly email: string | null;
  readonly notes: string | null;
  readonly addresses: readonly {
    readonly streetCode: number;
    readonly neighborhoodCode: number;
    readonly number: string;
    readonly complement: string | null;
    readonly postalCode: string;
  }[];
  /** Manager/admin only. */
  readonly sellerCode?: number;
}

export interface PendingCustomerRecord {
  /** Negative, unique on the device; what a list item carries as its `code`. */
  readonly localCode: number;
  /** Local id and idempotency key of the creation. */
  readonly clientRequestId: string;
  readonly ownerAccountId: string;
  readonly name: string;
  /** Digits only. Never shown unmasked in a list. */
  readonly document: string;
  readonly maskedDocument: string;
  /**
   * What the seller typed. `null` once the server has CONFIRMED it (I-2: only the name and the ERP code stay), or once a REFUSED
   * one is older than `REFUSED_RETENTION_MS` (then `name` / `document` are `""` too). A refused one keeps it until then.
   */
  readonly request: PendingCustomerRequest | null;
  readonly state: PendingCustomerState;
  readonly registrationId: string | null;
  /** The ERP code once confirmed. */
  readonly customerCode: number | null;
  /** Seller-facing refusal reason when `rejected`. */
  readonly rejectionReason: string | null;
  /** Seller-facing text of the last transient problem; never a technical error. */
  readonly lastError: string | null;
  readonly attempts: number;
  readonly nextAttemptAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly dataset: DatasetIdentity;
}

export interface CreatePendingCustomerInput {
  readonly ownerAccountId: string;
  readonly request: PendingCustomerRequest;
  /**
   * "Refazer": the id of a REFUSED customer of the same account that this new one replaces. It is closed in the same
   * transaction as the insert, so a failed creation never loses what the seller typed.
   */
  readonly replacesRejected?: string;
}

export class PendingCustomerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PendingCustomerError";
  }
}

/* ---------- text ---------- */

export function digitsOf(value: string): string {
  return value.replace(/\D/g, "");
}

/** CPF `***.456.789-**`, CNPJ `**.***.678/0001-**`; any other length is fully masked. */
export function maskDocument(document: string): string {
  const d = digitsOf(document);
  if (d.length === 11) return `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**`;
  if (d.length === 14) return `**.***.${d.slice(5, 8)}/${d.slice(8, 12)}-**`;
  return "*".repeat(Math.max(d.length, 1));
}

/** The badge text of a pending customer (list and sheet). */
export function describePendingCustomer(record: Pick<PendingCustomerRecord, "state" | "rejectionReason" | "lastError">): string {
  if (record.state !== "confirmed" && record.state !== "rejected" && record.lastError === CUSTOMER_CREATION_NOT_RELEASED) return CUSTOMER_CREATION_NOT_RELEASED;
  switch (record.state) {
    case "queued":
    case "sending":
      return "Aguardando envio ao Sankhya";
    case "awaiting_erp":
      return "Aguardando confirmação do Sankhya";
    case "confirmed":
      return "Confirmado no Sankhya — carregando dados";
    case "rejected":
      return `Não aceito: ${record.rejectionReason ?? "o Sankhya recusou o cadastro."}`;
  }
}

/** Text of a failed attempt, in the seller's words. Permanent refusals are the stored `rejectionReason`. */
export function describeCustomerFailure(error: TransportError): string {
  switch (error.kind) {
    case "network":
      return "Sem conexão com o servidor. Vamos tentar de novo automaticamente.";
    case "server":
      return error.reason === "customer_write_disabled"
        ? CUSTOMER_CREATION_NOT_RELEASED
        :"O servidor está indisponível no momento. Vamos tentar de novo automaticamente.";
    case "rate_limit":
      return "Muitas tentativas seguidas. Vamos tentar de novo em instantes.";
    case "auth":
      return "Sua sessão expirou. Entre novamente para sincronizar.";
    case "registration_refused":
      return error.reason === "document_already_registered"
        ? "Já existe um cliente com este CPF/CNPJ."
        : "O Sankhya recusou o cadastro do cliente. Confira os dados.";
    case "idempotency_conflict":
      return "Este envio já foi registrado com outros dados e não pôde ser repetido.";
    case "validation":
      return error.message !== "" ? error.message : "O servidor recusou este cadastro. Revise os dados.";
    default:
      return "O servidor recusou este cadastro. Revise os dados.";
  }
}

/* ---------- rows ---------- */

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

export function toPendingCustomer(row: SqlRow): PendingCustomerRecord {
  const document = String(row.document);
  const payload = JSON.parse(String(row.payload)) as PendingCustomerRequest | null;
  return {
    localCode: -Number(row.seq),
    clientRequestId: String(row.client_request_id),
    ownerAccountId: String(row.owner_account_id),
    name: String(row.name),
    document,
    maskedDocument: row.masked_document === null || row.masked_document === undefined ? maskDocument(document) : String(row.masked_document),
    request: payload,
    state: String(row.state) as PendingCustomerState,
    registrationId: nullableString(row.registration_id),
    customerCode: row.customer_code === null || row.customer_code === undefined ? null : Number(row.customer_code),
    rejectionReason: nullableString(row.rejection_reason),
    lastError: nullableString(row.last_error),
    attempts: Number(row.attempts),
    nextAttemptAt: nullableString(row.next_attempt_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    dataset: { environment: String(row.dataset_environment), datasetId: String(row.dataset_id) },
  };
}

/* ---------- create / read ---------- */

/**
 * Saves a customer on the device and queues its creation. One statement; needs a confirmed dataset (the row is tied to it,
 * like an order). Refuses a document that already has an open (not refused) pending customer of this account on the device.
 */
export async function createPendingCustomer(db: SqlDatabase, env: OfflineEnv, input: CreatePendingCustomerInput): Promise<PendingCustomerRecord> {
  return db.transaction(async (tx) => {
    const confirmed = await readExpectedDataset(tx);
    if (confirmed === null) throw new DatasetUnavailableError();
    const document = digitsOf(input.request.document);
    const open = await tx.query<SqlRow>(
      "SELECT 1 AS hit FROM pending_customer WHERE owner_account_id = ? AND document = ? AND state <> 'rejected' LIMIT 1",
      [input.ownerAccountId, document],
    );
    if (open.length > 0) throw new PendingCustomerError("Já existe um cadastro com este CPF/CNPJ aguardando o Sankhya neste aparelho.");
    if (input.replacesRejected !== undefined) {
      const old = await getPendingCustomer(tx, input.ownerAccountId, input.replacesRejected);
      if (old === null || old.state !== "rejected") throw new PendingCustomerError("Só um cadastro não aceito pode ser refeito.");
    }
    const now = isoNow(env);
    const key = env.newId();
    const request: PendingCustomerRequest = { ...input.request, document };
    await tx.execute(
      `INSERT INTO pending_customer (client_request_id, owner_account_id, name, search_text, document, masked_document, payload, state, attempts, dataset_environment, dataset_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', 0, ?, ?, ?, ?)`,
      [
        key,
        input.ownerAccountId,
        request.name,
        normalizeSearchText([request.name, request.tradeName ?? "", document].join(" ")),
        document,
        maskDocument(document),
        JSON.stringify(request),
        confirmed.environment,
        confirmed.datasetId,
        now,
        now,
      ],
    );
    if (input.replacesRejected !== undefined) {
      await tx.execute("DELETE FROM pending_customer WHERE client_request_id = ? AND owner_account_id = ? AND state = 'rejected'", [input.replacesRejected, input.ownerAccountId]);
    }
    const created = await getPendingCustomer(tx, input.ownerAccountId, key);
    if (created === null) throw new Error("pending_customer vanished after its own insert");
    return created;
  });
}

/**
 * "Refazer" a refused customer: returns what the seller typed, to pre-fill (`null` once the retention window erased it; the seller
 * retypes). It checks the row is a refused one of this account. The refused row stays, with its reason, until the new customer is
 * created with `replacesRejected` (nothing is lost if the new attempt is abandoned), which removes it at once.
 */
export async function redoPendingCustomer(db: SqlExecutor, ownerAccountId: string, clientRequestId: string): Promise<PendingCustomerRequest | null> {
  const row = await getPendingCustomer(db, ownerAccountId, clientRequestId);
  if (row === null || row.state !== "rejected") throw new PendingCustomerError("Só um cadastro não aceito pode ser refeito.");
  return row.request;
}

/**
 * I-2 (owner 2026-11-13). CONFIRMED: the document, e-mail, phone and every other typed field go at once; only the name and the ERP
 * code stay. REFUSED: the typed data stays for `REFUSED_RETENTION_MS` (to redo it), then `purgeRefusedCustomers` erases it;
 * "Refazer" and discarding remove it at once.
 */
const ERASE_ALL_SQL = "document = '', name = '', search_text = '', payload = 'null'";

/** How long the typed data of a REFUSED customer may stay on the device (owner 2026-11-13). */
export const REFUSED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Erases the typed data of every refused customer older than the retention window (any account on this device; the injected clock
 * decides). A row some draft or outbox command still points at keeps its row (erased, with masked document and reason); any other is
 * removed. Run on app start, sync and foreground. Returns how many rows it erased or removed.
 */
export async function purgeRefusedCustomers(db: SqlDatabase, env: OfflineEnv): Promise<number> {
  const limit = new Date(env.now().getTime() - REFUSED_RETENTION_MS).toISOString();
  return db.transaction(async (tx) => {
    const due = await tx.query<SqlRow>(
      "SELECT client_request_id, seq, (document <> '' OR payload <> 'null' OR name <> '' OR search_text <> '') AS has_data FROM pending_customer WHERE state = 'rejected' AND updated_at <= ?",
      [limit],
    );
    let touched = 0;
    for (const row of due) {
      const localCode = -Number(row.seq);
      const referenced =
        (await tx.query<SqlRow>("SELECT 1 AS hit FROM local_order_draft WHERE customer_code = ? LIMIT 1", [localCode])).length > 0 ||
        (await tx.query<SqlRow>("SELECT 1 AS hit FROM outbox WHERE json_extract(payload, '$.request.customerCode') = ? LIMIT 1", [localCode])).length > 0;
      if (!referenced) {
        await tx.execute("DELETE FROM pending_customer WHERE client_request_id = ?", [String(row.client_request_id)]);
        touched += 1;
      } else if (Number(row.has_data) === 1) {
        await tx.execute(`UPDATE pending_customer SET ${ERASE_ALL_SQL} WHERE client_request_id = ?`, [String(row.client_request_id)]);
        touched += 1;
      }
    }
    return touched;
  });
}

/** `false` while the last configuration (or a 409) said "customer creation is off"; `true` otherwise, also when unknown. */
export async function isCustomerCreationAvailable(db: SqlExecutor, _env?: OfflineEnv): Promise<boolean> {
  return (await getMeta(db, CREATION_OFF_META)) !== "0";
}

/**
 * Applies the creation signal of a freshly pulled configuration (inside the pull transaction). `false` hides the entry point;
 * `true` shows it and clears the "not released" notice of waiting customers (they are due again); absent = unknown: nothing is
 * hidden and nothing is inferred.
 */
export async function applyCustomerCreationSignal(tx: SqlExecutor, configuration: unknown, now: string): Promise<void> {
  const general = typeof configuration === "object" && configuration !== null ? (configuration as { general?: unknown }).general : undefined;
  const flag = typeof general === "object" && general !== null ? (general as { clientCreationEnabled?: unknown }).clientCreationEnabled : undefined;
  if (flag === false) {
    await setMeta(tx, CREATION_OFF_META, "0", now);
    return;
  }
  if ((await getMeta(tx, CREATION_OFF_META)) !== null) await deleteMeta(tx, CREATION_OFF_META);
  if (flag === true) {
    await tx.execute(
      "UPDATE pending_customer SET last_error = NULL, next_attempt_at = NULL, updated_at = ? WHERE last_error = ? AND state IN ('queued', 'awaiting_erp')",
      [now, CUSTOMER_CREATION_NOT_RELEASED],
    );
  }
}

export async function getPendingCustomer(db: SqlExecutor, ownerAccountId: string, clientRequestId: string): Promise<PendingCustomerRecord | null> {
  const rows = await db.query<SqlRow>("SELECT * FROM pending_customer WHERE owner_account_id = ? AND client_request_id = ?", [ownerAccountId, clientRequestId]);
  return rows[0] === undefined ? null : toPendingCustomer(rows[0]);
}

/** A pending customer by its negative local code (owner-scoped). */
export async function getPendingCustomerByLocalCode(db: SqlExecutor, ownerAccountId: string, localCode: number): Promise<PendingCustomerRecord | null> {
  if (localCode >= 0) return null;
  const rows = await db.query<SqlRow>("SELECT * FROM pending_customer WHERE owner_account_id = ? AND seq = ?", [ownerAccountId, -localCode]);
  return rows[0] === undefined ? null : toPendingCustomer(rows[0]);
}

/**
 * The owner's pending customers of the CONFIRMED dataset, newest first, filtered by a name/document search. Rows of another
 * dataset or account are never listed (and never sent).
 */
export async function listPendingCustomers(
  db: SqlExecutor,
  ownerAccountId: string,
  dataset: DatasetIdentity | null,
  search = "",
): Promise<PendingCustomerRecord[]> {
  if (dataset === null) return [];
  const terms = normalizeSearchText(search).split(" ").filter((term) => term !== "");
  const rows = await db.query<SqlRow>(
    `SELECT * FROM pending_customer WHERE owner_account_id = ? AND dataset_environment = ? AND dataset_id = ?
       ${terms.map(() => "AND search_text LIKE ? ESCAPE '\\'").join(" ")} ORDER BY created_at DESC, seq DESC`,
    [ownerAccountId, dataset.environment, dataset.datasetId, ...terms.map((term) => `%${escapeLike(term)}%`)],
  );
  return rows.map(toPendingCustomer);
}

export interface PendingCustomerCounts {
  /** Waiting to be delivered or confirmed (queued, sending, awaiting_erp). */
  readonly pending: number;
  /** Refused by the server: the seller must look at them. */
  readonly needsAttention: number;
}

export async function countPendingCustomers(db: SqlExecutor, ownerAccountId: string, dataset: DatasetIdentity | null): Promise<PendingCustomerCounts> {
  const rows = await db.query<SqlRow>(
    "SELECT state, dataset_environment, dataset_id, count(*) AS n FROM pending_customer WHERE owner_account_id = ? AND state <> 'confirmed' GROUP BY state, dataset_environment, dataset_id",
    [ownerAccountId],
  );
  const counts = { pending: 0, needsAttention: 0 };
  for (const row of rows) {
    const n = Number(row.n);
    const own = { environment: String(row.dataset_environment), datasetId: String(row.dataset_id) };
    if (String(row.state) === "rejected") counts.needsAttention += n;
    else if (dataset === null || sameDataset(own, dataset)) counts.pending += n;
    else counts.needsAttention += n; // another dataset: never sent, but never silently forgotten
  }
  return counts;
}

/* ---------- delivery ---------- */

export interface RemoteCustomerRegistration {
  readonly registrationId: string;
  readonly status: "pending" | "confirmed" | "rejected" | "unknown";
  /** `null` until the ERP confirms. */
  readonly customerCode: number | null;
}

/** HTTP surface of the creation. The app adapter maps `ApiRequestError` to `TransportError`. */
export interface CustomerRegistrationTransport {
  createCustomer(clientRequestId: string, request: PendingCustomerRequest): Promise<RemoteCustomerRegistration>;
  /** Reads the real customer by its ERP code (`GET /customers/{code}`), in the shape the mirror pull stores. */
  getCustomer(code: number): Promise<CustomerLike>;
}

export type PendingCustomerPushStop = "idle" | "offline" | "auth" | "dataset_unconfirmed" | "limit" | "not_released";

export interface PendingCustomerPushResult {
  readonly attempted: number;
  readonly confirmed: number;
  /** Refused for good in this run. */
  readonly rejected: number;
  readonly stoppedBy: PendingCustomerPushStop;
}

export interface PendingCustomerPushOptions {
  readonly currentDataset: DatasetIdentity | null;
  readonly respectBackoff?: boolean;
  readonly maxOperations?: number;
  readonly onUnexpectedError?: (error: unknown) => void;
}

/** A row mid-flight when the app died has an unknown outcome: it goes back to the queue, key and data untouched. */
export async function recoverInterruptedCustomers(db: SqlDatabase, env: OfflineEnv): Promise<number> {
  const stuck = await db.query<SqlRow>("SELECT client_request_id FROM pending_customer WHERE state = 'sending'");
  for (const row of stuck) {
    await db.execute(
      "UPDATE pending_customer SET state = CASE WHEN registration_id IS NULL THEN 'queued' ELSE 'awaiting_erp' END, last_error = ?, next_attempt_at = NULL, updated_at = ? WHERE client_request_id = ?",
      ["Envio interrompido; será repetido com a mesma identificação.", isoNow(env), String(row.client_request_id)],
    );
  }
  return stuck.length;
}

async function dueRows(db: SqlExecutor, env: OfflineEnv, ownerAccountId: string, dataset: DatasetIdentity, respectBackoff: boolean): Promise<PendingCustomerRecord[]> {
  const rows = await db.query<SqlRow>(
    `SELECT * FROM pending_customer WHERE owner_account_id = ? AND dataset_environment = ? AND dataset_id = ? AND state IN ('queued', 'awaiting_erp', 'confirmed') ORDER BY created_at, seq`,
    [ownerAccountId, dataset.environment, dataset.datasetId],
  );
  const now = isoNow(env);
  return rows.map(toPendingCustomer).filter((row) => !respectBackoff || row.nextAttemptAt === null || row.nextAttemptAt <= now);
}

/** Re-points drafts (and their unsent commands) from the local code to the ERP code. The customer name stays as the seller saw it. */
async function repointDrafts(tx: SqlExecutor, ownerAccountId: string, localCode: number, customerCode: number): Promise<void> {
  await tx.execute(
    `UPDATE outbox SET payload = json_set(payload, '$.request.customerCode', ?)
     WHERE json_extract(payload, '$.request.customerCode') = ? AND draft_local_id IN (SELECT local_id FROM local_order_draft WHERE owner_account_id = ? AND customer_code = ?)`,
    [customerCode, localCode, ownerAccountId, localCode],
  );
  await tx.execute("UPDATE local_order_draft SET customer_code = ? WHERE owner_account_id = ? AND customer_code = ?", [customerCode, ownerAccountId, localCode]);
}

async function applyConfirmed(db: SqlDatabase, env: OfflineEnv, row: PendingCustomerRecord, registrationId: string, customerCode: number): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(
      `UPDATE pending_customer SET state = 'confirmed', customer_code = ?, registration_id = ?, last_error = NULL, next_attempt_at = NULL, updated_at = ?, document = '', masked_document = '', search_text = ?, payload = 'null' WHERE client_request_id = ?`,
      [customerCode, registrationId, isoNow(env), normalizeSearchText(row.name), row.clientRequestId],
    );
    await repointDrafts(tx, row.ownerAccountId, row.localCode, customerCode);
  });
}

/**
 * The ERP confirmed: bring the REAL customer onto the device now (what the server reads back from the ERP, same shape as the pull),
 * so it receives orders at once, and drop the local row in the same transaction. When the read fails the row stays `confirmed`
 * (listed under its real code, orders allowed: the customer does exist) and only the read is retried on the next run.
 * Returns `"offline"` when the read hit a dead network.
 */
async function settleFromServer(db: SqlDatabase, env: OfflineEnv, transport: CustomerRegistrationTransport, row: PendingCustomerRecord, customerCode: number): Promise<"settled" | "waiting" | "offline"> {
  let customer: CustomerLike;
  try {
    customer = await transport.getCustomer(customerCode);
  } catch (caught) {
    const text = caught instanceof TransportError ? describeCustomerFailure(caught) : "Não foi possível ler o cliente agora. Vamos tentar de novo.";
    await db.execute("UPDATE pending_customer SET last_error = ?, updated_at = ? WHERE client_request_id = ?", [text, isoNow(env), row.clientRequestId]);
    return caught instanceof TransportError && caught.kind === "network" ? "offline" : "waiting";
  }
  await db.transaction(async (tx) => {
    await upsertCustomer(tx, { ...customer, code: customerCode });
    await tx.execute("DELETE FROM pending_customer WHERE client_request_id = ? AND owner_account_id = ?", [row.clientRequestId, row.ownerAccountId]);
  });
  return "settled";
}

async function noteCreationAnswer(db: SqlExecutor, env: OfflineEnv, disabled: boolean): Promise<void> {
  if (disabled) await setMeta(db, CREATION_OFF_META, "0", isoNow(env));
  else if ((await getMeta(db, CREATION_OFF_META)) !== null) await deleteMeta(db, CREATION_OFF_META);
}

/**
 * Delivers the owner's queued / waiting customers, one request at a time, in creation order. Stops at the first sign the network
 * or the session is unusable. Only rows of the confirmed dataset are sent (fail closed without one).
 */
export async function pushPendingCustomers(
  db: SqlDatabase,
  env: OfflineEnv,
  transport: CustomerRegistrationTransport,
  ownerAccountId: string,
  options: PendingCustomerPushOptions,
): Promise<PendingCustomerPushResult> {
  const respectBackoff = options.respectBackoff ?? true;
  const max = options.maxOperations ?? 20;
  let attempted = 0;
  let confirmed = 0;
  let rejected = 0;
  const startedUnder = options.currentDataset;
  if (startedUnder === null) return { attempted, confirmed, rejected, stoppedBy: "dataset_unconfirmed" };

  const rows = await dueRows(db, env, ownerAccountId, startedUnder, respectBackoff);
  for (const row of rows) {
    if (attempted >= max) return { attempted, confirmed, rejected, stoppedBy: "limit" };
    // The confirmation can change mid-run: nothing further is sent under another dataset.
    if (!sameDataset(await readExpectedDataset(db), startedUnder)) return { attempted, confirmed, rejected, stoppedBy: "dataset_unconfirmed" };
    if (row.state === "confirmed") {
      // Already confirmed by the ERP: only the read of the real record is missing. Never a second create.
      if (row.customerCode === null) continue;
      attempted += 1;
      const done = await settleFromServer(db, env, transport, row, row.customerCode);
      if (done === "offline") return { attempted, confirmed, rejected, stoppedBy: "offline" };
      continue;
    }
    if (row.request === null) continue; // an erased (answered) row is never resent
    const request = row.request;
    attempted += 1;
    const attempts = row.attempts + 1;
    await db.execute("UPDATE pending_customer SET state = 'sending', attempts = ?, updated_at = ? WHERE client_request_id = ?", [attempts, isoNow(env), row.clientRequestId]);
    const resting = row.registrationId === null ? "queued" : "awaiting_erp";
    try {
      const remote = await transport.createCustomer(row.clientRequestId, request);
      await noteCreationAnswer(db, env, false);
      if (remote.status === "confirmed" && remote.customerCode !== null) {
        await applyConfirmed(db, env, row, remote.registrationId, remote.customerCode);
        confirmed += 1;
        const done = await settleFromServer(db, env, transport, row, remote.customerCode);
        if (done === "offline") return { attempted, confirmed, rejected, stoppedBy: "offline" };
      } else {
        // pending / unknown (or "confirmed" without a code): the ERP has not answered yet. Ask again with the same key later.
        const next = new Date(env.now().getTime() + backoffDelayMs(attempts)).toISOString();
        await db.execute(
          "UPDATE pending_customer SET state = 'awaiting_erp', registration_id = ?, last_error = NULL, next_attempt_at = ?, updated_at = ? WHERE client_request_id = ?",
          [remote.registrationId, next, isoNow(env), row.clientRequestId],
        );
      }
    } catch (caught) {
      const error = caught instanceof TransportError ? caught : new TransportError("server", "Falha inesperada.");
      if (!(caught instanceof TransportError)) options.onUnexpectedError?.(caught);
      const failure = classifyFailure(error.kind);
      const text = describeCustomerFailure(error);
      if (failure === "transient" || failure === "auth") {
        // Kept in the queue with the same key. An auth failure says nothing about the data: no backoff.
        const next = failure === "auth" ? null : new Date(env.now().getTime() + backoffDelayMs(attempts)).toISOString();
        await db.execute("UPDATE pending_customer SET state = ?, last_error = ?, next_attempt_at = ?, updated_at = ? WHERE client_request_id = ?", [
          resting,
          text,
          next,
          isoNow(env),
          row.clientRequestId,
        ]);
        if (error.kind === "network") return { attempted, confirmed, rejected, stoppedBy: "offline" };
        if (error.kind === "server" && error.reason === "customer_write_disabled") {
          // The write path is off on this installation: every other queued customer would get the same answer.
          await noteCreationAnswer(db, env, true);
          return { attempted, confirmed, rejected, stoppedBy: "not_released" };
        }
        if (failure === "auth") return { attempted, confirmed, rejected, stoppedBy: "auth" };
        continue;
      }
      // Permanent: the typed data stays for the retention window (REFUSED_RETENTION_MS), the reason is stated, nothing is resent on its own.
      await db.execute(
        `UPDATE pending_customer SET state = 'rejected', rejection_reason = ?, last_error = NULL, next_attempt_at = NULL, updated_at = ? WHERE client_request_id = ?`,
        [text, isoNow(env), row.clientRequestId],
      );
      rejected += 1;
    }
  }
  return { attempted, confirmed, rejected, stoppedBy: "idle" };
}

/* ---------- seller actions ---------- */

/** Makes a queued / waiting customer due now (the next sync run sends it with the same key). A refused one cannot be resent. */
export async function retryPendingCustomer(db: SqlDatabase, env: OfflineEnv, ownerAccountId: string, clientRequestId: string): Promise<void> {
  const row = await getPendingCustomer(db, ownerAccountId, clientRequestId);
  if (row === null) throw new PendingCustomerError("Cliente não encontrado neste aparelho.");
  if (row.state === "rejected") throw new PendingCustomerError("O Sankhya não aceitou este cadastro; ele não pode ser reenviado.");
  if (row.state === "confirmed") return;
  await db.execute("UPDATE pending_customer SET next_attempt_at = NULL, updated_at = ? WHERE client_request_id = ?", [isoNow(env), clientRequestId]);
}

/**
 * Local-only removal. Allowed for a refused customer (the server holds nothing for it) and for one never sent (no attempt yet).
 * Anything else may exist in the ERP and cannot be dropped here without leaving an orphan.
 */
export async function discardPendingCustomer(db: SqlDatabase, ownerAccountId: string, clientRequestId: string): Promise<void> {
  const row = await getPendingCustomer(db, ownerAccountId, clientRequestId);
  if (row === null) return;
  const neverSent = row.state === "queued" && row.attempts === 0 && row.registrationId === null;
  if (row.state !== "rejected" && !neverSent) {
    throw new PendingCustomerError("Este cadastro já foi enviado ao servidor e não pode ser descartado aqui.");
  }
  await db.execute("DELETE FROM pending_customer WHERE client_request_id = ? AND owner_account_id = ?", [clientRequestId, ownerAccountId]);
}

/**
 * Called inside the mirror pull: a confirmed customer whose real record is now in the mirror is replaced by it (the local row goes),
 * so the list shows one customer, never both.
 */
export async function settleConfirmedCustomers(tx: SqlExecutor): Promise<number> {
  const settled = await tx.query<SqlRow>("SELECT client_request_id FROM pending_customer WHERE state = 'confirmed' AND customer_code IN (SELECT code FROM cache_customer)");
  if (settled.length > 0) await tx.execute("DELETE FROM pending_customer WHERE state = 'confirmed' AND customer_code IN (SELECT code FROM cache_customer)");
  return settled.length;
}
