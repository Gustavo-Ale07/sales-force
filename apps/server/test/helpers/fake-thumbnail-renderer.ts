import { createHash } from 'node:crypto';
import { ThumbnailRenderError, type RenderedThumbnail, type ThumbnailRenderer } from '../../src/media/thumbnail-renderer.js';
import type { ImageContentType } from '../../src/catalog/product-image.js';

/**
 * Deterministic stand-in for sharp: the "thumbnail" is a structurally valid WebP-shaped buffer whose payload is the
 * sha256 of the original, so different originals give different thumbnails and the same original the same one.
 * Records every call; can be told to fail (a `ThumbnailRenderError`, or any error).
 */
export class FakeThumbnailRenderer implements ThumbnailRenderer {
  /** Original length per call, in order. */
  readonly calls: number[] = [];
  /** A failure to raise instead of rendering; per-call predicate wins when set. */
  failWith: Error | null = null;
  failWhen: ((original: Uint8Array) => Error | null) | null = null;
  /** Overrides the rendition bytes (to test the service's policing of the port). */
  outputOverride: Uint8Array | null = null;

  async render(original: Uint8Array, _contentType: ImageContentType): Promise<RenderedThumbnail> {
    this.calls.push(original.length);
    const failure = this.failWhen?.(original) ?? this.failWith;
    if (failure !== null) throw failure;
    if (this.outputOverride !== null) return { bytes: this.outputOverride, contentType: 'image/webp', width: 1, height: 1 };
    const digest = createHash('sha256').update(original).digest();
    const bytes = new Uint8Array(12 + 32 + 20);
    bytes.set([...'RIFF'].map((c) => c.charCodeAt(0)), 0);
    new DataView(bytes.buffer).setUint32(4, bytes.length - 8, true);
    bytes.set([...'WEBP'].map((c) => c.charCodeAt(0)), 8);
    bytes.set(digest, 12);
    return { bytes, contentType: 'image/webp', width: 256, height: 171 };
  }
}

export const renderFailure = (code: ConstructorParameters<typeof ThumbnailRenderError>[0] = 'decode_failed'): ThumbnailRenderError =>
  new ThumbnailRenderError(code, 'test failure');
