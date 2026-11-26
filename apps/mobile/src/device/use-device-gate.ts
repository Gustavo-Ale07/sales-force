import { useEffect, useState } from "react";
import type { OfflineSessionStore } from "../offline/session";
import type { DevicePort } from "./device-port";

export type DeviceGate = "checking" | "pending" | "ok";

/** While pending, the app asks again at this interval (M-02); approval then opens the app without a new login. */
export const PENDING_POLL_MS = 15_000;

/**
 * AUTH-2 (PROPOSED): an online session first learns whether this installation is approved. Pending = no business data and no sync
 * (the caller shows the approval screen and builds no services). Approved = the offline limit is remembered for the next offline
 * start. A revoked device is not reported here: the API answers 401 `device_revoked` and the shell wipes (see `revocation.ts`).
 * Not reaching the server never blocks: an offline start is governed by the offline limit, not by this check.
 */
export function useDeviceGate(options: { readonly device: DevicePort | undefined; readonly session: OfflineSessionStore | undefined; readonly active: boolean; readonly pollMs?: number }): DeviceGate {
  const { device, session, active, pollMs = PENDING_POLL_MS } = options;
  const [state, setState] = useState<DeviceGate>("checking");
  const applies = active && device !== undefined;

  useEffect(() => {
    if (!applies || device === undefined) return undefined;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = async (first = false): Promise<void> => {
      if (first) setState("checking");
      try {
        const found = await device.status();
        if (!live) return;
        if (found !== null && found.status === "pending") {
          setState("pending");
          timer = setTimeout(() => void check(), pollMs);
          return;
        }
        if (found !== null) await session?.rememberOfflineMaxDays(found.offlineMaxDays).catch(() => undefined);
        if (found?.defaultPriceTableCode !== undefined) await session?.rememberDefaultPriceTable?.(found.defaultPriceTableCode).catch(() => undefined);
        if (live) setState("ok");
      } catch {
        if (!live) return;
        // Unreachable server: keep waiting if already known as pending, otherwise do not block.
        setState((current) => (current === "pending" ? "pending" : "ok"));
        timer = setTimeout(() => void check(), pollMs);
      }
    };
    void check(true);
    return () => {
      live = false;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [applies, device, session, pollMs]);

  return applies ? state : "ok";
}
