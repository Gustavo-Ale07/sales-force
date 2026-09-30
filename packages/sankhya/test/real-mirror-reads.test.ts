import { describe, expect, it } from 'vitest';
import { FakeGateway, RealSankhyaGateway, SankhyaGatewayError, Secret, getDemoDataset } from '../src/index.js';
import { assertSafeScope, selectEffectiveVersions } from '../src/read-scope.js';
import { collect } from './support/gateway-contract.js';
import {
  MockSankhya,
  ROOT_GROUP_SENTINEL,
  TEST_BASE_URL,
  TEST_CREDENTIALS,
  TEST_HOST,
  type ErpTables,
} from './support/mock-sankhya.js';

const NOW = '2026-09-30T12:00:00.000Z';

function gatewayOver(tables: ErpTables) {
  const clock = { now: Date.parse(NOW) };
  const mock = new MockSankhya({ tables, clock });
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
    pageSize: 3,
  });
  return { gateway, mock };
}

async function rows<T>(snapshot: AsyncIterable<readonly T[]>): Promise<T[]> {
  return (await collect(snapshot)).rows;
}

describe('readProductGroups (TGFGRU)', () => {
  const tables: ErpTables = {
    TGFGRU: [
      { CODGRUPOPROD: 0, DESCRGRUPOPROD: '<SEM GRUPO>', CODGRUPAI: ROOT_GROUP_SENTINEL, GRAU: 1, ANALITICO: 'S', ATIVO: 'S' },
      { CODGRUPOPROD: 10, DESCRGRUPOPROD: 'Raiz', CODGRUPAI: ROOT_GROUP_SENTINEL, GRAU: 1, ANALITICO: 'N', ATIVO: 'S' },
      { CODGRUPOPROD: 11, DESCRGRUPOPROD: 'Filho', CODGRUPAI: 10, GRAU: 2, ANALITICO: 'S', ATIVO: 'S' },
      { CODGRUPOPROD: 12, DESCRGRUPOPROD: 'Inativo', CODGRUPAI: 10, GRAU: 2, ANALITICO: 'S', ATIVO: 'N' },
    ],
  };

  it('excludes the placeholder group 0, maps the root sentinel to null and keeps real parents', async () => {
    const { gateway, mock } = gatewayOver(tables);
    const groups = await rows(gateway.readProductGroups());
    expect(groups.map((g) => g.code)).toEqual([10, 11, 12]);
    expect(groups.find((g) => g.code === 10)).toEqual({ code: 10, name: 'Raiz', parentCode: null, degree: 1, analytic: false, active: true });
    expect(groups.find((g) => g.code === 11)).toMatchObject({ parentCode: 10, degree: 2, analytic: true });
    expect(groups.find((g) => g.code === 12)).toMatchObject({ active: false });
    const sql = mock.queries().map((q) => q.sql ?? '').join('\n');
    expect(sql).toContain('FROM TGFGRU');
    expect(sql).toContain('CODGRUPOPROD > 0');
    expect(sql).not.toMatch(/IMAGEM/);
  });

  it('rejects a malformed flag instead of guessing', async () => {
    const { gateway } = gatewayOver({
      TGFGRU: [{ CODGRUPOPROD: 5, DESCRGRUPOPROD: 'X', CODGRUPAI: ROOT_GROUP_SENTINEL, GRAU: 1, ANALITICO: 'X', ATIVO: 'S' }],
    });
    const failure = await rows(gateway.readProductGroups()).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(SankhyaGatewayError);
    expect((failure as SankhyaGatewayError).kind).toBe('validation');
  });
});

describe('readPriceTables (TGFNTA) scoped by installation configuration', () => {
  const tables: ErpTables = {
    TGFNTA: [
      { CODTAB: 0, NOMETAB: 'Tabela Base', ATIVO: 'S' },
      { CODTAB: 2, NOMETAB: 'Fora', ATIVO: 'S' },
      { CODTAB: 5, NOMETAB: 'Cinco', ATIVO: 'N' },
    ],
  };

  it('returns only the configured tables and keeps table 0 valid', async () => {
    const { gateway, mock } = gatewayOver(tables);
    const result = await rows(gateway.readPriceTables({ scope: { priceTableCodes: [0, 5] } }));
    expect(result).toEqual([
      { code: 0, name: 'Tabela Base', active: true, originTableCode: null, percent: null },
      { code: 5, name: 'Cinco', active: false, originTableCode: null, percent: null },
    ]);
    expect(mock.queries()[0]?.sql).toContain('CODTAB IN (0,5)');
  });

  it('without scope reads every table', async () => {
    const { gateway } = gatewayOver(tables);
    expect((await rows(gateway.readPriceTables())).map((t) => t.code)).toEqual([0, 2, 5]);
  });

  it('an empty configured list selects nothing and sends no SQL', async () => {
    const { gateway, mock } = gatewayOver(tables);
    expect(await rows(gateway.readPriceTables({ scope: { priceTableCodes: [] } }))).toEqual([]);
    expect(mock.queries()).toHaveLength(0);
  });
});

describe('price versions and prices: current version only', () => {
  const tables: ErpTables = {
    TGFTAB: [
      { NUTAB: 1, CODTAB: 5, DTVIGOR: '2026-01-01' },
      { NUTAB: 2, CODTAB: 5, DTVIGOR: '2026-08-01' },
      { NUTAB: 3, CODTAB: 5, DTVIGOR: '2026-12-01' },
      { NUTAB: 4, CODTAB: 0, DTVIGOR: '2026-03-01' },
      { NUTAB: 5, CODTAB: 9, DTVIGOR: '2026-03-01' },
    ],
    TGFEXC: [
      { NUTAB: 1, CODPROD: 100, CODLOCAL: 0, CONTROLE: ' ', VLRVENDA: 1 },
      { NUTAB: 2, CODPROD: 100, CODLOCAL: 0, CONTROLE: ' ', VLRVENDA: 12.5 },
      { NUTAB: 2, CODPROD: 101, CODLOCAL: 0, CONTROLE: ' ', VLRVENDA: 0 },
      { NUTAB: 4, CODPROD: 100, CODLOCAL: 0, CONTROLE: ' ', VLRVENDA: 9 },
      { NUTAB: 5, CODPROD: 100, CODLOCAL: 0, CONTROLE: ' ', VLRVENDA: 7 },
    ],
  };
  const scope = { priceTableCodes: [0, 5], now: NOW };

  it('keeps the latest DTVIGOR up to now per table plus future versions, drops superseded ones', async () => {
    const { gateway } = gatewayOver(tables);
    const versions = await rows(gateway.readPriceTableVersions({ scope }));
    expect(versions.map((v) => [v.versionId, v.tableCode])).toEqual([
      [2, 5],
      [3, 5],
      [4, 0],
    ]);
  });

  it('reads list prices of the retained versions only; explicit zero stays a row, absence stays absence', async () => {
    const { gateway } = gatewayOver(tables);
    const prices = await rows(gateway.readListPrices({ scope }));
    expect(prices.map((p) => [p.versionId, p.productCode, p.unitPrice])).toEqual([
      [2, 100, '12.5'],
      [2, 101, '0'],
      [4, 100, '9'],
    ]);
  });

  it('without any retained version it reads no prices and sends no price query', async () => {
    const { gateway, mock } = gatewayOver(tables);
    expect(await rows(gateway.readListPrices({ scope: { priceTableCodes: [77], now: NOW } }))).toEqual([]);
    expect(mock.queries().some((q) => (q.sql ?? '').includes('FROM TGFEXC'))).toBe(false);
  });
});

describe('readProducts scope (sellable usage, active, optional mobility field)', () => {
  const base = { CODVOL: 'UN', MARCA: null, REFERENCIA: null };
  const tables: ErpTables = {
    TGFPRO: [
      { CODPROD: 0, DESCRPROD: 'placeholder', ATIVO: 'S', USOPROD: 'V', CODGRUPOPROD: 0, AD_MOBILIDADE: 'S', ...base },
      { CODPROD: 1, DESCRPROD: 'A', ATIVO: 'S', USOPROD: 'V', CODGRUPOPROD: 10, AD_MOBILIDADE: 'S', ...base },
      { CODPROD: 2, DESCRPROD: 'B', ATIVO: 'S', USOPROD: 'R', CODGRUPOPROD: 10, AD_MOBILIDADE: null, ...base },
      { CODPROD: 3, DESCRPROD: 'C', ATIVO: 'N', USOPROD: 'V', CODGRUPOPROD: 10, AD_MOBILIDADE: 'S', ...base },
      { CODPROD: 4, DESCRPROD: 'D', ATIVO: 'S', USOPROD: 'S', CODGRUPOPROD: 10, AD_MOBILIDADE: 'S', ...base },
    ],
  };

  it('applies usage values and ATIVO from the scope; placeholder 0 never appears', async () => {
    const { gateway } = gatewayOver(tables);
    const result = await rows(gateway.readProducts({ scope: { products: { usageValues: ['V', 'R'] } } }));
    expect(result.map((p) => p.code)).toEqual([1, 2]);
  });

  it('can include inactive products when the scope says so', async () => {
    const { gateway } = gatewayOver(tables);
    const result = await rows(gateway.readProducts({ scope: { products: { usageValues: ['V'], activeOnly: false } } }));
    expect(result.map((p) => p.code)).toEqual([1, 3]);
  });

  it('reads the configured mobility field raw; without scope nothing is added', async () => {
    const { gateway, mock } = gatewayOver(tables);
    const scoped = await rows(
      gateway.readProducts({ scope: { products: { usageValues: ['V', 'R'], mobilitySourceField: 'AD_MOBILIDADE' } } }),
    );
    expect(scoped.map((p) => p.mobilityCode)).toEqual(['S', null]);
    expect(mock.queries()[0]?.sql).toContain('AD_MOBILIDADE AS MOBILITY');
    const plain = await rows(gateway.readProducts());
    expect(plain.every((p) => p.mobilityCode === undefined)).toBe(true);
    expect(plain.some((p) => p.code === 0)).toBe(false);
  });

  it('an empty usage list selects nothing', async () => {
    const { gateway } = gatewayOver(tables);
    expect(await rows(gateway.readProducts({ scope: { products: { usageValues: [] } } }))).toEqual([]);
  });

  it('refuses values that could alter the SQL text', () => {
    expect(() => assertSafeScope({ products: { usageValues: ["V'); DROP"] } })).toThrow(RangeError);
    expect(() => assertSafeScope({ products: { usageValues: ['V'], mobilitySourceField: 'X; --' } })).toThrow(RangeError);
    expect(() => assertSafeScope({ priceTableCodes: [1.5] })).toThrow(RangeError);
  });
});

describe('selectEffectiveVersions', () => {
  it('breaks effectiveFrom ties by the highest versionId and ignores input order', () => {
    const a = { versionId: 9, tableCode: 1, effectiveFrom: '2026-01-01T00:00:00.000Z' };
    const b = { versionId: 7, tableCode: 1, effectiveFrom: '2026-01-01T00:00:00.000Z' };
    expect(selectEffectiveVersions([b, a], NOW)).toEqual([a]);
  });
});

describe('fake gateway parity', () => {
  it('honors the same scope as the real gateway', async () => {
    const fake = new FakeGateway({ dataset: getDemoDataset() });
    const only = getDemoDataset().priceTables[0]!.code;
    expect((await rows(fake.readPriceTables({ scope: { priceTableCodes: [only] } }))).map((t) => t.code)).toEqual([only]);
    const versions = await rows(fake.readPriceTableVersions({ scope: { priceTableCodes: [only], now: NOW } }));
    expect(versions).toHaveLength(1);
    expect(versions[0]!.tableCode).toBe(only);
    const prices = await rows(fake.readListPrices({ scope: { priceTableCodes: [only], now: NOW } }));
    expect(prices.length).toBeGreaterThan(0);
    expect(prices.every((p) => p.versionId === versions[0]!.versionId)).toBe(true);
  });
});
