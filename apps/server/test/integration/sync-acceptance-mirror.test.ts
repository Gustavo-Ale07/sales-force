import { FakeGateway, getDemoDataset, type DemoDataset, type ReadScope } from '@salesforce/sankhya';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogger } from '../../src/observability/logger.js';
import { MirrorSyncService } from '../../src/sync/mirror-sync.service.js';
import { closeAllThenStop, createMigratedDatabase, startPostgres, type MigratedDatabase, type TestPostgres } from '../helpers/postgres.js';

/**
 * docs/sync-acceptance.md, scenarios C2-C6: what leaves the Sankhya scope leaves the mirror in the SAME sync
 * (deactivateMissing, soft: `deleted_at`, never a hard delete) and a row that comes back is reactivated.
 * Customers (inactive, lost CLIENTE flag, changed seller), products (lost AD_MOBILIDADE, inactive, usage) and prices (row removed, table out of scope).
 */
let postgres: TestPostgres;
const databases: MigratedDatabase[] = [];
beforeAll(async () => {
  postgres = await startPostgres();
});
afterAll(async () => {
  await closeAllThenStop(databases.map((d) => () => d.handle.close()), postgres);
});

type Mutable = { -readonly [K in keyof DemoDataset]: DemoDataset[K][number][] };
function datasetCopy(): Mutable {
  const s = getDemoDataset();
  return {
    sellers: [...s.sellers],
    sellerManagerLinks: [...s.sellerManagerLinks],
    directoryUsers: [...s.directoryUsers],
    carriers: [...s.carriers],
    ipiRates: [...s.ipiRates],
    openTitles: [...s.openTitles],
    customers: [...s.customers],
    productGroups: [...s.productGroups],
    products: [...s.products],
    priceTables: [...s.priceTables],
    priceTableVersions: [...s.priceTableVersions],
    listPrices: [...s.listPrices],
  };
}

async function setup(dataset: Mutable, scope: () => ReadScope) {
  const database = await createMigratedDatabase(postgres);
  databases.push(database);
  const service = () =>
    new MirrorSyncService({
      db: database.handle,
      gateway: new FakeGateway({ batchSize: 3, dataset: dataset as DemoDataset }),
      logger: createLogger({ level: 'silent', service: 'worker' }),
      now: () => new Date(),
      readScope: async () => scope(),
    });
  const live = async (sql: string) => (await database.handle.pool.query<{ code: number }>(sql)).rows.map((r) => r.code).sort((a, b) => a - b);
  return { database, service, live };
}

describe('sync acceptance: customers leave the mirror in the same sync', () => {
  it('inactive, lost CLIENTE flag and changed seller: gone from the old seller at once, rows kept (soft), reactivated on return', async () => {
    const dataset = datasetCopy();
    const base = dataset.customers[0]!;
    const mk = (code: number, over: Partial<typeof base> = {}) => ({ ...base, code, active: true, blocked: false, sellerCode: 103, ...over });
    dataset.customers = [mk(9001), mk(9002), mk(9003), mk(9004)];
    const { database, service, live } = await setup(dataset, () => ({ customers: { activeOnly: true, requiredFlags: ['CLIENTE'], columnIn: [] } }));
    const ofSeller = (seller: number) => live(`select code from erp_customer where seller_code = ${seller} and deleted_at is null`);

    expect((await service().run('customers')).stats).toMatchObject({ read: 4, created: 4 });
    expect(await ofSeller(103)).toEqual([9001, 9002, 9003, 9004]);

    dataset.customers[0] = mk(9001, { sellerCode: 104 }); // seller changed in TGFPAR.CODVEND
    dataset.customers[1] = mk(9002, { active: false }); // TGFPAR.ATIVO = 'N'
    dataset.customers[2] = { ...mk(9003), sourceAttributes: { CLIENTE: 'N' } }; // no longer a customer
    const run = await service().run('customers');
    expect(run.stats).toMatchObject({ read: 2, updated: 1, deactivated: 2 });
    expect(await ofSeller(103)).toEqual([9004]);
    expect(await ofSeller(104)).toEqual([9001]);
    // Rows are kept (audit/history), never hard-deleted.
    expect(await live('select code from erp_customer')).toEqual([9001, 9002, 9003, 9004]);
    expect(await live('select code from erp_customer where deleted_at is not null')).toEqual([9002, 9003]);

    dataset.customers[1] = mk(9002); // active again
    const back = await service().run('customers');
    expect(back.stats).toMatchObject({ reactivated: 1 });
    expect(await ofSeller(103)).toEqual([9002, 9004]);
    void database;
  });
});

describe('sync acceptance: products leave the catalog in the same sync', () => {
  const usage = 'X';
  const scope = (): ReadScope => ({
    products: { usageValues: [usage], activeOnly: true, mobilitySourceField: 'AD_MOBILIDADE', mobilityAllowedValues: ['S'] },
  });

  it('lost AD_MOBILIDADE, inactive and usage no longer sellable are deactivated together; the others stay', async () => {
    const dataset = datasetCopy();
    const base = dataset.products[0]!;
    const mk = (code: number, over: Partial<typeof base> = {}) => ({ ...base, code, active: true, usageCode: usage, mobilityCode: 'S', ...over });
    dataset.products = [mk(9101), mk(9102), mk(9103), mk(9104), mk(9105)];
    const { service, live } = await setup(dataset, scope);
    const visible = () => live('select code from erp_product where deleted_at is null');

    expect((await service().run('products')).stats).toMatchObject({ read: 5, created: 5 });
    dataset.products[0] = mk(9101, { mobilityCode: 'N' }); // AD_MOBILIDADE turned off
    dataset.products[1] = mk(9102, { active: false }); // TGFPRO.ATIVO = 'N'
    dataset.products[2] = mk(9103, { usageCode: 'Z' }); // USOPROD no longer sellable
    const run = await service().run('products');
    expect(run.stats).toMatchObject({ read: 2, deactivated: 3 });
    expect(await visible()).toEqual([9104, 9105]);
    expect(await live('select code from erp_product')).toEqual([9101, 9102, 9103, 9104, 9105]);

    dataset.products[0] = mk(9101); // mobility back on: the product returns
    expect((await service().run('products')).stats).toMatchObject({ reactivated: 1 });
    expect(await visible()).toEqual([9101, 9104, 9105]);
  });

  it('mobility guard: when AD_MOBILIDADE would leave ZERO products the previous catalog is kept (nothing deactivated)', async () => {
    const dataset = datasetCopy();
    const base = dataset.products[0]!;
    const mk = (code: number, over: Partial<typeof base> = {}) => ({ ...base, code, active: true, usageCode: usage, mobilityCode: 'S', ...over });
    dataset.products = [mk(9201), mk(9202)];
    const { service, live } = await setup(dataset, scope);
    await service().run('products');
    dataset.products = [mk(9201, { mobilityCode: null }), mk(9202, { mobilityCode: null })]; // IT cleared the field everywhere
    const run = await service().run('products');
    expect(run.mobility).toMatchObject({ visible: 0, keptPrevious: true });
    expect(run.stats?.deactivated).toBe(0);
    expect(await live('select code from erp_product where deleted_at is null')).toEqual([9201, 9202]);
  });
});

describe('sync acceptance: prices leave the mirror in the same sync', () => {
  it('a product that loses its TGFEXC price row has that price deactivated; a table leaving the scope takes its prices along', async () => {
    const dataset = datasetCopy();
    // Two price tables that have prices.
    const withPrices = [...new Set(dataset.priceTableVersions.filter((v) => dataset.listPrices.some((p) => p.versionId === v.versionId)).map((v) => v.tableCode))];
    expect(withPrices.length).toBeGreaterThanOrEqual(2);
    const [t1, t2] = withPrices as [number, number];
    let tables: number[] = [t1];
    const { service, live } = await setup(dataset, () => ({ priceTableCodes: tables }));
    const run = async () => {
      await service().run('priceTableVersions');
      return service().run('listPrices');
    };
    const livePrices = async () =>
      (await live(`select product_code as code from erp_list_price where deleted_at is null`)).length;

    await service().run('priceTables');
    const first = await run();
    const total = first.stats!.read;
    expect(total).toBeGreaterThan(1);
    expect(await livePrices()).toBe(total);

    // "Sem preço": the price row of one product disappears from TGFEXC.
    const effective = (await service().run('listPrices')) && (await live('select version_id as code from erp_list_price where deleted_at is null'));
    const victim = dataset.listPrices.find((p) => p.versionId === effective[0])!;
    dataset.listPrices = dataset.listPrices.filter((p) => p !== victim);
    const lost = await run();
    expect(lost.stats).toMatchObject({ read: total - 1, deactivated: 1 });
    expect(await livePrices()).toBe(total - 1);

    // The whole table leaves pricing.mobilePriceTableCodes: its prices go in the same sync.
    tables = [t2];
    const moved = await run();
    expect(moved.stats!.deactivated).toBe(total - 1);
    expect(await live(`select 1 as code from erp_list_price l join erp_price_table_version v on v.version_id = l.version_id where l.deleted_at is null and v.table_code = ${t1}`)).toEqual([]);
  });
});
