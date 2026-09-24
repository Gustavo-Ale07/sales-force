import * as Network from "expo-network";

export type ConnectivityState = "online" | "offline" | "unknown";

/**
 * Device connectivity as the UI needs it. This is a hint about the radio and the OS reachability check, not a
 * guarantee that the API answers: request failures are reported by the data layer on their own.
 */
export interface ConnectivityPort {
  getState(): Promise<ConnectivityState>;
  /** Calls `listener` on every change; returns the unsubscribe function. */
  subscribe(listener: (state: ConnectivityState) => void): () => void;
}

interface NetworkSnapshot {
  readonly isConnected?: boolean;
  readonly isInternetReachable?: boolean;
}

/** `offline` as soon as the OS says there is no link or no internet; `online` only when both are confirmed. */
export function toConnectivityState(snapshot: NetworkSnapshot): ConnectivityState {
  if (snapshot.isConnected === false || snapshot.isInternetReachable === false) return "offline";
  if (snapshot.isConnected === true && snapshot.isInternetReachable === true) return "online";
  return "unknown";
}

export function createDeviceConnectivity(): ConnectivityPort {
  return {
    async getState() {
      return toConnectivityState(await Network.getNetworkStateAsync());
    },
    subscribe(listener) {
      const subscription = Network.addNetworkStateListener((snapshot) => listener(toConnectivityState(snapshot)));
      return () => subscription.remove();
    },
  };
}
