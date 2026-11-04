import { randomUUID } from 'node:crypto';
import { salesOrder } from '@salesforce/db';
import type { InstallationConfiguration } from '@salesforce/domain';
import { DEMO_CONFIGURATION, getDemoDataset } from '@salesforce/sankhya';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startCommercialApp, type CommercialApp, type Json } from '../helpers/commercial-app.js';
import { startPostgres, type TestPostgres, closeAllThenStop } from '../helpers/postgres.js';

/**
 * D-O: the ERP "expedição" flag is never a seller input. A new order is born unmarked from `sales.expedicaoDefault`
 * (absent = 'N'), the value is stored on the order and shown read-only only to admin/technical in the order detail.
 */
const dataset = getDemoDataset();
let postgres: TestPostgres;
const opened: (() => Promise<unknown>)[] = [];
let plain: CommercialApp;
let marked: CommercialApp;
let customerCode: number;
let products: Json[];

const withDefault = (expedicaoDefault: 'S' | 'N' | undefined): InstallationConfiguration => ({
  ...DEMO_CONFIGURATION,
  sales: { ...DEMO_CONFIGURATION.sales, ...(expedicaoDefault === undefined ? {} : { expedicaoDefault }) },
});

beforeAll(async () => {
  postgres = await startPostgres();
  plain = await startCommercialApp(postgres, opened, { configuration: withDefault('N') });
  marked = await startCommercialApp(postgres, opened, { configuration: withDefault('S') });
  const c = dataset.customers.find((x) => x.sellerCode === 103 && x.active && !x.blocked && x.priceTableCode === 21);
  if (c === undefined) throw new Error('fixture lacks an orderable customer');
  customerCode = c.code;
  products = (await plain.call('manager', 'GET', `/products?customerCode=${customerCode}&pageSize=10&sellable=true&priceState=priced`)).body.items;
});

afterAll(async () => {
  await closeAllThenStop(opened, postgres);
});

const body = (extra: Record<string, unknown> = {}) => ({
  clientRequestId: randomUUID(),
  customerCode,
  negotiationTypeCode: 2,
  notes: null,
  items: [{ productCode: products[0].code, quantity: '1' }],
  ...extra,
});

async function storedFlag(app: CommercialApp, id: string): Promise<boolean | undefined> {
  const [row] = await app.database.handle.db.select({ expedicao: salesOrder.expedicao }).from(salesOrder).where(eq(salesOrder.id, id));
  return row?.expedicao;
}

describe('order expedição (D-O)', () => {
  it('is born unmarked with the pilot default N and stored on the order', async () => {
    const created = await plain.call('seller1', 'POST', '/orders', body());
    expect(created.status).toBe(201);
    expect(await storedFlag(plain, created.body.id)).toBe(false);
  });

  it('follows sales.expedicaoDefault (S marks it at birth), never the request', async () => {
    const created = await marked.call('seller1', 'POST', '/orders', body());
    expect(created.status).toBe(201);
    expect(await storedFlag(marked, created.body.id)).toBe(true);
  });

  it('ignores a flag sent by the seller in the request body', async () => {
    const attempt = await plain.call('seller1', 'POST', '/orders', body({ expedicao: true }));
    // Strict contract: an unknown field is refused, so a seller can never set it; if tolerated, it must be ignored.
    if (attempt.status === 201) expect(await storedFlag(plain, attempt.body.id)).toBe(false);
    else expect(attempt.status).toBe(400);
  });

  it('is not exposed to the seller or the manager in any order response', async () => {
    const created = await marked.call('seller1', 'POST', '/orders', body());
    const id = created.body.id as string;
    expect(JSON.stringify(created.body)).not.toMatch(/expedicao/i);
    for (const who of ['seller1', 'manager'] as const) {
      const detail = await marked.call(who, 'GET', `/orders/${id}`);
      expect(detail.status).toBe(200);
      expect(JSON.stringify(detail.body)).not.toMatch(/expedicao/i);
    }
    const list = await marked.call('manager', 'GET', '/orders?pageSize=100');
    expect(JSON.stringify(list.body)).not.toMatch(/expedicao/i);
  });

  it('is shown read-only in the order detail to admin', async () => {
    const created = await marked.call('seller1', 'POST', '/orders', body());
    const detail = await marked.call('admin', 'GET', `/orders/${created.body.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.expedicao).toBe(true);
    const unmarked = await plain.call('seller1', 'POST', '/orders', body());
    expect((await plain.call('admin', 'GET', `/orders/${unmarked.body.id}`)).body.expedicao).toBe(false);
  });
});
