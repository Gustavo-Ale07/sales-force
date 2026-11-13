import { randomUUID } from 'node:crypto';
import { salesOrder } from '@salesforce/db';
import type { InstallationConfiguration } from '@salesforce/domain';
import { DEMO_CONFIGURATION, getDemoDataset } from '@salesforce/sankhya';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startCommercialApp, type CommercialApp, type Json } from '../helpers/commercial-app.js';
import { storeConfiguration } from '../helpers/commercial-fixture.js';
import { closeAllThenStop, startPostgres, type TestPostgres } from '../helpers/postgres.js';

/**
 * Security review LOW (P-08): the TOP and the negotiation type are revalidated again on the LOCKED row, inside the
 * enqueue transaction. A configuration change that lands between the request snapshot and the lock must still refuse
 * the send, with no outbox row and the order left as a draft.
 */
const dataset = getDemoDataset();
let postgres: TestPostgres;
const opened: (() => Promise<unknown>)[] = [];
let ctx: CommercialApp;
let customer: number;
let product: number;

const base: InstallationConfiguration = {
  ...DEMO_CONFIGURATION,
  sales: {
    ...DEMO_CONFIGURATION.sales,
    orderTopCode: 1001,
    quotationTopCode: 1000,
    eligibleOrderTopCodes: [1001, 1000],
    defaultNegotiationTypeCode: null,
    negotiationTypes: [
      { code: 2, label: 'A VISTA' },
      { code: 3, label: 'A PRAZO' },
    ],
  },
};

beforeAll(async () => {
  postgres = await startPostgres();
  ctx = await startCommercialApp(postgres, opened, { configuration: base, orderEnqueueEnabled: true });
  const c = dataset.customers.find((x) => x.sellerCode === 103 && x.active && !x.blocked && x.priceTableCode === 21);
  if (c === undefined) throw new Error('fixture lacks an orderable customer');
  customer = c.code;
  product = ((await ctx.call('manager', 'GET', `/products?customerCode=${customer}&pageSize=5&sellable=true`)).body.items as Json[])[0]!.code;
});
afterAll(async () => {
  await closeAllThenStop(opened, postgres);
});

let tick = 0;
async function reconfigure(sales: Partial<InstallationConfiguration['sales']>): Promise<void> {
  tick += 1;
  await storeConfiguration(ctx.database.handle, { ...base, sales: { ...base.sales, ...sales } }, new Date(Date.UTC(2026, 10, 13, 12, tick)));
}

async function draftBoundToSandbox(): Promise<string> {
  const created = await ctx.call('seller1', 'POST', '/orders', {
    clientRequestId: randomUUID(),
    customerCode: customer,
    negotiationTypeCode: 2,
    freightType: 'FOB',
    carrierCode: dataset.carriers.find((carrier) => carrier.active)?.code,
    notes: null,
    items: [{ productCode: product, quantity: '1' }],
  });
  expect(created.status).toBe(201);
  await ctx.database.handle.db.transaction(async (tx) => {
    await tx.execute(sql`alter table sales_order disable trigger sales_order_binding_immutable_trg`);
    await tx.update(salesOrder).set({ datasetOrigin: 'sankhya', erpEnvironment: 'sandbox' }).where(eq(salesOrder.id, created.body.id));
    await tx.execute(sql`alter table sales_order enable trigger sales_order_binding_immutable_trg`);
  });
  return created.body.id;
}

/** Holds the order row lock, starts the submit (it snapshots the configuration, then waits for the lock), changes the configuration, releases. */
async function submitWithConfigChangeBeforeLock(id: string, change: Partial<InstallationConfiguration['sales']>) {
  const holder = await ctx.database.handle.pool.connect();
  try {
    await holder.query('begin');
    await holder.query('select id from sales_order where id = $1 for update', [id]);
    const pending = ctx.call('seller1', 'POST', `/orders/${id}/submit`);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await reconfigure(change);
    await holder.query('commit');
    return await pending;
  } finally {
    holder.release();
  }
}

describe('enqueue revalidates the TOP and the negotiation type on the locked row', () => {
  it('a TOP removed from the eligible set between the snapshot and the lock refuses the send', async () => {
    const id = await draftBoundToSandbox();
    const submit = await submitWithConfigChangeBeforeLock(id, { orderTopCode: 1002, eligibleOrderTopCodes: [1002, 1000] });
    expect(submit.status).toBe(400);
    expect(submit.body.details.issues).toEqual([{ path: 'topCode', code: 'order_top_not_eligible' }]);
    expect((await ctx.call('seller1', 'GET', `/orders/${id}`)).body.status).toBe('draft');
    await reconfigure({});
  });

  it('a negotiation type removed between the snapshot and the lock refuses the send', async () => {
    const id = await draftBoundToSandbox();
    const submit = await submitWithConfigChangeBeforeLock(id, { negotiationTypes: [{ code: 3, label: 'A PRAZO' }] });
    expect(submit.status).toBe(400);
    expect(submit.body.details.issues).toEqual([{ path: 'negotiationTypeCode', code: 'negotiation_type_not_configured' }]);
    expect((await ctx.call('seller1', 'GET', `/orders/${id}`)).body.status).toBe('draft');
    await reconfigure({});
  });

  it('with nothing changed the same flow enqueues the order (control)', async () => {
    const id = await draftBoundToSandbox();
    const submit = await submitWithConfigChangeBeforeLock(id, {});
    expect(submit.status).toBeLessThan(300);
    expect((await ctx.call('seller1', 'GET', `/orders/${id}`)).body.status).toBe('queued');
  });
});
