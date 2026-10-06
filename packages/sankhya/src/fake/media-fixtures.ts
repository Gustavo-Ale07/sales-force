/**
 * SYNTHETIC image bytes for the fake gateway and consumer tests. Provenance: generated here
 * (2026-10-05), no Sankhya capture used. They carry the right magic bytes and trailer of each format
 * and deterministic filler; they are NOT decodable pictures.
 */
export type SyntheticImageKind = 'png' | 'jpeg' | 'webp';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_IEND = [0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82];
const JPEG_HEAD = [0xff, 0xd8, 0xff, 0xe0];
const JPEG_TAIL = [0xff, 0xd9];

function filler(length: number, seed: number): number[] {
  const out: number[] = [];
  let state = (seed >>> 0) || 1;
  for (let i = 0; i < length; i += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    out.push(state >>> 24);
  }
  return out;
}

/** Deterministic bytes of exactly `size` bytes (minimum 32) for `kind`; the same (kind, size, seed) always yields the same bytes. */
export function syntheticProductImage(kind: SyntheticImageKind, size: number, seed = 1): Uint8Array {
  if (!Number.isSafeInteger(size) || size < 32) throw new RangeError('size must be an integer >= 32');
  let head: number[];
  let tail: number[];
  if (kind === 'png') {
    head = PNG_SIGNATURE;
    tail = PNG_IEND;
  } else if (kind === 'jpeg') {
    head = JPEG_HEAD;
    tail = JPEG_TAIL;
  } else {
    const riffSize = size - 8;
    head = [
      0x52, 0x49, 0x46, 0x46,
      riffSize & 0xff, (riffSize >>> 8) & 0xff, (riffSize >>> 16) & 0xff, (riffSize >>> 24) & 0xff,
      0x57, 0x45, 0x42, 0x50,
    ];
    tail = [];
  }
  return Uint8Array.from([...head, ...filler(size - head.length - tail.length, seed), ...tail]);
}
