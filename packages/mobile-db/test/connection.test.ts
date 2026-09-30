import { describe, expect, it } from "vitest";
import { NestedTransactionError } from "../src/connection";
import { openNodeDatabase } from "./node-sqlite-connection";

async function withTable() {
  const db = openNodeDatabase();
  await db.execute("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT NOT NULL)");
  return db;
}

describe("SqlDatabase", () => {
  it("inserts, updates and queries with bound parameters", async () => {
    const db = await withTable();
    const inserted = await db.execute("INSERT INTO t (v) VALUES (?)", ["a"]);
    expect(inserted.changes).toBe(1);
    await db.execute("UPDATE t SET v = ? WHERE id = ?", ["b", inserted.lastInsertRowId]);
    expect(await db.query("SELECT v FROM t")).toEqual([{ v: "b" }]);
  });

  it("commits a transaction", async () => {
    const db = await withTable();
    await db.transaction(async (tx) => {
      await tx.execute("INSERT INTO t (v) VALUES ('x')");
      await tx.execute("INSERT INTO t (v) VALUES ('y')");
    });
    expect(await db.query("SELECT count(*) AS n FROM t")).toEqual([{ n: 2 }]);
  });

  it("rolls back everything when the work throws, and rethrows", async () => {
    const db = await withTable();
    await expect(
      db.transaction(async (tx) => {
        await tx.execute("INSERT INTO t (v) VALUES ('x')");
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await db.query("SELECT count(*) AS n FROM t")).toEqual([{ n: 0 }]);
  });

  it("rolls back on a constraint violation inside the transaction", async () => {
    const db = await withTable();
    await expect(
      db.transaction(async (tx) => {
        await tx.execute("INSERT INTO t (v) VALUES ('ok')");
        await tx.execute("INSERT INTO t (v) VALUES (NULL)");
      }),
    ).rejects.toThrow();
    expect(await db.query("SELECT count(*) AS n FROM t")).toEqual([{ n: 0 }]);
  });

  it("keeps outside statements out of an open transaction", async () => {
    const db = await withTable();
    const slow = db.transaction(async (tx) => {
      await tx.execute("INSERT INTO t (v) VALUES ('inside')");
      await new Promise((resolve) => setTimeout(resolve, 20));
      throw new Error("abort");
    });
    const outside = db.execute("INSERT INTO t (v) VALUES ('outside')");
    await expect(slow).rejects.toThrow("abort");
    await outside;
    // 'outside' ran after the rollback, so it survives; 'inside' does not.
    expect(await db.query("SELECT v FROM t")).toEqual([{ v: "outside" }]);
  });

  it("refuses nested transactions and stays usable", async () => {
    const db = await withTable();
    await expect(
      db.transaction(async () => {
        await db.transaction(async () => undefined);
      }),
    ).rejects.toBeInstanceOf(NestedTransactionError);
    await db.execute("INSERT INTO t (v) VALUES ('after')");
    expect(await db.query("SELECT count(*) AS n FROM t")).toEqual([{ n: 1 }]);
  });
});
