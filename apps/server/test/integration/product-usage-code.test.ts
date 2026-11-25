import { ProductsResponseSchema } from '@salesforce/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { restrictedKeys, startCommercialApp, type CommercialApp } from '../helpers/commercial-app.js';
import { closeAllThenStop, startPostgres, type TestPostgres } from '../helpers/postgres.js';

// "Uso" of the product (TGFPRO.USOPROD, as mirrored) also travels on the list item, so the app shows the same detail as the site
// without a network call. Additive and optional; not cost or margin (P-20).

let postgres: TestPostgres;
const opened: (() => Promise<unknown>)[] = [];
let ctx: CommercialApp;

beforeAll(async () => {
  postgres = await startPostgres();
  ctx = await startCommercialApp(postgres, opened);
});
afterAll(async () => {
  await closeAllThenStop([...opened], postgres);
});

describe('catalog list: usageCode is additive and nullable', () => {
  it('carries the mirrored usage code (or null) on every list item, for every profile, and the detail agrees', async () => {
    const first = await ctx.call("admin", "GET", `/products?pageSize=100`);
    const [withUsage, without] = (first.body.items as { code: number }[]).map((i) => i.code);
    expect(withUsage).toBeDefined();
    expect(without).toBeDefined();
    await ctx.database.handle.pool.query(`update erp_product set usage_code = 'V' where code = $1`, [withUsage]);
    await ctx.database.handle.pool.query(`update erp_product set usage_code = null where code = $1`, [without]);

    for (const who of ['admin', 'manager', 'seller1'] as const) {
      const list = await ctx.call(who, 'GET', `/products?pageSize=100`);
      expect(list.status).toBe(200);
      expect(ProductsResponseSchema.safeParse(list.body).success).toBe(true);
      expect(restrictedKeys(list.body)).toEqual([]);
      const items = list.body.items as { code: number; usageCode?: string | null }[];
      const one = items.find((i) => i.code === withUsage);
      expect(one?.usageCode).toBe('V');
      const none = items.find((i) => i.code === without);
      expect(none?.usageCode).toBeNull();
    }
    const detail = await ctx.call('admin', 'GET', `/products/${withUsage}`);
    expect(detail.status).toBe(200);
    expect(detail.body.usageCode).toBe('V');
  });

  it('an old payload without the field still parses', () => {
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
