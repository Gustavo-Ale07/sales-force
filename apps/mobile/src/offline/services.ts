import { clearReferenceCache, countUnsentLocalWork, createSyncManager, wipeLocalDatabase, type InternetState, type OfflineEnv, type SqlDatabase, type SyncManager } from "@salesforce/mobile-db";
import type { Account } from "../auth/auth-port";
import type { ApiClient } from "../data/api";
import type { Repositories } from "../data/ports";
import type { ImageFileSystem } from "../images/image-fs";
import type { ProductImageStore } from "../images/image-store";
import { createAccountProductImages } from "../images/product-images";
import { newClientRequestId } from "../lib/uuid";
import { createLocalOrdersPort, type LocalOrdersPort } from "./local-orders";
import { createCustomerTransport } from "./customer-transport";
import { createOfflineFirstRepositories } from "./offline-repositories";
import { createPendingCustomersPort, type PendingCustomersPort } from "./pending-customers";
import { createReferenceSource } from "./reference-source";
import { createOfflineSessionStore, type OfflineSessionStore } from "./session";
import { createOrderTransport } from "./transport";

/** Everything the app needs once an account is known: cache-backed reads, local drafts and the sync manager. */
export interface AccountServices {
  readonly repositories: Repositories;
  readonly localOrders: LocalOrdersPort;
  /** Customers created on this device and waiting for the ERP (F7). */
  readonly pendingCustomers: PendingCustomersPort;
  readonly sync: SyncManager;
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
  readonly onUnexpectedError?: (error: unknown) => void;
  /** Device internet state (OS check), so a failed sync says "no internet" or "server unavailable" correctly. */
  readonly internetState?: () => InternetState;
}): OfflineServices {
  const env: OfflineEnv = deps.env ?? { now: () => new Date(), newId: newClientRequestId };
  const transport = createOrderTransport(deps.api);
  const customerTransport = createCustomerTransport(deps.api);
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
        source,
        ownerAccountId: account.id,
        ...(deps.onUnexpectedError === undefined ? {} : { onUnexpectedError: deps.onUnexpectedError }),
        ...(deps.internetState === undefined ? {} : { internetState: deps.internetState }),
      });
      const services: AccountServices = {
        repositories: createOfflineFirstRepositories({ db: deps.db, env, ownerAccountId: account.id, remote: deps.remote }),
        localOrders: createLocalOrdersPort({
          db: deps.db,
          env,
          transport,
          ownerAccountId: account.id,
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
          onChanged: () => {
            void sync.refresh();
          },
        }),
        sync,
        ...(deps.imageFileSystem === undefined
          ? {}
          : {
              productImages: createAccountProductImages({
                db: deps.db,
                api: deps.api,
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
