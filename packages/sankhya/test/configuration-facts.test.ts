import { describe, expect, it } from 'vitest';
import {
  CONFIG_QUERY_TEXTS,
  FakeGateway,
  PLAC_CONFIGURATION_FACTS,
  RealSankhyaGateway,
  SankhyaGatewayError,
  Secret,
  assertConfigurationFactsComplete,
  failedConfigQueries,
  flagToBoolean,
  isQuoteGroupName,
  type ConfigurationFacts,
} from '../src/index.js';
import { CONFIG_QUERIES } from '../src/real/configuration-queries.js';
import {
  MockSankhya,
  TEST_BASE_URL,
  TEST_CREDENTIALS,
  TEST_HOST,
  httpStatus,
  ok,
  sqlError,
  type ClockRef,
  type ForcedResponse,
} from './support/mock-sankhya.js';

const FORBIDDEN = /SECRET|TOKEN|SENHA|PASSWORD|PASS|KEY|CERT|BASICAUTH/i;

describe('configuration queries: credential columns are never named', () => {
  it('has the eight verbatim queries', () => {
    expect(CONFIG_QUERY_TEXTS).toHaveLength(8);
  });

  it('no identifier in any query contains SECRET, TOKEN, SENHA, PASSWORD, PASS, KEY, CERT or BASICAUTH', () => {
    for (const sql of CONFIG_QUERY_TEXTS) {
      // Strip string literals, then check every identifier.
      const identifiers = sql.replace(/'[^']*'/g, "''").match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
      for (const identifier of identifiers) expect(identifier, sql).not.toMatch(FORBIDDEN);
    }
  });

  it('never uses SELECT * and the guard itself catches a credential column', () => {
    for (const sql of CONFIG_QUERY_TEXTS) expect(sql).not.toMatch(/SELECT\s+(\w+\.)?\*/i);
    for (const sql of CONFIG_QUERY_TEXTS) expect(sql).not.toMatch(/AD_TVDYCFGFRC\s*\.\*/i);
    expect('SELECT BASICAUTH, CLIENTSECRET1, KEYX, CERTX FROM AD_TVDYCFGFRC').toMatch(FORBIDDEN);
    expect('SELECT NUCFG, CODLOCALPEDIDOS FROM AD_TVDYCFGFRC').not.toMatch(FORBIDDEN);
  });

  it('Q1 reads only AD_TVDYCFGFRC with an explicit column list for NUCFG = 1', () => {
    expect(CONFIG_QUERIES.Q1.sql.startsWith('SELECT NUCFG, CODLOCALPEDIDOS,')).toBe(true);
    expect(CONFIG_QUERIES.Q1.sql.endsWith('FROM AD_TVDYCFGFRC WHERE NUCFG = 1')).toBe(true);
  });
});

function rowFor(columns: readonly string[], values: Record<string, unknown>): unknown[] {
  return columns.map((c) => (c in values ? values[c] : null));
}

const Q1_OK = ok(CONFIG_QUERIES.Q1.columns, [
  rowFor(CONFIG_QUERIES.Q1.columns, {
    NUCFG: 1, CODLOCALPEDIDOS: 209, TABPADCSLTPROD: '5', CODTABALT: 5, USADECQTD: 'S',
    DIASCONSULTAVENDAS: 90, QTDDIASPRODCOMPRADOS: 90, UTILFINANC: 'S', VERSAOMINIMA: '1.2.3',
  }),
]);
const Q2_OK = ok(CONFIG_QUERIES.Q2.columns, [[1, 'Empresa X', 'S', 1001], [2, 'Empresa Y', 'N', null]]);
const Q3_OK = ok(CONFIG_QUERIES.Q3.columns, [
  [1000, 'TOP 1000', 'P', 'S', 'S', 'N', '2026-01-01 00:00:00'],
  [1001, 'TOP 1001', 'P', 'S', null, null, '2026-01-01 00:00:00'],
]);
const Q4_OK = ok(CONFIG_QUERIES.Q4.columns, [[2, 'ORÇAMENTO', 2, 1001]]);
const Q5_OK = ok(CONFIG_QUERIES.Q5.columns, [[23, 'Devolucao', 'S', 'S', 'N', '2026-01-01 00:00:00']]);
const Q6_OK = ok(CONFIG_QUERIES.Q6.columns, [[5, 'S'], [6, 'N']]);
const Q7_OK = ok(CONFIG_QUERIES.Q7.columns, [[1, 'Novo', 'Pedido novo', '9E9E9E', 'S', 'S', 'N']]);
const Q8_OK = ok(CONFIG_QUERIES.Q8.columns, [['S', 10], [null, 2]]);
const ALL_OK = () => [Q1_OK, Q2_OK, Q3_OK, Q4_OK, Q5_OK, Q6_OK, Q7_OK, Q8_OK];

function setup() {
  const clock: ClockRef = { now: Date.parse('2026-10-30T12:00:00Z') };
  const mock = new MockSankhya({ tables: {}, clock });
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

describe('RealSankhyaGateway.readConfigurationFacts over mocked HTTP', () => {
  it('sends Q1..Q8 verbatim through DbExplorerSP.executeQuery and types the rows', async () => {
    const { gateway, mock } = setup();
    mock.forced.push(...ALL_OK());
    const facts = await gateway.readConfigurationFacts();

    expect(mock.queries().map((q) => q.sql)).toEqual(CONFIG_QUERY_TEXTS);
    expect(mock.queries().every((q) => q.url.includes('serviceName=DbExplorerSP.executeQuery'))).toBe(true);
    expect(mock.maxInFlight).toBe(1);
    expect(failedConfigQueries(facts)).toEqual([]);
    expect(() => assertConfigurationFactsComplete(facts)).not.toThrow();
    expect(facts.readAt).toBe('2026-10-30T12:00:00.000Z');

    const q1 = facts.q1GeneralParameters;
    if (!q1.ok) throw new Error('Q1 failed');
    expect(q1.source.tables).toEqual(['AD_TVDYCFGFRC']);
    expect(q1.rows).toHaveLength(1);
    expect(q1.rows[0]).toMatchObject({
      nucfg: 1, orderStockLocationCode: 209, catalogReferenceTableCode: 5, alternativeTableCode: 5,
      decimalQuantities: true, historyDays: 90, purchasedWindowDays: 90, usesFinancial: true,
      hidesCreditLimit: null, // NULL = not read, never false
    });
    expect(q1.rows[0]?.informational['VERSAOMINIMA']).toBe('1.2.3');
    expect(q1.rows[0]?.informational).not.toHaveProperty('CODLOCALPEDIDOS');

    if (!facts.q2Companies.ok || !facts.q3EnabledTops.ok || !facts.q8ProductMobility.ok) throw new Error('failed');
    expect(facts.q2Companies.rows[1]).toMatchObject({ mobile: false, defaultOrderTopCode: null });
    expect(facts.q3EnabledTops.rows[0]).toMatchObject({ topCode: 1000, skipConfirmation: true });
    expect(facts.q3EnabledTops.rows[1]).toMatchObject({ skipConfirmation: null, allowInvoiceInApp: null });
    expect(facts.q8ProductMobility.rows).toEqual([{ mobile: true, count: 10 }, { mobile: null, count: 2 }]);
  });

  it('Q1 returning zero rows fails with a classified per-query marker', async () => {
    const { gateway, mock } = setup();
    const [, ...rest] = ALL_OK();
    mock.forced.push(ok(CONFIG_QUERIES.Q1.columns, []), ...rest);
    const facts = await gateway.readConfigurationFacts();
    expect(failedConfigQueries(facts).map((f) => f.id)).toEqual(['Q1']);
    expect(facts.q1GeneralParameters.ok === false && facts.q1GeneralParameters.error.code).toBe('configuration_row_count');
    expect(() => assertConfigurationFactsComplete(facts)).toThrow(SankhyaGatewayError);
  });

  it('Q1 returning two rows also fails', async () => {
    const { gateway, mock } = setup();
    const row = rowFor(CONFIG_QUERIES.Q1.columns, { NUCFG: 1 });
    const [, ...rest] = ALL_OK();
    mock.forced.push(ok(CONFIG_QUERIES.Q1.columns, [row, row]), ...rest);
    const facts = await gateway.readConfigurationFacts();
    expect(failedConfigQueries(facts).map((f) => f.id)).toEqual(['Q1']);
  });

  it('status "0" with ORA-00904 / ORA-00942 marks only that query as permanent and never succeeds silently', async () => {
    const { gateway, mock } = setup();
    mock.forced.push(
      Q1_OK, Q2_OK, Q3_OK, Q4_OK,
      sqlError('ORA-00942: table or view does not exist'),
      Q6_OK,
      sqlError('ORA-00904: "COR": invalid identifier'),
      Q8_OK,
    );
    const facts = await gateway.readConfigurationFacts();
    const failed = failedConfigQueries(facts);
    expect(failed.map((f) => f.id)).toEqual(['Q5', 'Q7']);
    expect(failed.every((f) => f.error.kind === 'permanent' && f.error.code === 'sql_error' && !f.error.retryable)).toBe(true);
    expect(failed[0]?.error.message).toContain('ORA-00942');
    expect(failed[1]?.error.message).toContain('ORA-00904');
    expect(facts.q6PriceTables.ok).toBe(true);
    expect(() => assertConfigurationFactsComplete(facts)).toThrowError(/Q5 \(sql_error\), Q7 \(sql_error\)/);
  });

  it('HTTP 403 GTW3403 that persists after the token renewal throws a classified auth error and stops', async () => {
    const { gateway, mock } = setup();
    const gtw = () => ({ status: 403, headers: {}, body: '{"error":{"codigo":"GTW3403"}}' });
    mock.forced.push(gtw(), gtw());
    const failure = await gateway.readConfigurationFacts().then(() => null, (e: unknown) => e);
    expect(failure).toBeInstanceOf(SankhyaGatewayError);
    expect((failure as SankhyaGatewayError).kind).toBe('auth');
    expect((failure as SankhyaGatewayError).retryable).toBe(false);
    expect(mock.queries()).toHaveLength(2); // Q1 and its single retry; Q2..Q8 never sent
  });

  it('HTTP 503 throws a retryable unavailable error', async () => {
    const { gateway, mock } = setup();
    mock.forced.push(httpStatus(503));
    const failure = await gateway.readConfigurationFacts().then(() => null, (e: unknown) => e);
    expect((failure as SankhyaGatewayError).kind).toBe('unavailable');
    expect((failure as SankhyaGatewayError).retryable).toBe(true);
  });

  it('a malformed cell (flag that is not S/N) marks the query as a validation failure without echoing the value', async () => {
    const { gateway, mock } = setup();
    const [q1, q2, , ...rest] = ALL_OK();
    mock.forced.push(
      q1 as ForcedResponse,
      q2 as ForcedResponse,
      ok(CONFIG_QUERIES.Q3.columns, [[1000, 'x', 'P', 'Z', null, null, null]]),
      ...(rest as ForcedResponse[]),
    );
    const facts = await gateway.readConfigurationFacts();
    const failed = failedConfigQueries(facts);
    expect(failed.map((f) => f.id)).toEqual(['Q3']);
    expect(failed[0]?.error.kind).toBe('validation');
    expect(failed[0]?.error.message).not.toContain("'Z'");
  });

  it('a result with different columns than the query fails closed (column missing in the ERP)', async () => {
    const { gateway, mock } = setup();
    const [q1, ...rest] = ALL_OK();
    mock.forced.push(q1 as ForcedResponse, ok(['CODEMP', 'NOMEFANTASIA'], [[1, 'x']]), ...(rest.slice(1) as ForcedResponse[]));
    const facts = await gateway.readConfigurationFacts();
    expect(failedConfigQueries(facts).map((f) => f.id)).toEqual(['Q2']);
  });

  it('never persists or returns credentials', async () => {
    const { gateway, mock } = setup();
    mock.forced.push(...ALL_OK());
    const facts = await gateway.readConfigurationFacts();
    expect(JSON.stringify(facts)).not.toMatch(/test-client|test-x-token|synthetic-token/);
  });
});

describe('pure helpers', () => {
  it('flagToBoolean: S/N, null is "not read" and never false, garbage is invalid', () => {
    expect(flagToBoolean('S')).toBe(true);
    expect(flagToBoolean('N')).toBe(false);
    expect(flagToBoolean(null)).toBeNull();
    expect(flagToBoolean('')).toBeNull();
    expect(flagToBoolean('X')).toBeUndefined();
  });
  it('isQuoteGroupName ignores accent and case', () => {
    expect(isQuoteGroupName('ORÇAMENTO')).toBe(true);
    expect(isQuoteGroupName(' orçamento ')).toBe(true);
    expect(isQuoteGroupName('PEDIDO')).toBe(false);
  });
});

describe('FakeGateway.readConfigurationFacts (PLAC code fixture)', () => {
  it('serves the PLAC values and is complete', async () => {
    const facts = await new FakeGateway().readConfigurationFacts();
    expect(facts).toBe(PLAC_CONFIGURATION_FACTS);
    expect(failedConfigQueries(facts)).toEqual([]);
    if (
      !facts.q1GeneralParameters.ok || !facts.q2Companies.ok || !facts.q3EnabledTops.ok || !facts.q4TopGroups.ok ||
      !facts.q5NegotiationTypes.ok || !facts.q7OrderStatuses.ok
    ) {
      throw new Error('fixture must be complete');
    }
    expect(facts.q3EnabledTops.rows.map((t) => t.topCode)).toEqual([1000, 1001, 1009, 1051, 1061, 2209, 2309]);
    expect(facts.q3EnabledTops.rows.filter((t) => t.skipConfirmation).map((t) => t.topCode)).toEqual([1000]);
    const enabled = facts.q2Companies.rows.filter((c) => c.mobile === true);
    expect(enabled).toHaveLength(1);
    expect(enabled[0]).toMatchObject({ companyCode: 1, defaultOrderTopCode: 1001 });
    expect(facts.q5NegotiationTypes.rows).toHaveLength(35);
    const codes = facts.q5NegotiationTypes.rows.map((r) => r.code);
    expect(codes).toContain(23);
    expect(codes).toContain(24);
    expect(facts.q1GeneralParameters.rows[0]).toMatchObject({
      orderStockLocationCode: 209, catalogReferenceTableCode: 5, alternativeTableCode: 5, decimalQuantities: true,
      historyDays: 90, purchasedWindowDays: 90, usesFinancial: true,
    });
    expect(facts.q7OrderStatuses.rows).toHaveLength(8);
    const quote = facts.q4TopGroups.rows.filter((g) => isQuoteGroupName(g.groupName));
    expect(quote.length).toBeGreaterThan(0);
    expect(quote.map((g) => g.topCode)).toEqual([1051]);
  });

  it('carries no person names or credential-like text', () => {
    const text = JSON.stringify(PLAC_CONFIGURATION_FACTS);
    expect(text).not.toMatch(/SECRET|TOKEN|SENHA|PASSWORD|BASICAUTH|@/i);
  });

  it('serves an injected fixture and honours an injected configuration fault', async () => {
    const custom: ConfigurationFacts = { ...PLAC_CONFIGURATION_FACTS, readAt: '2030-01-01T00:00:00.000Z' };
    expect(await new FakeGateway({ configurationFacts: custom }).readConfigurationFacts()).toBe(custom);
    const error = new SankhyaGatewayError('unavailable', { code: 'http_503', message: 'down' });
    const faulty = new FakeGateway({ faults: [{ entity: 'configuration', afterBatches: 0, error }] });
    await expect(faulty.readConfigurationFacts()).rejects.toBe(error);
  });
});
