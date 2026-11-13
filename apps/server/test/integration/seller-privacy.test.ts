import { getDemoDataset } from '@salesforce/sankhya';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startCommercialApp, type CommercialApp, type Json } from '../helpers/commercial-app.js';
import { closeAllThenStop, startPostgres, type TestPostgres } from '../helpers/postgres.js';

/**
 * Owner ruling 2026-11-13: the seller list is for manager and admin only, and nothing a seller can reach carries another
 * seller's name or code (P-21).
 */
const dataset = getDemoDataset();
const SELLER_1 = 103;

let postgres: TestPostgres;
const opened: (() => Promise<unknown>)[] = [];
let ctx: CommercialApp;

beforeAll(async () => {
  postgres = await startPostgres();
  ctx = await startCommercialApp(postgres, opened);
});
afterAll(async () => {
  await closeAllThenStop(opened, postgres);
});

const others = dataset.sellers.filter((seller) => seller.code !== SELLER_1);

function sellerCodesIn(value: Json, found: number[] = []): number[] {
  if (Array.isArray(value)) for (const entry of value) sellerCodesIn(entry, found);
  else if (typeof value === 'object' && value !== null) {
    for (const [key, entry] of Object.entries(value)) {
      if (key === 'sellerCode' && typeof entry === 'number') found.push(entry);
      else if (key === 'sellerCodes' && Array.isArray(entry)) found.push(...(entry as number[]));
      else sellerCodesIn(entry, found);
    }
  }
  return found;
}

describe('GET /sellers', () => {
  it('is for manager and admin only', async () => {
    expect((await ctx.call('manager', 'GET', '/sellers')).status).toBe(200);
    expect((await ctx.call('admin', 'GET', '/sellers')).status).toBe(200);
    const denied = await ctx.call('seller1', 'GET', '/sellers');
    expect(denied.status).toBe(403);
    expect(JSON.stringify(denied.body)).not.toContain(others[0]?.name ?? 'unreachable');
  });
});

describe('what a seller can read never names another seller', () => {
  it('customers list, filtered by another seller, and customer detail', async () => {
    const pages: Json[] = [];
    for (let page = 1; page <= 20; page += 1) {
      const { status, body } = await ctx.call('seller1', 'GET', `/customers?page=${page}&pageSize=100`);
      expect(status).toBe(200);
      pages.push(body);
      if (body.items.length === 0 || page * 100 >= body.total) break;
    }
    const items = pages.flatMap((body) => body.items as Json[]);
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) expect(item.sellerCode).toBe(SELLER_1);
    const text = JSON.stringify(pages);
    for (const other of others) expect(text).not.toContain(other.name);

    // Asking for another seller's customers widens nothing: the scope is applied first.
    const filtered = await ctx.call('seller1', 'GET', `/customers?sellerCode=${others[0]?.code ?? 0}`);
    expect(filtered.status).toBe(200);
    expect(filtered.body.items).toEqual([]);

    const foreign = dataset.customers.find((customer) => customer.sellerCode !== SELLER_1 && customer.active && !customer.blocked);
    if (foreign === undefined) throw new Error('fixture has no customer of another seller');
    expect((await ctx.call('seller1', 'GET', `/customers/${foreign.code}`)).status).toBe(404);
    const own = items[0] as Json;
    const detail = await ctx.call('seller1', 'GET', `/customers/${own.code}`);
    expect(sellerCodesIn(detail.body).every((code) => code === SELLER_1)).toBe(true);
  });

  it('orders, dashboard and session carry only the seller own codes', async () => {
    for (const url of ['/orders?pageSize=100', '/dashboard', '/auth/session', '/order-entry/configuration']) {
      const { status, body } = await ctx.call('seller1', 'GET', url);
      expect(status).toBe(200);
      expect(sellerCodesIn(body).every((code) => code === SELLER_1), url).toBe(true);
      const text = JSON.stringify(body);
      for (const other of others) expect(text, url).not.toContain(other.name);
    }
  });
});
