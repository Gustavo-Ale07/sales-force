import { randomUUID } from 'node:crypto';
import { salesOrder } from '@salesforce/db';
import { defaultUnconfiguredConfiguration, type InstallationConfiguration } from '@salesforce/domain';
import { FakeGateway, FakeOrderBook, SankhyaGatewayError } from '@salesforce/sankhya';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditService } from '../../src/iam/audit.service.js';
import { requeueDeliveredOrder } from '../../src/integration/order-resend.js';
import { OrderDeliveryService, type OrderDeliveryGateway } from '../../src/integration/order-delivery.service.js';
import { OrderErpStatusService } from '../../src/integration/order-erp-status.service.js';
import { createLogger } from '../../src/observability/logger.js';
import { closeAllThenStop, createMigratedDatabase, startPostgres, type MigratedDatabase, type TestPostgres } from '../helpers/postgres.js';

/**
 * docs/sync-acceptance.md, scenarios A3 (order deleted in Sankhya + "Sincronizar agora") and A4 (resend never duplicates).
 * Neighbours of the tests already in order-erp-status.test.ts / order-delivery.test.ts: here the manual refresh (`confirmNow`),
 * the unsent-work rule and repeated resends.
 */
const NOW = Date.parse('2026-11-25T12:00:00Z');
let postgres: TestPostgres;
const databases: MigratedDatabase[] = [];
beforeAll(async () => {
  postgres = await startPostgres();
});
afterAll(async () => {
  await closeAllThenStop(databases.map((d) => () => d.handle.close()), postgres);
});

const logger = createLogger({ level: 'silent', service: 'test' });

async function base() {
  const database = await createMigratedDatabase(postgres);
  databases.push(database);
  const pool = database.handle.pool;
  const accountId = randomUUID();
  const configId = randomUUID();
  const base = defaultUnconfiguredConfiguration();
  const configuration: InstallationConfiguration = {
    ...base,
    general: { ...base.general, enabled: true, enabledCompanyCodes: [1], defaultCompanyCode: 1 },
    sales: { ...base.sales, orderTopCode: 1001, eligibleOrderTopCodes: [1000, 1001], orderStockLocationCode: 209 },
  };
  await pool.query(`INSERT INTO account (id, email, display_name, password_hash, role) VALUES ($1, 'a@example.test', 'A', 'x', 'seller')`, [accountId]);
  await pool.query(
    `INSERT INTO installation_configuration_version (id, version_label, source_kind, payload, content_hash, synced_at, is_current)
     VALUES ($1, 'v1', 'demo', $2::jsonb, 'h', now(), true)`,
    [configId, JSON.stringify(configuration)],
  );
  const seed = async (over: { erpNumber?: number | null; status?: string } = {}): Promise<string> => {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO sales_order (id, customer_code, seller_code, created_by_account_id, status, negotiation_type_code, freight_type, client_request_id, config_version_id, dataset_origin, erp_environment, external_origin_id, erp_number, created_at)
       VALUES ($1, 77, 9, $2, $3, 11, 'FOB', $4, $5, 'sankhya', 'sandbox', $8, $6, $7)`,
      [id, accountId, over.status ?? 'sent', randomUUID(), configId, over.erpNumber ?? null, new Date(NOW - 3600_000), id],
    );
    return id;
  };
  const row = async (id: string) => (await database.handle.db.select().from(salesOrder).where(eq(salesOrder.id, id)))[0]!;
  return { database, pool, seed, row };
}

describe('A3: "Sincronizar agora" removes an order deleted in Sankhya (confirmNow)', () => {
  const header = { statusNota: 'L', pending: 'N' } as const;
  const refreshNow = (db: MigratedDatabase, gateway: unknown) =>
    new OrderErpStatusService({ db: db.handle, gateway: gateway as never, logger, now: () => new Date(NOW) }).runReleaseOnce({ confirmNow: true });

  it('one confirmed absence is enough, live notes and unsent work stay, and the note coming back restores it (audited)', async () => {
    const w = await base();
    const gone = await w.seed({ erpNumber: 7001 });
    const kept1 = await w.seed({ erpNumber: 7002 });
    const kept2 = await w.seed({ erpNumber: 7003 });
    const draft = await w.seed({ status: 'draft' }); // local work never sent: no NUNOTA, never judged
    const queued = await w.seed({ status: 'queued' }); // waiting for the worker: same
    const book = new FakeOrderBook();
    book.noteHeaders.set(7002, header);
    book.noteHeaders.set(7003, header);
    const gateway = new FakeGateway({ orders: book });

    await refreshNow(w.database, gateway);
    expect((await w.row(gone)).erpRemovedAt).not.toBeNull();
    for (const id of [kept1, kept2, draft, queued]) expect((await w.row(id)).erpRemovedAt).toBeNull();

    book.noteHeaders.set(7001, header); // NUNOTA reappears (restored in Sankhya)
    await refreshNow(w.database, gateway);
    expect(await w.row(gone)).toMatchObject({ erpRemovedAt: null, erpMissingChecks: 0 });
    const actions = (await w.pool.query<{ action: string }>(`select action from audit_log where action like 'order.erp_%' order by at`)).rows.map((r) => r.action);
    expect(actions).toEqual(['order.erp_removed', 'order.erp_restored']);
  });

  it('mass-absence guard holds for the manual refresh too: every note "gone" at once removes nothing', async () => {
    const w = await base();
    const ids = [await w.seed({ erpNumber: 7101 }), await w.seed({ erpNumber: 7102 }), await w.seed({ erpNumber: 7103 })];
    await refreshNow(w.database, new FakeGateway({ orders: new FakeOrderBook() }));
    for (const id of ids) expect(await w.row(id)).toMatchObject({ erpRemovedAt: null, erpMissingChecks: 0 });
  });

  it('a Sankhya read failure removes nothing, even on the manual refresh', async () => {
    const w = await base();
    const id = await w.seed({ erpNumber: 7201 });
    const down = () => Promise.reject(new SankhyaGatewayError('unavailable', { code: 'down', message: 'down' }));
    await refreshNow(w.database, { readOrderReleaseFacts: down, readOrderStatusFacts: down, readOrderStageFacts: down, findOrderByOrigin: down });
    expect(await w.row(id)).toMatchObject({ erpRemovedAt: null, erpMissingChecks: 0 });
  });
});

describe('A4: resend never duplicates the note in Sankhya (AD_FORCEORIGEM)', () => {
  it('three resends in a row: the origin id is found each time, one include, exactly one note per origin', async () => {
    const database = await createMigratedDatabase(postgres);
    databases.push(database);
    const pool = database.handle.pool;
    const accountId = randomUUID();
    const configId = randomUUID();
    const baseCfg = defaultUnconfiguredConfiguration();
    const configuration: InstallationConfiguration = {
      ...baseCfg,
      general: { ...baseCfg.general, enabled: true, enabledCompanyCodes: [1], defaultCompanyCode: 1 },
      sales: { ...baseCfg.sales, orderTopCode: 1001, eligibleOrderTopCodes: [1000, 1001], orderStockLocationCode: 209 },
    };
    await pool.query(`INSERT INTO account (id, email, display_name, password_hash, role) VALUES ($1, 'r@example.test', 'R', 'x', 'seller')`, [accountId]);
    await pool.query(
      `INSERT INTO installation_configuration_version (id, version_label, source_kind, payload, content_hash, synced_at, is_current)
       VALUES ($1, 'v1', 'demo', $2::jsonb, 'h', now(), true)`,
      [configId, JSON.stringify(configuration)],
    );
    const orderId = randomUUID();
    await pool.query(
      `INSERT INTO sales_order (id, customer_code, seller_code, created_by_account_id, status, negotiation_type_code, freight_type, client_request_id, config_version_id, dataset_origin, erp_environment, external_origin_id, created_at)
       VALUES ($1, 77, 9, $2, 'queued', 11, 'FOB', $3, $4, 'sankhya', 'sandbox', $6, $5)`,
      [orderId, accountId, randomUUID(), configId, new Date(NOW), orderId],
    );
    await pool.query(
      `INSERT INTO sales_order_item (id, order_id, line_no, product_code, product_description, unit, quantity, unit_list_price, price_state, price_table_code, price_version_id, discount_percent, estimated_line_total)
       VALUES ($1, $2, 1, 4158, 'P', 'PT', 1, '10', 'priced', 1, 1, 0, '10')`,
      [randomUUID(), orderId],
    );
    await pool.query(
      `INSERT INTO integration_outbox (id, aggregate_type, aggregate_id, operation, payload, origin_id, status, next_attempt_at, created_at)
       VALUES ($1, 'sales_order', $2, 'send_order', '{}', $4, 'pending', $3, $3)`,
      [randomUUID(), orderId, new Date(NOW), orderId],
    );
    const book = new FakeOrderBook();
    const gateway = new FakeGateway({ orders: book });
    const clock = { ms: NOW };
    const now = () => new Date(clock.ms);
    const service = new OrderDeliveryService({
      db: database.handle,
      gateway: gateway as unknown as OrderDeliveryGateway,
      settings: { mode: 'live', originField: 'AD_FORCEORIGEM', target: { environment: 'sandbox' } },
      audit: new AuditService(database.handle.db, now),
      logger,
      now,
    });
    const audit = new AuditService(database.handle.db, now);
    const countByOrigin = () => book.orders.filter((o) => o.request.originId === orderId).length; // SELECT COUNT(*) FROM TGFCAB WHERE AD_FORCEORIGEM = :id

    await service.runDue();
    const erpNumber = (await database.handle.db.select().from(salesOrder).where(eq(salesOrder.id, orderId)))[0]!.erpNumber;
    expect(erpNumber).not.toBeNull();
    expect(countByOrigin()).toBe(1);

    for (let i = 0; i < 3; i += 1) {
      clock.ms += 61_000;
      await requeueDeliveredOrder(database.handle, audit, orderId, new Date(0));
      await service.runDue();
      expect(countByOrigin()).toBe(1);
    }
    expect(book.count('include')).toBe(1);
    const final = (await database.handle.db.select().from(salesOrder).where(eq(salesOrder.id, orderId)))[0]!;
    expect(final).toMatchObject({ status: 'sent', erpNumber });
    const outboxRows = await pool.query(`select 1 from integration_outbox where aggregate_id = $1`, [orderId]);
    expect(outboxRows.rowCount).toBe(1);
  });
});
