import { randomUUID } from 'node:crypto';
import { salesOrder } from '@salesforce/db';
import { FakeGateway, FakeOrderBook, NotImplementedError, SankhyaGatewayError, type ErpOrderStatusFactsReading } from '@salesforce/sankhya';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OrderErpStatusService } from '../../src/integration/order-erp-status.service.js';
import { createLogger } from '../../src/observability/logger.js';
import { closeAllThenStop, createMigratedDatabase, startPostgres, type MigratedDatabase, type TestPostgres } from '../helpers/postgres.js';

const NOW = Date.parse('2026-10-30T12:00:00Z');
let postgres: TestPostgres;
const databases: MigratedDatabase[] = [];

beforeAll(async () => {
  postgres = await startPostgres();
});
afterAll(async () => {
  await closeAllThenStop(databases.map((d) => () => d.handle.close()), postgres);
});

const facts = (over: Partial<ErpOrderStatusFactsReading> = {}): ErpOrderStatusFactsReading => ({
  found: true,
  cancelled: false,
  confirmed: true,
  awaitingRelease: false,
  awaitingBilling: false,
  invoiced: false,
  invoiceStatus: null,
  ...over,
});

async function world() {
  const database = await createMigratedDatabase(postgres);
  databases.push(database);
  const pool = database.handle.pool;
  const accountId = randomUUID();
  const configId = randomUUID();
  await pool.query(`INSERT INTO account (id, email, display_name, password_hash, role) VALUES ($1, 's@example.test', 'S', 'x', 'seller')`, [accountId]);
  await pool.query(
    `INSERT INTO installation_configuration_version (id, version_label, source_kind, payload, content_hash, synced_at, is_current)
     VALUES ($1, 'v1', 'demo', '{}'::jsonb, 'h', now(), true)`,
    [configId],
  );
  const book = new FakeOrderBook();
  const gateway = new FakeGateway({ orders: book });
  const service = new OrderErpStatusService({
    db: database.handle,
    gateway,
    logger: createLogger({ level: 'silent', service: 'test' }),
    now: () => new Date(NOW),
  });
  const seed = async (erpNumber: number | null, over: { status?: string; ageDays?: number; statusCode?: number } = {}): Promise<string> => {
    const id = randomUUID();
    const status = over.status ?? 'sent';
    await pool.query(
      `INSERT INTO sales_order (id, customer_code, seller_code, created_by_account_id, status, negotiation_type_code, client_request_id, config_version_id, dataset_origin, erp_environment, external_origin_id, erp_number, erp_status_code, created_at)
       VALUES ($1, 77, 9, $2, $3, 11, $4, $5, 'sankhya', 'sandbox', $9, $6, $7, $8)`,
      [id, accountId, status, randomUUID(), configId, erpNumber, over.statusCode ?? null, new Date(NOW - (over.ageDays ?? 1) * 24 * 3600_000), id],
    );
    return id;
  };
  const row = async (id: string) => (await database.handle.db.select().from(salesOrder).where(eq(salesOrder.id, id)))[0];
  return { database, book, service, seed, row };
}

describe('sync.erp.orderStatus (SNK-7 P2)', () => {
  it('stores the mapped ERP status, label, invoice number and read time for a sent order', async () => {
    const w = await world();
    const id = await w.seed(7001);
    w.book.statusFacts.set(7001, facts({ invoiced: true, invoiceStatus: 'A' }));
    w.book.invoiceNumbers.set(7001, 1234);
    expect(await w.service.runOnce()).toEqual({ checked: 1, updated: 1 });
    const order = await w.row(id);
    expect(order).toMatchObject({ erpStatusCode: 4, erpStatusLabel: 'FATURADO', erpInvoiceNumber: 1234 });
    expect(order?.erpStatusCheckedAt?.getTime()).toBe(NOW);
  });

  it('applies the NEGADO-over-FATURADO quirk', async () => {
    const w = await world();
    const id = await w.seed(7002);
    w.book.statusFacts.set(7002, facts({ invoiced: true, invoiceStatus: 'D' }));
    await w.service.runOnce();
    expect(await w.row(id)).toMatchObject({ erpStatusCode: 5, erpStatusLabel: 'NEGADO' });
  });

  it('does not read orders that are not sent, have no ERP number, are final, or are older than 90 days', async () => {
    const w = await world();
    await w.seed(7003, { status: 'queued' });
    await w.seed(null);
    await w.seed(7004, { statusCode: 4 });
    await w.seed(7005, { statusCode: 0 });
    await w.seed(7006, { ageDays: 91 });
    const live = await w.seed(7007, { statusCode: 2 });
    w.book.statusFacts.set(7007, facts({ awaitingBilling: true }));
    expect(await w.service.runOnce()).toEqual({ checked: 1, updated: 1 });
    expect((await w.row(live))?.erpStatusCode).toBe(3);
  });

  it('keeps the stored status when the ERP read fails, and when the ERP no longer finds a previously read order', async () => {
    const w = await world();
    const id = await w.seed(7008, { statusCode: 2 });
    w.book.statusFacts.set(7008, facts({ found: false }));
    expect(await w.service.runOnce()).toEqual({ checked: 1, updated: 0 });
    expect((await w.row(id))?.erpStatusCode).toBe(2);

    const failing = new OrderErpStatusService({
      db: w.database.handle,
      gateway: { ...new FakeGateway({ orders: w.book }), readOrderStatusFacts: () => Promise.reject(new SankhyaGatewayError('unavailable', { code: 'down', message: 'down' })) } as never,
      logger: createLogger({ level: 'silent', service: 'test' }),
      now: () => new Date(NOW),
    });
    expect(await failing.runOnce()).toMatchObject({ checked: 0, updated: 0, failed: true, failure: { errorClass: 'unavailable', errorCode: 'down' } });
    expect((await w.row(id))?.erpStatusCode).toBe(2);
  });

  it.each([
    ['a string', 'ORA-00904: invalid identifier', null],
    ['a response-like object', { status: 400, statusMessage: 'Bad Request', body: 'secret-looking text' }, 'http_400'],
    ['an object with a code', { code: 'SANKHYA_ERR_7', message: 'x' }, 'SANKHYA_ERR_7'],
    ['undefined', undefined, null],
  ])('a non-Error thrown by the ERP read (%s) fails cleanly: class, code and a message are logged and the stored statuses are kept', async (_label, thrown, expectedCode) => {
    const w = await world();
    const id = await w.seed(7010, { statusCode: 2 });
    const lines: { fields: Record<string, unknown>; message: string }[] = [];
    const logger = { warn: (fields: Record<string, unknown>, message: string) => lines.push({ fields, message }), info: () => undefined, error: () => undefined, debug: () => undefined };
    const throwing = new OrderErpStatusService({
      db: w.database.handle,
      gateway: { ...new FakeGateway({ orders: w.book }), readOrderStatusFacts: () => Promise.reject(thrown) } as never,
      logger: logger as never,
      now: () => new Date(NOW),
    });
    const run = await throwing.runOnce();
    expect(run).toMatchObject({ checked: 0, updated: 0, failed: true, failure: { errorClass: 'unclassified', errorCode: expectedCode } });
    expect(lines).toHaveLength(1);
    expect(lines[0]?.message).toBe('ERP order status read failed; the stored statuses are kept and the next run retries');
    expect(lines[0]?.fields).toMatchObject({ errorClass: 'unclassified', errorCode: expectedCode, orders: 1 });
    expect(typeof lines[0]?.fields['detail']).toBe('string');
    expect(lines[0]?.fields['thrownType']).toBe(typeof thrown);
    // Nothing the ERP said is copied into the log.
    expect(JSON.stringify(lines[0]?.fields)).not.toContain('secret-looking');
    expect(JSON.stringify(lines[0]?.fields)).not.toContain('ORA-00904');
    expect((await w.row(id))?.erpStatusCode).toBe(2);
  });

  it('the not-implemented read is logged as WARN at most once per hour; other errors warn every run', async () => {
    const w = await world();
    await w.seed(7012);
    const lines: Record<string, unknown>[] = [];
    const logger = { warn: (fields: Record<string, unknown>) => lines.push(fields), info: () => undefined, error: () => undefined, debug: () => undefined };
    let clock = new Date(NOW);
    const make = (thrown: unknown) =>
      new OrderErpStatusService({ db: w.database.handle, gateway: { readOrderStatusFacts: () => Promise.reject(thrown) } as never, logger: logger as never, now: () => clock });
    const notImplemented = make(new NotImplementedError('not validated'));
    expect(await notImplemented.runOnce()).toMatchObject({ failed: true, failure: { errorCode: 'not_implemented' } });
    clock = new Date(clock.getTime() + 20 * 60_000);
    expect(await notImplemented.runOnce()).toMatchObject({ failed: true });
    expect(lines).toHaveLength(1);
    clock = new Date(clock.getTime() + 41 * 60_000);
    await notImplemented.runOnce();
    expect(lines).toHaveLength(2);
    const other = make(new SankhyaGatewayError('unavailable', { code: 'down', message: 'down' }));
    await other.runOnce();
    await other.runOnce();
    expect(lines).toHaveLength(4);
  });

  it('the real gateway read that is not implemented is logged with its code and message (not an empty NonError)', async () => {
    const w = await world();
    await w.seed(7011);
    const lines: Record<string, unknown>[] = [];
    const logger = { warn: (fields: Record<string, unknown>) => lines.push(fields), info: () => undefined, error: () => undefined, debug: () => undefined };
    const service = new OrderErpStatusService({
      db: w.database.handle,
      gateway: { readOrderStatusFacts: () => Promise.reject(new NotImplementedError('readOrderStatusFacts: not validated')) } as never,
      logger: logger as never,
      now: () => new Date(NOW),
    });
    expect(await service.runOnce()).toMatchObject({ failed: true, failure: { errorClass: 'permanent', errorCode: 'not_implemented' } });
    expect(lines[0]).toMatchObject({ errorClass: 'permanent', errorCode: 'not_implemented', thrownType: 'NotImplementedError' });
    expect(String(lines[0]?.['detail'])).toContain('not validated');
  });

  it('stores the release event codes (distinct, ascending) in erp_status_detail, and keeps them when a later reading carries none (D6b)', async () => {
    const w = await world();
    const id = await w.seed(7010);
    w.book.statusFacts.set(7010, facts({ awaitingRelease: true }));
    w.book.releaseEventCodes.set(7010, [44, 2, 13, 2]);
    await w.service.runOnce();
    expect((await w.row(id))?.erpStatusDetail).toBe('2,13,44');

    w.book.releaseEventCodes.delete(7010);
    await w.service.runOnce();
    expect((await w.row(id))?.erpStatusDetail).toBe('2,13,44');

    w.book.releaseEventCodes.set(7010, []);
    await w.service.runOnce();
    expect((await w.row(id))?.erpStatusDetail).toBeNull();
  });

  it('shows DESCONHECIDO for a sent order the ERP cannot find on the first read', async () => {
    const w = await world();
    const id = await w.seed(7009);
    await w.service.runOnce();
    expect(await w.row(id)).toMatchObject({ erpStatusCode: -1, erpStatusLabel: 'DESCONHECIDO' });
  });
});
