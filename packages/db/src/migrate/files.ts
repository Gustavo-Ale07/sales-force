import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

/** Default location of the reviewed SQL migrations (`packages/db/migrations`), from src/ or dist/. */
export const defaultMigrationsDir = path.resolve(import.meta.dirname, '..', '..', 'migrations');

export interface MigrationFile {
  /** Position in the journal (0-based). */
  idx: number;
  /** Migration id, e.g. `0000_initial_schema`. */
  tag: string;
  /** sha256 of the file content, recorded when applied; detects edits of applied migrations. */
  hash: string;
  /** Statements, split on the drizzle-kit statement-breakpoint marker. */
  statements: string[];
}

interface Journal {
  entries: { idx: number; tag: string }[];
}

export async function loadMigrations(dir: string = defaultMigrationsDir): Promise<MigrationFile[]> {
  let journal: Journal;
  try {
    journal = JSON.parse(
      await readFile(path.join(dir, 'meta', '_journal.json'), 'utf8'),
    ) as Journal;
  } catch (cause) {
    throw new Error(`Cannot read migration journal in "${dir}" (meta/_journal.json).`, { cause });
  }
  const sorted = [...journal.entries].sort((a, b) => a.idx - b.idx);
  const result: MigrationFile[] = [];
  for (const entry of sorted) {
    const file = path.join(dir, `${entry.tag}.sql`);
    let sql: string;
    try {
      sql = await readFile(file, 'utf8');
    } catch (cause) {
      throw new Error(`Migration file listed in the journal is missing: ${entry.tag}.sql`, {
        cause,
      });
    }
    result.push({
      idx: entry.idx,
      tag: entry.tag,
      // Normalize line endings so the hash is stable across Windows/Linux checkouts.
      hash: createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex'),
      statements: sql
        .split('--> statement-breakpoint')
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    });
  }
  return result;
}
