import { FakeGateway } from '@salesforce/sankhya';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogger } from '../../src/observability/logger.js';
import { MirrorSyncService } from '../../src/sync/mirror-sync.service.js';
import { closeAllThenStop, createMigratedDatabase, startPostgres, type MigratedDatabase, type TestPostgres } from '../helpers/postgres.js';

/**
 * Regression (consistency investigation 2026-11-25): a row another writer put into the mirror AFTER the snapshot started
 * (the Force customer delivery inserts into erp_customer the moment the ERP confirms it) is not in that snapshot. The
 * deactivation of the same run must not judge it; the next run reads it from the ERP.
 */
let postgres: TestPostgres;
let database: MigratedDatabase;

beforeAll(async () => {
  postgres = await startPostgres();
  database = await createMigratedDatabase(postgres);
});
afterAll(async () => {
  await closeAllThenStop([() => database.handle.close()], postgres);
});

describe('mirror deactivation vs a row written during the read', () => {
  it('keeps a customer inserted after the snapshot started, still deactivates one that was already stale', async () => {
    const logger = createLogger({ level: 'silent', service: 'worker' });
    class RacingGateway extends FakeGateway {
      onRead: (() => Promise<void>) | null = null;
      override readCustomers(options?: Parameters<FakeGateway['readCustomers']>[0]) {
        const inner = super.readCustomers(options);
        const hook = (): Promise<void> => this.onRead?.() ?? Promise.resolve();
        return {
          async *[Symbol.asyncIterator]() {
            await hook();
            yield* inner;
          },
        } as unknown as ReturnType<FakeGateway['readCustomers']>;
      }
    }
    const gateway = new RacingGateway({ batchSize: 1000 });
    const mirror = new MirrorSyncService({ db: database.handle, gateway, logger, now: () => new Date(), salesHistory: null });
    await mirror.run('customers');

    const copy = async (code: number, syncedAt: Date): Promise<void> => {
      const client = await database.handle.pool.connect();
      try {
        await client.query('create temp table c as select * from erp_customer limit 1');
        await client.query('update c set code = $1, synced_at = $2', [code, syncedAt]);
        await client.query('insert into erp_customer select * from c');
      } finally {
        await client.query('drop table if exists c').catch(() => undefined);
        client.release();
      }
    };
    // Stale: written long before the run, not in the snapshot -> must be deactivated.
    await copy(900001, new Date(Date.now() - 3_600_000));
    // Racing: written by another process while this run reads -> must survive this run.
    gateway.onRead = () => copy(900002, new Date(Date.now() + 60_000));
    await mirror.run('customers');

    const state = async (code: number) =>
      (await database.handle.pool.query<{ deleted: boolean }>('select deleted_at is not null as deleted from erp_customer where code = $1', [code])).rows[0]?.deleted;
    expect(await state(900001)).toBe(true);
    expect(await state(900002)).toBe(false);
  });
});
