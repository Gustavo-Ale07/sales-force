import type { ApiClient } from "../data/api";
import { createReferenceSource } from "./reference-source";

const ok = { ok: true, status: 200 } as Response;
const unauthorized = { ok: false, status: 401, headers: new Headers() } as Response;

type OrdersQuery = { params: { query: { mine?: string; page: number; pageSize: number } } };

const item = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  version: 2,
  status: "draft",
  erpNumber: null,
  erpDelivery: null,
  createdAt: "2026-11-20T10:00:00.000Z",
  updatedAt: "2026-11-21T10:00:00.000Z",
  ...over,
});

describe("fetchServerOrders (GET /orders?mine=true, all pages)", () => {
  it("asks only for the account's own orders and maps status, version, dates and the delivery error text", async () => {
    const asked: OrdersQuery[] = [];
    const api = {
      GET: async (path: string, init: OrdersQuery) => {
        expect(path).toBe("/orders");
        asked.push(init);
        return {
          data: {
            items: [item("a"), item("b", { status: "rejected", erpDelivery: { errorClass: "validation", errorCode: "missing_freight_type" } }), item("c", { status: "sent", erpNumber: 900 })],
            page: 1,
            pageSize: 100,
            total: 3,
          },
          response: ok,
        };
      },
    } as unknown as ApiClient;
    const result = await createReferenceSource(api).fetchServerOrders!();
    expect(asked[0]?.params.query).toMatchObject({ mine: "true", page: 1, pageSize: 100 });
    expect(result).toEqual([
      { id: "a", version: 2, status: "draft", erpNumber: null, deliveryError: null, createdAt: "2026-11-20T10:00:00.000Z", updatedAt: "2026-11-21T10:00:00.000Z" },
      { id: "b", version: 2, status: "rejected", erpNumber: null, deliveryError: "Frete não informado", createdAt: "2026-11-20T10:00:00.000Z", updatedAt: "2026-11-21T10:00:00.000Z" },
      { id: "c", version: 2, status: "sent", erpNumber: 900, deliveryError: null, createdAt: "2026-11-20T10:00:00.000Z", updatedAt: "2026-11-21T10:00:00.000Z" },
    ]);
  });

  it("follows the pages until the total is read", async () => {
    const pages: number[] = [];
    const api = {
      GET: async (_path: string, init: OrdersQuery) => {
        pages.push(init.params.query.page);
        return { data: { items: [item(`o-${init.params.query.page}`)], page: init.params.query.page, pageSize: 1, total: 3 }, response: ok };
      },
    } as unknown as ApiClient;
    const result = await createReferenceSource(api, { orderStatusPageSize: 1 }).fetchServerOrders!();
    expect(pages).toEqual([1, 2, 3]);
    expect(result.map((s) => s.id)).toEqual(["o-1", "o-2", "o-3"]);
  });

  it("a failed read is thrown as a transport error, never turned into an empty list", async () => {
    const api = { GET: async () => ({ error: { code: "unauthenticated" }, response: unauthorized }) } as unknown as ApiClient;
    await expect(createReferenceSource(api).fetchServerOrders!()).rejects.toMatchObject({ kind: "auth" });
  });
});
