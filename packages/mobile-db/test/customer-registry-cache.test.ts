import { beforeEach, describe, expect, it } from "vitest";
import { getCachedCustomer, migrations, replaceCustomers, runMigrations, type CustomerLike, type SqlDatabase } from "../src/index";
import { openNodeDatabase } from "./node-sqlite-connection";

type WithRegistry = CustomerLike & { registry?: { street: string | null; city: string | null } };

let db: SqlDatabase;

beforeEach(async () => {
  db = openNodeDatabase();
  await runMigrations(db, migrations);
  const rows: WithRegistry[] = [
    { code: 1, name: "Com cadastro", registry: { street: "Rua Teste", city: "Cidade" } },
    { code: 2, name: "Sem cadastro" },
  ];
  await db.transaction((tx) => replaceCustomers(tx, rows));
});

describe("getCachedCustomer (registry data read from the local mirror)", () => {
  it("returns the stored JSON, registry included, with no extra column or migration", async () => {
    const hit = await getCachedCustomer<WithRegistry>(db, 1);
    expect(hit?.registry).toEqual({ street: "Rua Teste", city: "Cidade" });
  });

  it("a customer stored without registry (older server) has none; an unknown code is null", async () => {
    expect((await getCachedCustomer<WithRegistry>(db, 2))?.registry).toBeUndefined();
    expect(await getCachedCustomer(db, 99)).toBeNull();
  });
});
