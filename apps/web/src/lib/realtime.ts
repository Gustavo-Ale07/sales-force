import type { QueryClient } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useApi } from "./app-context";
import type { ApiClient } from "./api";

/**
 * RT-1 on the site: one app-level SSE stream carrying content-free topic pings. A ping never carries data; it only
 * marks the cached reads stale so TanStack Query re-reads them through the normal authorized endpoints (P-21).
 * Nothing here shows an overlay or touches a form: queries refetch in the background.
 */

export const EVENTS_PATH = "/api/v1/sync/events";
export const FALLBACK_POLL_MS = 30_000;
export const REFRESH_COOLDOWN_MS = 10_000;
export const REFRESH_CAP = 20;
const BACKOFF_START_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;
/** After this many consecutive failures without a single message the stream counts as unavailable and the timed fallback runs. */
const FAILURES_BEFORE_FALLBACK = 2;

export type RealtimeTopic = "orders" | "reference";

const REFERENCE_KEYS = [
  ["customers"],
  ["products"],
  ["product-groups"],
  ["sync-status"],
  ["configuration"],
  ["order-entry-configuration"],
  ["discount-limits"],
  ["sellers"],
  ["carriers"],
] as const;

export function invalidateTopic(queryClient: QueryClient, topic: RealtimeTopic): void {
  if (topic === "orders") {
    // Orders list and every open detail share the `orders` prefix; the release queue and the dashboard counters follow the same orders.
    void queryClient.invalidateQueries({ queryKey: ["orders"] });
    void queryClient.invalidateQueries({ queryKey: ["release-queue"] });
    void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    return;
  }
  for (const key of REFERENCE_KEYS) void queryClient.invalidateQueries({ queryKey: key });
}

/** Reads the topic of a ping; anything else (comments, keep-alives, malformed data) is ignored. */
export function parsePing(data: unknown): RealtimeTopic | null {
  if (typeof data !== "string") return null;
  try {
    const topic = (JSON.parse(data) as { topic?: unknown } | null)?.topic;
    return topic === "orders" || topic === "reference" ? topic : null;
  } catch {
    return null;
  }
}

const lastRefresh = new Map<string, number>();

/** Test hook: forget the per-order cooldowns. */
export function resetRefreshCooldowns(): void {
  lastRefresh.clear();
}

/**
 * Asks the worker to re-read the given orders now: at most 20, each at most once per 10 s on this client. Fire and
 * forget; failures are ignored (the timed/event refresh still converges). Refetches the orders reads afterwards.
 */
export async function requestOrderRefresh(api: ApiClient, queryClient: QueryClient, ids: readonly string[], now: number = Date.now()): Promise<void> {
  const due: string[] = [];
  for (const id of ids) {
    if (due.length >= REFRESH_CAP) break;
    if (due.includes(id)) continue;
    const last = lastRefresh.get(id);
    if (last !== undefined && now - last < REFRESH_COOLDOWN_MS) continue;
    lastRefresh.set(id, now);
    due.push(id);
  }
  if (due.length === 0) return;
  await Promise.allSettled(due.map((id) => api.POST("/orders/{id}/refresh", { params: { path: { id } } })));
  void queryClient.invalidateQueries({ queryKey: ["orders"] });
}

const isVisible = () => typeof document === "undefined" || document.visibilityState !== "hidden";

/** Mount once, inside the authenticated shell. */
export function useRealtimeSync(enabled: boolean = true): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled || typeof EventSource === "undefined") return;
    let source: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let pollTimer: ReturnType<typeof setInterval> | undefined;
    let delay = BACKOFF_START_MS;
    let failures = 0;
    let disposed = false;

    const stopPoll = () => {
      if (pollTimer !== undefined) clearInterval(pollTimer);
      pollTimer = undefined;
    };
    const startPoll = () => {
      if (pollTimer !== undefined || !isVisible()) return;
      pollTimer = setInterval(() => {
        if (isVisible()) invalidateTopic(queryClient, "orders");
      }, FALLBACK_POLL_MS);
    };
    const close = () => {
      if (retryTimer !== undefined) clearTimeout(retryTimer);
      retryTimer = undefined;
      source?.close();
      source = null;
    };
    const open = () => {
      if (disposed || source || !isVisible()) return;
      const next = new EventSource(EVENTS_PATH, { withCredentials: true });
      source = next;
      next.onopen = () => {
        failures = 0;
        delay = BACKOFF_START_MS;
        stopPoll();
      };
      // The server names its frames `event: ping`; an unnamed message is accepted too.
      const onPing = (event: Event) => {
        const topic = parsePing((event as MessageEvent).data);
        if (topic) invalidateTopic(queryClient, topic);
      };
      next.addEventListener("ping", onPing);
      next.onmessage = onPing;
      next.onerror = () => {
        // The browser retries by itself only while the stream is CONNECTING; a closed one is reopened here with backoff.
        failures += 1;
        if (failures >= FAILURES_BEFORE_FALLBACK) startPoll();
        next.close();
        if (source === next) source = null;
        if (disposed || !isVisible()) return;
        retryTimer = setTimeout(open, delay);
        delay = Math.min(delay * 2, BACKOFF_MAX_MS);
      };
    };

    const onVisibility = () => {
      if (disposed) return;
      if (isVisible()) {
        // Back in view: reconnect and catch up on anything missed while paused.
        delay = BACKOFF_START_MS;
        open();
        invalidateTopic(queryClient, "orders");
        if (failures >= FAILURES_BEFORE_FALLBACK) startPoll();
      } else {
        close();
        stopPoll();
      }
    };

    open();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibility);
      close();
      stopPoll();
    };
  }, [enabled, queryClient]);
}

/**
 * Refreshes the orders in view: once when the screen first has them, and each time the tab becomes visible again.
 * Pass the ids currently shown (list page or the open detail); the 10 s cooldown and the cap of 20 live in `requestOrderRefresh`.
 */
export function useRefreshOrdersInView(ids: readonly string[]): void {
  const api = useApi();
  const queryClient = useQueryClient();
  const latest = useRef(ids);
  const fired = useRef(false);
  const hasIds = ids.length > 0;

  useEffect(() => {
    latest.current = ids;
  });

  useEffect(() => {
    if (!hasIds || fired.current) return;
    fired.current = true;
    void requestOrderRefresh(api, queryClient, latest.current);
  }, [hasIds, api, queryClient]);

  useEffect(() => {
    const onVisibility = () => {
      if (isVisible() && latest.current.length > 0) void requestOrderRefresh(api, queryClient, latest.current);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [api, queryClient]);
}
