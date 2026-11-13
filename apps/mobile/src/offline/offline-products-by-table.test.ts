import { cachedPriceTableCodes, customerPriceTableOf, isCacheReady, searchProducts, type OfflineEnv, type SqlDatabase } from "@salesforce/mobile-db";
import type { ProductRepository, Repositories } from "../data/ports";
import { fakeOrders } from "../test-doubles";
import { createOfflineFirstRepositories } from "./offline-repositories";

jest.mock("@salesforce/mobile-db", () => ({
  ...jest.requireActual("@salesforce/mobile-db"),
  isCacheReady: jest.fn(),
  searchProducts: jest.fn(),
  customerPriceTableOf: jest.fn(),
  cachedPriceTableCodes: jest.fn(),
}));

const ready = isCacheReady as jest.MockedFunction<typeof isCacheReady>;
const search = searchProducts as jest.MockedFunction<typeof searchProducts>;
const tableOf = customerPriceTableOf as jest.MockedFunction<typeof customerPriceTableOf>;
const cachedTables = cachedPriceTableCodes as jest.MockedFunction<typeof cachedPriceTableCodes>;
const env = { now: () => new Date("2026-11-13T12:00:00Z"), newId: () => "x" } as unknown as OfflineEnv;
const page = { items: [], page: 1, pageSize: 20, total: 0 };
const request = { search: "", page: 1, pageSize: 20 };

function products(remoteList = jest.fn(async () => ({ items: [], page: 1, pageSize: 20, total: 0 }))): ProductRepository {
  const remote = { customers: {}, products: { list: remoteList, get: jest.fn() }, orders: fakeOrders() } as unknown as Repositories;
  return createOfflineFirstRepositories({ db: {} as SqlDatabase, env, ownerAccountId: "acct-1", remote }).products;
}

beforeEach(() => {
  ready.mockReset().mockResolvedValue(true);
  search.mockReset().mockResolvedValue(page as never);
  tableOf.mockReset();
  cachedTables.mockReset().mockResolvedValue([3, 9]);
});

describe("offline catalog per order customer's price table (owner 2026-11-13)", () => {
  it("filters the local catalog by the customer's table, fully offline", async () => {
    tableOf.mockResolvedValue(9);
    await products().list({ ...request, customerCode: 42 });
    expect(search).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ priceTableCode: 9 }));
  });

  it("a customer without a table (or without the catalog filter) gets the base catalog (table 5)", async () => {
    tableOf.mockResolvedValue(null);
    await products().list({ ...request, customerCode: 42 });
    await products().list(request);
    for (const call of search.mock.calls) expect(call[1]).not.toHaveProperty("priceTableCode");
  });

  it("a table that was never downloaded falls back to the base catalog (the server revalidates on send)", async () => {
    tableOf.mockResolvedValue(77);
    await products().list({ ...request, customerCode: 42 });
    expect(search.mock.calls[0]?.[1]).not.toHaveProperty("priceTableCode");
  });

  it("the customer code never reaches the SQL request", async () => {
    tableOf.mockResolvedValue(3);
    await products().list({ ...request, customerCode: 42 });
    expect(search.mock.calls[0]?.[1]).not.toHaveProperty("customerCode");
  });

  it("without a ready cache the remote list gets the customer code (prices resolved by the server)", async () => {
    ready.mockResolvedValue(false);
    const remoteList = jest.fn(async () => ({ items: [], page: 1, pageSize: 20, total: 0 }));
    await products(remoteList).list({ ...request, customerCode: 42 });
    expect(remoteList).toHaveBeenCalledWith(expect.objectContaining({ customerCode: 42 }));
  });
});
