import type { ImageFileSystem } from "../images/image-fs";
import { looksLikeImage, type ImageFetchOutcome } from "../images/image-store";

export interface ProfilePhotoStore {
  /**
   * A `file://` uri of the account's photo at `version` (the cache key; the photo is fetched with the session, never from a bare
   * uri). Offline or on a transient failure the stored photo of the same account is shown, whatever its version. `null` = initials.
   */
  resolve(accountId: string, version: string, options: { readonly online: boolean; readonly signal?: AbortSignal }): Promise<string | null>;
  /** Sign-out / removal: deletes the stored photo. */
  purge(): Promise<void>;
}

export const MAX_PROFILE_PHOTO_BYTES = 1024 * 1024;
const META = "meta.json";

interface Meta {
  readonly owner: string;
  readonly version: string;
  readonly file: string;
}

function parseMeta(text: string | null): Meta | null {
  if (text === null) return null;
  try {
    const value = JSON.parse(text) as Partial<Meta>;
    return typeof value.owner === "string" && typeof value.version === "string" && typeof value.file === "string" ? (value as Meta) : null;
  } catch {
    return null;
  }
}

/** One authenticated, versioned photo file in app-private storage. Operations are serialized. */
export function createProfilePhotoStore(deps: { readonly fs: ImageFileSystem; readonly fetchPhoto: (signal: AbortSignal) => Promise<ImageFetchOutcome> }): ProfilePhotoStore {
  const { fs } = deps;
  let lock: Promise<unknown> = Promise.resolve();
  const exclusive = <T>(work: () => Promise<T>): Promise<T> => {
    const next = lock.then(work, work);
    lock = next.catch(() => undefined);
    return next;
  };
  let seq = 0;
  const inFlight = new Map<string, Promise<string | null>>();

  const readMeta = async (): Promise<Meta | null> => parseMeta(await fs.readText(META).catch(() => null));
  const stored = async (meta: Meta | null, accountId: string): Promise<string | null> =>
    meta !== null && meta.owner === accountId && (await fs.exists(meta.file)) ? fs.uri(meta.file) : null;

  async function download(accountId: string, version: string, signal: AbortSignal | undefined): Promise<string | null> {
    const controller = new AbortController();
    signal?.addEventListener("abort", () => controller.abort());
    let outcome: ImageFetchOutcome;
    try {
      outcome = await deps.fetchPhoto(controller.signal);
    } catch {
      outcome = { kind: "unavailable" };
    }
    return exclusive(async () => {
      const previous = await readMeta();
      if (outcome.kind === "absent") {
        await clearAll();
        return null;
      }
      if (outcome.kind !== "ok" || outcome.bytes.length === 0 || outcome.bytes.length > MAX_PROFILE_PHOTO_BYTES || !looksLikeImage(outcome.bytes)) return stored(previous, accountId);
      seq += 1;
      const file = `photo-${Date.now().toString(36)}-${seq}.img`;
      await fs.writeBytes(file, outcome.bytes);
      await fs.writeText(META, JSON.stringify({ owner: accountId, version, file } satisfies Meta));
      if (previous !== null && previous.file !== file) await fs.remove(previous.file).catch(() => undefined);
      return fs.uri(file);
    });
  }

  async function clearAll(): Promise<void> {
    await fs.clear().catch(() => undefined);
  }

  return {
    async resolve(accountId, version, options) {
      try {
        const meta = await exclusive(readMeta);
        if (meta !== null && meta.owner !== accountId) await exclusive(clearAll);
        const current = meta !== null && meta.owner === accountId ? meta : null;
        if (current !== null && current.version === version) {
          const hit = await exclusive(() => stored(current, accountId));
          if (hit !== null) return hit;
        }
        if (!options.online) return await exclusive(() => stored(current, accountId));
        const key = `${accountId}|${version}`;
        const pending = inFlight.get(key);
        if (pending !== undefined) return await pending;
        const started = download(accountId, version, options.signal).finally(() => inFlight.delete(key));
        inFlight.set(key, started);
        return await started;
      } catch {
        return null;
      }
    },
    purge: () => exclusive(clearAll),
  };
}
