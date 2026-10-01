import { createHttpAuth } from "./auth/http-auth";
import type { AuthPort } from "./auth/auth-port";
import { createDeviceConnectivity, type ConnectivityPort } from "./connectivity/connectivity";
import { createMobileApiClient } from "./data/api";
import type { Repositories } from "./data/ports";
import { createRemoteRepositories } from "./data/remote-repositories";
import { createExpoImageFileSystem } from "./images/expo-image-fs";
import { createOfflineServices, type OfflineServices } from "./offline/services";
import type { SqlDatabase } from "@salesforce/mobile-db";

/** Everything the screens talk to. Each piece is a port, so tests and the future offline adapters plug in here. */
export interface AppDependencies {
  readonly auth: AuthPort;
  readonly repositories: Repositories;
  readonly connectivity: ConnectivityPort;
  /** On-device database services (cache, drafts, outbox, sync). Absent in online-only test setups. */
  readonly offline?: OfflineServices;
}

/** Production composition: online adapters over the API at `baseUrl` (already including the API base path). */
export function createAppDependencies(baseUrl: string, db: SqlDatabase): AppDependencies {
  const api = createMobileApiClient(baseUrl);
  const remote = createRemoteRepositories(api);
  return {
    auth: createHttpAuth(api),
    repositories: remote,
    connectivity: createDeviceConnectivity(),
    offline: createOfflineServices({ db, api, remote, imageFileSystem: createExpoImageFileSystem() }),
  };
}
