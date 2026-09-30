import { useEffect, useState } from "react";
import { AppState } from "react-native";
import type { SyncManager, SyncStatus } from "@salesforce/mobile-db";
import type { ConnectivityState } from "../connectivity/connectivity";

const TIMER_MS = 60_000;
const IDLE: SyncStatus = { phase: "idle", pending: 0, needsAttention: 0, lastSyncedAt: null, lastError: null };

/**
 * Keeps the sync manager running while the signed-in shell is mounted: on mount, when the device comes back
 * online, when the app returns to the foreground, when new work is waiting, and on a slow timer that respects the
 * retry backoff. Offline it never tries (a failed attempt would freeze the order's payload for nothing).
 */
export function useSyncStatus(sync: SyncManager | null, connectivity: ConnectivityState): SyncStatus {
  const [status, setStatus] = useState<SyncStatus>(sync?.getStatus() ?? IDLE);

  useEffect(() => {
    if (sync === null) return undefined;
    const unsubscribe = sync.subscribe(setStatus);
    void sync.refresh();
    return unsubscribe;
  }, [sync]);

  const online = connectivity !== "offline";

  // Mount / back online: push, then refresh the cache.
  useEffect(() => {
    if (sync !== null && online) void sync.sync("reconnected");
  }, [sync, online]);

  // New local work while online: push it (no cache refresh).
  const waiting = status.pending > 0 && status.phase === "idle";
  useEffect(() => {
    if (sync !== null && online && waiting) void sync.sync("after_save", { pull: false });
  }, [sync, online, waiting]);

  useEffect(() => {
    if (sync === null) return undefined;
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active" && online) void sync.sync("foreground");
    });
    return () => subscription.remove();
  }, [sync, online]);

  useEffect(() => {
    if (sync === null || !online) return undefined;
    const timer = setInterval(() => void sync.sync("timer", { pull: false }), TIMER_MS);
    return () => clearInterval(timer);
  }, [sync, online]);

  return status;
}
