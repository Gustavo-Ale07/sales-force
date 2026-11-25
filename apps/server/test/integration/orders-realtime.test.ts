import { randomUUID } from 'node:crypto';
import http from 'node:http';
import { OrdersResponseSchema } from '@salesforce/contracts';
import { FakeGateway, DEMO_ACCOUNT_EMAILS, FakeOrderBook, SankhyaGatewayError, getDemoDataset } from '@salesforce/sankhya';
import type { CurrentUser } from '../../src/iam/current-user.js';
import { OrderErpStatusService } from '../../src/integration/order-erp-status.service.js';
import { createLogger } from '../../src/observability/logger.js';
import { SyncRefreshService } from '../../src/sync-refresh/sync-refresh.service.js';
import { SyncRefreshRunner } from '../../src/sync/sync-refresh-runner.service.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_ORIGIN } from '../helpers/auth.js';
import { startCommercialApp, type CommercialApp, type Json } from '../helpers/commercial-app.js';
import { closeAllThenStop, startPostgres, type TestPostgres } from '../helpers/postgres.js';

/**
 * RT-1: a removed order (note confirmed gone from Sankhya) disappears from the lists and the detail, `ids=` names it in
 * `removedIds`, "refresh now" is a 202 that only notifies the worker, and `GET /sync/events` streams content-free pings.
 */
const dataset = getDemoDataset();
let postgres: TestPostgres;
const opened: (() => Promise<unknown>)[] = [];
let ctx: CommercialApp;
let own: string;
let removed: string;
let foreign: string;
let port: number;

beforeAll(async () => {
  postgres = await startPostgres();
  ctx = await startCommercialApp(postgres, opened, { eventStreamEnabled: true, eventStreamLimits: { perAccount: 2, total: 3 } });
  const customerOf = (seller: number) => dataset.customers.find((c) => c.sellerCode === seller && c.active && !c.blocked && c.priceTableCode === 21)!.code;
  const customer1 = customerOf(103);
  const products = (await ctx.call('manager', 'GET', `/products?customerCode=${customer1}&pageSize=5&sellable=true`)).body.items as Json[];
  const make = async (who: 'seller1' | 'seller2', customerCode: number): Promise<string> => {
    const created = await ctx.call(who, 'POST', '/orders', {
      clientRequestId: randomUUID(),
      customerCode,
      negotiationTypeCode: 2,
      notes: null,
      items: [{ productCode: products[0]!.code, quantity: '1' }],
    });
    expect(created.status).toBe(201);
    return created.body.id as string;
  };
  own = await make('seller1', customer1);
  removed = await make('seller1', customer1);
  foreign = await make('seller2', customerOf(107));
  await ctx.database.handle.pool.query('update sales_order set erp_removed_at = now() where id = $1', [removed]);
  await ctx.app.listen({ port: 0, host: '127.0.0.1' });
  const address = ctx.app.getHttpServer().address();
  port = typeof address === 'object' && address !== null ? address.port : 0;
});
afterAll(async () => {
  await closeAllThenStop(opened, postgres);
});

describe('removed orders (RT-1)', () => {
  it('leave the list, the counts of ids= (named in removedIds) and the detail (404 like an unknown order)', async () => {
    const list = await ctx.call('seller1', 'GET', '/orders');
    expect((list.body.items as Json[]).map((i) => i.id)).toContain(own);
    expect((list.body.items as Json[]).map((i) => i.id)).not.toContain(removed);

    const byIds = await ctx.call('seller1', 'GET', `/orders?ids=${own},${removed},${foreign}`);
    expect(OrdersResponseSchema.safeParse(byIds.body).success).toBe(true);
    expect((byIds.body.items as Json[]).map((i) => i.id)).toEqual([own]);
    // Only ids inside the caller's scope are ever named: the foreign one is just absent (P-21).
    expect(byIds.body.removedIds).toEqual([removed]);
    expect((await ctx.call('seller1', 'GET', `/orders?ids=${own}`)).body.removedIds).toEqual([]);
    expect((await ctx.call('seller2', 'GET', `/orders?ids=${removed}`)).body.removedIds).toEqual([]);

    const detail = await ctx.call('seller1', 'GET', `/orders/${removed}`);
    const unknown = await ctx.call('seller1', 'GET', `/orders/${randomUUID()}`);
    expect(detail.status).toBe(404);
    const bare = (body: Json) => ({ ...body, details: undefined });
    expect(bare(detail.body)).toEqual(bare(unknown.body));
    // The manager sees the same: the row stays for audit, not for the screens.
    expect((await ctx.call('manager', 'GET', `/orders/${removed}`)).status).toBe(404);
  });
});

describe('POST /orders/{id}/refresh (RT-1)', () => {
  it('is 202, never waits for Sankhya, refuses an order the caller cannot see, and drops a repeat inside 10 s', async () => {
    expect((await ctx.call('seller1', 'POST', `/orders/${foreign}/refresh`)).status).toBe(404);
    expect((await ctx.call('seller1', 'POST', `/orders/${removed}/refresh`)).status).toBe(404);
    const first = await ctx.call('seller1', 'POST', `/orders/${own}/refresh`);
    expect(first.status).toBe(202);
    expect(first.body).toEqual({ accepted: true });
    const again = await ctx.call('seller1', 'POST', `/orders/${own}/refresh`);
    expect(again.status).toBe(202);
    expect(again.body).toEqual({ accepted: false });
  });
});

function openStream(cookie: string): Promise<{ status: number; headers: http.IncomingHttpHeaders; chunks: string[]; close: () => void }> {
  return new Promise((resolve, reject) => {
    const request = http.get({ host: '127.0.0.1', port, path: '/api/v1/sync/events', headers: { cookie, origin: TEST_ORIGIN } }, (response) => {
      const chunks: string[] = [];
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => chunks.push(chunk));
      resolve({ status: response.statusCode ?? 0, headers: response.headers, chunks, close: () => request.destroy() });
    });
    request.on('error', reject);
  });
}

const waitFor = async (predicate: () => boolean): Promise<void> => {
  for (let i = 0; i < 100 && !predicate(); i += 1) await new Promise((resolve) => setTimeout(resolve, 50));
  expect(predicate()).toBe(true);
};

describe('GET /sync/events (RT-1)', () => {
  it('needs a session, streams only content-free pings of the right topics, and caps streams per account', async () => {
    const anonymous = await new Promise<number>((resolve) => http.get({ host: '127.0.0.1', port, path: '/api/v1/sync/events', headers: { origin: TEST_ORIGIN } }, (r) => { resolve(r.statusCode ?? 0); r.resume(); }));
    expect(anonymous).toBe(401);

    const cookie = ctx.cookies.seller1;
    const a = await openStream(cookie);
    expect(a.status).toBe(200);
    expect(a.headers['content-type']).toContain('text/event-stream');
    expect(a.headers['x-accel-buffering']).toBe('no');
    expect(String(a.headers['cache-control'])).toContain('no-cache');
    await waitFor(() => a.chunks.join('').includes(': connected'));

    await ctx.database.handle.pool.query(`select pg_notify('sf_events', '{"topic":"orders"}')`);
    await ctx.database.handle.pool.query(`select pg_notify('sf_events', '{"topic":"secrets","x":1}')`);
    await waitFor(() => a.chunks.join('').includes('event: ping\ndata: {"topic":"orders"}\n\n'));
    expect(a.chunks.join('')).not.toContain('secrets');

    const b = await openStream(cookie);
    expect(b.status).toBe(200);
    const c = await openStream(cookie);
    expect(c.status).toBe(429);
    // Another account is not affected by this one's cap.
    const other = await openStream(ctx.cookies.manager);
    expect(other.status).toBe(200);
    for (const stream of [a, b, other]) stream.close();
  });
});

describe('"Sincronizar agora" alone removes and reconciles orders (RT-1, owner acceptance 2026-11-25)', () => {
  const logger = createLogger({ level: 'silent', service: 'test' });
  const manager = (): CurrentUser => ({ accountId: ctx.accounts.ids[DEMO_ACCOUNT_EMAILS.manager]!, role: 'manager' }) as CurrentUser;
  const sql = (text: string, params: unknown[]) => ctx.database.handle.pool.query(text, params);
  const down = () => Promise.reject(new SankhyaGatewayError('unavailable', { code: 'down', message: 'down' }));

  /** One manual refresh: the API records the request, the worker runner serves it with the given ERP reader. */
  let hours = 0;
  async function refresh(gateway: unknown): Promise<void> {
    // The API reuses a refresh finished moments ago; each call here is a later click.
    hours += 1;
    const clock = () => new Date(Date.now() + hours * 3600_000);
    const service = new OrderErpStatusService({ db: ctx.database.handle, gateway: gateway as never, logger, now: clock, originField: 'AD_FORCEORIGEM' });
    const started = await new SyncRefreshService(ctx.database.handle.db, clock).start(manager());
    await new SyncRefreshRunner({
      db: ctx.database.handle,
      mirror: { run: async (entity) => ({ entity, outcome: 'completed', stats: { read: 0, created: 0, updated: 0, reactivated: 0, unchanged: 0, deactivated: 0 } }) as never },
      orderStatus: service,
      logger,
      now: clock,
    }).run(started.id);
  }
  async function makeSent(erpNumber: number | null, status = 'sent'): Promise<string> {
    const customer = dataset.customers.find((c) => c.sellerCode === 103 && c.active && !c.blocked && c.priceTableCode === 21)!.code;
    const id = randomUUID();
    await sql(
      `INSERT INTO sales_order (id, customer_code, seller_code, created_by_account_id, status, negotiation_type_code, client_request_id, config_version_id, dataset_origin, erp_environment, external_origin_id, erp_number)
       VALUES ($1, $2, 103, $3, $4, 11, $5, $6, 'sankhya', 'sandbox', $8, $7)`,
      [id, customer, ctx.accounts.ids[DEMO_ACCOUNT_EMAILS.seller1]!, status, randomUUID(), ctx.accounts.configVersionId, erpNumber, id],
    );
    return id;
  }

  it('a sent order whose note Sankhya no longer has is removed by ONE refresh and vanishes from list, ids= (removedIds) and detail', async () => {
    const gone = await makeSent(910001);
    const kept = await makeSent(910002);
    const book = new FakeOrderBook();
    book.noteHeaders.set(910002, { statusNota: 'L', pending: 'N' });
    await refresh(new FakeGateway({ orders: book }));

    const row = (await sql('select erp_removed_at from sales_order where id = $1', [gone])).rows[0];
    expect(row.erp_removed_at).not.toBeNull();
    expect((await sql(`select count(*)::int as n from audit_log where action = 'order.erp_removed'`, [])).rows[0].n).toBeGreaterThanOrEqual(1);
    const list = (await ctx.call('seller1', 'GET', '/orders?mine=true')).body.items as Json[];
    expect(list.map((i) => i.id)).toContain(kept);
    expect(list.map((i) => i.id)).not.toContain(gone);
    const byIds = await ctx.call('seller1', 'GET', `/orders?ids=${gone},${kept}`);
    expect((byIds.body.items as Json[]).map((i) => i.id)).toEqual([kept]);
    expect(byIds.body.removedIds).toEqual([gone]);
    expect((await ctx.call('seller1', 'GET', `/orders/${gone}`)).status).toBe(404);
  });

  it('a failed Sankhya read does NOT remove the order', async () => {
    const id = await makeSent(910010);
    await refresh({ readOrderReleaseFacts: down, readOrderStatusFacts: down, readOrderStageFacts: down, findOrderByOrigin: down });
    expect((await sql('select erp_removed_at from sales_order where id = $1', [id])).rows[0].erp_removed_at).toBeNull();
    expect(((await ctx.call('seller1', 'GET', '/orders?mine=true')).body.items as Json[]).map((i) => i.id)).toContain(id);
  });

  it('a Sankhya note that carries our origin id (AD_FORCEORIGEM) is linked by the refresh; an order with no origin match is left alone', async () => {
    const id = await makeSent(null, 'unknown');
    const other = await makeSent(null, 'unknown');
    const book = new FakeOrderBook();
    book.orders.push({ erpOrderNumber: 910020, request: { originId: id } as never, confirmed: true });
    book.noteHeaders.set(910020, { statusNota: 'L', pending: 'N' });
    await refresh(new FakeGateway({ orders: book }));
    expect((await sql('select status, erp_number from sales_order where id = $1', [id])).rows[0]).toEqual({ status: 'sent', erp_number: '910020' });
    expect((await sql('select status, erp_number from sales_order where id = $1', [other])).rows[0]).toEqual({ status: 'unknown', erp_number: null });
  });
});
