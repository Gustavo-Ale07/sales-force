import { describe, expect, it } from 'vitest';
import {
  FakeGateway,
  MAX_MEDIA_SIGNATURE_PAGE,
  RealSankhyaGateway,
  SankhyaGatewayError,
  Secret,
  getDemoDataset,
  mediaFingerprintOfBytes,
  syntheticProductImage,
  type SankhyaErrorKind,
} from '../src/index.js';
import { mediaSampleOffsets, mediaSampleWidth } from '../src/media.js';
import { productSpec, PRODUCT_SPEC } from '../src/real/mapping.js';
import { MEDIA_TEST_CODES, runMediaContract } from './support/media-contract.js';
import {
  MockSankhya,
  TEST_BASE_URL,
  TEST_CREDENTIALS,
  TEST_HOST,
  erpTablesFromDataset,
  httpStatus,
  ok,
  sqlError,
  type ClockRef,
} from './support/mock-sankhya.js';

const dataset = getDemoDataset();
const CODE = MEDIA_TEST_CODES[0] as number;

function realOver(images: Map<number, Uint8Array>) {
  const clock: ClockRef = { now: 1_800_000_000_000 };
  const mock = new MockSankhya({ tables: erpTablesFromDataset(dataset), clock });
  mock.blobs = images;
  const gateway = new RealSankhyaGateway({
    baseUrl: TEST_BASE_URL,
    allowedHosts: [TEST_HOST],
    environmentKind: 'sandbox',
    credentials: {
      clientId: new Secret(TEST_CREDENTIALS.clientId),
      clientSecret: new Secret(TEST_CREDENTIALS.clientSecret),
      xToken: new Secret(TEST_CREDENTIALS.xToken),
    },
    transport: mock.transport,
    now: () => clock.now,
  });
  return { gateway, mock };
}

runMediaContract('FakeGateway', {
  create: (images) => new FakeGateway({ media: { images } }),
});

runMediaContract('RealSankhyaGateway (mocked HTTP)', {
  create: (images) => realOver(images).gateway,
});

const FAILURES: Record<SankhyaErrorKind, () => ReturnType<typeof httpStatus>> = {
  unavailable: () => httpStatus(503),
  auth: () => httpStatus(401),
  validation: () => httpStatus(400),
  rate_limit: () => httpStatus(429, { 'retry-after': '3' }),
  temporary: () => httpStatus(500),
  permanent: () => sqlError('ORA-00904: invalid identifier'),
};

describe('sampled windows', () => {
  it('stay inside 1..length for every length and never exceed it', () => {
    for (const length of [1, 2, 31, 32, 33, 63, 64, 100, 2000, 40_768]) {
      for (const offset of mediaSampleOffsets(length)) {
        expect(offset).toBeGreaterThanOrEqual(1);
        expect(offset).toBeLessThanOrEqual(length);
        expect(mediaSampleWidth(length, offset)).toBeGreaterThanOrEqual(1);
        expect(mediaSampleWidth(length, offset)).toBeLessThanOrEqual(32);
      }
    }
    expect(mediaSampleOffsets(40_768)).toEqual([1, 10_192, 20_384, 30_576, 40_737]);
  });
});

describe('RealSankhyaGateway product media: SQL and transport', () => {
  it('signatures: one batched keyset SELECT per page carrying exactly the productSpec WHERE, never the BLOB', async () => {
    const images = new Map(MEDIA_TEST_CODES.map((c) => [c, syntheticProductImage('png', 100)] as const));
    const { gateway, mock } = realOver(images);
    const scope = { products: { usageValues: ['A', 'B'] } };
    await gateway.readProductMediaSignatures({ scope, afterCode: 7, limit: 50 });
    const queries = mock.queries();
    expect(queries).toHaveLength(1);
    const sql = queries[0]?.sql ?? '';
    expect(sql).toContain(`WHERE ${productSpec(scope).where} AND CODPROD > 7 AND IMAGEM IS NOT NULL AND DBMS_LOB.GETLENGTH(IMAGEM) > 0`);
    expect(sql).toMatch(/ORDER BY CODPROD FETCH FIRST 50 ROWS ONLY$/);
    expect(sql).toMatch(/^SELECT CODPROD, DBMS_LOB\.GETLENGTH\(IMAGEM\) AS LEN, RAWTOHEX\(DBMS_LOB\.SUBSTR\(IMAGEM, 32, 1\)\) AS W0, /);
    // every occurrence of the column is wrapped in DBMS_LOB.* : it is never selected raw
    expect(sql.replaceAll(/DBMS_LOB\.\w+\(IMAGEM[^)]*\)/g, '')).not.toContain('IMAGEM,');
    expect(sql.replaceAll(/DBMS_LOB\.\w+\(IMAGEM[^)]*\)/g, '').match(/IMAGEM/g)?.length).toBe(1); // only "IMAGEM IS NOT NULL"
  });

  it('signatures without scope use the unscoped productSpec WHERE', async () => {
    const { gateway, mock } = realOver(new Map());
    await gateway.readProductMediaSignatures({ limit: 10 });
    expect(mock.queries()[0]?.sql).toContain(`WHERE ${PRODUCT_SPEC.where} AND CODPROD > 0 AND IMAGEM IS NOT NULL`);
  });

  it('an empty usage scope selects nothing and sends no request', async () => {
    const { gateway, mock } = realOver(new Map());
    expect(await gateway.readProductMediaSignatures({ scope: { products: { usageValues: [] } }, limit: 10 })).toEqual([]);
    expect(mock.queries()).toHaveLength(0);
  });

  it('an unsafe scope value never reaches the SQL', async () => {
    const { gateway, mock } = realOver(new Map());
    await expect(gateway.readProductMediaSignatures({ scope: { products: { usageValues: ["V'); DROP"] } }, limit: 10 })).rejects.toThrow(RangeError);
    expect(mock.queries()).toHaveLength(0);
  });

  it('the signature of a product equals the fingerprint of its bytes', async () => {
    const bytes = syntheticProductImage('webp', 5000, 3);
    const { gateway } = realOver(new Map([[CODE, bytes]]));
    const [signature] = await gateway.readProductMediaSignatures({ limit: 1 });
    expect(signature).toEqual({ productCode: CODE, byteLength: 5000, fingerprint: mediaFingerprintOfBytes(bytes) });
  });

  it('bytes: sequential 2000-byte chunks with the proven statement, then one length re-check; SELECT only', async () => {
    const bytes = syntheticProductImage('png', 4500);
    const { gateway, mock } = realOver(new Map([[CODE, bytes]]));
    await gateway.readProductMediaBytes({ productCode: CODE, expectedLength: 4500, maxBytes: 10_000 });
    const sqls = mock.queries().map((q) => q.sql ?? '');
    expect(sqls).toEqual([
      `SELECT RAWTOHEX(DBMS_LOB.SUBSTR(IMAGEM, 2000, 1)) AS H FROM TGFPRO WHERE CODPROD = ${CODE}`,
      `SELECT RAWTOHEX(DBMS_LOB.SUBSTR(IMAGEM, 2000, 2001)) AS H FROM TGFPRO WHERE CODPROD = ${CODE}`,
      `SELECT RAWTOHEX(DBMS_LOB.SUBSTR(IMAGEM, 500, 4001)) AS H FROM TGFPRO WHERE CODPROD = ${CODE}`,
      `SELECT DBMS_LOB.GETLENGTH(IMAGEM) AS LEN FROM TGFPRO WHERE CODPROD = ${CODE}`,
    ]);
    expect(mock.maxInFlight).toBe(1);
  });

  it('every statement the media reads send is a plain SELECT', async () => {
    const images = new Map([[CODE, syntheticProductImage('jpeg', 2500)]]);
    const { gateway, mock } = realOver(images);
    await gateway.readProductMediaSignatures({ limit: 5 });
    await gateway.readProductMediaBytes({ productCode: CODE, expectedLength: 2500, maxBytes: 5000 });
    for (const call of mock.queries()) {
      expect(call.sql).toMatch(/^SELECT /);
      expect(call.sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|MERGE|DROP|ALTER|TRUNCATE|EXECUTE|BEGIN|CREATE|GRANT)\b|;/i);
    }
  });

  it('an oversize image is refused with zero requests', async () => {
    const { gateway, mock } = realOver(new Map([[CODE, syntheticProductImage('png', 400)]]));
    await expect(gateway.readProductMediaBytes({ productCode: CODE, expectedLength: 400, maxBytes: 399 })).rejects.toMatchObject({
      kind: 'permanent',
      code: 'media_too_large',
    });
    expect(mock.calls).toHaveLength(0);
  });

  it('a limit above the cap is refused with zero requests', async () => {
    const { gateway, mock } = realOver(new Map());
    await expect(gateway.readProductMediaSignatures({ limit: MAX_MEDIA_SIGNATURE_PAGE + 1 })).rejects.toThrow(RangeError);
    expect(mock.calls).toHaveLength(0);
  });

  it('a non-hex chunk is a validation error that does not echo the payload', async () => {
    const { gateway, mock } = realOver(new Map([[CODE, syntheticProductImage('png', 100)]]));
    mock.forced.push(ok(['H'], [['ZZ'.repeat(100)]]));
    const error = (await gateway.readProductMediaBytes({ productCode: CODE, expectedLength: 100, maxBytes: 1000 }).catch((e: unknown) => e)) as SankhyaGatewayError;
    expect(error).toMatchObject({ kind: 'validation', code: 'invalid_media_chunk', retryable: false });
    expect(error.message).not.toContain('ZZ');
  });

  it('an odd-length or over-long chunk is a validation error', async () => {
    for (const cell of ['ABC', 'AB'.repeat(101)]) {
      const { gateway, mock } = realOver(new Map([[CODE, syntheticProductImage('png', 100)]]));
      mock.forced.push(ok(['H'], [[cell]]));
      await expect(gateway.readProductMediaBytes({ productCode: CODE, expectedLength: 100, maxBytes: 1000 })).rejects.toMatchObject({ code: 'invalid_media_chunk' });
    }
  });

  it('a short chunk (image shrank) is a temporary changed-during-read error', async () => {
    const { gateway, mock } = realOver(new Map([[CODE, syntheticProductImage('png', 100)]]));
    mock.forced.push(ok(['H'], [['AB'.repeat(60)]]));
    await expect(gateway.readProductMediaBytes({ productCode: CODE, expectedLength: 100, maxBytes: 1000 })).rejects.toMatchObject({
      kind: 'temporary',
      code: 'media_changed_during_read',
    });
  });

  it('an image that changed length after the last chunk is caught by the final length check', async () => {
    const images = new Map([[CODE, syntheticProductImage('png', 100)]]);
    const { gateway, mock } = realOver(images);
    mock.beforeQuery = (sql) => {
      if (sql.includes('GETLENGTH(IMAGEM) AS LEN FROM')) images.set(CODE, syntheticProductImage('png', 101));
    };
    await expect(gateway.readProductMediaBytes({ productCode: CODE, expectedLength: 100, maxBytes: 1000 })).rejects.toMatchObject({
      code: 'media_changed_during_read',
    });
  });

  it('more than one row for a chunk is rejected', async () => {
    const { gateway, mock } = realOver(new Map([[CODE, syntheticProductImage('png', 100)]]));
    mock.forced.push(ok(['H'], [['AB'.repeat(100)], ['AB'.repeat(100)]]));
    await expect(gateway.readProductMediaBytes({ productCode: CODE, expectedLength: 100, maxBytes: 1000 })).rejects.toMatchObject({ kind: 'validation' });
  });

  it('abort between chunks stops further requests', async () => {
    const bytes = syntheticProductImage('png', 6000);
    const { gateway, mock } = realOver(new Map([[CODE, bytes]]));
    const controller = new AbortController();
    mock.beforeQuery = () => controller.abort();
    await expect(
      gateway.readProductMediaBytes({ productCode: CODE, expectedLength: 6000, maxBytes: 10_000, signal: controller.signal }),
    ).rejects.toThrow();
    expect(mock.queries().length).toBeLessThanOrEqual(1);
  });

  it('signature rows that are malformed fail closed without echoing data', async () => {
    const cases: unknown[][] = [
      [CODE, 100, 'ZZ', 'AA', 'AA', 'AA', 'AA'], // non-hex window
      [CODE, 100, 'AB', 'AB', 'AB', 'AB', 'AB'], // window too short for the length
      [CODE, 0, '', '', '', '', ''], // zero length can never be selected
      [CODE, null, 'AB', 'AB', 'AB', 'AB', 'AB'],
    ];
    for (const row of cases) {
      const { gateway, mock } = realOver(new Map());
      mock.forced.push(ok(['CODPROD', 'LEN', 'W0', 'W1', 'W2', 'W3', 'W4'], [row]));
      const error = (await gateway.readProductMediaSignatures({ limit: 5 }).catch((e: unknown) => e)) as SankhyaGatewayError;
      expect(error).toBeInstanceOf(SankhyaGatewayError);
      expect(error.kind).toBe('validation');
      expect(error.message).not.toMatch(/ZZ/);
    }
  });

  it('out-of-order or repeated signature rows are rejected as a temporary inconsistency', async () => {
    const { gateway, mock } = realOver(new Map());
    const window = '00'.repeat(1);
    mock.forced.push(
      ok(
        ['CODPROD', 'LEN', 'W0', 'W1', 'W2', 'W3', 'W4'],
        [
          [5, 1, window, window, window, window, window],
          [5, 1, window, window, window, window, window],
        ],
      ),
    );
    await expect(gateway.readProductMediaSignatures({ limit: 5 })).rejects.toMatchObject({ kind: 'temporary', code: 'snapshot_inconsistent' });
  });

  for (const kind of Object.keys(FAILURES) as SankhyaErrorKind[]) {
    it(`classifies a ${kind} failure on both reads and keeps secrets/payloads out of the message`, async () => {
      const images = new Map([[CODE, syntheticProductImage('png', 100)]]);
      for (const run of [
        (g: RealSankhyaGateway) => g.readProductMediaSignatures({ limit: 5 }),
        (g: RealSankhyaGateway) => g.readProductMediaBytes({ productCode: CODE, expectedLength: 100, maxBytes: 1000 }),
      ]) {
        const { gateway, mock } = realOver(images);
        mock.forced.push(FAILURES[kind]());
        const error = (await run(gateway).catch((e: unknown) => e)) as SankhyaGatewayError;
        expect(error).toBeInstanceOf(SankhyaGatewayError);
        expect(error.kind).toBe(kind);
        expect(error.retryable).toBe(kind === 'unavailable' || kind === 'rate_limit' || kind === 'temporary');
        expect(error.message).not.toMatch(/test-client|test-x-token|synthetic-token|Bearer/);
      }
    });
  }

  it('the normal product read still never selects the image column', async () => {
    const { gateway, mock } = realOver(new Map());
    for await (const batch of gateway.readProducts({ scope: { products: { usageValues: ['A'], mobilitySourceField: 'AD_MOBILIDADE' } } })) void batch;
    for await (const batch of gateway.readProducts()) void batch;
    expect(mock.queries().length).toBeGreaterThan(0);
    for (const call of mock.queries()) expect(call.sql).not.toMatch(/IMAGEM/);
    expect(PRODUCT_SPEC.select.join(' ')).not.toMatch(/IMAGEM/);
    expect(productSpec({ products: { usageValues: ['A'] } }).select.join(' ')).not.toMatch(/IMAGEM/);
  });
});

describe('FakeGateway product media fixtures and failure injection', () => {
  const images = new Map([
    [CODE, syntheticProductImage('png', 300)],
    [MEDIA_TEST_CODES[1] as number, syntheticProductImage('jpeg', 300)],
  ]);

  it('synthetic images carry the right magic bytes and trailer, deterministically', () => {
    const png = syntheticProductImage('png', 100);
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(Buffer.from(png.subarray(-8, -4)).toString('latin1')).toBe('IEND');
    const jpeg = syntheticProductImage('jpeg', 100);
    expect([jpeg[0], jpeg[1], jpeg.at(-2), jpeg.at(-1)]).toEqual([0xff, 0xd8, 0xff, 0xd9]);
    const webp = syntheticProductImage('webp', 100);
    expect(Buffer.from(webp.subarray(0, 4)).toString('latin1') + Buffer.from(webp.subarray(8, 12)).toString('latin1')).toBe('RIFFWEBP');
    expect(syntheticProductImage('png', 100, 5)).toEqual(syntheticProductImage('png', 100, 5));
    expect(syntheticProductImage('png', 100, 5)).not.toEqual(syntheticProductImage('png', 100, 6));
    expect(png).toHaveLength(100);
  });

  it('injects a per-product failure on bytes only', async () => {
    const failure = new SankhyaGatewayError('permanent', { code: 'fake_media', message: 'synthetic' });
    const gateway = new FakeGateway({ media: { images, failures: new Map([[CODE, failure]]) } });
    await expect(gateway.readProductMediaBytes({ productCode: CODE, expectedLength: 300, maxBytes: 1000 })).rejects.toBe(failure);
    await expect(gateway.readProductMediaBytes({ productCode: MEDIA_TEST_CODES[1] as number, expectedLength: 300, maxBytes: 1000 })).resolves.toHaveLength(300);
    expect(await gateway.readProductMediaSignatures({ limit: 10 })).toHaveLength(2);
  });

  it('can simulate an unavailable ERP on both reads (retryable)', async () => {
    const gateway = new FakeGateway({ media: { images, unavailable: true } });
    for (const read of [
      () => gateway.readProductMediaSignatures({ limit: 5 }),
      () => gateway.readProductMediaBytes({ productCode: CODE, expectedLength: 300, maxBytes: 1000 }),
    ]) {
      await expect(read()).rejects.toMatchObject({ kind: 'unavailable', retryable: true });
    }
  });

  it('serves no photos by default and returns copies, not the stored array', async () => {
    expect(await new FakeGateway().readProductMediaSignatures({ limit: 5 })).toEqual([]);
    const gateway = new FakeGateway({ media: { images } });
    const got = await gateway.readProductMediaBytes({ productCode: CODE, expectedLength: 300, maxBytes: 1000 });
    got[0] = 0;
    expect((images.get(CODE) as Uint8Array)[0]).toBe(0x89);
  });
});
