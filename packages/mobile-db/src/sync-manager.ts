import type { SqlDatabase, SqlRow } from "./connection";
import { DatasetIdentityError, confirmDataset, readCacheDataset, readExpectedDataset, sameDataset, writeCacheDataset, type DatasetIdentity } from "./dataset-identity";
import { countOutbox, draftErpNumber, getDraft, listAttentionItems, listOutbox, type AttentionItem, type DraftRecord } from "./local-orders";
import { verifyAndRepairMirror, type ExpectedMirror } from "./mirror-check";
import { isoNow, type OfflineEnv } from "./offline-env";
import { mergeServerOrders, type ServerOrdersSource } from "./server-orders";
import { refreshOneOrderErpStatus, refreshOrderErpStatuses, type OrderStatusSource } from "./order-erp-status";
import { countSendRequests, pushOutbox, pushSendRequests, recoverInterrupted, reevaluateHeldOrders, TransportError, type OrderTransport, type PushOptions, type PushStop } from "./order-sync";
import {
  applyCustomerCreationSignal,
  countPendingCustomers,
  pushPendingCustomers,
  recoverInterruptedCustomers,
  settleConfirmedCustomers,
  type CustomerRegistrationTransport,
} from "./pending-customers";
import { META_KEYS, cachedPriceTableCodes, clearProductGroups, countPriceRows, deleteMeta, getMeta, replaceCustomers, replacePriceTableNames, replacePriceTables, replaceProductGroups, replaceProducts, setMeta, type CustomerLike, type PriceOrigin, type PriceTableSnapshot, type ProductGroupsFetch, type ProductLike } from "./reference-cache";

/**
 * Where the reference data comes from. The server stays authoritative and delivers only what the actor's scope
 * allows (P-21); the client never widens it. Implementations page through the API and return the full snapshot.
 */
export interface ReferenceSource extends OrderStatusSource, ServerOrdersSource {
  /** `onPage` reports the rows read so far and the server's total after each page (real progress; optional). */
  fetchCustomers(onPage?: PageProgress): Promise<readonly CustomerLike[]>;
  fetchProducts(onPage?: PageProgress): Promise<readonly ProductLike[]>;
  /**
   * Prices of EACH price table the visible customers use (owner 2026-11-13), read by table code from the bulk endpoint. `tables`
   * are the ones read completely; `failed` the ones whose read failed in a way that may pass (their previous prices stay, only for
   * the same account and dataset). A table in neither list is not served any more (dropped). An error that stops everything
   * (no network, session) is THROWN and fails the pull, leaving the previous cache untouched: never swallowed into "no tables".
   */
  fetchPriceTables?(tableCodes: readonly number[], onTable?: (done: number, total: number, rows: number) => void): Promise<PriceTablesFetch>;
  /** Order-entry configuration as the API delivers it (JSON-serializable); `null` when the server has none. */
  fetchEntryConfiguration(): Promise<unknown>;
  /** Dataset the server serves (`null` = the server cannot tell: fail closed, nothing is cached or sent). */
  fetchDatasetIdentity(): Promise<DatasetIdentity | null>;
  /** Opaque change marker of the reference data (`GET /sync/status` `referenceVersion`); `null` = the server cannot tell yet. */
  fetchReferenceVersion?(): Promise<string | null>;
  /** Asks the server to re-read these orders from the ERP (`POST /orders/{id}/refresh`, 202). Best-effort. */
  requestOrderRefresh?(orderId: string): Promise<void>;
  /** Active carriers (D-C). Optional and best-effort: a failure here never fails the pull. */
  fetchCarriers?(): Promise<readonly unknown[]>;
  /** Group hierarchy (Grupo > Subgrupo > Linha). Optional and best-effort like carriers: a failure keeps the previous tree. */
  fetchProductGroups?(): Promise<ProductGroupsFetch>;
  /** Table the server resolves the catalog (no customer) against, for the list's "origin of the prices". Best-effort like carriers. */
  fetchPricesOrigin?(): Promise<PriceOrigin>;
  /**
   * On-demand refresh (POST /sync/refresh, then follow it until done). The manager calls it BEFORE any download and downloads only
   * after it returns. Optional so a source without it just downloads. Throws `TransportError` when the server cannot be reached.
   */
  refreshOnDemand?(onProgress: (progress: RefreshProgress) => void): Promise<RefreshOutcome>;
}

/** Rows read so far and the total the server announced. */
export type PageProgress = (loaded: number, total: number) => void;

/** Steps of a full sync the seller sees, in the order they run. */
export type SyncStepId = "push" | "server" | "customers" | "products" | "prices" | "negotiation" | "carriers" | "save" | "orders";
export type SyncStepState = "pending" | "running" | "done" | "error";

/** One step of the full sync with REAL counts from the pipeline (never a timer). `total` null = unknown; `indeterminate` = no progress can be reported. */
export interface SyncStep {
  readonly id: SyncStepId;
  readonly state: SyncStepState;
  readonly count: number | null;
  readonly total: number | null;
  readonly indeterminate: boolean;
  /** Short seller-safe remark (e.g. "mantidas as anteriores"). */
  readonly note?: string;
}

export interface SyncStepEvent {
  readonly id: SyncStepId;
  readonly state: SyncStepState;
  readonly count?: number | null;
  readonly total?: number | null;
  readonly note?: string;
}

export interface PriceTablesFetch {
  readonly tables: readonly PriceTableSnapshot[];
  readonly failed: readonly number[];
}

/** Friendly (pt-BR) label of the step the server is running; `percent` is null when unknown. */
export interface RefreshProgress {
  readonly label: string;
  readonly percent: number | null;
}

/** How many items of a kind the mobility field shows/hides, and whether the anti-empty guard kept the previous data. */
export interface MobilityCount {
  readonly kind: "products" | "tops" | "negotiationTypes";
  readonly visible: number;
  readonly hidden: number;
  readonly keptPrevious: boolean;
}

/** `failed` = at least one step of the refresh failed (the ERP could not be read); `failedSteps` names them when the server says. */
export interface RefreshOutcome {
  readonly failed: boolean;
  readonly failedSteps: readonly string[];
  /** Mobility counts per kind (owner 2026-11-13). Present only in the server's detail view (staff); the seller view never has them. */
  readonly mobility?: readonly MobilityCount[];
}

export interface PullResult {
  readonly customers: number;
  readonly products: number;
  /** Price tables kept on the device after this pull, and their price rows (size indicator). */
  readonly priceTables: number;
  readonly priceRows: number;
  /** Tables whose read failed in this pull (previous prices kept only for the same account and dataset). */
  readonly priceTablesFailed: readonly number[];
}

export interface PullOptions {
  /** Called with a log-safe line (entity, counts, hashes: never records) when the device mirror differed from the server's data. */
  readonly onMirrorMismatch?: (message: string) => void;
}

/**
 * Full-snapshot pull with an atomic replace: everything is fetched first and only then swapped in one transaction,
 * so a failure midway (network drop, kill) leaves the previous cache untouched. Incremental/watermark sync is not
 * implemented (SYNC-2 PROPOSED, V-07/V-14 open).
 */
export async function pullReferenceData(
  db: SqlDatabase,
  env: OfflineEnv,
  source: ReferenceSource,
  ownerAccountId: string,
  onStep: (event: SyncStepEvent) => void = () => undefined,
  options: PullOptions = {},
): Promise<PullResult> {
  // The identity is read before AND after the data: the snapshot is only trusted when the server declared the same
  // dataset on both sides (a dataset switch in the middle of a pull would otherwise mix two datasets in one cache).
  const before = await source.fetchDatasetIdentity();
  if (before === null) throw new DatasetIdentityError();
  onStep({ id: "customers", state: "running", count: 0, total: null });
  onStep({ id: "products", state: "running", count: 0, total: null });
  const [customers, products, configuration] = await Promise.all([
    source.fetchCustomers((loaded, total) => onStep({ id: "customers", state: "running", count: loaded, total })).then((rows) => {
      onStep({ id: "customers", state: "done", count: rows.length, total: rows.length });
      return rows;
    }),
    source.fetchProducts((loaded, total) => onStep({ id: "products", state: "running", count: loaded, total })).then((rows) => {
      onStep({ id: "products", state: "done", count: rows.length, total: rows.length });
      return rows;
    }),
    source.fetchEntryConfiguration(),
  ]);
  const negotiationTypes = (configuration as { negotiationTypes?: unknown } | null | undefined)?.negotiationTypes;
  onStep({ id: "negotiation", state: "done", count: Array.isArray(negotiationTypes) ? negotiationTypes.length : 0 });
  // Each distinct price table the customers use (a customer without a table uses the base catalog).
  const used = new Set<number>();
  for (const customer of customers) {
    const table = customer.priceTableCode;
    if (table !== null && table !== undefined) used.add(table);
  }
  let priceTables: readonly PriceTableSnapshot[] = [];
  let failedTables: readonly number[] = [];
  if (source.fetchPriceTables !== undefined && used.size > 0) {
    onStep({ id: "prices", state: "running", count: 0, total: null, note: `0 de ${used.size} tabelas` });
    const fetched = await source.fetchPriceTables([...used].sort((a, b) => a - b), (done, total, rows) =>
      onStep({ id: "prices", state: "running", count: rows, total: null, note: `${done} de ${total} tabelas` }),
    );
    priceTables = fetched.tables;
    failedTables = fetched.failed.filter((code) => used.has(code));
    const priceRows = priceTables.reduce((sum, table) => sum + table.prices.length, 0);
    onStep({ id: "prices", state: "done", count: priceRows, total: priceRows, note: `${priceTables.length} ${priceTables.length === 1 ? "tabela" : "tabelas"}` });
  } else {
    onStep({ id: "prices", state: "done", count: 0 });
  }
  const after = await source.fetchDatasetIdentity();
  if (!sameDataset(before, after)) throw new DatasetIdentityError("O conjunto de dados do servidor mudou durante a atualização.");
  // The carrier list is a convenience: when it cannot be read the previous list stays, unless it belongs to another dataset.
  const previousDataset = await readExpectedDataset(db);
  // Prices carried over from the previous pull are trusted only when that pull was this account's, under this same dataset.
  const sameOwnerAndDataset = (await getMeta(db, META_KEYS.cacheOwner)) === ownerAccountId && sameDataset(await readCacheDataset(db), before);
  let carriers: readonly unknown[] | null = null;
  onStep({ id: "carriers", state: "running", count: null });
  if (source.fetchCarriers !== undefined) {
    try {
      carriers = await source.fetchCarriers();
      onStep({ id: "carriers", state: "done", count: carriers.length });
    } catch {
      carriers = null;
      onStep({ id: "carriers", state: "error", note: "mantidas as anteriores" });
    }
  } else {
    onStep({ id: "carriers", state: "done", count: 0 });
  }
  // Same for the group hierarchy: on failure the previous tree stays, unless it belongs to another dataset.
  let productGroups: ProductGroupsFetch | null = null;
  if (source.fetchProductGroups !== undefined) {
    try {
      productGroups = await source.fetchProductGroups();
    } catch {
      productGroups = null;
    }
  }
  let pricesOrigin: PriceOrigin | null = null;
  if (source.fetchPricesOrigin !== undefined) {
    try {
      pricesOrigin = await source.fetchPricesOrigin();
    } catch {
      pricesOrigin = null;
    }
  }
  onStep({ id: "save", state: "running", count: null });
  const now = isoNow(env);
  await db.transaction(async (tx) => {
    await writeCacheDataset(tx, before, now);
    await confirmDataset(tx, before, now);
    await replaceCustomers(tx, customers);
    // A customer confirmed by the ERP is replaced by its real mirror record (no duplicate in the list).
    await settleConfirmedCustomers(tx);
    await replaceProducts(tx, products);
    if (productGroups !== null) await replaceProductGroups(tx, productGroups, now);
    else if (!sameDataset(previousDataset, before)) await clearProductGroups(tx);
    // Tables whose read FAILED keep their previous prices (same account and dataset only); the rest not read are dropped.
    const keepTables = sameOwnerAndDataset ? (await cachedPriceTableCodes(tx)).filter((code) => failedTables.includes(code) && !priceTables.some((t) => t.tableCode === code)) : [];
    await replacePriceTables(tx, priceTables.filter((t) => used.has(t.tableCode)), { keepTables });
    await replacePriceTableNames(tx, priceTables.filter((t) => used.has(t.tableCode)), now);
    if (pricesOrigin !== null) await setMeta(tx, META_KEYS.pricesOriginReference, JSON.stringify(pricesOrigin), now);
    else if (!sameDataset(previousDataset, before)) await deleteMeta(tx, META_KEYS.pricesOriginReference);
    await setMeta(tx, META_KEYS.customersSyncedAt, now, now);
    await setMeta(tx, META_KEYS.productsSyncedAt, now, now);
    await setMeta(tx, META_KEYS.entryConfiguration, JSON.stringify(configuration ?? null), now);
    // Customer creation released or not: re-read from the configuration at every sync (no TTL, no inference).
    await applyCustomerCreationSignal(tx, configuration, now);
    if (carriers !== null) await setMeta(tx, META_KEYS.carriers, JSON.stringify(carriers), now);
    else if (!sameDataset(previousDataset, before)) await deleteMeta(tx, META_KEYS.carriers);
    await setMeta(tx, META_KEYS.cacheOwner, ownerAccountId, now);
  });
  // Mirror check (RT-1): what the device now holds must equal what the server returned; a difference is repaired by re-downloading
  // that entity (atomic replace) and reported. Never fails the pull (the base is already saved); only a dead session propagates.
  const expectedMirror: ExpectedMirror = {
    customers: customers.map((customer) => customer.code),
    products: products.map((product) => product.code),
    priceTables: new Map(priceTables.filter((t) => used.has(t.tableCode)).map((t) => [t.tableCode, t.prices.map((price) => price.productCode)] as const)),
  };
  const report = options.onMirrorMismatch ?? (() => undefined);
  try {
    await verifyAndRepairMirror(
      db,
      expectedMirror,
      async (entity): Promise<Partial<ExpectedMirror> | void> => {
        if (entity === "customers") {
          const rows = await source.fetchCustomers();
          await db.transaction(async (tx) => {
            await replaceCustomers(tx, rows);
            await settleConfirmedCustomers(tx);
          });
          return { customers: rows.map((row) => row.code) };
        }
        if (entity === "products") {
          const rows = await source.fetchProducts();
          await db.transaction((tx) => replaceProducts(tx, rows));
          return { products: rows.map((row) => row.code) };
        }
        if (source.fetchPriceTables === undefined) return undefined;
        const codes = [...expectedMirror.priceTables.keys()];
        const fetched = await source.fetchPriceTables(codes);
        await db.transaction(async (tx) => {
          const others = (await cachedPriceTableCodes(tx)).filter((code) => !codes.includes(code));
          const replaced = fetched.tables.filter((t) => codes.includes(t.tableCode));
          const unread = codes.filter((code) => !replaced.some((t) => t.tableCode === code));
          await replacePriceTables(tx, replaced, { keepTables: [...others, ...unread] });
        });
        return { priceTables: new Map(fetched.tables.filter((t) => codes.includes(t.tableCode)).map((t) => [t.tableCode, t.prices.map((price) => price.productCode)] as const)) };
      },
      report,
    );
  } catch (error) {
    if (error instanceof TransportError && error.kind === "auth") throw error;
    report(`mirror repair failed: ${error instanceof Error ? error.name : "error"}`);
  }
  onStep({ id: "save", state: "done", count: customers.length + products.length });
  const kept = await db.transaction(async (tx) => ({ tables: (await cachedPriceTableCodes(tx)).length, rows: await countPriceRows(tx) }));
  return { customers: customers.length, products: products.length, priceTables: kept.tables, priceRows: kept.rows, priceTablesFailed: failedTables };
}

/* ---------- sync manager ---------- */

export type SyncPhase = "idle" | "syncing" | "offline" | "error" | "auth_required";

/** Why the last run did not fully succeed. `no_internet` and `server_unavailable` are the only ones shown as "Offline". */
export type SyncFailure = "no_internet" | "server_unavailable" | "sankhya_unavailable" | "auth" | "error";

/** Exact seller-facing wording per cause (owner 2026-11-13). */
export const SYNC_FAILURE_TEXT: Readonly<Record<SyncFailure, string>> = {
  no_internet: "Sem internet — alterações salvas neste aparelho",
  server_unavailable: "Servidor do Force indisponível — alterações salvas neste aparelho, tentaremos de novo",
  sankhya_unavailable: "Sankhya indisponível — mantendo os dados da última sincronização",
  auth: "Sua sessão expirou. Entre novamente para sincronizar.",
  error: "Erro ao sincronizar",
};

export const PRICE_TABLES_FAILED_TEXT = "Algumas tabelas de preço não foram baixadas. Sincronize novamente.";

/** What the device can tell about its own internet (the OS check); the manager never probes by itself. */
export type InternetState = "online" | "offline" | "unknown";

export interface SyncStatus {
  readonly phase: SyncPhase;
  /** Commands waiting to be delivered (pending or sending). */
  readonly pending: number;
  /** Commands the seller must look at (rejected, conflict, price review). */
  readonly needsAttention: number;
  /** Confirmed orders waiting to reach Sankhya or refused by it (the Vendas tab counter). */
  readonly awaitingOrders?: number;
  /** Time of the last SUCCESSFUL sync (pull without failures); persisted. */
  readonly lastSyncedAt: string | null;
  /** Seller-safe text; never a raw technical error. */
  readonly lastError: string | null;
  /** Cause of the last run's failure; `null` after a clean run. */
  readonly failure?: SyncFailure | null;
  /** Friendly names of the refresh steps that failed on the server (Sankhya could not be read). */
  readonly failedSteps?: readonly string[];
  /** Mobility counts of the last refresh (staff detail view only; empty/absent for a seller). */
  readonly mobility?: readonly MobilityCount[];
  /** Orders that need attention, with the reason. */
  readonly attention?: readonly AttentionItem[];
  /** Step being run right now (only while `phase` is `syncing`). */
  readonly progress?: RefreshProgress | null;
  /** Steps of the current/last FULL sync (login or "Sincronizar"); `null` for a push-only run. Kept after the run so the overlay can show the final state. */
  readonly steps?: readonly SyncStep[] | null;
  /** RT-1: counts the automatic (background) updates that changed local data, so screens re-read; no meaning on its own. */
  readonly dataRevision?: number;
}

/** What an automatic update (RT-1) refreshes. Never shows progress and never changes the sync phase. */
export interface BackgroundRefresh {
  /** Re-read the account's orders and their ERP status (merge, removal, status). */
  readonly orders?: boolean;
  /** Re-download the reference data, only when the server's change marker differs from the one the device holds. */
  readonly reference?: boolean;
  /** Ask the server to re-read these orders from the ERP first (cap 20, 10 s cooldown per order). `"open"` = the newest ones the device holds. */
  readonly askServerFor?: "open" | { readonly localId: string };
}

/** At most this many orders are re-read from the ERP per request round, and no order twice within the cooldown. */
export const ORDER_REFRESH_CAP = 20;
export const ORDER_REFRESH_COOLDOWN_MS = 10_000;
const REFERENCE_VERSION_KEY = "cache.reference_version";

export type SyncReason = "login" | "manual" | "reconnected" | "foreground" | "timer" | "after_save";

export interface SyncManagerDeps {
  readonly db: SqlDatabase;
  readonly env: OfflineEnv;
  readonly transport: OrderTransport;
  /** Delivery of customers created in the app (F7). Absent = none are sent (they stay queued on the device). */
  readonly customerTransport?: CustomerRegistrationTransport;
  readonly source: ReferenceSource;
  readonly ownerAccountId: string;
  /** Called with unexpected (non-transport) errors, for logging. */
  readonly onUnexpectedError?: (error: unknown) => void;
  /** Called with a log-safe line when the device mirror differed from the server's data and was repaired (counts and hashes only). */
  readonly onMirrorMismatch?: (message: string) => void;
  /** Device internet state, to tell "no internet" from "server not answering". Absent = unknown (reported as the server). */
  readonly internetState?: () => InternetState;
}

export interface SyncManager {
  /**
   * Pushes pending commands, then (with `pull`, the default) refreshes the server and downloads the base. Concurrent calls share the
   * run in flight (single-flight); a call that wants the download while a push-only run is in flight runs it right after.
   */
  sync(reason: SyncReason, options?: { readonly pull?: boolean }): Promise<SyncStatus>;
  /**
   * Asks the full sync in flight to stop. It takes effect at the next checkpoint BEFORE the atomic swap of the local base (the
   * previous base stays intact); once the swap started the run finishes. Orders already sent stay sent. No-op otherwise.
   */
  cancel?(): void;
  getStatus(): SyncStatus;
  subscribe(listener: (status: SyncStatus) => void): () => void;
  /** Recomputes counters from the database (after a local save). */
  refresh(): Promise<SyncStatus>;
  /**
   * Automatic update while online (RT-1): no overlay, no phase change, never throws, nothing when offline or while the full sync runs.
   * Local drafts and open forms are never touched (the reference cache is separate from drafts and replaced atomically).
   */
  backgroundRefresh?(what: BackgroundRefresh): Promise<void>;
  /**
   * "Confirmar": tries to deliver the confirmed order now (create/replace, then submit) and waits at most `CONFIRM_WAIT_MS` for the
   * Sankhya number. Never throws for a failed delivery: the outcome says what happened; whatever is not concluded stays queued.
   */
  confirmOrder?(localId: string, options?: ConfirmOptions): Promise<ConfirmOutcome>;
  /**
   * Reads the order's status once from the server (stores number and stage) and returns its Sankhya number, or `null` when it is
   * not known yet (also offline or on a failed read: the stored value is returned). Used by the post-confirmation screen.
   */
  readOrderNumber?(localId: string): Promise<number | null>;
}

/** How long the seller waits on "Enviando ao Sankhya" before the screen is released (the order keeps going in the queue). One place. */
export const CONFIRM_WAIT_MS = 8000;
/** Interval between reads of the order's Sankhya number inside that wait. */
export const CONFIRM_POLL_MS = 1500;

export interface ConfirmOptions {
  readonly waitMs?: number;
  readonly pollMs?: number;
  /** Test seam; defaults to a timer. */
  readonly sleep?: (ms: number) => Promise<void>;
}

/**
 * Result of "Confirmar":
 * - `sent`: Sankhya created the order; `erpNumber` is its unique number.
 * - `sending`: the server took the order and the delivery is running; the number did not arrive within the wait.
 * - `awaiting_approval`: the server took it and the discount waits for a manager.
 * - `queued`: transient failure (offline, server/Sankhya unavailable, timeout); saved on the device and resent by itself.
 * - `refused`: definitive; no resend. `code` = catalog key of the refusal (null = the order is held by a local/outbox problem, `message` says which).
 */
export type ConfirmOutcome =
  | { readonly kind: "sent"; readonly erpNumber: number }
  | { readonly kind: "sending" }
  | { readonly kind: "awaiting_approval" }
  | { readonly kind: "queued"; /** `sankhya_unavailable`: the server answered 5xx/429 (not a dead network); the order stays queued. */ readonly reason?: "sankhya_unavailable" }
  | { readonly kind: "refused"; readonly code: string | null; readonly message: string | null };

interface Failure {
  readonly phase: SyncPhase;
  readonly failure: SyncFailure;
  readonly message: string;
}

const STEP_ORDER: readonly SyncStepId[] = ["push", "server", "customers", "products", "prices", "negotiation", "carriers", "save", "orders"];
const INITIAL_STEPS: readonly SyncStep[] = STEP_ORDER.map((id) => ({ id, state: "pending" as const, count: null, total: null, indeterminate: false }));

const failureOf = (failure: SyncFailure, phase: SyncPhase, message: string = SYNC_FAILURE_TEXT[failure]): Failure => ({ phase, failure, message });

function describeFailure(error: unknown, internet: InternetState): Failure {
  if (error instanceof DatasetIdentityError) return failureOf("error", "error", error.message);
  if (error instanceof TransportError) {
    if (error.kind === "network") return internet === "offline" ? failureOf("no_internet", "offline") : failureOf("server_unavailable", "offline");
    if (error.kind === "server" || error.kind === "rate_limit") return failureOf("server_unavailable", "offline");
    if (error.kind === "auth") return failureOf("auth", "auth_required");
  }
  return failureOf("error", "error");
}

/** The seller cancelled the run before the local swap; the previous base is untouched. */
class SyncCancelledError extends Error {
  constructor() {
    super("sync cancelled");
    this.name = "SyncCancelledError";
  }
}

export function createSyncManager(deps: SyncManagerDeps): SyncManager {
  const listeners = new Set<(status: SyncStatus) => void>();
  let cancelRequested = false;
  let status: SyncStatus = { phase: "idle", pending: 0, needsAttention: 0, lastSyncedAt: null, lastError: null, failure: null, failedSteps: [], attention: [], progress: null, steps: null };
  let inFlight: Promise<SyncStatus> | null = null;
  let inFlightPulls = false;
  let queuedPull: Promise<SyncStatus> | null = null;
  const internet = (): InternetState => deps.internetState?.() ?? "unknown";

  /** Bumped when a background refresh changed what the screens show (they re-read their lists); never shown. */
  let revision = 0;
  const publish = (next: SyncStatus): SyncStatus => {
    status = { ...next, dataRevision: revision };
    for (const listener of listeners) listener(status);
    return status;
  };

  const counters = async (): Promise<{ pending: number; needsAttention: number; awaitingOrders: number; attention: readonly AttentionItem[] }> => {
    const dataset = await readExpectedDataset(deps.db);
    const counts = await countOutbox(deps.db, deps.ownerAccountId, dataset, "confirmed");
    const customers = await countPendingCustomers(deps.db, deps.ownerAccountId, dataset);
    const attention = await listAttentionItems(deps.db, deps.ownerAccountId, 10, "confirmed");
    const sends = await countSendRequests(deps.db, deps.ownerAccountId, dataset);
    return {
      pending: counts.pending + counts.sending + customers.pending + sends.waiting,
      needsAttention: counts.needsAttention + customers.needsAttention + sends.refused,
      awaitingOrders: sends.waiting + sends.refused,
      attention,
    };
  };

  /** Server copies of orders only saved on the device: sent in the background (timer, foreground), never shown as pending. */
  const backgroundPending = async (): Promise<number> => {
    const counts = await countOutbox(deps.db, deps.ownerAccountId, await readExpectedDataset(deps.db), "all");
    return counts.pending + counts.sending;
  };

  const mirrorOptions: PullOptions = deps.onMirrorMismatch === undefined ? {} : { onMirrorMismatch: deps.onMirrorMismatch };

  /** The server's change marker of the reference data; `null` when unknown or unreadable (never throws). */
  const readReferenceVersion = async (): Promise<string | null> => {
    if (deps.source.fetchReferenceVersion === undefined) return null;
    try {
      return await deps.source.fetchReferenceVersion();
    } catch {
      return null;
    }
  };

  const lastOrderRefresh = new Map<string, number>();
  let ordersFlight: Promise<void> | null = null;
  let referenceFlight: Promise<void> | null = null;

  /** Tells the screens that local data changed without touching the phase (the sync icon stays as it is). */
  const announceChange = async (): Promise<void> => {
    revision += 1;
    publish({ ...status, ...(await counters()) });
  };

  const fullSyncRunning = (): boolean => inFlight !== null && inFlightPulls;

  const orderIdsToAsk = async (target: BackgroundRefresh["askServerFor"]): Promise<string[]> => {
    if (target === undefined) return [];
    if (target !== "open") {
      const draft = await getDraft(deps.db, target.localId);
      return draft?.remoteId == null ? [] : [draft.remoteId];
    }
    const rows = await deps.db.query<SqlRow>(
      "SELECT remote_id FROM local_order_draft WHERE owner_account_id = ? AND kind = 'saved' AND remote_id IS NOT NULL AND status = 'synced' ORDER BY updated_at DESC LIMIT ?",
      [deps.ownerAccountId, ORDER_REFRESH_CAP],
    );
    return rows.map((row) => String(row.remote_id));
  };

  const refreshOrdersInBackground = async (askServerFor: BackgroundRefresh["askServerFor"]): Promise<void> => {
    const nowMs = deps.env.now().getTime();
    const ask = (await orderIdsToAsk(askServerFor)).filter((id) => nowMs - (lastOrderRefresh.get(id) ?? Number.NEGATIVE_INFINITY) >= ORDER_REFRESH_COOLDOWN_MS).slice(0, ORDER_REFRESH_CAP);
    if (deps.source.requestOrderRefresh !== undefined) {
      for (const id of ask) {
        lastOrderRefresh.set(id, nowMs);
        try {
          await deps.source.requestOrderRefresh(id);
        } catch {
          // Best-effort: the read below still shows what the server already has.
        }
      }
    }
    await mergeServerOrders(deps.db, deps.env, deps.source, deps.transport, deps.ownerAccountId);
    await refreshOrderErpStatuses(deps.db, deps.env, deps.source, deps.ownerAccountId);
    await announceChange();
  };

  const refreshReferenceInBackground = async (): Promise<void> => {
    const version = await readReferenceVersion();
    if (version === null) return;
    if ((await getMeta(deps.db, REFERENCE_VERSION_KEY)) === version) return;
    await pullReferenceData(deps.db, deps.env, deps.source, deps.ownerAccountId, () => undefined, mirrorOptions);
    await setMeta(deps.db, REFERENCE_VERSION_KEY, version, isoNow(deps.env));
    await announceChange();
  };

  /** Runs one automatic job single-flight; every failure is swallowed (a dead session shows at the next normal call). */
  const guarded = (flight: Promise<void> | null, job: () => Promise<void>, set: (p: Promise<void> | null) => void): Promise<void> => {
    if (flight !== null) return flight;
    const promise = job()
      .catch((error: unknown) => {
        if (!(error instanceof TransportError) && !(error instanceof DatasetIdentityError)) deps.onUnexpectedError?.(error);
      })
      .finally(() => set(null));
    set(promise);
    return promise;
  };

  const offlineFailure =(): Failure => (internet() === "offline" ? failureOf("no_internet", "offline") : failureOf("server_unavailable", "offline"));

  const run = async (reason: SyncReason, pull: boolean): Promise<SyncStatus> => {
    let steps: SyncStep[] | null = pull ? INITIAL_STEPS.map((step) => ({ ...step })) : null;
    /** Applies one real event of the pipeline to the step list and publishes it. */
    const onStep = (event: SyncStepEvent): void => {
      if (steps === null) return;
      steps = steps.map((step) =>
        step.id !== event.id
          ? step
          : {
              id: step.id,
              state: event.state,
              count: event.count === undefined ? step.count : event.count,
              total: event.total === undefined ? step.total : event.total,
              indeterminate: step.id === "server" && event.state === "running",
              ...(event.note === undefined ? {} : { note: event.note }),
            },
      );
      publish({ ...status, phase: "syncing", steps });
    };
    cancelRequested = false;
    let saveStarted = false;
    /** Checkpoint: a cancel stops the run only BEFORE the single atomic swap of the local base (never after it starts). */
    const checkpoint = (): void => {
      if (cancelRequested && !saveStarted) throw new SyncCancelledError();
    };
    const onPullStep = (event: SyncStepEvent): void => {
      if (event.id === "save") saveStarted = true;
      else checkpoint();
      onStep(event);
    };
    let cancelled = false;
    publish({ ...status, phase: "syncing", progress: null, steps, ...(await counters()) });
    let phase: SyncPhase = "idle";
    let lastError: string | null = null;
    let failureCause: SyncFailure | null = null;
    let failedSteps: readonly string[] = [];
    let mobility: readonly MobilityCount[] = [];
    let pulled = false;
    const setFailure = (failure: Failure): void => {
      phase = failure.phase;
      lastError = failure.message;
      failureCause = failure.failure;
    };
    try {
      await recoverInterrupted(deps.db, deps.env);
      await recoverInterruptedCustomers(deps.db, deps.env);
      // Confirm the dataset with the server before anything is sent (only when there is something to send or to pull).
      let confirmed = true;
      if (pull || (await counters()).pending > 0 || (await backgroundPending()) > 0) {
        try {
          const identity = await deps.source.fetchDatasetIdentity();
          await confirmDataset(deps.db, identity, isoNow(deps.env));
          if (identity === null) {
            confirmed = false;
            setFailure(failureOf("error", "error", "Não foi possível confirmar o conjunto de dados do servidor. Envio bloqueado."));
          }
        } catch (error) {
          confirmed = false;
          setFailure(describeFailure(error, internet()));
          if (!(error instanceof TransportError)) deps.onUnexpectedError?.(error);
        }
      }
      let serverTrouble = false;
      const pushOptions: PushOptions = {
        onServerTrouble: () => {
          serverTrouble = true;
        },
        respectBackoff: reason === "timer",
        currentDataset: await readExpectedDataset(deps.db),
        ...(deps.onUnexpectedError === undefined ? {} : { onUnexpectedError: deps.onUnexpectedError }),
      };
      // Customers first: a confirmation re-points drafts before their orders are sent. A dead network or session stops the whole run.
      let customerStop: "offline" | "auth" | null = null;
      let sentCount = 0;
      if (confirmed && deps.customerTransport !== undefined) {
        if (pull) onStep({ id: "push", state: "running", count: 0, total: (await counters()).pending });
        const sentCustomers = await pushPendingCustomers(deps.db, deps.env, deps.customerTransport, deps.ownerAccountId, {
          currentDataset: pushOptions.currentDataset ?? null,
          respectBackoff: pushOptions.respectBackoff ?? true,
          ...(deps.onUnexpectedError === undefined ? {} : { onUnexpectedError: deps.onUnexpectedError }),
        });
        // A refused customer is not a sync error: it shows as "needs attention" through the counters.
        if (sentCustomers.stoppedBy === "offline" || sentCustomers.stoppedBy === "auth") customerStop = sentCustomers.stoppedBy;
        sentCount += sentCustomers.confirmed;
      }
      const outboxPushed: { attempted: number; accepted: number; failed: number; stoppedBy: PushStop } =
        customerStop !== null
          ? { attempted: 0, accepted: 0, failed: 0, stoppedBy: customerStop }
          : confirmed
            ? await pushOutbox(deps.db, deps.env, deps.transport, deps.ownerAccountId, pushOptions)
            : { attempted: 0, accepted: 0, failed: 0, stoppedBy: "idle" };
      // "Enviar pedido" requests go AFTER the create/replace queue (the server submits what the seller saved), and only while the
      // outbox push was clean. A refusal is a state the seller sees (needs attention), not a failed run.
      const outboxClean = confirmed && customerStop === null && outboxPushed.failed === 0 && (outboxPushed.stoppedBy === "idle" || outboxPushed.stoppedBy === "limit");
      const sendPushed = outboxClean
        ? await pushSendRequests(deps.db, deps.env, deps.transport, deps.ownerAccountId, { ...pushOptions, currentDataset: await readExpectedDataset(deps.db) })
        : { attempted: 0, submitted: 0, failed: 0, refused: 0, stoppedBy: "idle" as PushStop };
      const pushed = {
        attempted: outboxPushed.attempted + sendPushed.attempted,
        accepted: outboxPushed.accepted + sendPushed.submitted,
        failed: outboxPushed.failed + (sendPushed.failed - sendPushed.refused),
        stoppedBy: outboxClean && sendPushed.stoppedBy !== "limit" ? sendPushed.stoppedBy : outboxPushed.stoppedBy,
      };
      sentCount += pushed.accepted;
      const pushClean = customerStop === null && confirmed && pushed.failed === 0 && !["dataset_unconfirmed", "dataset_mismatch", "offline", "auth"].includes(pushed.stoppedBy);
      if (pull && pushClean) onStep({ id: "push", state: "done", count: sentCount, total: steps?.find((step) => step.id === "push")?.total ?? sentCount });
      if (!confirmed) {
        // phase/lastError already set by the failed confirmation
      } else if (pushed.stoppedBy === "dataset_unconfirmed") {
        setFailure(failureOf("error", "error", "Não foi possível confirmar o conjunto de dados do servidor. Envio bloqueado."));
      } else if (pushed.stoppedBy === "dataset_mismatch") {
        setFailure(failureOf("error", "error", "O servidor recusou um pedido por ser de outro conjunto de dados. Envio pausado."));
      } else if (pushed.stoppedBy === "offline") {
        setFailure(offlineFailure());
      } else if (pushed.stoppedBy === "auth") {
        setFailure(failureOf("auth", "auth_required"));
      } else if (pushed.failed > 0) {
        // A 503/500/429 on the order push is transient: the order stays queued and is resent. It says "Sankhya indisponível" (popup with "Tentar de novo"), never "Erro ao sincronizar".
        setFailure(serverTrouble ? failureOf("sankhya_unavailable", "offline") : failureOf("error", "error"));
      } else if (pull) {
        try {
          // The server refreshes from the ERP first; the download happens only after it is done. Failed steps do not stop the download.
          checkpoint();
          if (deps.source.refreshOnDemand !== undefined) {
            onStep({ id: "server", state: "running" });
            const outcome = await deps.source.refreshOnDemand((progress) => {
              checkpoint();
              publish({ ...status, phase: "syncing", progress });
            });
            mobility = outcome.mobility ?? [];
            onStep({ id: "server", state: outcome.failed ? "error" : "done", ...(outcome.failed ? { note: "mantida a última base" } : {}) });
            if (outcome.failed) {
              failedSteps = outcome.failedSteps;
              failureCause = "sankhya_unavailable";
              lastError = SYNC_FAILURE_TEXT.sankhya_unavailable;
            }
          }
          if (deps.source.refreshOnDemand === undefined) onStep({ id: "server", state: "done" });
          // The change marker is read BEFORE the download: a change during it makes the next automatic check download again.
          const versionBefore = await readReferenceVersion();
          const pulledData = await pullReferenceData(deps.db, deps.env, deps.source, deps.ownerAccountId, onPullStep, mirrorOptions);
          pulled = true;
          if (versionBefore !== null) await setMeta(deps.db, REFERENCE_VERSION_KEY, versionBefore, isoNow(deps.env)).catch(() => undefined);
          // A price table that could not be read is never reported as a clean sync (its customers may be left without prices).
          if (pulledData.priceTablesFailed.length > 0) setFailure(failureOf("error", "error", PRICE_TABLES_FAILED_TEXT));
          // ERP status of the orders the device holds (GET /orders?ids=, in scope only). Secondary data: the base is already saved,
          // so a failed read keeps the last known status and never fails the run (only a dead session does: it needs a new login).
          onStep({ id: "orders", state: "running", count: 0, total: null });
          try {
            // The account's orders made elsewhere (site, another device) join the local list first, so their ERP status is read below too.
            try {
              await mergeServerOrders(deps.db, deps.env, deps.source, deps.transport, deps.ownerAccountId);
            } catch (error) {
              if (error instanceof TransportError && error.kind === "auth") throw error;
              if (!(error instanceof TransportError)) deps.onUnexpectedError?.(error);
            }
            await refreshOrderErpStatuses(deps.db, deps.env, deps.source, deps.ownerAccountId, (done, total) => onStep({ id: "orders", state: "running", count: done, total }));
            onStep({ id: "orders", state: "done" });
          } catch (error) {
            if (error instanceof TransportError && error.kind === "auth") throw error;
            if (!(error instanceof TransportError)) deps.onUnexpectedError?.(error);
            onStep({ id: "orders", state: "done", note: "mantida a última situação" });
          }
          // Marked drafts: the cause may be gone with the new base; the ones released go out now.
          const released = await reevaluateHeldOrders(deps.db, deps.env, deps.ownerAccountId);
          if (released > 0) {
            const releasedOptions = { ...pushOptions, currentDataset: await readExpectedDataset(deps.db) };
            await pushOutbox(deps.db, deps.env, deps.transport, deps.ownerAccountId, releasedOptions);
            await pushSendRequests(deps.db, deps.env, deps.transport, deps.ownerAccountId, releasedOptions);
          }
        } catch (error) {
          if (error instanceof SyncCancelledError) {
            // Nothing of the new base was written (the swap is one transaction that had not started).
            cancelled = true;
            phase = "idle";
            lastError = null;
            failureCause = null;
          } else {
            failedSteps = [];
            setFailure(describeFailure(error, internet()));
          }
          if (!cancelled && !(error instanceof TransportError) && !(error instanceof DatasetIdentityError)) deps.onUnexpectedError?.(error);
        }
      }
    } catch (error) {
      deps.onUnexpectedError?.(error);
      setFailure(failureOf("error", "error"));
    }
    const now = isoNow(deps.env);
    const counts = await counters();
    let lastSyncedAt = status.lastSyncedAt ?? (await getMeta(deps.db, "sync.last_success_at"));
    if (pulled && failureCause === null) {
      lastSyncedAt = now;
      await setMeta(deps.db, "sync.last_success_at", now, now).catch(() => undefined);
    }
    if (cancelled) steps = null;
    if (steps !== null) {
      const failedRun = phase !== "idle";
      // A run that failed before the server step even started failed while sending.
      const neverReachedServer = steps.find((step) => step.id === "server")?.state === "pending";
      steps = steps.map((step) => {
        if (!failedRun) return step.state === "running" ? { ...step, state: "error" as const } : step;
        if (step.state === "running" || (neverReachedServer && step.id === "push")) return { ...step, state: "error" as const };
        return step;
      });
    }
    return publish({ phase, ...counts, lastSyncedAt, lastError, failure: failureCause, failedSteps, mobility, progress: null, steps });
  };

  const start = (reason: SyncReason, pull: boolean): Promise<SyncStatus> => {
    inFlightPulls = pull;
    const current = run(reason, pull).finally(() => {
      if (inFlight === current) {
        inFlight = null;
        inFlightPulls = false;
      }
    });
    inFlight = current;
    return current;
  };

  const manager: SyncManager = {
    sync(reason, options) {
      const wantsPull = options?.pull ?? true;
      if (wantsPull && queuedPull !== null) return queuedPull;
      if (inFlight !== null) {
        if (!wantsPull || inFlightPulls) return inFlight;
        // A push-only run is in flight: the download is not swallowed, it runs right after.
        const queued: Promise<SyncStatus> = inFlight.then(() => start(reason, true)).finally(() => {
          if (queuedPull === queued) queuedPull = null;
        });
        queuedPull = queued;
        return queued;
      }
      return start(reason, wantsPull);
    },
    cancel() {
      if (inFlight !== null && inFlightPulls) cancelRequested = true;
    },
    getStatus: () => status,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async refresh() {
      const lastSyncedAt = status.lastSyncedAt ?? (await getMeta(deps.db, "sync.last_success_at"));
      return publish({ ...status, ...(await counters()), lastSyncedAt });
    },
    async backgroundRefresh(what) {
      if (internet() === "offline" || fullSyncRunning()) return;
      const jobs: Promise<void>[] = [];
      if (what.orders === true || what.askServerFor !== undefined) {
        jobs.push(guarded(ordersFlight, () => refreshOrdersInBackground(what.askServerFor), (p) => (ordersFlight = p)));
      }
      if (what.reference === true) jobs.push(guarded(referenceFlight, refreshReferenceInBackground, (p) => (referenceFlight = p)));
      await Promise.all(jobs);
    },
    async readOrderNumber(localId) {
      const draft = await getDraft(deps.db, localId);
      if (draft === null || draft.remoteId === null) return null;
      if (internet() === "offline") return draftErpNumber(draft);
      try {
        const read = await refreshOneOrderErpStatus(deps.db, deps.env, deps.source, deps.ownerAccountId, draft.remoteId);
        return read?.erpNumber ?? read?.stage?.nunota ?? draftErpNumber(draft);
      } catch (error) {
        if (!(error instanceof TransportError)) deps.onUnexpectedError?.(error);
        return draftErpNumber(draft);
      }
    },
    async confirmOrder(localId, options) {
      const waitMs = options?.waitMs ?? CONFIRM_WAIT_MS;
      const pollMs = options?.pollMs ?? CONFIRM_POLL_MS;
      const sleep = options?.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
      const startedAt = deps.env.now().getTime();
      const left = (): number => waitMs - (deps.env.now().getTime() - startedAt);
      const readDraft = (): Promise<DraftRecord | null> => getDraft(deps.db, localId);
      /** True when a command of the order was definitively rejected. A pending command that only failed transiently also shows the draft as `sync_error`, but it is NOT a refusal: it is resent. */
      const rejectedOps = async (): Promise<boolean> => (await listOutbox(deps.db, localId)).some((op) => op.state === "rejected");
      const settled = (draft: DraftRecord | null, rejected: boolean): ConfirmOutcome | null => {
        if (draft === null) return { kind: "queued" };
        if (draft.sendState === "refused") return { kind: "refused", code: draft.sendCode ?? "send_refused", message: draft.sendError };
        if (draft.status === "conflict") return { kind: "refused", code: "version_conflict", message: draft.lastError };
        if ((draft.status === "sync_error" && rejected) || draft.status === "needs_review") return { kind: "refused", code: null, message: draft.lastError };
        if (draft.sendState === "submitted") {
          if (draft.sendCode === "awaiting_approval") return { kind: "awaiting_approval" };
          if (draft.sendCode === "approval_rejected") return { kind: "refused", code: "edit_before_resubmitting", message: null };
          return null; // taken by the server: the number is read below
        }
        return null;
      };
      // 1. Deliver. A run already in flight may have started before this order was saved: one more run when nothing was attempted yet.
      if (internet() !== "offline") {
        for (let round = 0; round < 2; round += 1) {
          await Promise.race([manager.sync("after_save", { pull: false }), sleep(Math.max(0, left()))]);
          const draft = await readDraft();
          if (settled(draft, await rejectedOps()) !== null || draft?.sendState !== "requested" || draft.sendAttempts > 0 || left() <= 0) break;
        }
      }
      const draft = await readDraft();
      const verdict = settled(draft, await rejectedOps());
      if (verdict !== null) return verdict;
      if (draft?.sendState !== "submitted" || draft.remoteId === null) return status.failure === "sankhya_unavailable" ? { kind: "queued", reason: "sankhya_unavailable" } : { kind: "queued" };
      // 2. The server took it; the worker writes the note. Read the Sankhya number until it arrives or the wait ends.
      for (;;) {
        try {
          const read = await refreshOneOrderErpStatus(deps.db, deps.env, deps.source, deps.ownerAccountId, draft.remoteId);
          const number = read?.erpNumber ?? read?.stage?.nunota ?? null;
          if (number !== null) return { kind: "sent", erpNumber: number };
        } catch (error) {
          if (!(error instanceof TransportError)) deps.onUnexpectedError?.(error);
        }
        if (left() <= pollMs) return { kind: "sending" };
        await sleep(pollMs);
      }
    },
  };
  return manager;
}
