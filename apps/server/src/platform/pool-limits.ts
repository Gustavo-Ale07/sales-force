import type pg from 'pg';

export interface PoolLimits {
  /** Time a caller waits for a free or new connection before failing (`pg` `connectionTimeoutMillis`). */
  readonly connectionTimeoutMs: number;
  /** Server-side `statement_timeout` of every connection opened afterwards. */
  readonly statementTimeoutMs: number;
}

/**
 * Applies connection and statement timeouts to an existing pool. `pg-pool` reads `options` when it
 * opens each connection (and when a caller starts waiting), so setting them right after
 * `createDb` and before the first query takes effect for every connection. Done here, and not in
 * `@salesforce/db`, to keep the change inside the API entry point.
 */
export function applyPoolLimits(pool: pg.Pool, limits: PoolLimits): void {
  Object.assign(pool.options, {
    connectionTimeoutMillis: limits.connectionTimeoutMs,
    statement_timeout: limits.statementTimeoutMs,
  });
}
