import { createHttpAuth } from "./auth/http-auth";
import type { AuthPort } from "./auth/auth-port";
import { createDeviceConnectivity, type ConnectivityPort } from "./connectivity/connectivity";
import { createMobileApiClient } from "./data/api";
import type { Repositories } from "./data/ports";
import { createRemoteRepositories } from "./data/remote-repositories";

/** Everything the screens talk to. Each piece is a port, so tests and the future offline adapters plug in here. */
export interface AppDependencies {
  readonly auth: AuthPort;
  readonly repositories: Repositories;
  readonly connectivity: ConnectivityPort;
}

/** Production composition: online adapters over the API at `baseUrl` (already including the API base path). */
export function createAppDependencies(baseUrl: string): AppDependencies {
  const api = createMobileApiClient(baseUrl);
  return {
    auth: createHttpAuth(api),
    repositories: createRemoteRepositories(api),
    connectivity: createDeviceConnectivity(),
  };
}
