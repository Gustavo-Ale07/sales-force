import { describe, expect, it } from 'vitest';
import { FakeGateway, FakePartnerBook, SankhyaGatewayError, buildPartnerLocalFields, getDemoDataset, type PartnerWriteRequest } from '../src/index.js';

const KEY = 'force:0198f0a2-7b1c-7c3e-9a55-0123456789ab';

function request(address: Partial<PartnerWriteRequest['addresses'][number]> | null): PartnerWriteRequest {
  return {
    originField: 'AD_FORCEORIGEM',
    originKey: KEY,
    document: '11222333000181',
    personType: 'company',
    name: 'Cliente Teste Ltda',
    tradeName: null,
    icmsClassification: 'R',
    stateRegistration: 'ISENTO',
    sellerCode: 7,
    priceTableCode: null,
    phone: '11999998888',
    email: 'a@b.com',
    notes: null,
    addresses: address === null ? [] : [{ cityCode: 3550308, streetCode: 0, neighborhoodCode: 0, number: '10', complement: null, postalCode: '01001000', ...address }],
  };
}

describe('partner address wire (D-AR address registry)', () => {
  it('sends CODCID, CEP, NUMEND, phone and e-mail; street and neighborhood only when coded', () => {
    const none = buildPartnerLocalFields(request({}));
    expect(none['CODCID']).toEqual({ $: '3550308' });
    expect(none['CEP']).toEqual({ $: '01001000' });
    expect(none['NUMEND']).toEqual({ $: '10' });
    expect(none['TELEFONE']).toEqual({ $: '11999998888' });
    expect(none['EMAIL']).toEqual({ $: 'a@b.com' });
    expect(none).not.toHaveProperty('CODEND');
    expect(none).not.toHaveProperty('CODBAI');
    const coded = buildPartnerLocalFields(request({ streetCode: 7, neighborhoodCode: 3 }));
    expect(coded['CODEND']).toEqual({ $: '7' });
    expect(coded['CODBAI']).toEqual({ $: '3' });
  });

  it('never writes the forbidden columns (CODREG, CODTIPPARC, LIMCRED)', () => {
    const fields = buildPartnerLocalFields(request({ streetCode: 7, neighborhoodCode: 3 }));
    for (const column of ['CODREG', 'CODTIPPARC', 'LIMCRED']) expect(fields).not.toHaveProperty(column);
  });

  it('refuses an address without a city before any call', () => {
    expect(() => buildPartnerLocalFields(request({ cityCode: 0 }))).toThrow(/city is required/);
  });
});

describe('fake registry creation (Sandbox-only worker step)', () => {
  it('creates a missing neighborhood once and returns the same code for the same name without accents or case', async () => {
    const book = new FakePartnerBook();
    const gateway = new FakeGateway({ partners: book });
    const first = await gateway.ensureNeighborhood('Jardim Novo');
    const again = await gateway.ensureNeighborhood('JARDIM  NOVO');
    expect(first.created).toBe(true);
    expect(again).toEqual({ code: first.code, created: false });
    expect(book.registryCreations).toHaveLength(1);
  });

  it('finds an existing mirrored neighborhood instead of creating it', async () => {
    const book = new FakePartnerBook();
    const gateway = new FakeGateway({ partners: book });
    const demo = getDemoDataset().neighborhoods[0];
    expect(demo).toBeDefined();
    const found = await gateway.ensureNeighborhood((demo?.name ?? '').toLowerCase());
    expect(found).toEqual({ code: demo?.code, created: false });
    expect(book.registryCreations).toHaveLength(0);
  });

  it('splits the street type and does not duplicate "Rua das Flores"', async () => {
    const book = new FakePartnerBook();
    const gateway = new FakeGateway({ partners: book });
    const first = await gateway.ensureStreet('Rua Nova Esperança');
    const again = await gateway.ensureStreet('rua nova esperanca');
    expect(again).toEqual({ code: first.code, created: false });
    expect(book.registryCreations[0]?.name).toBe('RUA NOVA ESPERANCA');
    expect(book.streets.at(-1)).toMatchObject({ kind: 'RUA', name: 'NOVA ESPERANCA' });
  });

  it('a scripted unavailable error creates nothing and is retryable', async () => {
    const book = new FakePartnerBook();
    book.script('registry', { kind: 'error', error: new SankhyaGatewayError('unavailable', { code: 'down', message: 'down' }) });
    const gateway = new FakeGateway({ partners: book });
    await expect(gateway.ensureNeighborhood('Centro Novo')).rejects.toMatchObject({ retryable: true });
    expect(book.registryCreations).toHaveLength(0);
  });
});
