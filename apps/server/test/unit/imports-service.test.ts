import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../../src/http/app-error.js';
import { AUDIT_ACTIONS } from '../../src/iam/audit.service.js';
import type { CurrentUser } from '../../src/iam/current-user.js';
import { GENERIC_DUPLICATE_MESSAGE } from '../../src/customers/customer-registration.service.js';
import { ImportsService } from '../../src/imports/imports.service.js';

const user = {
  accountId: 'acc-1',
  username: 'gerente',
  displayName: 'Gerente',
  role: 'manager',
  sellerCodes: [7],
  sessionId: 's',
  sessionExpiresAt: new Date(),
  channel: 'web',
} as unknown as CurrentUser;

const DATASET = { environment: 'staging', sankhyaEnvironment: 'sandbox' } as never;
const REQUEST_ID = '0b0f2c5e-0000-4000-8000-0000000000aa';
const b64 = (text: string): string => Buffer.from(text, 'utf8').toString('base64');

function product(code: number, extra: Record<string, unknown> = {}) {
  return { code, description: `Produto ${code}`, active: true, sellable: true, unit: 'UN', brand: null, reference: null, groupCode: null, groupName: null, quantityStep: null, ...extra };
}

function build() {
  const created: unknown[] = [];
  const registered: { clientRequestId: string; document: string; addresses: unknown[] }[] = [];
  const audit = { record: vi.fn(async () => undefined) };
  const catalogue = new Map<string, unknown>([
    ['100', product(100)],
    ['200', product(200, { sellable: false })],
    ['300', product(300, { quantityStep: '1' })],
  ]);
  const catalog = {
    resolve: vi.fn(async (_u: unknown, request: { identifiers: string[] }) => ({
      items: request.identifiers.map((identifier) => {
        const found = catalogue.get(identifier);
        return found === undefined ? { identifier, status: 'not_found' } : { identifier, status: 'found', product: found };
      }),
    })),
  };
  const orders = {
    create: vi.fn(async (_u: unknown, body: unknown) => {
      created.push(body);
      return { order: { id: '11111111-1111-4111-8111-111111111111', draftNumber: 5 }, replayed: false };
    }),
  };
  const policy = {
    accessContext: vi.fn(async () => ({ configuration: { sales: { quotationTopCode: 1000 } } })),
    customerScope: vi.fn(async () => ({ kind: 'all' })),
  };
  const holders = new Set<string>(['11144477735']);
  const refusals: unknown[] = [];
  const budget = { used: 0 };
  const registrationRepository = {
    defaultPriceTableCode: vi.fn(async () => 5),
    findDocumentHolder: vi.fn(async (document: string) => (holders.has(document) ? { code: 1 } : null)),
    countSince: vi.fn(async () => budget.used + refusals.length),
    recordRefusal: vi.fn(async (input: unknown) => {
      refusals.push(input);
    }),
    transaction: vi.fn(async (work: (tx: unknown) => Promise<unknown>) => work({})),
  };
  const registrations = {
    create: vi.fn(async (_u: unknown, body: { clientRequestId: string; document: string; addresses: unknown[] }) => {
      registered.push(body);
      return { response: {}, httpStatus: 201 };
    }),
  };
  const postalCodes = {
    lookupForImport: vi.fn(async (_u: unknown, cep: string) => {
      if (cep === '01310100') {
        return { found: true, postalCode: cep, street: 'Av Paulista', neighborhood: 'Bela Vista', city: 'Sao Paulo', uf: 'SP', cityCode: 10, neighborhoodCode: 20, streetCode: 30, source: 'erp' };
      }
      if (cep === '20040020') {
        return { found: true, postalCode: cep, street: 'Rua Nova', neighborhood: 'Centro', city: 'Rio', uf: 'RJ', cityCode: 11, neighborhoodCode: null, streetCode: null, source: 'viacep' };
      }
      return { found: false, postalCode: null, street: null, neighborhood: null, city: null, uf: null, cityCode: null, neighborhoodCode: null, streetCode: null, source: null };
    }),
  };
  const service = new ImportsService(policy as never, catalog as never, orders as never, registrations as never, registrationRepository as never, postalCodes as never, audit as never, () => new Date('2026-11-26T12:00:00Z'));
  return { service, created, registered, audit, orders, registrations, catalog, refusals, budget, holders };
}

describe('order-line import creates a quotation with only the recognized lines', () => {
  const file = 'Código;Quantidade\n100;2\n200;1\n999;1\n300;2,5\n100;abc\n100;\n100;4\n';

  it('previews recognized and rejected rows with a reason each, ignoring blank quantities', async () => {
    const { service } = build();
    const preview = await service.preview(user, { type: 'order_items', fileName: 'itens.csv', contentBase64: b64(file), customerCode: 55 });
    expect(preview.missingRequired).toEqual([]);
    expect(preview.recognized).toBe(2);
    expect(preview.rejected).toBe(4);
    expect(preview.skippedBlank).toBe(1);
    const reasons = Object.fromEntries(preview.errors.map((issue) => [issue.row, issue.reason]));
    expect(reasons[3]).toBe('Produto não vendável.');
    expect(reasons[4]).toBe('Código inexistente.');
    expect(reasons[5]).toContain('múltiplo');
    expect(reasons[6]).toBe('Quantidade inválida.');
  });

  it('confirms with the quotation TOP and the recognized lines only, and audits counts only', async () => {
    const { service, created, audit } = build();
    const result = await service.confirm(user, {
      type: 'order_items',
      fileName: 'itens.csv',
      contentBase64: b64(file),
      customerCode: 55,
      clientRequestId: REQUEST_ID,
      expectedDataset: DATASET,
    });
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      clientRequestId: REQUEST_ID,
      customerCode: 55,
      topCode: 1000,
      items: [
        { productCode: 100, quantity: '2' },
        { productCode: 100, quantity: '4' },
      ],
    });
    expect(result).toMatchObject({ created: 2, rejected: 4, orderId: '11111111-1111-4111-8111-111111111111', draftNumber: 5 });
    const [event] = audit.record.mock.calls[0] as unknown as [{ action: string; detail: Record<string, unknown> }];
    expect(event.action).toBe(AUDIT_ACTIONS.importCompleted);
    expect(JSON.stringify(event.detail)).not.toContain('Produto');
  });

  it('creates nothing when no row is recognized', async () => {
    const { service, orders } = build();
    await expect(
      service.confirm(user, { type: 'order_items', fileName: 'x.csv', contentBase64: b64('codigo;quantidade\n999;1\n'), customerCode: 55, clientRequestId: REQUEST_ID, expectedDataset: DATASET }),
    ).rejects.toBeInstanceOf(AppError);
    expect(orders.create).not.toHaveBeenCalled();
  });

  it('asks for the customer and for the mapped columns', async () => {
    const { service } = build();
    await expect(service.preview(user, { type: 'order_items', fileName: 'x.csv', contentBase64: b64('codigo;quantidade\n100;1\n') })).rejects.toBeInstanceOf(AppError);
    const preview = await service.preview(user, { type: 'order_items', fileName: 'x.csv', contentBase64: b64('a;b\n100;1\n'), customerCode: 55 });
    expect(preview.missingRequired).toEqual(['product', 'quantity']);
    await expect(
      service.confirm(user, { type: 'order_items', fileName: 'x.csv', contentBase64: b64('a;b\n100;1\n'), customerCode: 55, clientRequestId: REQUEST_ID, expectedDataset: DATASET }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it('refuses a bad file type before reading it', async () => {
    const { service, catalog } = build();
    await expect(service.preview(user, { type: 'order_items', fileName: 'x.exe', contentBase64: b64('a'), customerCode: 55 })).rejects.toBeInstanceOf(AppError);
    expect(catalog.resolve).not.toHaveBeenCalled();
  });
});

describe('customer batch import', () => {
  const header = 'CPF/CNPJ;Nome;CEP;Número\n';
  const file = [
    header,
    '529.982.247-25;Cliente Valido;01310-100;10\n',
    '111.444.777-35;Cliente Duplicado;01310-100;11\n',
    '390.533.447-05;Cliente CEP Novo;20040020;12\n',
    '123;Documento Ruim;01310100;1\n',
    '529.982.247-25;Repetido na Planilha;01310100;1\n',
  ].join('');

  it('previews: 1 valid, 1 duplicate in the register, 1 new CEP, a bad and a repeated document', async () => {
    const { service } = build();
    const preview = await service.preview(user, { type: 'customers', fileName: 'clientes.csv', contentBase64: b64(file) });
    expect(preview.recognized).toBe(2);
    const reasons = Object.fromEntries(preview.errors.map((issue) => [issue.row, issue.reason]));
    expect(reasons[3]).toBe(GENERIC_DUPLICATE_MESSAGE);
    expect(reasons[5]).toContain('CPF/CNPJ');
    expect(reasons[6]).toContain('repetido');
    expect(preview.rejected).toBe(3);
  });

  it('spends the manual-registration budget on a document hit: refusal recorded and audited, generic text only', async () => {
    const { service, refusals, audit } = build();
    const preview = await service.preview(user, { type: 'customers', fileName: 'clientes.csv', contentBase64: b64(file) });
    expect(preview.errors.find((issue) => issue.row === 3)?.reason).toBe(GENERIC_DUPLICATE_MESSAGE);
    expect(refusals).toHaveLength(1);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: AUDIT_ACTIONS.customerRegistrationRefused, actorAccountId: 'acc-1' }), expect.anything());
  });

  it('refuses the preview with rate_limited once the hourly budget is spent, before any lookup', async () => {
    const { service, budget, holders } = build();
    budget.used = 30;
    await expect(service.preview(user, { type: 'customers', fileName: 'clientes.csv', contentBase64: b64(file) })).rejects.toMatchObject({ code: 'rate_limited' });
    expect(holders.size).toBe(1);
  });

  it('confirms through the registration service, one call per accepted row, with a stable id per row', async () => {
    const first = build();
    const result = await first.service.confirm(user, { type: 'customers', fileName: 'c.csv', contentBase64: b64(file), clientRequestId: REQUEST_ID });
    expect(first.registered.map((request) => request.document)).toEqual(['529.982.247-25', '390.533.447-05']);
    expect(result).toMatchObject({ type: 'customers', created: 2, rejected: 3, pending: 0 });
    expect(first.registered[0]?.addresses).toEqual([expect.objectContaining({ cityCode: 10, streetCode: 30, neighborhoodCode: 20, postalCode: '01310100' })]);
    expect(first.registered[1]?.addresses).toEqual([expect.objectContaining({ cityCode: 11, streetName: 'Rua Nova', postalCode: '20040020' })]);

    const again = build();
    await again.service.confirm(user, { type: 'customers', fileName: 'c.csv', contentBase64: b64(file), clientRequestId: REQUEST_ID });
    expect(again.registered.map((request) => request.clientRequestId)).toEqual(first.registered.map((request) => request.clientRequestId));
  });

  it('reports the registration refusal of a row without stopping the others', async () => {
    const { service, registrations } = build();
    registrations.create.mockRejectedValueOnce(new AppError('validation_failed', { message: 'recusado', details: { fields: { email: 'E-mail inválido.' } } }));
    const result = await service.confirm(user, {
      type: 'customers',
      fileName: 'c.csv',
      contentBase64: b64(`${header}529.982.247-25;Um;01310100;1\n390.533.447-05;Dois;20040020;2\n`),
      clientRequestId: REQUEST_ID,
    });
    expect(result.created).toBe(1);
    expect(result.errors).toEqual([{ row: 2, reason: 'E-mail inválido.' }]);
  });

  it('refuses a row without CEP before writing anything', async () => {
    const { service, registered } = build();
    const content = b64(`${header}529.982.247-25;Sem CEP;;1\n`);
    const preview = await service.preview(user, { type: 'customers', fileName: 'c.csv', contentBase64: content });
    expect(preview.errors).toEqual([{ row: 2, reason: 'Informe o CEP.' }]);
    const result = await service.confirm(user, { type: 'customers', fileName: 'c.csv', contentBase64: content, clientRequestId: REQUEST_ID });
    expect(result.created).toBe(0);
    expect(result.errors).toEqual([{ row: 2, reason: 'Informe o CEP.' }]);
    expect(registered).toHaveLength(0);
  });

  it('rejects an unknown CEP and caps one import at 30 customers', async () => {
    const { service } = build();
    const preview = await service.preview(user, { type: 'customers', fileName: 'c.csv', contentBase64: b64(`${header}529.982.247-25;Um;99999999;1\n`) });
    expect(preview.errors[0]?.reason).toContain('CEP');
    const many = Array.from({ length: 32 }, (_v, index) => `${String(10000000000 + index)};Cliente ${index};01310100;1\n`).join('');
    const capped = await service.preview(user, { type: 'customers', fileName: 'c.csv', contentBase64: b64(header + many) });
    expect(capped.errors.filter((issue) => issue.reason.includes('Limite de 30'))).toHaveLength(2);
  });
});
