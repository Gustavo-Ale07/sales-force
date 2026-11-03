import { describe, expect, it } from "vitest";
import { migrations, runMigrations } from "../src";
import { openNodeDatabase } from "./node-sqlite-connection";

describe("migration v5 (order item IPI reference)", () => {
  it("adds a nullable ipi_json column and keeps existing rows readable", async () => {
    const db = openNodeDatabase();
    await runMigrations(db, migrations);
    const columns = await db.query<{ name: string; notnull: number }>("PRAGMA table_info(local_order_item)");
    const column = columns.find((c) => c.name === "ipi_json");
    expect(column).toBeDefined();
    expect(column?.notnull).toBe(0);
  });
});
