import type { Account, AuthPort } from "./auth/auth-port";
import type { ConnectivityPort, ConnectivityState } from "./connectivity/connectivity";
import type { AppDependencies } from "./dependencies";
import { ApiRequestError } from "./data/api";
import type { CustomerListItem, Page, ProductListItem, Repositories } from "./data/ports";

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
    products: { list: async () => pageOf([]) },
  };
  return {
    auth: fakeAuth(),
    repositories,
    connectivity: fakeConnectivity().port,
    ...overrides,
  };
}
