import { createSyncManager, type OfflineEnv, type SqlDatabase, type SyncManager } from "@salesforce/mobile-db";
import type { Account } from "../auth/auth-port";
import type { ApiClient } from "../data/api";
import type { Repositories } from "../data/ports";
import type { ImageFileSystem } from "../images/image-fs";
import type { ProductImageStore } from "../images/image-store";
import { createAccountProductImages } from "../images/product-images";
import { newClientRequestId } from "../lib/uuid";
import { createLocalOrdersPort, type LocalOrdersPort } from "./local-orders";
import { createOfflineFirstRepositories } from "./offline-repositories";
import { createReferenceSource } from "./reference-source";
import { createOfflineSessionStore, type OfflineSessionStore } from "./session";
import { createOrderTransport } from "./transport";

/** Everything the app needs once an account is known: cache-backed reads, local drafts and the sync manager. */
export interface AccountServices {
  readonly repositories: Repositories;
  readonly localOrders: LocalOrdersPort;
  readonly sync: SyncManager;
  /** Authenticated, bounded thumbnail files of this account (absent when the build has no image file system). */
  readonly productImages?: ProductImageStore;
}

export interface OfflineServices {
  readonly session: OfflineSessionStore;
  forAccount(account: Account): AccountServices;
}

export function createOfflineServices(deps: {
  readonly db: SqlDatabase;
  readonly api: ApiClient;
  readonly remote: Repositories;
  readonly env?: OfflineEnv;
  readonly imageFileSystem?: ImageFileSystem;
  readonly onUnexpectedError?: (error: unknown) => void;
}): OfflineServices {
  const env: OfflineEnv = deps.env ?? { now: () => new Date(), newId: newClientRequestId };
  const transport = createOrderTransport(deps.api);
  const source = createReferenceSource(deps.api);
  const managers = new Map<string, AccountServices>();

  return {
    session: createOfflineSessionStore(deps.db, env),
    forAccount(account) {
      const existing = managers.get(account.id);
      if (existing !== undefined) return existing;
      const sync = createSyncManager({
        db: deps.db,
        env,
        transport,
        source,
        ownerAccountId: account.id,
        ...(deps.onUnexpectedError === undefined ? {} : { onUnexpectedError: deps.onUnexpectedError }),
      });
      const services: AccountServices = {
        repositories: createOfflineFirstRepositories({ db: deps.db, env, ownerAccountId: account.id, remote: deps.remote }),
        localOrders: createLocalOrdersPort({
          db: deps.db,
          env,
          transport,
          ownerAccountId: account.id,
          onChanged: () => {
            // Counters only. Delivery is triggered by the sync hook when the device is online, so an offline save
            // never burns a delivery attempt (an attempted create is frozen).
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
