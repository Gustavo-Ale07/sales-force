import { scriptedFetch, type Responder } from "../test-support";
import { createMobileApiClient } from "./api";
import { createRemoteRepositories } from "./remote-repositories";

const BASE = "http://api.test/api/v1";

const customer = {
  code: 10,
  name: "Padaria Central",
  tradeName: null,
  document: "12.345.678/0001-90",
  active: true,
  blocked: false,
  sellerCode: 7,
  sellerName: "Ana",
  priceTableCode: null,
};

function repositoriesWith(respond: Responder) {
  const scripted = scriptedFetch(respond);
  return {
    repositories: createRemoteRepositories(createMobileApiClient(BASE, { fetch: scripted.fetch })),
    requests: scripted.requests,
  };
}

const firstRequest = { search: "", page: 1, pageSize: 25 };

describe("remote repositories", () => {
  it("reads the scoped customer list with paging, search and sort", async () => {
    const { repositories, requests } = repositoriesWith(() => ({
      status: 200,
      body: { items: [customer], page: 2, pageSize: 25, total: 26 },
    }));
    const page = await repositories.customers.list({ search: "padaria", page: 2, pageSize: 25 });
    expect(page).toEqual({ items: [customer], page: 2, pageSize: 25, total: 26 });
    const url = new URL(requests[0]?.url ?? "");
    expect(url.pathname).toBe("/api/v1/customers");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      search: "padaria",
      page: "2",
      pageSize: "25",
      sort: "name",
    });
  });

  it("omits an empty search", async () => {
    const { repositories, requests } = repositoriesWith(() => ({
      status: 200,
      body: { items: [], page: 1, pageSize: 25, total: 0 },
    }));
    await repositories.customers.list(firstRequest);
    expect(new URL(requests[0]?.url ?? "").searchParams.has("search")).toBe(false);
  });

  it("reads the product catalog without a customer (catalog reference prices)", async () => {
    const product = {
      code: 5,
      description: "Copo 200 ml",
      active: true,
      sellable: true,
      unit: "PCT",
      brand: null,
      reference: null,
      groupCode: null,
      groupName: null,
      listPrice: { state: "none", unitPrice: null, tableCode: null, versionId: null, noPriceReason: "no_resolved_table" },
    };
    const { repositories, requests } = repositoriesWith(() => ({
      status: 200,
      body: {
        items: [product],
        page: 1,
        pageSize: 25,
        total: 1,
        priceContext: { customerCode: null, tableCode: null, tableName: null, source: "none" },
      },
    }));
    const page = await repositories.products.list({ search: "copo", page: 1, pageSize: 25 });
    expect(page.items).toHaveLength(1);
    const url = new URL(requests[0]?.url ?? "");
    expect(url.pathname).toBe("/api/v1/products");
    expect(url.searchParams.has("customerCode")).toBe(false);
    expect(url.searchParams.get("sort")).toBe("description");
  });

  it("surfaces an API failure as ApiRequestError with the status", async () => {
    const { repositories } = repositoriesWith(() => ({
      status: 401,
      body: { code: "unauthenticated", message: "Sessão expirada" },
      headers: { "x-request-id": "req-9" },
    }));
    await expect(repositories.customers.list(firstRequest)).rejects.toMatchObject({
      status: 401,
      code: "unauthenticated",
      correlationId: "req-9",
    });
  });

  it("surfaces a network failure as status 0", async () => {
    const { repositories } = repositoriesWith(() => new Error("offline"));
    await expect(repositories.products.list(firstRequest)).rejects.toMatchObject({ status: 0 });
  });
});
