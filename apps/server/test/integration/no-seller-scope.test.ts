import { randomUUID } from 'node:crypto';
import { auditLog } from '@salesforce/db';
import { DEMO_CONFIGURATION } from '@salesforce/sankhya';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_ORIGIN, TEST_PASSWORD, createTestAccount } from '../helpers/auth.js';
import { loginCookie } from '../helpers/auth-app.js';
import { TEST_DATASET, startCommercialApp, type CommercialApp, type Json } from '../helpers/commercial-app.js';
import { startPostgres, type TestPostgres } from '../helpers/postgres.js';

/**
 * F1: a seller without a valid seller link is denied with 403 `no_seller_scope` on every scoped route,
 * whatever the portfolio strategy (`all_visible` must never widen a seller). The denial is audited
 * without personal data.
 */

let postgres: TestPostgres;
const opened: (() => Promise<unknown>)[] = [];

beforeAll(async () => {
  postgres = await startPostgres();
});
afterAll(async () => {
  for (const close of opened.reverse()) await close();
  await postgres.stop();
});

const UNLINKED_EMAIL = 'sem-vinculo@example.test';

async function unlinkedSeller(ctx: CommercialApp): Promise<{ id: string; send: (method: 'GET' | 'POST', url: string, body?: unknown) => Promise<{ status: number; body: Json }> }> {
  const account = await createTestAccount(ctx.database.handle, { email: UNLINKED_EMAIL, role: 'seller' }, ctx.clock.fn);
  const cookie = await loginCookie(ctx, UNLINKED_EMAIL, TEST_PASSWORD);
  return {
    id: account.id,
    async send(method, url, body) {
      const response = await ctx.app.inject({
        method,
        url: `/api/v1${url}`,
        headers: { origin: TEST_ORIGIN, cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
      });
      return { status: response.statusCode, body: response.body === '' ? null : JSON.parse(response.body) };
    },
  };
}

const allVisible = {
  ...DEMO_CONFIGURATION,
  customers: { ...DEMO_CONFIGURATION.customers, portfolioOwnership: { strategy: 'all_visible' as const } },
};

describe.each([
  ['customer_seller_field (default)', undefined],
  ['all_visible', allVisible],
] as const)('seller without a seller link, strategy %s', (_label, configuration) => {
  let ctx: CommercialApp;
  let seller: Awaited<ReturnType<typeof unlinkedSeller>>;

  beforeAll(async () => {
    ctx = await startCommercialApp(postgres, opened, configuration === undefined ? {} : { configuration });
    seller = await unlinkedSeller(ctx);
  });

  const body = { clientRequestId: randomUUID(), expectedDataset: TEST_DATASET };
  const routes: [string, 'GET' | 'POST', string, unknown][] = [
    ['customers list', 'GET', '/customers', undefined],
    ['customer detail', 'GET', '/customers/1', undefined],
    ['orders list', 'GET', '/orders', undefined],
    ['order create', 'POST', '/orders', { ...body, customerCode: 1, negotiationTypeCode: null, notes: null, items: [{ productCode: 1, quantity: '1' }] }],
    ['templates list', 'GET', '/customers/1/order-templates', undefined],
    ['template create', 'POST', '/customers/1/order-templates', { ...body, name: 'x', items: [{ productCode: 1, quantity: '1' }] }],
    ['dashboard', 'GET', '/dashboard', undefined],
    ['repeat-last', 'POST', '/customers/1/orders/repeat-last', body],
    ['sellers', 'GET', '/sellers', undefined],
    ['product image', 'GET', '/products/1/image', undefined],
  ];

  it.each(routes)('%s -> 403 no_seller_scope', async (_name, method, url, payload) => {
    const response = await seller.send(method, url, payload);
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('no_seller_scope');
  });

  it('audits the denial with the account id and no personal data', async () => {
    await seller.send('GET', '/customers');
    const rows = (await ctx.database.handle.db.select().from(auditLog)).filter((row) => row.action === 'authz.no_seller_scope');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.actorAccountId === seller.id)).toBe(true);
    expect(JSON.stringify(rows)).not.toContain(UNLINKED_EMAIL);
  });

  it('manager and linked seller are unaffected', async () => {
    expect((await ctx.call('manager', 'GET', '/customers')).status).toBe(200);
    expect((await ctx.call('seller1', 'GET', '/customers')).status).toBe(200);
  });
});

describe('F2: linkSeller refuses seller codes below 1', () => {
  it.each([0, -3, 1.5, Number.NaN])('rejects %s before touching the database', async (code) => {
    const { createOperatorAccountService } = await import('../../src/cli/operator.js');
    const { InvalidSellerCodeError } = await import('../../src/iam/account.service.js');
    const { TEST_HASH_PARAMS } = await import('../helpers/auth.js');
    const ctx = await startCommercialApp(postgres, opened);
    const { accounts } = createOperatorAccountService(ctx.database.handle, TEST_HASH_PARAMS, ctx.clock.fn);
    await expect(accounts.linkSeller(randomUUID(), code, randomUUID())).rejects.toBeInstanceOf(InvalidSellerCodeError);
  });
});
