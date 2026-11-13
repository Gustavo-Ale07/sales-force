import { randomUUID } from 'node:crypto';
import type { InstallationConfiguration } from '@salesforce/domain';
import { DEMO_CONFIGURATION, getDemoDataset } from '@salesforce/sankhya';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startCommercialApp, type CommercialApp, type Json } from '../helpers/commercial-app.js';
import { storeConfiguration } from '../helpers/commercial-fixture.js';
import { closeAllThenStop, startPostgres, type TestPostgres } from '../helpers/postgres.js';

/**
 * Security review MEDIUM-2 (P-08): the TOP and the negotiation type stored on a draft are revalidated against the CURRENT
 * configuration when it is sent. A refused send never changes the draft.
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
  ctx = await startCommercialApp(postgres, opened, { configuration: base });
  const c = dataset.customers.find((x) => x.sellerCode === 103 && x.active && !x.blocked && x.priceTableCode === 21);
  if (c === undefined) throw new Error('fixture lacks an orderable customer');
  customer = c.code;
  const items = (await ctx.call('manager', 'GET', `/products?customerCode=${customer}&pageSize=5&sellable=true`)).body.items as Json[];
  product = items[0]!.code;
});
afterAll(async () => {
  await closeAllThenStop(opened, postgres);
});

let tick = 0;
async function reconfigure(sales: Partial<InstallationConfiguration['sales']>): Promise<void> {
  tick += 1;
  await storeConfiguration(ctx.database.handle, { ...base, sales: { ...base.sales, ...sales } }, new Date(Date.UTC(2026, 10, 13, 12, tick)));
}
const draft = (negotiationTypeCode: number) =>
  ctx.call('seller1', 'POST', '/orders', {
    clientRequestId: randomUUID(),
    customerCode: customer,
    negotiationTypeCode,
    notes: null,
    items: [{ productCode: product, quantity: '1' }],
  });
const issuesOf = (response: { body: Json }): { code: string; path: string }[] => response.body.details?.issues ?? [];

describe('submit revalidates the stored TOP and negotiation type', () => {
  it('a TOP that left eligibleOrderTopCodes refuses the send and leaves the draft untouched', async () => {
    const created = await draft(2);
    expect(created.status).toBe(201);
    expect(created.body.topCode).toBe(1001);
    await reconfigure({ orderTopCode: 1002, eligibleOrderTopCodes: [1002, 1000] });
    const submit = await ctx.call('seller1', 'POST', `/orders/${created.body.id}/submit`);
    expect(submit.status).toBe(400);
    expect(submit.body.code).toBe('validation_failed');
    expect(issuesOf(submit)).toEqual([{ code: 'order_top_not_eligible', path: 'topCode' }]);
    const after = await ctx.call('seller1', 'GET', `/orders/${created.body.id}`);
    expect(after.body.status).toBe('draft');
    expect(after.body.topCode).toBe(1001);
    expect(after.body.version).toBe(created.body.version);
    await reconfigure({});
  });

  it('a negotiation type that is no longer sellable refuses the send and leaves the draft untouched', async () => {
    const created = await draft(2);
    expect(created.status).toBe(201);
    await reconfigure({ negotiationTypes: [{ code: 3, label: 'A PRAZO' }] });
    const submit = await ctx.call('seller1', 'POST', `/orders/${created.body.id}/submit`);
    expect(submit.status).toBe(400);
    expect(issuesOf(submit)).toEqual([{ code: 'negotiation_type_not_configured', path: 'negotiationTypeCode' }]);
    const after = await ctx.call('seller1', 'GET', `/orders/${created.body.id}`);
    expect(after.body.status).toBe('draft');
    expect(after.body.negotiationTypeCode).toBe(2);
    await reconfigure({});
  });

  it('with the TOP and the type still configured the send passes this check', async () => {
    const created = await draft(3);
    const submit = await ctx.call('seller1', 'POST', `/orders/${created.body.id}/submit`);
    expect(submit.body.code).not.toBe('validation_failed');
  });
});
