import { describe, expect, it } from 'vitest';
import { CNPJ_CACHE_TTL_MS, CnpjService, type CachedCompany, type CnpjCacheStore } from '../../src/customers/cnpj.service.js';
import { BrasilApiCnpjSource, CnpjWsSource, type CnpjSource, type ExternalCompany } from '../../src/customers/cnpj.source.js';
import type { FetchLike } from '../../src/customers/postal-code.source.js';

const VALID = '11222333000181';
const user = { accountId: 'a' } as never;

const company: ExternalCompany = {
  legalName: 'EMPRESA TESTE LTDA', tradeName: 'Teste', postalCode: '01310100', street: 'AVENIDA PAULISTA', number: '1000',
  complement: null, neighborhood: 'BELA VISTA', city: 'SAO PAULO', uf: 'SP', phone: '1133334444', email: 'a@teste.com',
};

function memoryCache(): CnpjCacheStore & { map: Map<string, CachedCompany> } {
  const map = new Map<string, CachedCompany>();
  return { map, get: async (c) => map.get(c) ?? null, put: async (c, e) => { map.set(c, e); } };
}

function source(name: 'brasilapi' | 'cnpjws', behaviour: () => Promise<ExternalCompany | null>, calls: string[] = []): CnpjSource {
  return { name, lookup: async (c) => { calls.push(`${name}:${c}`); return behaviour(); } };
}

function service(sources: CnpjSource[], cache = memoryCache(), now: () => Date = () => new Date('2026-11-26T12:00:00Z'), denied = false) {
  const policy = { accessContext: async () => { if (denied) throw new Error('forbidden'); return { kind: 'all' }; } };
  return new CnpjService(policy as never, cache, sources, now);
}

describe('CnpjService', () => {
  it('answers from the primary source and keeps the company', async () => {
    const cache = memoryCache();
    const result = await service([source('brasilapi', async () => company)], cache).lookup(user, '11.222.333/0001-81');
    expect(result).toMatchObject({ found: true, cnpj: VALID, legalName: 'EMPRESA TESTE LTDA', source: 'brasilapi', postalCode: '01310100' });
    expect(cache.map.get(VALID)?.source).toBe('brasilapi');
  });

  it('falls back to the alternative source when the primary fails or does not know the CNPJ', async () => {
    const calls: string[] = [];
    const down = source('brasilapi', async () => { throw new Error('timeout'); }, calls);
    const alt = source('cnpjws', async () => company, calls);
    expect(await service([down, alt]).lookup(user, VALID)).toMatchObject({ found: true, source: 'cnpjws' });
    expect(calls).toEqual([`brasilapi:${VALID}`, `cnpjws:${VALID}`]);
    expect(await service([source('brasilapi', async () => null), alt]).lookup(user, VALID)).toMatchObject({ source: 'cnpjws' });
  });

  it('is found=false (never an error) when every source fails or does not know it', async () => {
    const down = source('brasilapi', async () => { throw new Error('x'); });
    const none = source('cnpjws', async () => null);
    const result = await service([down, none]).lookup(user, VALID);
    expect(result).toMatchObject({ found: false, cnpj: null, legalName: null, source: null });
  });

  it('answers found=false for an invalid CNPJ without calling any source', async () => {
    const calls: string[] = [];
    const s = service([source('brasilapi', async () => company, calls)]);
    for (const bad of ['', '123', '11222333000182', '00000000000000', 'abc']) {
      expect((await s.lookup(user, bad)).found).toBe(false);
    }
    expect(calls).toEqual([]);
  });

  it('uses the persistent cache for 30 days, then asks again', async () => {
    const cache = memoryCache();
    const calls: string[] = [];
    let at = new Date('2026-11-26T12:00:00Z');
    const s = service([source('brasilapi', async () => company, calls)], cache, () => at);
    await s.lookup(user, VALID);
    at = new Date(at.getTime() + CNPJ_CACHE_TTL_MS - 1_000);
    await s.lookup(user, VALID);
    expect(calls).toHaveLength(1);
    at = new Date(at.getTime() + 2_000);
    await s.lookup(user, VALID);
    expect(calls).toHaveLength(2);
  });

  it('survives a failing cache store', async () => {
    const broken: CnpjCacheStore = { get: async () => { throw new Error('db'); }, put: async () => { throw new Error('db'); } };
    const result = await service([source('brasilapi', async () => company)], broken as never).lookup(user, VALID);
    expect(result.found).toBe(true);
  });

  it('shares one round of external calls between simultaneous lookups of the same CNPJ', async () => {
    const calls: string[] = [];
    const s = service([source('brasilapi', async () => { await new Promise((r) => setTimeout(r, 5)); return company; }, calls)]);
    await Promise.all([s.lookup(user, VALID), s.lookup(user, VALID), s.lookup(user, VALID)]);
    expect(calls).toHaveLength(1);
  });

  it('limits each account to 20 lookups per minute (rate_limited), others unaffected', async () => {
    const s = service([source('brasilapi', async () => null)]);
    for (let i = 0; i < 20; i += 1) await s.lookup(user, VALID);
    await expect(s.lookup(user, VALID)).rejects.toMatchObject({ code: 'rate_limited' });
    await expect(s.lookup({ accountId: 'b' } as never, VALID)).resolves.toMatchObject({ found: false });
  });

  it('refuses a profile that may not register customers', async () => {
    await expect(service([source('brasilapi', async () => company)], memoryCache(), undefined, true).lookup(user, VALID)).rejects.toThrow('forbidden');
  });
});

describe('CNPJ sources', () => {
  const reply = (status: number, body: unknown): FetchLike => async () => ({ ok: status >= 200 && status < 300, status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });

  it('BrasilAPI maps the company, keeps only valid phone, e-mail and CEP', async () => {
    const found = await new BrasilApiCnpjSource(reply(200, {
      razao_social: 'EMPRESA LTDA', nome_fantasia: '', cep: '01310100', logradouro: 'AVENIDA PAULISTA', numero: '1000', complemento: 'SALA 1',
      bairro: 'BELA VISTA', municipio: 'SAO PAULO', uf: 'sp', ddd_telefone_1: '1133334444', ddd_telefone_2: '', email: 'X@Y.COM',
    })).lookup(VALID, new AbortController().signal);
    expect(found).toEqual({
      legalName: 'EMPRESA LTDA', tradeName: null, postalCode: '01310100', street: 'AVENIDA PAULISTA', number: '1000', complement: 'SALA 1',
      neighborhood: 'BELA VISTA', city: 'SAO PAULO', uf: 'SP', phone: '1133334444', email: 'x@y.com',
    });
    const odd = await new BrasilApiCnpjSource(reply(200, { razao_social: 'A', cep: '123', ddd_telefone_1: '999', email: 'invalid' })).lookup(VALID, new AbortController().signal);
    expect(odd).toMatchObject({ postalCode: null, phone: null, email: null });
  });

  it('answers null for 404 and throws for 5xx, oversized or garbled bodies', async () => {
    const signal = new AbortController().signal;
    expect(await new BrasilApiCnpjSource(reply(404, {})).lookup(VALID, signal)).toBeNull();
    await expect(new BrasilApiCnpjSource(reply(500, {})).lookup(VALID, signal)).rejects.toThrow();
    await expect(new BrasilApiCnpjSource(reply(200, 'x'.repeat(100_000))).lookup(VALID, signal)).rejects.toThrow('too large');
    await expect(new CnpjWsSource(reply(200, 'not json')).lookup(VALID, signal)).rejects.toThrow();
  });

  it('refuses redirects and cuts a streamed body at the ceiling before reading it all', async () => {
    const signal = new AbortController().signal;
    const inits: unknown[] = [];
    const spy: FetchLike = async (_url, init) => {
      inits.push(init);
      return { ok: true, status: 200, text: async () => '{}' };
    };
    await new BrasilApiCnpjSource(spy).lookup(VALID, signal);
    expect(inits[0]).toMatchObject({ redirect: 'error' });

    let pulled = 0;
    let cancelled = false;
    const streaming: FetchLike = async () => ({
      ok: true,
      status: 200,
      text: async () => {
        throw new Error('text() must not be used when a stream is available');
      },
      body: {
        getReader: () => ({
          read: async () => {
            pulled += 1;
            return { done: false, value: new Uint8Array(32 * 1024) };
          },
          cancel: async () => {
            cancelled = true;
          },
        }),
      },
    });
    await expect(new CnpjWsSource(streaming).lookup(VALID, signal)).rejects.toThrow('too large');
    expect(cancelled).toBe(true);
    expect(pulled).toBeLessThanOrEqual(3);

    const declared: FetchLike = async () => ({ ok: true, status: 200, text: async () => '{}', headers: { get: () => '999999' } });
    await expect(new BrasilApiCnpjSource(declared).lookup(VALID, signal)).rejects.toThrow('too large');
  });

  it('publica.cnpj.ws maps the establishment', async () => {
    const found = await new CnpjWsSource(reply(200, {
      razao_social: 'EMPRESA LTDA',
      estabelecimento: {
        nome_fantasia: 'Fantasia', cep: '01310100', tipo_logradouro: 'AVENIDA', logradouro: 'PAULISTA', numero: '10', complemento: null,
        bairro: 'BELA VISTA', cidade: { nome: 'São Paulo' }, estado: { sigla: 'SP' }, ddd1: '11', telefone1: '33334444', email: 'a@b.com',
      },
    })).lookup(VALID, new AbortController().signal);
    expect(found).toMatchObject({ legalName: 'EMPRESA LTDA', tradeName: 'Fantasia', street: 'AVENIDA PAULISTA', city: 'São Paulo', uf: 'SP', phone: '1133334444', email: 'a@b.com' });
  });
});
