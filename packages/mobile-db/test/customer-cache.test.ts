import { beforeEach, describe, expect, it } from "vitest";
import {
  customerLetters,
  customerSellers,
  migrations,
  replaceCustomers,
  runMigrations,
  searchCustomers,
  type CustomerLike,
  type SqlDatabase,
} from "../src/index";
import { openNodeDatabase } from "./node-sqlite-connection";

let db: SqlDatabase;

const portfolio: CustomerLike[] = [
  { code: 1, name: "Açúcar & Cia", active: true, blocked: false, sellerCode: 7, sellerName: "Ana", priceTableCode: 1 },
  { code: 2, name: "Bar do Zé", active: true, blocked: true, sellerCode: 7, sellerName: "Ana", priceTableCode: null },
  { code: 3, name: "Bazar Sul", active: false, blocked: false, sellerCode: 9, sellerName: "Bia", priceTableCode: 2 },
  { code: 4, name: "Cantina Norte", active: true, blocked: false, sellerCode: null, sellerName: null, priceTableCode: null },
  { code: 5, name: "123 Distribuidora" },
];

beforeEach(async () => {
  db = openNodeDatabase();
  await runMigrations(db, migrations);
  await db.transaction((tx) => replaceCustomers(tx, portfolio));
});

const names = async (request: Parameters<typeof searchCustomers>[1]) =>
  (await db.transaction((tx) => searchCustomers<CustomerLike>(tx, request))).items.map((c) => c.name);
const base = { search: "", page: 1, pageSize: 25 };

describe("customer cache filters", () => {
  it("filters by status with the API meaning (active excludes blocked)", async () => {
    expect(await names({ ...base, filters: { status: "active" } })).toEqual(["123 Distribuidora", "Açúcar & Cia", "Cantina Norte"]);
    expect(await names({ ...base, filters: { status: "inactive" } })).toEqual(["Bazar Sul"]);
    expect(await names({ ...base, filters: { status: "blocked" } })).toEqual(["Bar do Zé"]);
  });

  it("filters by seller and by having a price table, and combines with search and status", async () => {
    expect(await names({ ...base, filters: { sellerCode: 7 } })).toEqual(["Açúcar & Cia", "Bar do Zé"]);
    expect(await names({ ...base, filters: { hasPriceTable: true } })).toEqual(["Açúcar & Cia", "Bazar Sul"]);
    expect(await names({ ...base, filters: { hasPriceTable: false } })).toEqual(["123 Distribuidora", "Bar do Zé", "Cantina Norte"]);
    expect(await names({ ...base, search: "ba", filters: { sellerCode: 7, status: "blocked" } })).toEqual(["Bar do Zé"]);
  });

  it("reports the filtered total and starts the window at startAt", async () => {
    const page = await db.transaction((tx) => searchCustomers<CustomerLike>(tx, { ...base, pageSize: 2, startAt: 2 }));
    expect(page.total).toBe(5);
    expect(page.items.map((c) => c.name)).toEqual(["Bar do Zé", "Bazar Sul"]);
  });
});

describe("customer cache alphabetical index", () => {
  it("groups by first letter ignoring accents, with # first and running offsets", async () => {
    expect(await db.transaction((tx) => customerLetters(tx, { search: "" }))).toEqual([
      { letter: "#", count: 1, offset: 0 },
      { letter: "A", count: 1, offset: 1 },
      { letter: "B", count: 2, offset: 2 },
      { letter: "C", count: 1, offset: 4 },
    ]);
  });

  it("follows the active filters and each offset lands on the first customer of the letter", async () => {
    const letters = await db.transaction((tx) => customerLetters(tx, { search: "", filters: { hasPriceTable: false } }));
    expect(letters).toEqual([
      { letter: "#", count: 1, offset: 0 },
      { letter: "B", count: 1, offset: 1 },
      { letter: "C", count: 1, offset: 2 },
    ]);
    const b = letters.find((l) => l.letter === "B")!;
    expect(await names({ ...base, filters: { hasPriceTable: false }, startAt: b.offset, pageSize: 1 })).toEqual(["Bar do Zé"]);
  });
});

describe("customer cache sellers", () => {
  it("lists the sellers present in the cache with their customer counts", async () => {
    expect(await db.transaction((tx) => customerSellers(tx))).toEqual([
      { code: 7, name: "Ana", count: 2 },
      { code: 9, name: "Bia", count: 1 },
    ]);
  });
});
