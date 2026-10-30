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
    stockLocationCode: 209,
    orderDate: '2026-10-30',
    notes: null,
    items: [{ productCode: 55, quantity: '2.5', unit: 'UN', discountPercent: null }],
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
          CODVEND: wrap('7'),
        },
        itens: {
          INFORMARPRECO: wrap('False'),
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

  it('takes company, TOP, payment, location, unit and origin field from the request', () => {
    const body = JSON.stringify(
      buildIncluirNotaBody(request({ companyCode: 3, topCode: 1005, negotiationTypeCode: 2, stockLocationCode: 301, originField: 'AD_OUTRO', items: [{ productCode: 9, quantity: '1', unit: 'CX', discountPercent: null }] })),
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

  it('sends PERCDESC only for a real discount (D-7) and keeps decimal quantities', () => {
    const body = JSON.stringify(
      buildIncluirNotaBody(request({ items: [{ productCode: 1, quantity: '0.125', unit: 'KG', discountPercent: '8' }, { productCode: 2, quantity: '3', unit: 'UN', discountPercent: '0' }] })),
    );
    expect(body.match(/PERCDESC/g)).toHaveLength(1);
    expect(body).toContain('"PERCDESC":{"$":"8"}');
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
    const { erpOrderNumber } = await gateway.includeOrder(request({ items: [{ productCode: 55, quantity: '2', unit: 'UN', discountPercent: '8' }] }));
    expect(await gateway.findOrderByOrigin(FIELD, ORIGIN)).toEqual({ erpOrderNumber, confirmed: false });
    await gateway.confirmOrder(erpOrderNumber);
    await gateway.confirmOrder(erpOrderNumber);
    const reread = await gateway.readWrittenOrder(erpOrderNumber);
    expect(reread?.confirmed).toBe(true);
    expect(reread?.items).toEqual([{ productCode: 55, quantity: '2', unitPrice: '10', discountPercent: '8' }]);
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
  const LIVE = { enabled: true, mode: 'live', originField: FIELD } as const;

  function setup(options: { baseUrl?: string; allowedHosts?: readonly string[]; orderWrite?: typeof LIVE | undefined } = {}) {
    const clock: ClockRef = { now: 1_800_000_000_000 };
    const mock = new MockSankhya({ tables: erpTablesFromDataset(getDemoDataset()), clock });
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
      transport: mock.transport,
      now: () => clock.now,
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
    await expect(gateway.findOrderByOrigin(FIELD, ORIGIN)).rejects.toMatchObject({ kind: 'permanent', code: 'duplicate_origin' });
  });

  it('rereads header and item prices for the D-7 check', async () => {
    const { gateway, mock } = setup();
    mock.forced.push(ok(['NUNOTA', 'STATUSNOTA'], [[2475, 'A']]));
    mock.forced.push(ok(['CODPROD', 'QTDNEG', 'VLRUNIT', 'PERCDESC'], [[55, 2.5, 16.43, 8]]));
    expect(await gateway.readWrittenOrder(2475)).toEqual({
      erpOrderNumber: 2475,
      confirmed: false,
      items: [{ productCode: 55, quantity: '2.5', unitPrice: '16.43', discountPercent: '8' }],
    });
    await expect(gateway.readWrittenOrder(0)).rejects.toMatchObject({ kind: 'validation' });
  });
});
