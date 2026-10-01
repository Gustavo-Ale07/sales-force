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

  it("reads a single product by code, group included (group-discount lookup for a reopened draft, MOB-4a)", async () => {
    const productDetail = {
      code: 5,
      description: "Copo 200 ml",
      active: true,
      sellable: true,
      unit: "PCT",
      brand: null,
      reference: null,
      groupCode: 30,
      groupName: "Copos",
      listPrice: { state: "none", unitPrice: null, tableCode: null, versionId: null, noPriceReason: "no_resolved_table" },
      usageCode: null,
      priceContext: { customerCode: null, tableCode: null, tableName: null, source: "none" },
    };
    const { repositories, requests } = repositoriesWith(() => ({ status: 200, body: productDetail }));
    const found = await repositories.products.get(5);
    expect(found).toMatchObject({ code: 5, groupCode: 30, groupName: "Copos" });
    expect(new URL(requests[0]?.url ?? "").pathname).toBe("/api/v1/products/5");
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

  it("reads the order-entry configuration", async () => {
    const configuration = {
      general: { enabled: true },
      sales: { defaultNegotiationTypeCode: null, negotiationTypes: [], orderBehavior: { allowDraftWithoutPrice: false } },
      products: { productWithoutPrice: { orderable: false } },
    };
    const { repositories, requests } = repositoriesWith(() => ({ status: 200, body: configuration }));
    await expect(repositories.orders.getEntryConfiguration()).resolves.toEqual(configuration);
    expect(new URL(requests[0]?.url ?? "").pathname).toBe("/api/v1/order-entry/configuration");
  });

  it("creates a draft order sending only product, quantity and discount, never a price", async () => {
    const request = {
      clientRequestId: "0190a0c0-0000-7000-8000-000000000099",
      expectedDataset: { environment: "production", datasetId: "mirror-real-001" },
      customerCode: 10,
      negotiationTypeCode: null,
      notes: null,
      items: [{ productCode: 2001, quantity: "1", discountPercent: "10" }],
    };
    const { repositories, requests } = repositoriesWith(() => ({
      status: 201,
      body: { id: "order-1", version: 1 },
    }));
    const created = await repositories.orders.create(request);
    expect(created).toEqual({ id: "order-1", version: 1 });
    expect(requests[0]?.method).toBe("POST");
    expect(new URL(requests[0]?.url ?? "").pathname).toBe("/api/v1/orders");
    expect(requests[0]?.body).toEqual(request);
  });

  it("surfaces per-item draft issues from a rejected save", async () => {
    const { repositories } = repositoriesWith(() => ({
      status: 400,
      body: {
        code: "validation_failed",
        message: "Dados inválidos",
        details: { issues: [{ path: "items[0].discountPercent", code: "invalid_discount" }] },
      },
    }));
    await expect(
      repositories.orders.create({
        clientRequestId: "0190a0c0-0000-7000-8000-000000000099",
        expectedDataset: { environment: "production", datasetId: "mirror-real-001" },
        customerCode: 10,
        negotiationTypeCode: null,
        notes: null,
        items: [],
      }),
    ).rejects.toMatchObject({
      status: 400,
      issues: [{ path: "items[0].discountPercent", code: "invalid_discount" }],
    });
  });

  it("reopens a saved draft by id (GET /orders/{id})", async () => {
    const { repositories, requests } = repositoriesWith(() => ({
      status: 200,
      body: { id: "order-1", version: 2 },
    }));
    const found = await repositories.orders.get("order-1");
    expect(found).toEqual({ id: "order-1", version: 2 });
    expect(requests[0]?.method).toBe("GET");
    expect(new URL(requests[0]?.url ?? "").pathname).toBe("/api/v1/orders/order-1");
  });

  it("replaces a draft with optimistic concurrency, never an idempotency key (PUT /orders/{id})", async () => {
    const request = {
      expectedVersion: 1,
      expectedDataset: { environment: "production", datasetId: "mirror-real-001" },
      customerCode: 10,
      negotiationTypeCode: null,
      notes: null,
      items: [{ productCode: 2001, quantity: "2", discountPercent: "10" }],
    };
    const { repositories, requests } = repositoriesWith(() => ({
      status: 200,
      body: { id: "order-1", version: 2 },
    }));
    const updated = await repositories.orders.replace("order-1", request);
    expect(updated).toEqual({ id: "order-1", version: 2 });
    expect(requests[0]?.method).toBe("PUT");
    expect(new URL(requests[0]?.url ?? "").pathname).toBe("/api/v1/orders/order-1");
    expect(requests[0]?.body).toEqual(request);
  });

  it("surfaces a version conflict from a stale edit as ApiRequestError with the code", async () => {
    const { repositories } = repositoriesWith(() => ({
      status: 409,
      body: { code: "version_conflict", message: "Conflito de versão" },
    }));
    await expect(
      repositories.orders.replace("order-1", {
        expectedVersion: 1,
        expectedDataset: { environment: "production", datasetId: "mirror-real-001" },
        customerCode: 10,
        negotiationTypeCode: null,
        notes: null,
        items: [],
      }),
    ).rejects.toMatchObject({ status: 409, code: "version_conflict" });
  });
});
