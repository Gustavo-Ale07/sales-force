import { createHash, timingSafeEqual } from 'node:crypto';
import type { Database } from '@salesforce/db';
import type { ProductImageVariant } from '@salesforce/contracts';
import type { ProductImageSource, SourceImage } from '../catalog/product-image.js';
import type { ObjectStore } from './object-store.js';
import { loadServable, loadVersions, mediaVersion } from './product-media.repository.js';

export interface StoredProductImageSettings {
  /** Largest generated thumbnail the API reads and serves (a recorded size above it is a defect, answered as one). */
  readonly thumbMaxBytes: number;
  /** Upper bound for any stored original read (the configured PRODUCT_MEDIA_MAX_BYTES). */
  readonly maxBytes?: number;
}

function matchesHash(bytes: Uint8Array, hex: string): boolean {
  const actual = createHash('sha256').update(bytes).digest();
  const expected = Buffer.from(hex, 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/**
 * API side of the photo pipeline: serves what the worker stored (`product_media` + object store).
 * It reads only PostgreSQL and the object store: no ERP call, no ERP credential (STACK-2).
 *
 * - `versions` is one batched query. The version is the original content hash while no thumbnail exists and a hash of
 *   original + thumbnail afterwards (`mediaVersion`): it changes when EITHER rendition changes.
 * - `variant=thumb` is served ONLY from the generated thumbnail object (its own type, size, hash). A product whose
 *   thumbnail is not generated yet has none: `null` (404). The original is never served as a thumbnail.
 * - `getImage` re-hashes the object against the recorded hash; a missing or altered object is an exception
 *   (the API answers 503 and logs), never a wrong image.
 * - The product code is a validated number; the object keys come only from the database row.
 */
export class StoredProductImageSource implements ProductImageSource {
  constructor(
    private readonly db: Database,
    private readonly store: ObjectStore,
    private readonly settings: StoredProductImageSettings,
  ) {}

  async versions(productCodes: readonly number[], signal: AbortSignal): Promise<ReadonlyMap<number, string>> {
    signal.throwIfAborted();
    return loadVersions(this.db, productCodes);
  }

  async getImage(productCode: number, variant: ProductImageVariant, signal: AbortSignal): Promise<SourceImage | null> {
    signal.throwIfAborted();
    const media = await loadServable(this.db, productCode);
    if (media === null) return null;
    const version = mediaVersion(media.contentHash, media.thumbnail?.contentHash ?? null);

    if (variant === 'thumb') {
      const thumbnail = media.thumbnail;
      if (thumbnail === null) return null;
      if (thumbnail.byteLength > this.settings.thumbMaxBytes) throw new Error(`Recorded product thumbnail exceeds the maximum size (product ${productCode}).`);
      // The recorded size is checked on disk before the object is loaded.
      const bytes = await this.store.get(thumbnail.storageKey, { expectedBytes: thumbnail.byteLength, maxBytes: this.settings.thumbMaxBytes });
      signal.throwIfAborted();
      if (bytes === null) throw new Error(`Stored product thumbnail object is missing (product ${productCode}).`);
      if (!matchesHash(bytes, thumbnail.contentHash)) throw new Error(`Stored product thumbnail does not match its recorded hash (product ${productCode}).`);
      return { bytes, version };
    }

    // The recorded size is checked on disk before the object is loaded: a swapped or inflated file is never read into memory.
    const bytes = await this.store.get(media.storageKey, {
      expectedBytes: media.byteLength,
      ...(this.settings.maxBytes === undefined ? {} : { maxBytes: this.settings.maxBytes }),
    });
    signal.throwIfAborted();
    if (bytes === null) throw new Error(`Stored product image object is missing (product ${productCode}).`);
    if (!matchesHash(bytes, media.contentHash)) throw new Error(`Stored product image object does not match its recorded hash (product ${productCode}).`);
    return { bytes, version };
  }
}
