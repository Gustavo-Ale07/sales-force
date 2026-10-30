import { randomUUID } from 'node:crypto';
import { salesOrderItem } from '@salesforce/db';
import { computeLineTotal, sumTotals } from '@salesforce/domain';
import { getDemoDataset } from '@salesforce/sankhya';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startCommercialApp, type CommercialApp, type Json } from '../helpers/commercial-app.js';
import { startPostgres, type TestPostgres, closeAllThenStop } from '../helpers/postgres.js';

/**
 * P4: DECQTD = 4 in the ERP products, so quantities are decimals with up to four places (packs of 0.2, boxes of 1.0).
 * End to end on the server: validated, stored in numeric(14,4), returned canonical, totals exact.
 */
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
  products = (await app.call('manager', 'GET', `/products?customerCode=${customerCode}&pageSize=20&sellable=true&priceState=priced`)).body.items;
  if (products.length < 5) throw new Error('fixture lacks products');
});

afterAll(async () => {
  await closeAllThenStop(opened, postgres);
});

const QUANTITIES = ['0.2', '0.4', '1.2', '10', '0.0001'];

const body = (quantities: readonly string[]) => ({
  clientRequestId: randomUUID(),
  customerCode,
  negotiationTypeCode: 2,
  notes: null,
  items: quantities.map((quantity, index) => ({ productCode: products[index]?.code, quantity })),
});

describe('decimal quantities (P4)', () => {
  it('stores and returns 0.2, 0.4, 1.2, 10 and 0.0001 exactly, with exact line and order totals', async () => {
    const created = await app.call('seller1', 'POST', '/orders', body(QUANTITIES));
    expect(created.status).toBe(201);
    expect(created.body.items.map((i: Json) => i.quantity)).toEqual(QUANTITIES);

    const lineTotals = created.body.items.map((item: Json, index: number) =>
      computeLineTotal(QUANTITIES[index] as string, item.unitListPrice as string),
    );
    expect(created.body.items.map((i: Json) => i.estimatedLineTotal)).toEqual(lineTotals);
    expect(created.body.estimatedTotal).toBe(sumTotals(lineTotals));

    const rows = await app.database.handle.db.select().from(salesOrderItem).where(eq(salesOrderItem.orderId, created.body.id));
    expect(rows.map((r) => Number(r.quantity))).toEqual([0.2, 0.4, 1.2, 10, 0.0001]);

    const read = await app.call('seller1', 'GET', `/orders/${created.body.id}`);
    expect(read.body.items.map((i: Json) => i.quantity)).toEqual(QUANTITIES);
  });

  it('is replay-safe with an equivalent spelling of the same decimal (0.20 = 0.2)', async () => {
    const first = body(['0.2']);
    const created = await app.call('seller1', 'POST', '/orders', first);
    const replay = await app.call('seller1', 'POST', '/orders', { ...first, items: [{ ...first.items[0], quantity: '0.20' }] });
    expect(replay.status).toBe(200);
    expect(replay.body.id).toBe(created.body.id);
  });

  it('refuses a fifth decimal, zero and a comma', async () => {
    for (const quantity of ['0.00001', '0', '0,2', '-1']) {
      expect((await app.call('seller1', 'POST', '/orders', body([quantity]))).status).toBe(400);
    }
  });
});
