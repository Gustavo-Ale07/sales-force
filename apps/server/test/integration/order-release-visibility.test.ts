import { randomUUID } from 'node:crypto';
import { salesOrder } from '@salesforce/db';
import { getDemoDataset } from '@salesforce/sankhya';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startCommercialApp, type CommercialApp, type Json } from '../helpers/commercial-app.js';
import { startPostgres, type TestPostgres, closeAllThenStop } from '../helpers/postgres.js';

/**
 * D-P: the release reason (TSILIB event codes recorded by the status read) is visible in the order detail to the seller
 * who owns the order and to the manager and admin; it is a detail-only addition (the list item stays small).
 */
const dataset = getDemoDataset();
let postgres: TestPostgres;
const opened: (() => Promise<unknown>)[] = [];
let app: CommercialApp;
let orderId: string;
let customerCode: number;
let products: Json[];

beforeAll(async () => {
  postgres = await startPostgres();
  app = await startCommercialApp(postgres, opened);
  const c = dataset.customers.find((x) => x.sellerCode === 103 && x.active && !x.blocked && x.priceTableCode === 21);
  if (c === undefined) throw new Error('fixture lacks an orderable customer');
  customerCode = c.code;
  products = (await app.call('manager', 'GET', `/products?customerCode=${customerCode}&pageSize=10&sellable=true&priceState=priced`)).body.items;
  const created = await app.call('seller1', 'POST', '/orders', {
    clientRequestId: randomUUID(),
    customerCode,
    negotiationTypeCode: 2,
    notes: null,
    items: [{ productCode: products[0].code, quantity: '1' }],
  });
  orderId = created.body.id as string;
  await app.database.handle.db
    .update(salesOrder)
    .set({ erpStatusCode: 3, erpStatusLabel: 'Aguardando liberação', erpStatusCheckedAt: new Date('2026-11-03T12:00:00Z'), erpStatusDetail: '7,12' })
    .where(eq(salesOrder.id, orderId));
});

afterAll(async () => {
  await closeAllThenStop(opened, postgres);
});

describe('release reason visibility (D-P)', () => {
  it.each(['seller1', 'manager', 'admin'] as const)('is shown in the order detail to %s', async (who) => {
    const detail = await app.call(who, 'GET', `/orders/${orderId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.erpStatus.releaseEvents.map((e: { code: number }) => e.code)).toEqual([7, 12]);
  });

  it('is not added to the list item', async () => {
    const list = await app.call('manager', 'GET', '/orders?pageSize=100');
    const item = list.body.items.find((x: { id: string }) => x.id === orderId);
    expect(item.erpStatus.code).toBe(3);
    expect(item.erpStatus.releaseEvents).toBeUndefined();
  });

  it('is not visible to a seller outside the order scope', async () => {
    const other = await app.call('seller2', 'GET', `/orders/${orderId}`);
    expect([403, 404]).toContain(other.status);
    expect(JSON.stringify(other.body)).not.toMatch(/releaseEvents/);
  });
});
