import { randomUUID } from 'node:crypto';
import { DraftIssueCodeSchema, OrderDetailSchema, RepeatLastOrderResponseSchema } from '@salesforce/contracts';
import { auditLog, salesOrder } from '@salesforce/db';
import type { InstallationConfiguration } from '@salesforce/domain';
import { DEMO_CONFIGURATION, getDemoDataset } from '@salesforce/sankhya';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startCommercialApp, type CommercialApp, type Json } from '../helpers/commercial-app.js';
import { startPostgres, type TestPostgres, closeAllThenStop } from '../helpers/postgres.js';

/**
 * D-A / D-B: the order carries its TOP (default 1001, eligible 1001 and 1000), validated server-side; a quotation
 * (TOP 1000) is turned into an ordinary draft with TOP 1001 by "duplicate as order"; non-sellable negotiation types
 * (return types such as 23 and 24) never reach an API list.
 */
const dataset = getDemoDataset();
let postgres: TestPostgres;
const opened: (() => Promise<unknown>)[] = [];
let app: CommercialApp;
let customerCode: number;
let products: Json[];

const configuration: InstallationConfiguration = {
  ...DEMO_CONFIGURATION,
  sales: {
    ...DEMO_CONFIGURATION.sales,
    orderTopCode: 1001,
    quotationTopCode: 1000,
    eligibleOrderTopCodes: [1001, 1000],
    defaultNegotiationTypeCode: null,
    negotiationTypes: [
      { code: 2, label: 'A VISTA' },
      { code: 3, label: 'A PRAZO' },
      { code: 23, label: 'DEVOLUCAO', sellable: false },
      { code: 24, label: 'DEVOLUCAO 2', sellable: false },
    ],
  },
};

beforeAll(async () => {
  postgres = await startPostgres();
  app = await startCommercialApp(postgres, opened, { configuration });
  const c = dataset.customers.find((x) => x.sellerCode === 103 && x.active && !x.blocked && x.priceTableCode === 21);
  if (c === undefined) throw new Error('fixture lacks an orderable customer');
  customerCode = c.code;
  products = (await app.call('manager', 'GET', `/products?customerCode=${customerCode}&pageSize=10&sellable=true&priceState=priced`)).body.items;
});

afterAll(async () => {
  await closeAllThenStop(opened, postgres);
});

const body = (overrides: Record<string, unknown> = {}) => ({
  clientRequestId: randomUUID(),
  customerCode,
  negotiationTypeCode: 2,
  notes: 'obs',
  items: [
    { productCode: products[0].code, quantity: '2' },
    { productCode: products[1].code, quantity: '0.5', discountPercent: '10' },
  ],
  ...overrides,
});
const create = (overrides: Record<string, unknown> = {}) => app.call('seller1', 'POST', '/orders', body(overrides));
const replaceBody = (extra: Record<string, unknown>, expectedVersion: number) => {
  const { clientRequestId: _omit, ...rest } = body(extra);
  return { ...rest, expectedVersion };
};
const duplicate = (id: string, clientRequestId: string = randomUUID(), who: 'seller1' | 'seller2' | 'manager' = 'seller1') =>
  app.call(who, 'POST', `/orders/${id}/duplicate-as-order`, { clientRequestId });

describe('order TOP', () => {
  it('defaults to the configured order TOP and is exposed in the detail and list', async () => {
    const created = await create();
    expect(created.status).toBe(201);
    expect(OrderDetailSchema.parse(created.body).topCode).toBe(1001);
    expect(created.body.sourceOrderId).toBeNull();
    const listed = await app.call('seller1', 'GET', '/orders?pageSize=100');
    expect(listed.body.items.find((o: Json) => o.id === created.body.id).topCode).toBe(1001);
  });

  it('accepts the quotation TOP and refuses a TOP outside the eligible list', async () => {
    const quotation = await create({ topCode: 1000 });
    expect(quotation.status).toBe(201);
    expect(quotation.body.topCode).toBe(1000);

    const refused = await create({ topCode: 1051 });
    expect(refused.status).toBe(400);
    expect(refused.body.details.issues).toEqual([{ path: 'topCode', code: 'order_top_not_eligible' }]);
    expect(DraftIssueCodeSchema.safeParse('order_top_not_eligible').success).toBe(true);
  });

  it('replace keeps the current TOP when none is sent, changes it when an eligible one is sent', async () => {
    const quotation = await create({ topCode: 1000 });
    const kept = await app.call('seller1', 'PUT', `/orders/${quotation.body.id}`, replaceBody({}, quotation.body.version));
    expect(kept.status).toBe(200);
    expect(kept.body.topCode).toBe(1000);
    const refused = await app.call('seller1', 'PUT', `/orders/${quotation.body.id}`, replaceBody({ topCode: 7 }, kept.body.version));
    expect(refused.status).toBe(400);
    const changed = await app.call('seller1', 'PUT', `/orders/${quotation.body.id}`, replaceBody({ topCode: 1001 }, kept.body.version));
    expect(changed.body.topCode).toBe(1001);
  });

  it('an idempotent replay of the same request returns the original; a different TOP under the same id conflicts', async () => {
    const request = body({ topCode: 1000 });
    const first = await app.call('seller1', 'POST', '/orders', request);
    const replay = await app.call('seller1', 'POST', '/orders', request);
    expect(first.status).toBe(201);
    expect(replay.status).toBe(200);
    expect(replay.body.id).toBe(first.body.id);
    const other = await app.call('seller1', 'POST', '/orders', { ...request, topCode: 1001 });
    expect(other.status).toBe(409);
  });
});

describe('duplicate as order', () => {
  it('201: a new draft with the order TOP, same lines, negotiation type, notes and discounts; source untouched', async () => {
    const quotation = await create({ topCode: 1000 });
    const clientRequestId = randomUUID();
    const result = await duplicate(quotation.body.id, clientRequestId);
    expect(result.status).toBe(201);
    const parsed = RepeatLastOrderResponseSchema.parse(result.body);
    expect(parsed.skippedLines).toEqual([]);
    expect(parsed.order.id).not.toBe(quotation.body.id);
    expect(parsed.order.topCode).toBe(1001);
    expect(parsed.order.status).toBe('draft');
    expect(parsed.order.sourceOrderId).toBe(quotation.body.id);
    expect(parsed.order.negotiationTypeCode).toBe(2);
    expect(parsed.order.notes).toBe('obs');
    expect(parsed.order.items.map((i) => [i.productCode, i.quantity, i.discountPercent])).toEqual([
      [products[0].code, '2', '0'],
      [products[1].code, '0.5', '10'],
    ]);

    const source = await app.call('seller1', 'GET', `/orders/${quotation.body.id}`);
    expect(source.body.topCode).toBe(1000);
    expect(source.body.version).toBe(quotation.body.version);
    expect(source.body.status).toBe('draft');

    const replay = await duplicate(quotation.body.id, clientRequestId);
    expect(replay.status).toBe(200);
    expect(replay.body.order.id).toBe(parsed.order.id);
    const rows = await app.database.handle.db.select().from(salesOrder).where(eq(salesOrder.sourceOrderId, quotation.body.id));
    expect(rows).toHaveLength(1);
  });

  it('audits the duplication', async () => {
    const quotation = await create({ topCode: 1000 });
    const result = await duplicate(quotation.body.id);
    const rows = (await app.database.handle.db.select().from(auditLog)).filter((r) => r.action === 'order.duplicated_as_order');
    expect(rows.some((r) => (r.detail as Json).orderId === result.body.order.id && (r.detail as Json).sourceOrderId === quotation.body.id)).toBe(true);
  });

  it('409 not_a_quotation when the source carries the order TOP', async () => {
    const plain = await create();
    const result = await duplicate(plain.body.id);
    expect(result.status).toBe(409);
    expect(result.body.details.reason).toBe('not_a_quotation');
  });

  it('404 for a source outside the caller scope or unknown', async () => {
    const quotation = await create({ topCode: 1000 });
    expect((await duplicate(quotation.body.id, randomUUID(), 'seller2')).status).toBe(404);
    expect((await duplicate(randomUUID())).status).toBe(404);
  });

  it('a cancelled quotation cannot be duplicated', async () => {
    const quotation = await create({ topCode: 1000 });
    await app.call('seller1', 'DELETE', `/orders/${quotation.body.id}`);
    expect((await duplicate(quotation.body.id)).status).toBe(409);
  });

  it('the same clientRequestId for a different source conflicts', async () => {
    const a = await create({ topCode: 1000 });
    const b = await create({ topCode: 1000 });
    const id = randomUUID();
    expect((await duplicate(a.body.id, id)).status).toBe(201);
    expect((await duplicate(b.body.id, id)).status).toBe(409);
  });
});

describe('negotiation types are only the sellable ones', () => {
  it('order-entry configuration and summary list no return type', async () => {
    const entry = await app.call('seller1', 'GET', '/order-entry/configuration');
    expect(entry.body.sales.negotiationTypes.map((t: Json) => t.code)).toEqual([2, 3]);
    expect(entry.body.sales.orderTops).toEqual({ defaultTopCode: 1001, quotationTopCode: 1000, eligibleTopCodes: [1001, 1000] });
    const summary = await app.call('admin', 'GET', '/configuration');
    expect(summary.body.configuration.sales.negotiationTypes.map((t: Json) => t.code)).toEqual([2, 3]);
  });

  it('a draft with a return type is refused', async () => {
    for (const code of [23, 24]) {
      const refused = await create({ negotiationTypeCode: code });
      expect(refused.status).toBe(400);
      expect(refused.body.details.issues).toContainEqual({ path: 'negotiationTypeCode', code: 'negotiation_type_not_configured' });
    }
  });
});

describe('order carrier (D-C)', () => {
  const activeCarrier = dataset.carriers.find((c) => c.active) as { code: number; name: string };
  const inactiveCarrier = dataset.carriers.find((c) => !c.active) as { code: number };

  it('GET /carriers lists the active mirrored carriers by name, code and name only', async () => {
    const result = await app.call('seller1', 'GET', '/carriers');
    expect(result.status).toBe(200);
    const expected = dataset.carriers
      .filter((c) => c.active)
      .map((c) => ({ code: c.code, name: c.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    expect(result.body.items).toEqual(expected);
    expect(result.body.items.map((c: Json) => c.code)).not.toContain(inactiveCarrier.code);
  });

  it('is optional: an order without a carrier reads carrierCode null', async () => {
    const created = await create();
    expect(created.status).toBe(201);
    expect(created.body.carrierCode).toBeNull();
  });

  it('stores a valid carrier, exposes it in detail and list, and refuses an unknown or inactive one', async () => {
    const created = await create({ carrierCode: activeCarrier.code });
    expect(created.status).toBe(201);
    expect(created.body.carrierCode).toBe(activeCarrier.code);
    const listed = await app.call('seller1', 'GET', '/orders?pageSize=100');
    expect(listed.body.items.find((o: Json) => o.id === created.body.id).carrierCode).toBe(activeCarrier.code);

    for (const code of [987654, inactiveCarrier.code]) {
      const refused = await create({ carrierCode: code });
      expect(refused.status).toBe(400);
      expect(refused.body.details.issues).toEqual([{ path: 'carrierCode', code: 'carrier_unknown' }]);
    }
  });

  it('replace keeps the carrier when omitted, clears it with null and changes it with a valid code', async () => {
    const created = await create({ carrierCode: activeCarrier.code });
    const kept = await app.call('seller1', 'PUT', `/orders/${created.body.id}`, replaceBody({}, created.body.version));
    expect(kept.body.carrierCode).toBe(activeCarrier.code);
    const cleared = await app.call('seller1', 'PUT', `/orders/${created.body.id}`, replaceBody({ carrierCode: null }, kept.body.version));
    expect(cleared.body.carrierCode).toBeNull();
    const refused = await app.call('seller1', 'PUT', `/orders/${created.body.id}`, replaceBody({ carrierCode: 987654 }, cleared.body.version));
    expect(refused.status).toBe(400);
  });

  it('a different carrier under the same clientRequestId conflicts; the same request replays', async () => {
    const request = body({ carrierCode: activeCarrier.code });
    const first = await app.call('seller1', 'POST', '/orders', request);
    const replay = await app.call('seller1', 'POST', '/orders', request);
    expect(first.status).toBe(201);
    expect(replay.status).toBe(200);
    const other = await app.call('seller1', 'POST', '/orders', { ...request, carrierCode: undefined });
    expect(other.status).toBe(409);
  });

  it('duplicate as order keeps the quotation carrier', async () => {
    const quotation = await create({ topCode: 1000, carrierCode: activeCarrier.code });
    const result = await duplicate(quotation.body.id);
    expect(result.status).toBe(201);
    expect(result.body.order.carrierCode).toBe(activeCarrier.code);
  });
});
