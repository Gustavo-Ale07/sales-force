import { describe, expect, it } from 'vitest';
import {
  NotImplementedError,
  READ_ENTITIES,
  SANKHYA_ERROR_KINDS,
  SankhyaGatewayError,
  isRetryable,
  type ReadEntity,
  type SankhyaErrorKind,
  type SankhyaGateway,
  type Snapshot,
} from '../../src/index.js';
import { compareKeys } from '../../src/real/mapping.js';

/**
 * The gateway contract: every implementation (fake, real over a mocked HTTP layer) must pass the same
 * suite. It only relies on generic invariants of the interface, never on fixture values.
 */
export interface ContractSubject {
  create(): SankhyaGateway;
  /** A gateway whose next sellers read fails with an error of the given kind. */
  createFailing(kind: SankhyaErrorKind): SankhyaGateway;
}

type Reader = (gateway: SankhyaGateway) => Snapshot<unknown>;

const SNAPSHOT_READS: readonly { entity: Exclude<ReadEntity, 'configuration'>; read: Reader; key: (row: never) => readonly number[] }[] = [
  { entity: 'sellers', read: (g) => g.readSellers(), key: (r: { code: number }) => [r.code] },
  { entity: 'customers', read: (g) => g.readCustomers(), key: (r: { code: number }) => [r.code] },
  { entity: 'products', read: (g) => g.readProducts(), key: (r: { code: number }) => [r.code] },
  { entity: 'productGroups', read: (g) => g.readProductGroups(), key: (r: { code: number }) => [r.code] },
  { entity: 'priceTables', read: (g) => g.readPriceTables(), key: (r: { code: number }) => [r.code] },
  { entity: 'priceTableVersions', read: (g) => g.readPriceTableVersions(), key: (r: { versionId: number }) => [r.versionId] },
  {
    entity: 'listPrices',
    read: (g) => g.readListPrices(),
    key: (r: { versionId: number; productCode: number }) => [r.versionId, r.productCode],
  },
];

export async function collect<T>(snapshot: Snapshot<T>): Promise<{ batches: (readonly T[])[]; rows: T[] }> {
  const batches: (readonly T[])[] = [];
  const rows: T[] = [];
  for await (const batch of snapshot) {
    batches.push(batch);
    rows.push(...batch);
  }
  return { batches, rows };
}

export function runGatewayContract(label: string, subject: ContractSubject): void {
  describe(`SankhyaGateway contract: ${label}`, () => {
    it('describes itself honestly, with writes not implemented', () => {
      const description = subject.create().describe();
      expect(['fake', 'live']).toContain(description.mode);
      for (const entity of READ_ENTITIES) {
        expect(['supported', 'not_implemented']).toContain(description.capabilities.reads[entity]);
      }
      expect(description.capabilities.writes.submitOrder).toBe('not_implemented');
      expect(JSON.stringify(description)).not.toMatch(/secret|token|password/i);
    });

    for (const { entity, read, key } of SNAPSHOT_READS) {
      it(`${entity}: complete, ordered by full key, no duplicates, stable across reads (or NotImplemented)`, async () => {
        const gateway = subject.create();
        if (gateway.describe().capabilities.reads[entity] === 'not_implemented') {
          const failure = await collect(read(gateway)).then(
            () => null,
            (error: unknown) => error,
          );
          expect(failure).toBeInstanceOf(NotImplementedError);
          expect((failure as NotImplementedError).message).toContain('NEEDS VALIDATION');
          expect((failure as NotImplementedError).retryable).toBe(false);
          return;
        }
        const first = await collect(read(gateway));
        expect(first.rows.length).toBeGreaterThan(0);
        for (const batch of first.batches) expect(batch.length).toBeGreaterThan(0);
        const keys = first.rows.map((row) => (key as (row: unknown) => readonly number[])(row));
        for (let i = 1; i < keys.length; i += 1) {
          expect(compareKeys(keys[i] as number[], keys[i - 1] as number[])).toBeGreaterThan(0);
        }
        const second = await collect(read(gateway));
        expect(second.rows).toEqual(first.rows);
      });
    }

    it('readConfiguration returns a snapshot or NotImplementedError (never a partial value)', async () => {
      const gateway = subject.create();
      if (gateway.describe().capabilities.reads.configuration === 'not_implemented') {
        await expect(gateway.readConfiguration()).rejects.toBeInstanceOf(NotImplementedError);
        return;
      }
      const configuration = await gateway.readConfiguration();
      expect(configuration.schemaVersion).toBeGreaterThanOrEqual(1);
      expect(configuration.source.kind).toBe(gateway.describe().capabilities.configurationSource);
    });

    it('price semantics: rows exist only for priced or explicit-zero entries; references are consistent', async () => {
      const gateway = subject.create();
      if (gateway.describe().capabilities.reads.listPrices !== 'supported') return;
      const prices = (await collect(gateway.readListPrices())).rows;
      const versions = (await collect(gateway.readPriceTableVersions())).rows;
      const versionIds = new Set(versions.map((v) => v.versionId));
      const products = new Set((await collect(gateway.readProducts())).rows.map((p) => p.code));
      let zero = 0;
      for (const price of prices) {
        expect(price.unitPrice).toMatch(/^\d+(\.\d*[1-9])?$/); // canonical, unsigned, never empty or null
        expect(versionIds.has(price.versionId)).toBe(true);
        expect(products.has(price.productCode)).toBe(true);
        if (price.unitPrice === '0') zero += 1;
      }
      // Both states coexist in the data: "no row" (absent) and "explicit zero" (present, "0").
      expect(zero).toBeGreaterThan(0);
      const pairs = new Set(prices.map((p) => `${p.versionId}:${p.productCode}`));
      expect(pairs.size).toBeLessThan(versions.length * products.size);
    });

    it('exposes no write method other than the unimplemented submitOrder', () => {
      const gateway = subject.create();
      const allowed = new Set<string>([
        'constructor',
        'describe',
        'readConfiguration',
        'readSellers',
        'readCustomers',
        'readProducts',
        'readProductGroups',
        'readPriceTables',
        'readPriceTableVersions',
        'readListPrices',
        'submitOrder',
      ]);
      const names = new Set<string>();
      for (let proto: object | null = Object.getPrototypeOf(gateway); proto && proto !== Object.prototype; proto = Object.getPrototypeOf(proto)) {
        for (const name of Object.getOwnPropertyNames(proto)) names.add(name);
      }
      for (const name of names) expect(allowed.has(name), `unexpected method ${name}`).toBe(true);
    });

    it('submitOrder is intentionally unimplemented (SNK-4/5/6)', async () => {
      const gateway = subject.create();
      const failure = await gateway
        .submitOrder({ originId: 'synthetic-origin-1', customerCode: 1, sellerCode: null, items: [] })
        .then(
          () => null,
          (error: unknown) => error,
        );
      expect(failure).toBeInstanceOf(NotImplementedError);
      expect((failure as NotImplementedError).message).toContain('NEEDS VALIDATION');
      expect(isRetryable(failure)).toBe(false);
    });

    for (const kind of SANKHYA_ERROR_KINDS) {
      it(`classifies a ${kind} failure and only retries the transient kinds`, async () => {
        const gateway = subject.createFailing(kind);
        const failure = await collect(gateway.readSellers()).then(
          () => null,
          (error: unknown) => error,
        );
        expect(failure).toBeInstanceOf(SankhyaGatewayError);
        const error = failure as SankhyaGatewayError;
        expect(error.kind).toBe(kind);
        expect(error.retryable).toBe(kind === 'unavailable' || kind === 'rate_limit' || kind === 'temporary');
        expect(isRetryable(error)).toBe(error.retryable);
      });
    }

    it('honours an aborted signal', async () => {
      const gateway = subject.create();
      const controller = new AbortController();
      controller.abort();
      await expect(collect(gateway.readSellers({ signal: controller.signal }))).rejects.toThrow();
    });
  });
}
