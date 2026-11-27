import { randomUUID } from 'node:crypto';
import { auditLog, erpProductGroup, sellerDiscountRule } from '@salesforce/db';
import { MyDiscountLimitsResponseSchema } from '@salesforce/contracts';
import { getDemoDataset } from '@salesforce/sankhya';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startCommercialApp, type CommercialApp } from '../helpers/commercial-app.js';
import { closeAllThenStop, startPostgres, type TestPostgres } from '../helpers/postgres.js';

/** Per-seller discount limits kept in the Force database (owner ruling 2026-11-27): rules managed on the site, scope of the seller's own rules. */
const dataset = getDemoDataset();
const SELLER_1 = 103;
const SELLER_2 = 107;
const PRODUCT = dataset.products[0]!.code;
const GROUP = dataset.productGroups[0]!.code;

let postgres: TestPostgres;
const opened: (() => Promise<unknown>)[] = [];
let ctx: CommercialApp;

beforeAll(async () => {
  postgres = await startPostgres();
  ctx = await startCommercialApp(postgres, opened);
  const row = (code: number, name: string, parentCode: number | null) => ({ code, name, parentCode, degree: 1, analytic: parentCode !== null, active: true, contentHash: `h${code}`, syncedAt: new Date("2026-11-26T00:00:00.000Z") });
  await ctx.database.handle.db.insert(erpProductGroup).values([row(9001, "Pai", null), row(GROUP, "Filho", 9001)]);
});

afterAll(async () => {
  await closeAllThenStop(opened, postgres);
});

const NOW = new Date('2026-11-26T00:00:00.000Z');
const rule = (sellerCode: number, targetKind: string, targetCode: number | null, maxPercent: string) => ({
  id: randomUUID(), sellerCode, targetKind, targetCode, maxPercent, createdAt: NOW, updatedAt: NOW,
});

describe('seller discount limits read from the Force rules', () => {
  it('the old per-seller management routes stay absent (404)', async () => {
    expect((await ctx.call('manager', 'GET', '/seller-discount-limits?sellerCode=103')).status).toBe(404);
  });

  it('a seller with no rule has none', async () => {
    const mine = await ctx.call('seller1', 'GET', '/discount-limits/mine');
    expect(mine.status).toBe(200);
    expect(MyDiscountLimitsResponseSchema.safeParse(mine.body).success).toBe(true);
    expect(mine.body).toEqual({ sellerCode: SELLER_1, rules: [] });
  });

  it("a seller receives only its own rules (none maps to general), never another seller's", async () => {
    const db = ctx.database.handle.db;
    await db.insert(sellerDiscountRule).values([
      rule(SELLER_1, 'none', null, '9.5'),
      rule(SELLER_1, 'product', PRODUCT, '3'),
      rule(SELLER_1, 'subgroup', GROUP, '6'),
      rule(SELLER_2, 'none', null, '2'),
      rule(SELLER_2, 'group', 9001, '4'),
    ]);
    const mine = await ctx.call('seller1', 'GET', '/discount-limits/mine');
    expect(mine.body.sellerCode).toBe(SELLER_1);
    expect(mine.body.rules).toEqual(expect.arrayContaining([
      { kind: 'general', code: null, percent: '9.5' },
      { kind: 'product', code: PRODUCT, percent: '3' },
      { kind: 'subgroup', code: GROUP, percent: '6' },
    ]));
    expect(mine.body.rules).toHaveLength(3);
    const other = await ctx.call('seller2', 'GET', '/discount-limits/mine');
    expect(other.body.rules).toHaveLength(2);
    expect((await ctx.call('manager', 'GET', '/discount-limits/mine')).body.rules).toEqual([]);
  });

  it('a deleted rule stops applying', async () => {
    const db = ctx.database.handle.db;
    await db.delete(sellerDiscountRule).where(eq(sellerDiscountRule.targetKind, 'product'));
    const mine = await ctx.call('seller1', 'GET', '/discount-limits/mine');
    expect(mine.body.rules).toHaveLength(2);
  });
});

describe('order submit follows the resolved limit (P-08)', () => {
  it('audits a line above the seller limit without blocking the send', async () => {
    const customer = dataset.customers.find((c) => c.sellerCode === SELLER_1 && c.active && !c.blocked && c.priceTableCode === 21)!.code;
    const priced = (await ctx.call('manager', 'GET', `/products?customerCode=${customer}&pageSize=5&sellable=true&priceState=priced`)).body.items;
    await ctx.database.handle.db.delete(sellerDiscountRule).where(eq(sellerDiscountRule.sellerCode, SELLER_1));
    await ctx.database.handle.db.insert(sellerDiscountRule).values(rule(SELLER_1, 'none', null, '1'));
    const created = await ctx.call('seller1', 'POST', '/orders', {
      clientRequestId: randomUUID(),
      customerCode: customer,
      negotiationTypeCode: 2,
      notes: null,
      items: [{ productCode: priced[0].code, quantity: '2', discountPercent: '50' }],
    });
    expect(created.status).toBe(201);
    await ctx.call('seller1', 'POST', `/orders/${created.body.id}/submit`);
    const rows = await ctx.database.handle.db.select().from(auditLog).where(eq(auditLog.action, 'order.submit_discount_above_limit'));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((row) => (row.detail as { exceededLines: number }).exceededLines === 1)).toBe(true);
  });
});
