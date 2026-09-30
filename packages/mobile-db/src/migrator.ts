import type { SqlDatabase } from "./connection";

/**
 * Versioned, forward-only local schema migrations (P-16 expand → migrate → contract applies on device too).
 * The applied version lives in SQLite's `PRAGMA user_version`, written in the same transaction as the migration, so
 * a crash can never leave "schema changed, version not". "Drop the database and recreate" is not a migration path:
 * a database newer than this app is refused, never wiped.
 */
export interface Migration {
  /** 1-based, strictly consecutive. Never renumber or edit a migration once it shipped; add a new one. */
  readonly version: number;
  readonly name: string;
  readonly statements: readonly string[];
}

export interface MigrationReport {
  readonly from: number;
  readonly to: number;
  readonly applied: readonly number[];
}

export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationError";
  }
}

export function assertValidMigrations(migrations: readonly Migration[]): void {
  migrations.forEach((migration, index) => {
    if (migration.version !== index + 1) {
      throw new MigrationError(`Migration list must be consecutive from 1; found version ${migration.version} at position ${index + 1}.`);
    }
    if (migration.statements.length === 0) throw new MigrationError(`Migration ${migration.version} has no statements.`);
  });
}

export async function readSchemaVersion(db: SqlDatabase): Promise<number> {
  const rows = await db.query<{ user_version: number }>("PRAGMA user_version");
  return Number(rows[0]?.user_version ?? 0);
}

export async function runMigrations(db: SqlDatabase, migrations: readonly Migration[]): Promise<MigrationReport> {
  assertValidMigrations(migrations);
  const latest = migrations.length;
  const from = await readSchemaVersion(db);
  if (from > latest) {
    throw new MigrationError(
      `Local database is at schema v${from}, newer than this app (v${latest}). Refusing to open; update the app. The database is not modified.`,
    );
  }
  const applied: number[] = [];
  for (const migration of migrations.slice(from)) {
    await db.transaction(async (tx) => {
      for (const statement of migration.statements) await tx.execute(statement);
      // PRAGMA does not accept bound parameters; `version` is a validated integer from the list above.
      await tx.execute(`PRAGMA user_version = ${migration.version}`);
    });
    applied.push(migration.version);
  }
  return { from, to: latest, applied };
}
