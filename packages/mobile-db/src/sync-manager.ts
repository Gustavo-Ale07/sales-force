import type { SqlDatabase } from "./connection";
import { countOutbox } from "./local-orders";
import { isoNow, type OfflineEnv } from "./offline-env";
import { pushOutbox, recoverInterrupted, TransportError, type OrderTransport, type PushOptions } from "./order-sync";
import { META_KEYS, getMeta, replaceCustomers, replaceProducts, setMeta, type CustomerLike, type ProductLike } from "./reference-cache";

/**
 * Where the reference data comes from. The server stays authoritative and delivers only what the actor's scope
 * allows (P-21); the client never widens it. Implementations page through the API and return the full snapshot.
 */
export interface ReferenceSource {
  fetchCustomers(): Promise<readonly CustomerLike[]>;
  fetchProducts(): Promise<readonly ProductLike[]>;
  /** Order-entry configuration as the API delivers it (JSON-serializable); `null` when the server has none. */
  fetchEntryConfiguration(): Promise<unknown>;
}

export interface PullResult {
  readonly customers: number;
  readonly products: number;
}

/**
 * Full-snapshot pull with an atomic replace: everything is fetched first and only then swapped in one transaction,
 * so a failure midway (network drop, kill) leaves the previous cache untouched. Incremental/watermark sync is not
 * implemented (SYNC-2 PROPOSED, V-07/V-14 open).
 */
export async function pullReferenceData(db: SqlDatabase, env: OfflineEnv, source: ReferenceSource, ownerAccountId: string): Promise<PullResult> {
  const [customers, products, configuration] = await Promise.all([source.fetchCustomers(), source.fetchProducts(), source.fetchEntryConfiguration()]);
  const now = isoNow(env);
  await db.transaction(async (tx) => {
    await replaceCustomers(tx, customers);
    await replaceProducts(tx, products);
    await setMeta(tx, META_KEYS.customersSyncedAt, now, now);
    await setMeta(tx, META_KEYS.productsSyncedAt, now, now);
    await setMeta(tx, META_KEYS.entryConfiguration, JSON.stringify(configuration ?? null), now);
    await setMeta(tx, META_KEYS.cacheOwner, ownerAccountId, now);
  });
  return { customers: customers.length, products: products.length };
}

/* ---------- sync manager ---------- */

export type SyncPhase = "idle" | "syncing" | "offline" | "error" | "auth_required";

export interface SyncStatus {
  readonly phase: SyncPhase;
  /** Commands waiting to be delivered (pending or sending). */
  readonly pending: number;
  /** Commands the seller must look at (rejected, conflict, price review). */
  readonly needsAttention: number;
  readonly lastSyncedAt: string | null;
  /** Seller-safe text; never a raw technical error. */
  readonly lastError: string | null;
}

export type SyncReason = "manual" | "reconnected" | "foreground" | "timer" | "after_save";

export interface SyncManagerDeps {
  readonly db: SqlDatabase;
  readonly env: OfflineEnv;
  readonly transport: OrderTransport;
  readonly source: ReferenceSource;
  readonly ownerAccountId: string;
  /** Called with unexpected (non-transport) errors, for logging. */
  readonly onUnexpectedError?: (error: unknown) => void;
}

export interface SyncManager {
  /** Pushes pending commands, then refreshes the cache. Concurrent calls share the run in flight (single-flight). */
  sync(reason: SyncReason, options?: { readonly pull?: boolean }): Promise<SyncStatus>;
  getStatus(): SyncStatus;
  subscribe(listener: (status: SyncStatus) => void): () => void;
  /** Recomputes counters from the database (after a local save). */
  refresh(): Promise<SyncStatus>;
}

function describePullFailure(error: unknown): { phase: SyncPhase; message: string } {
  if (error instanceof TransportError) {
    if (error.kind === "network") return { phase: "offline", message: "Sem conexão — alterações salvas neste dispositivo" };
    if (error.kind === "auth") return { phase: "auth_required", message: "Sua sessão expirou. Entre novamente para sincronizar." };
  }
  return { phase: "error", message: "Erro ao sincronizar" };
}

export function createSyncManager(deps: SyncManagerDeps): SyncManager {
  const listeners = new Set<(status: SyncStatus) => void>();
  let status: SyncStatus = { phase: "idle", pending: 0, needsAttention: 0, lastSyncedAt: null, lastError: null };
  let inFlight: Promise<SyncStatus> | null = null;

  const publish = (next: SyncStatus): SyncStatus => {
    status = next;
    for (const listener of listeners) listener(status);
    return status;
  };

  const counters = async (): Promise<{ pending: number; needsAttention: number }> => {
    const counts = await countOutbox(deps.db, deps.ownerAccountId);
    return { pending: counts.pending + counts.sending, needsAttention: counts.needsAttention };
  };

  const run = async (reason: SyncReason, pull: boolean): Promise<SyncStatus> => {
    publish({ ...status, phase: "syncing", ...(await counters()) });
    const pushOptions: PushOptions = {
      respectBackoff: reason === "timer",
      ...(deps.onUnexpectedError === undefined ? {} : { onUnexpectedError: deps.onUnexpectedError }),
    };
    let phase: SyncPhase = "idle";
    let lastError: string | null = null;
    try {
      await recoverInterrupted(deps.db, deps.env);
      const pushed = await pushOutbox(deps.db, deps.env, deps.transport, deps.ownerAccountId, pushOptions);
      if (pushed.stoppedBy === "offline") {
        phase = "offline";
        lastError = "Sem conexão — alterações salvas neste dispositivo";
      } else if (pushed.stoppedBy === "auth") {
        phase = "auth_required";
        lastError = "Sua sessão expirou. Entre novamente para sincronizar.";
      } else if (pushed.failed > 0) {
        phase = "error";
        lastError = "Erro ao sincronizar";
      } else if (pull) {
        try {
          await pullReferenceData(deps.db, deps.env, deps.source, deps.ownerAccountId);
        } catch (error) {
          const failure = describePullFailure(error);
          phase = failure.phase;
          lastError = failure.message;
          if (!(error instanceof TransportError)) deps.onUnexpectedError?.(error);
        }
      }
    } catch (error) {
      deps.onUnexpectedError?.(error);
      phase = "error";
      lastError = "Erro ao sincronizar";
    }
    const now = isoNow(deps.env);
    const counts = await counters();
    let lastSyncedAt = status.lastSyncedAt;
    if (phase === "idle" && counts.pending === 0) {
      lastSyncedAt = now;
      await setMeta(deps.db, "sync.last_success_at", now, now).catch(() => undefined);
    }
    return publish({ phase, ...counts, lastSyncedAt, lastError });
  };

  return {
    sync(reason, options) {
      if (inFlight !== null) return inFlight;
      inFlight = run(reason, options?.pull ?? true).finally(() => {
        inFlight = null;
      });
      return inFlight;
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
