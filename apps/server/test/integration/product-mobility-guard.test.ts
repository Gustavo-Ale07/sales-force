import { FakeGateway, getDemoDataset, type DemoDataset } from '@salesforce/sankhya';
import { syncState } from '@salesforce/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogger } from '../../src/observability/logger.js';
import { MirrorSyncService } from '../../src/sync/mirror-sync.service.js';
import { closeAllThenStop, createMigratedDatabase, startPostgres, type MigratedDatabase, type TestPostgres } from '../helpers/postgres.js';

/** Owner ruling 2026-11-13: AD_MOBILIDADE on products, anti-empty guard on the product mirror. */
let postgres: TestPostgres;
const databases: MigratedDatabase[] = [];

beforeAll(async () => {
  postgres = await startPostgres();
});
afterAll(async () => {
  await closeAllThenStop(
    databases.map((database) => () => database.handle.close()),
    postgres,
  );
});

const scope = {
  products: { usageValues: ['V', 'R', 'S'], activeOnly: false, mobilitySourceField: 'AD_MOBILIDADE', mobilityAllowedValues: ['S'] },
  priceTableCodes: [5],
};

function datasetWith(mobility: (index: number) => string | null) {
  const source = getDemoDataset();
  const products = source.products.map((product, index) => ({ ...product, usageCode: 'V', active: true, mobilityCode: mobility(index) }));
  return { ...source, products } as unknown as DemoDataset;
}

async function setup(dataset: DemoDataset) {
  const database = await createMigratedDatabase(postgres);
  databases.push(database);
  const service = () =>
    new MirrorSyncService({
      db: database.handle,
      gateway: new FakeGateway({ dataset }),
      logger: createLogger({ level: 'silent', service: 'worker' }),
      now: () => new Date(),
      readScope: async () => scope,
    });
  return { database, service };
}

const live = async (database: MigratedDatabase) =>
  (await database.handle.pool.query<{ n: number }>('select count(*)::int as n from erp_product where deleted_at is null')).rows[0]?.n ?? 0;

describe('product mobility (AD_MOBILIDADE)', () => {
  it('a product that loses mobility (S -> N / null) is hidden; one that regains it returns', async () => {
    const all = datasetWith(() => 'S');
    const total = all.products.length;
    expect(total).toBeGreaterThan(10);
    const first = await setup(all);
    await first.service().run('products');
    expect(await live(first.database)).toBe(total);

    // Same mirror, new snapshot: two products lose mobility (N and null).
    const next = datasetWith((index) => (index === 0 ? 'N' : index === 1 ? null : 'S'));
    const service = new MirrorSyncService({
      db: first.database.handle,
      gateway: new FakeGateway({ dataset: next }),
      logger: createLogger({ level: 'silent', service: 'worker' }),
      now: () => new Date(),
      readScope: async () => scope,
    });
    const run = await service.run('products');
    expect(run.stats).toMatchObject({ deactivated: 2 });
    expect(run.mobility).toEqual({ visible: total - 2, hidden: 2, keptPrevious: false });
    expect(await live(first.database)).toBe(total - 2);
  });

  it('more than 90 percent hidden keeps the previous base, records the counts and the reason', async () => {
    const all = datasetWith(() => 'S');
    const total = all.products.length;
    const { database, service } = await setup(all);
    await service().run('products');

    const mostlyHidden = datasetWith((index) => (index < 2 ? 'S' : 'N'));
    const guarded = new MirrorSyncService({
      db: database.handle,
      gateway: new FakeGateway({ dataset: mostlyHidden }),
      logger: createLogger({ level: 'silent', service: 'worker' }),
      now: () => new Date(),
      readScope: async () => scope,
    });
    const run = await guarded.run('products');
    expect(run.stats?.deactivated).toBe(0);
    expect(run.mobility).toEqual({ visible: 2, hidden: total - 2, keptPrevious: true });
    expect(await live(database)).toBe(total);
    const [state] = await database.handle.db.select().from(syncState).where(eq(syncState.entity, 'products'));
    expect((state?.cursor as { lastRun: { mobility?: unknown } }).lastRun.mobility).toEqual({ visible: 2, hidden: total - 2, keptPrevious: true });
  });

  it('everything hidden keeps the previous base (a snapshot with no visible product is not an empty catalog)', async () => {
    const all = datasetWith(() => 'S');
    const total = all.products.length;
    const { database, service } = await setup(all);
    await service().run('products');
    const none = datasetWith(() => 'N');
    const guarded = new MirrorSyncService({
      db: database.handle,
      gateway: new FakeGateway({ dataset: none }),
      logger: createLogger({ level: 'silent', service: 'worker' }),
      now: () => new Date(),
      readScope: async () => scope,
    });
    const run = await guarded.run('products');
    expect(run.mobility).toMatchObject({ visible: 0, keptPrevious: true });
    expect(await live(database)).toBe(total);
  });
});
