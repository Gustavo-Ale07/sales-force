import { isValidCnpj } from '@salesforce/domain';
import { describe, expect, it } from 'vitest';
import {
  GatewayConfigError,
  NotImplementedError,
  PARTNER_FORBIDDEN_COLUMNS,
  PartnerFieldError,
  RealSankhyaGateway,
  SankhyaGatewayError,
  Secret,
  buildPartnerCreateRequestText,
  buildPartnerEditRequestText,
  classifyPartnerRefusal,
  createGateway,
  type CustomerWriteSettings,
  type PartnerWriteRequest,
} from '../src/index.js';
import type { HttpResponse, HttpTransport } from '../src/real/transport.js';
import { MockSankhya, TEST_CREDENTIALS, ok, type ClockRef } from './support/mock-sankhya.js';

const FIELD = 'AD_FORCEORIGEM';
const KEY = 'force:0198f0a2-7b1c-7c3e-9a55-0123456789ab';
const KEY_2 = 'force:0198f0a2-7b1c-7c3e-9a55-0123456789ac';
const CNPJ = '11222333000181';
const CPF = '52998224725';
const URL_SANDBOX = 'https://api.sandbox.sankhya.com.br';
const OPEN: CustomerWriteSettings = { enabled: true, originField: FIELD, priceTableCode: 5 };

function request(overrides: Partial<PartnerWriteRequest> = {}): PartnerWriteRequest {
  return {
    originField: FIELD,
    originKey: KEY,
    document: CNPJ,
    personType: 'company',
    name: 'TESTE FORCE - NAO USAR Ltda',
    tradeName: 'TESTE FORCE - NAO USAR',
    icmsClassification: 'R',
    stateRegistration: '123456789',
    sellerCode: 7,
    priceTableCode: 5,
    phone: '11999990000',
    email: 'contato@example.test',
    notes: 'observacao de teste',
    addresses: [{ streetCode: 10, neighborhoodCode: 20, number: '100', complement: 'sala 1', postalCode: '01001000' }],
    ...overrides,
  };
}

/** A valid CNPJ whose first digit is 0 (computed, synthetic). */
function cnpjWithLeadingZero(): string {
  for (let tail = 0; tail < 100; tail += 1) {
    const candidate = `012345670001${String(tail).padStart(2, '0')}`;
    if (isValidCnpj(candidate)) return candidate;
  }
  throw new Error('no synthetic CNPJ found');
}

const saveOk = (code = 900_001): HttpResponse => ({
  status: 200,
  headers: {},
  body: JSON.stringify({ status: '1', responseBody: { entities: { total: '1', entity: { CODPARC: { $: String(code) } } } } }),
});
const saveRefused = (message: string): HttpResponse => ({ status: 200, headers: {}, body: JSON.stringify({ status: '0', statusMessage: message }) });
const http = (status: number, headers: Record<string, string> = {}): HttpResponse => ({ status, headers, body: '' });

function harness(settings: CustomerWriteSettings | 'closed' = OPEN) {
  const clock: ClockRef = { now: 1_800_000_000_000 };
  const mock = new MockSankhya({ tables: {}, clock });
  const saves: string[] = [];
  const saveResponses: HttpResponse[] = [];
  const transport: HttpTransport = (req) => {
    if (req.url.includes('CRUDServiceProvider.saveRecord')) {
      saves.push(req.body ?? '');
      return Promise.resolve(saveResponses.shift() ?? http(503));
    }
    return mock.transport(req);
  };
  const gateway = new RealSankhyaGateway({
    baseUrl: URL_SANDBOX,
    allowedHosts: ['api.sandbox.sankhya.com.br'],
    environmentKind: 'sandbox',
    credentials: {
      clientId: new Secret(TEST_CREDENTIALS.clientId),
      clientSecret: new Secret(TEST_CREDENTIALS.clientSecret),
      xToken: new Secret(TEST_CREDENTIALS.xToken),
    },
    transport,
    now: () => clock.now,
    ...(settings === 'closed' ? {} : { customerWrite: settings }),
  });
  return { gateway, mock, saves, saveResponses };
}

/** The worker's order of operations (customer-delivery.service): origin, document, write, reread. */
async function deliver(gateway: RealSankhyaGateway, req: PartnerWriteRequest): Promise<{ code: number; wrote: boolean } | 'document_taken'> {
  const byOrigin = await gateway.findPartnerByOrigin(req.originField, req.originKey);
  if (byOrigin !== null) return { code: byOrigin.code, wrote: false };
  if ((await gateway.findPartnerByDocument(req.document)) !== null) return 'document_taken';
  const written = await gateway.upsertPartner(req);
  return { code: written.code, wrote: true };
}

const NONE = ok(['CODPARC', 'CGC_CPF'], []);
const NONE_DOC = ok(['CODPARC', 'CGC_CPF', 'ORIGEM'], []);

async function failureOf(promise: Promise<unknown>): Promise<SankhyaGatewayError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(SankhyaGatewayError);
  return error as SankhyaGatewayError;
}

describe('real partner adapter: closed by default (flags stay closed)', () => {
  it('refuses every operation without any HTTP call when no customer switch was given', async () => {
    const { gateway, mock, saves } = harness('closed');
    const attempts = [
      () => gateway.updatePartner({ code: 5, changes: { phone: '11999990000' } }),
      () => gateway.readPartnerEditableFields(5),
      () => gateway.upsertPartner(request()),
      () => gateway.findPartnerByOrigin(FIELD, KEY),
      () => gateway.findPartnerByDocument(CNPJ),
      () => gateway.readWrittenPartner(1),
    ];
    for (const attempt of attempts) {
      const error = await attempt().catch((e: unknown) => e);
      expect(error).toBeInstanceOf(NotImplementedError);
      expect((error as NotImplementedError).retryable).toBe(false);
      expect((error as NotImplementedError).message).toContain('NEEDS VALIDATION');
    }
    expect(mock.calls).toHaveLength(0);
    expect(saves).toHaveLength(0);
    expect(gateway.describe().capabilities.writes.upsertPartner).toBe('not_implemented');
  });

  it('refuses with an explicit disabled switch and with a request for another origin field', async () => {
    const closed = harness({ enabled: false, originField: null, priceTableCode: null });
    await expect(closed.gateway.upsertPartner(request())).rejects.toBeInstanceOf(NotImplementedError);
    expect(closed.mock.calls).toHaveLength(0);

    const open = harness();
    await expect(open.gateway.upsertPartner(request({ originField: 'AD_OUTRO' }))).rejects.toBeInstanceOf(NotImplementedError);
    await expect(open.gateway.findPartnerByOrigin('AD_OUTRO', KEY)).rejects.toBeInstanceOf(NotImplementedError);
    expect(open.mock.calls).toHaveLength(0);
    expect(open.saves).toHaveLength(0);
  });

  it('declares sandbox_only only when the switch is open', () => {
    expect(harness().gateway.describe().capabilities.writes.upsertPartner).toBe('sandbox_only');
  });

  it('createGateway wires the switch from the environment and refuses it outside staging+sandbox', () => {
    const base = {
      SANKHYA_MODE: 'live',
      SANKHYA_ENVIRONMENT: 'sandbox',
      SANKHYA_BASE_URL: URL_SANDBOX,
      SANKHYA_ALLOWED_HOSTS: 'api.sandbox.sankhya.com.br',
      SANKHYA_CLIENT_ID: 'a',
      SANKHYA_CLIENT_SECRET: 'b',
      SANKHYA_X_TOKEN: 'c',
    };
    const closed = createGateway(base, { transport: () => Promise.reject(new Error('no network in tests')) });
    expect(closed.describe().capabilities.writes.upsertPartner).toBe('not_implemented');
    expect(() => createGateway({ ...base, SANKHYA_CUSTOMER_WRITE_ENABLED: 'true', SANKHYA_CUSTOMER_ORIGIN_FIELD: FIELD })).toThrow(GatewayConfigError);
    const open = createGateway(
      { ...base, SANKHYA_CUSTOMER_WRITE_ENABLED: 'true', SANKHYA_CUSTOMER_ORIGIN_FIELD: FIELD, SF_DEPLOY_ENVIRONMENT: 'staging' },
      { transport: () => Promise.reject(new Error('no network in tests')) },
    );
    expect(open.describe().capabilities.writes.upsertPartner).toBe('sandbox_only');
  });
});

describe('real partner adapter: payload (D-AP / D-AQ / D-AR)', () => {
  function localFields(req: PartnerWriteRequest): Record<string, { $: string }> {
    const body = JSON.parse(buildPartnerCreateRequestText(req)) as { requestBody: { dataSet: { dataRow: { localFields: Record<string, { $: string }> } } } };
    return body.requestBody.dataSet.dataRow.localFields;
  }

  it('is born ATIVO S, CLIENTE S, BLOQUEAR N, price table and seller from the request, origin in the dedicated column', () => {
    const fields = localFields(request());
    expect(fields).toMatchObject({
      ATIVO: { $: 'S' },
      CLIENTE: { $: 'S' },
      BLOQUEAR: { $: 'N' },
      CODTAB: { $: '5' },
      CODVEND: { $: '7' },
      TIPPESSOA: { $: 'J' },
      CGC_CPF: { $: CNPJ },
      CLASSIFICMS: { $: 'R' },
      IDENTINSCESTAD: { $: '123456789' },
      [FIELD]: { $: KEY },
    });
  });

  it('NEVER sends LIMCRED nor any other forbidden column, and never a Vidya origin column', () => {
    for (const req of [request(), request({ personType: 'individual', document: CPF, stateRegistration: null, sellerCode: null, priceTableCode: null, addresses: [] })]) {
      const text = buildPartnerCreateRequestText(req);
      expect(text).not.toContain('LIMCRED');
      for (const column of PARTNER_FORBIDDEN_COLUMNS) expect(Object.keys(localFields(req))).not.toContain(column);
      expect(text).not.toMatch(/AD_VDY|AD_NUVI|SENHABT|SENHAACESSO|CODTIPPARC|CODREG|TIPOGERBOLETO/);
    }
  });

  it('refuses a Vidya origin column before any call', async () => {
    const { gateway, mock } = harness({ enabled: true, originField: 'AD_VDYORIG', priceTableCode: 5 });
    const error = await failureOf(gateway.upsertPartner(request({ originField: 'AD_VDYORIG' })));
    expect(error).toMatchObject({ kind: 'validation', code: 'partner_invalid_origin_field' });
    expect(mock.calls).toHaveLength(0);
  });

  it('is deterministic and posts to the saveRecord path of the Sandbox (NEEDS VALIDATION wire)', async () => {
    const { gateway, saves, saveResponses } = harness();
    saveResponses.push(saveOk(900_123));
    const written = await gateway.upsertPartner(request());
    expect(written).toEqual({ code: 900_123 });
    expect(saves).toEqual([buildPartnerCreateRequestText(request())]);
  });

  it('restores the leading zero of a 13-digit CNPJ and validates it', async () => {
    const zero = cnpjWithLeadingZero();
    expect(localFields(request({ document: zero.slice(1) }))['CGC_CPF']).toEqual({ $: zero });
  });
});

describe('real partner adapter: validation before any call', () => {
  async function refused(overrides: Partial<PartnerWriteRequest>): Promise<PartnerFieldError> {
    const { gateway, mock, saves } = harness();
    const error = await failureOf(gateway.upsertPartner(request(overrides)));
    expect(error).toBeInstanceOf(PartnerFieldError);
    expect(error.kind).toBe('validation');
    expect(error.retryable).toBe(false);
    expect(mock.calls).toHaveLength(0);
    expect(saves).toHaveLength(0);
    return error as PartnerFieldError;
  }

  it('names the field that overflows and never truncates (name and trade name, NOMEPARC 100)', async () => {
    const longName = 'N'.repeat(101);
    expect(await refused({ name: longName, tradeName: null })).toMatchObject({ code: 'partner_field_too_long', field: 'name', column: 'NOMEPARC' });
    expect(await refused({ tradeName: longName })).toMatchObject({ code: 'partner_field_too_long', field: 'tradeName', column: 'NOMEPARC' });
    expect((await refused({ tradeName: longName })).message).toContain('101');
  });

  it('accepts exactly the limit (100 characters)', () => {
    expect(() => buildPartnerCreateRequestText(request({ tradeName: 'N'.repeat(100) }))).not.toThrow();
  });

  it('state registration: company requires it (up to 16 or Isento), individual must not send one', async () => {
    expect(await refused({ stateRegistration: null })).toMatchObject({ code: 'partner_required_field', field: 'stateRegistration' });
    expect(await refused({ stateRegistration: '1'.repeat(17) })).toMatchObject({ code: 'partner_field_too_long', field: 'stateRegistration', column: 'IDENTINSCESTAD' });
    expect(await refused({ personType: 'individual', document: CPF, stateRegistration: '123' })).toMatchObject({ code: 'partner_state_registration_not_allowed' });
    const sixteen = buildPartnerCreateRequestText(request({ stateRegistration: '1'.repeat(16) }));
    expect(sixteen).toContain('1'.repeat(16));
    expect(buildPartnerCreateRequestText(request({ stateRegistration: 'isento' }))).toContain('"ISENTO"');
    expect(buildPartnerCreateRequestText(request({ personType: 'individual', document: CPF, stateRegistration: null }))).not.toContain('IDENTINSCESTAD');
  });

  it('CPF/CNPJ rules: valid check digits, kind matches the person type', async () => {
    expect(await refused({ document: '11222333000182' })).toMatchObject({ code: 'partner_invalid_document' });
    expect(await refused({ document: '11111111111', personType: 'individual', stateRegistration: null })).toMatchObject({ code: 'partner_invalid_document' });
    expect(await refused({ document: CPF })).toMatchObject({ code: 'partner_invalid_document' });
    expect(await refused({ document: CNPJ, personType: 'individual', stateRegistration: null })).toMatchObject({ code: 'partner_invalid_document' });
  });

  it('classification is one of C, I, P, R, T, X; more than one address is not guessed', async () => {
    expect(await refused({ icmsClassification: 'Z' })).toMatchObject({ code: 'partner_invalid_classification' });
    for (const letter of ['C', 'I', 'P', 'R', 'T', 'X']) {
      expect(() => buildPartnerCreateRequestText(request({ icmsClassification: letter }))).not.toThrow();
    }
    const address = { streetCode: 1, neighborhoodCode: 2, number: null, complement: null, postalCode: null };
    expect(await refused({ addresses: [address, address] })).toMatchObject({ code: 'partner_multiple_addresses_unsupported' });
  });

  it('refuses a malformed origin key', async () => {
    expect(await refused({ originKey: 'force:not-a-uuid' })).toMatchObject({ code: 'partner_invalid_origin_key' });
  });
});

describe('real partner adapter: state machine with the transport mock', () => {
  it('create: absent by origin, absent by document, one write, then reread', async () => {
    const { gateway, mock, saves, saveResponses } = harness();
    mock.forced.push(NONE, NONE_DOC);
    saveResponses.push(saveOk(900_001));
    expect(await deliver(gateway, request())).toEqual({ code: 900_001, wrote: true });
    expect(saves).toHaveLength(1);
    const sql = mock.queries().map((q) => q.sql);
    expect(sql[0]).toBe(`SELECT CODPARC, CGC_CPF FROM TGFPAR WHERE ${FIELD} = '${KEY}'`);
    expect(sql[1]).toBe(`SELECT CODPARC, CGC_CPF, ${FIELD} AS ORIGEM FROM TGFPAR WHERE CGC_CPF IN ('${CNPJ}')`);
  });

  it('duplicate by origin: the partner is adopted and NO second write happens', async () => {
    const { gateway, mock, saves } = harness();
    mock.forced.push(ok(['CODPARC', 'CGC_CPF'], [[900_001, CNPJ]]));
    expect(await deliver(gateway, request())).toEqual({ code: 900_001, wrote: false });
    expect(saves).toHaveLength(0);
  });

  it('duplicate by document: found, reported with its origin, nothing written', async () => {
    const { gateway, mock, saves } = harness();
    mock.forced.push(NONE, ok(['CODPARC', 'CGC_CPF', 'ORIGEM'], [[777, CNPJ, null]]));
    expect(await deliver(gateway, request({ originKey: KEY_2 }))).toBe('document_taken');
    expect(saves).toHaveLength(0);
    mock.forced.push(ok(['CODPARC', 'CGC_CPF', 'ORIGEM'], [[777, CNPJ, KEY]]));
    expect(await gateway.findPartnerByDocument(CNPJ)).toEqual({ code: 777, originKey: KEY, document: CNPJ });
  });

  it('retry idempotency: the write is lost (timeout after commit); the next attempt finds it by origin and never rewrites', async () => {
    const { gateway, mock, saves, saveResponses } = harness();
    mock.forced.push(NONE, NONE_DOC);
    saveResponses.push(http(504));
    const error = await failureOf(deliver(gateway, request()));
    expect(error).toMatchObject({ kind: 'unavailable', retryable: true });
    expect(saves).toHaveLength(1);
    // The ERP did create it: the second attempt looks first.
    mock.forced.push(ok(['CODPARC', 'CGC_CPF'], [[900_005, CNPJ]]));
    expect(await deliver(gateway, request())).toEqual({ code: 900_005, wrote: false });
    expect(saves).toHaveLength(1);
  });

  it('a resend carries byte-identical origin key and payload', async () => {
    const { gateway, saves, saveResponses } = harness();
    saveResponses.push(http(500), saveOk());
    await failureOf(gateway.upsertPartner(request()));
    await gateway.upsertPartner(request());
    expect(saves[0]).toBe(saves[1]);
  });

  it('reread returns the partner in Sales Force shape with the credit limit empty and the 13-digit CNPJ restored', async () => {
    const { gateway, mock } = harness();
    const zero = cnpjWithLeadingZero();
    mock.forced.push(ok(
      ['CODPARC', 'NOMEPARC', 'RAZAOSOCIAL', 'CGC_CPF', 'ATIVO', 'BLOQUEAR', 'CODVEND', 'CODTAB', 'LIMCRED', 'LIMCREDMENSAL', 'MOTBLOQ', 'SITUACAO'],
      [[900_001, 'TESTE FORCE', 'TESTE FORCE Ltda', zero.slice(1), 'S', 'N', 7, 5, null, null, null, null]],
    ));
    const partner = await gateway.readWrittenPartner(900_001);
    expect(partner).toMatchObject({ code: 900_001, document: zero, active: true, blocked: false, sellerCode: 7, priceTableCode: 5, creditLimit: null });
    mock.forced.push(ok(['CODPARC', 'NOMEPARC', 'RAZAOSOCIAL', 'CGC_CPF', 'ATIVO', 'BLOQUEAR', 'CODVEND', 'CODTAB', 'LIMCRED', 'LIMCREDMENSAL', 'MOTBLOQ', 'SITUACAO'], []));
    expect(await gateway.readWrittenPartner(900_002)).toBeNull();
  });

  it('CNPJ lookup compares with and without the leading zero', async () => {
    const { gateway, mock } = harness();
    const zero = cnpjWithLeadingZero();
    mock.forced.push(ok(['CODPARC', 'CGC_CPF', 'ORIGEM'], [[55, zero.slice(1), null]]));
    expect(await gateway.findPartnerByDocument(zero)).toEqual({ code: 55, originKey: null, document: zero });
    expect(mock.queries()[0]?.sql).toContain(`IN ('${zero}', '${zero.slice(1)}')`);
    mock.forced.push(ok(['CODPARC', 'CGC_CPF', 'ORIGEM'], [[55, zero, null]]));
    expect(await gateway.findPartnerByDocument(zero.slice(1))).toMatchObject({ code: 55, document: zero.slice(1) });
  });

  it('more than one match is an ambiguity (permanent), never "the first one"', async () => {
    const { gateway, mock } = harness();
    mock.forced.push(ok(['CODPARC', 'CGC_CPF'], [[1, CNPJ], [2, CNPJ]]));
    expect(await failureOf(gateway.findPartnerByOrigin(FIELD, KEY))).toMatchObject({ kind: 'permanent', code: 'ambiguous_origin' });
    mock.forced.push(ok(['CODPARC', 'CGC_CPF', 'ORIGEM'], [[1, CNPJ, null], [2, CNPJ, null]]));
    expect(await failureOf(gateway.findPartnerByDocument(CNPJ))).toMatchObject({ kind: 'permanent', code: 'ambiguous_document' });
  });

  it('refuses malformed lookup input before any SQL is built', async () => {
    const { gateway, mock } = harness();
    await expect(gateway.findPartnerByOrigin(FIELD, "force:x' OR '1'='1")).rejects.toMatchObject({ kind: 'validation' });
    await expect(gateway.findPartnerByDocument("1' OR '1'='1")).rejects.toMatchObject({ kind: 'validation' });
    await expect(gateway.findPartnerByDocument('123')).rejects.toMatchObject({ kind: 'validation' });
    await expect(gateway.readWrittenPartner(0)).rejects.toMatchObject({ kind: 'validation' });
    expect(mock.queries()).toHaveLength(0);
  });
});

describe('real partner adapter: error classification', () => {
  async function writeFailure(response: HttpResponse): Promise<SankhyaGatewayError> {
    const { gateway, saveResponses } = harness();
    saveResponses.push(response);
    return failureOf(gateway.upsertPartner(request()));
  }

  it('maps transport and gateway failures to the project classes', async () => {
    expect(await writeFailure(http(503))).toMatchObject({ kind: 'unavailable', retryable: true });
    expect(await writeFailure(http(500))).toMatchObject({ kind: 'temporary', retryable: true });
    expect(await writeFailure(http(429, { 'retry-after': '7' }))).toMatchObject({ kind: 'rate_limit', retryable: true, retryAfterMs: 7000 });
    expect(await writeFailure(http(401))).toMatchObject({ kind: 'auth', retryable: false });
    expect(await writeFailure(http(400))).toMatchObject({ kind: 'validation', retryable: false });
  });

  it('a 403 renews the token once and, if refused again, is an auth failure', async () => {
    const { gateway, saveResponses, saves } = harness();
    saveResponses.push(http(403), http(403));
    expect(await failureOf(gateway.upsertPartner(request()))).toMatchObject({ kind: 'auth' });
    expect(saves).toHaveLength(2);
  });

  it('a business refusal is permanent with the real reason, never retryable', async () => {
    const dup = await writeFailure(saveRefused('Ja existe um parceiro cadastrado com o CNPJ 11.222.333/0001-81'));
    expect(dup).toMatchObject({ kind: 'permanent', code: 'partner_document_duplicate', retryable: false });
    expect(dup.message).toContain('Ja existe um parceiro');
    expect(dup.message).not.toContain('11.222.333');
    expect(await writeFailure(saveRefused('O campo Razão Social é obrigatório.'))).toMatchObject({ kind: 'permanent', code: 'partner_required_field' });
    expect(await writeFailure(saveRefused('Algo inesperado'))).toMatchObject({ kind: 'permanent', code: 'erp_refused_partner' });
  });

  it('decodes a base64 refusal and masks long digit runs', () => {
    const encoded = Buffer.from('CPF 52998224725 já cadastrado para outro parceiro', 'utf8').toString('base64');
    const error = classifyPartnerRefusal(encoded);
    expect(error).toMatchObject({ kind: 'permanent', code: 'partner_document_duplicate' });
    expect(error.message).toContain('já cadastrado');
    expect(error.message).not.toContain('52998224725');
  });

  it('a success without a usable key is temporary (the partner may exist: verify by origin)', async () => {
    const noKey: HttpResponse = { status: 200, headers: {}, body: JSON.stringify({ status: '1', responseBody: {} }) };
    expect(await writeFailure(noKey)).toMatchObject({ kind: 'temporary', code: 'missing_partner_code', retryable: true });
    expect(await writeFailure({ status: 200, headers: {}, body: 'not json' })).toMatchObject({ kind: 'temporary', code: 'invalid_gateway_response' });
  });

  it('refuses a write outside the Sandbox host list even when the switch object is open', async () => {
    const clock: ClockRef = { now: 1_800_000_000_000 };
    const mock = new MockSankhya({ tables: {}, clock });
    const gateway = new RealSankhyaGateway({
      baseUrl: 'https://erp.example.test',
      allowedHosts: ['erp.example.test'],
      environmentKind: 'sandbox',
      credentials: {
        clientId: new Secret(TEST_CREDENTIALS.clientId),
        clientSecret: new Secret(TEST_CREDENTIALS.clientSecret),
        xToken: new Secret(TEST_CREDENTIALS.xToken),
      },
      transport: mock.transport,
      now: () => clock.now,
      customerWrite: OPEN,
    });
    await expect(gateway.upsertPartner(request())).rejects.toBeInstanceOf(GatewayConfigError);
    expect(mock.writes()).toHaveLength(0);
  });
});


describe('partner edit request builder (D-AP; not on the port yet)', () => {
  const edit = (changes: Record<string, unknown>) => buildPartnerEditRequestText({ code: 5, changes: changes as never });
  it.each([['name'], ['razaoSocial'], ['document'], ['creditLimit'], ['sellerCode'], ['priceTableCode'], ['active'], ['blocked']])('rejects %s before any call', (field) => {
    expect(() => edit({ phone: '1', [field]: 'x' })).toThrowError(expect.objectContaining({ kind: 'validation', code: 'partner_edit_field_not_allowed', field }));
  });
  it('sends only phone, email and notes keyed by the partner code', () => {
    const body = JSON.parse(edit({ phone: '11988887777', email: 'novo@example.test', notes: 'nova obs' })) as { requestBody: { dataSet: { dataRow: { key: unknown; localFields: Record<string, unknown> } } } };
    expect(body.requestBody.dataSet.dataRow.key).toEqual({ CODPARC: { $: '5' } });
    expect(Object.keys(body.requestBody.dataSet.dataRow.localFields).sort()).toEqual(['EMAIL', 'OBSERVACOES', 'TELEFONE']);
    expect(JSON.stringify(body)).not.toContain('LIMCRED');
  });
  it('contacts and addresses have no validated mapping: refused, not guessed; empty edit refused', () => {
    expect(() => edit({ contacts: [] })).toThrowError(expect.objectContaining({ code: 'partner_edit_unsupported' }));
    expect(() => edit({ addresses: [] })).toThrowError(expect.objectContaining({ code: 'partner_edit_unsupported' }));
    expect(() => edit({})).toThrowError(expect.objectContaining({ code: 'partner_edit_empty' }));
  });
});
