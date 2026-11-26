import { randomUUID } from 'node:crypto';
import { auditLog, erpForceDiscountLimit, erpProductGroup, erpSeller } from '@salesforce/db';
import { MyDiscountLimitsResponseSchema } from '@salesforce/contracts';
import { getDemoDataset } from '@salesforce/sankhya';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startCommercialApp, type CommercialApp } from '../helpers/commercial-app.js';
import { closeAllThenStop, startPostgres, type TestPostgres } from '../helpers/postgres.js';

/** Per-seller discount limits registered inside the ERP (TGFVEN.DESCMAX, AD_FORCELIMDESC): read-only mirror, scope of the seller's own rules. */
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
const erpRule = (seq: number, sellerCode: number, groupCode: number | null, productCode: number | null, percent: string) => ({
  configId: 1, seq, sellerCode, groupCode, productCode, percent, contentHash: `r${seq}`, syncedAt: NOW,
});

describe('seller discount limits read from the ERP mirror', () => {
  it('there are no management routes any more (404): the manager registers the rules inside the ERP', async () => {
    expect((await ctx.call('manager', 'GET', `/seller-discount-limits?sellerCode=${SELLER_1}`)).status).toBe(404);
    expect((await ctx.call('admin', 'PUT', '/seller-discount-limits', { sellerCode: SELLER_1 })).status).toBe(404);
  });

  it('a seller with no rule registered has none', async () => {
    const mine = await ctx.call('seller1', 'GET', '/discount-limits/mine');
    expect(mine.status).toBe(200);
    expect(MyDiscountLimitsResponseSchema.safeParse(mine.body).success).toBe(true);
    expect(mine.body).toEqual({ sellerCode: SELLER_1, rules: [] });
  });

  it("a seller receives only its own rules (general from TGFVEN, group and product from the ERP table), never another seller's", async () => {
    const db = ctx.database.handle.db;
    await db.update(erpSeller).set({ maxDiscountPercent: '9.5000' }).where(eq(erpSeller.code, SELLER_1));
    await db.update(erpSeller).set({ maxDiscountPercent: '2.0000' }).where(eq(erpSeller.code, SELLER_2));
    await db.insert(erpForceDiscountLimit).values([
      erpRule(1, SELLER_1, null, PRODUCT, '3.0000'),
      erpRule(2, SELLER_2, GROUP, null, '4.0000'),
    ]);
    const mine = await ctx.call('seller1', 'GET', '/discount-limits/mine');
    expect(mine.body.sellerCode).toBe(SELLER_1);
    expect(mine.body.rules).toEqual([
      { kind: 'general', code: null, percent: '9.5' },
      { kind: 'product', code: PRODUCT, percent: '3' },
    ]);
    const other = await ctx.call('seller2', 'GET', '/discount-limits/mine');
    expect(other.body.rules).toEqual([
      { kind: 'general', code: null, percent: '2' },
      { kind: 'group', code: GROUP, percent: '4' },
    ]);
    expect((await ctx.call('manager', 'GET', '/discount-limits/mine')).body.rules).toEqual([]);
  });

  it('a rule removed in the ERP (soft-deleted in the mirror) stops applying', async () => {
    const db = ctx.database.handle.db;
    await db.update(erpForceDiscountLimit).set({ deletedAt: NOW }).where(eq(erpForceDiscountLimit.seq, 1));
    const mine = await ctx.call('seller1', 'GET', '/discount-limits/mine');
    expect(mine.body.rules).toEqual([{ kind: 'general', code: null, percent: '9.5' }]);
  });
});

describe('order submit follows the resolved limit (P-08)', () => {
  it('audits a line above the seller limit without blocking the send', async () => {
    const customer = dataset.customers.find((c) => c.sellerCode === SELLER_1 && c.active && !c.blocked && c.priceTableCode === 21)!.code;
    const priced = (await ctx.call('manager', 'GET', `/products?customerCode=${customer}&pageSize=5&sellable=true&priceState=priced`)).body.items;
    await ctx.database.handle.db.update(erpSeller).set({ maxDiscountPercent: '1.0000' }).where(eq(erpSeller.code, SELLER_1));
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
