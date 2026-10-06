import { createHash } from 'node:crypto';
import { SankhyaGatewayError } from './errors.js';
import type { ReadScope } from './read-scope.js';

/**
 * Product photo transport contract (spike F-54, F-55). Sales Force-shaped only: no ERP table, column
 * or function name appears in this file. The Sankhya SQL lives in `real/mapping.ts` / `real/real-gateway.ts`.
 */

export interface ProductMediaSignature {
  readonly productCode: number;
  /** Size of the stored image in bytes (always > 0). */
  readonly byteLength: number;
  /**
   * Opaque lowercase hex digest for cheap change detection, computed LOCALLY from the byte length and a
   * few SAMPLED byte windows. RESIDUAL RISK: an edit that keeps the length and leaves every sampled
   * window identical is not detected; callers offer a forced re-verify (full download) for that case.
   */
  readonly fingerprint: string;
}

export interface ReadProductMediaSignaturesOptions {
  readonly scope?: ReadScope;
  /** Keyset cursor: only products with a code strictly greater than this are returned. Default 0. */
  readonly afterCode?: number;
  /** Page size, 1..`MAX_MEDIA_SIGNATURE_PAGE`. A larger value is refused (never silently clamped). */
  readonly limit: number;
  readonly signal?: AbortSignal;
}

export interface ReadProductMediaBytesOptions {
  readonly productCode: number;
  /** Length announced by the signature; the assembled bytes must match it exactly. */
  readonly expectedLength: number;
  /** Hard ceiling; `expectedLength` above it is refused WITHOUT downloading. */
  readonly maxBytes: number;
  readonly signal?: AbortSignal;
}

export interface SankhyaProductMediaPort {
  /**
   * Products (within `scope`, same filter as `readProducts`) that have a non-empty image, ascending by
   * product code, strictly after `afterCode`, at most `limit`. A page shorter than `limit` is the last.
   * Never transfers the image itself.
   */
  readProductMediaSignatures(options: ReadProductMediaSignaturesOptions): Promise<readonly ProductMediaSignature[]>;
  /**
   * The complete image bytes of one product. Resolves only with exactly `expectedLength` bytes; any
   * deviation (the image changed while reading, short chunk, bad data) rejects with a classified
   * `SankhyaGatewayError` (a changed-during-read image is `temporary`: retry later).
   */
  readProductMediaBytes(options: ReadProductMediaBytesOptions): Promise<Uint8Array>;
}

export const MAX_MEDIA_SIGNATURE_PAGE = 200;
/** Largest byte window the SQL `RAW` type can return in one value (F-54). */
export const MEDIA_CHUNK_BYTES = 2000;
/** Width of each sampled window used by the fingerprint. */
export const MEDIA_SAMPLE_BYTES = 32;

/** Fractions (percent of the length) where the middle windows start; the first starts at 1, the last ends at the end. */
export const MEDIA_SAMPLE_PERCENTS: readonly number[] = [25, 50, 75];

/** 1-based offsets of the sampled windows for an image of `length` bytes (`length` >= 1). Always within 1..length. */
export function mediaSampleOffsets(length: number): number[] {
  if (!Number.isSafeInteger(length) || length < 1) throw new RangeError('length must be a positive integer');
  return [
    1,
    ...MEDIA_SAMPLE_PERCENTS.map((percent) => Math.max(1, Math.floor((length * percent) / 100))),
    Math.max(1, length - (MEDIA_SAMPLE_BYTES - 1)),
  ];
}

/** Number of bytes a sampled window starting at 1-based `offset` holds. */
export function mediaSampleWidth(length: number, offset: number): number {
  return Math.min(MEDIA_SAMPLE_BYTES, length - offset + 1);
}

/** sha256 over the decimal length and the lowercase hex of each sampled window. */
export function mediaFingerprint(length: number, windowsHex: readonly string[]): string {
  const hash = createHash('sha256');
  hash.update(String(length));
  for (const window of windowsHex) hash.update(`|${window.toLowerCase()}`);
  return hash.digest('hex');
}

/** Fingerprint of in-memory bytes, exactly as the real adapter derives it from the sampled windows. */
export function mediaFingerprintOfBytes(bytes: Uint8Array): string {
  const windows = mediaSampleOffsets(bytes.length).map((offset) =>
    toHex(bytes.subarray(offset - 1, offset - 1 + mediaSampleWidth(bytes.length, offset))),
  );
  return mediaFingerprint(bytes.length, windows);
}

export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

export function assertSignaturesOptions(options: ReadProductMediaSignaturesOptions): number {
  const { limit } = options;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_MEDIA_SIGNATURE_PAGE) {
    throw new RangeError(`limit must be an integer between 1 and ${MAX_MEDIA_SIGNATURE_PAGE}`);
  }
  const after = options.afterCode ?? 0;
  if (!Number.isSafeInteger(after) || after < 0) throw new RangeError('afterCode must be a non-negative integer');
  return after;
}

/** Validates the bytes request before any I/O. Oversize is a data condition, not a programming error. */
export function assertBytesOptions(options: ReadProductMediaBytesOptions): void {
  const { productCode, expectedLength, maxBytes } = options;
  if (!Number.isSafeInteger(productCode) || productCode < 1) throw new RangeError('productCode must be a positive integer');
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new RangeError('maxBytes must be a positive integer');
  if (!Number.isSafeInteger(expectedLength) || expectedLength < 1) throw new RangeError('expectedLength must be a positive integer');
  if (expectedLength > maxBytes) {
    throw new SankhyaGatewayError('permanent', {
      code: 'media_too_large',
      message: `Product ${productCode}: the image (${expectedLength} bytes) exceeds the allowed maximum (${maxBytes} bytes); not downloaded.`,
    });
  }
}

export function mediaChangedDuringRead(productCode: number, detail: string): SankhyaGatewayError {
  return new SankhyaGatewayError('temporary', {
    code: 'media_changed_during_read',
    message: `Product ${productCode}: the image changed or was incomplete while reading (${detail}). Nothing was kept; retry later.`,
  });
}
