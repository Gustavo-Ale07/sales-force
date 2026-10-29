import { randomUUID } from 'node:crypto';
import { OrderDetailSchema } from '@salesforce/contracts';
import { auditLog, salesOrder } from '@salesforce/db';
import type { InstallationConfiguration } from '@salesforce/domain';
import { DEMO_CONFIGURATION, getDemoDataset } from '@salesforce/sankhya';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { restrictedKeys, startCommercialApp, type CommercialApp, type Json, type Who } from '../helpers/commercial-app.js';
import { startPostgres, type TestPostgres, closeAllThenStop } from '../helpers/postgres.js';

/**
 * DISC-2: discount authority routing on drafts. Base = the customer's price-table price; seller -> manager ->
 * director; limits come from the installation configuration. The limits below are TEST values only. The absolute
 * ceiling, the substitute approver (R36) and R37 are undecided: nothing here ever becomes "approved".
 */
const dataset = getDemoDataset();
const LIMITS = { seller: '5', manager: '10', director: '20' } as const;

let postgres: TestPostgres;
const opened: (() => Promise<unknown>)[] = [];
let configured: CommercialApp;
let unconfigured: CommercialApp;
let customer1: number;
let priced: Json[];

beforeAll(async () => {
  postgres = await startPostgres();
  const withLimits: InstallationConfiguration = {
    ...DEMO_CONFIGURATION,
    sales: { ...DEMO_CONFIGURATION.sales, discountAuthority: { limits: LIMITS } },
  };
  configured = await startCommercialApp(postgres, opened, { configuration: withLimits });
  unconfigured = await startCommercialApp(postgres, opened);
  const c1 = dataset.customers.find((c) => c.sellerCode === 103 && c.active && !c.blocked && c.priceTableCode === 21);
  if (c1 === undefined) throw new Error('fixture lacks an orderable customer');
  customer1 = c1.code;
  priced = (await configured.call('manager', 'GET', `/products?customerCode=${customer1}&pageSize=100&sellable=true&priceState=priced`)).body.items.slice(0, 3);
  if (priced.length < 2) throw new Error('fixture lacks products');
});

afterAll(async () => {
  await closeAllThenStop(opened, postgres);
});

const body = (discounts: readonly (string | undefined)[], extra: Record<string, unknown> = {}) => ({
  clientRequestId: randomUUID(),
  customerCode: customer1,
  negotiationTypeCode: 2,
  notes: null,
  items: discounts.map((discountPercent, index) => ({
    productCode: priced[index]?.code,
    quantity: '1',
    ...(discountPercent === undefined ? {} : { discountPercent }),
  })),
  ...extra,
});

const statusOf = async (app: CommercialApp, who: Who, discounts: readonly (string | undefined)[], extra: Record<string, unknown> = {}) => {
  const response = await app.call(who, 'POST', '/orders', body(discounts, extra));
  expect(response.status).toBe(201);
  expect(OrderDetailSchema.safeParse(response.body).success).toBe(true);
  expect(restrictedKeys(response.body)).toEqual([]);
  return response.body.discountAuthority as string;
};

describe('discount authority on drafts (DISC-2)', () => {
  it('no discount is within authority, with or without configuration', async () => {
    expect(await statusOf(configured, 'seller1', [undefined, '0'])).toBe('within_authority');
    expect(await statusOf(unconfigured, 'seller1', [undefined])).toBe('within_authority');
  });

  it('seller: routes by the configured limits, boundaries inclusive', async () => {
    expect(await statusOf(configured, 'seller1', ['5'])).toBe('within_authority');
    expect(await statusOf(configured, 'seller1', ['5.01'])).toBe('needs_manager');
    expect(await statusOf(configured, 'seller1', ['10'])).toBe('needs_manager');
    expect(await statusOf(configured, 'seller1', ['10.01'])).toBe('needs_director');
    expect(await statusOf(configured, 'seller1', ['20'])).toBe('needs_director');
  });

  it('the order takes the highest requirement among its lines', async () => {
    expect(await statusOf(configured, 'seller1', ['1', '8'])).toBe('needs_manager');
    expect(await statusOf(configured, 'seller1', ['8', '15'])).toBe('needs_director');
  });

  it('above the director limit (the absolute ceiling, Q13) is blocked, never approved', async () => {
    expect(await statusOf(configured, 'seller1', ['20.01'])).toBe('blocked');
    expect(await statusOf(configured, 'seller1', ['99.99'])).toBe('blocked');
  });

  it('a manager holds the manager range; above it needs the director', async () => {
    expect(await statusOf(configured, 'manager', ['8'])).toBe('within_authority');
    expect(await statusOf(configured, 'manager', ['15'])).toBe('needs_director');
  });

  it('a role outside the chain (admin) cannot hold discount authority: blocked', async () => {
    expect(await statusOf(configured, 'admin', ['1'])).toBe('blocked');
  });

  it('without a stored block the provisional 5/15/30 limits apply (Q11), inclusive, with the 30 ceiling', async () => {
    expect(await statusOf(unconfigured, 'seller1', ['5'])).toBe('within_authority');
    expect(await statusOf(unconfigured, 'seller1', ['15'])).toBe('needs_manager');
    expect(await statusOf(unconfigured, 'seller1', ['30'])).toBe('needs_director');
    expect(await statusOf(unconfigured, 'seller1', ['30.01'])).toBe('blocked');
  });

  it('the client cannot choose the outcome: a sent discountAuthority is refused as an unknown field', async () => {
    const response = await configured.call('seller1', 'POST', '/orders', body(['15'], { discountAuthority: 'within_authority' }));
    expect(response.status).toBe(400);
  });

  it('is persisted, read back by GET and re-evaluated on replace', async () => {
    const created = await configured.call('seller1', 'POST', '/orders', body(['8']));
    expect(created.body.discountAuthority).toBe('needs_manager');
    const [row] = await configured.database.handle.db.select().from(salesOrder).where(eq(salesOrder.id, created.body.id));
    expect(row?.discountAuthority).toBe('needs_manager');
    expect((await configured.call('seller1', 'GET', `/orders/${created.body.id}`)).body.discountAuthority).toBe('needs_manager');

    const replaced = await configured.call('seller1', 'PUT', `/orders/${created.body.id}`, {
      expectedVersion: 1,
      customerCode: customer1,
      negotiationTypeCode: 2,
      notes: null,
      items: [{ productCode: priced[0]?.code, quantity: '1', discountPercent: '2' }],
    });
    expect(replaced.status).toBe(200);
    expect(replaced.body.discountAuthority).toBe('within_authority');
  });

  it('a discount on a missing price stays refused outright (no base)', async () => {
    const none = (await configured.call('manager', 'GET', `/products?customerCode=${customer1}&sellable=true&priceState=none&pageSize=1`)).body.items[0];
    expect(none).toBeDefined();
    const response = await configured.call('seller1', 'POST', '/orders', {
      ...body([]),
      items: [{ productCode: none.code, quantity: '1', discountPercent: '1' }],
    });
    expect(response.status).toBe(400);
  });

  it('the audit trail records the routing, never limits, cost or margin', async () => {
    const created = await configured.call('seller1', 'POST', '/orders', body(['15']));
    const rows = await configured.database.handle.db.select().from(auditLog);
    const entry = rows.find((row) => JSON.stringify(row.detail).includes(created.body.id));
    expect(JSON.stringify(entry?.detail)).toContain('needs_director');
    expect(JSON.stringify(entry?.detail)).not.toMatch(/cost|margin|limit/i);
  });

  it('the limits are not part of any client configuration response', async () => {
    const admin = await configured.call('admin', 'GET', '/configuration');
    expect(admin.status).toBe(200);
    expect(JSON.stringify(admin.body)).not.toContain('discountAuthority');
    const entry = await configured.call('seller1', 'GET', '/order-entry/configuration');
    expect(entry.status).toBe(200);
    expect(JSON.stringify(entry.body)).not.toContain('discountAuthority');
  });
});
