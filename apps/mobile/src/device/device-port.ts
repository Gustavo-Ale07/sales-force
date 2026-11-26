import type { DeviceRegistration, SessionDevice } from "@salesforce/contracts";
import { callApi, type ApiClient } from "../data/api";
import type { InstallIdStore } from "./install-id";

/** The registry of this installation on the server (AUTH-2, PROPOSED): its status, and the report of the last synchronization. */
export interface DevicePort {
  /** What the login sends so the server recognizes this installation. */
  registration(): Promise<DeviceRegistration>;
  /** The device behind the current session; `null` when the session carries none (a build that predates the registry). */
  status(): Promise<SessionDevice | null>;
  /** Tells the server when this device last synchronized (the site shows it; the offline limit is enforced on the device). */
  reportSync(at: Date): Promise<void>;
  /** After a wipe or a revocation: the next login registers as a new installation. */
  resetIdentity(): Promise<void>;
}

export function createDevicePort(api: ApiClient, installIds: InstallIdStore, describe: () => { label: string; platform: "android" | "ios" }): DevicePort {
  return {
    async registration() {
      const { label, platform } = describe();
      return { installId: await installIds.getOrCreate(), label, platform };
    },
    async status() {
      const result = await callApi(() => api.GET("/devices/me"));
      return result.device;
    },
    async reportSync(at) {
      await callApi(() => api.POST("/devices/me/sync", { body: { syncedAt: at.toISOString() } }));
    },
    resetIdentity: () => installIds.reset(),
  };
}
