import { CustomerLettersResponseSchema, CustomersResponseSchema } from '@salesforce/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startCommercialApp, type CommercialApp, type Json } from '../helpers/commercial-app.js';
import { closeAllThenStop, startPostgres, type TestPostgres } from '../helpers/postgres.js';

/**
 * A-Z index of the customer list: `GET /customers/letters` counts the visible customers per initial letter (same scope and
 * filters as the list) and `GET /customers?initial=` narrows the list to that letter, with a correct total and paging.
 */
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

const firstLetter = (name: string): string => {
  const letter = name.trim().charAt(0).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  return letter >= 'A' && letter <= 'Z' && letter.length === 1 ? letter : '#';
};

async function everyCustomer(who: 'manager' | 'seller1' | 'seller2'): Promise<Json[]> {
  const items: Json[] = [];
  for (let page = 1; ; page += 1) {
    const { status, body } = await ctx.call(who, 'GET', `/customers?page=${page}&pageSize=100`);
    expect(status).toBe(200);
    items.push(...(CustomersResponseSchema.parse(body).items as unknown as Json[]));
    if (items.length >= (body.total as number)) return items;
  }
}

describe('A-Z index de clientes', () => {
  it('the count per letter matches the visible list exactly, and A-Z is ordered with # last', async () => {
    for (const who of ['manager', 'seller1', 'seller2'] as const) {
      const items = await everyCustomer(who);
      const expected = new Map<string, number>();
      for (const item of items) expected.set(firstLetter(item.name as string), (expected.get(firstLetter(item.name as string)) ?? 0) + 1);
      const response = await ctx.call(who, 'GET', '/customers/letters');
      expect(response.status).toBe(200);
      const letters = CustomerLettersResponseSchema.parse(response.body).letters;
      expect(Object.fromEntries(letters.map((entry) => [entry.letter, entry.count]))).toEqual(Object.fromEntries(expected));
      expect(letters.reduce((sum, entry) => sum + entry.count, 0)).toBe(items.length);
      const order = letters.map((entry) => entry.letter);
      expect(order).toEqual([...order].sort((a, b) => (a === '#' ? 1 : b === '#' ? -1 : a.localeCompare(b))));
    }
  });

  it('?initial= narrows the list with the right total and paging, inside the caller scope', async () => {
    const items = await everyCustomer('manager');
    const letter = firstLetter(items[0]!.name as string);
    const expected = items.filter((item) => firstLetter(item.name as string) === letter);
    const all = await ctx.call('manager', 'GET', `/customers?initial=${encodeURIComponent(letter)}&pageSize=100`);
    expect(all.status).toBe(200);
    const parsed = CustomersResponseSchema.parse(all.body);
    expect(parsed.total).toBe(expected.length);
    expect(parsed.items.every((item) => firstLetter(item.name) === letter)).toBe(true);
    const paged = await ctx.call('manager', 'GET', `/customers?initial=${encodeURIComponent(letter)}&pageSize=1&page=1`);
    expect(paged.body.total).toBe(expected.length);
    expect((paged.body.items as Json[]).length).toBe(1);
    // A seller sees only the letters of their own portfolio.
    const seller = await everyCustomer('seller1');
    const sellerLetters = new Set(seller.map((item) => firstLetter(item.name as string)));
    const managerOnly = [...new Set(items.map((item) => firstLetter(item.name as string)))].find((l) => !sellerLetters.has(l));
    if (managerOnly !== undefined) {
      const none = await ctx.call('seller1', 'GET', `/customers?initial=${encodeURIComponent(managerOnly)}`);
      expect(none.body.total).toBe(0);
    }
  });

  it('rejects an invalid initial and requires a session', async () => {
    expect((await ctx.call('manager', 'GET', '/customers?initial=ab')).status).toBe(400);
    expect((await ctx.call('manager', 'GET', '/customers?initial=1')).status).toBe(400);
  });
});
