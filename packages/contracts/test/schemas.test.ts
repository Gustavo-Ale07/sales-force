import { describe, expect, it } from 'vitest';
import {
  ApiErrorSchema,
  CreateOrderRequestSchema,
  CustomersQuerySchema,
  DashboardResponseSchema,
  DecimalStringSchema,
  ERROR_CODES,
  ERROR_HTTP_STATUS,
  ErpSubmissionDisabledErrorSchema,
  ListPriceContextSchema,
  LoginRequestSchema,
  OrderDetailSchema,
  OrderItemInputSchema,
  OrdersQuerySchema,
  ProductsQuerySchema,
  ResolveProductsRequestSchema,
  ResolveProductsResponseSchema,
  ReplaceOrderRequestSchema,
  SellersQuerySchema,
  SessionResponseSchema,
  routes,
  toColonPath,
} from '../src/index.js';
import { UUID_A, UUID_B } from './fixtures.js';

const TS = '2030-01-01T00:00:00.000Z';

describe('decimal strings', () => {
  it('accepts plain decimals and rejects numbers, signs, exponents and separators', () => {
    for (const ok of ['0', '12', '12.5', '0.005', '1000000.123456']) {
      expect(DecimalStringSchema.safeParse(ok).success).toBe(true);
    }
    for (const bad of [12, '-1', '1e3', '1,5', '', ' 1', '1.', '.5', 'NaN']) {
      expect(DecimalStringSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe('list queries', () => {
  it('applies defaults and coerces numbers from strings', () => {
    const parsed = CustomersQuerySchema.parse({});
    expect(parsed).toEqual({ sort: 'name', page: 1, pageSize: 25 });
    expect(
      CustomersQuerySchema.parse({ page: '3', pageSize: '50', sellerCode: '900' }),
    ).toMatchObject({
      page: 3,
      pageSize: 50,
      sellerCode: 900,
    });
  });

  it('parses boolean strings exactly ("false" is false)', () => {
    expect(CustomersQuerySchema.parse({ hasPriceTable: 'false' }).hasPriceTable).toBe(false);
    expect(CustomersQuerySchema.parse({ hasPriceTable: 'true' }).hasPriceTable).toBe(true);
    expect(CustomersQuerySchema.safeParse({ hasPriceTable: 'yes' }).success).toBe(false);
    expect(ProductsQuerySchema.parse({ sellable: 'false' }).sellable).toBe(false);
    expect(SellersQuerySchema.parse({ active: 'true' }).active).toBe(true);
  });

  it('rejects out-of-range or malformed pagination and unknown sort/status values', () => {
    for (const query of [
      { page: '0' },
      { pageSize: '0' },
      { pageSize: '101' },
      { page: '1.5' },
      { page: 'x' },
    ]) {
      expect(CustomersQuerySchema.safeParse(query).success).toBe(false);
    }
    expect(CustomersQuerySchema.safeParse({ sort: 'cost' }).success).toBe(false);
    expect(CustomersQuerySchema.safeParse({ status: 'gone' }).success).toBe(false);
    expect(ProductsQuerySchema.safeParse({ priceState: 'free' }).success).toBe(false);
    expect(OrdersQuerySchema.safeParse({ status: 'shipped' }).success).toBe(false);
  });

  it('trims search and rejects blank or oversized search', () => {
    expect(CustomersQuerySchema.parse({ search: '  ana  ' }).search).toBe('ana');
    expect(CustomersQuerySchema.safeParse({ search: '   ' }).success).toBe(false);
    expect(CustomersQuerySchema.safeParse({ search: 'x'.repeat(101) }).success).toBe(false);
  });

  it('products query carries the customer price context and orders default to newest first', () => {
    expect(ProductsQuerySchema.parse({ customerCode: '5001', group: '10' })).toMatchObject({
      customerCode: 5001,
      group: 10,
      sort: 'description',
    });
    expect(OrdersQuerySchema.parse({}).sort).toBe('-updatedAt');
  });

  it('orders query: period as calendar dates, products as a deduplicated comma list', () => {
    expect(OrdersQuerySchema.parse({ from: '2026-03-01', to: '2026-03-31', dateField: 'updatedAt' })).toMatchObject({
      from: '2026-03-01',
      to: '2026-03-31',
      dateField: 'updatedAt',
    });
    expect(OrdersQuerySchema.parse({ productCodes: '12,34,12', productMatch: 'all' })).toMatchObject({
      productCodes: [12, 34],
      productMatch: 'all',
    });
    expect(OrdersQuerySchema.parse({ productCodes: '7' }).productCodes).toEqual([7]);
    for (const query of [
      { from: '01/03/2026' },
      { to: '2026-02-30' },
      { dateField: 'deletedAt' },
      { productMatch: 'some' },
      { productCodes: '' },
      { productCodes: '1,,2' },
      { productCodes: '1;2' },
      { productCodes: '-3' },
      { productCodes: Array.from({ length: 21 }, (_, i) => i).join(',') },
    ]) {
      expect(OrdersQuerySchema.safeParse(query).success, JSON.stringify(query)).toBe(false);
    }
    expect(OrdersQuerySchema.safeParse({ productCodes: Array.from({ length: 20 }, (_, i) => i).join(',') }).success).toBe(true);
  });
});

describe('list price context', () => {
  it('accepts priced, zero and none in their consistent shapes', () => {
    const priced = {
      state: 'priced',
      unitPrice: '12.5',
      tableCode: 88,
      versionId: 3,
      noPriceReason: null,
    };
    const zero = { ...priced, state: 'zero', unitPrice: '0' };
    const none = {
      state: 'none',
      unitPrice: null,
      tableCode: null,
      versionId: null,
      noPriceReason: 'no_resolved_table',
    };
    for (const value of [priced, zero, none]) {
      expect(ListPriceContextSchema.parse(value)).toEqual(value);
    }
  });

  it('rejects inconsistent combinations (missing price is never 0)', () => {
    const none = {
      state: 'none',
      unitPrice: null,
      tableCode: 88,
      versionId: 3,
      noPriceReason: 'no_price_row',
    };
    expect(ListPriceContextSchema.safeParse({ ...none, unitPrice: '0' }).success).toBe(false);
    expect(ListPriceContextSchema.safeParse({ ...none, noPriceReason: null }).success).toBe(false);
    expect(
      ListPriceContextSchema.safeParse({
        state: 'priced',
        unitPrice: null,
        tableCode: 1,
        versionId: 1,
        noPriceReason: null,
      }).success,
    ).toBe(false);
    expect(
      ListPriceContextSchema.safeParse({
        state: 'priced',
        unitPrice: 12.5,
        tableCode: 1,
        versionId: 1,
        noPriceReason: null,
      }).success,
    ).toBe(false);
    expect(ListPriceContextSchema.safeParse({ ...none, noPriceReason: 'because' }).success).toBe(
      false,
    );
  });
});

const DATASET = { environment: 'sandbox', datasetId: 'plac-sandbox-real-1' };

describe('order requests', () => {
  const draft = {
    customerCode: 5001,
    negotiationTypeCode: 31,
    notes: null,
    items: [{ productCode: 3001, quantity: '2.5' }],
  };

  it('parses create and replace requests', () => {
    expect(CreateOrderRequestSchema.parse({ clientRequestId: UUID_A, expectedDataset: DATASET, ...draft })).toEqual({
      clientRequestId: UUID_A,
      expectedDataset: DATASET,
      ...draft,
    });
    expect(ReplaceOrderRequestSchema.parse({ expectedVersion: 2, expectedDataset: DATASET, ...draft }).expectedVersion).toBe(
      2,
    );
    expect(
      CreateOrderRequestSchema.parse({ clientRequestId: UUID_B, expectedDataset: DATASET, ...draft, items: [] }).items,
    ).toEqual([]);
  });

  it('requires expectedDataset on create and replace (no default, strict shape)', () => {
    const create = { clientRequestId: UUID_A, ...draft };
    expect(CreateOrderRequestSchema.safeParse(create).success).toBe(false);
    expect(ReplaceOrderRequestSchema.safeParse({ expectedVersion: 1, ...draft }).success).toBe(false);
    for (const bad of [null, {}, { environment: 'sandbox' }, { datasetId: 'plac-sandbox-real-1' }, { ...DATASET, extra: 1 }, { environment: 'Sandbox', datasetId: 'x' }]) {
      expect(CreateOrderRequestSchema.safeParse({ ...create, expectedDataset: bad }).success).toBe(false);
      expect(ReplaceOrderRequestSchema.safeParse({ expectedVersion: 1, ...draft, expectedDataset: bad }).success).toBe(false);
    }
  });

  it('serves dataset_mismatch as a 409 error code', () => {
    expect(ERROR_HTTP_STATUS.dataset_mismatch).toBe(409);
    expect(ApiErrorSchema.safeParse({ code: 'dataset_mismatch', message: 'x' }).success).toBe(true);
  });

  it('serves no_seller_scope as 403 and customer_without_seller as 409', () => {
    expect(ERROR_HTTP_STATUS.no_seller_scope).toBe(403);
    expect(ERROR_HTTP_STATUS.customer_without_seller).toBe(409);
    expect(ApiErrorSchema.safeParse({ code: 'no_seller_scope', message: 'x' }).success).toBe(true);
    expect(ApiErrorSchema.safeParse({ code: 'customer_without_seller', message: 'x' }).success).toBe(true);
  });

  it('rejects client-sent prices and totals on lines and on the order (unrecognized keys)', () => {
    for (const key of ['unitPrice', 'unitListPrice', 'price', 'estimatedLineTotal', 'total']) {
      expect(
        OrderItemInputSchema.safeParse({ productCode: 1, quantity: '1', [key]: '9.99' }).success,
      ).toBe(false);
    }
    expect(
      CreateOrderRequestSchema.safeParse({
        clientRequestId: UUID_A,
        ...draft,
        estimatedTotal: '10.00',
      }).success,
    ).toBe(false);
  });

  it('rejects malformed requests', () => {
    const create = { clientRequestId: UUID_A, expectedDataset: DATASET, ...draft };
    expect(CreateOrderRequestSchema.safeParse({ ...create, clientRequestId: 'abc' }).success).toBe(
      false,
    );
    expect(
      CreateOrderRequestSchema.safeParse({ ...create, clientRequestId: undefined }).success,
    ).toBe(false);
    expect(
      CreateOrderRequestSchema.safeParse({ ...create, items: [{ productCode: 1, quantity: 2 }] })
        .success,
    ).toBe(false);
    expect(
      CreateOrderRequestSchema.safeParse({ ...create, items: [{ productCode: 1, quantity: '-2' }] })
        .success,
    ).toBe(false);
    expect(
      CreateOrderRequestSchema.safeParse({ ...create, items: [{ productCode: -1, quantity: '1' }] })
        .success,
    ).toBe(false);
    expect(CreateOrderRequestSchema.safeParse({ ...create, notes: 'x'.repeat(2001) }).success).toBe(
      false,
    );
    expect(
      CreateOrderRequestSchema.safeParse({
        ...create,
        items: Array.from({ length: 501 }, () => ({ productCode: 1, quantity: '1' })),
      }).success,
    ).toBe(false);
    expect(ReplaceOrderRequestSchema.safeParse({ expectedDataset: DATASET, ...draft }).success).toBe(false);
    expect(ReplaceOrderRequestSchema.safeParse({ expectedVersion: 0, expectedDataset: DATASET, ...draft }).success).toBe(
      false,
    );
  });

  it('parses an order detail with a priced and an unpriced line', () => {
    const detail = {
      id: UUID_A,
      draftNumber: 7,
      customerCode: 5001,
      customerName: 'Cliente Sintetico',
      sellerCode: 900,
      status: 'draft',
      estimatedTotal: '25.00',
      itemCount: 2,
      isPartial: true,
      erpNumber: null,
      version: 1,
      createdAt: TS,
      updatedAt: TS,
      negotiationTypeCode: null,
      notes: null,
      items: [
        {
          lineNo: 1,
          productCode: 3001,
          productDescription: 'Produto',
          unit: 'UN',
          quantity: '2',
          unitListPrice: '12.5',
          discountPercent: '0',
          priceState: 'priced',
          priceTableCode: 88,
          priceVersionId: 3,
          estimatedLineTotal: '25.00',
        },
        {
          lineNo: 2,
          productCode: 3002,
          productDescription: 'Sem preco',
          unit: 'UN',
          quantity: '1',
          unitListPrice: null,
          discountPercent: '0',
          priceState: 'none',
          priceTableCode: null,
          priceVersionId: null,
          estimatedLineTotal: null,
        },
      ],
      totals: { estimatedTotal: '25.00', lineCount: 2, unpricedLineCount: 1, isPartial: true },
    };
    expect(OrderDetailSchema.parse(detail)).toEqual(detail);
    expect(OrderDetailSchema.safeParse({ ...detail, status: 'shipped' }).success).toBe(false);
    expect(OrderDetailSchema.safeParse({ ...detail, estimatedTotal: 25 }).success).toBe(false);
  });
});

describe('error envelope', () => {
  it('parses every enumerated code and rejects unknown codes', () => {
    for (const code of ERROR_CODES) {
      expect(ApiErrorSchema.safeParse({ code, message: 'x' }).success).toBe(true);
    }
    expect(ApiErrorSchema.safeParse({ code: 'boom', message: 'x' }).success).toBe(false);
    expect(ApiErrorSchema.safeParse({ code: 'not_found' }).success).toBe(false);
  });

  it('carries optional issue details', () => {
    const error = {
      code: 'validation_failed',
      message: 'Dados inválidos',
      details: { issues: [{ path: 'items[0].quantity', code: 'invalid_quantity' }] },
    };
    expect(ApiErrorSchema.parse(error)).toEqual(error);
  });

  it('has an HTTP status for every code', () => {
    expect(Object.keys(ERROR_HTTP_STATUS).sort()).toEqual([...ERROR_CODES].sort());
    expect(ERROR_HTTP_STATUS.erp_submission_disabled).toBe(409);
  });

  it('models the submit-disabled error and binds it to the submit route', () => {
    expect(
      ErpSubmissionDisabledErrorSchema.parse({
        code: 'erp_submission_disabled',
        message: 'aguardando',
      }).code,
    ).toBe('erp_submission_disabled');
    expect(
      ErpSubmissionDisabledErrorSchema.safeParse({ code: 'conflict', message: 'x' }).success,
    ).toBe(false);
    expect(routes.submitOrder.responses[409].schema).toBe(ErpSubmissionDisabledErrorSchema);
    expect(Object.keys(routes.submitOrder.responses)).toEqual(['409']);
  });
});

describe('auth', () => {
  it('login request is strict and bounded', () => {
    expect(LoginRequestSchema.parse({ email: 'a@example.test', password: 'x' }).email).toBe(
      'a@example.test',
    );
    expect(LoginRequestSchema.safeParse({ email: 'nope', password: 'x' }).success).toBe(false);
    expect(LoginRequestSchema.safeParse({ email: 'a@example.test', password: '' }).success).toBe(
      false,
    );
    expect(
      LoginRequestSchema.safeParse({ email: 'a@example.test', password: 'x', remember: true })
        .success,
    ).toBe(false);
  });

  it('session response is a discriminated union on `authenticated`', () => {
    expect(SessionResponseSchema.parse({ authenticated: false, authMode: 'dev' })).toEqual({
      authenticated: false,
      authMode: 'dev',
    });
    const account = {
      id: UUID_A,
      email: 'a@example.test',
      displayName: 'Ana',
      role: 'seller',
      sellerCodes: [900],
    };
    const session = { authenticated: true, authMode: 'dev', account, expiresAt: TS };
    expect(SessionResponseSchema.parse(session)).toEqual(session);
    expect(SessionResponseSchema.safeParse({ authenticated: true, authMode: 'dev' }).success).toBe(
      false,
    );
    expect(
      SessionResponseSchema.safeParse({ ...session, account: { ...account, role: 'root' } })
        .success,
    ).toBe(false);
  });
});

describe('dashboard', () => {
  it('marks each metric group as demo or real', () => {
    const dashboard = {
      generatedAt: TS,
      scope: { kind: 'sellers', sellerCodes: [900] },
      groups: [
        {
          key: 'portfolio',
          label: 'Carteira',
          demo: false,
          metrics: [
            {
              key: 'customers',
              label: 'Clientes',
              value: { kind: 'count', value: 12 },
              description: null,
            },
          ],
        },
        {
          key: 'credit',
          label: 'Crédito',
          demo: true,
          metrics: [
            {
              key: 'open',
              label: 'Em aberto',
              value: { kind: 'money', value: '1500.00' },
              description: null,
            },
          ],
        },
      ],
      recentOrders: [],
    };
    expect(DashboardResponseSchema.parse(dashboard)).toEqual(dashboard);
    const withoutDemo = { ...dashboard, groups: [{ key: 'portfolio', label: 'x', metrics: [] }] };
    expect(DashboardResponseSchema.safeParse(withoutDemo).success).toBe(false);
    const numericMoney = {
      ...dashboard,
      groups: [
        {
          key: 'credit',
          label: 'x',
          demo: true,
          metrics: [
            { key: 'k', label: 'l', value: { kind: 'money', value: 15 }, description: null },
          ],
        },
      ],
    };
    expect(DashboardResponseSchema.safeParse(numericMoney).success).toBe(false);
  });
});

describe('route registry', () => {
  it('has unique operation ids that match their keys and unique method+path pairs', () => {
    const entries = Object.entries(routes);
    expect(new Set(entries.map(([, r]) => r.operationId)).size).toBe(entries.length);
    for (const [key, route] of entries) expect(route.operationId).toBe(key);
    expect(new Set(entries.map(([, r]) => `${r.method} ${r.path}`)).size).toBe(entries.length);
  });

  it('every path parameter in a path has a params schema and vice versa', () => {
    for (const route of Object.values(routes)) {
      const inPath = [...route.path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]).sort();
      const params =
        'params' in route.request ? Object.keys(route.request.params.shape).sort() : [];
      expect(params).toEqual(inPath);
    }
  });

  it('converts to framework path syntax and only the public routes are unauthenticated', () => {
    expect(toColonPath(routes.getCustomer)).toBe('/customers/:code');
    const publicRoutes = Object.values(routes)
      .filter((r) => r.auth === 'public')
      .map((r) => r.operationId)
      .sort();
    expect(publicRoutes).toEqual(['getHealth', 'getReady', 'getSession', 'login']);
  });
});

describe('product resolution (POST /product-resolutions)', () => {
  const listItem = {
    code: 10,
    description: 'Produto',
    active: true,
    sellable: true,
    unit: 'UN',
    brand: null,
    reference: 'REF-1',
    groupCode: null,
    groupName: null,
    listPrice: { state: 'none', unitPrice: null, tableCode: null, versionId: null, noPriceReason: 'no_resolved_table' },
  };
  const priceContext = { customerCode: null, tableCode: null, tableName: null, source: 'none' };

  it('describes the route: post, session, catalog, 400/401/403/404, body capped at 128 kB', () => {
    const route = routes.resolveProducts;
    expect(route.operationId).toBe('resolveProducts');
    expect(route.method).toBe('post');
    expect(route.path).toBe('/product-resolutions');
    expect(route.auth).toBe('session');
    expect(route.tags).toEqual(['catalog']);
    expect([...route.errors]).toEqual([400, 401, 403, 404]);
    expect(route.maxBodyBytes).toBe(128 * 1024);
  });

  it('trims identifiers and accepts a customer code and duplicates', () => {
    const parsed = ResolveProductsRequestSchema.parse({ customerCode: 5, identifiers: [' 123 ', 'ABC-1', 'ABC-1'] });
    expect(parsed).toEqual({ customerCode: 5, identifiers: ['123', 'ABC-1', 'ABC-1'] });
    expect(ResolveProductsRequestSchema.parse({ identifiers: ['x'] }).customerCode).toBeUndefined();
  });

  it('bounds the batch, the identifier and the customer code', () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => `P${i}`);
    expect(ResolveProductsRequestSchema.safeParse({ identifiers: many(500) }).success).toBe(true);
    expect(ResolveProductsRequestSchema.safeParse({ identifiers: many(501) }).success).toBe(false);
    expect(ResolveProductsRequestSchema.safeParse({ identifiers: [] }).success).toBe(false);
    expect(ResolveProductsRequestSchema.safeParse({}).success).toBe(false);
    expect(ResolveProductsRequestSchema.safeParse({ identifiers: ['a'.repeat(40)] }).success).toBe(true);
    expect(ResolveProductsRequestSchema.safeParse({ identifiers: ['a'.repeat(41)] }).success).toBe(false);
    for (const bad of ['', '   ', 'a\u0000b', 'a\nb', 'a\u007fb', 7]) {
      expect(ResolveProductsRequestSchema.safeParse({ identifiers: [bad] }).success, JSON.stringify(bad)).toBe(false);
    }
    for (const customerCode of [0, -1, 1.5, 2_147_483_648, '5']) {
      expect(ResolveProductsRequestSchema.safeParse({ customerCode, identifiers: ['a'] }).success).toBe(false);
    }
    expect(ResolveProductsRequestSchema.safeParse({ customerCode: 2_147_483_647, identifiers: ['a'] }).success).toBe(true);
  });

  it('rejects unrecognized request keys', () => {
    expect(ResolveProductsRequestSchema.safeParse({ identifiers: ['a'], cost: true }).success).toBe(false);
  });

  it('accepts the three outcomes and enforces their shape', () => {
    const ok = (items: unknown[]) => ResolveProductsResponseSchema.safeParse({ items, priceContext }).success;
    expect(ok([{ identifier: '10', status: 'found', product: listItem }])).toBe(true);
    expect(ok([{ identifier: 'x', status: 'not_found' }])).toBe(true);
    expect(ok([{ identifier: 'R', status: 'ambiguous', candidates: [listItem, listItem] }])).toBe(true);
    // found needs a product; ambiguous needs 2..5 candidates; not_found carries neither.
    expect(ok([{ identifier: '10', status: 'found' }])).toBe(false);
    expect(ok([{ identifier: 'R', status: 'ambiguous', candidates: [listItem] }])).toBe(false);
    expect(ok([{ identifier: 'R', status: 'ambiguous', candidates: Array(6).fill(listItem) }])).toBe(false);
    expect(ok([{ identifier: 'R', status: 'ambiguous', candidates: Array(5).fill(listItem) }])).toBe(true);
    expect(ok([{ identifier: 'x', status: 'not_found', product: listItem }])).toBe(false);
    expect(ok([{ identifier: 'x', status: 'found', product: listItem, candidates: [listItem, listItem] }])).toBe(false);
  });

  it('never lets a cost or margin key through in a response item', () => {
    const parsed = ResolveProductsResponseSchema.parse({
      items: [{ identifier: '10', status: 'found', product: { ...listItem, cost: '1.00', margin: '0.2' } }],
      priceContext,
    });
    expect(JSON.stringify(parsed)).not.toMatch(/cost|margin/i);
  });
});
