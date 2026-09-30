import { File } from "expo-file-system";
import * as SQLite from "expo-sqlite";
import { createSqlDatabase, type RawConnection, type SqlDatabase } from "./connection";
import { getOrCreateDatabaseKey, type KeyStore, type RandomBytes } from "./key";
import { migrations } from "./migrations";
import { runMigrations, type Migration, type MigrationReport } from "./migrator";

/**
 * The only module that imports the SQLite library (`expo-sqlite` built with SQLCipher, `useSQLCipher: true`).
 * Requires a development build; not available in Expo Go (MOB-1).
 */
export class EncryptionUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EncryptionUnavailableError";
  }
}

export interface OpenEncryptedOptions {
  readonly name: string;
  readonly keyStore: KeyStore;
  readonly randomBytes: RandomBytes;
  /** Defaults to the production schema. Tests and the S7 diagnostics pass their own list. */
  readonly migrations?: readonly Migration[];
}

export interface OpenedDatabase {
  readonly database: SqlDatabase;
  readonly migration: MigrationReport;
  readonly cipherVersion: string;
  /**
   * The underlying expo-sqlite handle, exposed ONLY so the S7 diagnostics can prove the Drizzle pairing (V-09).
   * Application code must not use it.
   */
  readonly unsafeNativeHandle: SQLite.SQLiteDatabase;
}

/** expo-file-system wants a URI; on Android `defaultDatabaseDirectory` is a bare path (proven on device). */
export function databaseFileUri(name: string): string {
  const directory = SQLite.defaultDatabaseDirectory;
  const base = directory.startsWith("file:") ? directory : `file://${directory}`;
  return `${base.replace(/\/+$/, "")}/${name}`;
}

function databaseFileExists(name: string): boolean {
  return new File(databaseFileUri(name)).exists;
}

function sqlLiteral(hexKey: string): string {
  return `"x'${hexKey}'"`;
}

/** Opens (creating if needed) the encrypted database, verifies encryption is real, and migrates it to the latest schema. */
export async function openEncryptedDatabase(options: OpenEncryptedOptions): Promise<OpenedDatabase> {
  const key = await getOrCreateDatabaseKey(options.keyStore, options.randomBytes, databaseFileExists(options.name));
  const native = await SQLite.openDatabaseAsync(options.name);
  try {
    // SQLCipher: the key must be the first statement on the connection.
    await native.execAsync(`PRAGMA key = ${sqlLiteral(key)}`);
    const cipher = await native.getFirstAsync<{ cipher_version: string }>("PRAGMA cipher_version");
    const cipherVersion = cipher?.cipher_version ?? "";
    if (cipherVersion === "") {
      // MOB-2: encryption is never silently downgraded. A build without SQLCipher must fail loudly.
      throw new EncryptionUnavailableError("SQLCipher is not present in this build (useSQLCipher); refusing to use an unencrypted database.");
    }
    // Forces a page read: a wrong/absent key fails here with "file is not a database", not later.
    await native.getFirstAsync("SELECT count(*) AS n FROM sqlite_master");
    const raw: RawConnection = {
      run: async (sql, params) => {
        const result = await native.runAsync(sql, params as SQLite.SQLiteBindParams);
        return { changes: result.changes, lastInsertRowId: result.lastInsertRowId };
      },
      all: (sql, params) => native.getAllAsync(sql, params as SQLite.SQLiteBindParams),
      close: () => native.closeAsync(),
    };
    const database = createSqlDatabase(raw);
    const migration = await runMigrations(database, options.migrations ?? migrations);
    return { database, migration, cipherVersion, unsafeNativeHandle: native };
  } catch (error) {
    await native.closeAsync().catch(() => undefined);
    throw error;
  }
}

export async function deleteDatabaseFile(name: string): Promise<void> {
  await SQLite.deleteDatabaseAsync(name);
}
