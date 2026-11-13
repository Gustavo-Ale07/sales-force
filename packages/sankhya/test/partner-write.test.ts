import type { Customer } from '@salesforce/domain';
import { describe, expect, it } from 'vitest';
import {
  FakeGateway,
  FakePartnerBook,
  NotImplementedError,
  RealSankhyaGateway,
  SankhyaGatewayError,
  Secret,
  getDemoDataset,
  type PartnerWriteRequest,
} from '../src/index.js';
import { MockSankhya, TEST_CREDENTIALS, erpTablesFromDataset } from './support/mock-sankhya.js';

const FIELD = 'AD_FORCEORIGEM';
const KEY = 'force:0198f0a2-7b1c-7c3e-9a55-0123456789ab';
const KEY_2 = 'force:0198f0a2-7b1c-7c3e-9a55-0123456789ac';

function request(overrides: Partial<PartnerWriteRequest> = {}): PartnerWriteRequest {
  return {
    originField: FIELD,
    originKey: KEY,
    document: '11222333000181',
    personType: 'company',
    name: 'Cliente Teste Ltda',
    tradeName: 'Teste',
    icmsClassification: 'R',
    stateRegistration: null,
    sellerCode: 7,
    priceTableCode: 5,
    phone: '11999990000',
    email: 'contato@example.test',
    notes: null,
    addresses: [{ streetCode: 10, neighborhoodCode: 20, number: '100', complement: null, postalCode: '01001000' }],
    ...overrides,
  };
}

function gateway(partners = new FakePartnerBook()) {
  return { partners, gateway: new FakeGateway({ partners }) };
}

describe('partner write contract (fake gateway, D-AR)', () => {
  it('declares the capability as simulated', () => {
    expect(gateway().gateway.describe().capabilities.writes.upsertPartner).toBe('simulated');
  });

  it('creates a partner and finds it by origin and by document', async () => {
    const { gateway: g } = gateway();
    expect(await g.findPartnerByOrigin(FIELD, KEY)).toBeNull();
    const written = await g.upsertPartner(request());
    expect(written.code).toBeGreaterThan(0);
    expect(await g.findPartnerByOrigin(FIELD, KEY)).toEqual({ code: written.code, originKey: KEY, document: '11222333000181' });
    expect(await g.findPartnerByDocument('11222333000181')).toMatchObject({ code: written.code });
  });

  it('rereads what was written, with LIMCRED never filled and the defaults the Force asks for', async () => {
    const { gateway: g } = gateway();
    const { code } = await g.upsertPartner(request());
    const reread = await g.readWrittenPartner(code);
    expect(reread).toMatchObject({ code, name: 'Cliente Teste Ltda', active: true, blocked: false, sellerCode: 7, priceTableCode: 5, creditLimit: null });
  });

  it('refuses a document already present in the ERP (validation, not retryable)', async () => {
    const { gateway: g } = gateway();
    await g.upsertPartner(request());
    const error = await g.upsertPartner(request({ originKey: KEY_2 })).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SankhyaGatewayError);
    expect((error as SankhyaGatewayError).kind).toBe('validation');
    expect((error as SankhyaGatewayError).code).toBe('partner_document_duplicate');
    expect((error as SankhyaGatewayError).retryable).toBe(false);
  });

  it('finds a seeded demo customer by document', async () => {
    const g = new FakeGateway();
    const first = await g.readCustomers()[Symbol.asyncIterator]().next();
    const demo = (first.value as readonly Customer[] | undefined)?.find((c) => c.document !== null);
    expect(demo).toBeDefined();
    expect(await g.findPartnerByDocument(demo?.document ?? '')).toMatchObject({ code: demo?.code });
  });

  it('scripted unavailable error: nothing was created', async () => {
    const { gateway: g, partners } = gateway();
    partners.script('upsert', { kind: 'error', error: new SankhyaGatewayError('unavailable', { code: 'x', message: 'down' }) });
    await expect(g.upsertPartner(request())).rejects.toMatchObject({ kind: 'unavailable', retryable: true });
    expect(partners.partners).toHaveLength(0);
  });

  it('ambiguous outcome: created then error; the origin lookup proves it exists and a resend never duplicates', async () => {
    const { gateway: g, partners } = gateway();
    partners.script('upsert', { kind: 'created_then_error', error: new SankhyaGatewayError('temporary', { code: 'timeout', message: 'timeout' }) });
    await expect(g.upsertPartner(request())).rejects.toMatchObject({ kind: 'temporary' });
    const found = await g.findPartnerByOrigin(FIELD, KEY);
    expect(found).not.toBeNull();
    expect(partners.partners).toHaveLength(1);
  });

  it('more than one partner with the same origin key is an ambiguity, never "the first one"', async () => {
    const { gateway: g, partners } = gateway();
    partners.seed(request());
    partners.seed(request({ document: '52998224725', personType: 'individual' }));
    await expect(g.findPartnerByOrigin(FIELD, KEY)).rejects.toMatchObject({ code: 'ambiguous_origin' });
  });

  it('more than one partner with the same document is an ambiguity', async () => {
    const { gateway: g, partners } = gateway();
    partners.seed(request({ originKey: KEY }));
    partners.seed(request({ originKey: KEY_2 }));
    await expect(g.findPartnerByDocument('11222333000181')).rejects.toMatchObject({ code: 'ambiguous_document' });
  });

  it('rejects an invalid origin field or key before touching the book', async () => {
    const { gateway: g, partners } = gateway();
    await expect(g.findPartnerByOrigin('NOME; DROP', KEY)).rejects.toMatchObject({ kind: 'validation' });
    await expect(g.findPartnerByOrigin(FIELD, 'not-a-key')).rejects.toMatchObject({ kind: 'validation' });
    expect(partners.calls).toHaveLength(0);
  });

  it('honours an aborted signal', async () => {
    const { gateway: g } = gateway();
    const controller = new AbortController();
    controller.abort();
    await expect(g.upsertPartner(request(), { signal: controller.signal })).rejects.toBeDefined();
  });
});

describe('partner write on the real adapter (refused until F6 + Sandbox test T3)', () => {
  function real() {
    const clock = { now: 1_800_000_000_000 };
    const mock = new MockSankhya({ tables: erpTablesFromDataset(getDemoDataset()), clock });
    const gateway = new RealSankhyaGateway({
      baseUrl: 'https://api.sandbox.sankhya.com.br',
      allowedHosts: ['api.sandbox.sankhya.com.br'],
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

  it('refuses every partner operation without any HTTP call, permanent and marked NEEDS VALIDATION', async () => {
    const { gateway, mock } = real();
    const attempts = [
      () => gateway.upsertPartner(request()),
      () => gateway.findPartnerByOrigin(FIELD, KEY),
      () => gateway.findPartnerByDocument('11222333000181'),
      () => gateway.readWrittenPartner(1),
    ];
    for (const attempt of attempts) {
      const error = await attempt().catch((e: unknown) => e);
      expect(error).toBeInstanceOf(NotImplementedError);
      expect((error as NotImplementedError).retryable).toBe(false);
      expect((error as NotImplementedError).message).toContain('NEEDS VALIDATION');
    }
    expect(mock.calls).toHaveLength(0);
    expect(gateway.describe().capabilities.writes.upsertPartner).toBe('not_implemented');
  });
});
