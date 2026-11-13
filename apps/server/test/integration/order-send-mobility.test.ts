import { randomUUID } from 'node:crypto';
import { OrderDetailSchema } from '@salesforce/contracts';
import { DEMO_CONFIGURATION, getDemoDataset } from '@salesforce/sankhya';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startCommercialApp, type CommercialApp, type Json } from '../helpers/commercial-app.js';
import { closeAllThenStop, startPostgres, type TestPostgres } from '../helpers/postgres.js';

/**
 * Owner ruling 2026-11-13: a product that loses mobility (or whose price stops being above zero) while a draft exists blocks
 * SENDING with a clear reason; the draft is never silently changed. The server validates on submission and on draft validation.
 */
const dataset = getDemoDataset();
const SELLER_1 = 103;
let postgres: TestPostgres;
const opened: (() => Promise<unknown>)[] = [];
let ctx: CommercialApp;
let customer: number;
let priced: Json[];

beforeAll(async () => {
  postgres = await startPostgres();
  ctx = await startCommercialApp(postgres, opened);
  const c = dataset.customers.find((x) => x.sellerCode === SELLER_1 && x.active && !x.blocked && x.priceTableCode === 21);
  if (c === undefined) throw new Error('fixture lacks an orderable customer');
  customer = c.code;
  priced = (await ctx.call('manager', 'GET', `/products?customerCode=${customer}&pageSize=100&sellable=true`)).body.items;
  if (priced.length < 8) throw new Error('fixture lacks products');
});
afterAll(async () => {
  await closeAllThenStop(opened, postgres);
});

const body = (codes: number[]) => ({
  clientRequestId: randomUUID(),
  customerCode: customer,
  negotiationTypeCode: 2,
  notes: 'pedido de teste',
  items: codes.map((productCode) => ({ productCode, quantity: '2' })),
});
const pool = () => ctx.database.handle.pool;
const issuesOf = (response: { body: Json }): { code: string; path: string }[] => response.body.details?.issues ?? [];

describe('product that lost mobility or price', () => {
  it('a healthy draft has no send blocks and reaches the (disabled) ERP step', async () => {
    const created = await ctx.call('seller1', 'POST', '/orders', body([priced[0]!.code]));
    expect(created.status).toBe(201);
    expect(created.body.sendBlocks ?? []).toEqual([]);
    const submit = await ctx.call('seller1', 'POST', `/orders/${created.body.id}/submit`);
    expect(submit.body.code).not.toBe('validation_failed');
  });

  it('draft that lost mobility: the read shows the block, the submission is refused with "Produto sem mobilidade", the draft is untouched', async () => {
    const code = priced[1]!.code as number;
    const created = await ctx.call('seller1', 'POST', '/orders', body([code, priced[2]!.code]));
    expect(created.status).toBe(201);
    await pool().query('update erp_product set deleted_at = now() where code = $1', [code]);

    const read = await ctx.call('seller1', 'GET', `/orders/${created.body.id}`);
    expect(OrderDetailSchema.safeParse(read.body).success).toBe(true);
    expect(read.body.items).toHaveLength(2);
    expect(read.body.sendBlocks).toEqual([{ lineNo: 1, productCode: code, code: 'product_without_mobility', message: 'Produto sem mobilidade' }]);

    const submit = await ctx.call('seller1', 'POST', `/orders/${created.body.id}/submit`);
    expect(submit.status).toBe(400);
    expect(submit.body.code).toBe('validation_failed');
    expect(submit.body.message).toContain('Produto sem mobilidade');
    expect(issuesOf(submit)).toEqual([{ code: 'product_without_mobility', path: 'items[0].productCode' }]);
    expect((await ctx.call('seller1', 'GET', `/orders/${created.body.id}`)).body.status).toBe('draft');

    // The mobility returns: the same draft sends again (no lasting state).
    await pool().query('update erp_product set deleted_at = null where code = $1', [code]);
    expect((await ctx.call('seller1', 'GET', `/orders/${created.body.id}`)).body.sendBlocks ?? []).toEqual([]);
  });

  it('draft validation (create): a product without mobility is refused with its reason, not as unknown', async () => {
    const code = priced[3]!.code as number;
    await pool().query('update erp_product set deleted_at = now() where code = $1', [code]);
    const response = await ctx.call('seller1', 'POST', '/orders', body([code]));
    expect(response.status).toBe(400);
    expect(issuesOf(response)).toEqual([{ code: 'product_without_mobility', path: 'items[0].productCode' }]);
    await pool().query('update erp_product set deleted_at = null where code = $1', [code]);
  });

  it('a price that stops being above zero blocks sending with "Produto sem preço"', async () => {
    const code = priced[4]!.code as number;
    const created = await ctx.call('seller1', 'POST', '/orders', body([code]));
    expect(created.status).toBe(201);
    await pool().query('update erp_list_price set unit_price = 0 where product_code = $1 and version_id = $2', [code, priced[4]!.listPrice.versionId]);
    const read = await ctx.call('seller1', 'GET', `/orders/${created.body.id}`);
    expect(read.body.sendBlocks).toEqual([{ lineNo: 1, productCode: code, code: 'product_without_price', message: 'Produto sem preço' }]);
    const submit = await ctx.call('seller1', 'POST', `/orders/${created.body.id}/submit`);
    expect(submit.status).toBe(400);
    expect(submit.body.message).toContain('Produto sem preço');
    expect(issuesOf(submit)).toEqual([{ code: 'product_without_price', path: 'items[0].priceState' }]);
  });

  it('a new draft with a product that has no price above zero is refused', async () => {
    const code = priced[5]!.code as number;
    await pool().query('update erp_list_price set unit_price = 0 where product_code = $1 and version_id = $2', [code, priced[5]!.listPrice.versionId]);
    const response = await ctx.call('seller1', 'POST', '/orders', body([code]));
    expect(response.status).toBe(400);
    expect(issuesOf(response).map((issue) => issue.code)).toContain('product_without_price');
  });

  it('a product that no longer exists in the mirror blocks sending as "Produto indisponível" (reason not known)', async () => {
    const code = priced[6]!.code as number;
    const created = await ctx.call('seller1', 'POST', '/orders', body([code]));
    expect(created.status).toBe(201);
    // The mirror row is gone altogether (not merely soft-deleted): nothing says why.
    await pool().query('update erp_product set code = code + 900000000 where code = $1', [code]);
    const read = await ctx.call('seller1', 'GET', `/orders/${created.body.id}`);
    expect(OrderDetailSchema.safeParse(read.body).success).toBe(true);
    expect(read.body.sendBlocks).toEqual([{ lineNo: 1, productCode: code, code: 'product_unavailable', message: 'Produto indisponível' }]);
    const submit = await ctx.call('seller1', 'POST', `/orders/${created.body.id}/submit`);
    expect(submit.status).toBe(400);
    expect(submit.body.message).toContain('Produto indisponível');
    expect(issuesOf(submit)).toEqual([{ code: 'product_unavailable', path: 'items[0].productCode' }]);
    expect((await ctx.call('seller1', 'GET', `/orders/${created.body.id}`)).body.status).toBe('draft');
    await pool().query('update erp_product set code = code - 900000000 where code = $1', [code + 900000000]);
  });

  it('an inactive product (the configuration does not show inactive ones) blocks sending as "Produto inativo"', async () => {
    const code = priced[7]!.code as number;
    const created = await ctx.call('seller1', 'POST', '/orders', body([code]));
    expect(created.status).toBe(201);
    await pool().query('update erp_product set active = false where code = $1', [code]);
    const read = await ctx.call('seller1', 'GET', `/orders/${created.body.id}`);
    expect(read.body.sendBlocks).toEqual([{ lineNo: 1, productCode: code, code: 'product_inactive', message: 'Produto inativo' }]);
    const submit = await ctx.call('seller1', 'POST', `/orders/${created.body.id}/submit`);
    expect(submit.status).toBe(400);
    expect(submit.body.message).toContain('Produto inativo');
    expect(issuesOf(submit)).toEqual([{ code: 'product_inactive', path: 'items[0].productCode' }]);
    await pool().query('update erp_product set active = true where code = $1', [code]);
  });

  it('keeps the demo configuration untouched (the legacy productWithoutPrice keys are ignored, never required)', () => {
    expect(DEMO_CONFIGURATION.products.productWithoutPrice.orderable).toBe(false);
  });
});
