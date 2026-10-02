import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyPoolLimits } from '../../src/platform/pool-limits.js';
import { createMigratedDatabase, startPostgres, type TestPostgres, closeAllThenStop } from '../helpers/postgres.js';

let postgres: TestPostgres;
const opened: (() => Promise<unknown>)[] = [];

beforeAll(async () => {
  postgres = await startPostgres();
});

afterAll(async () => {
  await closeAllThenStop(opened, postgres);
});

describe('applyPoolLimits (A7: bounded database work)', () => {
  it('makes PostgreSQL cancel a statement that runs past the statement timeout', async () => {
    const database = await createMigratedDatabase(postgres);
    opened.push(() => database.handle.close());
    applyPoolLimits(database.handle.pool, { connectionTimeoutMs: 2000, statementTimeoutMs: 300 });

    const started = Date.now();
    await expect(database.handle.pool.query('select pg_sleep(5)')).rejects.toThrow(/statement timeout/i);
    expect(Date.now() - started).toBeLessThan(3000);
    // The pool is still usable afterwards.
    expect((await database.handle.pool.query('select 1 as one')).rows).toEqual([{ one: 1 }]);
  });

  it('fails a caller that waits too long for a connection instead of queueing forever', async () => {
    const database = await createMigratedDatabase(postgres);
    opened.push(() => database.handle.close());
    applyPoolLimits(database.handle.pool, { connectionTimeoutMs: 200, statementTimeoutMs: 10_000 });
    // Occupy every pooled connection.
    const held = await Promise.all(
      Array.from({ length: database.handle.pool.options.max ?? 10 }, () => database.handle.pool.connect()),
    );
    try {
      await expect(database.handle.pool.query('select 1')).rejects.toThrow(/timeout/i);
    } finally {
      for (const client of held) client.release();
    }
  });
});
