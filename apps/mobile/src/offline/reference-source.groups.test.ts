import type { ApiClient } from "../data/api";
import { createReferenceSource } from "./reference-source";

const ok = { ok: true, status: 200 } as Response;

describe("fetchPricesOrigin and the table name (origin of the prices in the catalog list)", () => {
  it("reads the price context the server resolved the catalog against, one tiny page", async () => {
    const asked: unknown[] = [];
    const api = {
      GET: async (path: string, init: unknown) => {
        asked.push([path, init]);
        return { data: { items: [], page: 1, pageSize: 1, total: 0, priceContext: { customerCode: null, tableCode: 5, tableName: "Tabela Base", source: "catalog_reference" } }, response: ok };
      },
    } as unknown as ApiClient;
    expect(await createReferenceSource(api).fetchPricesOrigin!()).toEqual({ source: "catalog_reference", tableCode: 5, tableName: "Tabela Base" });
    expect(asked).toEqual([["/products", { params: { query: { page: 1, pageSize: 1 } } }]]);
  });

  it("keeps the name the server gives each price table", async () => {
    const api = {
      GET: async () => ({ data: { tableCode: 7, tableName: "Atacado", versionId: 70, effectiveFrom: "2026-11-01", items: [{ productCode: 1, unitPrice: "8.00" }], page: 1, pageSize: 1000, total: 1 }, response: ok }),
    } as unknown as ApiClient;
    const result = await createReferenceSource(api).fetchPriceTables!([7]);
    expect(result.tables[0]).toMatchObject({ tableCode: 7, tableName: "Atacado" });
  });
});

describe("fetchProductGroups (hierarchy for the offline Grupo > Subgrupo > Linha filter)", () => {
  it("reads GET /product-groups and returns the answer as the server delivers it, subtreeCodes included", async () => {
    const answer = {
      hierarchical: true,
      hasUngrouped: true,
      items: [{ code: 10, name: "Tintas", parentCode: null, degree: 1, hasChildren: false, subtreeCodes: [10, 11] }],
    };
    const asked: string[] = [];
    const api = {
      GET: async (path: string) => {
        asked.push(path);
        return { data: answer, response: ok };
      },
    } as unknown as ApiClient;
    expect(await createReferenceSource(api).fetchProductGroups!()).toEqual(answer);
    expect(asked).toEqual(["/product-groups"]);
  });

  it("surfaces a failure as a transport error (the pull treats it as non-fatal and keeps the previous tree)", async () => {
    const api = { GET: async () => ({ error: {}, response: { ok: false, status: 500, headers: new Headers() } as Response }) } as unknown as ApiClient;
    await expect(createReferenceSource(api).fetchProductGroups!()).rejects.toBeDefined();
  });
});
