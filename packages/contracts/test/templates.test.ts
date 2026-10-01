import { describe, expect, it } from 'vitest';
import {
  CreateOrderTemplateRequestSchema,
  RepeatLastOrderRequestSchema,
  RepeatLastOrderResponseSchema,
  ReplaceOrderTemplateRequestSchema,
  UseOrderTemplateRequestSchema,
  UseOrderTemplateResponseSchema,
  routes,
} from '../src/index.js';

const DATASET = { environment: 'sandbox', datasetId: 'plac-sandbox-real-1' };

const id = '019a0000-0000-7000-8000-000000000001';
const item = { productCode: 10, quantity: '2.5' };
const many = (n: number) => Array.from({ length: n }, (_, i) => ({ productCode: i + 1, quantity: '1' }));

describe('order template routes', () => {
  it('are session routes under the customer and the template, with the documented statuses and caps', () => {
    const shape = (route: { method: string; path: string; auth: string }) => `${route.method} ${route.path} ${route.auth}`;
    expect(shape(routes.listOrderTemplates)).toBe('get /customers/{code}/order-templates session');
    expect(shape(routes.createOrderTemplate)).toBe('post /customers/{code}/order-templates session');
    expect(shape(routes.getOrderTemplate)).toBe('get /order-templates/{id} session');
    expect(shape(routes.replaceOrderTemplate)).toBe('put /order-templates/{id} session');
    expect(shape(routes.deleteOrderTemplate)).toBe('delete /order-templates/{id} session');
    expect(shape(routes.useOrderTemplate)).toBe('post /order-templates/{id}/use session');
    expect(Object.keys(routes.createOrderTemplate.responses).sort()).toEqual(['200', '201']);
    expect(Object.keys(routes.useOrderTemplate.responses).sort()).toEqual(['200', '201']);
    expect(Object.keys(routes.deleteOrderTemplate.responses)).toEqual(['204']);
    expect(routes.createOrderTemplate.maxBodyBytes).toBe(128 * 1024);
    expect(routes.replaceOrderTemplate.maxBodyBytes).toBe(128 * 1024);
    expect(routes.useOrderTemplate.maxBodyBytes).toBeLessThanOrEqual(4 * 1024);
  });
});

describe('create / replace template requests', () => {
  it('trim the name and accept 1 to 500 lines', () => {
    const parsed = CreateOrderTemplateRequestSchema.parse({ clientRequestId: id, expectedDataset: DATASET, name: '  Reposição  ', items: [item] });
    expect(parsed.name).toBe('Reposição');
    expect(CreateOrderTemplateRequestSchema.safeParse({ clientRequestId: id, expectedDataset: DATASET, name: 'a', items: many(500) }).success).toBe(true);
    expect(CreateOrderTemplateRequestSchema.safeParse({ clientRequestId: id, expectedDataset: DATASET, name: 'a', items: many(501) }).success).toBe(false);
    expect(CreateOrderTemplateRequestSchema.safeParse({ clientRequestId: id, expectedDataset: DATASET, name: 'a', items: [] }).success).toBe(false);
  });

  it('bound the name: 1..80, no control characters', () => {
    const attempt = (name: unknown) => CreateOrderTemplateRequestSchema.safeParse({ clientRequestId: id, expectedDataset: DATASET, name, items: [item] }).success;
    expect(attempt('a'.repeat(80))).toBe(true);
    expect(attempt('a'.repeat(81))).toBe(false);
    for (const bad of ['', '   ', 'a\nb', 'a\u0000b', 'a\u007fb', 7, null]) expect(attempt(bad), String(bad)).toBe(false);
  });

  it('never accept a price, discount, note or unknown key (strict), on the request or on a line', () => {
    const base = { clientRequestId: id, expectedDataset: DATASET, name: 'a', items: [item] };
    expect(CreateOrderTemplateRequestSchema.safeParse({ ...base, notes: 'x' }).success).toBe(false);
    expect(CreateOrderTemplateRequestSchema.safeParse({ ...base, items: [{ ...item, unitPrice: '1' }] }).success).toBe(false);
    expect(CreateOrderTemplateRequestSchema.safeParse({ ...base, items: [{ ...item, discountPercent: '1' }] }).success).toBe(false);
    expect(CreateOrderTemplateRequestSchema.safeParse({ ...base, items: [{ productCode: 1, quantity: 2 }] }).success).toBe(false);
  });

  it('require expectedDataset on create and replace (no default, strict shape)', () => {
    expect(CreateOrderTemplateRequestSchema.safeParse({ clientRequestId: id, name: 'a', items: [item] }).success).toBe(false);
    expect(ReplaceOrderTemplateRequestSchema.safeParse({ expectedVersion: 1, name: 'a', items: [item] }).success).toBe(false);
    for (const bad of [null, {}, { environment: 'sandbox' }, { ...DATASET, extra: 1 }]) {
      expect(CreateOrderTemplateRequestSchema.safeParse({ clientRequestId: id, expectedDataset: bad, name: 'a', items: [item] }).success).toBe(false);
      expect(ReplaceOrderTemplateRequestSchema.safeParse({ expectedVersion: 1, expectedDataset: bad, name: 'a', items: [item] }).success).toBe(false);
    }
  });

  it('replace carries expectedVersion and no clientRequestId', () => {
    expect(ReplaceOrderTemplateRequestSchema.safeParse({ expectedVersion: 1, expectedDataset: DATASET, name: 'a', items: [item] }).success).toBe(true);
    expect(ReplaceOrderTemplateRequestSchema.safeParse({ name: 'a', items: [item] }).success).toBe(false);
    expect(ReplaceOrderTemplateRequestSchema.safeParse({ expectedVersion: 0, expectedDataset: DATASET, name: 'a', items: [item] }).success).toBe(false);
    expect(ReplaceOrderTemplateRequestSchema.safeParse({ expectedVersion: 1, clientRequestId: id, expectedDataset: DATASET, name: 'a', items: [item] }).success).toBe(false);
  });

  it('use takes a client request id and the expected dataset', () => {
    expect(UseOrderTemplateRequestSchema.safeParse({ clientRequestId: id, expectedDataset: DATASET }).success).toBe(true);
    expect(UseOrderTemplateRequestSchema.safeParse({ clientRequestId: id }).success).toBe(false);
    expect(UseOrderTemplateRequestSchema.safeParse({}).success).toBe(false);
    expect(UseOrderTemplateRequestSchema.safeParse({ clientRequestId: id, expectedDataset: DATASET, customerCode: 1 }).success).toBe(false);
  });
});

describe('use response', () => {
  it('reports skipped lines with a stable reason', () => {
    const shape = UseOrderTemplateResponseSchema.shape.skippedLines;
    expect(shape.safeParse([{ lineNo: 1, productCode: 3, reason: 'no_price' }]).success).toBe(true);
    expect(shape.safeParse([{ lineNo: 1, productCode: 3, reason: 'because' }]).success).toBe(false);
  });
});

describe('repeat last order route', () => {
  it('is a session route under the customer, with the documented statuses and a small body cap', () => {
    const shape = (route: { method: string; path: string; auth: string }) => `${route.method} ${route.path} ${route.auth}`;
    expect(shape(routes.repeatLastOrder)).toBe('post /customers/{code}/orders/repeat-last session');
    expect(Object.keys(routes.repeatLastOrder.responses).sort()).toEqual(['200', '201']);
    expect(routes.repeatLastOrder.errors).toEqual([400, 401, 403, 404, 409]);
    expect(routes.repeatLastOrder.maxBodyBytes).toBeLessThanOrEqual(4 * 1024);
  });

  it('the request takes a client request id and the expected dataset (same shape as useOrderTemplate)', () => {
    expect(RepeatLastOrderRequestSchema.safeParse({ clientRequestId: id, expectedDataset: DATASET }).success).toBe(true);
    expect(RepeatLastOrderRequestSchema.safeParse({ clientRequestId: id }).success).toBe(false);
    expect(RepeatLastOrderRequestSchema.safeParse({}).success).toBe(false);
    expect(RepeatLastOrderRequestSchema.safeParse({ clientRequestId: id, expectedDataset: DATASET, customerCode: 1 }).success).toBe(false);
  });

  it('the response reports skipped lines with the same stable reason vocabulary as useOrderTemplate', () => {
    const shape = RepeatLastOrderResponseSchema.shape.skippedLines;
    expect(shape.safeParse([{ lineNo: 1, productCode: 3, reason: 'no_price' }]).success).toBe(true);
    expect(shape.safeParse([{ lineNo: 1, productCode: 3, reason: 'because' }]).success).toBe(false);
  });
});
