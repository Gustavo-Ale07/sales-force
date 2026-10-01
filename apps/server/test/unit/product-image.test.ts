import { describe, expect, it } from 'vitest';
import {
  imageEtag,
  imagePaths,
  inspectImage,
  isValidImageVersion,
  matchesIfNoneMatch,
} from '../../src/catalog/product-image.js';
import { HTML_BYTES, SVG_BYTES, jpegBytes, pngBytes, textBytes, webpBytes } from '../helpers/image-fixtures.js';

const CAP = 1024;

describe('inspectImage', () => {
  it('identifies png, jpeg and webp by their bytes', () => {
    expect(inspectImage(pngBytes(), CAP)).toEqual({ ok: true, contentType: 'image/png' });
    expect(inspectImage(jpegBytes(), CAP)).toEqual({ ok: true, contentType: 'image/jpeg' });
    expect(inspectImage(webpBytes(), CAP)).toEqual({ ok: true, contentType: 'image/webp' });
  });

  it('rejects svg, html, text and unknown content as unsupported', () => {
    for (const bytes of [SVG_BYTES, HTML_BYTES, textBytes('GIF89a....................................')]) {
      expect(inspectImage(bytes, 4096)).toEqual({ ok: false, reason: 'unsupported_type' });
    }
  });

  it('rejects an svg that is dressed up with an image prefix only when the structure is not whole', () => {
    const polyglot = new Uint8Array([...pngBytes().slice(0, 8), ...SVG_BYTES]);
    expect(inspectImage(polyglot, 4096)).toEqual({ ok: false, reason: 'corrupt' });
  });

  it('rejects empty, oversize and truncated files', () => {
    expect(inspectImage(new Uint8Array(0), CAP)).toEqual({ ok: false, reason: 'empty' });
    expect(inspectImage(pngBytes(CAP + 1), CAP)).toEqual({ ok: false, reason: 'oversize' });
    expect(inspectImage(pngBytes().slice(0, 40), CAP)).toEqual({ ok: false, reason: 'corrupt' });
    expect(inspectImage(jpegBytes().slice(0, 40), CAP)).toEqual({ ok: false, reason: 'corrupt' });
    expect(inspectImage(webpBytes().slice(0, 40), CAP)).toEqual({ ok: false, reason: 'corrupt' });
    expect(inspectImage(pngBytes().slice(0, 12), CAP)).toEqual({ ok: false, reason: 'corrupt' });
  });
});

describe('versions, etags and paths', () => {
  it('accepts only header-safe opaque versions', () => {
    expect(isValidImageVersion('2026-01-01T00:00:00Z'.replace(/[T]/g, '-'))).toBe(true);
    for (const bad of ['', 'a b', 'a"b', 'a\r\nSet-Cookie: x', 'x'.repeat(129), 5, null, undefined]) {
      expect(isValidImageVersion(bad)).toBe(false);
    }
  });

  it('derives a stable, quoted etag per variant and version without echoing the version', () => {
    const thumb = imageEtag('thumb', 'v1');
    expect(thumb).toMatch(/^"[0-9a-f]{32}"$/);
    expect(imageEtag('thumb', 'v1')).toBe(thumb);
    expect(imageEtag('full', 'v1')).not.toBe(thumb);
    expect(imageEtag('thumb', 'v2')).not.toBe(thumb);
    expect(thumb).not.toContain('v1');
  });

  it('matches If-None-Match by list, weak prefix and wildcard', () => {
    const etag = imageEtag('thumb', 'v1');
    expect(matchesIfNoneMatch(undefined, etag)).toBe(false);
    expect(matchesIfNoneMatch(etag, etag)).toBe(true);
    expect(matchesIfNoneMatch(`"other", W/${etag}`, etag)).toBe(true);
    expect(matchesIfNoneMatch('*', etag)).toBe(true);
    expect(matchesIfNoneMatch('"other"', etag)).toBe(false);
  });

  it('builds relative API paths from the numeric code only', () => {
    expect(imagePaths('/api/v1', 7)).toEqual({
      thumbnailUrl: '/api/v1/products/7/image?variant=thumb',
      url: '/api/v1/products/7/image?variant=full',
    });
  });
});
