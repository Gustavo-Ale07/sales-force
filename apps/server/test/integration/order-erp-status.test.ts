import { randomUUID } from 'node:crypto';
import { salesOrder } from '@salesforce/db';
import { FakeGateway, FakeOrderBook, NotImplementedError, SankhyaGatewayError, type ErpOrderStatusFactsReading } from '@salesforce/sankhya';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OrderErpStatusService } from '../../src/integration/order-erp-status.service.js';
import { decodeReleaseDetail, storedReleaseState } from '../../src/orders/release-events.js';
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

describe('sync.erp.orderStatus - release (liberação), included notes only', () => {
  const line = (event: number, over: { released?: boolean; denied?: boolean; description?: string | null } = {}) => ({
    event,
    description: over.description ?? null,
    released: over.released ?? false,
    denied: over.denied ?? false,
  });
  const stateOf = async (w: Awaited<ReturnType<typeof world>>, id: string) => {
    const order = await w.row(id);
    const detail = decodeReleaseDetail(order?.erpStatusDetail);
    return detail === null ? null : storedReleaseState(detail);
  };

  it('awaiting (the normal state of a sent 1001 order), released and denied, each stored from the release lines', async () => {
    const w = await world();
    const awaiting = await w.seed(7101);
    const released = await w.seed(7102);
    const denied = await w.seed(7103);
    w.book.releaseLines.set(7101, [line(44, { description: 'Liberação exigida pela TOP' }), line(2, { released: true })]);
    w.book.releaseLines.set(7102, [line(44, { released: true }), line(3, { released: true })]);
    w.book.releaseLines.set(7103, [line(44), line(13, { denied: true })]);
    expect(await w.service.runReleaseOnce()).toEqual({ checked: 3, updated: 3 });
    expect(await stateOf(w, awaiting)).toBe('awaiting');
    expect(await stateOf(w, released)).toBe('released');
    expect(await stateOf(w, denied)).toBe('denied');
    expect(decodeReleaseDetail((await w.row(awaiting))?.erpStatusDetail)?.lines.map((l) => l.description)).toEqual([null, 'Liberação exigida pela TOP']);
  });

  it('a note with no release lines has no release state, and the status columns are not touched', async () => {
    const w = await world();
    const id = await w.seed(7104, { statusCode: 2 });
    w.book.releaseLines.set(7104, []);
    expect(await w.service.runReleaseOnce()).toEqual({ checked: 1, updated: 0 });
    expect(await stateOf(w, id)).toBeNull();
    expect((await w.row(id))?.erpStatusCode).toBe(2);
  });

  it('moves from awaiting to released on a later read and then stops reading that order', async () => {
    const w = await world();
    const id = await w.seed(7105);
    w.book.releaseLines.set(7105, [line(44)]);
    await w.service.runReleaseOnce();
    expect(await stateOf(w, id)).toBe('awaiting');
    w.book.releaseLines.set(7105, [line(44, { released: true })]);
    expect(await w.service.runReleaseOnce()).toEqual({ checked: 1, updated: 1 });
    expect(await stateOf(w, id)).toBe('released');
    // Released is not the end: billing is followed until the order is invoiced or cancelled.
    expect(await w.service.runReleaseOnce()).toEqual({ checked: 1, updated: 0 });
    w.book.noteHeaders.set(7105, { statusNota: 'L', pending: 'N' });
    w.book.billing.set(7105, { cancelled: false, invoiced: true, invoicedAt: '2026-11-09', nfeAuthorized: true, items: [] });
    expect(await w.service.runReleaseOnce()).toEqual({ checked: 1, updated: 1 });
    expect(await w.service.runReleaseOnce()).toEqual({ checked: 0, updated: 0 });
  });

  it('does not read orders that are not sent, have no ERP number or are older than 60 days', async () => {
    const w = await world();
    await w.seed(7106, { status: 'queued' });
    await w.seed(null);
    await w.seed(7107, { ageDays: 61 });
    expect(await w.service.runReleaseOnce()).toEqual({ checked: 0, updated: 0 });
  });

  describe('billing status', () => {
    const billingOf = async (w: Awaited<ReturnType<typeof world>>, id: string) => decodeReleaseDetail((await w.row(id))?.erpStatusDetail)?.billing;
    const facts = (over: Partial<{ cancelled: boolean; invoiced: boolean; invoicedAt: string | null; nfeAuthorized: boolean }> = {}) => ({
      cancelled: false,
      invoiced: false,
      invoicedAt: null,
      nfeAuthorized: false,
      items: [],
      ...over,
    });

    it('stores one state per scenario, following the precedence', async () => {
      const w = await world();
      const sent = await w.seed(7201);
      const awaitingBilling = await w.seed(7202);
      const invoiced = await w.seed(7203);
      const awaitingRelease = await w.seed(7204);
      const denied = await w.seed(7205);
      w.book.noteHeaders.set(7201, { statusNota: 'A', pending: 'S' });
      w.book.billing.set(7201, facts());
      w.book.noteHeaders.set(7202, { statusNota: 'L', pending: 'S' });
      w.book.billing.set(7202, facts());
      w.book.noteHeaders.set(7203, { statusNota: 'L', pending: 'N' });
      w.book.billing.set(7203, facts({ invoiced: true, invoicedAt: '2026-11-08', nfeAuthorized: true }));
      w.book.noteHeaders.set(7204, { statusNota: 'L', pending: 'S' });
      w.book.billing.set(7204, facts({ invoiced: true }));
      w.book.releaseLines.set(7204, [line(44)]); // awaiting release wins over invoiced
      w.book.noteHeaders.set(7205, { statusNota: 'A', pending: 'S' });
      w.book.billing.set(7205, facts());
      w.book.releaseLines.set(7205, [line(44), line(13, { denied: true })]);
      await w.service.runReleaseOnce();
      expect((await billingOf(w, sent))?.state).toBe('sent');
      expect((await billingOf(w, awaitingBilling))?.state).toBe('awaiting_billing');
      expect(await billingOf(w, invoiced)).toMatchObject({ state: 'invoiced', invoicedAt: '2026-11-08', nfeAuthorized: true });
      expect((await billingOf(w, awaitingRelease))?.state).toBe('awaiting_release');
      expect((await billingOf(w, denied))?.state).toBe('denied');
    });

    it('a failed billing read logs the error code (no order data) and keeps the stored billing state', async () => {
      const w = await world();
      const id = await w.seed(7221);
      w.book.noteHeaders.set(7221, { statusNota: 'L', pending: 'S' });
      w.book.billing.set(7221, facts());
      await w.service.runReleaseOnce();
      expect((await billingOf(w, id))?.state).toBe('awaiting_billing');
      const lines: { fields: Record<string, unknown>; message: string }[] = [];
      const logger = { warn: (fields: Record<string, unknown>, message: string) => lines.push({ fields, message }), info: () => undefined, error: () => undefined, debug: () => undefined };
      const failing = new OrderErpStatusService({ db: w.database.handle, gateway: new FakeGateway({ orders: w.book }), logger: logger as never, now: () => new Date(NOW) });
      w.book.billingErrorCodes.set(7221, 'billing_query_refused');
      w.book.noteHeaders.set(7221, { statusNota: 'L', pending: 'N' });
      w.book.billing.set(7221, facts({ invoiced: true }));
      await failing.runReleaseOnce();
      expect((await billingOf(w, id))?.state).toBe('awaiting_billing');
      expect(lines).toHaveLength(1);
      expect(lines[0]?.fields).toEqual({ errorCodes: ['billing_query_refused'], orders: 1 });
    });

    it('cancelled only when the cancellation tables say so; a note nobody finds is not deduced as cancelled', async () => {
      const w = await world();
      const gone = await w.seed(7211);
      const cancelled = await w.seed(7212);
      w.book.releaseLines.set(7212, [line(44)]);
      w.book.noteHeaders.set(7212, { statusNota: 'A', pending: 'S' });
      w.book.billing.set(7212, facts());
      await w.service.runReleaseOnce();
      expect((await billingOf(w, cancelled))?.state).toBe('awaiting_release');
      w.book.noteHeaders.delete(7212);
      w.book.releaseLines.delete(7212);
      w.book.billing.set(7212, facts({ cancelled: true }));
      await w.service.runReleaseOnce();
      expect((await billingOf(w, cancelled))?.state).toBe('cancelled');
      expect(await billingOf(w, gone)).toBeUndefined();
      // Final: not read again.
      expect(await w.service.runReleaseOnce()).toEqual({ checked: 1, updated: 0 });
    });
  });

  it('keeps the stored release when the read fails, and when the ERP cannot find the note', async () => {
    const w = await world();
    const id = await w.seed(7108);
    w.book.releaseLines.set(7108, [line(44)]);
    await w.service.runReleaseOnce();
    const failing = new OrderErpStatusService({
      db: w.database.handle,
      gateway: { readOrderReleaseFacts: () => Promise.reject(new SankhyaGatewayError('unavailable', { code: 'down', message: 'down' })) } as never,
      logger: createLogger({ level: 'silent', service: 'test' }),
      now: () => new Date(NOW),
    });
    expect(await failing.runReleaseOnce()).toMatchObject({ checked: 0, updated: 0, failed: true });
    expect(await stateOf(w, id)).toBe('awaiting');
    w.book.releaseLines.delete(7108);
    expect(await w.service.runReleaseOnce()).toEqual({ checked: 1, updated: 0 });
    expect(await stateOf(w, id)).toBe('awaiting');
  });
});
