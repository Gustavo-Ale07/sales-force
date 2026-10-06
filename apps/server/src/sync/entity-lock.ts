import type pg from 'pg';
import { MIRROR_ENTITIES, type MirrorEntity } from './mirror-entities.js';

/** First key of the two-integer advisory lock space used by the mirror sync (`SFMS`). */
export const MIRROR_LOCK_NAMESPACE = 0x53464d53;

/** Second key: the entity's position in `MIRROR_ENTITIES` (append only; never reorder). */
export function mirrorLockObjectId(entity: MirrorEntity): number {
  return MIRROR_ENTITIES.indexOf(entity) + 1;
}

export type LockOutcome<T> = { readonly acquired: false } | { readonly acquired: true; readonly value: T };

/**
 * Runs `work` while holding a SESSION-level PostgreSQL advisory lock for the entity, on a dedicated
 * pooled connection. A second run of the same entity (another worker process, the CLI, a retried
 * job) does not wait: it gets `{ acquired: false }` and must skip. The lock dies with the session,
 * so a crashed process never leaves an entity locked.
 *
 * Session-level locks and the run's temporary table need a real session: they do not work behind a
 * transaction-pooling proxy (DATA-1 requires private, direct connections to PostgreSQL).
 */
export function withEntityLock<T>(
  pool: pg.Pool,
  entity: MirrorEntity,
  work: (client: pg.PoolClient) => Promise<T>,
): Promise<LockOutcome<T>> {
  return withAdvisoryLock(pool, MIRROR_LOCK_NAMESPACE, mirrorLockObjectId(entity), work);
}

/**
 * Generic form of `withEntityLock`: a SESSION-level advisory lock on the key pair `(namespace, objectId)`.
 * Each job family owns its own namespace (the mirror sync `SFMS`, the product photo sync `SFPM`), so
 * the key spaces never collide.
 */
export async function withAdvisoryLock<T>(
  pool: pg.Pool,
  namespace: number,
  objectId: number,
  work: (client: pg.PoolClient) => Promise<T>,
): Promise<LockOutcome<T>> {
  const client = await pool.connect();
  let locked = false;
  try {
    const result = await client.query<{ locked: boolean }>('select pg_try_advisory_lock($1, $2) as locked', [
      namespace,
      objectId,
    ]);
    locked = result.rows[0]?.locked === true;
    if (!locked) return { acquired: false };
    return { acquired: true, value: await work(client) };
  } finally {
    if (locked) {
      // Explicit unlock first: a destroyed connection frees the lock only once the server notices.
      await client.query('select pg_advisory_unlock($1, $2)', [namespace, objectId]).catch(() => undefined);
    }
    // The connection is always destroyed, never pooled again: it carried session state (the advisory
    // lock, the run's temporary table) that must not leak into other work.
    client.release(true);
  }
}
