import { describe, expect, it } from 'vitest';
import {
  SankhyaGatewayError,
  getDemoDataset,
  syntheticProductImage,
  type SankhyaGateway,
} from '../../src/index.js';

/**
 * Product photo contract shared by the fake and the real adapter (over a mocked HTTP layer). Both are
 * built over the same synthetic demo products; `images` is the BLOB stand-in and is read LIVE.
 */
export interface MediaContractSubject {
  create(images: Map<number, Uint8Array>): SankhyaGateway;
}

const products = getDemoDataset().products;
const sorted = [...products].sort((a, b) => a.code - b.code);
/** Codes of the first products in code order; every one exists in the dataset. */
export const MEDIA_TEST_CODES = sorted.slice(0, 12).map((p) => p.code);
const CODES = MEDIA_TEST_CODES;

function imagesFor(sizes: readonly number[]): Map<number, Uint8Array> {
  return new Map(sizes.map((size, i) => [CODES[i] as number, syntheticProductImage('png', size, i + 1)]));
}

async function failure(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (error: unknown) => error,
  );
}

export function runMediaContract(label: string, subject: MediaContractSubject): void {
  describe(`Product media contract: ${label}`, () => {
    const SIZES = [40, 4500, 2000, 33, 100, 2001, 4000, 35, 64, 500, 1500, 70];

    it('returns signatures ascending by code, with byte length and a lowercase hex fingerprint', async () => {
      const gateway = subject.create(imagesFor(SIZES));
      const all = await gateway.readProductMediaSignatures({ limit: 200 });
      expect(all.map((s) => s.productCode)).toEqual(CODES);
      expect(all.map((s) => s.byteLength)).toEqual(SIZES);
      for (const signature of all) expect(signature.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    });

    it('pages by afterCode: concatenated pages equal one big page, a short page is the last', async () => {
      const gateway = subject.create(imagesFor(SIZES));
      const whole = await gateway.readProductMediaSignatures({ limit: 200 });
      const paged = [];
      let after = 0;
      for (;;) {
        const page = await gateway.readProductMediaSignatures({ afterCode: after, limit: 5 });
        paged.push(...page);
        if (page.length < 5) break;
        after = (page.at(-1) as { productCode: number }).productCode;
      }
      expect(paged).toEqual(whole);
    });

    it('afterCode is exclusive; past the last code the page is empty', async () => {
      const gateway = subject.create(imagesFor(SIZES));
      const page = await gateway.readProductMediaSignatures({ afterCode: CODES[3] as number, limit: 2 });
      expect(page.map((s) => s.productCode)).toEqual([CODES[4], CODES[5]]);
      expect(await gateway.readProductMediaSignatures({ afterCode: CODES.at(-1) as number, limit: 10 })).toEqual([]);
      expect(await subject.create(new Map()).readProductMediaSignatures({ limit: 10 })).toEqual([]);
    });

    it('products without a photo (absent or zero bytes) are not listed', async () => {
      const images = imagesFor([40, 40, 40]);
      images.set(CODES[1] as number, new Uint8Array(0));
      const gateway = subject.create(images);
      expect((await gateway.readProductMediaSignatures({ limit: 10 })).map((s) => s.productCode)).toEqual([CODES[0], CODES[2]]);
    });

    it('applies the same scope as readProducts (usage values, active only by default)', async () => {
      const images = new Map(sorted.slice(0, 60).map((p, i) => [p.code, syntheticProductImage('jpeg', 40 + i)] as const));
      const gateway = subject.create(images);
      const usage = sorted.find((p) => p.usageCode !== null)?.usageCode as string;
      const scopes = [
        { products: { usageValues: [usage] } },
        { products: { usageValues: [usage], activeOnly: false } },
      ];
      for (const scope of scopes) {
        const expected = sorted
          .slice(0, 60)
          .filter((p) => (scope.products.activeOnly === false || p.active) && p.usageCode === usage)
          .map((p) => p.code);
        expect(expected.length).toBeGreaterThan(0);
        const got = await gateway.readProductMediaSignatures({ scope, limit: 200 });
        expect(got.map((s) => s.productCode)).toEqual(expected);
      }
      expect(await gateway.readProductMediaSignatures({ scope: { products: { usageValues: [] } }, limit: 10 })).toEqual([]);
    });

    it('fingerprints are stable for the same bytes and change when length or a sampled byte changes', async () => {
      const bytes = syntheticProductImage('png', 3000, 7);
      const read = async (b: Uint8Array) =>
        (await subject.create(new Map([[CODES[0] as number, b]])).readProductMediaSignatures({ limit: 1 }))[0]?.fingerprint;
      const base = await read(bytes);
      expect(await read(Uint8Array.from(bytes))).toBe(base);
      const flip = (index: number) => {
        const copy = Uint8Array.from(bytes);
        copy[index] = (copy[index] as number) ^ 0xff;
        return copy;
      };
      const longer = new Uint8Array([...bytes, 0]);
      for (const changed of [flip(0), flip(Math.floor((3000 * 50) / 100) - 1), flip(2999), longer]) {
        expect(await read(changed)).not.toBe(base);
      }
    });

    it('handles tiny images (1 byte, below the sample width)', async () => {
      const gateway = subject.create(
        new Map([
          [CODES[0] as number, Uint8Array.of(0xab)],
          [CODES[1] as number, syntheticProductImage('webp', 32)],
        ]),
      );
      const page = await gateway.readProductMediaSignatures({ limit: 5 });
      expect(page.map((s) => s.byteLength)).toEqual([1, 32]);
    });

    for (const size of [1, 2, 1999, 2000, 2001, 4000, 4001, 4500, 12_345]) {
      it(`bytes: ${size} bytes round-trip exactly (chunk assembly)`, async () => {
        const original = syntheticProductImage('jpeg', Math.max(size, 32), size);
        const bytes = size >= 32 ? original : Uint8Array.from(original.subarray(0, size));
        const gateway = subject.create(new Map([[CODES[0] as number, bytes]]));
        const got = await gateway.readProductMediaBytes({ productCode: CODES[0] as number, expectedLength: bytes.length, maxBytes: 1_000_000 });
        expect(Buffer.from(got).equals(Buffer.from(bytes))).toBe(true);
      });
    }

    it('rejects a changed-during-read image as a retryable temporary error, never partial bytes', async () => {
      const images = imagesFor([4500]);
      const gateway = subject.create(images);
      images.set(CODES[0] as number, syntheticProductImage('png', 3000));
      const error = (await failure(
        gateway.readProductMediaBytes({ productCode: CODES[0] as number, expectedLength: 4500, maxBytes: 10_000 }),
      )) as SankhyaGatewayError;
      expect(error).toBeInstanceOf(SankhyaGatewayError);
      expect(error).toMatchObject({ kind: 'temporary', code: 'media_changed_during_read', retryable: true });
      const gone = (await failure(
        gateway.readProductMediaBytes({ productCode: CODES[5] as number, expectedLength: 10, maxBytes: 100 }),
      )) as SankhyaGatewayError;
      expect(gone).toMatchObject({ kind: 'temporary', code: 'media_changed_during_read' });
    });

    it('refuses expectedLength above maxBytes as permanent, and validates arguments', async () => {
      const gateway = subject.create(imagesFor([100]));
      const big = (await failure(
        gateway.readProductMediaBytes({ productCode: CODES[0] as number, expectedLength: 101, maxBytes: 100 }),
      )) as SankhyaGatewayError;
      expect(big).toMatchObject({ kind: 'permanent', code: 'media_too_large', retryable: false });
      const bad = [
        { productCode: 0, expectedLength: 10, maxBytes: 100 },
        { productCode: 1.5, expectedLength: 10, maxBytes: 100 },
        { productCode: 1, expectedLength: 0, maxBytes: 100 },
        { productCode: 1, expectedLength: -3, maxBytes: 100 },
        { productCode: 1, expectedLength: 10, maxBytes: 0 },
        { productCode: Number.MAX_SAFE_INTEGER + 1, expectedLength: 10, maxBytes: 100 },
      ];
      for (const options of bad) expect(await failure(gateway.readProductMediaBytes(options))).toBeInstanceOf(RangeError);
      for (const limit of [0, -1, 201, 1.5, Number.NaN]) {
        expect(await failure(gateway.readProductMediaSignatures({ limit }))).toBeInstanceOf(RangeError);
      }
      expect(await failure(gateway.readProductMediaSignatures({ limit: 5, afterCode: -1 }))).toBeInstanceOf(RangeError);
    });

    it('honours an aborted signal on both reads', async () => {
      const gateway = subject.create(imagesFor([100]));
      const controller = new AbortController();
      controller.abort();
      expect(await failure(gateway.readProductMediaSignatures({ limit: 5, signal: controller.signal }))).not.toBeNull();
      expect(
        await failure(
          gateway.readProductMediaBytes({ productCode: CODES[0] as number, expectedLength: 100, maxBytes: 200, signal: controller.signal }),
        ),
      ).not.toBeNull();
    });
  });
}
