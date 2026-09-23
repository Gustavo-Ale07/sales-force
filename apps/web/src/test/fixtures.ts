import type { ApiSchema } from "@salesforce/contracts/client";

/** Synthetic data only (testing rules): no real customers, documents or prices. */

export const account: ApiSchema<"Account"> = {
  id: "0190a000-0000-7000-8000-000000000001",
  email: "ana@example.test",
  displayName: "Ana Souza",
  role: "seller",
  sellerCodes: [7],
};

export function customer(overrides: Partial<ApiSchema<"CustomerListItem">> = {}): ApiSchema<"CustomerListItem"> {
  return {
    code: 1001,
    name: "Comercial Alfa Ltda",
    tradeName: "Alfa Festas",
    document: "11222333000181",
    active: true,
    blocked: false,
    sellerCode: 7,
    sellerName: "Vendedor Sete",
    priceTableCode: 5,
    ...overrides,
  };
}

export function customersPage(items: ApiSchema<"CustomerListItem">[], total = items.length, page = 1, pageSize = 25): ApiSchema<"CustomersResponse"> {
  return { items, page, pageSize, total };
}

export function customerDetail(overrides: Partial<ApiSchema<"CustomerDetail">> = {}): ApiSchema<"CustomerDetail"> {
  return {
    code: 1001,
    name: "Comercial Alfa Ltda",
    tradeName: "Alfa Festas",
    document: "11222333000181",
    active: true,
    blocked: false,
    sellerCode: 7,
    sellerName: "Vendedor Sete",
    priceTableCode: 5,
    priceTableName: "Tabela Varejo",
    resolvedPriceTable: { code: 5, source: "customer" },
    creditLimit: null,
    syncedAt: "2026-09-20T12:00:00.000Z",
    ...overrides,
  };
}

type ListPrice = ApiSchema<"ListPriceContext">;

export const pricedList = (unitPrice: string, tableCode = 5, versionId = 9): ListPrice => ({
  state: "priced",
  unitPrice,
  tableCode,
  versionId,
  noPriceReason: null,
});
export const zeroList = (tableCode = 5, versionId = 9): ListPrice => ({ state: "zero", unitPrice: "0", tableCode, versionId, noPriceReason: null });
export const noPriceList = (reason: ApiSchema<"NoPriceReason"> = "no_price_row"): ListPrice => ({
  state: "none",
  unitPrice: null,
  tableCode: 5,
  versionId: 9,
  noPriceReason: reason,
});

export function product(overrides: Partial<ApiSchema<"ProductListItem">> = {}): ApiSchema<"ProductListItem"> {
  return {
    code: 2001,
    description: "Balão látex 9 pol. vermelho",
    active: true,
    sellable: true,
    unit: "PCT",
    brand: "Marca Beta",
    reference: "BL-09-VM",
    groupCode: 30,
    groupName: "Balões",
    listPrice: pricedList("12.5"),
    ...overrides,
  };
}

export const priceContext: ApiSchema<"PriceContext"> = { customerCode: null, tableCode: 1, tableName: "Referência", source: "catalog_reference" };

export function productsPage(
  items: ApiSchema<"ProductListItem">[],
  context: ApiSchema<"PriceContext"> = priceContext,
  total = items.length,
): ApiSchema<"ProductsResponse"> {
  return { items, page: 1, pageSize: 25, total, priceContext: context };
}

export function productDetail(overrides: Partial<ApiSchema<"ProductDetail">> = {}): ApiSchema<"ProductDetail"> {
  const { listPrice, ...base } = product();
  return { ...base, listPrice, usageCode: null, priceContext, ...overrides };
}

export function orderItem(overrides: Partial<ApiSchema<"OrderItem">> = {}): ApiSchema<"OrderItem"> {
  return {
    lineNo: 1,
    productCode: 2001,
    productDescription: "Balão látex 9 pol. vermelho",
    unit: "PCT",
    quantity: "2",
    unitListPrice: "12.5",
    priceState: "priced",
    priceTableCode: 5,
    priceVersionId: 9,
    estimatedLineTotal: "25",
    ...overrides,
  };
}

export const ORDER_ID = "0190a000-0000-7000-8000-0000000000aa";

export function orderListItem(overrides: Partial<ApiSchema<"OrderListItem">> = {}): ApiSchema<"OrderListItem"> {
  return {
    id: ORDER_ID,
    draftNumber: 12,
    customerCode: 1001,
    customerName: "Comercial Alfa Ltda",
    sellerCode: 7,
    status: "draft",
    estimatedTotal: "25",
    itemCount: 1,
    isPartial: false,
    erpNumber: null,
    version: 1,
    createdAt: "2026-09-20T10:00:00.000Z",
    updatedAt: "2026-09-20T11:00:00.000Z",
    ...overrides,
  };
}

export function orderDetail(overrides: Partial<ApiSchema<"OrderDetail">> = {}): ApiSchema<"OrderDetail"> {
  const items = overrides.items ?? [orderItem()];
  return {
    ...orderListItem(),
    negotiationTypeCode: null,
    notes: null,
    items,
    totals: { estimatedTotal: "25", lineCount: items.length, unpricedLineCount: 0, isPartial: false },
    ...overrides,
  };
}

export function ordersPage(items: ApiSchema<"OrderListItem">[], total = items.length): ApiSchema<"OrdersResponse"> {
  return { items, page: 1, pageSize: 25, total };
}

export const TEMPLATE_ID = "0190a000-0000-7000-8000-0000000000cc";

export function orderTemplate(overrides: Partial<ApiSchema<"OrderTemplate">> = {}): ApiSchema<"OrderTemplate"> {
  return {
    id: TEMPLATE_ID,
    customerCode: 1001,
    name: "Reposição mensal",
    version: 1,
    itemCount: 2,
    createdAt: "2026-09-10T10:00:00.000Z",
    updatedAt: "2026-09-15T11:00:00.000Z",
    ...overrides,
  };
}

export function orderTemplateDetail(overrides: Partial<ApiSchema<"OrderTemplateDetail">> = {}): ApiSchema<"OrderTemplateDetail"> {
  return {
    ...orderTemplate(),
    items: [
      { productCode: 2001, quantity: "5" },
      { productCode: 2003, quantity: "2.5" },
    ],
    ...overrides,
  };
}

export function orderTemplatesPage(items: ApiSchema<"OrderTemplate">[]): ApiSchema<"OrderTemplatesResponse"> {
  return { items };
}

export const integrationFake: ApiSchema<"IntegrationSummary"> = {
  state: "not_configured",
  gatewayMode: "fake",
  lastSuccessAt: null,
  failingEntities: [],
  message: null,
};

export const configuration: ApiSchema<"ConfigurationResponse"> = {
  contentHash: "abc123",
  configuration: {
    schemaVersion: 1,
    source: { kind: "demo", version: "demo-1", syncedAt: "2026-09-20T08:00:00.000Z" },
    general: { enabled: true, enabledCompanyCodes: [1] },
    sales: {
      orderTopCode: null,
      quotationTopCode: null,
      defaultNegotiationTypeCode: 3,
      negotiationTypes: [
        { code: 3, label: "À vista" },
        { code: 4, label: "30 dias" },
      ],
      orderBehavior: { allowDraftWithoutPrice: true },
      confirmationBehavior: "manual",
    },
    customers: {
      portfolioOwnership: { strategy: "customer_seller_field" },
      customerWithoutPriceTable: "no_resolved_table",
      creditFeatures: { showCreditLimit: false },
      accountSellerLinkCount: 0,
    },
    products: { sellableUsageValues: [], showInactive: false, productWithoutPrice: { visible: true, orderable: true } },
    pricing: {
      customerTableStrategy: "customer_table",
      fallbackStrategy: "none",
      fallbackTableCode: null,
      catalogReferenceTableCode: 1,
      missingPrice: "no_price_state",
    },
    financial: { showFinancialArea: false, overdueTitles: false, creditChecks: false },
    features: {},
  },
  syncStates: [
    {
      entity: "customers",
      status: "succeeded",
      lastSuccessAt: "2026-09-20T08:00:00.000Z",
      lastAttemptAt: "2026-09-20T08:00:00.000Z",
      lastFullReconcileAt: null,
      rowCount: 120,
      lastErrorClass: null,
      lastErrorMessage: null,
    },
  ],
  gateway: { mode: "fake" },
  integration: integrationFake,
};

export const ready: ApiSchema<"ReadyResponse"> = {
  status: "ready",
  checks: { database: "ok", migrations: { status: "ok", applied: "0001", expected: "0001" } },
  integration: integrationFake,
};

const metricCount = (value: number) => ({ kind: "count", value }) as const;

/** Mirrors the real group/metric taxonomy in `apps/server/src/dashboard/dashboard.service.ts` (keys, labels, value kinds). */
export function dashboard(overrides: Partial<ApiSchema<"DashboardResponse">> = {}): ApiSchema<"DashboardResponse"> {
  return {
    generatedAt: "2026-09-21T09:00:00.000Z",
    scope: { kind: "sellers", sellerCodes: [7] },
    groups: [
      {
        key: "portfolio",
        label: "Carteira de clientes",
        demo: false,
        metrics: [
          { key: "customers_total", label: "Clientes na carteira", value: metricCount(1250), description: null },
          { key: "customers_active", label: "Clientes ativos e liberados", value: metricCount(1180), description: null },
          { key: "customers_blocked", label: "Clientes bloqueados", value: metricCount(12), description: null },
          { key: "customers_without_price_table", label: "Clientes sem tabela de preço", value: metricCount(34), description: null },
        ],
      },
      {
        key: "catalog",
        label: "Catálogo",
        demo: false,
        metrics: [
          { key: "products_visible", label: "Produtos visíveis", value: metricCount(640), description: null },
          { key: "products_sellable", label: "Produtos vendáveis", value: metricCount(512), description: null },
          {
            key: "products_sellable_without_price",
            label: "Vendáveis sem preço na tabela de referência",
            value: metricCount(8),
            description: null,
          },
        ],
      },
      {
        key: "orders",
        label: "Pedidos",
        demo: false,
        metrics: [
          { key: "drafts", label: "Rascunhos em aberto", value: metricCount(6), description: null },
          {
            key: "drafts_estimated_total",
            label: "Valor estimado dos rascunhos",
            value: { kind: "money", value: "18500.00" },
            description: "Estimativa pelo preço de lista; linhas sem preço não entram na soma.",
          },
          { key: "cancelled", label: "Rascunhos descartados", value: metricCount(3), description: null },
        ],
      },
      {
        key: "credit",
        label: "Crédito",
        demo: false,
        metrics: [
          {
            key: "credit_indicators",
            label: "Indicadores de crédito",
            value: null,
            description: "As regras de crédito ainda não foram definidas.",
          },
        ],
      },
      {
        key: "positivation",
        label: "Positivação",
        demo: false,
        metrics: [
          {
            key: "positivation_rate",
            label: "Positivação da carteira",
            value: null,
            description: "A regra de positivação ainda não foi definida.",
          },
        ],
      },
    ],
    recentOrders: [orderListItem()],
    ...overrides,
  };
}
