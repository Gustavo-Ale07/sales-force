import { randomUUID } from 'node:crypto';
import { OrdersResponseSchema } from '@salesforce/contracts';
import { getDemoDataset } from '@salesforce/sankhya';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startCommercialApp, type CommercialApp, type Json } from '../helpers/commercial-app.js';
import { closeAllThenStop, startPostgres, type TestPostgres } from '../helpers/postgres.js';

/**
 * Owner ruling 2026-11-13 (B): the device asks for the ERP status of the orders it holds by id. `GET /orders?ids=` is the same
 * list as ever (same scope, same DTO, so the same ERP status/release/delivery fields) narrowed to those ids: an id outside the
 * caller's scope is simply absent, never an error that shows it exists.
 */
const dataset = getDemoDataset();
let postgres: TestPostgres;
const opened: (() => Promise<unknown>)[] = [];
let ctx: CommercialApp;
let own: string;
let foreign: string;
let second: string;

beforeAll(async () => {
  postgres = await startPostgres();
  ctx = await startCommercialApp(postgres, opened);
  const customerOf = (seller: number) => dataset.customers.find((c) => c.sellerCode === seller && c.active && !c.blocked && c.priceTableCode === 21)!.code;
  const customer1 = customerOf(103);
  const customer2 = customerOf(107);
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
  second = await make('seller1', customer1);
  foreign = await make('seller2', customer2);
});
afterAll(async () => {
  await closeAllThenStop(opened, postgres);
});

const idsOf = (body: Json): string[] => (body.items as Json[]).map((item) => item.id as string).sort();

describe('GET /orders?ids=', () => {
  it('returns exactly the requested orders of the caller, in the list DTO with the ERP status fields', async () => {
    const response = await ctx.call('seller1', 'GET', `/orders?ids=${own},${second}`);
    expect(response.status).toBe(200);
    expect(OrdersResponseSchema.safeParse(response.body).success).toBe(true);
    expect(idsOf(response.body)).toEqual([own, second].sort());
    expect(response.body.total).toBe(2);
    for (const item of response.body.items as Json[]) {
      expect(item).toHaveProperty('erpStatus');
      expect(item).toHaveProperty('erpNumber');
    }
  });

  it('an id outside the scope is absent, as if it did not exist (a seller never sees another seller order)', async () => {
    const mixed = await ctx.call('seller1', 'GET', `/orders?ids=${own},${foreign}`);
    expect(mixed.status).toBe(200);
    expect(idsOf(mixed.body)).toEqual([own]);
    const onlyForeign = await ctx.call('seller1', 'GET', `/orders?ids=${foreign}`);
    expect(onlyForeign.status).toBe(200);
    expect(onlyForeign.body.items).toEqual([]);
    const missing = await ctx.call('seller1', 'GET', `/orders?ids=${randomUUID()}`);
    expect({ items: missing.body.items, total: missing.body.total }).toEqual({ items: onlyForeign.body.items, total: onlyForeign.body.total });
  });

  it('a manager sees every requested order in their scope', async () => {
    const response = await ctx.call('manager', 'GET', `/orders?ids=${own},${foreign}`);
    expect(idsOf(response.body)).toEqual([own, foreign].sort());
  });

  it('combines with the other filters instead of replacing them', async () => {
    const response = await ctx.call('seller1', 'GET', `/orders?ids=${own},${second}&status=approved`);
    expect(response.body.items).toEqual([]);
  });

  it('is bounded and strict: more than 100 ids or a non-UUID is a 400', async () => {
    const many = Array.from({ length: 101 }, () => randomUUID()).join(',');
    expect((await ctx.call('seller1', 'GET', `/orders?ids=${many}`)).status).toBe(400);
    expect((await ctx.call('seller1', 'GET', '/orders?ids=not-a-uuid')).status).toBe(400);
    expect((await ctx.call('seller1', 'GET', '/orders?ids=')).status).toBe(400);
    const hundred = Array.from({ length: 100 }, () => randomUUID()).join(',');
    expect((await ctx.call('seller1', 'GET', `/orders?ids=${hundred}&pageSize=100`)).status).toBe(200);
  });
});
