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
import { DEMO_ORDER_TOP, DEMO_RETURN_TOP, DEMO_SALE_TOP, getDemoDataset, monthKey, type SalesHistoryReadConfig } from '../../src/index.js';

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
  { entity: 'carriers', read: (g) => g.readCarriers(), key: (r: { code: number }) => [r.code] },
  { entity: 'ipiRates', read: (g) => g.readIpiRates(), key: (r: { code: number }) => [r.code] },
  { entity: 'openTitles', read: (g) => g.readOpenTitles(), key: (r: { nufin: number }) => [r.nufin] },
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
      expect(['not_implemented', 'simulated']).toContain(description.capabilities.writes.submitOrder);
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

    it('exposes no write method other than the order delivery pair (SNK-7) and the customer upsert quartet (D-AR)', () => {
      const gateway = subject.create();
      const allowed = new Set<string>([
        'constructor',
        'describe',
        'readConfiguration',
        'readConfigurationFacts',
        'readSellers',
        'readCustomers',
        'readProducts',
        'readProductGroups',
        'readPriceTables',
        'readPriceTableVersions',
        'readDirectoryUsers',
        'readCarriers',
        'readIpiRates',
        'readOpenTitles',
        'readSalesHistoryMonthly',
        'readSalesHistoryCustomerProduct',
        'readListPrices',
        'readProductMediaSignatures',
        'readProductMediaBytes',
        'includeOrder',
        'confirmOrder',
        'findOrderByOrigin',
        'readWrittenOrder',
        'readOrderStatusFacts',
        'readOrderReleaseFacts',
        // D-AR: the customer upsert quartet (write guarded by SANKHYA_CUSTOMER_WRITE_ENABLED in the worker).
        'upsertPartner',
        'findPartnerByOrigin',
        'findPartnerByDocument',
        'readWrittenPartner',
      ]);
      const names = new Set<string>();
      for (let proto: object | null = Object.getPrototypeOf(gateway); proto && proto !== Object.prototype; proto = Object.getPrototypeOf(proto)) {
        for (const name of Object.getOwnPropertyNames(proto)) names.add(name);
      }
      for (const name of names) expect(allowed.has(name), `unexpected method ${name}`).toBe(true);
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

    describe('sales history (read-only aggregates, stage D)', () => {
      const dataset = getDemoDataset();
      const [c0, c1, c2] = dataset.customers.map((c) => c.code) as [number, number, number];
      const [s0, s1] = dataset.sellers.map((s) => s.code) as [number, number];
      const [p0] = dataset.products.map((p) => p.code) as [number];
      // The caller supplies the configuration; these are the synthetic fixture TOPs.
      const config: SalesHistoryReadConfig = { topCodes: [DEMO_SALE_TOP, DEMO_RETURN_TOP], statusCodes: ['L'], asOf: '2026-11-01' };
      const monthly = async (extra: Partial<SalesHistoryReadConfig> = {}) =>
        (await collect(subject.create().readSalesHistoryMonthly({ config: { ...config, ...extra } }))).rows;
      const products = async (extra: Partial<SalesHistoryReadConfig> = {}) =>
        (await collect(subject.create().readSalesHistoryCustomerProduct({ config: { ...config, ...extra } }))).rows;

      it('monthly: ordered by the full key, no duplicates, stable, decimal strings, both TOPs present', async () => {
        const first = await monthly();
        expect(first.length).toBeGreaterThan(0);
        const keys = first.map((r) => [r.customerCode, r.sellerCode, monthKey(r.month), r.topCode]);
        for (let i = 1; i < keys.length; i += 1) expect(compareKeys(keys[i] as number[], keys[i - 1] as number[])).toBeGreaterThan(0);
        for (const r of first) {
          expect(r.month).toMatch(/^\d{4}-(0[1-9]|1[0-2])$/);
          expect(r.totalAmount).toMatch(/^\d+(\.\d*[1-9])?$/);
          expect(Number.isInteger(r.noteCount) && r.noteCount > 0).toBe(true);
        }
        expect(new Set(first.map((r) => r.topCode))).toEqual(new Set([DEMO_SALE_TOP, DEMO_RETURN_TOP]));
        expect(await monthly()).toEqual(first);
        // two sellers and three customers appear; one note-count above 1 proves grouping, not row passthrough
        expect(new Set(first.map((r) => r.sellerCode))).toEqual(new Set([s0, s1]));
        expect(new Set(first.map((r) => r.customerCode))).toEqual(new Set([c0, c1, c2]));
      });

      it('monthly: sums VLRNOTA exactly per customer x seller x month x TOP and splits sellers', async () => {
        const rows = await monthly();
        const find = (c: number, s: number, m: string, t: number) => rows.find((r) => r.customerCode === c && r.sellerCode === s && r.month === m && r.topCode === t);
        expect(find(c0, s0, '2026-09', DEMO_SALE_TOP)).toMatchObject({ noteCount: 1, totalAmount: '640.25' });
        expect(find(c0, s1, '2026-09', DEMO_SALE_TOP)).toMatchObject({ totalAmount: '300.1' });
        expect(find(c0, s0, '2026-10', DEMO_RETURN_TOP)).toMatchObject({ totalAmount: '120' });
      });

      it('monthly: a customer with only returns shows only the return TOP', async () => {
        const rows = (await monthly()).filter((r) => r.customerCode === c2);
        expect(rows.length).toBeGreaterThan(0);
        expect(rows.every((r) => r.topCode === DEMO_RETURN_TOP)).toBe(true);
      });

      it('monthly: window filter (explicit since, windowMonths, old notes out)', async () => {
        const all = await monthly();
        expect(all.some((r) => r.month < '2025-12')).toBe(false); // the 2025-06 note is outside the 12-month window
        const recent = await monthly({ windowMonths: 2 });
        expect(new Set(recent.map((r) => r.month))).toEqual(new Set(['2026-10']));
        const since = await monthly({ since: '2026-09-10' });
        expect(since.some((r) => r.month === '2026-08')).toBe(false);
        expect(since.find((r) => r.customerCode === c0 && r.sellerCode === s0 && r.month === '2026-09')).toBeUndefined(); // 09-09 is before
        const wide = await monthly({ since: '2025-01-01' });
        expect(wide.some((r) => r.month === '2025-06')).toBe(true);
      });

      it('monthly: status filter and TOP filter', async () => {
        const pending = await monthly({ statusCodes: ['P'] });
        expect(pending).toEqual([{ customerCode: c1, sellerCode: s1, month: '2026-09', topCode: DEMO_SALE_TOP, noteCount: 1, totalAmount: '999.99' }]);
        const both = await monthly({ statusCodes: ['L', 'P'] });
        expect(both.find((r) => r.customerCode === c1 && r.month === '2026-09')).toMatchObject({ noteCount: 2, totalAmount: '1259.99' });
        const salesOnly = await monthly({ topCodes: [DEMO_SALE_TOP] });
        expect(salesOnly.every((r) => r.topCode === DEMO_SALE_TOP)).toBe(true);
        expect(salesOnly.some((r) => r.customerCode === c2)).toBe(false);
        // an order TOP is read only when the configuration lists it
        expect(await monthly({ topCodes: [DEMO_ORDER_TOP] })).toEqual([
          { customerCode: c1, sellerCode: s1, month: '2026-09', topCode: DEMO_ORDER_TOP, noteCount: 1, totalAmount: '888.88' },
        ]);
        expect((await monthly()).some((r) => r.topCode === DEMO_ORDER_TOP)).toBe(false);
      });

      it('monthly: the date field decides the month (DTNEG x DTFATUR)', async () => {
        const byNegotiation = await monthly();
        const byBilling = await monthly({ dateField: 'DTFATUR' });
        const key = (c: number, s: number, m: string, t: number) => (r: { customerCode: number; sellerCode: number; month: string; topCode: number }) =>
          r.customerCode === c && r.sellerCode === s && r.month === m && r.topCode === t;
        expect(byNegotiation.some(key(c0, s0, '2026-10', DEMO_SALE_TOP))).toBe(true);
        expect(byNegotiation.some(key(c0, s0, '2026-11', DEMO_SALE_TOP))).toBe(false);
        expect(byBilling.some(key(c0, s0, '2026-10', DEMO_SALE_TOP))).toBe(false);
        expect(byBilling.find(key(c0, s0, '2026-11', DEMO_SALE_TOP))).toMatchObject({ totalAmount: '910' });
      });

      it('customer x product: ordered, grouped, exact decimals, last sale date, return TOP separate', async () => {
        const rows = await products();
        const keys = rows.map((r) => [r.customerCode, r.productCode, r.topCode]);
        for (let i = 1; i < keys.length; i += 1) expect(compareKeys(keys[i] as number[], keys[i - 1] as number[])).toBeGreaterThan(0);
        for (const r of rows) {
          expect(r.quantity).toMatch(/^\d+(\.\d*[1-9])?$/);
          expect(r.netAmount).toMatch(/^\d+(\.\d*[1-9])?$/);
          expect(r.lastSaleDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        }
        const sale = rows.find((r) => r.customerCode === c0 && r.productCode === p0 && r.topCode === DEMO_SALE_TOP);
        expect(sale).toEqual({ customerCode: c0, productCode: p0, topCode: DEMO_SALE_TOP, noteCount: 2, quantity: '16', netAmount: '1216', lastSaleDate: '2026-09-09' });
        const back = rows.find((r) => r.customerCode === c0 && r.productCode === p0 && r.topCode === DEMO_RETURN_TOP);
        expect(back).toMatchObject({ noteCount: 1, quantity: '1', netAmount: '80', lastSaleDate: '2026-10-15' });
        expect(await products()).toEqual(rows);
      });

      it('customer x product: window, status, TOP and date field filters apply', async () => {
        expect((await products({ topCodes: [DEMO_SALE_TOP] })).some((r) => r.topCode === DEMO_RETURN_TOP)).toBe(false);
        expect((await products({ statusCodes: ['P'] })).map((r) => [r.customerCode, r.topCode])).toEqual([[c1, DEMO_SALE_TOP]]);
        expect((await products()).some((r) => r.customerCode === c1 && r.lastSaleDate < '2025-12-01')).toBe(false);
        const byBilling = await products({ dateField: 'DTFATUR' });
        expect(byBilling.find((r) => r.customerCode === c0 && r.productCode === p0 && r.topCode === DEMO_SALE_TOP)).toMatchObject({ noteCount: 2 });
        expect(byBilling.some((r) => r.lastSaleDate === '2026-11-02')).toBe(true);
      });

      const badConfigs: [string, Partial<Record<keyof SalesHistoryReadConfig, unknown>>][] = [
        ['topCodes with a non-integer', { topCodes: [1101.5] }],
        ['topCodes with a numeric string', { topCodes: ['1101'] }],
        ['topCodes injection text', { topCodes: ['1101); DROP TABLE TGFCAB; --'] }],
        ['empty topCodes', { topCodes: [] }],
        ['zero TOP', { topCodes: [0] }],
        ['status injection', { statusCodes: ["L' OR '1'='1"] }],
        ['lowercase status', { statusCodes: ['l'] }],
        ['empty statusCodes', { statusCodes: [] }],
        ['dateField injection', { dateField: 'X; DROP' }],
        ['dateField other column', { dateField: 'VLRNOTA' }],
        ['windowMonths zero', { windowMonths: 0 }],
        ['windowMonths fraction', { windowMonths: 1.5 }],
        ['since not a date', { since: "2026-01-01'); --" }],
        ['since impossible day', { since: '2026-02-30' }],
        ['asOf not a date', { asOf: 'yesterday' }],
      ];
      for (const [label, bad] of badConfigs) {
        it(`rejects a bad configuration before any ERP call: ${label}`, async () => {
          const gateway = subject.create();
          const options = { config: { ...config, ...bad } as unknown as SalesHistoryReadConfig };
          for (const read of [() => collect(gateway.readSalesHistoryMonthly(options)), () => collect(gateway.readSalesHistoryCustomerProduct(options))]) {
            const failure = await (async () => read())().then(
              () => null,
              (error: unknown) => error,
            );
            expect(failure).toBeInstanceOf(SankhyaGatewayError);
            expect((failure as SankhyaGatewayError).kind).toBe('validation');
            expect((failure as SankhyaGatewayError).code).toBe('invalid_sales_history_config');
            expect((failure as SankhyaGatewayError).retryable).toBe(false);
          }
        });
      }

      for (const kind of SANKHYA_ERROR_KINDS) {
        it(`classifies a ${kind} failure of the sales-history reads`, async () => {
          const reads: ((g: SankhyaGateway) => Snapshot<unknown>)[] = [
            (g) => g.readSalesHistoryMonthly({ config }),
            (g) => g.readSalesHistoryCustomerProduct({ config }),
          ];
          for (const read of reads) {
            const failure = await collect(read(subject.createFailing(kind))).then(
              () => null,
              (error: unknown) => error,
            );
            expect(failure).toBeInstanceOf(SankhyaGatewayError);
            expect((failure as SankhyaGatewayError).kind).toBe(kind);
            expect((failure as SankhyaGatewayError).retryable).toBe(kind === 'unavailable' || kind === 'rate_limit' || kind === 'temporary');
          }
        });
      }
    });

    it('honours an aborted signal', async () => {
      const gateway = subject.create();
      const controller = new AbortController();
      controller.abort();
      await expect(collect(gateway.readSellers({ signal: controller.signal }))).rejects.toThrow();
    });
  });
}
