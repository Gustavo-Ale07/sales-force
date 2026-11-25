import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { isAccountPhotoError, renderAccountPhoto, sniffPhotoType, toErpJpeg } from '../../src/media/account-photo-renderer.js';

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

  it('flattens a transparent PNG on white (never black)', async () => {
    const clear = await sharp({ create: { width: 300, height: 300, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    const out = await renderAccountPhoto(clear, 'image/png');
    const stats = await sharp(out.bytes).stats();
    expect(stats.channels.slice(0, 3).every((c) => c.mean > 250)).toBe(true);
  });

  it('the ERP copy is real JPEG bytes (FFD8FF header, never base64 text), white where the picture was transparent, colors kept', async () => {
    const clear = await sharp({ create: { width: 300, height: 300, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    const blank = await toErpJpeg((await renderAccountPhoto(clear, 'image/png')).bytes);
    expect([blank[0], blank[1], blank[2]]).toEqual([0xff, 0xd8, 0xff]);
    expect((await sharp(blank).stats()).channels.slice(0, 3).every((c) => c.mean > 250)).toBe(true);
    const photo = await toErpJpeg((await renderAccountPhoto(await solid(300, 300).png().toBuffer(), 'image/png')).bytes);
    const mean = (await sharp(photo).stats()).channels.map((c) => c.mean);
    expect(mean[2]! > mean[0]! + 100).toBe(true); // still blue, not darkened
  });

  it('reports typed errors for a mismatched declaration and a too small image', async () => {
    const png = await solid(200, 200).png().toBuffer();
    await expect(renderAccountPhoto(png, 'image/jpeg')).rejects.toSatisfy((e) => isAccountPhotoError(e) && e.code === 'content_mismatch');
    const tiny = await solid(20, 20).png().toBuffer();
    await expect(renderAccountPhoto(tiny, 'image/png')).rejects.toSatisfy((e) => isAccountPhotoError(e) && e.code === 'too_small');
  });

  it('bounds the render queue: more than the allowed waiters are refused at once (busy), the others complete', async () => {
    const jpeg = await solid(1200, 1200).jpeg().toBuffer();
    const limits = { maxQueued: 1, timeoutMs: 30_000 };
    // One running + one waiting are accepted; the third is refused.
    const results = await Promise.allSettled([
      renderAccountPhoto(jpeg, 'image/jpeg', undefined, limits),
      renderAccountPhoto(jpeg, 'image/jpeg', undefined, limits),
      renderAccountPhoto(jpeg, 'image/jpeg', undefined, limits),
    ]);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled', 'rejected']);
    const refused = results[2] as PromiseRejectedResult;
    expect(isAccountPhotoError(refused.reason) && refused.reason.code).toBe('busy');
    // The slots are released afterwards.
    await expect(renderAccountPhoto(jpeg, 'image/jpeg', undefined, limits)).resolves.toBeDefined();
  });

  it('gives up on a render that exceeds the timeout (timeout) and keeps serving afterwards', async () => {
    const jpeg = await solid(3000, 3000).jpeg().toBuffer();
    await expect(renderAccountPhoto(jpeg, 'image/jpeg', undefined, { maxQueued: 8, timeoutMs: 1 })).rejects.toSatisfy(
      (e) => isAccountPhotoError(e) && e.code === 'timeout',
    );
    const small = await solid(200, 200).png().toBuffer();
    await expect(renderAccountPhoto(small, 'image/png')).resolves.toBeDefined();
  });
});
