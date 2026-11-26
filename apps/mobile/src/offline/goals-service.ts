import { getMeta, setMeta, type SqlDatabase } from "@salesforce/mobile-db";
import type { GoalsResponse } from "@salesforce/contracts";
import { callApi, type ApiClient } from "../data/api";

/** What the screens show: the month's goals and when this device last got them from the server. */
export interface GoalsSnapshot {
  readonly data: GoalsResponse;
  /** ISO instant the server answer was stored on this device (shown as data only). */
  readonly fetchedAt: string;
}

export interface GoalsPort {
  /** The last value stored on this device, or `null` when none was ever read. Never touches the network. */
  cached(): Promise<GoalsSnapshot | null>;
  /** Reads the server and stores the answer; with no connection returns the stored value, or `null`. */
  load(): Promise<GoalsSnapshot | null>;
}

interface Deps {
  readonly db: SqlDatabase;
  readonly api: ApiClient;
  readonly ownerAccountId: string;
  readonly now?: () => Date;
}

/** Key in `sync_metadata`; the `cache.` prefix is wiped by the local cleanup (logout, account change, revocation). */
export function goalsCacheKey(accountId: string): string {
  return `cache.goals.${accountId}`;
}

function parse(raw: string | null): GoalsSnapshot | null {
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw) as Partial<GoalsSnapshot>;
    if (typeof value.fetchedAt !== "string" || typeof value.data !== "object" || value.data === null) return null;
    return { data: value.data, fetchedAt: value.fetchedAt };
  } catch {
    return null;
  }
}

/** M-24 / DSH-5 data (RF-GOL-1/2): server-computed figures, kept on the device so the screens also work offline. */
export function createGoalsPort(deps: Deps): GoalsPort {
  const key = goalsCacheKey(deps.ownerAccountId);
  const cached = async () => parse(await getMeta(deps.db, key));
  return {
    cached,
    async load() {
      try {
        const data = (await callApi(() => deps.api.GET("/goals"))) as GoalsResponse;
        const fetchedAt = (deps.now?.() ?? new Date()).toISOString();
        await setMeta(deps.db, key, JSON.stringify({ data, fetchedAt } satisfies GoalsSnapshot), fetchedAt);
        return { data, fetchedAt };
      } catch {
        return cached();
      }
    },
  };
}
