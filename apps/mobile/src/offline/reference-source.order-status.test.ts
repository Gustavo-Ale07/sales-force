import type { ApiClient } from "../data/api";
import { createReferenceSource } from "./reference-source";

const ok = { ok: true, status: 200 } as Response;
const unauthorized = { ok: false, status: 401, headers: new Headers() } as Response;

type OrdersQuery = { params: { query: { ids: string; page: number; pageSize: number } } };

const item = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  erpNumber: 900,
  erpStatus: { code: 2, label: "Em análise", invoiceNumber: null, checkedAt: "2026-11-13T11:59:00.000Z" },
  ...over,
});

describe("fetchOrderStatuses (GET /orders?ids=, only what the server returns)", () => {
  it("asks for the ids comma-separated, at the server's page size, and maps the ERP status fields", async () => {
    const asked: OrdersQuery[] = [];
    const api = {
      GET: async (path: string, init: OrdersQuery) => {
        expect(path).toBe("/orders");
        asked.push(init);
        return { data: { items: [item("a"), item("b", { erpNumber: null, erpStatus: null })], page: 1, pageSize: 100, total: 2 }, response: ok };
      },
    } as unknown as ApiClient;
    const result = await createReferenceSource(api).fetchOrderStatuses!(["a", "b"]);
    expect(asked[0]?.params.query).toMatchObject({ ids: "a,b", page: 1, pageSize: 100 });
    expect(result).toEqual([
      { orderId: "a", erpNumber: 900, code: 2, label: "Em análise", invoiceNumber: null, checkedAt: "2026-11-13T11:59:00.000Z" },
      { orderId: "b", erpNumber: null, code: null, label: null, invoiceNumber: null, checkedAt: null },
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
    const result = await createReferenceSource(api, { orderStatusPageSize: 1 }).fetchOrderStatuses!(["o-1", "o-2", "o-3"]);
    expect(pages).toEqual([1, 2, 3]);
    expect(result.map((s) => s.orderId)).toEqual(["o-1", "o-2", "o-3"]);
  });

  it("a failed read is thrown as a transport error, never turned into an empty answer", async () => {
    const api = { GET: async () => ({ error: { code: "unauthenticated" }, response: unauthorized }) } as unknown as ApiClient;
    await expect(createReferenceSource(api).fetchOrderStatuses!(["a"])).rejects.toMatchObject({ kind: "auth" });
  });
});
