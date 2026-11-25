import { schema, type DbHandle } from '@salesforce/db';
import type { ReadScope } from '@salesforce/sankhya';
import { getTableColumns, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { withEntityLock } from '../sync/entity-lock.js';
import { describeSyncFailure } from '../sync/failure.js';
import { MIRROR_SPECS, type MirrorGateway, type MirrorReadContext } from '../sync/mirror-entities.js';
import { hashRows } from '../sync/mirror-writer.js';
import type { Logger } from '../observability/logger.js';
import { diffKeyed, liveCount, type MirrorRowState } from './compare.js';
import { noComparison, type MirrorConsistencyType, type TypeOutcome } from './types.js';

export interface MirrorConsistencyDeps {
  readonly db: DbHandle;
  readonly gateway: MirrorGateway;
  readonly logger: Logger;
  /** Same provider the mirror job uses (`loadCurrentReadScope`): the scope rules are therefore identical. Absent = unscoped (fake/tests). */
  readonly readScope?: () => Promise<ReadScope>;
  readonly signal?: AbortSignal;
}

/**
 * Compares ONE row mirror with what Sankhya returns now.
 *
 * The source side is the mirror's own spec: `MIRROR_SPECS[entity].read(context)` (the same gateway method, the same read scope,
 * the same mapping) hashed with `hashRows` (the same content hash the writer stores). Nothing here queries Sankhya on its own,
 * and for products/list prices/customers the full snapshot is the mirror's snapshot read, not a new query.
 *
 * The whole check runs under the entity's session advisory lock (the one the mirror job takes): a mirror write can not land
 * between the Sankhya read and the PostgreSQL read, and a locked entity is skipped, never failed.
 */
export async function verifyMirrorType(deps: MirrorConsistencyDeps, type: MirrorConsistencyType): Promise<TypeOutcome> {
  const { db, gateway, logger } = deps;
  const spec = MIRROR_SPECS[type];
  const description = gateway.describe();
  const unsupported = spec.requires.find((read) => description.capabilities.reads[read] === 'not_implemented');
  if (unsupported !== undefined) return noComparison('unsupported', `not_implemented:${unsupported}`);

  const locked = await withEntityLock(db.pool, type, async (client) => {
    const session = drizzle(client, { schema });

    // 1. Sankhya now, through the mirror's own read. Any failure means "nothing to compare", never "everything is extra".
    const source = new Map<string, string>();
    const excluded: Record<string, number> = {};
    try {
      const scope = deps.readScope === undefined ? undefined : await deps.readScope();
      if (
        description.mode === 'live' &&
        (scope === undefined ||
          scope.priceTableCodes === undefined ||
          scope.priceTableCodes.length === 0 ||
          (scope.products?.usageValues ?? []).length === 0)
      ) {
        return noComparison('read_failed', 'mirror_scope_unavailable');
      }
      const context: MirrorReadContext = {
        gateway,
        description,
        ...(scope === undefined ? {} : { scope }),
        warn: (message: string) => logger.debug({ type }, message),
        excluded: (_entity, counts) => {
          for (const [criterion, n] of Object.entries(counts)) excluded[criterion] = (excluded[criterion] ?? 0) + n;
        },
        ...(deps.signal === undefined ? {} : { signal: deps.signal }),
      };
      for await (const batch of spec.read(context)) {
        deps.signal?.throwIfAborted();
        for (const row of hashRows(batch)) {
          const key = row.key.join(':');
          // The gateway contract forbids repeats; a repeat means the read is not trustworthy (fail closed, as the writer does).
          if (source.has(key)) return noComparison('read_failed', 'duplicate_key');
          source.set(key, row.hash);
        }
      }
    } catch (error) {
      const failure = describeSyncFailure(error);
      return noComparison('read_failed', `${failure.errorClass}:${failure.errorCode ?? 'unknown'}`);
    }

    // 2. The Force mirror, in the same locked session.
    const columns = getTableColumns(spec.table) as Record<string, PgColumn>;
    const col = (prop: string): PgColumn => {
      const found = columns[prop];
      if (found === undefined) throw new TypeError(`${type}: unknown column property "${prop}"`);
      return found;
    };
    const k0 = col(spec.keyProps[0]);
    const k1Prop = spec.keyProps[1];
    const result = await session.execute(
      k1Prop === undefined
        ? sql`select ${k0} as k0, 0 as k1, ${col('contentHash')} as hash, ${col('deletedAt')} is not null as deleted from ${spec.table}`
        : sql`select ${k0} as k0, ${col(k1Prop)} as k1, ${col('contentHash')} as hash, ${col('deletedAt')} is not null as deleted from ${spec.table}`,
    );
    const mirror = new Map<string, MirrorRowState>();
    for (const row of result.rows as { k0: number | string; k1: number | string; hash: string; deleted: boolean }[]) {
      mirror.set(k1Prop === undefined ? String(row.k0) : `${row.k0}:${row.k1}`, { hash: row.hash, deleted: row.deleted });
    }
    const mirrorCount = liveCount(mirror);

    // Fail closed exactly like the mirror's `empty_snapshot` guard: an empty source against a populated mirror is a broken read.
    if (source.size === 0 && mirrorCount > 0) {
      return { ...noComparison('suspect_empty_source', 'empty_snapshot'), sourceCount: 0, mirrorCount };
    }
    const differences = diffKeyed(source, mirror);
    const outcome: TypeOutcome = {
      status: 'checked',
      sourceCount: source.size,
      mirrorCount,
      differences,
      ...(Object.keys(excluded).length > 0 ? { excluded } : {}),
    };
    return outcome;
  });
  return locked.acquired ? locked.value : noComparison('skipped_locked', 'entity_lock_held');
}
