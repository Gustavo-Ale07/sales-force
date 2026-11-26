import { beforeEach, describe, expect, it } from "vitest";
import {
  NO_CITY_TEXT,
  clearReferenceCache,
  createPendingCustomer,
  getCachedPostalCode,
  getPendingCustomer,
  migrations,
  pullReferenceData,
  pushPendingCustomers,
  putCachedPostalCode,
  replaceCities,
  runMigrations,
  searchCities,
  searchNeighborhoods,
  searchStreets,
  wipeLocalDatabase,
  type CustomerRegistrationTransport,
  type DatasetIdentity,
  type OfflineEnv,
  type PendingCustomerRequest,
  type ReferenceSource,
  type SqlDatabase,
} from "../src/index";
import { REAL, SANDBOX, confirm } from "./helpers";
import { openNodeDatabase } from "./node-sqlite-connection";

const A = "acct-A";
let db: SqlDatabase;
let seq = 0;
const env: OfflineEnv = { now: () => new Date("2026-11-26T12:00:00.000Z"), newId: () => `id-${String(++seq).padStart(4, "0")}` };

const sourceOf = (identity: DatasetIdentity, extra: Partial<ReferenceSource> = {}): ReferenceSource => ({
  fetchCustomers: async () => [{ code: 1, name: "Cliente Um" }],
  fetchProducts: async () => [{ code: 10, description: "Produto Dez", groupCode: 2 }],
  fetchEntryConfiguration: async () => ({}),
  fetchDatasetIdentity: async () => identity,
  ...extra,
});

const CITIES = [
  { code: 1, name: "São Paulo", uf: "SP", ibge: "3550308" },
  { code: 2, name: "São Paulo do Potengi", uf: "RN", ibge: null },
  { code: 3, name: "Maringá", uf: "PR", ibge: "4115200" },
];

beforeEach(async () => {
  db = openNodeDatabase();
  await runMigrations(db, migrations);
});

describe("address lists (cities, neighborhoods, streets)", () => {
  it("is stored by the pull and searched without accent or case, with a limit", async () => {
    await pullReferenceData(
      db,
      env,
      sourceOf(REAL, {
        fetchCities: async () => CITIES,
        fetchNeighborhoods: async () => [{ code: 5, name: "Jardim Ação" }],
        fetchStreets: async () => [{ code: 9, name: "Augusta", kind: "RUA" }],
      }),
      A,
    );
    expect((await searchCities(db, "SAO paulo")).map((c) => c.code)).toEqual([1, 2]);
    expect((await searchCities(db, "maringa pr")).map((c) => c.code)).toEqual([3]);
    expect(await searchCities(db, "sao", 1)).toHaveLength(1);
    expect((await searchNeighborhoods(db, "acao")).map((n) => n.code)).toEqual([5]);
    expect((await searchStreets(db, "rua augusta")).map((s) => s.code)).toEqual([9]);
  });

  it("keeps the previous lists when the fetch fails, and drops them when the dataset changed", async () => {
    await pullReferenceData(db, env, sourceOf(REAL, { fetchCities: async () => CITIES }), A);
    await pullReferenceData(db, env, sourceOf(REAL, { fetchCities: async () => { throw new Error("down"); } }), A);
    expect(await searchCities(db, "")).toHaveLength(3);
    await pullReferenceData(db, env, sourceOf(SANDBOX, { fetchCities: async () => { throw new Error("down"); } }), A);
    expect(await searchCities(db, "")).toHaveLength(0);
  });

  it("is cleaned with the reference cache and the wipe", async () => {
    await db.transaction((tx) => replaceCities(tx, CITIES));
    await clearReferenceCache(db);
    expect(await searchCities(db, "")).toHaveLength(0);
    await db.transaction((tx) => replaceCities(tx, CITIES));
    await wipeLocalDatabase(db);
    expect(await searchCities(db, "")).toHaveLength(0);
  });
});

describe("postal code cache", () => {
  const found = { found: true, postalCode: "01001000", street: "Praça da Sé", neighborhood: "Sé", city: "São Paulo", uf: "SP", cityCode: 1, neighborhoodCode: null, streetCode: null, source: "viacep" };

  it("remembers only found postal codes", async () => {
    await putCachedPostalCode(db, "01001000", found, "2026-11-26T12:00:00.000Z");
    await putCachedPostalCode(db, "99999999", { ...found, found: false }, "2026-11-26T12:00:00.000Z");
    expect((await getCachedPostalCode(db, "01001000"))?.street).toBe("Praça da Sé");
    expect(await getCachedPostalCode(db, "99999999")).toBeNull();
  });
});

describe("queued registration without a city (older build)", () => {
  it("ends refused on the device, with a short reason, without calling the server", async () => {
    await confirm(db, REAL);
    const old = {
      document: "12345678909",
      name: "Padaria",
      tradeName: null,
      icmsClassification: "R",
      stateRegistration: null,
      phone: null,
      email: null,
      notes: null,
      addresses: [{ streetCode: 1, neighborhoodCode: 2, number: "10", complement: null, postalCode: "01001000" }],
    } as unknown as PendingCustomerRequest;
    const row = await createPendingCustomer(db, env, { ownerAccountId: A, request: old });
    let calls = 0;
    const transport: CustomerRegistrationTransport = {
      createCustomer: async () => {
        calls += 1;
        throw new Error("must not be called");
      },
      getCustomer: async () => {
        throw new Error("unused");
      },
    };
    const result = await pushPendingCustomers(db, env, transport, A, { currentDataset: REAL, respectBackoff: false });
    expect(calls).toBe(0);
    expect(result.rejected).toBe(1);
    const after = await getPendingCustomer(db, A, row.clientRequestId);
    expect(after?.state).toBe("rejected");
    expect(after?.rejectionReason).toBe(NO_CITY_TEXT);
  });
});
