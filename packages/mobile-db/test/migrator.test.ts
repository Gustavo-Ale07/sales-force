import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { migrations } from "../src/migrations";
import { MigrationError, readSchemaVersion, runMigrations, type Migration } from "../src/migrator";
import { openNodeDatabase } from "./node-sqlite-connection";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "mobile-db-"));
  dirs.push(dir);
  return join(dir, "test.db");
}

const v1: Migration = { version: 1, name: "people", statements: ["CREATE TABLE person (id INTEGER PRIMARY KEY, name TEXT NOT NULL)"] };
const v2: Migration = {
  version: 2,
  name: "people_email",
  statements: ["ALTER TABLE person ADD COLUMN email TEXT", "CREATE INDEX person_email_idx ON person (email)"],
};

describe("runMigrations", () => {
  it("applies the production migrations from an empty database", async () => {
    const db = openNodeDatabase();
    const report = await runMigrations(db, migrations);
    expect(report).toEqual({ from: 0, to: migrations.length, applied: migrations.map((m) => m.version) });
    const tables = await db.query<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name");
    expect(tables.map((t) => t.name)).toEqual(expect.arrayContaining(["outbox", "sync_metadata"]));
  });

  it("is idempotent: a second run applies nothing", async () => {
    const db = openNodeDatabase();
    await runMigrations(db, migrations);
    expect((await runMigrations(db, migrations)).applied).toEqual([]);
  });

  it("v1 -> v2 preserves existing rows and adds the new column (across a reopen)", async () => {
    const path = tempDbPath();
    const first = openNodeDatabase(path);
    await runMigrations(first, [v1]);
    await first.execute("INSERT INTO person (name) VALUES (?)", ["Ana"]);
    await first.close();

    const reopened = openNodeDatabase(path);
    expect(await readSchemaVersion(reopened)).toBe(1);
    const report = await runMigrations(reopened, [v1, v2]);
    expect(report).toEqual({ from: 1, to: 2, applied: [2] });
    expect(await reopened.query("SELECT name, email FROM person")).toEqual([{ name: "Ana", email: null }]);
    await reopened.close();
  });

  it("rolls a failing migration back entirely and keeps the previous version", async () => {
    const db = openNodeDatabase();
    await runMigrations(db, [v1]);
    const broken: Migration = { version: 2, name: "broken", statements: ["ALTER TABLE person ADD COLUMN ok TEXT", "THIS IS NOT SQL"] };
    await expect(runMigrations(db, [v1, broken])).rejects.toThrow();
    expect(await readSchemaVersion(db)).toBe(1);
    const cols = await db.query<{ name: string }>("PRAGMA table_info(person)");
    expect(cols.map((c) => c.name)).not.toContain("ok");
  });

  it("refuses a database newer than the app and leaves it untouched", async () => {
    const db = openNodeDatabase();
    await runMigrations(db, [v1, v2]);
    await db.execute("INSERT INTO person (name) VALUES ('Bia')");
    await expect(runMigrations(db, [v1])).rejects.toBeInstanceOf(MigrationError);
    expect(await readSchemaVersion(db)).toBe(2);
    expect(await db.query("SELECT count(*) AS n FROM person")).toEqual([{ n: 1 }]);
  });

  it("rejects non-consecutive or empty migration lists before touching the database", async () => {
    const db = openNodeDatabase();
    await expect(runMigrations(db, [v1, { ...v2, version: 3 }])).rejects.toBeInstanceOf(MigrationError);
    await expect(runMigrations(db, [{ version: 1, name: "empty", statements: [] }])).rejects.toBeInstanceOf(MigrationError);
    expect(await readSchemaVersion(db)).toBe(0);
  });
});

describe("outbox foundation schema (v1)", () => {
  it("enforces unique idempotency keys, valid states and defaults", async () => {
    const db = openNodeDatabase();
    await runMigrations(db, migrations);
    const insert = (local: string, op: string, key: string, state = "pending") =>
      db.execute(
        `INSERT INTO outbox (local_id, operation_id, idempotency_key, type, payload, state, created_at, updated_at)
         VALUES (?, ?, ?, 'order.create', '{}', ?, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
        [local, op, key, state],
      );
    await insert("l1", "o1", "k1");
    expect(await db.query("SELECT state, attempts, last_error FROM outbox")).toEqual([{ state: "pending", attempts: 0, last_error: null }]);
    await expect(insert("l2", "o2", "k1")).rejects.toThrow();
    await expect(insert("l3", "o3", "k3", "bogus")).rejects.toThrow();
  });
});

describe("production schema v1 → v2 (expand-only)", () => {
  it("keeps existing outbox rows and adds the offline columns", async () => {
    const db = openNodeDatabase();
    await runMigrations(db, migrations.slice(0, 1));
    await db.execute(
      "INSERT INTO outbox (local_id, operation_id, idempotency_key, type, payload, created_at, updated_at) VALUES ('a', 'op-a', 'key-a', 'x', '{}', 't', 't')",
    );
    const report = await runMigrations(db, migrations);
    expect(report).toMatchObject({ from: 1, to: migrations.length });
    const rows = await db.query<{ idempotency_key: string; draft_local_id: string | null; next_attempt_at: string | null }>(
      "SELECT idempotency_key, draft_local_id, next_attempt_at FROM outbox",
    );
    expect(rows).toEqual([{ idempotency_key: "key-a", draft_local_id: null, next_attempt_at: null }]);
  });
});
