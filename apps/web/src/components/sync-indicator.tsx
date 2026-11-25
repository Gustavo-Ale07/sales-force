import { useIsFetching, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { syncStatusQueryOptions } from "../lib/api-queries";
import { useApi } from "../lib/app-context";
import { isOperationsRole } from "../lib/operations-role";
import { SYNC_INDICATOR_HEX, isDataStale, syncIndicatorView, syncSituation, type SyncDotColor } from "../lib/sync-indicator";
import { useRefreshStage } from "./order-stage";
import { RefreshDataDialog } from "./refresh-data-dialog";

/** Darker tones for the state chip in the Perfil block, which sits on a white card (the header arrows use SYNC_INDICATOR_HEX). */
export const DOT_BG: Record<SyncDotColor, string> = {
  green: "bg-[#17693d]",
  yellow: "bg-[#E08A00]",
  red: "bg-[#d10108]",
};

function useOnline(): boolean {
  return useSyncExternalStore(
    (notify) => {
      window.addEventListener("online", notify);
      window.addEventListener("offline", notify);
      return () => {
        window.removeEventListener("online", notify);
        window.removeEventListener("offline", notify);
      };
    },
    () => navigator.onLine,
    () => true,
  );
}

/** Reads (without fetching) what the cached order lists already say, plus read errors/retries across the cache. */
function useCacheSignals() {
  const queryClient = useQueryClient();
  const cache = queryClient.getQueryCache();
  const snapshot = useCallback(() => {
    let needsCorrection = false;
    let awaitingSend = false;
    let failed = false;
    let retrying = false;
    let pending = 0;
    for (const query of cache.getAll()) {
      if (query.state.status === "error" && query.state.data === undefined) failed = true;
      if (query.state.fetchStatus === "fetching" && query.state.fetchFailureCount > 0) retrying = true;
      if (query.queryKey[0] === "orders" && query.queryKey[1] === "list") {
        const items = (query.state.data as { items?: Array<{ status?: string }> } | undefined)?.items ?? [];
        for (const item of items) {
          if (item.status === "rejected") needsCorrection = true;
          if (item.status === "queued") {
            awaitingSend = true;
            pending += 1;
          }
        }
      }
    }
    return `${needsCorrection ? 1 : 0}${awaitingSend ? 1 : 0}${failed ? 1 : 0}${retrying ? 1 : 0}:${pending}`;
  }, [cache]);
  const key = useSyncExternalStore((notify) => cache.subscribe(notify), snapshot, snapshot);
  return { needsCorrection: key[0] === "1", awaitingSend: key[1] === "1", failed: key[2] === "1", retrying: key[3] === "1", pending: Number(key.slice(5)) };
}

function Arrows({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M20 11a8 8 0 0 0-14.3-4.5L4 8.5" />
      <path d="M4 4v4.5h4.5" />
      <path d="M4 13a8 8 0 0 0 14.3 4.5l1.7-2" />
      <path d="M20 20v-4.5h-4.5" />
    </svg>
  );
}

/** State shared by the header dot and the profile block: the colour table, the last data time and the refresh overlay switch. */
export function useSyncState(role: string) {
  const api = useApi();
  const online = useOnline();
  const fetching = useIsFetching();
  const signals = useCacheSignals();
  const refresh = useRefreshStage();
  const status = useQuery({ ...syncStatusQueryOptions(api), enabled: !isOperationsRole(role) });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const view = syncIndicatorView({
    online,
    syncing: refresh.running || fetching > 0 || dialogOpen,
    failed: refresh.failed || signals.failed,
    needsCorrection: signals.needsCorrection,
    awaitingSend: signals.awaitingSend,
    stale: isDataStale(status.data?.dataAsOf, now),
    retrying: signals.retrying,
  });
  const dataAsOf = status.data?.dataAsOf ?? null;
  const situation = syncSituation({
    online,
    syncing: view.spinning,
    failed: refresh.failed || signals.failed,
    needsCorrection: signals.needsCorrection,
    pending: signals.pending,
    dataAsOf,
  });
  return { view, situation, online, dataAsOf, pendingCount: signals.pending, dialogOpen, setDialogOpen };
}

/** Header dot: colour = state (green ok, yellow instability, red error); click = sync now. White arrows spin while updating. */
export function SyncIndicator({ role }: { role: string }) {
  const { view, dialogOpen, setDialogOpen } = useSyncState(role);
  return (
    <>
    <button
      type="button"
      aria-label={view.label}
      title={view.label}
      aria-busy={view.spinning}
      data-testid="sync-indicator"
      data-color={view.color}
      onClick={() => {
        if (view.spinning) return;
        setDialogOpen(true);
      }}
      className="flex size-11 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-white"
    >
      <span className={view.spinning ? "flex animate-spin motion-reduce:animate-none" : "flex"}>
        <Arrows color={SYNC_INDICATOR_HEX[view.color]} />
      </span>
    </button>
    <RefreshDataDialog open={dialogOpen} role={role} onClose={() => setDialogOpen(false)} />
    </>
  );
}
