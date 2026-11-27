import { useQueryClient } from "@tanstack/react-query";
import { Outlet, useRouter, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { hasStoredServerCode, subscribeServerCode } from "../lib/server-code";
import { AddServerPage } from "../routes/add-server";

/** Pages that work without a server code: the public downloads center. */
const OPEN_PATHS = ["/downloads", "/_design"];

/**
 * Root of every route: without a stored server code the only screen is "Adicionar servidor" (no sign-in). Losing the
 * code (the guard answered 401) clears the cached data; getting one re-runs the route guards so the sign-in appears.
 */
export function ServerCodeGate() {
  const hasCode = useSyncExternalStore(subscribeServerCode, hasStoredServerCode, () => false);
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const queryClient = useQueryClient();
  const router = useRouter();
  const previous = useRef(hasCode);

  useEffect(() => {
    if (previous.current === hasCode) return;
    previous.current = hasCode;
    queryClient.clear();
    void router.invalidate();
  }, [hasCode, queryClient, router]);

  const open = OPEN_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
  return (
    <>
      {hasCode || open ? <Outlet /> : <AddServerPage />}
    </>
  );
}
