import type { ProductImageSource, SourceImage } from '../../src/catalog/product-image.js';

const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_IEND = [0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82];

/** A structurally whole PNG-shaped buffer (signature, filler, IEND); not a decodable picture. */
export function pngBytes(size = 64): Uint8Array {
  const bytes = new Uint8Array(Math.max(size, 32));
  bytes.set(PNG_HEAD, 0);
  bytes.set(PNG_IEND, bytes.length - PNG_IEND.length);
  return bytes;
}

export function jpegBytes(size = 64): Uint8Array {
  const bytes = new Uint8Array(Math.max(size, 32));
  bytes.set([0xff, 0xd8, 0xff, 0xe0], 0);
  bytes.set([0xff, 0xd9], bytes.length - 2);
  return bytes;
}

export function webpBytes(size = 64): Uint8Array {
  const bytes = new Uint8Array(Math.max(size, 32));
  bytes.set([...'RIFF'].map((c) => c.charCodeAt(0)), 0);
  new DataView(bytes.buffer).setUint32(4, bytes.length - 8, true);
  bytes.set([...'WEBP'].map((c) => c.charCodeAt(0)), 8);
  return bytes;
}

export const textBytes = (text: string): Uint8Array => new TextEncoder().encode(text);

export const SVG_BYTES = textBytes('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><script>alert(1)</script></svg>');
export const HTML_BYTES = textBytes('<!doctype html><html><body><script>alert(1)</script></body></html>');

export interface FakeImage {
  readonly bytes: Uint8Array;
  readonly version: string;
  readonly contentType?: string;
}

/** Test double of the port: images by product code, per-call recording, optional failure or stall. */
export class FakeImageSource implements ProductImageSource {
  readonly images = new Map<number, FakeImage>();
  readonly calls: string[] = [];
  failWith: Error | null = null;
  /** When true every call hangs until its signal aborts (timeout scenario). */
  hang = false;
  /** Versions reported by `versions` when they must differ from the image's own (ETag scenarios). */
  readonly versionOverride = new Map<number, string>();

  private async gate(signal: AbortSignal): Promise<void> {
    if (this.failWith !== null) throw this.failWith;
    if (this.hang) {
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')));
      });
    }
  }

  async versions(codes: readonly number[], signal: AbortSignal): Promise<ReadonlyMap<number, string>> {
    this.calls.push(`versions:${codes.join(',')}`);
    await this.gate(signal);
    const out = new Map<number, string>();
    for (const code of codes) {
      const image = this.images.get(code);
      if (image !== undefined) out.set(code, this.versionOverride.get(code) ?? image.version);
    }
    return out;
  }

  async getImage(code: number, variant: 'thumb' | 'full', signal: AbortSignal): Promise<SourceImage | null> {
    this.calls.push(`getImage:${code}:${variant}`);
    await this.gate(signal);
    return this.images.get(code) ?? null;
  }
}
