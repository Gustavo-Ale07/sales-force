import { describe, expect, it } from 'vitest';
import { RealSankhyaGateway, Secret } from '../src/index.js';
import { collect } from './support/gateway-contract.js';
import { MockSankhya, TEST_BASE_URL, TEST_CREDENTIALS, TEST_HOST, type ErpTables } from './support/mock-sankhya.js';

// Synthetic values only (spike §9.70 holds the validated Sandbox facts; no real partner data here).
function par(code: number, patch: Record<string, unknown>) {
  return {
    CODPARC: code, CLIENTE: 'S', NOMEPARC: `P${code}`, RAZAOSOCIAL: `Parceiro ${code}`, CGC_CPF: null, ATIVO: 'S', BLOQUEAR: 'N', CODVEND: 1, CODTAB: 1,
    LIMCRED: null, LIMCREDMENSAL: null, MOTBLOQ: null, SITUACAO: null,
    TELEFONE: null, EMAIL: null, CEP: null, NUMEND: null, COMPLEMENTO: null, STREETKIND: null, STREETNAME: null, NEIGHBORHOOD: null, CITYNAME: null, STATEUF: null,
    ...patch,
  };
}

function gatewayOver(tables: ErpTables) {
  const clock = { now: Date.parse('2026-11-27T12:00:00.000Z') };
  const mock = new MockSankhya({ tables, clock });
  const gateway = new RealSankhyaGateway({
    baseUrl: TEST_BASE_URL,
    allowedHosts: [TEST_HOST],
    environmentKind: 'sandbox',
    credentials: { clientId: new Secret(TEST_CREDENTIALS.clientId), clientSecret: new Secret(TEST_CREDENTIALS.clientSecret), xToken: new Secret(TEST_CREDENTIALS.xToken) },
    transport: mock.transport,
    now: () => clock.now,
    pageSize: 10,
  });
  return { gateway, mock };
}

describe('real gateway: customer registry (spike 9.70)', () => {
  it('maps the registry columns; street = "TYPE NAME"; a 7-digit CEP regains its leading zero; blanks become null', async () => {
    const { gateway, mock } = gatewayOver({
      TGFPAR: [
        par(1, { TELEFONE: ' 1130000000 ', EMAIL: 'a@example.test', CEP: '1310100', NUMEND: '100', COMPLEMENTO: 'Sala 2', STREETKIND: 'Rua', STREETNAME: 'Teste', NEIGHBORHOOD: 'Centro', CITYNAME: 'Cidade Exemplo', STATEUF: 'sp' }),
        par(2, { CEP: '40000000', STREETNAME: 'Sem Tipo', COMPLEMENTO: '   ' }),
        par(3, {}),
      ],
    });
    const { rows } = await collect(gateway.readCustomers());
    expect(rows[0]?.registry).toEqual({
      postalCode: '01310100', street: 'Rua Teste', number: '100', complement: 'Sala 2', neighborhood: 'Centro', city: 'Cidade Exemplo', state: 'SP', phone: '1130000000', email: 'a@example.test',
    });
    expect(rows[1]?.registry).toMatchObject({ postalCode: '40000000', street: 'Sem Tipo', complement: null, phone: null });
    expect(rows[2]?.registry).toEqual({ postalCode: null, street: null, number: null, complement: null, neighborhood: null, city: null, state: null, phone: null, email: null });
    const sql = mock.queries().map((q) => q.sql).join('\n');
    expect(sql).toContain('FROM TSIEND E WHERE E.CODEND = TGFPAR.CODEND');
    // Never read: CELULAR and the default carrier do not exist in TGFPAR (ORA-00904 in the Sandbox).
    expect(sql).not.toMatch(/CELULAR|CODTRANSP|TELEFONE2/);
  });
});
