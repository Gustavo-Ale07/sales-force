import type { DraftRecord } from "@salesforce/mobile-db";
import type { Account, AuthPort } from "./auth/auth-port";
import type { ConnectivityPort, ConnectivityState } from "./connectivity/connectivity";
import type { AppDependencies } from "./dependencies";
import type { LocalOrdersPort } from "./offline/local-orders";
import type { SalesFilters } from "./offline/sales";
import { ApiRequestError } from "./data/api";
import type {
  CreateOrderRequest,
  CustomerListItem,
  OrderDetail,
  OrderEntryConfiguration,
  OrderItem,
  OrderRepository,
  Page,
  ProductListItem,
  ProductRepository,
  Repositories,
} from "./data/ports";

/** In-memory ports for component tests: no network, no native modules. */
export const account: Account = {
  id: "0190a0c0-0000-7000-8000-000000000001",
  email: "ana@plac.com.br",
  displayName: "Ana Vendedora",
  role: "seller",
  sellerCodes: [7],
};

export function customer(code: number, overrides: Partial<CustomerListItem> = {}): CustomerListItem {
  return {
    code,
    name: `Cliente ${code}`,
    tradeName: null,
    document: null,
    active: true,
    blocked: false,
    sellerCode: 7,
    sellerName: null,
    priceTableCode: null,
    ...overrides,
  };
}

export function product(code: number, overrides: Partial<ProductListItem> = {}): ProductListItem {
  return {
    code,
    description: `Produto ${code}`,
    active: true,
    sellable: true,
    unit: "UN",
    brand: null,
    reference: null,
    groupCode: null,
    groupName: null,
    listPrice: { state: "none", unitPrice: null, tableCode: null, versionId: null, noPriceReason: "no_resolved_table" },
    ...overrides,
  } as ProductListItem;
}

export function pageOf<T>(items: readonly T[], total = items.length, page = 1): Page<T> {
  return { items, page, pageSize: 25, total };
}

/** Default product repository fake: an empty catalog, and `get` resolving to a bare product by code (its group
 * defaults to none — override per test when a group lookup is exercised, e.g. the group-discount sheet). */
export function fakeProducts(overrides: Partial<ProductRepository> = {}): ProductRepository {
  return {
    list: async () => pageOf([]),
    get: async (code) => product(code),
    ...overrides,
  };
}

export function orderEntryConfiguration(overrides: Partial<OrderEntryConfiguration> = {}): OrderEntryConfiguration {
  return {
    dataset: { environment: "production", datasetId: "mirror-real-001" },
    general: { enabled: true },
    sales: { defaultNegotiationTypeCode: null, negotiationTypes: [], orderBehavior: { allowDraftWithoutPrice: false } },
    products: { productWithoutPrice: { orderable: false } },
    ...overrides,
  };
}

export function orderItem(overrides: Partial<OrderItem> = {}): OrderItem {
  return {
    lineNo: 1,
    productCode: 5,
    productDescription: "Produto 5",
    unit: "UN",
    quantity: "1",
    unitListPrice: "10",
    discountPercent: "0",
    priceState: "priced",
    priceTableCode: 1,
    priceVersionId: 1,
    estimatedLineTotal: "10",
    ...overrides,
  };
}

export function orderDetail(overrides: Partial<OrderDetail> = {}): OrderDetail {
  return {
    id: "0190a0c0-0000-7000-8000-000000000050",
    draftNumber: 1,
    customerCode: 10,
    customerName: "Cliente 10",
    sellerCode: 7,
    status: "draft",
    estimatedTotal: "0.00",
    itemCount: 0,
    isPartial: false,
    erpNumber: null,
    version: 1,
    createdAt: "2026-09-29T12:00:00.000Z",
    updatedAt: "2026-09-29T12:00:00.000Z",
    negotiationTypeCode: null,
    notes: null,
    items: [],
    totals: { estimatedTotal: "0.00", lineCount: 0, unpricedLineCount: 0, isPartial: false },
    ...overrides,
  };
}

export function fakeOrders(overrides: Partial<OrderRepository> = {}): OrderRepository {
  return {
    getEntryConfiguration: async () => orderEntryConfiguration(),
    create: async (request: CreateOrderRequest) => orderDetail({ customerCode: request.customerCode, items: [] }),
    get: async (id: string) => orderDetail({ id }),
    replace: async (id: string, request) =>
      orderDetail({ id, customerCode: request.customerCode, negotiationTypeCode: request.negotiationTypeCode, notes: request.notes, version: request.expectedVersion + 1 }),
    ...overrides,
  };
}

export function unauthenticatedError(): ApiRequestError {
  return new ApiRequestError({ status: 401, code: "unauthenticated", message: "Sessão expirada" });
}

export function networkError(): ApiRequestError {
  return new ApiRequestError({ status: 0, message: "Sem conexão com o servidor." });
}

export function fakeAuth(overrides: Partial<AuthPort> = {}): AuthPort {
  return {
    getSession: async () => null,
    login: async () => ({ ok: true, account }),
    logout: async () => undefined,
    ...overrides,
  };
}

export function fakeConnectivity(initial: ConnectivityState = "online") {
  let listener: ((state: ConnectivityState) => void) | undefined;
  const port: ConnectivityPort = {
    getState: async () => initial,
    subscribe(next) {
      listener = next;
      return () => {
        listener = undefined;
      };
    },
  };
  return { port, emit: (state: ConnectivityState) => listener?.(state) };
}

export function fakeDependencies(overrides: Partial<AppDependencies> = {}): AppDependencies {
  const repositories: Repositories = {
    customers: { list: async () => pageOf([]) },
    products: fakeProducts(),
    orders: fakeOrders(),
  };
  return {
    auth: fakeAuth(),
    repositories,
    connectivity: fakeConnectivity().port,
    ...overrides,
  };
}

/** A saved order as the local store returns it; every field overridable. */
export function draftRecord(overrides: Partial<DraftRecord> = {}): DraftRecord {
  return {
    localId: "local-1",
    ownerAccountId: "acct-1",
    clientRequestId: "req-1",
    customerCode: 10,
    customerName: "Padaria Central",
    negotiationTypeCode: null,
    notes: null,
    status: "pending_sync",
    remoteId: null,
    remoteVersion: null,
    remoteDraftNumber: null,
    estimatedTotal: null,
    lastError: null,
    priceReview: null,
    serverSnapshot: null,
    createdAt: "2026-09-30T12:00:00.000Z",
    updatedAt: "2026-09-30T12:00:00.000Z",
    itemCount: 2,
    dataset: { environment: "production", datasetId: "mirror-real-001" },
    eligibility: "eligible",
    ...overrides,
  };
}

const UNSENT: readonly DraftRecord["status"][] = ["local_only", "pending_sync", "syncing", "sync_error", "conflict", "needs_review"];

/**
 * In-memory stand-in for the local orders port. Filtering mirrors the SQL (group, status, customer, text), so UI tests
 * exercise the same contract; the SQL itself is tested in `packages/mobile-db`.
 */
export function fakeLocalOrders(drafts: DraftRecord[] = [], overrides: Partial<LocalOrdersPort> = {}): LocalOrdersPort & { drafts: DraftRecord[] } {
  const state = { drafts: [...drafts] };
  const matching = (filters: SalesFilters, search: string) => {
    const text = search.trim().toLowerCase();
    return state.drafts.filter((d) => {
      const unsent = UNSENT.includes(d.status);
      if ((filters.group === "unsent") !== unsent) return false;
      if (filters.statuses.length > 0 && !filters.statuses.includes(d.status)) return false;
      if (filters.customer !== null && d.customerCode !== filters.customer.code) return false;
      if (text === "") return true;
      return d.customerName.toLowerCase().includes(text) || String(d.customerCode) === text || String(d.remoteDraftNumber) === text;
    });
  };
  const valueOf = (d: DraftRecord) => ({ amount: d.estimatedTotal, partial: d.estimatedTotal === null });
  const port: LocalOrdersPort = {
    save: async () => {
      throw new Error("unused");
    },
    list: async () => state.drafts,
    listSales: async (filters, request) => {
      const all = matching(filters, request.search);
      const start = (request.page - 1) * request.pageSize;
      return { items: all.slice(start, start + request.pageSize).map((draft) => ({ draft, value: valueOf(draft) })), page: request.page, pageSize: request.pageSize, total: all.length };
    },
    summarizeSales: async (filters, search) => {
      const all = matching(filters, search);
      const other = (group: SalesFilters["group"]) => matching({ ...filters, group }, search).length;
      const amounts = all.flatMap((d) => (d.estimatedTotal === null ? [] : [d.estimatedTotal]));
      return {
        count: all.length,
        amount: amounts.length === 0 ? null : amounts.reduce((sum, v) => (Number(sum) + Number(v)).toFixed(2)),
        partial: all.some((d) => d.estimatedTotal === null),
        lastUpdatedAt: all.map((d) => d.updatedAt).sort().at(-1) ?? null,
        counts: { unsent: other("unsent"), sent: other("sent") },
      };
    },
    get: async (localId) => state.drafts.find((d) => d.localId === localId) ?? null,
    open: async () => null,
    discard: async (localId) => {
      state.drafts = state.drafts.filter((d) => d.localId !== localId);
    },
    listQuarantined: async () => [],
    countQuarantined: async () => 0,
    openQuarantined: async () => null,
    discardQuarantined: async () => undefined,
    acknowledgePriceReview: async () => undefined,
    resolveConflict: async () => undefined,
    ...overrides,
  };
  return Object.defineProperty(port, "drafts", { get: () => state.drafts }) as LocalOrdersPort & { drafts: DraftRecord[] };
}
