import { randomUUID } from 'node:crypto';
import { auditLog, erpCustomer, salesOrder } from '@salesforce/db';
import { DEMO_CONFIGURATION, getDemoDataset } from '@salesforce/sankhya';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startCommercialApp, type CommercialApp, type Json } from '../helpers/commercial-app.js';
import { startPostgres, type TestPostgres, closeAllThenStop } from '../helpers/postgres.js';

/**
 * An inactive or blocked customer cannot receive a new order (409 customer_ineligible, pt-BR). Existing
 * drafts are never changed or silently converted: they are flagged `review.status = needs_review`
 * (reason customer_ineligible) on every read and refused on submission. Also: `all_visible` never turns a
 * linked seller into a global viewer.
 */

const dataset = getDemoDataset();
let postgres: TestPostgres;
const opened: (() => Promise<unknown>)[] = [];
let ctx: CommercialApp;
let normal: number;
let items: { productCode: unknown; quantity: string }[];

beforeAll(async () => {
  postgres = await startPostgres();
  ctx = await startCommercialApp(postgres, opened);
  const candidate = dataset.customers.find((c) => c.sellerCode === 103 && c.active && !c.blocked && c.priceTableCode === 21);
  if (candidate === undefined) throw new Error('fixture lacks a customer');
  normal = candidate.code;
  const list: Json[] = (await ctx.call('manager', 'GET', `/products?customerCode=${normal}&pageSize=100&sellable=true&priceState=priced`)).body.items;
  items = list.slice(0, 2).map((p) => ({ productCode: p.code, quantity: '1' }));
});
afterAll(async () => {
  await closeAllThenStop(opened, postgres);
});

const db = () => ctx.database.handle.db;
const body = (customerCode: number) => ({ clientRequestId: randomUUID(), customerCode, negotiationTypeCode: null, notes: null, items });
const setCustomer = (values: Partial<typeof erpCustomer.$inferInsert>) => db().update(erpCustomer).set(values).where(eq(erpCustomer.code, normal));
const restore = () => setCustomer({ active: true, blockedRaw: 'N', deletedAt: null, sellerCode: 103 });

describe('new orders for an ineligible customer', () => {
  it.each([
    ['inactive', { active: false }, 'customer_inactive'],
    ['blocked', { blockedRaw: 'S' }, 'customer_blocked'],
  ] as const)('create is refused (409 customer_ineligible) for an %s customer and nothing is stored', async (_label, change, reason) => {
    await setCustomer(change);
    try {
      const before = (await db().select().from(salesOrder)).length;
      const response = await ctx.call('manager', 'POST', '/orders', body(normal));
      expect(response.status).toBe(409);
      expect(response.body.code).toBe('customer_ineligible');
      expect(response.body.message).toMatch(/inativo ou bloqueado/);
      expect(response.body.details.reason).toBe(reason);
      expect((await db().select().from(salesOrder)).length).toBe(before);
      // The seller, whose scope includes this customer, is refused identically.
      expect((await ctx.call('seller1', 'POST', '/orders', body(normal))).body.code).toBe('customer_ineligible');
      expect((await ctx.call('seller1', 'POST', `/customers/${normal}/orders/repeat-last`, { clientRequestId: randomUUID() })).body.code).toBe('customer_ineligible');
    } finally {
      await restore();
    }
  });

  it('replace to an ineligible customer is refused, the draft stays untouched', async () => {
    const created = await ctx.call('manager', 'POST', '/orders', body(normal));
    expect(created.status).toBe(201);
    const other = dataset.customers.find((c) => c.sellerCode === 103 && c.active && !c.blocked && c.code !== normal && c.priceTableCode === 21);
    if (other === undefined) throw new Error('fixture lacks a second customer');
    await db().update(erpCustomer).set({ active: false }).where(eq(erpCustomer.code, other.code));
    try {
      const response = await ctx.call('manager', 'PUT', `/orders/${created.body.id}`, { ...(({ clientRequestId: _id, ...rest }) => rest)(body(other.code)), expectedVersion: created.body.version });
      expect(response.status).toBe(409);
      expect(response.body.code).toBe('customer_ineligible');
      expect((await ctx.call('manager', 'GET', `/orders/${created.body.id}`)).body.version).toBe(created.body.version);
    } finally {
      await db().update(erpCustomer).set({ active: true }).where(eq(erpCustomer.code, other.code));
    }
  });
});

describe('existing drafts of a customer that became ineligible', () => {
  it('are flagged needs_review (never silently converted) and refused on submit, then recover with the customer', async () => {
    const created = await ctx.call('seller1', 'POST', '/orders', body(normal));
    expect(created.status).toBe(201);
    expect(created.body.review).toBeNull();
    const id = created.body.id;

    await setCustomer({ blockedRaw: 'S' });
    try {
      const detail = (await ctx.call('seller1', 'GET', `/orders/${id}`)).body;
      expect(detail.status).toBe('draft');
      expect(detail.version).toBe(created.body.version);
      expect(detail.review).toEqual({ status: 'needs_review', reason: 'customer_ineligible', customerBlock: 'customer_blocked' });
      const listed: Json[] = (await ctx.call('seller1', 'GET', '/orders?pageSize=100')).body.items;
      expect(listed.find((o) => o.id === id).review).toMatchObject({ status: 'needs_review', reason: 'customer_ineligible' });

      const submit = await ctx.call('seller1', 'POST', `/orders/${id}/submit`);
      expect(submit.status).toBe(409);
      expect(submit.body.code).toBe('customer_ineligible');
      const audited = (await db().select().from(auditLog)).filter((row) => row.action === 'order.submit_customer_ineligible');
      expect(audited.length).toBeGreaterThan(0);
      expect(JSON.stringify(audited)).not.toMatch(/notes|taxId/);
      // Nothing changed in the stored draft.
      const [row] = await db().select().from(salesOrder).where(eq(salesOrder.id, id));
      expect(row?.status).toBe('draft');
    } finally {
      await restore();
    }

    const recovered = (await ctx.call('seller1', 'GET', `/orders/${id}`)).body;
    expect(recovered.review).toBeNull();
    // Eligible again: submission reaches the (disabled) ERP gate, as before.
    expect((await ctx.call('seller1', 'POST', `/orders/${id}/submit`)).body.code).toBe('erp_submission_disabled');
  });

  it.each([
    ['inactive', { active: false }, 'customer_inactive'],
    ['without a valid seller', { sellerCode: 0 }, 'customer_without_seller'],
    ['removed from the mirror', { deletedAt: new Date('2030-01-01T00:00:00Z') }, 'customer_unavailable'],
  ] as const)('a draft of a customer that is %s needs review (%s)', async (_label, change, block) => {
    const created = await ctx.call('manager', 'POST', '/orders', body(normal));
    await setCustomer(change);
    try {
      const detail = (await ctx.call('manager', 'GET', `/orders/${created.body.id}`)).body;
      expect(detail.review).toEqual({ status: 'needs_review', reason: 'customer_ineligible', customerBlock: block });
      expect((await ctx.call('manager', 'POST', `/orders/${created.body.id}/submit`)).body.code).toBe('customer_ineligible');
    } finally {
      await restore();
    }
  });

  it('a cancelled order is never flagged', async () => {
    const created = await ctx.call('manager', 'POST', '/orders', body(normal));
    await ctx.call('manager', 'DELETE', `/orders/${created.body.id}`);
    await setCustomer({ active: false });
    try {
      expect((await ctx.call('manager', 'GET', `/orders/${created.body.id}`)).body.review).toBeNull();
    } finally {
      await restore();
    }
  });
});

describe('all_visible never makes a linked seller global (server)', () => {
  it('seller1 lists only the customers of seller 103; the manager lists more', async () => {
    const allVisible = {
      ...DEMO_CONFIGURATION,
      customers: { ...DEMO_CONFIGURATION.customers, portfolioOwnership: { strategy: 'all_visible' as const } },
    };
    const local = await startCommercialApp(postgres, opened, { configuration: allVisible });
    const mine: Json[] = (await local.call('seller1', 'GET', '/customers?pageSize=100')).body.items;
    const all: Json[] = (await local.call('manager', 'GET', '/customers?pageSize=100')).body.items;
    expect(mine.length).toBeGreaterThan(0);
    expect(new Set(mine.map((c) => c.sellerCode))).toEqual(new Set([103]));
    expect(all.length).toBeGreaterThan(mine.length);
    const foreign = all.find((c) => c.sellerCode !== 103);
    expect((await local.call('seller1', 'GET', `/customers/${foreign?.code}`)).status).toBe(404);
  });
});
