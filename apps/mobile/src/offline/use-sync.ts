import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import type { SyncManager, SyncStatus } from "@salesforce/mobile-db";
import type { ConnectivityState } from "../connectivity/connectivity";

const TIMER_MS = 60_000;
const IDLE: SyncStatus = { phase: "idle", pending: 0, needsAttention: 0, lastSyncedAt: null, lastError: null };

/**
 * Keeps the sync manager running while the signed-in shell is mounted. The device base is frozen between syncs: the full
 * sync (server refresh, then download) runs at login and on the seller's tap only. Pending orders and customers keep
 * being SENT when the device comes back online, on foreground, when new work is waiting and on a slow timer that respects
 * the retry backoff. Offline it never tries (a failed attempt would freeze the order's payload for nothing).
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

  // The reference base is downloaded only at login (the first online moment of this session) and when the seller taps
  // "Sincronizar agora". Everything else (back online, foreground, timer) only pushes pending work.
  const loggedIn = useRef(false);
  useEffect(() => {
    if (sync === null || !online) return;
    if (!loggedIn.current) {
      loggedIn.current = true;
      void sync.sync("login");
    } else {
      void sync.sync("reconnected", { pull: false });
    }
  }, [sync, online]);

  // New local work while online: push it (no cache refresh).
  const waiting = status.pending > 0 && status.phase === "idle";
  useEffect(() => {
    if (sync !== null && online && waiting) void sync.sync("after_save", { pull: false });
  }, [sync, online, waiting]);

  useEffect(() => {
    if (sync === null) return undefined;
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active" && online) void sync.sync("foreground", { pull: false });
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
