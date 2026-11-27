/**
 * Server code of this browser (decision of 2026-11-27, replaces device approval): "sf1." + base64url(JSON { a, k }).
 * The whole code is kept in `localStorage` (owner decision); only `k` travels, in the `X-Server-Code` header of every
 * API request. The code is never logged and never sent as a whole.
 *
 * Format and header name mirror `packages/contracts/src/server-code.ts` (backend); this module is the only place of the
 * web app that knows them, so it can switch to the contract helpers without touching callers.
 */
export const SERVER_CODE_HEADER = "x-server-code";
export const SERVER_CODE_PREFIX = "sf1.";
const STORAGE_KEY = "sf.serverCode";
const CHANGE_EVENT = "sf:server-code";
const KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function fromBase64Url(input: string): string | null {
  try {
    const padded = input.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(input.length / 4) * 4, "=");
    const binary = atob(padded);
    return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
  } catch {
    return null;
  }
}

/** Returns the key `k` of a well-formed code, or null. Never throws. */
export function serverKeyOf(code: string): string | null {
  const text = code.trim();
  if (!text.startsWith(SERVER_CODE_PREFIX)) return null;
  const json = fromBase64Url(text.slice(SERVER_CODE_PREFIX.length));
  if (json === null) return null;
  try {
    const payload = JSON.parse(json) as { a?: unknown; k?: unknown };
    if (typeof payload.a !== "string" || payload.a.length === 0) return null;
    return typeof payload.k === "string" && KEY_PATTERN.test(payload.k) ? payload.k : null;
  } catch {
    return null;
  }
}

function read(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** The key sent in the header, or null when this browser has no (valid) code. */
export function storedServerKey(): string | null {
  const code = read();
  return code === null ? null : serverKeyOf(code);
}

export const hasStoredServerCode = (): boolean => storedServerKey() !== null;

function notify() {
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function storeServerCode(code: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, code.trim());
  } catch {
    // Storage blocked: the gate keeps asking, nothing else to do.
  }
  notify();
}

export function clearServerCode(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clear.
  }
  notify();
}

/** For `useSyncExternalStore`: re-render when the stored code changes (this tab or another). */
export function subscribeServerCode(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === STORAGE_KEY) listener();
  };
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener("storage", onStorage);
  };
}
