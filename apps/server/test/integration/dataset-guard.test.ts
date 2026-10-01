import { randomUUID } from 'node:crypto';
import type { DatasetIdentity } from '@salesforce/contracts';
import { integrationOutbox, salesOrder } from '@salesforce/db';
import { DEMO_ACCOUNT_EMAILS, getDemoDataset } from '@salesforce/sankhya';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_ORIGIN, TEST_PASSWORD } from '../helpers/auth.js';
import { loginCookie, startAuthApp, type AuthApp } from '../helpers/auth-app.js';
import { TEST_DATASET, startCommercialApp, type CommercialApp, type Json } from '../helpers/commercial-app.js';
import { startPostgres, type TestPostgres } from '../helpers/postgres.js';

/**
 * Dataset trust boundary (docs/architecture.md section 5.5): an order-mutating request names the dataset
 * it came from and is refused with 409 `dataset_mismatch` before any write when it differs from the
 * dataset the server declares (or the server declares none).
 */

const demo = getDemoDataset();
let postgres: TestPostgres;
const opened: (() => Promise<unknown>)[] = [];
let ctx: CommercialApp; // declares TEST_DATASET
let customer: number;
let productCode: number;
let templateId: string;

const OTHER_ID: DatasetIdentity = { environment: 'sandbox', datasetId: 'other-dataset-9' };
const OTHER_ENV: DatasetIdentity = { environment: 'production', datasetId: TEST_DATASET.datasetId };

beforeAll(async () => {
  postgres = await startPostgres();
  ctx = await startCommercialApp(postgres, opened);
  const c = demo.customers.find((entry) => entry.sellerCode === 103 && entry.active && !entry.blocked && entry.priceTableCode === 21);
  if (c === undefined) throw new Error('fixture lacks an orderable customer');
  customer = c.code;
  const products = (await ctx.call('manager', 'GET', `/products?customerCode=${customer}&pageSize=100&sellable=true&priceState=priced`)).body.items;
  productCode = products[0].code;
  const template = await ctx.call('seller1', 'POST', `/customers/${customer}/order-templates`, {
    clientRequestId: randomUUID(),
    name: 'Modelo dataset',
    items: [{ productCode, quantity: '2' }],
  });
  expect(template.status).toBe(201);
  templateId = template.body.id;
});

afterAll(async () => {
  for (const close of opened.reverse()) await close();
  await postgres.stop();
});

const orderBody = (expectedDataset: unknown, clientRequestId: string = randomUUID()) => ({
  clientRequestId,
  expectedDataset,
  customerCode: customer,
  negotiationTypeCode: 2,
  notes: null,
  items: [{ productCode, quantity: '2' }],
});

const counts = async () => ({
  orders: (await ctx.database.handle.db.select().from(salesOrder)).length,
  outbox: (await ctx.database.handle.db.select().from(integrationOutbox)).length,
});

/** The same database served by another process declaring another identity (or none). */
async function appDeclaring(dataset: DatasetIdentity | null): Promise<{ app: AuthApp; cookie: string }> {
  const app = await startAuthApp(postgres, opened, { database: ctx.database, dataset });
  return { app, cookie: await loginCookie(app, DEMO_ACCOUNT_EMAILS.seller1, TEST_PASSWORD) };
}

async function send(app: AuthApp, cookie: string, method: 'POST' | 'PUT', url: string, body: unknown): Promise<{ status: number; body: Json }> {
  const response = await app.app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { origin: TEST_ORIGIN, cookie, 'content-type': 'application/json' },
    payload: JSON.stringify(body),
  });
  return { status: response.statusCode, body: response.body === '' ? null : JSON.parse(response.body) };
}

describe('POST /orders', () => {
  it('(1) accepts the dataset the server declares', async () => {
    const response = await ctx.call('seller1', 'POST', '/orders', orderBody(TEST_DATASET));
    expect(response.status).toBe(201);
  });

  it('(2) rejects another datasetId with 409 dataset_mismatch and a seller-safe message', async () => {
    const response = await ctx.call('seller1', 'POST', '/orders', orderBody(OTHER_ID));
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('dataset_mismatch');
    expect(response.body.message).toMatch(/conjunto de dados/);
    // The server's own identity is never echoed.
    expect(JSON.stringify(response.body)).not.toContain(TEST_DATASET.datasetId);
  });

  it('(3) rejects another environment', async () => {
    const response = await ctx.call('seller1', 'POST', '/orders', orderBody(OTHER_ENV));
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('dataset_mismatch');
  });

  it('(4) a server that declares no dataset rejects every request', async () => {
    const { app, cookie } = await appDeclaring(null);
    const before = await counts();
    const response = await send(app, cookie, 'POST', '/orders', orderBody(TEST_DATASET));
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('dataset_mismatch');
    expect(await counts()).toEqual(before);
  });

  it('(5) a request without expectedDataset is a validation error', async () => {
    const response = await ctx.call('seller1', 'POST', '/orders', orderBody(undefined));
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('validation_failed');
    expect(JSON.stringify(response.body.details)).toContain('expectedDataset');
  });

  it('(6, 7) a mismatch creates no sales_order, no integration_outbox and no idempotency record', async () => {
    const before = await counts();
    const clientRequestId = randomUUID();
    for (const dataset of [OTHER_ID, OTHER_ENV]) {
      expect((await ctx.call('seller1', 'POST', '/orders', orderBody(dataset, clientRequestId))).status).toBe(409);
    }
    expect(await counts()).toEqual(before);
    expect(await ctx.database.handle.db.select().from(salesOrder).where(eq(salesOrder.clientRequestId, clientRequestId))).toHaveLength(0);
    // The id is still free: the same request under the right dataset creates the order.
    expect((await ctx.call('seller1', 'POST', '/orders', orderBody(TEST_DATASET, clientRequestId))).status).toBe(201);
  });

  it('(8) a draft made under dataset A and sent after the server moved to B is rejected, also as a replay', async () => {
    const clientRequestId = randomUUID();
    const created = await ctx.call('seller1', 'POST', '/orders', orderBody(TEST_DATASET, clientRequestId));
    expect(created.status).toBe(201);
    const before = await counts();

    const { app, cookie } = await appDeclaring(OTHER_ID);
    const replay = await send(app, cookie, 'POST', '/orders', orderBody(TEST_DATASET, clientRequestId));
    expect(replay.status).toBe(409);
    expect(replay.body.code).toBe('dataset_mismatch');
    const fresh = await send(app, cookie, 'POST', '/orders', orderBody(TEST_DATASET));
    expect(fresh.status).toBe(409);
    expect(await counts()).toEqual(before);
  });

  it('authentication comes first: an anonymous caller with a mismatching dataset gets 401, not 409', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: { origin: TEST_ORIGIN, 'content-type': 'application/json' },
      payload: JSON.stringify(orderBody(OTHER_ID)),
    });
    expect(response.statusCode).toBe(401);
  });
});

describe('PUT /orders/{id}', () => {
  it('(9) a mismatch is rejected and the existing order and its version are untouched', async () => {
    const created = await ctx.call('seller1', 'POST', '/orders', orderBody(TEST_DATASET));
    const id = created.body.id as string;
    const { clientRequestId: _id, ...draft } = orderBody(TEST_DATASET);
    const replace = (expectedDataset: unknown) =>
      ctx.call('seller1', 'PUT', `/orders/${id}`, { ...draft, expectedDataset, expectedVersion: 1, notes: 'alterado' });

    for (const dataset of [OTHER_ID, OTHER_ENV]) {
      const response = await replace(dataset);
      expect(response.status).toBe(409);
      expect(response.body.code).toBe('dataset_mismatch');
    }
    const after = await ctx.call('seller1', 'GET', `/orders/${id}`);
    expect(after.body.version).toBe(1);
    expect(after.body.notes).toBeNull();

    const ok = await replace(TEST_DATASET);
    expect(ok.status).toBe(200);
    expect(ok.body.version).toBe(2);
  });

  it('a request without expectedDataset is a validation error', async () => {
    const created = await ctx.call('seller1', 'POST', '/orders', orderBody(TEST_DATASET));
    const { clientRequestId: _id, ...draft } = orderBody(undefined);
    const response = await ctx.call('seller1', 'PUT', `/orders/${created.body.id}`, { ...draft, expectedVersion: 1 });
    expect(response.status).toBe(400);
  });
});

describe('POST /customers/{code}/orders/repeat-last', () => {
  it('(9) mismatch is rejected without a draft; the right dataset works', async () => {
    expect((await ctx.call('seller1', 'POST', '/orders', orderBody(TEST_DATASET))).status).toBe(201);
    const before = await counts();
    const url = `/customers/${customer}/orders/repeat-last`;
    for (const dataset of [OTHER_ID, OTHER_ENV]) {
      const response = await ctx.call('seller1', 'POST', url, { clientRequestId: randomUUID(), expectedDataset: dataset });
      expect(response.status).toBe(409);
      expect(response.body.code).toBe('dataset_mismatch');
    }
    expect(await counts()).toEqual(before);
    const missing = await ctx.call('seller1', 'POST', url, { clientRequestId: randomUUID(), expectedDataset: undefined });
    expect(missing.status).toBe(400);
    expect((await ctx.call('seller1', 'POST', url, { clientRequestId: randomUUID(), expectedDataset: TEST_DATASET })).status).toBe(201);
  });

  it('a replay under another dataset is rejected, not served', async () => {
    const url = `/customers/${customer}/orders/repeat-last`;
    const clientRequestId = randomUUID();
    expect((await ctx.call('seller1', 'POST', url, { clientRequestId, expectedDataset: TEST_DATASET })).status).toBe(201);
    const replay = await ctx.call('seller1', 'POST', url, { clientRequestId, expectedDataset: OTHER_ID });
    expect(replay.status).toBe(409);
    expect(replay.body.code).toBe('dataset_mismatch');
  });
});

describe('POST /order-templates/{id}/use', () => {
  it('(9) mismatch is rejected without a draft; missing is a validation error; the right dataset works', async () => {
    const before = await counts();
    const url = `/order-templates/${templateId}/use`;
    for (const dataset of [OTHER_ID, OTHER_ENV]) {
      const response = await ctx.call('seller1', 'POST', url, { clientRequestId: randomUUID(), expectedDataset: dataset });
      expect(response.status).toBe(409);
      expect(response.body.code).toBe('dataset_mismatch');
    }
    expect(await counts()).toEqual(before);
    expect((await ctx.call('seller1', 'POST', url, { clientRequestId: randomUUID(), expectedDataset: undefined })).status).toBe(400);
    expect((await ctx.call('seller1', 'POST', url, { clientRequestId: randomUUID(), expectedDataset: TEST_DATASET })).status).toBe(201);
  });

  it('F8: saving or replacing a template is guarded like an order (mismatch 409 without a write, missing 400)', async () => {
    const create = (expectedDataset: unknown) =>
      ctx.call('seller1', 'POST', `/customers/${customer}/order-templates`, {
        clientRequestId: randomUUID(),
        expectedDataset,
        name: 'Guardado',
        items: [{ productCode, quantity: '1' }],
      });
    for (const dataset of [OTHER_ID, OTHER_ENV]) {
      const response = await create(dataset);
      expect(response.status).toBe(409);
      expect(response.body.code).toBe('dataset_mismatch');
    }
    expect((await create(undefined)).status).toBe(400);
    const created = await create(TEST_DATASET);
    expect(created.status).toBe(201);

    const replace = (expectedDataset: unknown) =>
      ctx.call('seller1', 'PUT', `/order-templates/${created.body.id}`, {
        expectedDataset,
        name: 'Guardado 2',
        items: [{ productCode, quantity: '3' }],
        expectedVersion: created.body.version,
      });
    for (const dataset of [OTHER_ID, OTHER_ENV]) {
      const response = await replace(dataset);
      expect(response.status).toBe(409);
      expect(response.body.code).toBe('dataset_mismatch');
    }
    expect((await replace(undefined)).status).toBe(400);
    expect((await replace(TEST_DATASET)).status).toBe(200);
  });
});
