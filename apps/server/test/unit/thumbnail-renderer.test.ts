import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { inspectImage } from '../../src/catalog/product-image.js';
import {
  SharpThumbnailRenderer,
  THUMBNAIL_MAX_BYTES,
  THUMBNAIL_MAX_INPUT_PIXELS,
  THUMBNAIL_MAX_SIDE,
  isThumbnailRenderError,
  thumbnailRenderConcurrencyProbe,
} from '../../src/media/thumbnail-renderer.js';
import { noisyRaw, realImage } from '../helpers/real-images.js';

const renderer = new SharpThumbnailRenderer();

async function meta(bytes: Uint8Array) {
  return sharp(Buffer.from(bytes)).metadata();
}

describe('SharpThumbnailRenderer (real sharp, in-test generated images)', () => {
  it.each(['png', 'jpeg', 'webp'] as const)('renders a %s of 800x400 as a WebP whose longest side is 256 and keeps the aspect ratio', async (format) => {
    const original = await realImage(format, 800, 400);
    const out = await renderer.render(original, `image/${format}` as 'image/png');
    expect(out.contentType).toBe('image/webp');
    const m = await meta(out.bytes);
    expect(m.format).toBe('webp');
    expect([m.width, m.height]).toEqual([256, 128]);
    expect([out.width, out.height]).toEqual([256, 128]);
    expect(inspectImage(out.bytes, THUMBNAIL_MAX_BYTES)).toMatchObject({ ok: true, contentType: 'image/webp' });
  });

  it('never enlarges a small image (fit inside, withoutEnlargement)', async () => {
    const out = await renderer.render(await realImage('png', 100, 60), 'image/png');
    const m = await meta(out.bytes);
    expect([m.width, m.height]).toEqual([100, 60]);
  });

  it('a large noisy original (over 1 MiB) gives a small thumbnail of at most 256 px; the original bytes are untouched', async () => {
    const original = await realImage('jpeg', 1800, 1400, { noisy: true });
    expect(original.length).toBeGreaterThan(1024 * 1024);
    const before = createHash('sha256').update(original).digest('hex');
    const out = await renderer.render(original, 'image/jpeg');
    const m = await meta(out.bytes);
    expect(Math.max(m.width ?? 0, m.height ?? 0)).toBe(THUMBNAIL_MAX_SIDE);
    expect(m.width! / m.height!).toBeCloseTo(1800 / 1400, 1);
    expect(out.bytes.length).toBeLessThanOrEqual(THUMBNAIL_MAX_BYTES);
    expect(out.bytes.length).toBeGreaterThan(0);
    expect(createHash('sha256').update(original).digest('hex')).toBe(before);
  });

  it('applies the EXIF orientation and strips the metadata', async () => {
    const original = await sharp(noisyRaw(300, 100, 3), { raw: { width: 300, height: 100, channels: 3 } })
      .jpeg({ quality: 80 })
      .withMetadata({ orientation: 6 })
      .toBuffer();
    expect((await sharp(original).metadata()).orientation).toBe(6);
    const out = await renderer.render(original, 'image/jpeg');
    const m = await meta(out.bytes);
    expect([m.width, m.height]).toEqual([85, 256]); // 300x100 turned upright is 100x300, scaled to 256 high
    expect(m.exif).toBeUndefined();
    expect(m.orientation).toBeUndefined();
  });

  it('keeps transparency', async () => {
    const original = await sharp({ create: { width: 300, height: 300, channels: 4, background: { r: 200, g: 20, b: 20, alpha: 0.3 } } })
      .png()
      .toBuffer();
    const out = await renderer.render(original, 'image/png');
    expect((await meta(out.bytes)).hasAlpha).toBe(true);
  });

  it('refuses an animated image (a catalog photo is never an animation)', async () => {
    const frames = Buffer.concat([noisyRaw(32, 32, 3, 1), noisyRaw(32, 32, 3, 2)]);
    const animated = await sharp(frames, { raw: { width: 32, height: 64, channels: 3, pageHeight: 32 } })
      .webp({ loop: 0, delay: [100, 100] })
      .toBuffer();
    expect((await sharp(animated, { animated: true }).metadata()).pages).toBe(2);
    const error = await renderer.render(animated, 'image/webp').catch((raised: unknown) => raised);
    expect(isThumbnailRenderError(error)).toBe(true);
    expect(error).toMatchObject({ code: 'animated' });
  });

  it('refuses bytes that are not a decodable image, without echoing native details', async () => {
    const error = await renderer.render(new Uint8Array(500).fill(7), 'image/png').catch((raised: unknown) => raised);
    expect(error).toMatchObject({ name: 'ThumbnailRenderError', code: 'decode_failed', message: 'The image could not be decoded.' });
  });

  it('refuses a truncated image (failOn error)', async () => {
    const original = await realImage('png', 400, 400, { noisy: true });
    const error = await renderer.render(original.slice(0, Math.floor(original.length / 2)), 'image/png').catch((raised: unknown) => raised);
    expect(error).toMatchObject({ name: 'ThumbnailRenderError', code: 'decode_failed' });
  });

  it('refuses an image above the pixel limit before decoding it', async () => {
    const huge = await sharp(Buffer.alloc(20000 * 3000), { raw: { width: 20000, height: 3000, channels: 1 } }).png().toBuffer();
    const error = await renderer.render(huge, 'image/png').catch((raised: unknown) => raised);
    expect(error).toMatchObject({ name: 'ThumbnailRenderError', code: 'too_many_pixels' });
  });

  it('the pixel ceiling is 32 megapixels: 40 MP is refused, a 24 MP photo is rendered', async () => {
    expect(THUMBNAIL_MAX_INPUT_PIXELS).toBe(32_000_000);
    const forty = await sharp(Buffer.alloc(8000 * 5000), { raw: { width: 8000, height: 5000, channels: 1 } }).png().toBuffer();
    expect(await renderer.render(forty, 'image/png').catch((raised: unknown) => raised)).toMatchObject({ code: 'too_many_pixels' });
    const twentyFour = await sharp(Buffer.alloc(6000 * 4000), { raw: { width: 6000, height: 4000, channels: 1 } }).png().toBuffer();
    expect((await renderer.render(twentyFour, 'image/png')).width).toBe(256);
  });

  it.each(['gif', 'tiff'] as const)('refuses a %s even though libvips can decode it (only jpeg, png and webp are rendered)', async (format) => {
    const original = await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 10, g: 120, b: 200 } } })
      .toFormat(format)
      .toBuffer();
    expect((await sharp(original).metadata()).format).toBe(format);
    const error = await renderer.render(original, 'image/png').catch((raised: unknown) => raised);
    expect(error).toMatchObject({ name: 'ThumbnailRenderError', code: 'unsupported_format' });
  });

  it('serializes renders: never more than one at a time, whatever the number of simultaneous callers', async () => {
    const originals = await Promise.all([1, 2, 3, 4, 5, 6].map((seed) => realImage('jpeg', 900, 600, { noisy: true, seed })));
    const results = await Promise.all([
      ...originals.map((original) => renderer.render(original, 'image/jpeg')),
      renderer.render(new Uint8Array(100).fill(3), 'image/png').catch((raised: unknown) => raised),
      ...originals.map((original) => new SharpThumbnailRenderer().render(original, 'image/jpeg')),
    ]);
    expect(results).toHaveLength(13);
    expect(isThumbnailRenderError(results[6])).toBe(true); // a failing render does not wedge the queue
    expect(thumbnailRenderConcurrencyProbe().maxActive).toBe(1);
  });

  it('refuses a rendition above its size bound (never stores an oversized thumbnail)', async () => {
    const tight = new SharpThumbnailRenderer({ maxBytes: 100 });
    const error = await tight.render(await realImage('jpeg', 600, 400, { noisy: true }), 'image/jpeg').catch((raised: unknown) => raised);
    expect(error).toMatchObject({ code: 'output_too_large' });
  });

  it('does not modify the input buffer', async () => {
    const original = await realImage('jpeg', 640, 480, { noisy: true });
    const copy = Uint8Array.from(original);
    await renderer.render(original, 'image/jpeg');
    expect(Buffer.compare(Buffer.from(original), Buffer.from(copy))).toBe(0);
  });
});
