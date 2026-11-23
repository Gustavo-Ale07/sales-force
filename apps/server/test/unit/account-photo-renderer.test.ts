import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { isAccountPhotoError, renderAccountPhoto, sniffPhotoType } from '../../src/media/account-photo-renderer.js';

const solid = (width: number, height: number) => sharp({ create: { width, height, channels: 3, background: { r: 10, g: 120, b: 200 } } });

describe('sniffPhotoType', () => {
  it('recognises JPEG, PNG and WebP by magic bytes and nothing else', async () => {
    expect(sniffPhotoType(await solid(80, 80).jpeg().toBuffer())).toBe('image/jpeg');
    expect(sniffPhotoType(await solid(80, 80).png().toBuffer())).toBe('image/png');
    expect(sniffPhotoType(await solid(80, 80).webp().toBuffer())).toBe('image/webp');
    expect(sniffPhotoType(Buffer.from('GIF89a'))).toBeNull();
    expect(sniffPhotoType(Buffer.from('<svg/>'))).toBeNull();
    expect(sniffPhotoType(new Uint8Array(0))).toBeNull();
  });
});

describe('renderAccountPhoto', () => {
  it('produces a square WebP of at most 512 px from any aspect ratio', async () => {
    const out = await renderAccountPhoto(await solid(2000, 700).jpeg().toBuffer(), 'image/jpeg');
    const meta = await sharp(out.bytes).metadata();
    expect([meta.format, meta.width, meta.height, out.sizePx, out.contentType]).toEqual(['webp', 512, 512, 512, 'image/webp']);
  });

  it('reports typed errors for a mismatched declaration and a too small image', async () => {
    const png = await solid(200, 200).png().toBuffer();
    await expect(renderAccountPhoto(png, 'image/jpeg')).rejects.toSatisfy((e) => isAccountPhotoError(e) && e.code === 'content_mismatch');
    const tiny = await solid(20, 20).png().toBuffer();
    await expect(renderAccountPhoto(tiny, 'image/png')).rejects.toSatisfy((e) => isAccountPhotoError(e) && e.code === 'too_small');
  });
});
