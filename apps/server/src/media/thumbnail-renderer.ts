import sharp from 'sharp';
import type { ImageContentType } from '../catalog/product-image.js';
import { MIN_PRODUCT_MEDIA_THUMB_MAX_BYTES } from '../config/media-env.js';

/**
 * Thumbnail rendition port. The worker renders ONE thumbnail per stored original; sharp is isolated behind this
 * interface so tests can inject a failing or fake renderer and no other module imports the native library.
 */
export interface RenderedThumbnail {
  readonly bytes: Uint8Array;
  readonly contentType: 'image/webp';
  readonly width: number;
  readonly height: number;
}

export interface ThumbnailRenderer {
  /** Never mutates `original`. Rejects with a `ThumbnailRenderError` (code only, never bytes or paths). */
  render(original: Uint8Array, contentType: ImageContentType): Promise<RenderedThumbnail>;
}

export type ThumbnailRenderErrorCode = 'decode_failed' | 'too_many_pixels' | 'animated' | 'unsupported_format' | 'empty_output' | 'output_too_large';

export class ThumbnailRenderError extends Error {
  readonly code: ThumbnailRenderErrorCode;

  constructor(code: ThumbnailRenderErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ThumbnailRenderError';
    this.code = code;
  }
}

export function isThumbnailRenderError(value: unknown): value is ThumbnailRenderError {
  return value instanceof ThumbnailRenderError;
}

/**
 * Rendition parameters. The catalog shows photos in 48 px / 40 px boxes at up to 3x density, so a 256 px longest
 * side is sharp on every screen; WebP quality 80 is visually clean at that size and typically yields 5-20 KiB
 * (an original of up to ~4 MB becomes a few KiB). Alpha is kept (PNG logos): nothing is flattened.
 */
export const THUMBNAIL_MAX_SIDE = 256;
export const THUMBNAIL_WEBP_QUALITY = 80;
/** Sanity bound on one rendition: a larger output is a defect, not a thumbnail. */
export const THUMBNAIL_MAX_BYTES = MIN_PRODUCT_MEDIA_THUMB_MAX_BYTES;
/**
 * Decoded-pixel ceiling (decompression-bomb guard): 32 megapixels. The Sandbox catalog's largest file is 3.9 MB
 * (a camera photo of 12-24 MP decodes well below this); a bigger raster is refused as `too_many_pixels`.
 */
export const THUMBNAIL_MAX_INPUT_PIXELS = 32_000_000;
/** Only the formats the pipeline stores are decoded: libvips supports many more (GIF, TIFF, SVG...), none is accepted. */
const RENDERABLE_FORMATS: ReadonlySet<string> = new Set(['jpeg', 'png', 'webp']);

/**
 * Renders run one at a time in the whole process, whatever the download concurrency: memory is bounded by ONE
 * decoded raster (<= THUMBNAIL_MAX_INPUT_PIXELS) instead of one per concurrent download.
 */
let renderTail: Promise<void> = Promise.resolve();
const probe = { active: 0, maxActive: 0 };
function runExclusive<T>(task: () => Promise<T>): Promise<T> {
  const run = renderTail.then(async () => {
    probe.active += 1;
    probe.maxActive = Math.max(probe.maxActive, probe.active);
    try {
      return await task();
    } finally {
      probe.active -= 1;
    }
  });
  renderTail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Test probe: the largest number of renders that ever ran at the same time in this process (must stay 1). */
export function thumbnailRenderConcurrencyProbe(): { readonly maxActive: number } {
  return probe;
}

let configured = false;
function configureSharpOnce(): void {
  if (configured) return;
  configured = true;
  // Bounded native resources: no process-wide cache, one libvips worker thread per operation.
  sharp.cache(false);
  sharp.concurrency(1);
}

export class SharpThumbnailRenderer implements ThumbnailRenderer {
  constructor(private readonly options: { readonly maxBytes?: number } = {}) {
    configureSharpOnce();
  }

  render(original: Uint8Array, _contentType: ImageContentType): Promise<RenderedThumbnail> {
    return runExclusive(() => this.#render(original));
  }

  async #render(original: Uint8Array): Promise<RenderedThumbnail> {
    const maxBytes = this.options.maxBytes ?? THUMBNAIL_MAX_BYTES;
    try {
      // `failOn: 'error'` rejects damaged files; `animated: false` decodes only the first frame, but an animated
      // input is refused (a catalog photo is never an animation) so the rule is explicit and tested.
      const input = sharp(Buffer.from(original.buffer, original.byteOffset, original.byteLength), {
        failOn: 'error',
        limitInputPixels: THUMBNAIL_MAX_INPUT_PIXELS,
        animated: false,
      });
      const meta = await input.metadata();
      if (meta.format === undefined || !RENDERABLE_FORMATS.has(meta.format)) {
        throw new ThumbnailRenderError('unsupported_format', 'The image format is not rendered.');
      }
      if ((meta.pages ?? 1) > 1) throw new ThumbnailRenderError('animated', 'Animated images are not rendered.');
      // `.rotate()` applies the EXIF orientation; metadata is NOT carried over (sharp strips it by default).
      const { data, info } = await input
        .rotate()
        .resize({ width: THUMBNAIL_MAX_SIDE, height: THUMBNAIL_MAX_SIDE, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: THUMBNAIL_WEBP_QUALITY })
        .toBuffer({ resolveWithObject: true });
      if (data.length === 0) throw new ThumbnailRenderError('empty_output', 'The rendition is empty.');
      if (data.length > maxBytes) throw new ThumbnailRenderError('output_too_large', 'The rendition exceeds the size bound.');
      return { bytes: new Uint8Array(data.buffer, data.byteOffset, data.byteLength), contentType: 'image/webp', width: info.width, height: info.height };
    } catch (error) {
      if (isThumbnailRenderError(error)) throw error;
      const message = error instanceof Error ? error.message : '';
      // The native message is classified, never forwarded (it may echo parser detail).
      if (/pixel limit|exceeds pixel/i.test(message)) throw new ThumbnailRenderError('too_many_pixels', 'The image has too many pixels.', { cause: error });
      throw new ThumbnailRenderError('decode_failed', 'The image could not be decoded.', { cause: error });
    }
  }
}
