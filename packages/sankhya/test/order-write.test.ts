import { describe, expect, it } from 'vitest';
import {
  FakeGateway,
  FakeOrderBook,
  GatewayConfigError,
  NotImplementedError,
  RealSankhyaGateway,
  Secret,
  SankhyaGatewayError,
  buildIncluirNotaBody,
  buildIncluirNotaRequestText,
  parseIncluirNotaResponse,
  type OrderWriteRequest,
} from '../src/index.js';
import {
  MockSankhya,
  TEST_CREDENTIALS,
  erpTablesFromDataset,
  httpStatus,
  ok,
  type ClockRef,
} from './support/mock-sankhya.js';
import { getDemoDataset } from '../src/index.js';

const ORIGIN = '0198f0a2-7b1c-7c3e-9a55-0123456789ab';
const FIELD = 'AD_SFORIGEM';

function request(overrides: Partial<OrderWriteRequest> = {}): OrderWriteRequest {
  return {
    originId: ORIGIN,
    originField: FIELD,
    customerCode: 1001,
    sellerCode: 7,
    companyCode: 1,
    topCode: 1001,
    negotiationTypeCode: 11,
    carrierCode: null,
    freightType: 'FOB',
    expedicao: false,
    stockLocationCode: 209,
    orderDate: '2026-10-30',
    notes: null,
    items: [{ productCode: 55, quantity: '2.5', unit: 'UN', discountPercent: null, listUnitPrice: '10' }],
    ...overrides,
  };
}

const wrap = (text: string) => ({ $: text });

describe('CACSP.incluirNota payload (SNK-7 D-8, F-44)', () => {
  it('matches the validated shape for one item and nothing is literal', () => {
    expect(buildIncluirNotaBody(request())).toEqual({
      nota: {
        cabecalho: {
          NUNOTA: {},
          CODPARC: wrap('1001'),
          DTNEG: wrap('30/10/2026'),
          CODTIPOPER: wrap('1001'),
          CODTIPVENDA: wrap('11'),
          CODEMP: wrap('1'),
          TIPMOV: wrap('P'),
          [FIELD]: wrap(ORIGIN),
          CIF_FOB: wrap('F'),
          TIPFRETE: wrap('N'),
          AD_EXPEDICAO: wrap('N'),
          CODVEND: wrap('7'),
        },
        itens: {
          INFORMARPRECO: 'False',
          item: [
            {
              NUNOTA: {},
              IGNOREDESCPROMOQTD: wrap('true'),
              CODPROD: wrap('55'),
              QTDNEG: wrap('2.5'),
              CODLOCALORIG: wrap('209'),
              CODVOL: wrap('UN'),
            },
          ],
        },
      },
    });
  });

  it.each([
    ['CIF', 'C', 'N'],
    ['FOB', 'F', 'N'],
    ['SEM_FRETE', 'S', 'S'],
  ] as const)('sends the freight %s as CIF_FOB %s and TIPFRETE %s', (freightType, cifFob, tipFrete) => {
    const header = (buildIncluirNotaBody(request({ freightType })) as { nota: { cabecalho: Record<string, unknown> } }).nota.cabecalho;
    expect(header['CIF_FOB']).toEqual(wrap(cifFob));
    expect(header['TIPFRETE']).toEqual(wrap(tipFrete));
  });

  it('refuses an unknown freight type before any request', () => {
    expect(() => buildIncluirNotaBody(request({ freightType: 'R' as never }))).toThrowError(expect.objectContaining({ kind: 'validation' }));
  });

  it('sends AD_EXPEDICAO as N for an order born unmarked and S only when the order carries the flag (D-O)', () => {
    const header = (expedicao: boolean) =>
      (buildIncluirNotaBody(request({ expedicao })) as { nota: { cabecalho: Record<string, unknown> } }).nota.cabecalho['AD_EXPEDICAO'];
    expect(header(false)).toEqual(wrap('N'));
    expect(header(true)).toEqual(wrap('S'));
  });

  it('takes company, TOP, payment, location, unit and origin field from the request', () => {
    const body = JSON.stringify(
      buildIncluirNotaBody(request({ companyCode: 3, topCode: 1005, negotiationTypeCode: 2, stockLocationCode: 301, originField: 'AD_OUTRO', items: [{ productCode: 9, quantity: '1', unit: 'CX', discountPercent: null, listUnitPrice: '10' }] })),
    );
    for (const expected of ['"CODEMP":{"$":"3"}', '"CODTIPOPER":{"$":"1005"}', '"CODTIPVENDA":{"$":"2"}', '"CODLOCALORIG":{"$":"301"}', '"CODVOL":{"$":"CX"}', '"AD_OUTRO"']) {
      expect(body).toContain(expected);
    }
    expect(body).not.toContain(FIELD);
  });

  it('sends the carrier only when the header has one, and the seller only when linked', () => {
    const without = JSON.stringify(buildIncluirNotaBody(request({ sellerCode: null })));
    expect(without).not.toContain('CODPARCTRANSP');
    expect(without).not.toContain('CODVEND');
    expect(JSON.stringify(buildIncluirNotaBody(request({ carrierCode: 88 })))).toContain('"CODPARCTRANSP":{"$":"88"}');
  });

  it('sends PERCDESC "8" on the discounted line and "0" on the other (INFORMARPRECO True, D-AK addendum) and keeps decimal quantities', () => {
    const body = JSON.stringify(
      buildIncluirNotaBody(request({ items: [{ productCode: 1, quantity: '0.125', unit: 'KG', discountPercent: '8', listUnitPrice: '10' }, { productCode: 2, quantity: '3', unit: 'UN', discountPercent: '0', listUnitPrice: '10' }] })),
    );
    expect(body.match(/PERCDESC/g)).toHaveLength(2);
    expect(body).toContain('"PERCDESC":{"$":"8"}');
    expect(body).toContain('"PERCDESC":{"$":"0"}');
    expect(body).toContain('"QTDNEG":{"$":"0.125"}');
  });

  it('cuts the note at 2000 characters and omits an empty note', () => {
    const long = JSON.stringify(buildIncluirNotaBody(request({ notes: 'x'.repeat(2500) })));
    expect(long).toContain(`"OBSERVACAO":{"$":"${'x'.repeat(2000)}"}`);
    expect(long).not.toContain('x'.repeat(2001));
    expect(JSON.stringify(buildIncluirNotaBody(request({ notes: '' })))).not.toContain('OBSERVACAO');
  });

  it('is deterministic and refuses a malformed date', () => {
    expect(buildIncluirNotaRequestText(request())).toBe(buildIncluirNotaRequestText(request()));
    expect(() => buildIncluirNotaBody(request({ orderDate: '30/10/2026' }))).toThrow(SankhyaGatewayError);
  });
});

describe('incluirNota response classification', () => {
  const success = JSON.stringify({ status: '1', responseBody: { pk: { NUNOTA: { $: '2475' } } }, transactionId: 't' });

  it('reads the order number from responseBody.pk.NUNOTA (F-44)', () => {
    expect(parseIncluirNotaResponse(200, success)).toEqual({ erpOrderNumber: 2475 });
  });

  it.each([
    [503, 'unavailable'],
    [401, 'auth'],
    [403, 'auth'],
    [429, 'rate_limit'],
    [500, 'temporary'],
    [400, 'validation'],
  ] as const)('HTTP %i is %s', (status, kind) => {
    const failure = catchError(() => parseIncluirNotaResponse(status, ''));
    expect(failure.kind).toBe(kind);
  });

  it('a 200 with status other than 1 is a validation refusal, never retried', () => {
    const failure = catchError(() => parseIncluirNotaResponse(200, JSON.stringify({ status: '0', statusMessage: 'Produto inativo' })));
    expect(failure.kind).toBe('validation');
    expect(failure.retryable).toBe(false);
    expect(failure.message).toContain('Produto inativo');
  });

  it('status 1 without a usable key is ambiguous (temporary): the order may exist', () => {
    for (const body of [JSON.stringify({ status: '1', responseBody: {} }), JSON.stringify({ status: '1', responseBody: { pk: { NUNOTA: { $: 'abc' } } } }), 'not json']) {
      expect(catchError(() => parseIncluirNotaResponse(200, body)).kind).toBe('temporary');
    }
  });

  it('keeps the Retry-After hint of a rate limit', () => {
    expect(catchError(() => parseIncluirNotaResponse(429, '', 7000)).retryAfterMs).toBe(7000);
  });
});

function catchError(action: () => unknown): SankhyaGatewayError {
  try {
    action();
  } catch (error) {
    if (error instanceof SankhyaGatewayError) return error;
    throw error;
  }
  throw new Error('expected a SankhyaGatewayError');
}

describe('fake order book (SNK-7)', () => {
  it('writes in memory, finds by origin, confirms and rereads', async () => {
    const book = new FakeOrderBook();
    const gateway = new FakeGateway({ orders: book });
    expect(await gateway.findOrderByOrigin(FIELD, ORIGIN)).toBeNull();
    const { erpOrderNumber } = await gateway.includeOrder(request({ items: [{ productCode: 55, quantity: '2', unit: 'UN', discountPercent: '8', listUnitPrice: '10' }] }));
    expect(await gateway.findOrderByOrigin(FIELD, ORIGIN)).toEqual({ erpOrderNumber, confirmed: false });
    await gateway.confirmOrder(erpOrderNumber);
    await gateway.confirmOrder(erpOrderNumber);
    const reread = await gateway.readWrittenOrder(erpOrderNumber);
    expect(reread?.confirmed).toBe(true);
    expect(reread?.items).toEqual([{ productCode: 55, quantity: '2', unitPrice: '10', discountPercent: '8', discountAmount: '1.60', ipiAmount: '0.00' }]);
  });

  it('has no native idempotency: a second include creates a second order', async () => {
    const book = new FakeOrderBook();
    const gateway = new FakeGateway({ orders: book });
    await gateway.includeOrder(request());
    await gateway.includeOrder(request());
    expect(book.orders).toHaveLength(2);
  });

  it('models the ambiguous failure: created, but the caller sees an error', async () => {
    const book = new FakeOrderBook();
    book.script('include', { kind: 'created_then_error', error: new SankhyaGatewayError('temporary', { code: 'timeout', message: 'timeout' }) });
    const gateway = new FakeGateway({ orders: book });
    await expect(gateway.includeOrder(request())).rejects.toMatchObject({ kind: 'temporary' });
    expect(await gateway.findOrderByOrigin(FIELD, ORIGIN)).not.toBeNull();
  });

  it('reports its capability as simulated and honours a cancelled signal', async () => {
    const gateway = new FakeGateway();
    expect(gateway.describe().capabilities.writes.submitOrder).toBe('simulated');
    const controller = new AbortController();
    controller.abort();
    await expect(gateway.includeOrder(request(), { signal: controller.signal })).rejects.toBeDefined();
  });
});

describe('real adapter order writes (mock transport only, no network)', () => {
  const SANDBOX_URL = 'https://api.sandbox.sankhya.com.br';
  const LIVE = { enabled: true, mode: 'live', originField: FIELD, requestBudget: null } as const;

  function setup(
    options: {
      baseUrl?: string;
      allowedHosts?: readonly string[];
      orderWrite?: typeof LIVE | undefined;
      timeouts?: { url: string; timeoutMs: number }[];
      includeTimeoutMs?: number;
    } = {},
  ) {
    const clock: ClockRef = { now: 1_800_000_000_000 };
    const mock = new MockSankhya({ tables: erpTablesFromDataset(getDemoDataset()), clock });
    const spy = options.timeouts;
    const transport: typeof mock.transport = (request) => {
      spy?.push({ url: request.url, timeoutMs: request.timeoutMs });
      return mock.transport(request);
    };
    const baseUrl = options.baseUrl ?? SANDBOX_URL;
    const gateway = new RealSankhyaGateway({
      baseUrl,
      allowedHosts: options.allowedHosts ?? [new URL(baseUrl).hostname],
      environmentKind: 'sandbox',
      credentials: {
        clientId: new Secret(TEST_CREDENTIALS.clientId),
        clientSecret: new Secret(TEST_CREDENTIALS.clientSecret),
        xToken: new Secret(TEST_CREDENTIALS.xToken),
      },
      transport,
      now: () => clock.now,
      ...(options.includeTimeoutMs !== undefined ? { includeTimeoutMs: options.includeTimeoutMs } : {}),
      ...(options.orderWrite !== undefined ? { orderWrite: options.orderWrite } : {}),
    });
    return { gateway, mock };
  }

  const okResponse = () => ({
    status: 200,
    headers: {},
    body: JSON.stringify({ status: '1', responseBody: { pk: { NUNOTA: { $: '2475' } } } }),
  });

  it('refuses without any HTTP call when order writing is not live', async () => {
    const { gateway, mock } = setup();
    await expect(gateway.includeOrder(request())).rejects.toBeInstanceOf(NotImplementedError);
    expect(mock.calls).toHaveLength(0);
    expect(gateway.describe().capabilities.writes.submitOrder).toBe('not_implemented');
  });

  it('refuses when the request names a different origin field than the configured one', async () => {
    const { gateway, mock } = setup({ orderWrite: LIVE });
    await expect(gateway.includeOrder(request({ originField: 'AD_OUTRO' }))).rejects.toBeInstanceOf(NotImplementedError);
    expect(mock.writes()).toHaveLength(0);
  });

  it('posts the F-44 request to the single incluirNota path on the Sandbox host', async () => {
    const { gateway, mock } = setup({ orderWrite: LIVE });
    mock.writeResponses.push(okResponse());
    await expect(gateway.includeOrder(request())).resolves.toEqual({ erpOrderNumber: 2475 });
    const [call] = mock.writes();
    expect(call?.url).toBe('https://api.sandbox.sankhya.com.br/gateway/v1/mgecom/service.sbr?serviceName=CACSP.incluirNota&outputType=json');
    expect(JSON.parse(call?.body ?? '{}')).toEqual({ serviceName: 'CACSP.incluirNota', requestBody: buildIncluirNotaBody(request()) });
    expect(gateway.describe().capabilities.writes.submitOrder).toBe('sandbox_only');
  });

  it('gives only the include a longer timeout (default 120 s, configurable); reads keep 30 s', async () => {
    const timeouts: { url: string; timeoutMs: number }[] = [];
    const { gateway, mock } = setup({ orderWrite: LIVE, timeouts });
    mock.writeResponses.push(okResponse());
    mock.forced.push(ok(['NUNOTA', 'STATUSNOTA'], []));
    await gateway.includeOrder(request());
    await gateway.findOrderByOrigin(FIELD, ORIGIN);
    const include = timeouts.find((entry) => entry.url.includes('CACSP.incluirNota'));
    expect(include?.timeoutMs).toBe(120_000);
    const reads = timeouts.filter((entry) => entry.url.includes('DbExplorerSP.executeQuery'));
    expect(reads.length).toBeGreaterThan(0);
    expect(reads.every((entry) => entry.timeoutMs === 30_000)).toBe(true);

    const custom: { url: string; timeoutMs: number }[] = [];
    const second = setup({ orderWrite: LIVE, timeouts: custom, includeTimeoutMs: 45_000 });
    second.mock.writeResponses.push(okResponse());
    await second.gateway.includeOrder(request());
    expect(custom.find((entry) => entry.url.includes('CACSP.incluirNota'))?.timeoutMs).toBe(45_000);
  });

  it('never writes to a host outside the Sandbox allow-list, even if the installation allow-list has it', async () => {
    const { gateway, mock } = setup({ baseUrl: 'https://erp.example.test', orderWrite: LIVE });
    await expect(gateway.includeOrder(request())).rejects.toBeInstanceOf(GatewayConfigError);
    expect(mock.writes()).toHaveLength(0);
  });

  it('renews an expired token once and resends the same body', async () => {
    const { gateway, mock } = setup({ orderWrite: LIVE });
    mock.writeResponses.push(okResponse(), okResponse());
    await gateway.includeOrder(request());
    mock.expireAllTokens();
    await gateway.includeOrder(request());
    const bodies = mock.writes().map((call) => call.body);
    expect(bodies).toHaveLength(3);
    expect(bodies[1]).toBe(bodies[2]);
    expect(mock.authCount).toBe(2);
  });

  it('a transport-level business error is classified, not retried by the adapter', async () => {
    const { gateway, mock } = setup({ orderWrite: LIVE });
    mock.writeResponses.push(httpStatus(503));
    await expect(gateway.includeOrder(request())).rejects.toMatchObject({ kind: 'unavailable' });
    expect(mock.writes()).toHaveLength(1);
  });

  it('confirmOrder is NEEDS VALIDATION and performs no HTTP call', async () => {
    const { gateway, mock } = setup({ orderWrite: LIVE });
    const failure = await gateway.confirmOrder(2475).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(NotImplementedError);
    expect((failure as Error).message).toContain('NEEDS VALIDATION');
    expect(mock.calls).toHaveLength(0);
  });

  it('looks an order up by origin with a strictly validated field and UUID', async () => {
    const { gateway, mock } = setup();
    mock.forced.push(ok(['NUNOTA', 'STATUSNOTA'], []));
    expect(await gateway.findOrderByOrigin(FIELD, ORIGIN)).toBeNull();
    expect(mock.queries().at(-1)?.sql).toBe(`SELECT NUNOTA, STATUSNOTA FROM TGFCAB WHERE ${FIELD} = '${ORIGIN}'`);
    await expect(gateway.findOrderByOrigin("AD_X'; DROP", ORIGIN)).rejects.toMatchObject({ kind: 'validation' });
    await expect(gateway.findOrderByOrigin(FIELD, "x' OR '1'='1")).rejects.toMatchObject({ kind: 'validation' });
    expect(mock.queries()).toHaveLength(1);
  });

  it('links a found order and flags a duplicated origin as permanent', async () => {
    const { gateway, mock } = setup();
    mock.forced.push(ok(['NUNOTA', 'STATUSNOTA'], [[2475, 'A']]));
    expect(await gateway.findOrderByOrigin(FIELD, ORIGIN)).toEqual({ erpOrderNumber: 2475, confirmed: false });
    mock.forced.push(ok(['NUNOTA', 'STATUSNOTA'], [[2475, 'A'], [2476, 'A']]));
    await expect(gateway.findOrderByOrigin(FIELD, ORIGIN)).rejects.toMatchObject({ kind: 'permanent', code: 'ambiguous_origin', erpOrderNumbers: [2475, 2476] });
  });

  it('reads the release lines of included notes with SELECTs only, never the releasing user', async () => {
    const { gateway, mock } = setup();
    mock.forced.push(ok(['NUNOTA', 'STATUSNOTA', 'AD_STATUS', 'PENDENTE'], [[2506, 'A', null, 'S'], [2507, 'L', 'X', 'N'], [2508, 'L', null, 'N']]));
    mock.forced.push(
      ok(
        ['NUCHAVE', 'EVENTO', 'DHLIB', 'REPROVADO', 'VLRLIBERADO'],
        [
          [2506, 44, null, 'N', null],
          [2506, 2, null, null, 0],
          [2506, 3, '10/11/2026 09:10:00', 'N', 152.4],
          [2507, 13, null, 'S', null],
          [2508, 2, '10/11/2026 09:10:00', 'N', 0],
        ],
      ),
    );
    mock.forced.push(ok(['EVENTO', 'DESCRICAO'], [[2, ' Desconto   de produto '], [3, 'Limite de crédito'], [13, 'Valor mínimo'], [44, 'Liberação exigida pela TOP']]));
    const readings = await gateway.readOrderReleaseFacts([2506, 2507, 2508, 9999]);
    const sqls = mock.queries().map((query) => query.sql);
    expect(sqls).toEqual([
      'SELECT NUNOTA, STATUSNOTA, AD_STATUS, PENDENTE FROM TGFCAB WHERE NUNOTA IN (2506,2507,2508,9999)',
      "SELECT NUCHAVE, EVENTO, DHLIB, REPROVADO, VLRLIBERADO FROM TSILIB WHERE TABELA = 'TGFCAB' AND NUCHAVE IN (2506,2507,2508,9999)",
      'SELECT EVENTO, DESCRICAO FROM VGFLIBEVE WHERE EVENTO IN (2,3,13,44)',
    ]);
    for (const sql of sqls) expect(sql).toMatch(/^SELECT /);
    expect(sqls.join(' ')).not.toContain('CODUSULIB');
    expect(readings).toEqual([
      {
        erpOrderNumber: 2506,
        found: true,
        statusNota: 'A',
        adStatus: null,
        pending: 'S',
        lines: [
          { event: 44, description: 'Liberação exigida pela TOP', released: false, denied: false },
          { event: 2, description: 'Desconto de produto', released: false, denied: false },
          { event: 3, description: 'Limite de crédito', released: true, denied: false },
        ],
      },
      // Denied by REPROVADO = 'S'.
      { erpOrderNumber: 2507, found: true, statusNota: 'L', adStatus: 'X', pending: 'N', lines: [{ event: 13, description: 'Valor mínimo', released: false, denied: true }] },
      // Denied by VLRLIBERADO = 0 on a dated line (a normal release, above, has an amount above zero).
      { erpOrderNumber: 2508, found: true, statusNota: 'L', adStatus: null, pending: 'N', lines: [{ event: 2, description: 'Desconto de produto', released: true, denied: true }] },
      { erpOrderNumber: 9999, found: false, statusNota: null, adStatus: null, pending: null, lines: [] },
    ]);
  });

  it('keeps the release state when only the event description query is refused, and fails on any other error', async () => {
    const first = setup();
    first.mock.forced.push(ok(['NUNOTA', 'STATUSNOTA', 'AD_STATUS', 'PENDENTE'], [[2506, 'A', null, null]]));
    first.mock.forced.push(ok(['NUCHAVE', 'EVENTO', 'DHLIB', 'REPROVADO', 'VLRLIBERADO'], [[2506, 44, null, null, null]]));
    first.mock.forced.push(httpStatus(400));
    expect((await first.gateway.readOrderReleaseFacts([2506]))[0]?.lines).toEqual([{ event: 44, description: null, released: false, denied: false }]);
    const second = setup();
    second.mock.forced.push(ok(['NUNOTA', 'STATUSNOTA', 'AD_STATUS', 'PENDENTE'], [[2506, 'A', null, null]]));
    second.mock.forced.push(ok(['NUCHAVE', 'EVENTO', 'DHLIB', 'REPROVADO', 'VLRLIBERADO'], [[2506, 44, null, null, null]]));
    second.mock.forced.push(httpStatus(503));
    await expect(second.gateway.readOrderReleaseFacts([2506])).rejects.toBeInstanceOf(SankhyaGatewayError);
  });

  it('refuses an order number that is not a positive integer before any query', async () => {
    const { gateway, mock } = setup();
    await expect(gateway.readOrderReleaseFacts([2506, 0])).rejects.toMatchObject({ kind: 'validation' });
    await expect(gateway.readOrderReleaseFacts([1.5])).rejects.toMatchObject({ kind: 'validation' });
    expect(mock.queries()).toHaveLength(0);
  });

  it('rereads header and item prices for the D-7 check', async () => {
    const { gateway, mock } = setup();
    mock.forced.push(ok(['NUNOTA', 'STATUSNOTA', 'VLRNOTA', 'VLRIPI'], [[2475, 'A', 274.85, 8.65]]));
    mock.forced.push(ok(['CODPROD', 'QTDNEG', 'VLRUNIT', 'PERCDESC', 'VLRDESC', 'VLRIPI'], [[55, 2.5, 16.43, 8, 3.29, 1.5]]));
    expect(await gateway.readWrittenOrder(2475)).toEqual({
      erpOrderNumber: 2475,
      confirmed: false,
      totalAmount: '274.85',
      ipiAmount: '8.65',
      items: [{ productCode: 55, quantity: '2.5', unitPrice: '16.43', discountPercent: '8', discountAmount: '3.29', ipiAmount: '1.5' }],
    });
    await expect(gateway.readWrittenOrder(0)).rejects.toMatchObject({ kind: 'validation' });
  });
});
