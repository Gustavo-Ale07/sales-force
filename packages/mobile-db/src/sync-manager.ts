import type { SqlDatabase } from "./connection";
import { DatasetIdentityError, confirmDataset, readCacheDataset, readExpectedDataset, sameDataset, writeCacheDataset, type DatasetIdentity } from "./dataset-identity";
import { countOutbox, listAttentionItems, type AttentionItem } from "./local-orders";
import { isoNow, type OfflineEnv } from "./offline-env";
import { pushOutbox, recoverInterrupted, reevaluateHeldOrders, TransportError, type OrderTransport, type PushOptions } from "./order-sync";
import {
  applyCustomerCreationSignal,
  countPendingCustomers,
  pushPendingCustomers,
  recoverInterruptedCustomers,
  settleConfirmedCustomers,
  type CustomerRegistrationTransport,
} from "./pending-customers";
import { META_KEYS, cachedPriceTableCodes, countPriceRows, deleteMeta, getMeta, replaceCustomers, replacePriceTables, replaceProducts, setMeta, type CustomerLike, type PriceTableSnapshot, type ProductLike } from "./reference-cache";

/**
 * Where the reference data comes from. The server stays authoritative and delivers only what the actor's scope
 * allows (P-21); the client never widens it. Implementations page through the API and return the full snapshot.
 */
export interface ReferenceSource {
  fetchCustomers(): Promise<readonly CustomerLike[]>;
  fetchProducts(): Promise<readonly ProductLike[]>;
  /**
   * Prices of EACH price table the visible customers use (owner 2026-11-13), read by table code from the bulk endpoint. `tables`
   * are the ones read completely; `failed` the ones whose read failed in a way that may pass (their previous prices stay, only for
   * the same account and dataset). A table in neither list is not served any more (dropped). An error that stops everything
   * (no network, session) is THROWN and fails the pull, leaving the previous cache untouched: never swallowed into "no tables".
   */
  fetchPriceTables?(tableCodes: readonly number[]): Promise<PriceTablesFetch>;
  /** Order-entry configuration as the API delivers it (JSON-serializable); `null` when the server has none. */
  fetchEntryConfiguration(): Promise<unknown>;
  /** Dataset the server serves (`null` = the server cannot tell: fail closed, nothing is cached or sent). */
  fetchDatasetIdentity(): Promise<DatasetIdentity | null>;
  /** Active carriers (D-C). Optional and best-effort: a failure here never fails the pull. */
  fetchCarriers?(): Promise<readonly unknown[]>;
  /**
   * On-demand refresh (POST /sync/refresh, then follow it until done). The manager calls it BEFORE any download and downloads only
   * after it returns. Optional so a source without it just downloads. Throws `TransportError` when the server cannot be reached.
   */
  refreshOnDemand?(onProgress: (progress: RefreshProgress) => void): Promise<RefreshOutcome>;
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

/**
 * Full-snapshot pull with an atomic replace: everything is fetched first and only then swapped in one transaction,
 * so a failure midway (network drop, kill) leaves the previous cache untouched. Incremental/watermark sync is not
 * implemented (SYNC-2 PROPOSED, V-07/V-14 open).
 */
export async function pullReferenceData(db: SqlDatabase, env: OfflineEnv, source: ReferenceSource, ownerAccountId: string): Promise<PullResult> {
  // The identity is read before AND after the data: the snapshot is only trusted when the server declared the same
  // dataset on both sides (a dataset switch in the middle of a pull would otherwise mix two datasets in one cache).
  const before = await source.fetchDatasetIdentity();
  if (before === null) throw new DatasetIdentityError();
  const [customers, products, configuration] = await Promise.all([source.fetchCustomers(), source.fetchProducts(), source.fetchEntryConfiguration()]);
  // Each distinct price table the customers use (a customer without a table uses the base catalog).
  const used = new Set<number>();
  for (const customer of customers) {
    const table = customer.priceTableCode;
    if (table !== null && table !== undefined) used.add(table);
  }
  let priceTables: readonly PriceTableSnapshot[] = [];
  let failedTables: readonly number[] = [];
  if (source.fetchPriceTables !== undefined && used.size > 0) {
    const fetched = await source.fetchPriceTables([...used].sort((a, b) => a - b));
    priceTables = fetched.tables;
    failedTables = fetched.failed.filter((code) => used.has(code));
  }
  const after = await source.fetchDatasetIdentity();
  if (!sameDataset(before, after)) throw new DatasetIdentityError("O conjunto de dados do servidor mudou durante a atualização.");
  // The carrier list is a convenience: when it cannot be read the previous list stays, unless it belongs to another dataset.
  const previousDataset = await readExpectedDataset(db);
  // Prices carried over from the previous pull are trusted only when that pull was this account's, under this same dataset.
  const sameOwnerAndDataset = (await getMeta(db, META_KEYS.cacheOwner)) === ownerAccountId && sameDataset(await readCacheDataset(db), before);
  let carriers: readonly unknown[] | null = null;
  if (source.fetchCarriers !== undefined) {
    try {
      carriers = await source.fetchCarriers();
    } catch {
      carriers = null;
    }
  }
  const now = isoNow(env);
  await db.transaction(async (tx) => {
    await writeCacheDataset(tx, before, now);
    await confirmDataset(tx, before, now);
    await replaceCustomers(tx, customers);
    // A customer confirmed by the ERP is replaced by its real mirror record (no duplicate in the list).
    await settleConfirmedCustomers(tx);
    await replaceProducts(tx, products);
    // Tables whose read FAILED keep their previous prices (same account and dataset only); the rest not read are dropped.
    const keepTables = sameOwnerAndDataset ? (await cachedPriceTableCodes(tx)).filter((code) => failedTables.includes(code) && !priceTables.some((t) => t.tableCode === code)) : [];
    await replacePriceTables(tx, priceTables.filter((t) => used.has(t.tableCode)), { keepTables });
    await setMeta(tx, META_KEYS.customersSyncedAt, now, now);
    await setMeta(tx, META_KEYS.productsSyncedAt, now, now);
    await setMeta(tx, META_KEYS.entryConfiguration, JSON.stringify(configuration ?? null), now);
    // Customer creation released or not: re-read from the configuration at every sync (no TTL, no inference).
    await applyCustomerCreationSignal(tx, configuration, now);
    if (carriers !== null) await setMeta(tx, META_KEYS.carriers, JSON.stringify(carriers), now);
    else if (!sameDataset(previousDataset, before)) await deleteMeta(tx, META_KEYS.carriers);
    await setMeta(tx, META_KEYS.cacheOwner, ownerAccountId, now);
  });
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
}

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
  /** Device internet state, to tell "no internet" from "server not answering". Absent = unknown (reported as the server). */
  readonly internetState?: () => InternetState;
}

export interface SyncManager {
  /**
   * Pushes pending commands, then (with `pull`, the default) refreshes the server and downloads the base. Concurrent calls share the
   * run in flight (single-flight); a call that wants the download while a push-only run is in flight runs it right after.
   */
  sync(reason: SyncReason, options?: { readonly pull?: boolean }): Promise<SyncStatus>;
  getStatus(): SyncStatus;
  subscribe(listener: (status: SyncStatus) => void): () => void;
  /** Recomputes counters from the database (after a local save). */
  refresh(): Promise<SyncStatus>;
}

interface Failure {
  readonly phase: SyncPhase;
  readonly failure: SyncFailure;
  readonly message: string;
}

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

export function createSyncManager(deps: SyncManagerDeps): SyncManager {
  const listeners = new Set<(status: SyncStatus) => void>();
  let status: SyncStatus = { phase: "idle", pending: 0, needsAttention: 0, lastSyncedAt: null, lastError: null, failure: null, failedSteps: [], attention: [], progress: null };
  let inFlight: Promise<SyncStatus> | null = null;
  let inFlightPulls = false;
  let queuedPull: Promise<SyncStatus> | null = null;
  const internet = (): InternetState => deps.internetState?.() ?? "unknown";

  const publish = (next: SyncStatus): SyncStatus => {
    status = next;
    for (const listener of listeners) listener(status);
    return status;
  };

  const counters = async (): Promise<{ pending: number; needsAttention: number; attention: readonly AttentionItem[] }> => {
    const dataset = await readExpectedDataset(deps.db);
    const counts = await countOutbox(deps.db, deps.ownerAccountId, dataset);
    const customers = await countPendingCustomers(deps.db, deps.ownerAccountId, dataset);
    const attention = await listAttentionItems(deps.db, deps.ownerAccountId);
    return { pending: counts.pending + counts.sending + customers.pending, needsAttention: counts.needsAttention + customers.needsAttention, attention };
  };

  const offlineFailure = (): Failure => (internet() === "offline" ? failureOf("no_internet", "offline") : failureOf("server_unavailable", "offline"));

  const run = async (reason: SyncReason, pull: boolean): Promise<SyncStatus> => {
    publish({ ...status, phase: "syncing", progress: null, ...(await counters()) });
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
      if (pull || (await counters()).pending > 0) {
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
      const pushOptions: PushOptions = {
        respectBackoff: reason === "timer",
        currentDataset: await readExpectedDataset(deps.db),
        ...(deps.onUnexpectedError === undefined ? {} : { onUnexpectedError: deps.onUnexpectedError }),
      };
      // Customers first: a confirmation re-points drafts before their orders are sent. A dead network or session stops the whole run.
      let customerStop: "offline" | "auth" | null = null;
      if (confirmed && deps.customerTransport !== undefined) {
        const sentCustomers = await pushPendingCustomers(deps.db, deps.env, deps.customerTransport, deps.ownerAccountId, {
          currentDataset: pushOptions.currentDataset ?? null,
          respectBackoff: pushOptions.respectBackoff ?? true,
          ...(deps.onUnexpectedError === undefined ? {} : { onUnexpectedError: deps.onUnexpectedError }),
        });
        // A refused customer is not a sync error: it shows as "needs attention" through the counters.
        if (sentCustomers.stoppedBy === "offline" || sentCustomers.stoppedBy === "auth") customerStop = sentCustomers.stoppedBy;
      }
      const pushed =
        customerStop !== null
          ? { attempted: 0, accepted: 0, failed: 0, stoppedBy: customerStop }
          : confirmed
            ? await pushOutbox(deps.db, deps.env, deps.transport, deps.ownerAccountId, pushOptions)
            : { attempted: 0, accepted: 0, failed: 0, stoppedBy: "idle" as const };
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
        setFailure(failureOf("error", "error"));
      } else if (pull) {
        try {
          // The server refreshes from the ERP first; the download happens only after it is done. Failed steps do not stop the download.
          if (deps.source.refreshOnDemand !== undefined) {
            const outcome = await deps.source.refreshOnDemand((progress) => {
              publish({ ...status, phase: "syncing", progress });
            });
            mobility = outcome.mobility ?? [];
            if (outcome.failed) {
              failedSteps = outcome.failedSteps;
              failureCause = "sankhya_unavailable";
              lastError = SYNC_FAILURE_TEXT.sankhya_unavailable;
            }
          }
          const pulledData = await pullReferenceData(deps.db, deps.env, deps.source, deps.ownerAccountId);
          pulled = true;
          // A price table that could not be read is never reported as a clean sync (its customers may be left without prices).
          if (pulledData.priceTablesFailed.length > 0) setFailure(failureOf("error", "error", PRICE_TABLES_FAILED_TEXT));
          // Marked drafts: the cause may be gone with the new base; the ones released go out now.
          const released = await reevaluateHeldOrders(deps.db, deps.env, deps.ownerAccountId);
          if (released > 0) await pushOutbox(deps.db, deps.env, deps.transport, deps.ownerAccountId, { ...pushOptions, currentDataset: await readExpectedDataset(deps.db) });
        } catch (error) {
          failedSteps = [];
          setFailure(describeFailure(error, internet()));
          if (!(error instanceof TransportError) && !(error instanceof DatasetIdentityError)) deps.onUnexpectedError?.(error);
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
    return publish({ phase, ...counts, lastSyncedAt, lastError, failure: failureCause, failedSteps, mobility, progress: null });
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

  return {
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
    getStatus: () => status,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async refresh() {
      const lastSyncedAt = status.lastSyncedAt ?? (await getMeta(deps.db, "sync.last_success_at"));
      return publish({ ...status, ...(await counters()), lastSyncedAt });
    },
  };
}
