import { randomUUID } from 'node:crypto';
import { erpCustomer, salesOrder } from '@salesforce/db';
import { getDemoDataset } from '@salesforce/sankhya';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startCommercialApp, type CommercialApp, type Json } from '../helpers/commercial-app.js';
import { startPostgres, type TestPostgres, closeAllThenStop } from '../helpers/postgres.js';

/**
 * F4: a draft needs a customer with a valid seller (`customer_without_seller`, 409); nobody chooses a
 * seller on the order. F5: replacing a draft never mixes dataset origins (fake vs sankhya).
 */

const dataset = getDemoDataset();
let postgres: TestPostgres;
const opened: (() => Promise<unknown>)[] = [];
let ctx: CommercialApp;
let orphan: number;
let normal: number;
let items: { productCode: unknown; quantity: string }[];

beforeAll(async () => {
  postgres = await startPostgres();
  ctx = await startCommercialApp(postgres, opened);
  const candidates = dataset.customers.filter((c) => c.sellerCode === 103 && c.active && !c.blocked && c.priceTableCode === 21);
  const first = candidates[0];
  const second = candidates[1];
  if (first === undefined || second === undefined) throw new Error('fixture lacks customers');
  normal = first.code;
  orphan = second.code;
  const list: Json[] = (await ctx.call('manager', 'GET', `/products?customerCode=${normal}&pageSize=100&sellable=true&priceState=priced`)).body.items;
  items = list.slice(0, 2).map((p) => ({ productCode: p.code, quantity: '1' }));
});
afterAll(async () => {
  await closeAllThenStop(opened, postgres);
});

const body = (customerCode: number) => ({ clientRequestId: randomUUID(), customerCode, negotiationTypeCode: null, notes: null, items });

describe('F4: customer without a valid seller', () => {
  for (const seller of [0, null] as const) {
    it(`create is refused (409 customer_without_seller) when the mirror seller is ${String(seller)}`, async () => {
      await ctx.database.handle.db.update(erpCustomer).set({ sellerCode: seller }).where(eq(erpCustomer.code, orphan));
      const response = await ctx.call('manager', 'POST', '/orders', body(orphan));
      expect(response.status).toBe(409);
      expect(response.body.code).toBe('customer_without_seller');
    });
  }

  it('replace is refused the same way, leaving the draft untouched', async () => {
    const created = await ctx.call('manager', 'POST', '/orders', body(normal));
    expect(created.status).toBe(201);
    await ctx.database.handle.db.update(erpCustomer).set({ sellerCode: 0 }).where(eq(erpCustomer.code, orphan));
    const response = await ctx.call('manager', 'PUT', `/orders/${created.body.id}`, {
      customerCode: orphan,
      negotiationTypeCode: null,
      notes: null,
      items,
      expectedVersion: created.body.version,
    });
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('customer_without_seller');
    const after = await ctx.call('manager', 'GET', `/orders/${created.body.id}`);
    expect(after.body.version).toBe(created.body.version);
    expect(after.body.customerCode).toBe(normal);
  });
});

describe('F5: replace keeps the dataset origin consistent with the configuration source', () => {
  it('refuses to replace a sankhya-origin draft under a non-Sankhya configuration (409 dataset_mismatch)', async () => {
    const created = await ctx.call('manager', 'POST', '/orders', body(normal));
    expect(created.status).toBe(201);
    const db = ctx.database.handle.db;
    // The stamp is immutable by trigger; the test forges it the only way possible: with the trigger off.
    await db.execute(sql`alter table sales_order disable trigger sales_order_binding_immutable_trg`);
    try {
      await db.update(salesOrder).set({ datasetOrigin: 'sankhya' }).where(eq(salesOrder.id, created.body.id));
    } finally {
      await db.execute(sql`alter table sales_order enable trigger sales_order_binding_immutable_trg`);
    }
    const response = await ctx.call('manager', 'PUT', `/orders/${created.body.id}`, {
      customerCode: normal,
      negotiationTypeCode: null,
      notes: null,
      items,
      expectedVersion: created.body.version,
    });
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('dataset_mismatch');
  });

  it('a fake draft is still replaceable under the (fake) demo configuration', async () => {
    const created = await ctx.call('manager', 'POST', '/orders', body(normal));
    const response = await ctx.call('manager', 'PUT', `/orders/${created.body.id}`, {
      customerCode: normal,
      negotiationTypeCode: null,
      notes: 'ok',
      items,
      expectedVersion: created.body.version,
    });
    expect(response.status).toBe(200);
  });
});
