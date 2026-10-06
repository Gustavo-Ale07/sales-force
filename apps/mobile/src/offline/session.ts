import { META_KEYS, deleteMeta, getMeta, isoNow, setMeta, type OfflineEnv, type SqlDatabase } from "@salesforce/mobile-db";
import type { Account } from "../auth/auth-port";

/**
 * Interim offline session gate (AUTH-2 is PROPOSED): the device remembers the last account that authenticated
 * ONLINE and lets it back in for at most `MAX_OFFLINE_DAYS` without contact with the server. The remembered record
 * holds the non-secret account fields the API already returned; never a password, token or cookie (those live only
 * in the native cookie jar / secure store). It is a convenience gate, not authorization: every write is revalidated
 * server-side on sync (P-21, P-08).
 */
export const MAX_OFFLINE_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface RememberedSession {
  readonly account: Account;
  readonly lastOnlineAt: string;
}

export type OfflineAccess = { readonly allowed: true; readonly session: RememberedSession } | { readonly allowed: false; readonly reason: "none" | "expired" };

export function evaluateOfflineAccess(remembered: RememberedSession | null, now: Date): OfflineAccess {
  if (remembered === null) return { allowed: false, reason: "none" };
  const last = Date.parse(remembered.lastOnlineAt);
  if (Number.isNaN(last) || now.getTime() - last > MAX_OFFLINE_DAYS * DAY_MS) return { allowed: false, reason: "expired" };
  return { allowed: true, session: remembered };
}

export interface OfflineSessionStore {
  load(): Promise<RememberedSession | null>;
  /** Called on every successful online authentication. */
  remember(account: Account): Promise<void>;
  /** Sign-out: the device no longer opens without an online login. Drafts and the outbox are kept. */
  forget(): Promise<void>;
}

function isAccount(value: unknown): value is Account {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === "string" && typeof record.username === "string" && typeof record.displayName === "string";
}

/** A record remembered before the contract renamed `email` to `username` is read as the same login identifier. */
function upgradeLegacyAccount(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return value;
  const { email, ...rest } = value as Record<string, unknown>;
  return "username" in rest || typeof email !== "string" ? value : { ...rest, username: email };
}

export function createOfflineSessionStore(db: SqlDatabase, env: OfflineEnv): OfflineSessionStore {
  return {
    async load() {
      const [rawAccount, lastOnlineAt] = await Promise.all([getMeta(db, META_KEYS.account), getMeta(db, META_KEYS.lastAuthAt)]);
      if (rawAccount === null || lastOnlineAt === null) return null;
      try {
        const account: unknown = upgradeLegacyAccount(JSON.parse(rawAccount));
        return isAccount(account) ? { account, lastOnlineAt } : null;
      } catch {
        return null;
      }
    },
    async remember(account) {
      const now = isoNow(env);
      await db.transaction(async (tx) => {
        await setMeta(tx, META_KEYS.account, JSON.stringify(account), now);
        await setMeta(tx, META_KEYS.lastAuthAt, now, now);
      });
    },
    async forget() {
      await db.transaction(async (tx) => {
        await deleteMeta(tx, META_KEYS.account);
        await deleteMeta(tx, META_KEYS.lastAuthAt);
      });
    },
  };
}
