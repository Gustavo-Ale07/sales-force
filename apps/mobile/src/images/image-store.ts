import type { ImageFileSystem } from "./image-fs";

/** Result of one authenticated thumbnail request, already classified by the transport. */
export type ImageFetchOutcome =
  | { readonly kind: "ok"; readonly bytes: Uint8Array }
  /** 404: the product has no image (or is not visible). Not an error. */
  | { readonly kind: "absent" }
  /** 5xx/503, network, auth: transient from the thumbnail's point of view. */
  | { readonly kind: "unavailable" };

export interface ProductImageRef {
  readonly version: string;
}

export interface ResolveOptions {
  /** False offline: only files already on the device are used. */
  readonly online: boolean;
  /** A row that scrolled away before its download started cancels it. */
  readonly signal?: AbortSignal;
}

export interface ProductImageStore {
  /** A `file://` uri of the thumbnail of `code` at `image.version`, or `null` (placeholder). Never throws. */
  resolve(code: number, image: ProductImageRef, options: ResolveOptions): Promise<string | null>;
  /** Sign-out: deletes every stored thumbnail and the index. */
  purge(): Promise<void>;
}

export interface ProductImageStoreDeps {
  readonly fs: ImageFileSystem;
  readonly fetchThumbnail: (code: number, signal: AbortSignal) => Promise<ImageFetchOutcome>;
  /**
   * Identity of the data the cache serves: `ownerAccountId|environment|datasetId`, or `null` when no dataset is
   * confirmed (nothing is shown or stored). When it differs from the stored one, every file is deleted first.
   */
  readonly scope: () => Promise<string | null>;
  readonly now: () => number;
  readonly maxTotalBytes?: number;
  readonly maxImageBytes?: number;
  readonly maxConcurrent?: number;
  readonly timeoutMs?: number;
  /** Backoff after a transient failure / corrupt answer before the same image is tried again. */
  readonly failureRetryMs?: number;
}

const INDEX = "index.json";
export const DEFAULT_MAX_TOTAL_BYTES = 20 * 1024 * 1024;
export const DEFAULT_MAX_IMAGE_BYTES = 512 * 1024;

interface Entry {
  readonly file: string;
  readonly version: string;
  readonly bytes: number;
  usedAt: number;
}
interface Index {
  scope: string;
  seq: number;
  entries: Record<string, Entry>;
}

/** Only png, jpeg and webp are accepted (the server serves nothing else); checked by signature, never by name. */
export function looksLikeImage(bytes: Uint8Array): boolean {
  const png = bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const jpeg = bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const webp =
    bytes.length > 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  return png || jpeg || webp;
}

function parseIndex(text: string | null): Index | null {
  if (text === null) return null;
  try {
    const value = JSON.parse(text) as Partial<Index>;
    if (typeof value.scope !== "string" || typeof value.seq !== "number" || typeof value.entries !== "object" || value.entries === null) return null;
    for (const entry of Object.values(value.entries)) {
      if (typeof entry?.file !== "string" || typeof entry.version !== "string" || typeof entry.bytes !== "number" || typeof entry.usedAt !== "number") return null;
    }
    return value as Index;
  } catch {
    return null;
  }
}

/**
 * Authenticated, versioned, bounded thumbnail cache on files (never base64, never in the database). Keyed by product
 * code; the stored `version` must equal the one in the product metadata, so a changed image is refetched and a stale
 * one is never shown. Index/file mutations are serialized.
 */
export function createProductImageStore(deps: ProductImageStoreDeps): ProductImageStore {
  const { fs, now } = deps;
  const maxTotal = deps.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
  const maxImage = deps.maxImageBytes ?? DEFAULT_MAX_IMAGE_BYTES;
  const maxConcurrent = deps.maxConcurrent ?? 3;
  const timeoutMs = deps.timeoutMs ?? 10_000;
  const retryMs = deps.failureRetryMs ?? 60_000;

  let index: Index | null = null;
  let lock: Promise<unknown> = Promise.resolve();
  const exclusive = <T>(work: () => Promise<T>): Promise<T> => {
    const next = lock.then(work, work);
    lock = next.catch(() => undefined);
    return next;
  };

  // In-memory only: 404 for (code, version) and recent transient failures. Never persisted.
  const absent = new Set<string>();
  const failedUntil = new Map<string, number>();
  const inFlight = new Map<string, Promise<string | null>>();

  let running = 0;
  const waiting: (() => void)[] = [];
  async function slot<T>(work: () => Promise<T>): Promise<T> {
    if (running >= maxConcurrent) await new Promise<void>((resolve) => waiting.push(resolve));
    running += 1;
    try {
      return await work();
    } finally {
      running -= 1;
      waiting.shift()?.();
    }
  }

  async function persist(current: Index) {
    await fs.writeText(INDEX, JSON.stringify(current));
  }

  /** Loads the index for `scope`; a different/corrupt/missing index starts a clean directory. Call under the lock. */
  async function ensure(scope: string): Promise<Index> {
    if (index === null) index = parseIndex(await fs.readText(INDEX).catch(() => null));
    if (index === null || index.scope !== scope) {
      await fs.clear();
      index = { scope, seq: 0, entries: {} };
      absent.clear();
      failedUntil.clear();
      await persist(index);
    }
    return index;
  }

  async function currentScope(): Promise<string | null> {
    try {
      return await deps.scope();
    } catch {
      return null;
    }
  }

  async function evict(current: Index, needed: number) {
    const used = () => Object.values(current.entries).reduce((sum, entry) => sum + entry.bytes, 0);
    const oldestFirst = Object.entries(current.entries).sort((a, b) => a[1].usedAt - b[1].usedAt);
    for (const [key, entry] of oldestFirst) {
      if (used() + needed <= maxTotal) break;
      delete current.entries[key];
      await fs.remove(entry.file).catch(() => undefined);
    }
  }

  /** `null` = the row is gone, nothing was requested. */
  function download(code: number, signal: AbortSignal | undefined): Promise<ImageFetchOutcome | null> {
    return slot(async () => {
      if (signal?.aborted === true) return null;
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<ImageFetchOutcome>((resolve) => {
        timer = setTimeout(() => {
          controller.abort();
          resolve({ kind: "unavailable" });
        }, timeoutMs);
      });
      const request = (async (): Promise<ImageFetchOutcome> => {
        try {
          return await deps.fetchThumbnail(code, controller.signal);
        } catch {
          return { kind: "unavailable" };
        }
      })();
      try {
        return await Promise.race([request, timeout]);
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    });
  }

  async function fetchAndStore(code: number, version: string, scope: string, signal: AbortSignal | undefined): Promise<string | null> {
    const key = `${code}|${version}`;
    const outcome = await download(code, signal);
    if (outcome === null) return null;
    if (outcome.kind === "absent") {
      absent.add(key);
      return null;
    }
    if (outcome.kind === "unavailable" || outcome.bytes.length === 0 || outcome.bytes.length > maxImage || !looksLikeImage(outcome.bytes)) {
      failedUntil.set(key, now() + retryMs);
      return null;
    }
    const bytes = outcome.bytes;
    return exclusive(async () => {
      // The owner/dataset may have changed while the bytes were in flight: never write into another scope.
      if ((await currentScope()) !== scope) return null;
      const current = await ensure(scope);
      const previous = current.entries[String(code)];
      if (previous !== undefined) {
        delete current.entries[String(code)];
        await fs.remove(previous.file).catch(() => undefined);
      }
      await evict(current, bytes.length);
      current.seq += 1;
      const file = `p${code}-${current.seq}.img`;
      await fs.writeBytes(file, bytes);
      current.entries[String(code)] = { file, version, bytes: bytes.length, usedAt: now() };
      await persist(current);
      return fs.uri(file);
    });
  }

  return {
    async resolve(code, image, options) {
      try {
        const scope = await currentScope();
        if (scope === null) return null;
        const hit = await exclusive(async () => {
          const current = await ensure(scope);
          const entry = current.entries[String(code)];
          if (entry === undefined || entry.version !== image.version || !(await fs.exists(entry.file))) return null;
          entry.usedAt = now();
          return fs.uri(entry.file);
        });
        if (hit !== null) return hit;
        const key = `${code}|${image.version}`;
        if (!options.online || absent.has(key) || (failedUntil.get(key) ?? 0) > now()) return null;
        const pending = inFlight.get(key);
        if (pending !== undefined) return await pending;
        const started = fetchAndStore(code, image.version, scope, options.signal).finally(() => inFlight.delete(key));
        inFlight.set(key, started);
        return await started;
      } catch {
        return null;
      }
    },
    purge() {
      return exclusive(async () => {
        index = null;
        absent.clear();
        failedUntil.clear();
        await fs.clear().catch(() => undefined);
      });
    },
  };
}
