import { randomUUID } from 'node:crypto';
import { OrdersResponseSchema } from '@salesforce/contracts';
import { salesOrder, salesOrderErpStage } from '@salesforce/db';
import { getDemoDataset } from '@salesforce/sankhya';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startCommercialApp, type CommercialApp, type Json } from '../helpers/commercial-app.js';
import { closeAllThenStop, startPostgres, type TestPostgres } from '../helpers/postgres.js';

/**
 * `GET /orders?stage=` (owner ruling 2026-11-23): the stage filter uses the same classification as the `erpStage` chip. Mirror
 * stages (worker-written `sales_order_erp_stage`) match the stored stage; `sent_to_force` / `send_error` are derived from a
 * queued / rejected order with no stored stage and no ERP number. Scope is unchanged and `total` counts the filter.
 */
const dataset = getDemoDataset();
let postgres: TestPostgres;
const opened: (() => Promise<unknown>)[] = [];
let ctx: CommercialApp;
const ids: Record<string, string> = {};

beforeAll(async () => {
  postgres = await startPostgres();
  ctx = await startCommercialApp(postgres, opened);
  const customerOf = (seller: number) => dataset.customers.find((c) => c.sellerCode === seller && c.active && !c.blocked && c.priceTableCode === 21)!.code;
  const customer1 = customerOf(103);
  const customer2 = customerOf(107);
  const products = (await ctx.call('manager', 'GET', `/products?customerCode=${customer1}&pageSize=5&sellable=true`)).body.items as Json[];
  const make = async (key: string, who: 'seller1' | 'seller2', customerCode: number): Promise<void> => {
    const created = await ctx.call(who, 'POST', '/orders', {
      clientRequestId: randomUUID(),
      customerCode,
      negotiationTypeCode: 2,
      notes: null,
      items: [{ productCode: products[0]!.code, quantity: '1' }],
    });
    expect(created.status).toBe(201);
    ids[key] = created.body.id as string;
  };
  await make('draft', 'seller1', customer1);
  await make('queued', 'seller1', customer1);
  await make('rejected', 'seller1', customer1);
  await make('inReview', 'seller1', customer1);
  await make('invoiced', 'seller1', customer1);
  await make('sentUnread', 'seller1', customer1);
  await make('foreignInReview', 'seller2', customer2);

  const { db } = ctx.database.handle;
  // Test only: the demo configuration is not a Sankhya source, so the binding that eligibility needs is stamped here (the trigger guards production updates).
  await db.execute(sql`alter table sales_order disable trigger sales_order_binding_immutable_trg`);
  const now = new Date();
  const sankhya = { datasetOrigin: 'sankhya' as const, erpEnvironment: 'fake' };
  await db.update(salesOrder).set({ status: 'queued', ...sankhya }).where(eq(salesOrder.id, ids.queued!));
  await db.update(salesOrder).set({ status: 'rejected', ...sankhya }).where(eq(salesOrder.id, ids.rejected!));
  await db.update(salesOrder).set({ status: 'sent', erpNumber: 7000, ...sankhya }).where(eq(salesOrder.id, ids.sentUnread!));
  let nunota = 7100;
  const mirror = async (key: string, stage: string, label: string): Promise<void> => {
    nunota += 1;
    await db.update(salesOrder).set({ status: 'sent', erpNumber: nunota, ...sankhya }).where(eq(salesOrder.id, ids[key]!));
    await db.insert(salesOrderErpStage).values({ orderId: ids[key]!, nunota, stage, label, contentHash: `h-${key}`, updatedAt: now, checkedAt: now });
  };
  await mirror('inReview', 'in_review', 'Em revisão');
  await mirror('invoiced', 'invoiced', 'Faturado');
  await mirror('foreignInReview', 'in_review', 'Em revisão');
});
afterAll(async () => {
  await closeAllThenStop(opened, postgres);
});

const list = async (who: 'seller1' | 'seller2' | 'manager' | 'admin', query: string): Promise<{ ids: string[]; total: number }> => {
  const response = await ctx.call(who, 'GET', `/orders?${query}`);
  expect(response.status).toBe(200);
  const parsed = OrdersResponseSchema.parse(response.body);
  return { ids: parsed.items.map((item) => item.id).sort(), total: parsed.total };
};
const sorted = (...keys: string[]): string[] => keys.map((key) => ids[key]!).sort();

describe('GET /orders?stage=', () => {
  it('a mirror stage matches the stored stage, within the caller scope, with a filtered total', async () => {
    expect(await list('seller1', 'stage=in_review')).toEqual({ ids: sorted('inReview'), total: 1 });
    expect(await list('seller1', 'stage=invoiced')).toEqual({ ids: sorted('invoiced'), total: 1 });
    expect(await list('seller2', 'stage=in_review')).toEqual({ ids: sorted('foreignInReview'), total: 1 });
    expect(await list('manager', 'stage=in_review')).toEqual({ ids: sorted('inReview', 'foreignInReview'), total: 2 });
  });

  it('sent_to_force and send_error are derived from the delivery state (no stored stage, no ERP number)', async () => {
    expect(await list('seller1', 'stage=sent_to_force')).toEqual({ ids: sorted('queued'), total: 1 });
    expect(await list('seller1', 'stage=send_error')).toEqual({ ids: sorted('rejected'), total: 1 });
    const item = (await ctx.call('seller1', 'GET', `/orders?ids=${ids.queued}`)).body.items as Json[];
    expect((item[0]!.erpStage as Json).stage).toBe('sent_to_force');
  });

  it('drafts and sent orders never read have no stage and match no stage filter', async () => {
    for (const stage of ['received', 'in_dispatch', 'quotation', 'financial_check', 'in_invoicing']) {
      expect(await list('seller1', `stage=${stage}`)).toEqual({ ids: [], total: 0 });
    }
    const everyStage = await Promise.all(
      ['sent_to_force', 'send_error', 'in_review', 'invoiced'].map(async (stage) => (await list('seller1', `stage=${stage}`)).ids),
    );
    expect(everyStage.flat()).not.toContain(ids.draft);
    expect(everyStage.flat()).not.toContain(ids.sentUnread);
  });

  it('total follows the filter across pages and combines with other filters', async () => {
    const unfiltered = await list('seller1', 'pageSize=100');
    expect(unfiltered.total).toBe(6);
    const paged = (await ctx.call('seller1', 'GET', '/orders?stage=in_review&pageSize=1&page=1')).body;
    expect(paged.total).toBe(1);
    expect((paged.items as Json[]).length).toBe(1);
    expect(await list('seller1', 'stage=in_review&status=sent')).toEqual({ ids: sorted('inReview'), total: 1 });
    expect(await list('seller1', 'stage=in_review&status=draft')).toEqual({ ids: [], total: 0 });
  });

  it('the dashboard names the unsent orders without the word "rascunho"', async () => {
    const response = await ctx.call('seller1', 'GET', '/dashboard');
    expect(response.status).toBe(200);
    const text = JSON.stringify(response.body);
    expect(text).toContain('Não enviados');
    expect(text).toContain('Valor dos pedidos não enviados');
    expect(text.toLowerCase()).not.toContain('rascunho');
  });

  it('an unknown stage code is a 400', async () => {
    expect((await ctx.call('seller1', 'GET', '/orders?stage=banana')).status).toBe(400);
  });
});

describe('GET /orders?group=', () => {
  it('unsent and sent split the list with a correct total and paging, within scope', async () => {
    expect(await list('seller1', 'group=unsent')).toEqual({ ids: sorted('draft', 'queued', 'rejected'), total: 3 });
    expect(await list('seller1', 'group=sent')).toEqual({ ids: sorted('inReview', 'invoiced', 'sentUnread'), total: 3 });
    const paged = (await ctx.call('seller1', 'GET', '/orders?group=unsent&pageSize=2&page=2')).body;
    expect(paged.total).toBe(3);
    expect((paged.items as Json[]).length).toBe(1);
    expect(await list('seller2', 'group=sent')).toEqual({ ids: sorted('foreignInReview'), total: 1 });
    expect(await list('manager', 'group=sent')).toEqual({ ids: sorted('inReview', 'invoiced', 'sentUnread', 'foreignInReview'), total: 4 });
  });

  it('combines with status and stage, and rejects an unknown group', async () => {
    expect(await list('seller1', 'group=unsent&status=queued')).toEqual({ ids: sorted('queued'), total: 1 });
    expect(await list('seller1', 'group=unsent&status=sent')).toEqual({ ids: [], total: 0 });
    expect(await list('seller1', 'group=sent&stage=invoiced')).toEqual({ ids: sorted('invoiced'), total: 1 });
    expect((await ctx.call('seller1', 'GET', '/orders?group=banana')).status).toBe(400);
  });
});
