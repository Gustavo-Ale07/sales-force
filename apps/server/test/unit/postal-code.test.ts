import { describe, expect, it } from 'vitest';
import { PostalCodeService } from '../../src/customers/postal-code.service.js';
import { BrasilApiSource, ViaCepSource, type ExternalAddress, type FetchLike, type PostalCodeSource } from '../../src/customers/postal-code.source.js';

const NOW = new Date('2026-11-26T12:00:00Z');
const user = { accountId: 'a' } as never;

let own: unknown = null;
const mirror = {
  findPostalCode: async () => own,
  listCities: async () => [
    { code: 10, name: 'SAO PAULO', uf: 'SP', ibge: '3550308' },
    { code: 11, name: 'Campinas', uf: 'SP', ibge: null },
  ],
  listNeighborhoods: async () => [{ code: 3, name: 'Bela Vista' }],
  listStreets: async () => [{ code: 7, name: 'PAULISTA', kind: 'AVENIDA' }],
};

const address: ExternalAddress = { street: 'Avenida Paulista', neighborhood: 'Bela Vista', city: 'São Paulo', uf: 'SP', ibge: '3550308' };

function source(name: 'viacep' | 'brasilapi', behaviour: () => Promise<ExternalAddress | null>, calls: string[] = []): PostalCodeSource {
  return { name, lookup: async (cep) => { calls.push(`${name}:${cep}`); return behaviour(); } };
}

function service(sources: PostalCodeSource[], denied = false) {
  const policy = { accessContext: async () => { if (denied) throw new Error('forbidden'); return { kind: 'all' }; } };
  return new PostalCodeService(policy as never, mirror as never, sources, () => NOW);
}

describe('PostalCodeService', () => {
  it('returns the text and the ERP codes that matched (city by IBGE+UF, neighborhood and street by name)', async () => {
    const result = await service([source('viacep', async () => address)]).lookup(user, '01310-100');
    expect(result).toEqual({
      found: true, postalCode: '01310100', street: 'Avenida Paulista', neighborhood: 'Bela Vista', city: 'São Paulo', uf: 'SP',
      cityCode: 10, neighborhoodCode: 3, streetCode: 7, source: 'viacep',
    });
  });

  it('returns only text when nothing matches the ERP registry', async () => {
    const other = { ...address, city: 'Cidade Nova', ibge: '9999999', neighborhood: 'Bairro Novo', street: 'Rua Nova' };
    const result = await service([source('viacep', async () => other)]).lookup(user, '01310100');
    expect(result).toMatchObject({ found: true, city: 'Cidade Nova', cityCode: null, neighborhoodCode: null, streetCode: null });
  });

  it('falls back to BrasilAPI when ViaCEP fails or does not know the CEP', async () => {
    const calls: string[] = [];
    const down = source('viacep', async () => { throw new Error('timeout'); }, calls);
    const brasil = source('brasilapi', async () => ({ ...address, ibge: null }), calls);
    const result = await service([down, brasil]).lookup(user, '01310100');
    expect(result).toMatchObject({ found: true, source: 'brasilapi', cityCode: 10 });
    expect(calls).toEqual(['viacep:01310100', 'brasilapi:01310100']);
    const unknown = await service([source('viacep', async () => null), brasil]).lookup(user, '01310100');
    expect(unknown).toMatchObject({ found: true, source: 'brasilapi' });
  });

  it('answers from the mirrored ERP table first, with its own codes, and never calls the external sources', async () => {
    own = { cityCode: 10, city: 'SAO PAULO', uf: 'SP', neighborhoodCode: 3, neighborhood: 'Bela Vista', streetCode: 7, street: 'AVENIDA PAULISTA' };
    const calls: string[] = [];
    try {
      const result = await service([source('viacep', async () => address, calls)]).lookup(user, '01310100');
      expect(result).toMatchObject({ found: true, source: 'erp', cityCode: 10, neighborhoodCode: 3, streetCode: 7, street: 'AVENIDA PAULISTA' });
      expect(calls).toHaveLength(0);
    } finally {
      own = null;
    }
  });

  it('simultaneous lookups of the same CEP share one external call', async () => {
    const calls: string[] = [];
    const slow = source('viacep', async () => { await new Promise((r) => setTimeout(r, 20)); return address; }, calls);
    const s = service([slow]);
    const results = await Promise.all([s.lookup(user, '01310100'), s.lookup(user, '01310100'), s.lookup(user, '01310100')]);
    expect(results.every((r) => r.found)).toBe(true);
    expect(calls).toEqual(['viacep:01310100']);
  });

  it('throttles a user at 30 lookups per minute with rate_limited', async () => {
    const s = service([source('viacep', async () => null)]);
    for (let i = 0; i < 30; i++) await s.lookup(user, '01310100');
    await expect(s.lookup(user, '01310100')).rejects.toMatchObject({ code: 'rate_limited' });
    await expect(s.lookup({ accountId: 'other' } as never, '01310100')).resolves.toMatchObject({ found: false });
  });

  it('an invalid CEP is "not found" and never reaches an external source', async () => {
    const calls: string[] = [];
    const s = service([source('viacep', async () => address, calls)]);
    for (const bad of ['123', 'abcdefgh', '00000000', '0131010099', '']) {
      expect(await s.lookup(user, bad)).toMatchObject({ found: false, postalCode: null, cityCode: null });
    }
    expect(calls).toHaveLength(0);
  });

  it('every source failing is "not found", never an error', async () => {
    const boom = async (): Promise<ExternalAddress | null> => { throw new Error('network'); };
    const result = await service([source('viacep', boom), source('brasilapi', boom)]).lookup(user, '01310100');
    expect(result).toMatchObject({ found: false, source: null });
  });

  it('caches a found CEP (one external call) but retries after a total failure', async () => {
    const calls: string[] = [];
    const s = service([source('viacep', async () => address, calls)]);
    await s.lookup(user, '01310100');
    await s.lookup(user, '01310-100');
    expect(calls).toHaveLength(1);
    const failing: string[] = [];
    const f = service([source('viacep', async () => { throw new Error('x'); }, failing)]);
    await f.lookup(user, '01310100');
    await f.lookup(user, '01310100');
    expect(failing).toHaveLength(2);
  });

  it('keeps the registration authorization: a refused scope never reaches a source', async () => {
    const calls: string[] = [];
    await expect(service([source('viacep', async () => address, calls)], true).lookup(user, '01310100')).rejects.toThrow('forbidden');
    expect(calls).toHaveLength(0);
  });
});

describe('external sources parse their answers and send only the CEP', () => {
  const reply = (status: number, body: unknown): FetchLike => async () => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) });
  const signal = AbortSignal.timeout(1000);

  it('ViaCEP: maps fields, "erro" and 400 mean not found, 500 is a failure', async () => {
    const ok = await new ViaCepSource(reply(200, { logradouro: 'Avenida Paulista', bairro: 'Bela Vista', localidade: 'São Paulo', uf: 'sp', ibge: '3550308' })).lookup('01310100', signal);
    expect(ok).toEqual({ street: 'Avenida Paulista', neighborhood: 'Bela Vista', city: 'São Paulo', uf: 'SP', ibge: '3550308' });
    expect(await new ViaCepSource(reply(200, { erro: 'true' })).lookup('99999999', signal)).toBeNull();
    expect(await new ViaCepSource(reply(400, {})).lookup('1', signal)).toBeNull();
    await expect(new ViaCepSource(reply(500, {})).lookup('01310100', signal)).rejects.toThrow();
  });

  it('BrasilAPI: maps fields, 404 is not found', async () => {
    const ok = await new BrasilApiSource(reply(200, { street: 'Rua A', neighborhood: 'Centro', city: 'Campinas', state: 'SP' })).lookup('13010000', signal);
    expect(ok).toEqual({ street: 'Rua A', neighborhood: 'Centro', city: 'Campinas', uf: 'SP', ibge: null });
    expect(await new BrasilApiSource(reply(404, {})).lookup('13010000', signal)).toBeNull();
  });

  it('a body over 16 KB is refused before it is parsed', async () => {
    const big: FetchLike = async () => ({ ok: true, status: 200, text: async () => '{"localidade":"' + 'x'.repeat(17 * 1024) + '"}' });
    await expect(new ViaCepSource(big).lookup('01310100', signal)).rejects.toThrow(/too large/);
    await expect(new BrasilApiSource(big).lookup('01310100', signal)).rejects.toThrow(/too large/);
  });

  it('the request URL carries the 8 digits and nothing else', async () => {
    const urls: string[] = [];
    const spy: FetchLike = async (url, init) => { urls.push(url); expect(Object.keys(init.headers)).toEqual(['accept']); return { ok: true, status: 200, text: async () => JSON.stringify({ erro: true }) }; };
    await new ViaCepSource(spy).lookup('01310100', signal);
    await new BrasilApiSource(spy).lookup('01310100', signal);
    expect(urls).toEqual(['https://viacep.com.br/ws/01310100/json/', 'https://brasilapi.com.br/api/cep/v1/01310100']);
  });
});
