import { META_KEYS, getMeta, readCacheDataset, readExpectedDataset, sameDataset, type SqlDatabase } from "@salesforce/mobile-db";
import type { ApiClient } from "../data/api";
import type { ImageFileSystem } from "./image-fs";
import { createProductImageStore, type ImageFetchOutcome, type ProductImageStore } from "./image-store";

/**
 * The authenticated thumbnail request. It goes through the generated client (same session as every other call; the
 * relative `thumbnailUrl` of the metadata is never composed or fetched by hand). 404 = no image; every other failure
 * (503, network, expired session) is transient for a thumbnail and never interrupts the catalog.
 */
export function createThumbnailFetcher(api: ApiClient): (code: number, signal: AbortSignal) => Promise<ImageFetchOutcome> {
  return async (code, signal) => {
    try {
      const { data, response } = await api.GET("/products/{code}/image", {
        params: { path: { code }, query: { variant: "thumb" } },
        headers: { Accept: "image/png, image/jpeg, image/webp" },
        parseAs: "arrayBuffer",
        signal,
      });
      if (response.status === 404) return { kind: "absent" };
      if (!response.ok || !(data instanceof ArrayBuffer)) return { kind: "unavailable" };
      return { kind: "ok", bytes: new Uint8Array(data) };
    } catch {
      return { kind: "unavailable" };
    }
  };
}

/**
 * Same gate as the reference cache (`isCacheReady`): thumbnails are served only for the account that filled the cache
 * and for the dataset the server last confirmed. Anything else = no scope = nothing shown or stored, and a changed
 * scope purges the directory inside the store.
 */
export function createImageScope(db: SqlDatabase, ownerAccountId: string): () => Promise<string | null> {
  return async () => {
    if ((await getMeta(db, META_KEYS.cacheOwner)) !== ownerAccountId) return null;
    const [cached, expected] = await Promise.all([readCacheDataset(db), readExpectedDataset(db)]);
    if (!sameDataset(cached, expected) || cached === null) return null;
    return `${ownerAccountId}|${cached.environment}|${cached.datasetId}`;
  };
}

export function createAccountProductImages(deps: { db: SqlDatabase; api: ApiClient; fs: ImageFileSystem; ownerAccountId: string; now: () => number }): ProductImageStore {
  return createProductImageStore({
    fs: deps.fs,
    fetchThumbnail: createThumbnailFetcher(deps.api),
    scope: createImageScope(deps.db, deps.ownerAccountId),
    now: deps.now,
    ownerAccountId: deps.ownerAccountId,
  });
}
