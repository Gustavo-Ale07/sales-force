import { count } from "drizzle-orm";
import { drizzle } from "drizzle-orm/expo-sqlite";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { File } from "expo-file-system";
import * as SQLite from "expo-sqlite";
import { Platform } from "react-native";
import { inspectLocalState, type LocalStateReport, type Migration } from "@salesforce/mobile-db";
import { databaseFileUri, deleteDatabaseFile, openEncryptedDatabase } from "@salesforce/mobile-db/expo";
import { openAppDatabase } from "../db/app-database";
import { createSecureStoreKeyStore, secureRandomBytes } from "../db/secure-key-store";

/**
 * Spike S7 / V-09 on-device diagnostics. DEV-ONLY: rendered instead of the app when EXPO_PUBLIC_S7_DIAGNOSTICS=1.
 * Uses scratch databases (`s7-*.db`) with synthetic data only; the only thing it touches in the real app database
 * is one `sync_metadata` heartbeat row. Each launch appends to the persistent spike database, so a second launch
 * after a full process kill proves persistence.
 */
export interface StepResult {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
  readonly ms: number;
}

const launches = sqliteTable("launch", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  startedAt: text("started_at").notNull(),
  note: text("note"),
});

const SPIKE_V1: Migration = {
  version: 1,
  name: "launch",
  statements: ["CREATE TABLE launch (id INTEGER PRIMARY KEY AUTOINCREMENT, started_at TEXT NOT NULL, note TEXT)"],
};
const PERSON_V1: Migration = {
  version: 1,
  name: "person",
  statements: ["CREATE TABLE person (id INTEGER PRIMARY KEY, name TEXT NOT NULL)"],
};
const PERSON_V2: Migration = {
  version: 2,
  name: "person_email",
  statements: ["ALTER TABLE person ADD COLUMN email TEXT", "CREATE INDEX person_email_idx ON person (email)"],
};

const SPIKE_DB = "s7-spike.db";
const MIGRATION_DB = "s7-migration.db";
const SQLITE_MAGIC = "SQLite format 3";

function spikeKeyStore(name: string) {
  return createSecureStoreKeyStore(`${name}.key`);
}
function openSpike(name: string, migrations: readonly Migration[]) {
  return openEncryptedDatabase({ name, keyStore: spikeKeyStore(name), randomBytes: secureRandomBytes, migrations });
}

function looksPlaintext(bytes: Uint8Array): boolean {
  return String.fromCharCode(...bytes.slice(0, SQLITE_MAGIC.length)) === SQLITE_MAGIC;
}

async function step(name: string, body: () => Promise<string>, sink: (result: StepResult) => void): Promise<boolean> {
  const started = Date.now();
  try {
    const detail = await body();
    sink({ name, ok: true, detail, ms: Date.now() - started });
    return true;
  } catch (error) {
    sink({ name, ok: false, detail: error instanceof Error ? `${error.name}: ${error.message}` : String(error), ms: Date.now() - started });
    return false;
  }
}

/**
 * Read-only report of the REAL app database for dataset isolation (counts, cache/draft/outbox identity and
 * classification; never names, notes, tokens or the key). Opening the database applies pending migrations like any
 * app start; the report itself only runs SELECT statements. Same dev gate as the rest of this file.
 */
export async function inspectAppDatabase(): Promise<LocalStateReport> {
  const opened = await openAppDatabase();
  try {
    return await inspectLocalState(opened.database);
  } finally {
    await opened.database.close();
  }
}

export async function runS7Diagnostics(sink: (result: StepResult) => void): Promise<boolean> {
  const results: boolean[] = [];
  const run = async (name: string, body: () => Promise<string>) => {
    results.push(await step(name, body, sink));
  };

  await run("environment", async () => `platform=${Platform.OS} api=${String(Platform.Version)} dbdir=${SQLite.defaultDatabaseDirectory} uri=${databaseFileUri(SPIKE_DB)} hermes=${String(typeof (globalThis as { HermesInternal?: unknown }).HermesInternal !== "undefined")}`);

  await run("sqlcipher-present-and-app-schema", async () => {
    const opened = await openAppDatabase();
    const { database, cipherVersion, migration } = opened;
    const tables = await database.query<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
    const sqliteVersion = await database.query<{ v: string }>("SELECT sqlite_version() AS v");
    await database.execute("INSERT INTO sync_metadata (key, value, updated_at) VALUES ('s7_heartbeat', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at", [
      String(Date.now()),
      new Date().toISOString(),
    ]);
    await database.close();
    return `cipher=${cipherVersion} sqlite=${sqliteVersion[0]?.v} migration=${JSON.stringify(migration)} tables=${tables.map((t) => t.name).join(",")}`;
  });

  await run("persistence-across-launches", async () => {
    const { database } = await openSpike(SPIKE_DB, [SPIKE_V1]);
    const before = (await database.query<{ n: number }>("SELECT count(*) AS n FROM launch"))[0]?.n ?? 0;
    await database.execute("INSERT INTO launch (started_at, note) VALUES (?, ?)", [new Date().toISOString(), "s7"]);
    const after = (await database.query<{ n: number }>("SELECT count(*) AS n FROM launch"))[0]?.n ?? 0;
    await database.close();
    return `rows_before_this_launch=${before} rows_after=${after} (before>0 means data survived a full app restart)`;
  });

  await run("transactions", async () => {
    const { database } = await openSpike(SPIKE_DB, [SPIKE_V1]);
    const start = (await database.query<{ n: number }>("SELECT count(*) AS n FROM launch"))[0]?.n ?? 0;
    await database.transaction(async (tx) => {
      await tx.execute("INSERT INTO launch (started_at, note) VALUES (?, 'tx-commit-1')", [new Date().toISOString()]);
      await tx.execute("INSERT INTO launch (started_at, note) VALUES (?, 'tx-commit-2')", [new Date().toISOString()]);
    });
    const committed = (await database.query<{ n: number }>("SELECT count(*) AS n FROM launch"))[0]?.n ?? 0;
    let rolledBack = false;
    try {
      await database.transaction(async (tx) => {
        await tx.execute("INSERT INTO launch (started_at, note) VALUES (?, 'tx-rollback')", [new Date().toISOString()]);
        throw new Error("intentional");
      });
    } catch (error) {
      rolledBack = error instanceof Error && error.message === "intentional";
    }
    const end = (await database.query<{ n: number }>("SELECT count(*) AS n FROM launch"))[0]?.n ?? 0;
    await database.close();
    if (committed !== start + 2) throw new Error(`commit expected +2, got ${committed - start}`);
    if (!rolledBack || end !== committed) throw new Error(`rollback failed (rolledBack=${rolledBack}, ${committed} -> ${end})`);
    return `commit +2 ok, rollback restored ${committed} rows`;
  });

  await run("drizzle-over-sqlcipher-connection", async () => {
    const opened = await openSpike(SPIKE_DB, [SPIKE_V1]);
    const orm = drizzle(opened.unsafeNativeHandle as unknown as SQLite.SQLiteDatabase);
    await orm.insert(launches).values({ startedAt: new Date().toISOString(), note: "drizzle" });
    const total = await orm.select({ n: count() }).from(launches);
    const last = await orm.select().from(launches).orderBy(launches.id).limit(1);
    await opened.database.close();
    return `drizzle insert+select ok, launch rows=${total[0]?.n}, first id=${last[0]?.id}`;
  });

  await run("migration-v1-to-v2-preserves-data", async () => {
    await deleteDatabaseFile(MIGRATION_DB).catch(() => undefined);
    const first = await openSpike(MIGRATION_DB, [PERSON_V1]);
    await first.database.execute("INSERT INTO person (name) VALUES ('Ana'), ('Bia')");
    await first.database.close();
    const second = await openSpike(MIGRATION_DB, [PERSON_V1, PERSON_V2]);
    const rows = await second.database.query<{ name: string; email: string | null }>("SELECT name, email FROM person ORDER BY id");
    await second.database.close();
    if (second.migration.from !== 1 || second.migration.to !== 2) throw new Error(`unexpected report ${JSON.stringify(second.migration)}`);
    if (rows.length !== 2 || rows[0]?.name !== "Ana" || rows[0]?.email !== null) throw new Error(`data not preserved: ${JSON.stringify(rows)}`);
    return `v1->v2 ok, rows preserved=${rows.length}, new column default=null`;
  });

  await run("encryption-is-real-on-disk", async () => {
    const dbFile = new File(databaseFileUri(MIGRATION_DB));
    const header = (await dbFile.bytes()).slice(0, 64);
    if (looksPlaintext(header)) throw new Error("file starts with the plaintext SQLite header: NOT encrypted");
    // A wrong key and a missing key must both be unable to read.
    const attempts: string[] = [];
    for (const label of ["no-key", "wrong-key"]) {
      const raw = await SQLite.openDatabaseAsync(MIGRATION_DB);
      try {
        if (label === "wrong-key") await raw.execAsync(`PRAGMA key = "x'${"ab".repeat(32)}'"`);
        await raw.getFirstAsync("SELECT count(*) FROM sqlite_master");
        throw new Error(`${label}: query SUCCEEDED on an encrypted database`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("SUCCEEDED")) throw error;
        attempts.push(`${label}: rejected (${message.slice(0, 60)})`);
      } finally {
        await raw.closeAsync().catch(() => undefined);
      }
    }
    return `header_not_plaintext=true; ${attempts.join("; ")}`;
  });

  await run("performance-indicative", async () => {
    const perfMigration: Migration = {
      version: 1,
      name: "perf",
      statements: ["CREATE TABLE item (id INTEGER PRIMARY KEY, code TEXT NOT NULL, description TEXT NOT NULL, price TEXT NOT NULL)", "CREATE INDEX item_code_idx ON item (code)"],
    };
    await deleteDatabaseFile("s7-perf.db").catch(() => undefined);
    const { database } = await openSpike("s7-perf.db", [perfMigration]);
    const rows = 20000;
    const batch = 500;
    const t0 = Date.now();
    await database.transaction(async (tx) => {
      for (let i = 0; i < rows; i += batch) {
        const values: string[] = [];
        const params: string[] = [];
        for (let j = i; j < Math.min(i + batch, rows); j++) {
          values.push("(?, ?, ?)");
          params.push(`P${j}`, `Produto de teste numero ${j}`, "10.500000");
        }
        await tx.execute(`INSERT INTO item (code, description, price) VALUES ${values.join(", ")}`, params);
      }
    });
    const insertMs = Date.now() - t0;
    const t1 = Date.now();
    const found = await database.query("SELECT * FROM item WHERE code = ?", ["P12345"]);
    const pointMs = Date.now() - t1;
    const t2 = Date.now();
    const like = await database.query("SELECT id FROM item WHERE description LIKE ? LIMIT 50", ["%numero 19999%"]);
    const likeMs = Date.now() - t2;
    await database.close();
    await deleteDatabaseFile("s7-perf.db").catch(() => undefined);
    return `insert ${rows} rows in one tx (${batch} rows/statement): ${insertMs} ms; indexed point query: ${pointMs} ms (${found.length} row); LIKE scan: ${likeMs} ms (${like.length} rows). Indicative only, NOT V-14 volume.`;
  });

  await run("fts5-crash-isolation", async () => {
    // FTS5 aborts the process natively on this expo-sqlite build (see docs/mobile-spike.md); only probe when asked.
    if (process.env.EXPO_PUBLIC_S7_FTS_PROBE !== "1") return "skipped: known native SIGABRT on FTS5 (4 variants, incl. unkeyed DB) - EXPO_PUBLIC_S7_FTS_PROBE=1 to re-probe";
    // A native abort kills the process, so each launch runs the NEXT variant (counter committed before it runs).
    const { database } = await openSpike(SPIKE_DB, [SPIKE_V1]);
    await database.execute("CREATE TABLE IF NOT EXISTS fts_probe (id INTEGER PRIMARY KEY AUTOINCREMENT)");
    const n = (await database.query<{ n: number }>("SELECT count(*) AS n FROM fts_probe"))[0]?.n ?? 0;
    await database.execute("INSERT INTO fts_probe DEFAULT VALUES");
    const variants = ["A create+insert+select-without-MATCH", "B MATCH literal (no bound parameter)", "C MATCH bound parameter", "D plain (unkeyed) database, MATCH literal"];
    const label = variants[n];
    if (label === undefined) {
      await database.close();
      return `all ${variants.length} variants already exercised in earlier launches`;
    }
    console.log(`S7STEP fts5-variant ${label}`);
    await database.execute("DROP TABLE IF EXISTS product_fts");
    await database.execute("CREATE VIRTUAL TABLE product_fts USING fts5(description)");
    await database.execute("INSERT INTO product_fts (description) VALUES ('Copo descartavel 200 ml'), ('Prato fundo 20 cm')");
    let out: string;
    if (n === 0) out = `rows=${(await database.query("SELECT description FROM product_fts")).length}`;
    else if (n === 1) out = `hits=${(await database.query("SELECT description FROM product_fts WHERE product_fts MATCH 'copo'")).length}`;
    else if (n === 2) out = `hits=${(await database.query("SELECT description FROM product_fts WHERE product_fts MATCH ?", ["copo"])).length}`;
    else {
      const raw = await SQLite.openDatabaseAsync("s7-plain.db");
      await raw.execAsync("DROP TABLE IF EXISTS f; CREATE VIRTUAL TABLE f USING fts5(d); INSERT INTO f (d) VALUES ('copo x')");
      out = `hits=${(await raw.getAllAsync("SELECT d FROM f WHERE f MATCH 'copo'")).length}`;
      await raw.closeAsync();
    }
    await database.close();
    return `${label}: ${out}`;
  });

  return results.every(Boolean);
}
