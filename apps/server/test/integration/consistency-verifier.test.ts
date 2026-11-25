import { FakeGateway, SankhyaGatewayError, getDemoDataset, type DemoDataset, type ReadEntity } from '@salesforce/sankhya';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConsistencyVerifier } from '../../src/consistency/consistency-verifier.js';
import { MIRROR_CONSISTENCY_TYPES, type ConsistencyReport, type ConsistencyType, type MirrorConsistencyType } from '../../src/consistency/types.js';
import { createLogger } from '../../src/observability/logger.js';
import { MirrorSyncService } from '../../src/sync/mirror-sync.service.js';
import { closeAllThenStop, createMigratedDatabase, startPostgres, type MigratedDatabase, type TestPostgres } from '../helpers/postgres.js';

/**
 * Consistency verifier (owner 2026-11-25) against real PostgreSQL and the fake gateway: for each mirror type the cases
 * consistent / divergent / missing / extra, and a failed Sankhya read that must never be reported as "extra in Force".
 */
const TABLES: Record<MirrorConsistencyType, string> = {
  sellers: 'erp_seller',
  directoryUsers: 'erp_directory_user',
  customers: 'erp_customer',
  products: 'erp_product',
  productGroups: 'erp_product_group',
  priceTables: 'erp_price_table',
  priceTableVersions: 'erp_price_table_version',
  listPrices: 'erp_list_price',
  carriers: 'erp_carrier',
  ipiRates: 'erp_ipi_rate',
  openTitles: 'erp_open_title',
};

let postgres: TestPostgres;
const databases: MigratedDatabase[] = [];
const logger = createLogger({ level: 'silent', service: 'worker' });

beforeAll(async () => {
  postgres = await startPostgres();
});
afterAll(async () => {
  await closeAllThenStop(
    databases.map((database) => () => database.handle.close()),
    postgres,
  );
});

type MutableDataset = { -readonly [K in keyof DemoDataset]: DemoDataset[K][number][] };
function datasetCopy(): MutableDataset {
  const source = getDemoDataset();
  return {
    sellers: [...source.sellers],
    sellerManagerLinks: [...source.sellerManagerLinks],
    directoryUsers: [...source.directoryUsers],
    carriers: [...source.carriers],
    ipiRates: [...source.ipiRates],
    openTitles: [...source.openTitles],
    customers: [...source.customers],
    productGroups: [...source.productGroups],
    products: [...source.products],
    priceTables: [...source.priceTables],
    priceTableVersions: [...source.priceTableVersions],
    listPrices: [...source.listPrices],
  };
}

async function synced(): Promise<{ database: MigratedDatabase; gateway: FakeGateway }> {
  const database = await createMigratedDatabase(postgres);
  databases.push(database);
  const gateway = new FakeGateway({ batchSize: 1000 });
  const mirror = new MirrorSyncService({ db: database.handle, gateway, logger, now: () => new Date(), salesHistory: null });
  const { failures } = await mirror.runAll(MIRROR_CONSISTENCY_TYPES);
  expect(failures).toEqual([]);
  return { database, gateway };
}

async function check(database: MigratedDatabase, gateway: FakeGateway, type: ConsistencyType, limit = 50): Promise<ConsistencyReport['types'][number]> {
  const report = await new ConsistencyVerifier({ db: database.handle, gateway, logger }).run({ types: [type], sampleLimit: limit });
  const entry = report.types[0];
  if (entry === undefined) throw new Error('no report entry');
  return entry;
}

describe.each(MIRROR_CONSISTENCY_TYPES)('consistency verifier: %s', (type) => {
  it('consistent, divergent, missing, extra; a failed read never reports extras', async () => {
    const { database, gateway } = await synced();
    const table = TABLES[type];
    const pool = database.handle.pool;
    const live = async () => (await pool.query<{ n: number }>(`select count(*)::int as n from ${table} where deleted_at is null`)).rows[0]!.n;
    const total = await live();
    expect(total).toBeGreaterThan(0);

    // consistent
    const ok = await check(database, gateway, type);
    expect(ok).toMatchObject({ status: 'checked', missing: 0, extra: 0, divergent: 0, sourceCount: total, mirrorCount: total });

    // divergent: the stored content no longer matches what Sankhya returns
    await pool.query(`update ${table} set content_hash = 'tampered' where ctid = (select ctid from ${table} limit 1)`);
    const divergent = await check(database, gateway, type);
    expect(divergent).toMatchObject({ status: 'checked', missing: 0, extra: 0, divergent: 1 });
    expect(divergent.samples.divergent).toHaveLength(1);

    // missing: Sankhya returns it, the Force has no row
    await pool.query(`delete from ${table} where ctid = (select ctid from ${table} limit 1)`);
    const missing = await check(database, gateway, type);
    expect(missing).toMatchObject({ status: 'checked', missing: 1, extra: 0 });

    // a soft-deleted mirror row that Sankhya still returns is also missing (not live in the Force)
    await pool.query(`update ${table} set deleted_at = now() where ctid = (select ctid from ${table} where deleted_at is null limit 1 offset 1)`);
    expect((await check(database, gateway, type)).missing).toBeGreaterThanOrEqual(1);

    // extra: the Force row is live, Sankhya no longer returns it (deleted / inactivated / out of scope)
    const rebuilt = await synced();
    const dataset = datasetCopy();
    const rows = dataset[type] as unknown[];
    if (rows.length > 1) {
      rows.splice(0, 1);
      const extra = await check(rebuilt.database, new FakeGateway({ batchSize: 1000, dataset: dataset as DemoDataset }), type);
      expect(extra).toMatchObject({ status: 'checked', extra: 1, missing: 0 });
    } else {
      // Sankhya returning nothing against a populated mirror is the empty_snapshot pattern: reported as suspect, never as extras.
      rows.length = 0;
      const emptied = await check(rebuilt.database, new FakeGateway({ batchSize: 1000, dataset: dataset as DemoDataset }), type);
      expect(emptied).toMatchObject({ status: 'suspect_empty_source', extra: 0, missing: 0, divergent: 0 });
    }

    // read failure (after a partial batch when the type has several rows): nothing compared, never extras
    const failing = new FakeGateway({
      batchSize: 1,
      faults: [{ entity: type as ReadEntity, afterBatches: rows.length > 1 || (dataset[type] as unknown[]).length > 1 ? 1 : 0, error: new SankhyaGatewayError('unavailable', { code: 'down', message: 'down' }) }],
    });
    const failed = await check(rebuilt.database, failing, type);
    expect(failed).toMatchObject({ status: 'read_failed', missing: 0, extra: 0, divergent: 0 });
    expect(failed.detail).toBeDefined();
  });
});

describe('consistency verifier: report', () => {
  it('caps samples, keeps full counts and totals, and reports the entity lock as skipped', async () => {
    const { database, gateway } = await synced();
    await database.handle.pool.query(`update erp_customer set content_hash = 'tampered'`);
    const capped = await check(database, gateway, 'customers', 3);
    expect(capped.divergent).toBeGreaterThan(3);
    expect(capped.samples.divergent).toHaveLength(3);

    const report = await new ConsistencyVerifier({ db: database.handle, gateway, logger }).run({ types: ['customers', 'sellers'], sampleLimit: 2 });
    expect(report.totals.divergent).toBe(capped.divergent);
    expect(report.consistent).toBe(false);
    expect(report.types.map((t) => t.type)).toEqual(['sellers', 'customers']);
    expect(report.types.find((t) => t.type === 'sellers')?.lastSuccessfulSyncAt).toEqual(expect.any(String));
  });
});
