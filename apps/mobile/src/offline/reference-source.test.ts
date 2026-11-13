import type { ApiClient } from "../data/api";
import { createReferenceSource, datasetIdentityOf } from "./reference-source";

const ok = { ok: true, status: 200 } as Response;
const bad = { ok: false, status: 500, headers: new Headers() } as Response;

const notFound = { ok: false, status: 404, headers: new Headers() } as Response;
const unauthorized = { ok: false, status: 401, headers: new Headers() } as Response;

type PriceQuery = { params: { path: { code: number }; query: { page: number; pageSize: number } } };
const body = (tableCode: number, page: number, pageSize: number, total: number, items: { productCode: number; unitPrice: string }[]) => ({
  tableCode,
  tableName: `T${tableCode}`,
  versionId: tableCode * 10,
  effectiveFrom: "2026-11-01",
  items,
  page,
  pageSize,
  total,
});

describe("fetchPriceTables (bulk endpoint, one request chain per table code)", () => {
  it("reads each table by its code and keys the prices to the table and version the server declares", async () => {
    const asked: string[] = [];
    const api = {
      GET: async (path: string, init: PriceQuery) => {
        asked.push(`${path}:${init.params.path.code}:p${init.params.query.page}:s${init.params.query.pageSize}`);
        return { data: body(init.params.path.code, 1, 1000, 1, [{ productCode: 1, unitPrice: "8.00" }]), response: ok };
      },
    } as unknown as ApiClient;
    const result = await createReferenceSource(api).fetchPriceTables!([3, 9]);
    expect(asked).toEqual(["/price-tables/{code}/prices:3:p1:s1000", "/price-tables/{code}/prices:9:p1:s1000"]);
    expect(result.failed).toEqual([]);
    expect(result.tables[0]).toEqual({ tableCode: 3, prices: [{ productCode: 1, listPrice: { state: "priced", unitPrice: "8.00", tableCode: 3, versionId: 30 } }] });
    expect(result.tables.map((t) => t.tableCode)).toEqual([3, 9]);
  });

  it("pages by page number until page*pageSize >= total: a short middle page does not stop the read", async () => {
    const pages: number[] = [];
    const api = {
      GET: async (_path: string, init: PriceQuery) => {
        const page = init.params.query.page;
        pages.push(page);
        // pageSize 2, total 5: page 2 comes back SHORT (a null-price row dropped after pagination), page 3 has the last one.
        const items = page === 1 ? [{ productCode: 1, unitPrice: "1.00" }, { productCode: 2, unitPrice: "2.00" }] : page === 2 ? [{ productCode: 3, unitPrice: "3.00" }] : [{ productCode: 5, unitPrice: "5.00" }];
        return { data: body(3, page, 2, 5, items), response: ok };
      },
    } as unknown as ApiClient;
    const result = await createReferenceSource(api, { priceTablePageSize: 2 }).fetchPriceTables!([3]);
    expect(pages).toEqual([1, 2, 3]);
    expect(result.tables[0]?.prices.map((p) => p.productCode)).toEqual([1, 2, 3, 5]);
  });

  it("an empty page ends the read", async () => {
    const pages: number[] = [];
    const api = {
      GET: async (_path: string, init: PriceQuery) => {
        pages.push(init.params.query.page);
        return { data: body(3, init.params.query.page, 2, 9, init.params.query.page === 1 ? [{ productCode: 1, unitPrice: "1.00" }] : []), response: ok };
      },
    } as unknown as ApiClient;
    const result = await createReferenceSource(api, { priceTablePageSize: 2 }).fetchPriceTables!([3]);
    expect(pages).toEqual([1, 2]);
    expect(result.tables[0]?.prices).toHaveLength(1);
  });

  it("404 = the server no longer serves the table (left out, not failed); 500 = failed (previous prices may stay); the others are still read", async () => {
    const api = {
      GET: async (_path: string, init: PriceQuery) => {
        const code = init.params.path.code;
        if (code === 9) return { error: { code: "not_found", message: "x" }, response: notFound };
        if (code === 20) return { error: { code: "x", message: "x" }, response: bad };
        return { data: body(code, 1, 1000, 1, [{ productCode: 1, unitPrice: "8.00" }]), response: ok };
      },
    } as unknown as ApiClient;
    const result = await createReferenceSource(api).fetchPriceTables!([3, 9, 20, 4]);
    expect(result.tables.map((t) => t.tableCode)).toEqual([3, 4]);
    expect(result.failed).toEqual([20]);
  });

  it("a table that fails halfway is failed as a whole (no partial table is stored)", async () => {
    const api = {
      GET: async (_path: string, init: PriceQuery) =>
        init.params.query.page === 1 ? { data: body(3, 1, 1, 2, [{ productCode: 1, unitPrice: "1.00" }]), response: ok } : { error: { code: "x", message: "x" }, response: bad },
    } as unknown as ApiClient;
    const result = await createReferenceSource(api, { priceTablePageSize: 1 }).fetchPriceTables!([3]);
    expect(result).toEqual({ tables: [], failed: [3] });
  });

  it("an expired session or a dead network is thrown (never swallowed into 'no tables')", async () => {
    const auth = { GET: async () => ({ error: { code: "unauthorized", message: "x" }, response: unauthorized }) } as unknown as ApiClient;
    await expect(createReferenceSource(auth).fetchPriceTables!([3])).rejects.toMatchObject({ kind: "auth" });
    const down = {
      GET: async () => {
        throw new TypeError("Network request failed");
      },
    } as unknown as ApiClient;
    await expect(createReferenceSource(down).fetchPriceTables!([3])).rejects.toMatchObject({ kind: "network" });
  });
});

describe("datasetIdentityOf (single adapter for the server dataset declaration)", () => {
  it("maps a declared dataset", () => {
    expect(datasetIdentityOf({ dataset: { environment: "production", datasetId: "mirror-real-001" } })).toEqual({
      environment: "production",
      datasetId: "mirror-real-001",
    });
  });

  it("fails closed (null) when the server cannot tell", () => {
    expect(datasetIdentityOf({ dataset: null })).toBeNull();
    expect(datasetIdentityOf(null)).toBeNull();
    expect(datasetIdentityOf(undefined)).toBeNull();
  });

  it("treats a configuration cached before the field existed as unknown", () => {
    expect(datasetIdentityOf(JSON.parse('{"general":{"enabled":true}}') as { dataset: null })).toBeNull();
  });

  it("rejects empty identity parts", () => {
    expect(datasetIdentityOf({ dataset: { environment: "", datasetId: "x" } })).toBeNull();
    expect(datasetIdentityOf({ dataset: { environment: "sandbox", datasetId: "" } })).toBeNull();
  });
});
