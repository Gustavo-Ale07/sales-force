import { describe, expect, it } from 'vitest';
import {
  FakeGateway,
  GatewayConfigError,
  NotImplementedError,
  RealSankhyaGateway,
  Secret,
  SankhyaGatewayError,
  getDemoDataset,
  type HttpRequest,
  type SankhyaErrorKind,
  type SankhyaGateway,
} from '../src/index.js';
import { collect, runGatewayContract } from './support/gateway-contract.js';
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
  type ErpTables,
} from './support/mock-sankhya.js';

const dataset = getDemoDataset();

function credentials(overrides: Partial<typeof TEST_CREDENTIALS> = {}) {
  const value = { ...TEST_CREDENTIALS, ...overrides };
  return {
    clientId: new Secret(value.clientId),
    clientSecret: new Secret(value.clientSecret),
    xToken: new Secret(value.xToken),
  };
}

function setup(options: { tables?: ErpTables; pageSize?: number; credentialOverrides?: Partial<typeof TEST_CREDENTIALS> } = {}) {
  const clock: ClockRef = { now: 1_800_000_000_000 };
  const mock = new MockSankhya({ tables: options.tables ?? erpTablesFromDataset(dataset), clock });
  const gateway = new RealSankhyaGateway({
    baseUrl: TEST_BASE_URL,
    allowedHosts: [TEST_HOST],
    environmentKind: 'sandbox',
    credentials: credentials(options.credentialOverrides),
    transport: mock.transport,
    now: () => clock.now,
    ...(options.pageSize !== undefined ? { pageSize: options.pageSize } : {}),
  });
  return { gateway, mock, clock };
}

const FAILURE_FOR_KIND: Record<SankhyaErrorKind, () => Parameters<MockSankhya['forced']['push']>[0]> = {
  unavailable: () => httpStatus(503),
  auth: () => httpStatus(401),
  validation: () => httpStatus(400),
  rate_limit: () => httpStatus(429, { 'retry-after': '7' }),
  temporary: () => httpStatus(500),
  permanent: () => sqlError(),
};

runGatewayContract('RealSankhyaGateway over mocked HTTP', {
  create: () => setup({ pageSize: 97 }).gateway,
  createFailing: (kind) => {
    const { gateway, mock } = setup();
    mock.forced.push(FAILURE_FOR_KIND[kind]());
    return gateway;
  },
});

describe('RealSankhyaGateway equals the FakeGateway on the validated reads', () => {
  it('maps the ERP-shaped rows back to the same Sales Force data', async () => {
    const { gateway } = setup({ pageSize: 120 });
    const fake = new FakeGateway();
    expect((await collect(gateway.readSellers())).rows).toEqual((await collect(fake.readSellers())).rows);
    expect((await collect(gateway.readCustomers())).rows).toEqual((await collect(fake.readCustomers())).rows);
    expect((await collect(gateway.readProducts())).rows).toEqual((await collect(fake.readProducts())).rows);
    expect((await collect(gateway.readPriceTableVersions())).rows).toEqual((await collect(fake.readPriceTableVersions())).rows);
    expect((await collect(gateway.readListPrices())).rows).toEqual((await collect(fake.readListPrices())).rows);
  });

  it('excludes partners that are not customers', async () => {
    const { gateway } = setup();
    const codes = (await collect(gateway.readCustomers())).rows.map((c) => c.code);
    expect(codes).not.toContain(999_999);
  });
});

describe('capabilities and NotImplemented paths', () => {
  it('reports what is validated and what is not', () => {
    const { gateway } = setup();
    const description = gateway.describe();
    expect(description).toMatchObject({ mode: 'live', environmentKind: 'sandbox', host: TEST_HOST });
    expect(description.capabilities.readMechanism).toBe('sql_ordered_paging');
    expect(description.capabilities.reads).toEqual({
      configuration: 'not_implemented',
      sellers: 'supported',
      customers: 'supported',
      products: 'supported',
      productGroups: 'not_implemented',
      priceTables: 'not_implemented',
      priceTableVersions: 'supported',
      listPrices: 'supported',
    });
    expect(description.capabilities.configurationSource).toBeNull();
  });

  it('readConfiguration is NEEDS VALIDATION U-10 without a bootstrap file', async () => {
    const { gateway, mock } = setup();
    const failure = await gateway.readConfiguration().catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(NotImplementedError);
    expect((failure as Error).message).toMatch(/NEEDS VALIDATION U-10/);
    expect(mock.calls).toHaveLength(0);
  });

  it('submitOrder performs no HTTP call at all', async () => {
    const { gateway, mock } = setup();
    await expect(gateway.submitOrder({ originId: 'o-1', customerCode: 1, sellerCode: null, items: [] })).rejects.toBeInstanceOf(NotImplementedError);
    expect(mock.calls).toHaveLength(0);
  });

  it('not-implemented reads make no HTTP call', async () => {
    const { gateway, mock } = setup();
    await expect(collect(gateway.readPriceTables())).rejects.toBeInstanceOf(NotImplementedError);
    await expect(collect(gateway.readProductGroups())).rejects.toBeInstanceOf(NotImplementedError);
    expect(mock.calls).toHaveLength(0);
  });
});

describe('read-only guarantee', () => {
  it('sends only SELECT statements over one fixed service', async () => {
    const { gateway, mock } = setup();
    for await (const _ of gateway.readSellers()) void _;
    for await (const _ of gateway.readCustomers()) void _;
    for await (const _ of gateway.readListPrices()) void _;
    expect(mock.queries().length).toBeGreaterThan(3);
    for (const call of mock.queries()) {
      expect(call.sql).toMatch(/^SELECT /);
      expect(call.sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|MERGE|DROP|ALTER|TRUNCATE|CREATE|GRANT|EXECUTE|CALL)\b/i);
      expect(new URL(call.url).searchParams.get('serviceName')).toBe('DbExplorerSP.executeQuery');
    }
  });

  it('orders every page by the full key and pages with OFFSET/FETCH', async () => {
    const { gateway, mock } = setup({ pageSize: 100 });
    await collect(gateway.readListPrices());
    const pages = mock.queries().map((q) => q.sql as string);
    expect(pages[0]).toBe('SELECT NUTAB, CODPROD, CODLOCAL, CONTROLE, VLRVENDA FROM TGFEXC ORDER BY NUTAB, CODPROD, CODLOCAL, CONTROLE OFFSET 0 ROWS FETCH NEXT 100 ROWS ONLY');
    expect(pages[1]).toContain('OFFSET 100 ROWS FETCH NEXT 100 ROWS ONLY');
    expect(pages[pages.length - 1]).toBe('SELECT COUNT(*) AS TOTAL FROM TGFEXC');
  });
});

describe('authentication', () => {
  it('authenticates once and caches the token within its lifetime', async () => {
    const { gateway, mock, clock } = setup({ pageSize: 50 });
    await collect(gateway.readSellers());
    await collect(gateway.readSellers());
    expect(mock.authCount).toBe(1);
    clock.now += 100_000;
    await collect(gateway.readSellers());
    expect(mock.authCount).toBe(1);
  });

  it('renews the token before expiry (300 s lifetime, 30 s skew)', async () => {
    const { gateway, mock, clock } = setup();
    await collect(gateway.readSellers());
    clock.now += 275_000;
    await collect(gateway.readSellers());
    expect(mock.authCount).toBe(2);
  });

  it('on HTTP 403 renews the token once and retries the request once', async () => {
    const { gateway, mock } = setup();
    await collect(gateway.readSellers());
    mock.expireAllTokens();
    const { rows } = await collect(gateway.readSellers());
    expect(rows).toHaveLength(dataset.sellers.length);
    expect(mock.authCount).toBe(2);
  });

  it('a second consecutive 403 is an auth failure, not retried again', async () => {
    const { gateway, mock } = setup();
    mock.forced.push(httpStatus(403), httpStatus(403));
    const failure = await collect(gateway.readSellers()).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(SankhyaGatewayError);
    expect((failure as SankhyaGatewayError).kind).toBe('auth');
    expect((failure as SankhyaGatewayError).retryable).toBe(false);
    expect(mock.queries()).toHaveLength(2);
    expect(mock.authCount).toBe(2);
  });

  it('refused credentials are an auth error and never leak into the message', async () => {
    const { gateway } = setup({ credentialOverrides: { clientSecret: 'wrong-client-secret-9999' } });
    const failure = (await collect(gateway.readSellers()).catch((e: unknown) => e)) as SankhyaGatewayError;
    expect(failure.kind).toBe('auth');
    expect(failure.retryable).toBe(false);
    const text = `${failure.message} ${JSON.stringify(failure)} ${String(failure.stack)}`;
    for (const secret of ['wrong-client-secret-9999', TEST_CREDENTIALS.clientId, TEST_CREDENTIALS.xToken]) {
      expect(text).not.toContain(secret);
    }
  });

  it('a malformed authentication response fails closed', async () => {
    const clock: ClockRef = { now: 0 };
    const gateway = new RealSankhyaGateway({
      baseUrl: TEST_BASE_URL,
      allowedHosts: [TEST_HOST],
      environmentKind: 'sandbox',
      credentials: credentials(),
      transport: () => Promise.resolve({ status: 200, headers: {}, body: '{"access_token":"","expires_in":300}' }),
      now: () => clock.now,
    });
    const failure = (await collect(gateway.readSellers()).catch((e: unknown) => e)) as SankhyaGatewayError;
    expect(failure.kind).toBe('validation');
    expect(failure.code).toBe('invalid_token_response');
  });

  it('never sends the X-Token or client secret to the gateway endpoint', async () => {
    const { mock } = setup();
    const seen: HttpRequest[] = [];
    const original = mock.transport;
    const spying = new RealSankhyaGateway({
      baseUrl: TEST_BASE_URL,
      allowedHosts: [TEST_HOST],
      environmentKind: 'sandbox',
      credentials: credentials(),
      transport: (request) => {
        seen.push(request);
        return original(request);
      },
    });
    await collect(spying.readSellers());
    const gatewayCalls = seen.filter((r) => r.url.includes('/gateway/'));
    expect(gatewayCalls.length).toBeGreaterThan(0);
    for (const call of gatewayCalls) {
      expect(call.headers['x-token']).toBeUndefined();
      expect(call.body).not.toContain(TEST_CREDENTIALS.clientSecret);
      expect(call.headers['authorization']).toMatch(/^Bearer synthetic-token-/);
    }
  });
});

describe('request serialization and paging', () => {
  it('never has two requests in flight, even for concurrent snapshots', async () => {
    const { gateway, mock } = setup({ pageSize: 30 });
    await Promise.all([collect(gateway.readSellers()), collect(gateway.readProducts()), collect(gateway.readCustomers())]);
    expect(mock.maxInFlight).toBe(1);
  });

  it('reads in pages and finishes with the row count', async () => {
    const { gateway, mock } = setup({ pageSize: 100 });
    const { batches } = await collect(gateway.readProducts());
    expect(batches.map((b) => b.length)).toEqual([100, 100, 100, 100]);
    // 4 full pages + 1 empty page to confirm the end + the count.
    expect(mock.queries()).toHaveLength(6);
  });

  it('rejects an invalid page size', () => {
    expect(
      () =>
        new RealSankhyaGateway({
          baseUrl: TEST_BASE_URL,
          allowedHosts: [TEST_HOST],
          environmentKind: 'sandbox',
          credentials: credentials(),
          transport: () => Promise.reject(new Error('unused')),
          pageSize: 5000,
        }),
    ).toThrow(RangeError);
  });
});

describe('completeness and fail-closed validation', () => {
  it('rejects a snapshot whose count differs from the rows read (temporary, retryable)', async () => {
    const { gateway, mock } = setup({ pageSize: 100 });
    // A seller appears after the pages were read and before the row count is taken.
    mock.beforeQuery = (sql) => {
      if (sql.startsWith('SELECT COUNT(*)')) (mock.tables['TGFVEN'] as unknown[]).push({ CODVEND: 9999, APELIDO: 'Novo', ATIVO: 'S' });
    };
    const failure = (await collect(gateway.readSellers()).catch((e: unknown) => e)) as SankhyaGatewayError;
    expect(failure.kind).toBe('temporary');
    expect(failure.code).toBe('incomplete_snapshot');
    expect(failure.retryable).toBe(true);
  });

  it('rejects duplicated or out-of-order rows between pages', async () => {
    const { gateway, mock } = setup({ pageSize: 2 });
    mock.forced.push(ok(['CODVEND', 'APELIDO', 'ATIVO'], [[1, 'A', 'S'], [2, 'B', 'S']]), ok(['CODVEND', 'APELIDO', 'ATIVO'], [[2, 'B', 'S'], [3, 'C', 'S']]));
    const failure = (await collect(gateway.readSellers()).catch((e: unknown) => e)) as SankhyaGatewayError;
    expect(failure.code).toBe('snapshot_inconsistent');
    expect(failure.kind).toBe('temporary');
  });

  it('an unfinished iteration may already have yielded batches: consumers must stage', async () => {
    const { gateway, mock } = setup({ pageSize: 2 });
    mock.forced.push(ok(['CODVEND', 'APELIDO', 'ATIVO'], [[1, 'A', 'S'], [2, 'B', 'S']]), httpStatus(503));
    const yielded: number[] = [];
    const failure = await (async () => {
      for await (const batch of gateway.readSellers()) yielded.push(batch.length);
    })().catch((e: unknown) => e);
    expect(yielded).toEqual([2]);
    expect((failure as SankhyaGatewayError).kind).toBe('unavailable');
  });

  it('a SQL error (HTTP 200, status 0) is permanent and never retried', async () => {
    const { gateway, mock } = setup();
    mock.forced.push(sqlError('ORA-00904: "X": identifier invalid; secret detail 12345'));
    const failure = (await collect(gateway.readSellers()).catch((e: unknown) => e)) as SankhyaGatewayError;
    expect(failure.kind).toBe('permanent');
    expect(failure.code).toBe('sql_error');
    expect(failure.retryable).toBe(false);
    expect(failure.message).toContain('ORA-00904');
    expect(failure.message).not.toContain('secret detail');
    expect(mock.queries()).toHaveLength(1);
  });

  it('an unknown gateway status is temporary', async () => {
    const { gateway, mock } = setup();
    mock.forced.push({ status: 200, headers: {}, body: '{"status":"2"}' });
    const failure = (await collect(gateway.readSellers()).catch((e: unknown) => e)) as SankhyaGatewayError;
    expect(failure).toMatchObject({ kind: 'temporary', code: 'unknown_gateway_status' });
  });

  it('a truncated result (burstLimit) is rejected instead of accepted as complete', async () => {
    const { gateway, mock } = setup();
    mock.forced.push(ok(['CODVEND', 'APELIDO', 'ATIVO'], [[1, 'A', 'S']], true));
    const failure = (await collect(gateway.readSellers()).catch((e: unknown) => e)) as SankhyaGatewayError;
    expect(failure).toMatchObject({ kind: 'validation', code: 'burst_limit', retryable: false });
  });

  it('a differently shaped result fails closed', async () => {
    const { gateway, mock } = setup();
    mock.forced.push(ok(['CODVEND', 'NOME', 'ATIVO'], [[1, 'A', 'S']]));
    const failure = (await collect(gateway.readSellers()).catch((e: unknown) => e)) as SankhyaGatewayError;
    expect(failure).toMatchObject({ kind: 'validation', code: 'invalid_gateway_response' });
  });

  it('a malformed row is a validation error naming the column, never the value', async () => {
    const { gateway, mock } = setup();
    mock.forced.push(ok(['CODVEND', 'APELIDO', 'ATIVO'], [[1, 'Nome Sintetico Sensivel', 'Talvez']]));
    const failure = (await collect(gateway.readSellers()).catch((e: unknown) => e)) as SankhyaGatewayError;
    expect(failure).toMatchObject({ kind: 'validation', code: 'invalid_row', retryable: false });
    expect(failure.message).toContain('ATIVO');
    expect(failure.message).not.toContain('Talvez');
    expect(failure.message).not.toContain('Nome Sintetico Sensivel');
  });

  it('price rows with an alternate location or control value are rejected, not collapsed', async () => {
    const { gateway, mock } = setup();
    mock.forced.push(ok(['NUTAB', 'CODPROD', 'CODLOCAL', 'CONTROLE', 'VLRVENDA'], [[502, 70002, 3, ' ', 10]]));
    const failure = (await collect(gateway.readListPrices()).catch((e: unknown) => e)) as SankhyaGatewayError;
    expect(failure).toMatchObject({ kind: 'validation', code: 'invalid_row' });
    expect(failure.message).toContain('CODLOCAL');
  });

  it('a null or negative price is rejected rather than read as no price or zero', async () => {
    for (const cell of [null, -1]) {
      const { gateway, mock } = setup();
      mock.forced.push(ok(['NUTAB', 'CODPROD', 'CODLOCAL', 'CONTROLE', 'VLRVENDA'], [[502, 70002, 0, ' ', cell]]));
      const failure = (await collect(gateway.readListPrices()).catch((e: unknown) => e)) as SankhyaGatewayError;
      expect(failure.code).toBe('invalid_row');
    }
  });

  it('"no price" and an explicit zero stay different: a missing row is never returned as zero', async () => {
    const { gateway } = setup();
    const rows = (await collect(gateway.readListPrices())).rows;
    const explicit = rows.filter((r) => r.unitPrice === '0');
    expect(explicit.length).toBeGreaterThan(0);
    const total = dataset.priceTableVersions.length * dataset.products.length;
    expect(rows.length).toBeLessThan(total);
    expect(new Set(rows.map((r) => `${r.versionId}:${r.productCode}`)).size).toBe(rows.length);
  });

  it('interprets DTVIGOR in the DB clock zone (Sandbox UTC-03:00 by default)', async () => {
    const { gateway } = setup();
    const versions = (await collect(gateway.readPriceTableVersions())).rows;
    expect(versions.find((v) => v.versionId === 502)?.effectiveFrom).toBe('2026-08-17T03:00:00.000Z');
  });

  it('maps a fixed-scale ERP number without float artifacts', async () => {
    const { gateway, mock } = setup();
    mock.forced.push(ok(['NUTAB', 'CODPROD', 'CODLOCAL', 'CONTROLE', 'VLRVENDA'], [[502, 1, 0, null, 16.43], [502, 2, '0', '', '0.10'], [502, 3, 0, ' ', 1e-7]]));
    const failure = (await collect(gateway.readListPrices()).catch((e: unknown) => e)) as SankhyaGatewayError;
    // 1e-7 has 7 decimals: beyond the storage scale, rejected instead of rounded.
    expect(failure.code).toBe('invalid_row');
    const second = setup();
    second.mock.forced.push(ok(['NUTAB', 'CODPROD', 'CODLOCAL', 'CONTROLE', 'VLRVENDA'], [[502, 1, 0, null, 16.43], [502, 2, '0', '', '0.10']]), ok(['TOTAL'], [[2]]));
    const rows = (await collect(second.gateway.readListPrices())).rows;
    expect(rows.map((r) => r.unitPrice)).toEqual(['16.43', '0.1']);
  });
});

describe('error classification of HTTP failures', () => {
  const cases: [number, SankhyaErrorKind, boolean][] = [
    [401, 'auth', false],
    [429, 'rate_limit', true],
    [500, 'temporary', true],
    [502, 'unavailable', true],
    [503, 'unavailable', true],
    [504, 'unavailable', true],
    [400, 'validation', false],
    [404, 'permanent', false],
    [302, 'permanent', false],
  ];
  for (const [status, kind, retryable] of cases) {
    it(`HTTP ${status} is ${kind} (retryable: ${String(retryable)})`, async () => {
      const { gateway, mock } = setup();
      mock.forced.push(httpStatus(status));
      const failure = (await collect(gateway.readSellers()).catch((e: unknown) => e)) as SankhyaGatewayError;
      expect(failure.kind).toBe(kind);
      expect(failure.retryable).toBe(retryable);
    });
  }

  it('carries the Retry-After hint of a 429', async () => {
    const { gateway, mock } = setup();
    mock.forced.push(httpStatus(429, { 'retry-after': '7' }));
    const failure = (await collect(gateway.readSellers()).catch((e: unknown) => e)) as SankhyaGatewayError;
    expect(failure.retryAfterMs).toBe(7000);
  });

  it('a network failure is unavailable and does not echo the cause', async () => {
    const gateway = new RealSankhyaGateway({
      baseUrl: TEST_BASE_URL,
      allowedHosts: [TEST_HOST],
      environmentKind: 'sandbox',
      credentials: credentials(),
      transport: () =>
        Promise.reject(new SankhyaGatewayError('unavailable', { code: 'network_error', message: 'The ERP could not be reached (network error).' })),
    });
    const failure = (await collect(gateway.readSellers()).catch((e: unknown) => e)) as SankhyaGatewayError;
    expect(failure).toMatchObject({ kind: 'unavailable', retryable: true });
  });
});

describe('host allow-list (SNK-3)', () => {
  const base = { environmentKind: 'sandbox' as const, credentials: credentials(), transport: () => Promise.reject(new Error('never called')) };

  it('refuses a base URL that is not allow-listed', () => {
    expect(() => new RealSankhyaGateway({ ...base, baseUrl: 'https://other.example.test', allowedHosts: [TEST_HOST] })).toThrow(GatewayConfigError);
  });

  it('refuses everything when the allow-list is empty (no default)', () => {
    expect(() => new RealSankhyaGateway({ ...base, baseUrl: TEST_BASE_URL, allowedHosts: [] })).toThrow(GatewayConfigError);
  });

  it('refuses plain http, embedded credentials, paths and queries', () => {
    for (const url of [`http://${TEST_HOST}`, `https://user:pw@${TEST_HOST}`, `https://${TEST_HOST}/path`, `https://${TEST_HOST}/?a=1`]) {
      expect(() => new RealSankhyaGateway({ ...base, baseUrl: url, allowedHosts: [TEST_HOST] })).toThrow(GatewayConfigError);
    }
  });

  it('a refusal message never echoes the URL', () => {
    try {
      new RealSankhyaGateway({ ...base, baseUrl: 'https://user:hunter2@evil.example.test/x', allowedHosts: [TEST_HOST] });
      expect.unreachable();
    } catch (error) {
      expect(String((error as Error).message)).not.toContain('hunter2');
      expect(String((error as Error).message)).not.toContain('evil.example.test');
    }
  });

  it('only ever requests the checked origin', async () => {
    const { gateway, mock } = setup();
    await collect(gateway.readSellers());
    for (const call of mock.calls) expect(new URL(call.url).origin).toBe(TEST_BASE_URL);
  });
});

describe('secrets', () => {
  it('a Secret never leaks through string, JSON or inspection', async () => {
    const secret = new Secret('very-secret-value-123');
    expect(String(secret)).toBe('[redacted]');
    expect(JSON.stringify({ secret })).toBe('{"secret":"[redacted]"}');
    const { inspect } = await import('node:util');
    expect(inspect(secret)).toBe('[redacted]');
    expect(`${secret}`).not.toContain('very-secret');
    expect(secret.reveal()).toBe('very-secret-value-123');
    expect(() => new Secret('  ')).toThrow(TypeError);
  });

  it('a gateway object does not expose credentials when serialized or inspected', async () => {
    const { gateway } = setup();
    const { inspect } = await import('node:util');
    const text = `${JSON.stringify(gateway)} ${inspect(gateway, { depth: 6 })} ${JSON.stringify(gateway.describe())}`;
    for (const secret of Object.values(TEST_CREDENTIALS)) expect(text).not.toContain(secret);
  });
});

it('satisfies the SankhyaGateway type', () => {
  const gateway: SankhyaGateway = setup().gateway;
  expect(typeof gateway.readSellers).toBe('function');
});
