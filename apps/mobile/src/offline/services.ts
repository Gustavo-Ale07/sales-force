import { createNotificationsPort, createTasksPort, type NotificationsPort, type TasksPort } from "./tasks-service";
import { createGoalsPort, type GoalsPort } from "./goals-service";
import { clearReferenceCache, countUnsentLocalWork, createSyncManager, wipeLocalDatabase, type InternetState, type OfflineEnv, type SqlDatabase, type SyncManager } from "@salesforce/mobile-db";
import type { Account } from "../auth/auth-port";
import type { ApiClient } from "../data/api";
import type { Repositories } from "../data/ports";
import type { ImageFileSystem } from "../images/image-fs";
import type { ProductImageStore } from "../images/image-store";
import { createAccountProductImages } from "../images/product-images";
import { newClientRequestId } from "../lib/uuid";
import { createAddressPort, type AddressPort } from "./address-port";
import { createLocalOrdersPort, type LocalOrdersPort } from "./local-orders";
import { createCustomerEditTransport, createCustomerTransport } from "./customer-transport";
import { createOfflineFirstRepositories } from "./offline-repositories";
import { createPendingCustomersPort, type PendingCustomersPort } from "./pending-customers";
import { createReferenceSource } from "./reference-source";
import { startSyncEvents, type StreamFetch, type SyncEventTopic } from "./sync-events";
import { createOfflineSessionStore, type OfflineSessionStore } from "./session";
import { createOrderTransport } from "./transport";

/** Everything the app needs once an account is known: cache-backed reads, local drafts and the sync manager. */
export interface AccountServices {
  readonly repositories: Repositories;
  readonly localOrders: LocalOrdersPort;
  /** Customers created on this device and waiting for the ERP (F7). */
  readonly pendingCustomers: PendingCustomersPort;
  /** Cities, neighborhoods, streets and postal codes of the new-customer form (offline-first). */
  readonly addresses?: AddressPort;
  readonly sync: SyncManager;
  /** Tasks (RF-ACT) and notification central (RF-NOT): created and read offline, synchronized with the same ids. */
  readonly tasks?: TasksPort;
  readonly notifications?: NotificationsPort;
  /** M-24 and the Início panel (RF-GOL-1/2): goal, realized and positivation, kept on the device for offline use. */
  readonly goals?: GoalsPort;
  /** RT-1: opens the server's change-ping stream; returns the function that closes it. Absent when the build has no streaming fetch. */
  readonly openEvents?: (onTopic: (topic: SyncEventTopic) => void, onConnection: (connected: boolean) => void) => () => void;
  /** Authenticated, bounded thumbnail files of this account (absent when the build has no image file system). */
  readonly productImages?: ProductImageStore;
}

export interface OfflineServices {
  readonly session: OfflineSessionStore;
  forAccount(account: Account): AccountServices;
  /** Orders and customers of this account that never reached the server (what a sign-out or a wipe would leave behind or lose). */
  unsentWork(accountId: string): Promise<number>;
  /**
   * After an ordinary sign-out: with nothing unsent the downloaded cache is cleared; with something unsent (or an unknown count)
   * everything stays on the device, isolated per account, and the count is returned so the seller can be told.
   */
  endSession(accountId: string): Promise<{ readonly cleared: boolean; readonly unsent: number | null }>;
  /** Revocation or deactivation: deletes the whole local database (orders, outbox, pending customers, cache), pending work included. */
  wipeAll(): Promise<void>;
}

export function createOfflineServices(deps: {
  readonly db: SqlDatabase;
  readonly api: ApiClient;
  readonly remote: Repositories;
  readonly env?: OfflineEnv;
  readonly imageFileSystem?: ImageFileSystem;
  /** Client for thumbnails (carries the code's key, never reports a 401 as a rejected code); defaults to `api`. */
  readonly mediaApi?: ApiClient;
  readonly onUnexpectedError?: (error: unknown) => void;
  /** Device internet state (OS check), so a failed sync says "no internet" or "server unavailable" correctly. */
  readonly internetState?: () => InternetState;
  /** API base URL and streaming fetch of the change-ping stream (RT-1). Both absent = no stream: the timers keep the data fresh. */
  readonly baseUrl?: string;
  readonly fetchStream?: StreamFetch;
  /** Log-safe line about a repaired device mirror (counts and hashes only). */
  readonly onMirrorMismatch?: (message: string) => void;
}): OfflineServices {
  const env: OfflineEnv = deps.env ?? { now: () => new Date(), newId: newClientRequestId };
  const transport = createOrderTransport(deps.api);
  const customerTransport = createCustomerTransport(deps.api);
  const customerEditTransport = createCustomerEditTransport(deps.api);
  const source = createReferenceSource(deps.api);
  const managers = new Map<string, AccountServices>();

  return {
    session: createOfflineSessionStore(deps.db, env),
    unsentWork: (accountId) => countUnsentLocalWork(deps.db, accountId),
    async endSession(accountId) {
      let unsent: number;
      try {
        unsent = await countUnsentLocalWork(deps.db, accountId);
      } catch {
        return { cleared: false, unsent: null };
      }
      if (unsent > 0) return { cleared: false, unsent };
      await clearReferenceCache(deps.db);
      managers.clear();
      return { cleared: true, unsent: 0 };
    },
    async wipeAll() {
      await wipeLocalDatabase(deps.db);
      managers.clear();
    },
    forAccount(account) {
      const existing = managers.get(account.id);
      if (existing !== undefined) return existing;
      const sync = createSyncManager({
        db: deps.db,
        env,
        transport,
        customerTransport,
        customerEditTransport,
        source,
        ownerAccountId: account.id,
        ...(deps.onUnexpectedError === undefined ? {} : { onUnexpectedError: deps.onUnexpectedError }),
        ...(deps.internetState === undefined ? {} : { internetState: deps.internetState }),
        ...(deps.onMirrorMismatch === undefined ? {} : { onMirrorMismatch: deps.onMirrorMismatch }),
      });
      const { baseUrl, fetchStream } = deps;
      const services: AccountServices = {
        ...(baseUrl === undefined || fetchStream === undefined
          ? {}
          : { openEvents: (onTopic: (topic: SyncEventTopic) => void, onConnection: (connected: boolean) => void) => startSyncEvents({ baseUrl, fetchStream, onTopic, onConnection }) }),
        repositories: createOfflineFirstRepositories({ db: deps.db, env, ownerAccountId: account.id, remote: deps.remote }),
        localOrders: createLocalOrdersPort({
          db: deps.db,
          env,
          transport,
          ownerAccountId: account.id,
          confirmOrder: (localId) => (sync.confirmOrder !== undefined ? sync.confirmOrder(localId) : Promise.resolve({ kind: "queued" as const })),
          ...(sync.readOrderNumber === undefined ? {} : { readOrderNumber: (localId: string) => sync.readOrderNumber?.(localId) ?? Promise.resolve(null) }),
          duplicateAsOrder: (id, request) => deps.remote.orders.duplicateAsOrder(id, request),
          onChanged: () => {
            // Counters only. Delivery is triggered by the sync hook when the device is online, so an offline save
            // never burns a delivery attempt (an attempted create is frozen).
            void sync.refresh();
          },
        }),
        pendingCustomers: createPendingCustomersPort({
          db: deps.db,
          env,
          ownerAccountId: account.id,
          transport: customerTransport,
          onChanged: () => {
            void sync.refresh();
          },
        }),
        addresses: createAddressPort({ db: deps.db, env, api: deps.api }),
        tasks: createTasksPort({ db: deps.db, env, api: deps.api, ownerAccountId: account.id }),
        notifications: createNotificationsPort({ db: deps.db, env, api: deps.api, ownerAccountId: account.id }),
        goals: createGoalsPort({ db: deps.db, api: deps.api, ownerAccountId: account.id }),
        sync,
        ...(deps.imageFileSystem === undefined
          ? {}
          : {
              productImages: createAccountProductImages({
                db: deps.db,
                api: deps.mediaApi ?? deps.api,
                fs: deps.imageFileSystem,
                ownerAccountId: account.id,
                now: () => env.now().getTime(),
              }),
            }),
      };
      managers.set(account.id, services);
      return services;
    },
  };
}
