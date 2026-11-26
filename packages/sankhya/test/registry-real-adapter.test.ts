import { describe, expect, it } from 'vitest';
import {
  NotImplementedError,
  RealSankhyaGateway,
  SankhyaGatewayError,
  Secret,
  type CustomerWriteSettings,
} from '../src/index.js';
import { erpDate, neighborhoodName, parseRegistrySaveResponse, streetName } from '../src/write/registry-wire.js';
import type { HttpResponse, HttpTransport } from '../src/real/transport.js';
import { MockSankhya, TEST_CREDENTIALS, ok, type ClockRef } from './support/mock-sankhya.js';

const OPEN: CustomerWriteSettings = { enabled: true, originField: 'AD_FORCEORIGEM', priceTableCode: 5 };

const saved = (field: 'CODBAI' | 'CODEND', code: number | null): HttpResponse => ({
  status: 200,
  headers: {},
  body: JSON.stringify({ status: '1', responseBody: { entities: { total: '1', entity: code === null ? {} : { [field]: { $: String(code) } } } } }),
});
const refused = (message: string): HttpResponse => ({ status: 200, headers: {}, body: JSON.stringify({ status: '0', statusMessage: message }) });

const NONE_BAI = ok(['CODBAI', 'NOMEBAI'], []);
const NONE_END = ok(['CODEND', 'NOMEEND', 'TIPO'], []);

function harness(settings: CustomerWriteSettings | 'closed' = OPEN) {
  const clock: ClockRef = { now: Date.UTC(2026, 10, 26, 15, 4, 5) };
  const mock = new MockSankhya({ tables: {}, clock });
  const saves: string[] = [];
  const saveResponses: HttpResponse[] = [];
  const transport: HttpTransport = (req) => {
    if (req.url.includes('CRUDServiceProvider.saveRecord')) {
      saves.push(req.body ?? '');
      return Promise.resolve(saveResponses.shift() ?? { status: 503, headers: {}, body: '' });
    }
    return mock.transport(req);
  };
  const gateway = new RealSankhyaGateway({
    baseUrl: 'https://api.sandbox.sankhya.com.br',
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

describe('address registry creation, real adapter (shape NEEDS VALIDATION in the Sandbox)', () => {
  it('is closed with the customer switch: no HTTP call at all (SNK-3)', async () => {
    const { gateway, mock, saves } = harness('closed');
    await expect(gateway.ensureNeighborhood('Centro')).rejects.toBeInstanceOf(NotImplementedError);
    await expect(gateway.ensureStreet('Rua A')).rejects.toBeInstanceOf(NotImplementedError);
    expect(mock.calls).toHaveLength(0);
    expect(saves).toHaveLength(0);
  });

  it('finds an existing neighborhood by name first and writes nothing', async () => {
    const { gateway, mock, saves } = harness();
    mock.forced.push(ok(['CODBAI', 'NOMEBAI'], [[321, 'JARDIM ACUCENA']]));
    expect(await gateway.ensureNeighborhood('Jardim Açucena')).toEqual({ code: 321, created: false });
    expect(saves).toHaveLength(0);
    const sql = String(mock.queries().at(-1)?.sql ?? '');
    expect(sql).toContain("= 'JARDIM ACUCENA'");
  });

  it('creates the neighborhood with CODREG 0 and the ERP date, and returns the generated key', async () => {
    const { gateway, mock, saves, saveResponses } = harness();
    mock.forced.push(NONE_BAI);
    saveResponses.push(saved('CODBAI', 777));
    expect(await gateway.ensureNeighborhood('Bairro Inventado')).toEqual({ code: 777, created: true });
    const sent = JSON.parse(saves[0] ?? '{}');
    expect(sent.requestBody.dataSet.rootEntity).toBe('Bairro');
    expect(sent.requestBody.dataSet.dataRow.localFields).toEqual({
      NOMEBAI: { $: 'BAIRRO INVENTADO' },
      CODREG: { $: '0' },
      DTALTER: { $: '26/11/2026' },
    });
    expect(saves[0]).not.toMatch(/CODBAI"\s*:\s*\{/);
  });

  it('creates the street with its type split from the name and no key', async () => {
    const { gateway, mock, saves, saveResponses } = harness();
    mock.forced.push(NONE_END);
    saveResponses.push(saved('CODEND', 4321));
    expect(await gateway.ensureStreet('Rua das Flores')).toEqual({ code: 4321, created: true });
    const sent = JSON.parse(saves[0] ?? '{}');
    expect(sent.requestBody.dataSet.rootEntity).toBe('Endereco');
    expect(sent.requestBody.dataSet.dataRow.localFields).toEqual({
      NOMEEND: { $: 'DAS FLORES' },
      TIPO: { $: 'Rua' },
      DTALTER: { $: '26/11/2026' },
    });
  });

  it('a save answer without a key is read back by name; never guessed', async () => {
    const { gateway, mock, saveResponses } = harness();
    mock.forced.push(NONE_END, ok(['CODEND', 'NOMEEND', 'TIPO'], [[555, 'DAS FLORES', 'RUA']]));
    saveResponses.push(saved('CODEND', null));
    expect(await gateway.ensureStreet('Rua das Flores')).toEqual({ code: 555, created: true });
  });

  it('a save without a key and without the row afterwards is temporary (re-looked-up on retry)', async () => {
    const { gateway, mock, saveResponses } = harness();
    mock.forced.push(NONE_END, NONE_END);
    saveResponses.push(saved('CODEND', null));
    await expect(gateway.ensureStreet('Rua das Flores')).rejects.toMatchObject({ code: 'missing_registry_code', retryable: true });
  });

  it('an ERP refusal is permanent with the reason', async () => {
    const a = harness();
    a.mock.forced.push(NONE_BAI);
    a.saveResponses.push(refused('Campo obrigatório não informado'));
    const error = await a.gateway.ensureNeighborhood('Bairro X').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SankhyaGatewayError);
    expect(error).toMatchObject({ code: 'erp_refused_address_registry', retryable: false });
  });

  it('names that could break the SQL or exceed the column never leave the process', async () => {
    const { gateway, mock } = harness();
    await expect(gateway.ensureNeighborhood("X' OR 1=1 --")).rejects.toMatchObject({ code: 'registry_name_invalid' });
    await expect(gateway.ensureStreet('A'.repeat(61))).rejects.toMatchObject({ code: 'registry_name_too_long' });
    await expect(gateway.ensureNeighborhood('   ')).rejects.toMatchObject({ code: 'registry_name_required' });
    expect(mock.calls).toHaveLength(0);
  });
});

describe('registry wire helpers', () => {
  it('splits the street type and normalizes names', () => {
    expect(streetName('Av. Paulista')).toEqual({ name: 'PAULISTA', kind: 'AVENIDA' });
    expect(neighborhoodName(' São  João ')).toEqual({ name: 'SAO JOAO', kind: null });
  });
  it('formats the ERP date', () => {
    expect(erpDate(new Date(Date.UTC(2026, 0, 2, 1, 2, 3)), -180)).toBe('01/01/2026');
  });
  it('classifies transport failures', () => {
    expect(() => parseRegistrySaveResponse('street', 503, '')).toThrow(SankhyaGatewayError);
    expect(() => parseRegistrySaveResponse('street', 200, 'not json')).toThrow(/not JSON/);
  });
});
