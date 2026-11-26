import { describe, expect, it } from 'vitest';
import { FakeGateway, RealSankhyaGateway, SankhyaGatewayError, Secret, getDemoDataset } from '../src/index.js';
import { assertSafeScope, selectEffectiveVersions } from '../src/read-scope.js';
import { collect } from './support/gateway-contract.js';
import { sqlError } from './support/mock-sankhya.js';
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

  it('treats a real group whose parent is the placeholder 0 as a data anomaly and rejects the snapshot', async () => {
    const { gateway } = gatewayOver({
      TGFGRU: [
        { CODGRUPOPROD: 10, DESCRGRUPOPROD: 'Raiz', CODGRUPAI: ROOT_GROUP_SENTINEL, GRAU: 1, ANALITICO: 'N', ATIVO: 'S' },
        { CODGRUPOPROD: 20, DESCRGRUPOPROD: 'Anomalo', CODGRUPAI: 0, GRAU: 2, ANALITICO: 'S', ATIVO: 'S' },
      ],
    });
    const failure = (await rows(gateway.readProductGroups()).catch((e: unknown) => e)) as SankhyaGatewayError;
    expect(failure).toBeInstanceOf(SankhyaGatewayError);
    expect(failure).toMatchObject({ kind: 'validation', code: 'invalid_row', retryable: false });
    expect(failure.message).toContain('CODGRUPAI');
    expect(failure.message).not.toContain('Anomalo');
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

describe('address registry reads (TSICID / TSIUFS / TSIBAI / TSIEND)', () => {
  const tables: ErpTables = {
    TSIUFS: [
      { CODUF: 1, UF: 'sp' },
      { CODUF: 2, UF: 'RJ' },
    ],
    TSICID: [
      { CODCID: 0, NOMECID: 'SEM', UF: 0, CODMUNFIS: 0 },
      { CODCID: 10, NOMECID: 'Cidade A', UF: 1, CODMUNFIS: 3500001 },
      { CODCID: 11, NOMECID: 'Cidade B', UF: 2, CODMUNFIS: 0 },
      { CODCID: 12, NOMECID: 'Cidade C', UF: 99, CODMUNFIS: 5 },
      { CODCID: 13, NOMECID: '  ', UF: 1, CODMUNFIS: 5 },
    ],
    TSIBAI: [
      { CODBAI: 0, NOMEBAI: 'SEM' },
      { CODBAI: 3, NOMEBAI: 'Centro' },
    ],
    TSIEND: [
      { CODEND: 0, NOMEEND: 'SEM', TIPO: null },
      { CODEND: 7, NOMEEND: 'das Flores', TIPO: 'RUA' },
      { CODEND: 8, NOMEEND: 'Sem tipo', TIPO: ' ' },
    ],
    TSICEP: [
      { CEP: '01310100', CODCID: 10, CODBAI: 3, CODEND: 7 },
      { CEP: '20040020', CODCID: 11, CODBAI: 0, CODEND: 0 },
      { CEP: 'ABCDEFGH', CODCID: 10, CODBAI: 0, CODEND: 0 },
      { CEP: '99999999', CODCID: 0, CODBAI: 0, CODEND: 0 },
    ],
  };

  it('resolves the numeric state to its abbreviation, drops the placeholder and discards a city with unknown state or blank name', async () => {
    const { gateway, mock } = gatewayOver(tables);
    const warnings: string[] = [];
    const cities = await rows(gateway.readCities({ onWarning: (m) => warnings.push(m) }));
    expect(cities).toEqual([
      { code: 10, name: 'Cidade A', uf: 'SP', ibge: '3500001' },
      { code: 11, name: 'Cidade B', uf: 'RJ', ibge: null },
    ]);
    expect(warnings).toHaveLength(2);
    expect(warnings.join(' ')).not.toContain('Cidade C');
    const sql = mock.queries().map((q) => q.sql ?? '').join('\n');
    expect(sql).toContain('FROM TSICID');
    expect(sql).toContain('FROM TSIUFS');
  });

  it('reads neighborhoods and streets without the placeholder code 0', async () => {
    const { gateway } = gatewayOver(tables);
    expect(await rows(gateway.readNeighborhoods())).toEqual([{ code: 3, name: 'Centro' }]);
    expect(await rows(gateway.readStreets())).toEqual([
      { code: 7, name: 'das Flores', kind: 'RUA' },
      { code: 8, name: 'Sem tipo', kind: null },
    ]);
  });
});

describe('readPostalCodes (TSICEP)', () => {
  const tables: ErpTables = {
    TSICEP: [
      { CEP: '01310100', CODCID: 10, CODBAI: 3, CODEND: 7 },
      { CEP: '20040020', CODCID: 11, CODBAI: null, CODEND: 0 },
      { CEP: 'ABCDEFGH', CODCID: 10, CODBAI: 0, CODEND: 0 },
      { CEP: '99999999', CODCID: 0, CODBAI: 0, CODEND: 0 },
    ],
  };

  it('keeps the 8-digit CEP as an integer key with its links; discards a malformed CEP and one without a city', async () => {
    const { gateway } = gatewayOver(tables);
    expect(await rows(gateway.readPostalCodes())).toEqual([
      { cep: 1310100, cityCode: 10, neighborhoodCode: 3, streetCode: 7 },
      { cep: 20040020, cityCode: 11, neighborhoodCode: 0, streetCode: 0 },
    ]);
  });
});

describe('Force configuration tables (AD_FORCECFG / AD_FORCELIMDESC) and TGFVEN.DESCMAX', () => {
  it('reads the config row; a null field stays null (the default is applied by the domain)', async () => {
    const { gateway, mock } = gatewayOver({
      AD_FORCECFG: [
        { ID: 1, DIASSEMSYNC: 3, CODTABPADRAO: null },
      ],
    });
    expect(await rows(gateway.readForceConfig())).toEqual([{ id: 1, daysWithoutSync: 3, defaultPriceTableCode: null }]);
    expect(mock.queries().map((q) => q.sql ?? '').join(' ')).toContain('FROM AD_FORCECFG');
  });

  it('reads discount rules keyed by (ID, SEQ); discards a row without seller, without product and group, or with a bad percentage', async () => {
    const { gateway } = gatewayOver({
      AD_FORCELIMDESC: [
        { ID: 1, SEQ: 1, CODVEND: 7, CODGRUPOPROD: null, CODPROD: 500, DESCMAX: 3.5 },
        { ID: 1, SEQ: 2, CODVEND: 7, CODGRUPOPROD: 11, CODPROD: null, DESCMAX: 5 },
        { ID: 1, SEQ: 3, CODVEND: null, CODGRUPOPROD: 11, CODPROD: null, DESCMAX: 5 },
        { ID: 1, SEQ: 4, CODVEND: 7, CODGRUPOPROD: null, CODPROD: null, DESCMAX: 5 },
        { ID: 1, SEQ: 5, CODVEND: 7, CODGRUPOPROD: 12, CODPROD: null, DESCMAX: 150 },
        { ID: 1, SEQ: 6, CODVEND: 7, CODGRUPOPROD: 12, CODPROD: 0, DESCMAX: null },
      ],
    });
    expect(await rows(gateway.readForceDiscountLimits())).toEqual([
      { configId: 1, seq: 1, sellerCode: 7, groupCode: null, productCode: 500, percent: '3.5' },
      { configId: 1, seq: 2, sellerCode: 7, groupCode: 11, productCode: null, percent: '5' },
    ]);
  });

  it('empty tables read as empty snapshots', async () => {
    const { gateway } = gatewayOver({ AD_FORCECFG: [], AD_FORCELIMDESC: [] });
    expect(await rows(gateway.readForceConfig())).toEqual([]);
    expect(await rows(gateway.readForceDiscountLimits())).toEqual([]);
  });

  it('a missing table (ORA-00942) reads as empty; another SQL error still fails', async () => {
    const missing = gatewayOver({});
    missing.mock.forced.push(sqlError());
    expect(await rows(missing.gateway.readForceConfig())).toEqual([]);
    const other = gatewayOver({});
    other.mock.forced.push(sqlError('ORA-00904: invalid identifier'));
    await expect(rows(other.gateway.readForceDiscountLimits())).rejects.toBeInstanceOf(SankhyaGatewayError);
  });

  it('TGFVEN.DESCMAX becomes the seller maxDiscountPercent; blank or out of range is left out', async () => {
    const { gateway } = gatewayOver({
      TGFVEN: [
        { CODVEND: 1, APELIDO: 'A', ATIVO: 'S', DESCMAX: 8 },
        { CODVEND: 2, APELIDO: 'B', ATIVO: 'S', DESCMAX: null },
        { CODVEND: 3, APELIDO: 'C', ATIVO: 'S', DESCMAX: 400 },
      ],
    });
    const sellers = await rows(gateway.readSellers());
    expect(sellers.map((x) => x.maxDiscountPercent)).toEqual(['8', undefined, undefined]);
  });
});

describe('readSellerGoals (TGFMET)', () => {
  const tables: ErpTables = {
    TGFMET: [
      { CODVEND: 0, DTREF: '2026-11-01', PREVREC: 999, QTDPREV: 99 },
      { CODVEND: 7, DTREF: '2026-11-01', PREVREC: 1000.5, QTDPREV: 10 },
      { CODVEND: 7, DTREF: '2026-11-01', PREVREC: 500, QTDPREV: 5.5 },
      { CODVEND: 7, DTREF: '2026-12-01', PREVREC: 0, QTDPREV: 20 },
      { CODVEND: 3, DTREF: '2026-11-01', PREVREC: 2000, QTDPREV: 0 },
    ],
  };

  it('ignores CODVEND = 0 rows and sums the goals of one seller and month, ordered by seller then month', async () => {
    const { gateway, mock } = gatewayOver(tables);
    expect(await rows(gateway.readSellerGoals())).toEqual([
      { sellerCode: 3, month: '2026-11', revenueTarget: '2000', quantityTarget: '0' },
      { sellerCode: 7, month: '2026-11', revenueTarget: '1500.5', quantityTarget: '15.5' },
      { sellerCode: 7, month: '2026-12', revenueTarget: '0', quantityTarget: '20' },
    ]);
    const sql = mock.queries().map((q) => q.sql ?? '').join('\n');
    expect(sql).toContain('FROM TGFMET');
    expect(sql).toContain('CODVEND > 0');
  });

  it('a table with only seller-less rows reads empty', async () => {
    const { gateway } = gatewayOver({ TGFMET: [{ CODVEND: 0, DTREF: '2026-11-01', PREVREC: 0, QTDPREV: 110 }] });
    expect(await rows(gateway.readSellerGoals())).toEqual([]);
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

  it('mobilityAllowedValues filters at the source with an IN clause (D-S)', async () => {
    const { gateway, mock } = gatewayOver(tables);
    const excluded: Record<string, number>[] = [];
    const result = await rows(
      gateway.readProducts({
        scope: { products: { usageValues: ['V', 'R'], mobilitySourceField: 'AD_MOBILIDADE', mobilityAllowedValues: ['S'] } },
        onExcluded: (_entity, counts) => excluded.push({ ...counts }),
      }),
    );
    expect(mock.queries().map((q) => q.sql ?? '').join('\n')).toContain("AD_MOBILIDADE IN ('S')");
    // J2: product 2 passes usage and ATIVO but is not mobile-enabled; the report says how many were left out for that.
    expect(result.map((p) => p.code)).toEqual([1]);
    expect(excluded).toEqual([{ mobility: 1 }]);
  });

  it('refuses an allowed-values list without a field, empty, or with unsafe text', () => {
    expect(() => assertSafeScope({ products: { usageValues: ['V'], mobilityAllowedValues: ['S'] } })).toThrow(RangeError);
    expect(() => assertSafeScope({ products: { usageValues: ['V'], mobilitySourceField: 'AD_MOBILIDADE', mobilityAllowedValues: [] } })).toThrow(RangeError);
    expect(() =>
      assertSafeScope({ products: { usageValues: ['V'], mobilitySourceField: 'AD_MOBILIDADE', mobilityAllowedValues: ["S'--"] } }),
    ).toThrow(RangeError);
  });

  it('maps TGFPRO.DESCMAX to maxDiscountPercent; null or blank = absent (no limit registered); DESCMAXFLEX is never selected', async () => {
    const withLimit = (code: number, descmax: unknown) => ({ CODPROD: code, DESCRPROD: `P${code}`, ATIVO: 'S', USOPROD: 'V', CODGRUPOPROD: 10, DESCMAX: descmax, DESCMAXFLEX: 99, ...base });
    const { gateway, mock } = gatewayOver({
      TGFPRO: [
        // Owner Sandbox facts (2026-11-23): these five products carry DESCMAX = 12.
        withLimit(4158, 12), withLimit(4159, 12), withLimit(1439, '12'), withLimit(1437, 12), withLimit(3590, 12.0),
        withLimit(10, null), withLimit(11, ''), withLimit(12, 2), withLimit(13, 100), withLimit(14, 0), withLimit(15, 150), withLimit(16, 12.5),
      ],
    });
    const result = await rows(gateway.readProducts({ scope: { products: { usageValues: ['V'] } } }));
    const byCode = new Map(result.map((p) => [p.code, p]));
    for (const code of [4158, 4159, 1439, 1437, 3590]) expect(byCode.get(code)?.maxDiscountPercent).toBe('12');
    for (const code of [10, 11]) expect(byCode.get(code)).not.toHaveProperty('maxDiscountPercent');
    expect(byCode.get(12)?.maxDiscountPercent).toBe('2');
    expect(byCode.get(13)?.maxDiscountPercent).toBe('100');
    expect(byCode.get(14)?.maxDiscountPercent).toBe('0');
    // Outside 0..100 is not a percentage: no limit registered, the product itself stays.
    expect(byCode.get(15)).not.toHaveProperty('maxDiscountPercent');
    expect(byCode.get(16)?.maxDiscountPercent).toBe('12.5');
    const text = mock.queries().map((q) => q.sql ?? '').join('\n');
    expect(text).toContain('DESCMAX');
    expect(text).not.toContain('DESCMAXFLEX');
  });

  it('maps the TGFBAR barcode (CODBARRA) to barcode; null or blank = absent', async () => {
    const withBar = (code: number, bar: unknown) => ({ CODPROD: code, DESCRPROD: `P${code}`, ATIVO: 'S', USOPROD: 'V', CODGRUPOPROD: 10, CODBARRA: bar, ...base });
    const { gateway, mock } = gatewayOver({ TGFPRO: [withBar(1, '7891234567895'), withBar(2, null), withBar(3, '  ')] });
    const result = await rows(gateway.readProducts({ scope: { products: { usageValues: ['V'] } } }));
    const byCode = new Map(result.map((p) => [p.code, p]));
    expect(byCode.get(1)?.barcode).toBe('7891234567895');
    expect(byCode.get(2)).not.toHaveProperty('barcode');
    expect(byCode.get(3)).not.toHaveProperty('barcode');
    expect(mock.queries().map((q) => q.sql ?? '').join('\n')).toContain('TGFBAR');
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
