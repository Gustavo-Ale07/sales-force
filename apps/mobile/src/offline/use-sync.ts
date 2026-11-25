import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import type { SyncManager, SyncStatus } from "@salesforce/mobile-db";
import type { ConnectivityState } from "../connectivity/connectivity";

const TIMER_MS = 60_000;
/** Fallback refresh while the change-ping stream is down (RT-1 engineering choice). */
const ORDERS_FALLBACK_MS = 30_000;
const REFERENCE_FALLBACK_MS = 300_000;
const IDLE: SyncStatus = { phase: "idle", pending: 0, needsAttention: 0, lastSyncedAt: null, lastError: null };

/**
 * Keeps the sync manager running while the signed-in shell is mounted. The device base is frozen between syncs: the full
 * sync (server refresh, then download) runs at login and on the seller's tap only. Pending orders and customers keep
 * being SENT when the device comes back online, on foreground, when new work is waiting and on a slow timer that respects
 * the retry backoff. Offline it never tries (a failed attempt would freeze the order's payload for nothing).
 */
export function useSyncStatus(sync: SyncManager | null, connectivity: ConnectivityState, loginSync = false, events?: SyncEventsConnector, refreshKey?: string): SyncStatus {
  const [status, setStatus] = useState<SyncStatus>(sync?.getStatus() ?? IDLE);

  useEffect(() => {
    if (sync === null) return undefined;
    const unsubscribe = sync.subscribe(setStatus);
    void sync.refresh();
    return unsubscribe;
  }, [sync]);

  const online = connectivity !== "offline";
  const [foreground, setForeground] = useState(AppState.currentState !== "background" && AppState.currentState !== "inactive");

  // The reference base is downloaded only at login (the first online moment of this session) and when the seller taps
  // "Sincronizar agora". Everything else (back online, foreground, timer) only pushes pending work.
  // Reopening the app with a valid session is NOT a login (owner 2026-11-13): then only pending work is sent.
  const loggedIn = useRef(false);
  useEffect(() => {
    if (sync === null || !online) return;
    if (!loggedIn.current && loginSync) {
      loggedIn.current = true;
      void sync.sync("login");
    } else {
      loggedIn.current = true;
      void sync.sync("reconnected", { pull: false });
    }
  }, [sync, online, loginSync]);

  // New local work while online: push it (no cache refresh).
  // Only NEW work triggers it (the pending count rising above what was already handled). A run that ends with the same work still
  // pending (backoff, refusal) must not trigger the next run: retries belong to the timer, which respects the backoff.
  const idle = status.phase === "idle";
  const pending = status.pending;
  const handled = useRef(0);
  useEffect(() => {
    if (sync === null || !idle) return;
    if (pending <= handled.current) {
      handled.current = pending;
      return;
    }
    handled.current = pending;
    if (online) void sync.sync("after_save", { pull: false });
  }, [sync, online, idle, pending]);

  useEffect(() => {
    if (sync === null) return undefined;
    const subscription = AppState.addEventListener("change", (next) => {
      setForeground(next === "active");
      if (next === "active" && online) void sync.sync("foreground", { pull: false });
    });
    return () => subscription.remove();
  }, [sync, online]);

  useEffect(() => {
    if (sync === null || !online) return undefined;
    const timer = setInterval(() => void sync.sync("timer", { pull: false }), TIMER_MS);
    return () => clearInterval(timer);
  }, [sync, online]);

  useAutomaticUpdates(sync, online && foreground, events, refreshKey);

  return status;
}

export interface SyncEventsConnector {
  (onTopic: (topic: "orders" | "reference") => void, onConnection: (connected: boolean) => void): () => void;
}

/**
 * RT-1: while online and in the foreground the app follows the server by itself, with no overlay and no change to the sync icon.
 * The change-ping stream triggers a background refresh of orders or of the reference data (gated by the server's change marker);
 * while the stream is not connected a foreground timer does the same (30 s orders, 5 min reference). Opening the orders area and
 * returning to the foreground ask the server to re-read the open orders first. Offline nothing runs; the reconnect push-then-pull
 * stays in `useSyncStatus`. Pauses in the background.
 */
function useAutomaticUpdates(sync: SyncManager | null, live0: boolean, events: SyncEventsConnector | undefined, refreshKey: string | undefined): void {
  const connected = useRef(false);
  const live = sync !== null && live0 && sync.backgroundRefresh !== undefined;

  // Back in the foreground (and the first moment online): ask the server to re-read the open orders, then refresh everything.
  useEffect(() => {
    if (!live) return;
    void sync.backgroundRefresh?.({ orders: true, reference: true, askServerFor: "open" });
  }, [live, sync]);

  // The orders area (list or detail) was opened.
  useEffect(() => {
    if (!live || refreshKey === undefined) return;
    void sync.backgroundRefresh?.({ orders: true, askServerFor: "open" });
  }, [live, sync, refreshKey]);

  useEffect(() => {
    if (!live) {
      connected.current = false;
      return undefined;
    }
    const close = events?.(
      (topic) => void sync.backgroundRefresh?.(topic === "orders" ? { orders: true } : { reference: true }),
      (isConnected) => {
        connected.current = isConnected;
        // The stream may have missed pings while it was down: catch up once it is back.
        if (isConnected) void sync.backgroundRefresh?.({ orders: true, reference: true });
      },
    );
    const orders = setInterval(() => {
      if (!connected.current) void sync.backgroundRefresh?.({ orders: true });
    }, ORDERS_FALLBACK_MS);
    const reference = setInterval(() => {
      if (!connected.current) void sync.backgroundRefresh?.({ reference: true });
    }, REFERENCE_FALLBACK_MS);
    return () => {
      close?.();
      connected.current = false;
      clearInterval(orders);
      clearInterval(reference);
    };
  }, [live, sync, events]);
}
