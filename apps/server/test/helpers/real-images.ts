import sharp from 'sharp';

/** Deterministic pseudo-random bytes (xorshift): incompressible-looking pixel noise without Math.random. */
export function noisyRaw(width: number, height: number, channels: number, seed = 1): Buffer {
  const out = Buffer.alloc(width * height * channels);
  let state = (seed * 2654435761) >>> 0 || 1;
  for (let i = 0; i < out.length; i += 1) {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    out[i] = state & 0xff;
  }
  return out;
}

/** A real, decodable image generated in the test (never a stored fixture). `noisy` makes it large and hard to compress. */
export async function realImage(
  format: 'png' | 'jpeg' | 'webp',
  width: number,
  height: number,
  options: { noisy?: boolean; seed?: number } = {},
): Promise<Uint8Array> {
  const pipeline =
    options.noisy === true
      ? sharp(noisyRaw(width, height, 3, options.seed ?? 1), { raw: { width, height, channels: 3 } })
      : sharp({ create: { width, height, channels: 3, background: { r: 30 + (options.seed ?? 0), g: 120, b: 200 } } });
  const buffer =
    format === 'png' ? await pipeline.png().toBuffer() : format === 'jpeg' ? await pipeline.jpeg({ quality: 92 }).toBuffer() : await pipeline.webp({ quality: 92 }).toBuffer();
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}
