import { auditLog } from '@salesforce/db';
import { getDemoDataset } from '@salesforce/sankhya';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startCommercialApp, type CommercialApp } from '../helpers/commercial-app.js';
import { closeAllThenStop, startPostgres, type TestPostgres } from '../helpers/postgres.js';

/** Force own configuration (owner ruling 2026-11-27): settings and per-seller discount rules, management only, audited. */
const dataset = getDemoDataset();
const SELLER = 103;
const PRODUCT = dataset.products[0]!.code;
const TABLE = dataset.priceTables[0]!.code;

let postgres: TestPostgres;
const opened: (() => Promise<unknown>)[] = [];
let ctx: CommercialApp;

beforeAll(async () => {
  postgres = await startPostgres();
  ctx = await startCommercialApp(postgres, opened);
});

afterAll(async () => {
  await closeAllThenStop(opened, postgres);
});

describe('GET/PUT /force-config', () => {
  it('starts with the seeded values and is closed to sellers', async () => {
    const got = await ctx.call('manager', 'GET', '/force-config');
    expect(got.status).toBe(200);
    expect(got.body).toMatchObject({ maxDaysWithoutSync: 7, defaultPriceTableCode: 5 });
    expect((await ctx.call('seller1', 'GET', '/force-config')).status).toBe(403);
    expect((await ctx.call('seller1', 'PUT', '/force-config', { maxDaysWithoutSync: 3, defaultPriceTableCode: TABLE })).status).toBe(403);
  });

  it('validates the range and the price table, then saves and audits', async () => {
    expect((await ctx.call('admin', 'PUT', '/force-config', { maxDaysWithoutSync: 0, defaultPriceTableCode: TABLE })).status).toBe(400);
    expect((await ctx.call('admin', 'PUT', '/force-config', { maxDaysWithoutSync: 61, defaultPriceTableCode: TABLE })).status).toBe(400);
    expect((await ctx.call('admin', 'PUT', '/force-config', { maxDaysWithoutSync: 5, defaultPriceTableCode: 987654 })).status).toBe(400);
    const saved = await ctx.call('manager', 'PUT', '/force-config', { maxDaysWithoutSync: 5, defaultPriceTableCode: TABLE });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ maxDaysWithoutSync: 5, defaultPriceTableCode: TABLE });
    const rows = await ctx.database.handle.db.select().from(auditLog).where(eq(auditLog.action, 'config.force_changed'));
    expect(rows.at(-1)?.detail).toMatchObject({ maxDaysWithoutSync: 5, previousMaxDaysWithoutSync: 7 });
  });
});

describe('/seller-discount-rules', () => {
  let ruleId = '';

  it('is closed to sellers', async () => {
    expect((await ctx.call('seller1', 'GET', '/seller-discount-rules')).status).toBe(403);
    expect((await ctx.call('seller1', 'POST', '/seller-discount-rules', { sellerCode: SELLER, targetKind: 'none', targetCode: null, maxPercent: '5' })).status).toBe(403);
  });

  it('creates, refuses a duplicate and a bad target, lists, edits and deletes with audit', async () => {
    const created = await ctx.call('manager', 'POST', '/seller-discount-rules', { sellerCode: SELLER, targetKind: 'product', targetCode: PRODUCT, maxPercent: '7.5' });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ sellerCode: SELLER, targetKind: 'product', targetCode: PRODUCT, maxPercent: '7.5' });
    ruleId = created.body.id as string;

    expect((await ctx.call('manager', 'POST', '/seller-discount-rules', { sellerCode: SELLER, targetKind: 'product', targetCode: PRODUCT, maxPercent: '1' })).status).toBe(409);
    expect((await ctx.call('manager', 'POST', '/seller-discount-rules', { sellerCode: SELLER, targetKind: 'product', targetCode: 987654321, maxPercent: '1' })).status).toBe(400);
    expect((await ctx.call('manager', 'POST', '/seller-discount-rules', { sellerCode: 987654, targetKind: 'none', targetCode: null, maxPercent: '1' })).status).toBe(400);
    expect((await ctx.call('manager', 'POST', '/seller-discount-rules', { sellerCode: SELLER, targetKind: 'none', targetCode: 3, maxPercent: '1' })).status).toBe(400);
    expect((await ctx.call('manager', 'POST', '/seller-discount-rules', { sellerCode: SELLER, targetKind: 'none', targetCode: null, maxPercent: '100.5' })).status).toBe(400);

    const general = await ctx.call('admin', 'POST', '/seller-discount-rules', { sellerCode: SELLER, targetKind: 'none', targetCode: null, maxPercent: '0' });
    expect(general.status).toBe(201);

    const list = await ctx.call('manager', 'GET', `/seller-discount-rules?sellerCode=${SELLER}`);
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(2);

    const edited = await ctx.call('manager', 'PUT', `/seller-discount-rules/${ruleId}`, { maxPercent: '9' });
    expect(edited.status).toBe(200);
    expect(edited.body.maxPercent).toBe('9');

    const mine = await ctx.call('seller1', 'GET', '/discount-limits/mine');
    expect(mine.body.rules).toEqual(expect.arrayContaining([{ kind: 'general', code: null, percent: '0' }, { kind: 'product', code: PRODUCT, percent: '9' }]));

    expect((await ctx.call('manager', 'DELETE', `/seller-discount-rules/${ruleId}`)).status).toBe(204);
    expect((await ctx.call('manager', 'DELETE', `/seller-discount-rules/${ruleId}`)).status).toBe(404);
    const rows = await ctx.database.handle.db.select().from(auditLog).where(eq(auditLog.action, 'config.seller_discount_rule_changed'));
    expect(rows.map((r) => (r.detail as { change: string }).change)).toEqual(expect.arrayContaining(['created', 'updated', 'deleted']));
  });
});

describe('default price table of a new customer', () => {
  it('GET /customer-price-tables reports the configured default', async () => {
    const res = await ctx.call('seller1', 'GET', '/customer-price-tables');
    expect(res.status).toBe(200);
    expect(res.body.defaultCode).toBe(TABLE);
  });
});
