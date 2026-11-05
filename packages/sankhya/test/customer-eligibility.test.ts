import { describe, expect, it } from 'vitest';
import type { Customer } from '@salesforce/domain';
import { FakeGateway, RealSankhyaGateway, SankhyaGatewayError, Secret, getDemoDataset } from '../src/index.js';
import { assertSafeScope, customerExclusion, type CustomerEligibilityScope } from '../src/read-scope.js';
import { collect } from './support/gateway-contract.js';
import { MockSankhya, TEST_BASE_URL, TEST_CREDENTIALS, TEST_HOST, ok, type ErpTables } from './support/mock-sankhya.js';

const RULES: CustomerEligibilityScope = {
  activeOnly: true,
  requiredFlags: ['CLIENTE'],
  columnIn: [{ column: 'CLASSIFICMS', values: ['R'] }],
};

function par(code: number, patch: Record<string, unknown>) {
  return { CODPARC: code, CLIENTE: 'S', NOMEPARC: `P${code}`, RAZAOSOCIAL: `Parceiro ${code}`, CGC_CPF: null, ATIVO: 'S', BLOQUEAR: 'N', CODVEND: 1, CODTAB: 1, LIMCRED: null, LIMCREDMENSAL: null, MOTBLOQ: null, SITUACAO: null, CLASSIFICMS: 'R', ...patch };
}

const TABLES: ErpTables = {
  TGFPAR: [
    par(1, {}),
    par(2, { ATIVO: 'N' }),
    par(3, { CLIENTE: 'N' }),
    par(4, { CLASSIFICMS: 'C' }),
    par(5, { CLASSIFICMS: null }),
    par(6, {}),
  ],
};

function gatewayOver(tables: ErpTables) {
  const clock = { now: Date.parse('2026-11-04T12:00:00.000Z') };
  const mock = new MockSankhya({ tables, clock });
  const gateway = new RealSankhyaGateway({
    baseUrl: TEST_BASE_URL,
    allowedHosts: [TEST_HOST],
    environmentKind: 'sandbox',
    credentials: {
      clientId: new Secret(TEST_CREDENTIALS.clientId),
      clientSecret: new Secret(TEST_CREDENTIALS.clientSecret),
      xToken: new Secret(TEST_CREDENTIALS.xToken),
    },
    transport: mock.transport,
    now: () => clock.now,
    pageSize: 3,
  });
  return { gateway, mock };
}

describe('customerExclusion (D-V 4)', () => {
  const attr = (values: Record<string, string | null>) => (column: string) => values[column];
  it('reports the first failing criterion', () => {
    expect(customerExclusion(true, attr({ CLIENTE: 'S', CLASSIFICMS: 'R' }), RULES)).toBeNull();
    expect(customerExclusion(false, attr({ CLIENTE: 'S', CLASSIFICMS: 'R' }), RULES)).toBe('active');
    expect(customerExclusion(true, attr({ CLIENTE: 'N', CLASSIFICMS: 'R' }), RULES)).toBe('flag:CLIENTE');
    expect(customerExclusion(true, attr({ CLIENTE: 'S', CLASSIFICMS: 'C' }), RULES)).toBe('column:CLASSIFICMS');
    expect(customerExclusion(true, attr({ CLIENTE: 'S', CLASSIFICMS: null }), RULES)).toBe('column:CLASSIFICMS');
  });

  it('activeOnly=false lets inactive partners through', () => {
    expect(customerExclusion(false, attr({ CLIENTE: 'S', CLASSIFICMS: 'R' }), { ...RULES, activeOnly: false })).toBeNull();
  });

  it('the scope validates column names and values (they reach SQL text)', () => {
    expect(() => assertSafeScope({ customers: RULES })).not.toThrow();
    expect(() => assertSafeScope({ customers: { ...RULES, requiredFlags: ['CLIENTE; DROP'] } })).toThrow(RangeError);
    expect(() => assertSafeScope({ customers: { ...RULES, columnIn: [{ column: 'CLASSIFICMS', values: ["R'--"] }] } })).toThrow(RangeError);
    expect(() => assertSafeScope({ customers: { ...RULES, columnIn: [{ column: 'CLASSIFICMS', values: [] }] } })).toThrow(RangeError);
  });
});

describe('real gateway: customers under an eligibility rule', () => {
  it('delivers only eligible partners and counts what each criterion left out', async () => {
    const { gateway, mock } = gatewayOver(TABLES);
    mock.forced.push(ok(['COLUMN_NAME'], [['CODPARC'], ['CLIENTE'], ['CLASSIFICMS'], ['ATIVO']]));
    let counts: Readonly<Record<string, number>> | undefined;
    const { rows } = await collect(gateway.readCustomers({ scope: { customers: RULES }, onExcluded: (_e, c) => (counts = c) }));
    expect(rows.map((c) => c.code)).toEqual([1, 6]);
    expect(counts).toEqual({ active: 1, 'flag:CLIENTE': 1, 'column:CLASSIFICMS': 2 });
    const sql = mock.queries().map((q) => q.sql ?? '').join('\n');
    expect(sql).toContain("FROM USER_TAB_COLUMNS WHERE TABLE_NAME = 'TGFPAR'");
    expect(sql).toContain('CLASSIFICMS');
  });

  it('a missing eligibility column fails closed naming it', async () => {
    const { gateway, mock } = gatewayOver(TABLES);
    mock.forced.push(ok(['COLUMN_NAME'], [['CODPARC'], ['CLIENTE']]));
    const failure = (await collect(gateway.readCustomers({ scope: { customers: RULES } })).catch((e: unknown) => e)) as SankhyaGatewayError;
    expect(failure).toBeInstanceOf(SankhyaGatewayError);
    expect(failure).toMatchObject({ kind: 'validation', code: 'customer_eligibility_column_missing', retryable: false });
    expect(failure.message).toContain('CLASSIFICMS');
  });

  it('without a rule the previous CLIENTE-only read is unchanged (no discovery query)', async () => {
    const { gateway, mock } = gatewayOver(TABLES);
    const { rows } = await collect(gateway.readCustomers());
    expect(rows.map((c) => c.code)).toEqual([1, 2, 4, 5, 6]);
    expect(mock.queries().map((q) => q.sql ?? '').join('\n')).not.toContain('USER_TAB_COLUMNS');
  });
});

describe('real gateway: carriers (D-V 5)', () => {
  it('reads active carriers only', async () => {
    const { gateway, mock } = gatewayOver({
      TGFPAR: [
        { CODPARC: 10, TRANSPORTADORA: 'S', ATIVO: 'S', NOMEPARC: 'A', RAZAOSOCIAL: null },
        { CODPARC: 11, TRANSPORTADORA: 'S', ATIVO: 'N', NOMEPARC: 'B', RAZAOSOCIAL: null },
        { CODPARC: 12, TRANSPORTADORA: 'N', ATIVO: 'S', NOMEPARC: 'C', RAZAOSOCIAL: null },
      ],
    });
    const excluded: Record<string, number>[] = [];
    const { rows } = await collect(gateway.readCarriers({ onExcluded: (_e, counts) => excluded.push({ ...counts }) }));
    expect(rows.map((c) => c.code)).toEqual([10]);
    expect(mock.queries().map((q) => q.sql ?? '').join('\n')).toContain("TRANSPORTADORA = 'S' AND CODPARC > 0");
    // D-V adendo: counts per criterion - inactive carrier (11) and the partner not flagged as carrier (12).
    expect(excluded).toEqual([{ 'flag:TRANSPORTADORA': 1, active: 1 }]);
  });
});

describe('fake gateway parity', () => {
  it('applies the same rule over sourceAttributes (CLIENTE defaults to S) and counts', async () => {
    const dataset = getDemoDataset();
    const base: Customer = dataset.customers[0]!;
    const customers: Customer[] = [
      { ...base, code: 1, active: true, sourceAttributes: { CLASSIFICMS: 'R' } },
      { ...base, code: 2, active: false, sourceAttributes: { CLASSIFICMS: 'R' } },
      { ...base, code: 3, active: true, sourceAttributes: { CLIENTE: 'N', CLASSIFICMS: 'R' } },
      { ...base, code: 4, active: true, sourceAttributes: { CLASSIFICMS: 'C' } },
    ];
    const gateway = new FakeGateway({ dataset: { ...dataset, customers } });
    let counts: Readonly<Record<string, number>> | undefined;
    const { rows } = await collect(gateway.readCustomers({ scope: { customers: RULES }, onExcluded: (_e, c) => (counts = c) }));
    expect(rows.map((c) => c.code)).toEqual([1]);
    expect(counts).toEqual({ active: 1, 'flag:CLIENTE': 1, 'column:CLASSIFICMS': 1 });
  });
});
