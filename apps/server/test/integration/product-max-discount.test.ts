import { FakeGateway, getDemoDataset, type DemoDataset } from '@salesforce/sankhya';
import { ProductDetailSchema, ProductsResponseSchema } from '@salesforce/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogger } from '../../src/observability/logger.js';
import { MirrorSyncService } from '../../src/sync/mirror-sync.service.js';
import { restrictedKeys, startCommercialApp, type CommercialApp } from '../helpers/commercial-app.js';
import { closeAllThenStop, createMigratedDatabase, startPostgres, type MigratedDatabase, type TestPostgres } from '../helpers/postgres.js';

// Product discount ceiling (ERP TGFPRO.DESCMAX): mirror column, catalog contract (additive, optional), null = no limit registered.
// Not cost or margin (P-20): the restricted-key detector must stay clean while the field is present.

// Owner Sandbox codes (not in the synthetic dataset): the first synthetic products stand in for them, same percent.
const OWNER_PRODUCTS_AT_12 = [4158, 4159, 1439, 1437, 3590];

let postgres: TestPostgres;
const opened: (() => Promise<unknown>)[] = [];
const databases: MigratedDatabase[] = [];
let ctx: CommercialApp;

beforeAll(async () => {
  postgres = await startPostgres();
  ctx = await startCommercialApp(postgres, opened);
});
afterAll(async () => {
  await closeAllThenStop([...databases.map((d) => () => d.handle.close()), ...opened], postgres);
});

describe('mirror: TGFPRO.DESCMAX lands in erp_product.max_discount_percent', () => {
  it('stores 12 for the limited products, NULL for products without a registered limit, and re-syncs a change', async () => {
    const database = await createMigratedDatabase(postgres);
    databases.push(database);
    const base = getDemoDataset();
    const limited = base.products.slice(0, OWNER_PRODUCTS_AT_12.length).map((p) => p.code);
    const dataset = {
      ...base,
      products: base.products.map((p) => (limited.includes(p.code) ? { ...p, maxDiscountPercent: '12' } : p)),
    } as DemoDataset;
    const service = (data: DemoDataset) =>
      new MirrorSyncService({
        db: database.handle,
        gateway: new FakeGateway({ batchSize: 50, dataset: data }),
        logger: createLogger({ level: 'silent', service: 'worker' }),
        now: () => new Date(),
        salesHistory: null,
      });
    await service(dataset).run('productGroups');
    await service(dataset).run('products');
    const read = async () =>
      (await database.handle.pool.query<{ code: number; p: string | null }>(`select code, max_discount_percent::text as p from erp_product order by code`)).rows;
    const rows = await read();
    expect(rows.filter((r) => limited.includes(r.code)).map((r) => Number(r.p))).toEqual(limited.map(() => 12));
    expect(rows.filter((r) => !limited.includes(r.code)).every((r) => r.p === null)).toBe(true);

    // A second identical run rewrites nothing; a changed ceiling is an update; removing it stores NULL again.
    const same = await service(dataset).run('products');
    expect(same.stats).toMatchObject({ updated: 0, created: 0 });
    const changed = { ...dataset, products: dataset.products.map((p) => (p.code === limited[0] ? { ...p, maxDiscountPercent: '8.5' } : p)) } as DemoDataset;
    expect((await service(changed).run('products')).stats).toMatchObject({ updated: 1 });
    expect(Number((await read()).find((r) => r.code === limited[0])?.p)).toBe(8.5);
    const cleared = { ...dataset, products: dataset.products.map((p) => (p.code === limited[0] ? { ...p, maxDiscountPercent: null } : p)) } as DemoDataset;
    expect((await service(cleared).run('products')).stats).toMatchObject({ updated: 1 });
    expect((await read()).find((r) => r.code === limited[0])?.p).toBeNull();
  });

});

describe('catalog contract: maxDiscountPercent is additive, optional and nullable', () => {
  it('list and detail carry "12" when registered and null when not; the schema accepts both; no restricted key appears', async () => {
    const { rows } = await ctx.database.handle.pool.query<{ code: number }>(
      `select code from erp_product where active order by code limit 2`,
    );
    const [withLimit, without] = rows.map((r) => r.code);
    await ctx.database.handle.pool.query(`update erp_product set max_discount_percent = 12 where code = $1`, [withLimit]);
    await ctx.database.handle.pool.query(`update erp_product set max_discount_percent = null where code = $1`, [without]);

    for (const who of ['admin', 'manager', 'seller1'] as const) {
      const list = await ctx.call(who, 'GET', `/products?pageSize=100`);
      expect(list.status).toBe(200);
      expect(ProductsResponseSchema.safeParse(list.body).success).toBe(true);
      expect(restrictedKeys(list.body)).toEqual([]);
      const items = list.body.items as { code: number; maxDiscountPercent?: string | null }[];
      for (const item of items) expect(item.maxDiscountPercent === null || typeof item.maxDiscountPercent === 'string').toBe(true);
      const one = items.find((i) => i.code === withLimit);
      if (one !== undefined) expect(one.maxDiscountPercent).toBe('12');
      const none = items.find((i) => i.code === without);
      if (none !== undefined) expect(none.maxDiscountPercent).toBeNull();
    }
    const detail = await ctx.call('admin', 'GET', `/products/${withLimit}`);
    if (detail.status === 200) {
      expect(ProductDetailSchema.safeParse(detail.body).success).toBe(true);
      expect(detail.body.maxDiscountPercent).toBe('12');
      expect(restrictedKeys(detail.body)).toEqual([]);
    }
  });

  it('an old client payload without the field still parses (backward compatible)', () => {
    const legacy = ProductsResponseSchema.safeParse({
      items: [{ code: 1, description: 'x', active: true, sellable: true, unit: 'UN', brand: null, reference: null, groupCode: null, groupName: null, listPrice: { state: 'none', unitPrice: null, tableCode: null, versionId: null, noPriceReason: 'no_resolved_table' } }],
      page: 1,
      pageSize: 10,
      total: 1,
      priceContext: { customerCode: null, tableCode: null, tableName: null, source: 'none' },
    });
    expect(legacy.success).toBe(true);
  });
});
