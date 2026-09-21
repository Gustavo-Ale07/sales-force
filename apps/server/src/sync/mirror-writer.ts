import { SankhyaGatewayError } from '@salesforce/sankhya';
import { getTableColumns, sql } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { contentHash } from './content-hash.js';
import type { MirrorEntitySpec, MirrorRow } from './mirror-entities.js';
import type { Queryable, RunStats } from './sync-state.js';

/**
 * Writes one entity's rows into its `erp_*` table. Everything here runs on the session that holds
 * the entity's advisory lock (see `entity-lock.ts`); nothing is ever hard-deleted.
 */

/** Name of the per-run temporary table holding the keys seen in the source snapshot. */
export const SEEN_TABLE = 'sf_sync_seen';
const WRITE_CHUNK_ROWS = 500;

export interface HashedRow extends MirrorRow {
  readonly hash: string;
}

export type BatchCounts = Pick<RunStats, 'created' | 'updated' | 'reactivated' | 'unchanged'>;

function columnsOf(spec: MirrorEntitySpec): Record<string, PgColumn> {
  return getTableColumns(spec.table) as Record<string, PgColumn>;
}

function column(spec: MirrorEntitySpec, prop: string): PgColumn {
  const found = columnsOf(spec)[prop];
  if (found === undefined) throw new TypeError(`${spec.entity}: unknown column property "${prop}"`);
  return found;
}

/** A PostgreSQL `int[]` literal from validated integers (keys are checked to be 32-bit integers). */
function intArrayLiteral(values: readonly number[]): string {
  return `{${values.join(',')}}`;
}

export function hashRows(rows: readonly MirrorRow[]): HashedRow[] {
  return rows.map((row) => ({ ...row, hash: contentHash(row.content) }));
}

/** The contract forbids duplicate keys; a duplicate would make one INSERT touch a row twice. */
function assertNoDuplicateKeys(spec: MirrorEntitySpec, rows: readonly MirrorRow[]): void {
  const seen = new Set<string>();
  for (const row of rows) {
    const id = row.key.join(':');
    if (seen.has(id)) {
      throw new SankhyaGatewayError('validation', {
        code: 'duplicate_key',
        message: `${spec.entity}: the snapshot delivered the same key twice in one batch, which violates the gateway contract. The run was rejected.`,
      });
    }
    seen.add(id);
  }
}

export async function prepareSeenTable(db: Queryable): Promise<void> {
  await db.execute(
    sql.raw(`create temporary table if not exists ${SEEN_TABLE} (k0 integer not null, k1 integer not null default 0)`),
  );
  await db.execute(sql.raw(`truncate ${SEEN_TABLE}`));
}

interface ExistingRow {
  readonly hash: string;
  readonly deleted: boolean;
}

async function loadExisting(
  db: Queryable,
  spec: MirrorEntitySpec,
  rows: readonly MirrorRow[],
): Promise<Map<string, ExistingRow>> {
  const k0 = column(spec, spec.keyProps[0]);
  const k1Prop = spec.keyProps[1];
  const hashColumn = column(spec, 'contentHash');
  const deletedColumn = column(spec, 'deletedAt');
  const keys0 = intArrayLiteral(rows.map((row) => row.key[0] ?? 0));
  const result =
    k1Prop === undefined
      ? await db.execute(
          sql`select ${k0} as k0, 0 as k1, ${hashColumn} as hash, ${deletedColumn} is not null as deleted
              from ${spec.table} where ${k0} = any(${keys0}::int[])`,
        )
      : await db.execute(
          sql`select ${k0} as k0, ${column(spec, k1Prop)} as k1, ${hashColumn} as hash, ${deletedColumn} is not null as deleted
              from ${spec.table}
              where (${k0}, ${column(spec, k1Prop)}) in
                (select * from unnest(${keys0}::int[], ${intArrayLiteral(rows.map((row) => row.key[1] ?? 0))}::int[]))`,
        );
  const existing = new Map<string, ExistingRow>();
  for (const row of result.rows as { k0: number; k1: number; hash: string; deleted: boolean }[]) {
    existing.set(k1Prop === undefined ? String(row.k0) : `${row.k0}:${row.k1}`, { hash: row.hash, deleted: row.deleted });
  }
  return existing;
}

/**
 * Hash-diff upsert of one source batch, inside the caller's transaction:
 * - key absent from the mirror -> insert (`created`);
 * - key present with a different hash -> update the changed content (`updated`);
 * - key present, same hash, but soft-deleted -> reactivate (`reactivated`);
 * - key present with the same hash -> NOT written (`unchanged`).
 * Every key of the batch is recorded as "seen" for the final deactivation step.
 */
export async function applyBatch(
  db: Queryable,
  spec: MirrorEntitySpec,
  batch: readonly HashedRow[],
  writtenAt: Date,
): Promise<BatchCounts> {
  const counts = { created: 0, updated: 0, reactivated: 0, unchanged: 0 };
  if (batch.length === 0) return counts;
  assertNoDuplicateKeys(spec, batch);

  const existing = await loadExisting(db, spec, batch);
  const toWrite: HashedRow[] = [];
  for (const row of batch) {
    const current = existing.get(row.key.join(':'));
    if (current === undefined) {
      counts.created += 1;
      toWrite.push(row);
    } else if (current.hash !== row.hash) {
      counts.updated += 1;
      toWrite.push(row);
    } else if (current.deleted) {
      counts.reactivated += 1;
      toWrite.push(row);
    } else {
      counts.unchanged += 1;
    }
  }

  const first = toWrite[0];
  if (first !== undefined) {
    const updatable = [...Object.keys(first.content), 'contentHash', 'syncedAt', 'deletedAt'];
    const set = Object.fromEntries(
      updatable.map((prop) => [prop, sql`excluded.${sql.identifier(column(spec, prop).name)}`]),
    );
    const target = spec.keyProps.map((prop) => column(spec, prop));
    for (let offset = 0; offset < toWrite.length; offset += WRITE_CHUNK_ROWS) {
      const values = toWrite.slice(offset, offset + WRITE_CHUNK_ROWS).map((row) => ({
        ...Object.fromEntries(spec.keyProps.map((prop, index) => [prop, row.key[index]])),
        ...row.content,
        contentHash: row.hash,
        syncedAt: writtenAt,
        deletedAt: null,
      }));
      // The rows are assembled from the spec's own column property names; Drizzle cannot type that
      // for a table chosen at run time.
      await db
        .insert(spec.table)
        .values(values as never)
        .onConflictDoUpdate({ target: target as [PgColumn, ...PgColumn[]], set: set as never });
    }
  }

  await db.execute(
    sql`insert into ${sql.raw(SEEN_TABLE)} (k0, k1)
        select * from unnest(${intArrayLiteral(batch.map((row) => row.key[0] ?? 0))}::int[], ${intArrayLiteral(batch.map((row) => row.key[1] ?? 0))}::int[])`,
  );
  return counts;
}

export async function countLive(db: Queryable, spec: MirrorEntitySpec): Promise<number> {
  const result = await db.execute(
    sql`select count(*)::int as n from ${spec.table} where ${column(spec, 'deletedAt')} is null`,
  );
  return (result.rows[0] as { n: number } | undefined)?.n ?? 0;
}

/**
 * Soft-deactivates the live rows whose key the COMPLETE source snapshot no longer contains. Call it
 * only after the whole snapshot was read without error (a partial read proves nothing, spike §9.33
 * item 3). Sets `deleted_at`; the row stays, and reappears (reactivated) if the source delivers it again.
 *
 * Fails closed on an empty snapshot while the mirror holds live rows: that pattern is far more likely
 * a broken read than the removal of every record (nothing is deactivated in that case).
 */
export async function deactivateMissing(
  db: Queryable,
  spec: MirrorEntitySpec,
  readCount: number,
  at: Date,
): Promise<number> {
  if (readCount === 0 && (await countLive(db, spec)) > 0) {
    throw new SankhyaGatewayError('validation', {
      code: 'empty_snapshot',
      message: `${spec.entity}: the source returned no rows while the mirror holds live rows. Nothing was deactivated; check the source before repeating the run.`,
    });
  }
  const k0 = column(spec, spec.keyProps[0]);
  const k1Prop = spec.keyProps[1];
  const k1Match = k1Prop === undefined ? sql`s.k1 = 0` : sql`s.k1 = ${column(spec, k1Prop)}`;
  const result = await db.execute(
    sql`update ${spec.table}
        set ${sql.identifier(column(spec, 'deletedAt').name)} = ${at}, ${sql.identifier(column(spec, 'syncedAt').name)} = ${at}
        where ${column(spec, 'deletedAt')} is null
          and not exists (select 1 from ${sql.raw(SEEN_TABLE)} s where s.k0 = ${k0} and ${k1Match})`,
  );
  return result.rowCount ?? 0;
}
