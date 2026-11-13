import type { ApiClient } from "../data/api";
import { createReferenceSource, datasetIdentityOf } from "./reference-source";

const ok = { ok: true, status: 200 } as Response;
const bad = { ok: false, status: 500, headers: new Headers() } as Response;
const priced = (code: number, unitPrice: string, tableCode: number) => ({ code, listPrice: { state: "priced", unitPrice, tableCode, versionId: 1 } });

describe("fetchPriceTables (one representative customer per price table)", () => {
  it("reads the catalog as each table's customer sees it and keeps only prices above zero, keyed by the customer's table", async () => {
    const asked: number[] = [];
    const api = {
      GET: async (_path: string, init: { params: { query: { customerCode: number; page: number } } }) => {
        const { customerCode, page } = init.params.query;
        if (page === 1) asked.push(customerCode);
        if (customerCode === 20) return { error: { code: "x", message: "x" }, response: bad };
        const items = [priced(1, "8.00", 3), { code: 2, listPrice: { state: "zero", unitPrice: "0.00", tableCode: 3, versionId: 1 } }, { code: 3, listPrice: { state: "none" } }];
        return { data: { items, page: 1, pageSize: 100, total: 3 }, response: ok };
      },
    } as unknown as ApiClient;
    const tables = await createReferenceSource(api).fetchPriceTables!([
      { tableCode: 3, customerCode: 10 },
      { tableCode: 9, customerCode: 20 },
    ]);
    expect(asked).toEqual([10, 20]);
    expect(tables).toEqual([{ tableCode: 3, prices: [{ productCode: 1, listPrice: { state: "priced", unitPrice: "8.00", tableCode: 3, versionId: 1 } }] }]);
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
