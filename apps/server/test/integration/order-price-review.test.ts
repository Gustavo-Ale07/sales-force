import { randomUUID } from 'node:crypto';
import { OrderDetailSchema, OrderPriceReviewSchema } from '@salesforce/contracts';
import { salesOrderItem } from '@salesforce/db';
import { getDemoDataset } from '@salesforce/sankhya';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startCommercialApp, type CommercialApp, type Json } from '../helpers/commercial-app.js';
import { startPostgres, type TestPostgres, closeAllThenStop } from '../helpers/postgres.js';

/** P-09: changed table prices go through an item-by-item review; the server prices again and never replaces silently. */
const dataset = getDemoDataset();
let postgres: TestPostgres;
const opened: (() => Promise<unknown>)[] = [];
let app: CommercialApp;
let customerCode: number;
let products: Json[];

beforeAll(async () => {
  postgres = await startPostgres();
  app = await startCommercialApp(postgres, opened);
  const c = dataset.customers.find((x) => x.sellerCode === 103 && x.active && !x.blocked && x.priceTableCode === 21);
  if (c === undefined) throw new Error('fixture lacks an orderable customer');
  customerCode = c.code;
  products = (await app.call('manager', 'GET', `/products?customerCode=${customerCode}&pageSize=10&sellable=true&priceState=priced`)).body.items;
});

afterAll(async () => {
  await closeAllThenStop(opened, postgres);
});

async function staleOrder(lines = 2) {
  const created = await app.call('seller1', 'POST', '/orders', {
    clientRequestId: randomUUID(),
    customerCode,
    negotiationTypeCode: 2,
    notes: null,
    items: products.slice(0, lines).map((p) => ({ productCode: p.code, quantity: '2' })),
  });
  expect(created.status).toBe(201);
  // The table moved after the line was priced: the stored price is now stale.
  await app.database.handle.db.update(salesOrderItem).set({ unitListPrice: '0.010000' }).where(eq(salesOrderItem.orderId, created.body.id));
  const detail = await app.call('seller1', 'GET', `/orders/${created.body.id}`);
  return detail.body as Json;
}

describe('order price review', () => {
  it('lists only the lines whose price changed', async () => {
    const order = await staleOrder();
    const review = await app.call('seller1', 'GET', `/orders/${order.id}/price-review`);
    expect(review.status).toBe(200);
    const parsed = OrderPriceReviewSchema.parse(review.body);
    expect(parsed.lines).toHaveLength(2);
    expect(parsed.lines[0]?.previousUnitPrice).toBe('0.01');
    expect(parsed.version).toBe(order.version);
  });

  it('an order with current prices has nothing to review', async () => {
    const created = await app.call('seller1', 'POST', '/orders', {
      clientRequestId: randomUUID(),
      customerCode,
      negotiationTypeCode: 2,
      notes: null,
      items: [{ productCode: products[0].code, quantity: '1' }],
    });
    const review = await app.call('seller1', 'GET', `/orders/${created.body.id}/price-review`);
    expect(OrderPriceReviewSchema.parse(review.body).lines).toEqual([]);
  });

  it('accept reprices the line from the table; refuse removes it', async () => {
    const order = await staleOrder();
    const review = OrderPriceReviewSchema.parse((await app.call('seller1', 'GET', `/orders/${order.id}/price-review`)).body);
    const [first, second] = review.lines;
    const resolved = await app.call('seller1', 'POST', `/orders/${order.id}/price-review`, {
      expectedVersion: review.version,
      decisions: [
        { lineNo: first?.lineNo, decision: 'accept' },
        { lineNo: second?.lineNo, decision: 'refuse' },
      ],
    });
    expect(resolved.status).toBe(200);
    const detail = OrderDetailSchema.parse(resolved.body);
    expect(detail.items).toHaveLength(1);
    expect(detail.items[0]?.unitListPrice).not.toBe('0.01');
    expect(detail.version).toBe(review.version + 1);
  });

  it('every changed line needs a decision', async () => {
    const order = await staleOrder();
    const review = OrderPriceReviewSchema.parse((await app.call('seller1', 'GET', `/orders/${order.id}/price-review`)).body);
    const res = await app.call('seller1', 'POST', `/orders/${order.id}/price-review`, {
      expectedVersion: review.version,
      decisions: [{ lineNo: review.lines[0]?.lineNo, decision: 'accept' }],
    });
    expect(res.status).toBe(400);
  });

  it('refusing every line is rejected (an order needs one item)', async () => {
    const order = await staleOrder();
    const review = OrderPriceReviewSchema.parse((await app.call('seller1', 'GET', `/orders/${order.id}/price-review`)).body);
    const res = await app.call('seller1', 'POST', `/orders/${order.id}/price-review`, {
      expectedVersion: review.version,
      decisions: review.lines.map((line) => ({ lineNo: line.lineNo, decision: 'refuse' })),
    });
    expect(res.status).toBe(400);
  });

  it('a stale version answers version_conflict', async () => {
    const order = await staleOrder();
    const review = OrderPriceReviewSchema.parse((await app.call('seller1', 'GET', `/orders/${order.id}/price-review`)).body);
    const res = await app.call('seller1', 'POST', `/orders/${order.id}/price-review`, {
      expectedVersion: review.version + 5,
      decisions: review.lines.map((line) => ({ lineNo: line.lineNo, decision: 'accept' })),
    });
    expect(res.status).toBe(409);
  });

  it('another seller does not see the order', async () => {
    const order = await staleOrder();
    const res = await app.call('seller2', 'GET', `/orders/${order.id}/price-review`);
    expect(res.status).toBe(404);
  });
});
