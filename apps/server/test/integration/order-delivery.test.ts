import { randomUUID } from 'node:crypto';
import { auditLog, integrationOrderDryRun, integrationOutbox, salesOrder } from '@salesforce/db';
import { defaultUnconfiguredConfiguration, type InstallationConfiguration } from '@salesforce/domain';
import { FakeGateway, FakeOrderBook, SankhyaGatewayError, type OrderWriteRequest } from '@salesforce/sankhya';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditService } from '../../src/iam/audit.service.js';
import { MAX_DELIVERY_ATTEMPTS } from '../../src/integration/order-delivery.policy.js';
import {
  OrderDeliveryService,
  type OrderDeliveryGateway,
  type OrderDeliverySettings,
} from '../../src/integration/order-delivery.service.js';
import { createLogger } from '../../src/observability/logger.js';
import {
  closeAllThenStop,
  createMigratedDatabase,
  startPostgres,
  type MigratedDatabase,
  type TestPostgres,
} from '../helpers/postgres.js';

const ORIGIN_FIELD = 'AD_TESTE_ORIGEM';
const START = Date.parse('2026-10-30T12:00:00Z');

let postgres: TestPostgres;
const databases: MigratedDatabase[] = [];

beforeAll(async () => {
  postgres = await startPostgres();
});
afterAll(async () => {
  await closeAllThenStop(
    databases.map((database) => () => database.handle.close()),
    postgres,
  );
});

const err = (kind: ConstructorParameters<typeof SankhyaGatewayError>[0], code = `t_${kind}`) =>
  new SankhyaGatewayError(kind, { code, message: `synthetic ${kind}` });

function configuration(top = 1001): InstallationConfiguration {
  const base = defaultUnconfiguredConfiguration();
  return {
    ...base,
    general: { ...base.general, enabled: true, enabledCompanyCodes: [1], defaultCompanyCode: 1 },
    sales: { ...base.sales, orderTopCode: top, eligibleOrderTopCodes: [1000, 1001], orderStockLocationCode: 209 },
  };
}

interface SeedOptions {
  env?: string | null;
  unit?: string | null;
  noPrice?: boolean;
  notes?: string;
}

interface World {
  readonly database: MigratedDatabase;
  readonly book: FakeOrderBook;
  readonly service: OrderDeliveryService;
  readonly includes: OrderWriteRequest[];
  seed(over?: SeedOptions): Promise<{ orderId: string; outboxId: string }>;
  advance(ms: number): void;
  setConfiguration(value: InstallationConfiguration): Promise<void>;
  outbox(id: string): Promise<typeof integrationOutbox.$inferSelect>;
  order(id: string): Promise<typeof salesOrder.$inferSelect>;
}

async function world(options: { mode?: 'dry_run' | 'live'; book?: FakeOrderBook; unconfirmedTops?: number[] } = {}): Promise<World> {
  const database = await createMigratedDatabase(postgres);
  databases.push(database);
  const db = database.handle.db;
  const pool = database.handle.pool;
  const accountId = randomUUID();
  const configId = randomUUID();
  const clock = { ms: START };
  const book = options.book ?? new FakeOrderBook();
  const fake = new FakeGateway({ orders: book });
  const includes: OrderWriteRequest[] = [];
  const gateway: OrderDeliveryGateway = {
    includeOrder: (request, callOptions) => {
      includes.push(request);
      return fake.includeOrder(request, callOptions);
    },
    confirmOrder: (number, o) => fake.confirmOrder(number, o),
    findOrderByOrigin: (field, id, o) => fake.findOrderByOrigin(field, id, o),
    readWrittenOrder: (number, o) => fake.readWrittenOrder(number, o),
  };
  const now = () => new Date(clock.ms);
  const settings: OrderDeliverySettings = {
    mode: options.mode ?? 'live',
    originField: ORIGIN_FIELD,
    unconfirmedTops: options.unconfirmedTops ?? [1000],
    target: { environment: 'sandbox' },
  };
  const service = new OrderDeliveryService({
    db: database.handle,
    gateway,
    settings,
    audit: new AuditService(db, now),
    logger: createLogger({ level: 'silent', service: 'test' }),
    now,
  });
  await pool.query(
    `INSERT INTO account (id, email, display_name, password_hash, role) VALUES ($1, 'd@example.test', 'D', 'x', 'seller')`,
    [accountId],
  );
  await pool.query(
    `INSERT INTO installation_configuration_version (id, version_label, source_kind, payload, content_hash, synced_at, is_current)
     VALUES ($1, 'v1', 'demo', $2::jsonb, 'h', now(), true)`,
    [configId, JSON.stringify(configuration())],
  );
  const seed: World['seed'] = async (over = {}) => {
    const orderId = randomUUID();
    const outboxId = randomUUID();
    const env = over.env === undefined ? 'sandbox' : over.env;
    await pool.query(
      `INSERT INTO sales_order (id, customer_code, seller_code, created_by_account_id, status, negotiation_type_code, notes, client_request_id, config_version_id, dataset_origin, erp_environment, external_origin_id, created_at)
       VALUES ($1, 77, 9, $2, 'queued', 11, $3, $4, $5, 'sankhya', $6, $8, $7)`,
      [orderId, accountId, over.notes ?? 'Entregar pela manha', randomUUID(), configId, env, new Date(START), orderId],
    );
    await pool.query(
      `INSERT INTO sales_order_item (id, order_id, line_no, product_code, product_description, unit, quantity, unit_list_price, price_state, price_table_code, price_version_id, discount_percent, estimated_line_total)
       VALUES ($1, $2, 1, 4158, 'P', $3, 0.2, $4, $5, 1, 1, 8, $6)`,
      [
        randomUUID(),
        orderId,
        over.unit === undefined ? 'PT' : over.unit,
        over.noPrice === true ? null : '10',
        over.noPrice === true ? 'none' : 'priced',
        over.noPrice === true ? null : '1.84',
      ],
    );
    await pool.query(
      `INSERT INTO integration_outbox (id, aggregate_type, aggregate_id, operation, payload, origin_id, status, next_attempt_at, created_at)
       VALUES ($1, 'sales_order', $2, 'send_order', '{}', $4, 'pending', $3, $3)`,
      [outboxId, orderId, new Date(clock.ms), orderId],
    );
    return { orderId, outboxId };
  };
  return {
    database,
    book,
    service,
    includes,
    seed,
    advance: (ms) => {
      clock.ms += ms;
    },
    setConfiguration: async (value) => {
      await pool.query(`UPDATE installation_configuration_version SET payload = $1::jsonb`, [JSON.stringify(value)]);
    },
    outbox: async (id) => {
      const [row] = await db.select().from(integrationOutbox).where(eq(integrationOutbox.id, id));
      if (row === undefined) throw new Error('outbox row missing');
      return row;
    },
    order: async (id) => {
      const [row] = await db.select().from(salesOrder).where(eq(salesOrder.id, id));
      if (row === undefined) throw new Error('order missing');
      return row;
    },
  };
}

const ops = (book: FakeOrderBook) => book.calls.map((c) => c.operation);

describe('dry run (D-6)', () => {
  it('stores the sanitized payload, calls nothing and parks the row', async () => {
    const w = await world({ mode: 'dry_run' });
    const { orderId, outboxId } = await w.seed({ notes: 'Segredo do cliente 11 99999-0000' });
    const summary = await w.service.runDue();
    expect(summary.processed).toBe(1);
    expect(w.book.calls).toEqual([]);
    expect(w.book.orders).toEqual([]);
    expect(await w.outbox(outboxId)).toMatchObject({ status: 'pending', nextAttemptAt: null, lastStep: 'dry_run' });
    expect((await w.order(orderId)).status).toBe('queued');
    const [record] = await w.database.handle.db.select().from(integrationOrderDryRun);
    expect(record?.orderId).toBe(orderId);
    const text = JSON.stringify(record?.payload);
    expect(text).not.toContain('Segredo');
    expect(text).not.toContain('99999');
    expect(text).toMatch(/sha256:[0-9a-f]{64}/);
    expect(text).toContain(ORIGIN_FIELD);
    expect((await w.service.runDue()).processed).toBe(0);
    expect(await w.database.handle.db.select().from(integrationOrderDryRun)).toHaveLength(1);
  });

  it('purges records older than 30 days and keeps newer ones', async () => {
    const w = await world({ mode: 'dry_run' });
    await w.seed();
    await w.service.runDue();
    w.advance(31 * 24 * 3600_000);
    const second = await w.seed();
    await w.service.runDue();
    expect(await w.service.purgeDryRuns()).toBe(1);
    const left = await w.database.handle.db.select().from(integrationOrderDryRun);
    expect(left.map((r) => r.orderId)).toEqual([second.orderId]);
  });

  it('a configuration problem rejects the order instead of storing a broken payload', async () => {
    const w = await world({ mode: 'dry_run' });
    const { orderId, outboxId } = await w.seed({ unit: null });
    await w.service.runDue();
    expect(await w.outbox(outboxId)).toMatchObject({ status: 'rejected', lastErrorClass: 'validation' });
    expect((await w.order(orderId)).status).toBe('rejected');
    expect(await w.database.handle.db.select().from(integrationOrderDryRun)).toHaveLength(0);
  });
});

describe('live delivery', () => {
  it('verifies the origin, includes, confirms, rereads and ends sent with the ERP number', async () => {
    const w = await world();
    const { orderId, outboxId } = await w.seed();
    await w.service.runDue();
    expect(ops(w.book)).toEqual(['find', 'include', 'confirm', 'read']);
    expect(w.book.orders).toHaveLength(1);
    expect(w.book.orders[0]?.request).toMatchObject({
      originId: orderId,
      originField: ORIGIN_FIELD,
      companyCode: 1,
      topCode: 1001,
      stockLocationCode: 209,
      customerCode: 77,
      negotiationTypeCode: 11,
    });
    expect(w.book.orders[0]?.confirmed).toBe(true);
    const order = await w.order(orderId);
    expect(order).toMatchObject({ status: 'sent', erpNumber: w.book.orders[0]?.erpOrderNumber });
    expect(await w.outbox(outboxId)).toMatchObject({
      status: 'confirmed',
      lastStep: 'confirmed',
      nextAttemptAt: null,
      erpReference: String(order.erpNumber),
    });
    const audit = await w.database.handle.db.select().from(auditLog).where(eq(auditLog.action, 'order.erp_sent'));
    expect(audit).toHaveLength(1);
  });

  it('does not confirm an order of an unconfirmed TOP (quotation 1000, D-4) and still ends sent', async () => {
    const w = await world();
    await w.setConfiguration(configuration(1000));
    const { orderId } = await w.seed();
    await w.service.runDue();
    expect(ops(w.book)).toEqual(['find', 'include', 'read']);
    expect(w.book.orders[0]?.confirmed).toBe(false);
    expect((await w.order(orderId)).status).toBe('sent');
  });

  it('SNK-4: an include whose answer was lost is found by origin and linked, never sent twice', async () => {
    const w = await world();
    w.book.script('include', { kind: 'created_then_error', error: err('unavailable', 'http_503') });
    const { orderId, outboxId } = await w.seed();
    await w.service.runDue();
    expect(await w.outbox(outboxId)).toMatchObject({ status: 'unknown', lastErrorClass: 'unavailable' });
    expect(await w.order(orderId)).toMatchObject({ status: 'unknown', erpNumber: null });
    expect(w.book.orders).toHaveLength(1);
    expect((await w.service.runDue()).processed).toBe(0);
    w.advance(31_000);
    await w.service.runDue();
    expect(w.book.count('include')).toBe(1);
    expect(w.book.orders).toHaveLength(1);
    expect(await w.order(orderId)).toMatchObject({ status: 'sent', erpNumber: w.book.orders[0]?.erpOrderNumber });
    expect((await w.outbox(outboxId)).status).toBe('confirmed');
  });

  it('a failed include that created nothing is retried once with the same origin id and the frozen header', async () => {
    const w = await world();
    w.book.script('include', { kind: 'error', error: err('temporary') });
    const { orderId } = await w.seed();
    await w.service.runDue();
    await w.setConfiguration(configuration(1000));
    w.advance(31_000);
    await w.service.runDue();
    expect(w.includes).toHaveLength(2);
    expect(w.includes[1]).toEqual(w.includes[0]);
    expect(w.includes[0]?.originId).toBe(orderId);
    expect(w.includes[0]?.topCode).toBe(1001);
    expect(w.book.orders).toHaveLength(1);
    expect((await w.order(orderId)).status).toBe('sent');
  });

  it('a business refusal is final: rejected at once, never retried', async () => {
    const w = await world();
    w.book.script('include', { kind: 'error', error: err('validation', 'erp_refused_order') });
    const { orderId, outboxId } = await w.seed();
    await w.service.runDue();
    expect(await w.outbox(outboxId)).toMatchObject({ status: 'rejected', nextAttemptAt: null, lastErrorClass: 'validation' });
    expect(await w.order(orderId)).toMatchObject({ status: 'rejected', erpNumber: null });
    w.advance(3600_000);
    expect((await w.service.runDue()).processed).toBe(0);
    expect(w.book.count('include')).toBe(1);
  });

  it('exhausted attempts on a temporary error reject with class "exhausted" (D-2)', async () => {
    const w = await world();
    for (let i = 0; i < MAX_DELIVERY_ATTEMPTS; i += 1) w.book.script('find', { kind: 'error', error: err('unavailable') });
    const { orderId, outboxId } = await w.seed();
    for (let i = 0; i < MAX_DELIVERY_ATTEMPTS; i += 1) {
      await w.service.runDue();
      w.advance(16 * 60_000);
    }
    expect(await w.outbox(outboxId)).toMatchObject({
      status: 'rejected',
      lastErrorClass: 'exhausted',
      attemptCount: MAX_DELIVERY_ATTEMPTS,
    });
    expect((await w.order(orderId)).status).toBe('rejected');
    expect(w.book.count('include')).toBe(0);
  });

  it('an authentication failure waits 15 minutes and does not consume an attempt', async () => {
    const w = await world();
    w.book.script('find', { kind: 'error', error: err('auth') });
    const { outboxId } = await w.seed();
    await w.service.runDue();
    const row = await w.outbox(outboxId);
    expect(row).toMatchObject({ status: 'pending', attemptCount: 0, lastErrorClass: 'auth' });
    expect(row.nextAttemptAt?.getTime()).toBe(START + 15 * 60_000);
  });

  it('D-4: a failure only at confirmation keeps the number and redoes only the confirmation', async () => {
    const w = await world();
    w.book.script('confirm', { kind: 'error', error: err('unavailable') });
    const { orderId, outboxId } = await w.seed();
    await w.service.runDue();
    const middle = await w.order(orderId);
    expect(middle.status).toBe('unknown');
    expect(middle.erpNumber).toBe(w.book.orders[0]?.erpOrderNumber);
    expect(await w.outbox(outboxId)).toMatchObject({ status: 'unknown', erpReference: String(middle.erpNumber) });
    w.advance(31_000);
    await w.service.runDue();
    expect(w.book.count('include')).toBe(1);
    expect(w.book.count('confirm')).toBe(2);
    expect((await w.order(orderId)).status).toBe('sent');
  });

  it('a permanent failure at confirmation parks the order for a person without rejecting a real order', async () => {
    const w = await world();
    w.book.script('confirm', { kind: 'error', error: err('permanent', 'not_implemented') });
    const { orderId, outboxId } = await w.seed();
    await w.service.runDue();
    expect(await w.outbox(outboxId)).toMatchObject({ status: 'unknown', nextAttemptAt: null });
    expect(await w.order(orderId)).toMatchObject({ status: 'unknown' });
    w.advance(3600_000);
    expect((await w.service.runDue()).processed).toBe(0);
  });

  it('D-7: an ERP that ignored the discount makes the order fail, keeping its number', async () => {
    const w = await world({ book: new FakeOrderBook({ ignoreDiscount: true }) });
    const { orderId, outboxId } = await w.seed();
    await w.service.runDue();
    expect(await w.outbox(outboxId)).toMatchObject({ status: 'rejected', lastErrorClass: 'validation' });
    const order = await w.order(orderId);
    expect(order.status).toBe('rejected');
    expect(order.erpNumber).toBe(w.book.orders[0]?.erpOrderNumber);
  });

  it('D-7: an ERP price different from the table price makes the order fail', async () => {
    const w = await world({ book: new FakeOrderBook({ priceOf: () => '11' }) });
    const { orderId } = await w.seed();
    await w.service.runDue();
    expect((await w.order(orderId)).status).toBe('rejected');
  });

  it('refuses an order bound to another ERP environment before any call', async () => {
    const w = await world();
    const { orderId, outboxId } = await w.seed({ env: 'production' });
    await w.service.runDue();
    expect(w.book.calls).toEqual([]);
    expect(await w.outbox(outboxId)).toMatchObject({ status: 'rejected' });
    expect((await w.order(orderId)).status).toBe('rejected');
  });

  it('refuses a line without price before any call', async () => {
    const w = await world();
    const { outboxId } = await w.seed({ noPrice: true });
    await w.service.runDue();
    expect(w.book.calls).toEqual([]);
    expect(await w.outbox(outboxId)).toMatchObject({ status: 'rejected' });
  });

  it('recovers a row left processing by a dead worker as unknown and verifies it by origin (no resend)', async () => {
    const w = await world();
    const { orderId, outboxId } = await w.seed();
    w.book.include({
      originId: orderId,
      originField: ORIGIN_FIELD,
      customerCode: 77,
      sellerCode: 9,
      companyCode: 1,
      topCode: 1001,
      negotiationTypeCode: 11,
      carrierCode: null,
      stockLocationCode: 209,
      orderDate: '2026-10-30',
      notes: null,
      items: [{ productCode: 4158, quantity: '0.2', unit: 'PT', discountPercent: '8' }],
    });
    w.book.calls.length = 0;
    await w.database.handle.pool.query(
      `UPDATE integration_outbox SET status = 'processing', attempt_count = 1, updated_at = $2 WHERE id = $1`,
      [outboxId, new Date(START - 11 * 60_000)],
    );
    const summary = await w.service.runDue();
    expect(summary.recovered).toBe(1);
    expect(w.book.count('include')).toBe(0);
    expect(w.book.orders).toHaveLength(1);
    expect((await w.order(orderId)).status).toBe('sent');
  });

  it('two sweeps at once never deliver the same order twice', async () => {
    const w = await world();
    const ids = await Promise.all([w.seed(), w.seed(), w.seed()]);
    await Promise.all([w.service.runDue(), w.service.runDue()]);
    expect(w.book.count('include')).toBe(3);
    expect(w.book.orders).toHaveLength(3);
    for (const { orderId } of ids) expect((await w.order(orderId)).status).toBe('sent');
  });
});
