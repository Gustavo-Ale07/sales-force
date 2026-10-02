import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeAllThenStop, createTestDb, startPostgres, type TestPostgres } from '../helpers/postgres.js';

/**
 * Regression for the gate failure of the first GitHub run (18 unhandled 57P01 errors): pg-pool's `end()` resolves before the
 * client sockets are closed, so stopping PostgreSQL right after it raced the still-attached backends.
 */
let postgres: TestPostgres;
let admin: pg.Client;

beforeAll(async () => {
  postgres = await startPostgres();
  admin = new pg.Client({ connectionString: postgres.container.getConnectionUri() });
  await admin.connect();
});

afterAll(async () => {
  await admin.end();
  await postgres.stop();
});

const backendsOf = async (applicationName: string): Promise<number> => {
  const { rows } = await admin.query<{ n: number }>('select count(*)::int as n from pg_stat_activity where application_name = $1', [applicationName]);
  return rows[0]?.n ?? 0;
};

async function warmPool(applicationName: string, size: number, beforeConnect?: (pool: pg.Pool) => void) {
  const handle = createTestDb(postgres.container.getConnectionUri(), { max: size, applicationName });
  beforeConnect?.(handle.pool);
  const clients = await Promise.all(Array.from({ length: size }, () => handle.pool.connect()));
  for (const client of clients) client.release();
  return handle;
}

describe('test harness teardown', () => {
  it('close() waits for every client socket, even when pool.end() resolves first (deterministic: client.end() is delayed)', async () => {
    const DELAY_MS = 300;
    const handle = await warmPool('harness-delayed', 3, (pool) =>
      pool.on('connect', (client) => {
        const end = client.end.bind(client) as (callback?: () => void) => void;
        (client as unknown as { end: (callback?: () => void) => void }).end = (callback) => end(() => setTimeout(() => callback?.(), DELAY_MS));
      }),
    );
    const started = Date.now();
    await handle.close();
    expect(Date.now() - started).toBeGreaterThanOrEqual(DELAY_MS - 20);
    expect(handle.pool.totalCount).toBe(0);
  });

  it('close() returns only after the server has no backend of the pool left', async () => {
    const handles = await Promise.all(Array.from({ length: 12 }, (_, i) => warmPool(`harness-close-${i}`, 3)));
    expect(await backendsOf('harness-close-0')).toBe(3);
    for (const handle of handles) await handle.close();
    for (let i = 0; i < 12; i++) expect(await backendsOf(`harness-close-${i}`), `harness-close-${i}`).toBe(0);
  });

  it('close() reports an error the pool emitted instead of leaving it unhandled', async () => {
    const handle = await warmPool('harness-pool-error', 2);
    const { rows } = await admin.query<{ pid: number }>("select pid from pg_stat_activity where application_name = 'harness-pool-error' limit 1");
    await admin.query('select pg_terminate_backend($1)', [rows[0]?.pid]);
    // The idle client learns about the terminated backend asynchronously.
    await expect.poll(() => handle.pool.totalCount, { timeout: 5_000 }).toBeLessThan(2);
    await expect(handle.close()).rejects.toThrow(/pool reported 1 error/);
  });

  it('stop() fails, naming the leak, when a client is still attached to the server (and still stops the container)', async () => {
    const second = await startPostgres({ closeDeadlineMs: 500 });
    const leaked = new pg.Client({ connectionString: second.container.getConnectionUri(), application_name: 'harness-leaked-client' });
    // The leak is deliberate; once stop() ends the container anyway, the server answers it with 57P01 and the client says so.
    const leakedErrors: Error[] = [];
    leaked.on('error', (error) => leakedErrors.push(error));
    await leaked.connect();
    let outcome: unknown;
    try {
      await second.stop();
    } catch (error) {
      outcome = error;
    } finally {
      await leaked.end();
    }
    expect(String(outcome)).toMatch(/harness-leaked-client/);
    expect(leakedErrors.length).toBeGreaterThan(0);
    expect(second.container.getId()).toBeTruthy();
    await expect(admin.query('select 1')).resolves.toBeDefined(); // the first container is untouched
  }, 60_000);

  it('closeAllThenStop runs every closer and stops PostgreSQL even when a closer fails, then rethrows', async () => {
    const second = await startPostgres();
    const calls: string[] = [];
    const failing = async () => {
      calls.push('failing');
      throw new Error('closer boom');
    };
    const fine = async () => void calls.push('fine');
    await expect(closeAllThenStop([fine, failing], second)).rejects.toThrow(/teardown failed \(1\)/);
    expect(calls).toEqual(['failing', 'fine']);
    const probe = new pg.Client({ connectionString: second.container.getConnectionUri(), connectionTimeoutMillis: 2_000 });
    await expect(probe.connect()).rejects.toBeDefined(); // the container is stopped
  }, 60_000);
});
