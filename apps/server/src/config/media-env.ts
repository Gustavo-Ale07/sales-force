import { isAbsolute } from 'node:path';
import { z } from 'zod';
import { integerField } from './env.js';

/**
 * Product photo settings shared by both processes (the worker fills the object store, the API reads
 * it). No credential is involved: the interim adapter is a mounted directory (see `object-store.ts`).
 */

/** Largest image the pipeline stores or serves as the full rendition (default 5 MiB). */
export const DEFAULT_PRODUCT_MEDIA_MAX_BYTES = 5 * 1024 * 1024;
/**
 * Largest GENERATED thumbnail the API reads and serves (default 256 KiB, equal to the worker's rendition bound). It is
 * no longer a cut on originals: every stored photo has its own rendition; a recorded thumbnail above this is a defect (503).
 */
export const DEFAULT_PRODUCT_MEDIA_THUMB_MAX_BYTES = 256 * 1024;
/**
 * Smallest accepted `PRODUCT_MEDIA_THUMB_MAX_BYTES`: the renderer's own output bound (`THUMBNAIL_MAX_BYTES` derives from
 * it). A lower value would make the API refuse (503) thumbnails the worker is allowed to store.
 */
export const MIN_PRODUCT_MEDIA_THUMB_MAX_BYTES = 256 * 1024;

export const mediaDirField = z.string().optional();

export const mediaMaxBytesField = integerField({ min: 1024, max: 20 * 1024 * 1024 }, DEFAULT_PRODUCT_MEDIA_MAX_BYTES);

/** The directory must be an absolute path: a relative one would follow the working directory of the process. */
export function mediaDirProblems(dir: string | undefined): string[] {
  if (dir === undefined) return [];
  return isAbsolute(dir) ? [] : ['PRODUCT_MEDIA_DIR: must be an absolute path to a persistent directory.'];
}
