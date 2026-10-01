import { createHash } from 'node:crypto';
import { MAX_PRODUCT_IMAGE_VERSION_LENGTH, type ProductImageVariant } from '@salesforce/contracts';

/**
 * Product image port. Source-agnostic on purpose: where the photos live (object storage, a mirror table,
 * a file share) is not decided, and no ERP table or field is assumed here. An adapter implements this
 * interface; the API never learns the origin. The API process holds no ERP credential (STACK-2), so an
 * adapter reads a store the worker or an operator fills, never the ERP directly.
 *
 * Contract for adapters:
 * - `versions` is a cheap, batched existence+version lookup (one call per catalog page). It returns an entry only
 *   for products that have an image. The `version` is opaque and MUST change when the image bytes change.
 * - `getImage` returns the bytes of the requested variant or `null` when there is none. Thumbnail generation is
 *   the adapter's job (a pre-generated rendition, or a resizer it brings); the API neither resizes nor adds an
 *   image library. An adapter with no thumbnail returns `null` for `thumb`.
 * - A failure (unreachable, timeout, bad response) is an exception: the API maps it to 503 and logs the cause.
 *   The adapter's `contentType` is advisory only; the API trusts the bytes (magic-byte check), never the label.
 * - Product codes are numbers already validated by the API; an adapter never receives a client path or URL.
 */
export interface SourceImage {
  readonly bytes: Uint8Array;
  /** Advisory only; ignored by the API. */
  readonly contentType?: string;
  readonly version: string;
}

export interface ProductImageSource {
  versions(productCodes: readonly number[], signal: AbortSignal): Promise<ReadonlyMap<number, string>>;
  getImage(productCode: number, variant: ProductImageVariant, signal: AbortSignal): Promise<SourceImage | null>;
}

/** Default source: no product has an image (the catalog works without photos). */
export class NoImageSource implements ProductImageSource {
  versions(): Promise<ReadonlyMap<number, string>> {
    return Promise.resolve(new Map());
  }
  getImage(): Promise<SourceImage | null> {
    return Promise.resolve(null);
  }
}

export interface ProductImageSettings {
  /** Upper bound for each call to the source. */
  readonly sourceTimeoutMs: number;
  /** `Cache-Control: private, max-age` (the client revalidates through the ETag afterwards). */
  readonly maxAgeSeconds: number;
  readonly maxBytes: Readonly<Record<ProductImageVariant, number>>;
}

export const DEFAULT_PRODUCT_IMAGE_SETTINGS: ProductImageSettings = {
  sourceTimeoutMs: 3_000,
  maxAgeSeconds: 3_600,
  maxBytes: { thumb: 256 * 1024, full: 5 * 1024 * 1024 },
};

export type ImageContentType = 'image/png' | 'image/jpeg' | 'image/webp';

export type ImageRejection = 'empty' | 'oversize' | 'unsupported_type' | 'corrupt';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_IEND = [0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82];
const JPEG_SOI = [0xff, 0xd8, 0xff];
const MIN_IMAGE_BYTES = 32;

function startsWith(bytes: Uint8Array, expected: readonly number[], offset = 0): boolean {
  return expected.every((value, index) => bytes[offset + index] === value);
}

const ascii = (text: string): number[] => [...text].map((char) => char.charCodeAt(0));

/**
 * Identifies the image by its bytes (png, jpeg, webp only) and checks it is structurally whole: PNG ends with the
 * IEND chunk, JPEG ends with the EOI marker, WebP declares a RIFF size that matches the buffer. This is not a
 * decoder: it rejects SVG/HTML/anything else and truncated files, it does not prove the pixels decode.
 */
export function inspectImage(
  bytes: Uint8Array,
  maxBytes: number,
): { ok: true; contentType: ImageContentType } | { ok: false; reason: ImageRejection } {
  if (bytes.length === 0) return { ok: false, reason: 'empty' };
  if (bytes.length > maxBytes) return { ok: false, reason: 'oversize' };
  const isPng = startsWith(bytes, PNG_SIGNATURE);
  const isJpeg = startsWith(bytes, JPEG_SOI);
  const isWebp = startsWith(bytes, ascii('RIFF')) && startsWith(bytes, ascii('WEBP'), 8);
  if (!isPng && !isJpeg && !isWebp) return { ok: false, reason: 'unsupported_type' };
  if (bytes.length < MIN_IMAGE_BYTES) return { ok: false, reason: 'corrupt' };
  if (isPng) {
    return startsWith(bytes, PNG_IEND, bytes.length - PNG_IEND.length)
      ? { ok: true, contentType: 'image/png' }
      : { ok: false, reason: 'corrupt' };
  }
  if (isJpeg) {
    return bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9
      ? { ok: true, contentType: 'image/jpeg' }
      : { ok: false, reason: 'corrupt' };
  }
  const declared = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true);
  return declared + 8 === bytes.length ? { ok: true, contentType: 'image/webp' } : { ok: false, reason: 'corrupt' };
}

const VERSION_PATTERN = /^[A-Za-z0-9._:-]+$/;

/** A source version is an opaque token; anything else (header-unsafe, empty, huge) is a source defect. */
export function isValidImageVersion(version: unknown): version is string {
  return (
    typeof version === 'string' &&
    version.length > 0 &&
    version.length <= MAX_PRODUCT_IMAGE_VERSION_LENGTH &&
    VERSION_PATTERN.test(version)
  );
}

/** Strong ETag of one rendition: a hash, so the source's version string is never echoed into a header. */
export function imageEtag(variant: ProductImageVariant, version: string): string {
  return `"${createHash('sha256').update(`${variant}|${version}`).digest('hex').slice(0, 32)}"`;
}

/** Does an `If-None-Match` header value match the ETag (weak comparison, `*` and lists included)? */
export function matchesIfNoneMatch(header: string | undefined, etag: string): boolean {
  if (header === undefined) return false;
  return header
    .split(',')
    .map((entry) => entry.trim().replace(/^W\//, ''))
    .some((entry) => entry === '*' || entry === etag);
}

/** Relative API paths of a product's image renditions (built by the server, never from client input). */
export function imagePaths(apiBasePath: string, code: number): { thumbnailUrl: string; url: string } {
  const base = `${apiBasePath}/products/${code}/image`;
  return { thumbnailUrl: `${base}?variant=thumb`, url: `${base}?variant=full` };
}
