import { randomUUID } from 'node:crypto';
import { salesOrderErpStage, salesOrderReleasePending } from '@salesforce/db';
import { DEMO_ACCOUNT_EMAILS, DEMO_CONFIGURATION, FakeGateway, FakeOrderBook, SankhyaGatewayError, getDemoDataset } from '@salesforce/sankhya';
import type { InstallationConfiguration } from '@salesforce/domain';
import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OrderErpStatusService, ORDER_STAGE_ON_DEMAND_REUSE_MS } from '../../src/integration/order-erp-status.service.js';
import { createLogger } from '../../src/observability/logger.js';
import { createTestAccount, TEST_PASSWORD, TEST_ORIGIN } from '../helpers/auth.js';
import { loginCookie } from '../helpers/auth-app.js';
import { restrictedKeys, startCommercialApp, type Json } from '../helpers/commercial-app.js';
import { closeAllThenStop, startPostgres, type TestPostgres } from '../helpers/postgres.js';

/**
 * Order stage following Sankhya (f27c2c9) and the release queue (560eb99), end to end against real PostgreSQL: the REAL worker code
 * (`OrderErpStatusService.runStageOnce`) driven by the fake gateway's state machine (`FakeOrderBook.stageFacts`), then read back
 * through the real HTTP API as each profile. No Sankhya contact: fake gateway only.
 */
const dataset = getDemoDataset();
const T0 = Date.parse('2026-09-21T12:00:00.000Z') // the helper clock's start, so API-side waiting times line up;
const MIN = 60_000;
const HOUR = 3_600_000;
let postgres: TestPostgres;
const opened: (() => Promise<unknown>)[] = [];

beforeAll(async () => {
  postgres = await startPostgres();
});
afterAll(async () => {
  await closeAllThenStop(opened, postgres);
});

const customerOf = (sellerCode: number): number => {
  const customer = dataset.customers.find((c) => c.sellerCode === sellerCode && c.active && !c.blocked);
  if (customer === undefined) throw new Error(`no demo customer for seller ${sellerCode}`);
  return customer.code;
};

interface Facts {
  found?: boolean;
  statusNota?: string | null;
  orderCargo?: number | null;
  pendingReleases?: { event: number; cascadeSequence: number | null; assignedUserCode?: number | null }[];
  hasInvoiceLink?: boolean;
  hasReprovedRelease?: boolean;
  invoiceNumber?: number | null;
  codtipoper?: number | null;
  assigneeReadErrorCode?: string;
}
const facts = (over: Facts = {}) => ({
  found: true,
  codtipoper: 4242,
  statusNota: 'A',
  pending: 'S',
  orderCargo: null,
  pendingReleases: [],
  hasInvoiceLink: false,
  invoiceNumber: null,
  ...over,
});

async function world(configuration?: InstallationConfiguration) {
  const app = await startCommercialApp(postgres, opened, configuration === undefined ? {} : { configuration });
  const book = new FakeOrderBook();
  const fake = new FakeGateway({ orders: book });
  const state = { now: T0, reads: 0, failWith: null as unknown, lastNumbers: [] as number[][] };
  const gateway = {
    readOrderStageFacts: async (numbers: readonly number[], options?: unknown) => {
      state.reads += 1;
      state.lastNumbers.push([...numbers]);
      if (state.failWith !== null) throw state.failWith;
      return fake.readOrderStageFacts(numbers, options as never);
    },
  };
  const warnings: { fields: Record<string, unknown>; message: string }[] = [];
  const logger = { ...createLogger({ level: 'silent', service: 'test' }), warn: (fields: Record<string, unknown>, message: string) => warnings.push({ fields, message }) };
  const service = new OrderErpStatusService({ db: app.database.handle, gateway: gateway as never, logger: logger as never, now: () => new Date(state.now) });
  const pool = app.database.handle.pool;
  const seed = async (opts: { erpNumber: number; sellerCode: number; accountEmail: string; ageMinutes?: number; status?: string; customerCode?: number; total?: string }): Promise<string> => {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO sales_order (id, customer_code, seller_code, created_by_account_id, status, negotiation_type_code, client_request_id, config_version_id, dataset_origin, erp_environment, external_origin_id, erp_number, estimated_total, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 2, $6, $7, 'sankhya', 'sandbox', $11, $8, $9, $10, $10)`,
      [id, opts.customerCode ?? customerOf(opts.sellerCode), opts.sellerCode, app.accounts.ids[opts.accountEmail], opts.status ?? 'sent', randomUUID(), app.accounts.configVersionId, opts.erpNumber, opts.total ?? '150.50', new Date(T0 - (opts.ageMinutes ?? 60) * MIN), id],
    );
    return id;
  };
  const stageRow = async (orderId: string) => (await app.database.handle.db.select().from(salesOrderErpStage).where(eq(salesOrderErpStage.orderId, orderId)))[0];
  const pendingRows = async (orderId: string) =>
    app.database.handle.db.select().from(salesOrderReleasePending).where(eq(salesOrderReleasePending.orderId, orderId)).orderBy(asc(salesOrderReleasePending.sector), asc(salesOrderReleasePending.event));
  return { app, book, service, state, seed, stageRow, pendingRows, warnings };
}

const SELLER1 = DEMO_ACCOUNT_EMAILS.seller1;
const SELLER2 = DEMO_ACCOUNT_EMAILS.seller2;

describe('order stage worker (runOrderStageOnce) with the fake gateway state machine', () => {
  it('follows received -> in_review -> financial_check -> in_dispatch -> in_invoicing -> invoiced, only moving updated_at on a change', async () => {
    const w = await world();
    const id = await w.seed({ erpNumber: 9101, sellerCode: 103, accountEmail: SELLER1 });
    const steps: [Facts, string][] = [
      [{}, 'received'],
      [{ pendingReleases: [{ event: 44, cascadeSequence: 1 }] }, 'in_review'],
      [{ pendingReleases: [{ event: 44, cascadeSequence: 2 }] }, 'financial_check'],
      [{ statusNota: 'L' }, 'in_dispatch'],
      [{ statusNota: 'L', orderCargo: 7 }, 'in_invoicing'],
      [{ statusNota: 'L', orderCargo: 7, hasInvoiceLink: true, invoiceNumber: 5001 }, 'invoiced'],
    ];
    let previousUpdatedAt = 0;
    for (const [step, expected] of steps) {
      w.state.now += 5 * MIN;
      w.book.stageFacts.set(9101, facts(step));
      expect(await w.service.runStageOnce()).toEqual({ checked: 1, updated: 1 });
      const row = await w.stageRow(id);
      expect(row?.stage, expected).toBe(expected);
      expect(row?.nunota).toBe(9101);
      expect(row?.updatedAt.getTime()).toBeGreaterThan(previousUpdatedAt);
      previousUpdatedAt = row!.updatedAt.getTime();
    }
    expect((await w.stageRow(id))?.invoiceNumber).toBe(5001);
    expect((await w.stageRow(id))?.label).toBe('Faturado');
  });

  it('owner Sandbox facts 2026-11-23: notes in A/S with no release and no link are "received" with no queue row; linked notes are "invoiced"; a released line (DHLIB filled) is not pending', async () => {
    const w = await world();
    const received: string[] = [];
    for (const nunota of [2508, 2509, 2510, 2511]) {
      received.push(await w.seed({ erpNumber: nunota, sellerCode: 103, accountEmail: SELLER1, ageMinutes: 3 }));
      w.book.stageFacts.set(nunota, facts({ statusNota: 'A', orderCargo: 0 }));
    }
    const chain = await w.seed({ erpNumber: 2449, sellerCode: 103, accountEmail: SELLER1 });
    w.book.stageFacts.set(2449, facts({ hasInvoiceLink: true }));
    // 2454: TSILIB event 2 with DHLIB filled -> the gateway's SELECT (DHLIB IS NULL) returns no pending line.
    const released = await w.seed({ erpNumber: 2454, sellerCode: 103, accountEmail: SELLER1 });
    w.book.stageFacts.set(2454, facts({ hasInvoiceLink: true, pendingReleases: [] }));
    expect(await w.service.runStageOnce()).toEqual({ checked: 6, updated: 6 });
    for (const id of received) {
      expect((await w.stageRow(id))?.stage).toBe('received');
      expect(await w.pendingRows(id)).toHaveLength(0);
    }
    expect((await w.stageRow(chain))?.stage).toBe('invoiced');
    expect((await w.stageRow(released))?.stage).toBe('invoiced');
    expect(await w.pendingRows(released)).toHaveLength(0);
  });

  it('an unchanged read only moves checked_at (hash equal): stage, label and updated_at stay', async () => {
    const w = await world();
    const id = await w.seed({ erpNumber: 9102, sellerCode: 103, accountEmail: SELLER1 });
    w.book.stageFacts.set(9102, facts({ pendingReleases: [{ event: 3, cascadeSequence: null }] }));
    await w.service.runStageOnce();
    const first = await w.stageRow(id);
    w.state.now += 10 * MIN;
    expect(await w.service.runStageOnce()).toEqual({ checked: 1, updated: 0 });
    const second = await w.stageRow(id);
    expect(second?.contentHash).toBe(first?.contentHash);
    expect(second?.updatedAt.getTime()).toBe(first?.updatedAt.getTime());
    expect(second?.checkedAt.getTime()).toBe(first!.checkedAt.getTime() + 10 * MIN);
    expect(second?.stage).toBe('financial_check');
  });

  it('on-demand reuse: a read younger than 60 s is not repeated; at 60 s it is read again', async () => {
    const w = await world();
    await w.seed({ erpNumber: 9103, sellerCode: 103, accountEmail: SELLER1 });
    w.book.stageFacts.set(9103, facts());
    await w.service.runStageOnce({ reuseMs: ORDER_STAGE_ON_DEMAND_REUSE_MS });
    expect(w.state.reads).toBe(1);
    w.state.now += 59_000;
    expect(await w.service.runStageOnce({ reuseMs: ORDER_STAGE_ON_DEMAND_REUSE_MS })).toEqual({ checked: 0, updated: 0 });
    expect(w.state.reads).toBe(1);
    w.state.now += 1_000; // exactly 60 s: still reused (the read must be strictly older than the window)
    expect(await w.service.runStageOnce({ reuseMs: ORDER_STAGE_ON_DEMAND_REUSE_MS })).toEqual({ checked: 0, updated: 0 });
    w.state.now += 1;
    expect(await w.service.runStageOnce({ reuseMs: ORDER_STAGE_ON_DEMAND_REUSE_MS })).toEqual({ checked: 1, updated: 0 });
    expect(w.state.reads).toBe(2);
    // The scheduled run (no reuse) always reads.
    expect(await w.service.runStageOnce()).toEqual({ checked: 1, updated: 0 });
    expect(w.state.reads).toBe(3);
  });

  it('final re-read window: an invoiced order is read again inside 24 h of reaching the stage, never after', async () => {
    const w = await world();
    const id = await w.seed({ erpNumber: 9104, sellerCode: 103, accountEmail: SELLER1 });
    w.book.stageFacts.set(9104, facts({ statusNota: 'L', hasInvoiceLink: true, invoiceNumber: 77 }));
    await w.service.runStageOnce();
    expect((await w.stageRow(id))?.stage).toBe('invoiced');
    w.state.now += 23 * HOUR;
    expect(await w.service.runStageOnce()).toEqual({ checked: 1, updated: 0 });
    w.state.now += 2 * HOUR; // 25 h after the stage was reached
    expect(await w.service.runStageOnce()).toEqual({ checked: 0, updated: 0 });
    expect(w.state.reads).toBe(2);
    // A non-final order is never dropped by the window.
    const open = await w.seed({ erpNumber: 9105, sellerCode: 103, accountEmail: SELLER1 });
    w.book.stageFacts.set(9105, facts());
    await w.service.runStageOnce();
    w.state.now += 400 * HOUR;
    expect(await w.service.runStageOnce()).toMatchObject({ checked: 1 });
    expect((await w.stageRow(open))?.stage).toBe('received');
  });

  it('only orders sent to the ERP, with an ERP number and younger than 90 days are read, in a batch of known numbers', async () => {
    const w = await world();
    await w.seed({ erpNumber: 9110, sellerCode: 103, accountEmail: SELLER1 });
    await w.seed({ erpNumber: 9111, sellerCode: 103, accountEmail: SELLER1, status: 'queued' });
    await w.seed({ erpNumber: 9112, sellerCode: 103, accountEmail: SELLER1, ageMinutes: 91 * 24 * 60 });
    w.book.stageFacts.set(9110, facts());
    w.book.stageFacts.set(9111, facts());
    w.book.stageFacts.set(9112, facts());
    expect(await w.service.runStageOnce()).toEqual({ checked: 1, updated: 1 });
    expect(w.state.lastNumbers).toEqual([[9110]]);
  });

  it('a read error keeps the stage and its times and sets the error; the next success clears it', async () => {
    const w = await world();
    const id = await w.seed({ erpNumber: 9106, sellerCode: 103, accountEmail: SELLER1 });
    w.book.stageFacts.set(9106, facts({ pendingReleases: [{ event: 44, cascadeSequence: 1 }] }));
    await w.service.runStageOnce();
    const good = await w.stageRow(id);

    w.state.now += 10 * MIN;
    w.state.failWith = new SankhyaGatewayError('unavailable', { code: 'erp_down', message: 'down' });
    const run = await w.service.runStageOnce();
    expect(run).toMatchObject({ checked: 0, updated: 0, failed: true, failure: { errorClass: 'unavailable', errorCode: 'erp_down' } });
    const failed = await w.stageRow(id);
    expect(failed).toMatchObject({ stage: 'in_review', lastErrorClass: 'unavailable', lastErrorCode: 'erp_down' });
    expect(failed?.updatedAt.getTime()).toBe(good?.updatedAt.getTime());
    expect(failed?.checkedAt.getTime()).toBe(good?.checkedAt.getTime());
    expect(failed?.lastErrorAt?.getTime()).toBe(w.state.now);
    expect(w.warnings.some((line) => line.message.includes('order stage read failed'))).toBe(true);
    expect(JSON.stringify(w.warnings)).not.toMatch(/down'?\s*,?\s*message/); // codes only, never the provider message

    w.state.now += 5 * MIN;
    w.state.failWith = null;
    await w.service.runStageOnce();
    expect(await w.stageRow(id)).toMatchObject({ stage: 'in_review', lastErrorClass: null, lastErrorCode: null, lastErrorAt: null });
  });

  it('a first read that fails creates no stage row (nothing to attach the error to)', async () => {
    const w = await world();
    const id = await w.seed({ erpNumber: 9107, sellerCode: 103, accountEmail: SELLER1 });
    w.state.failWith = new SankhyaGatewayError('unavailable', { code: 'erp_down', message: 'down' });
    expect(await w.service.runStageOnce()).toMatchObject({ failed: true });
    expect(await w.stageRow(id)).toBeUndefined();
  });

  it('a note the ERP cannot find keeps the last stage (neither a stage change nor a cancellation)', async () => {
    const w = await world();
    const id = await w.seed({ erpNumber: 9108, sellerCode: 103, accountEmail: SELLER1 });
    w.book.stageFacts.set(9108, facts({ statusNota: 'L' }));
    await w.service.runStageOnce();
    const before = await w.stageRow(id);
    w.state.now += 10 * MIN;
    w.book.stageFacts.set(9108, facts({ found: false, statusNota: null, codtipoper: null }));
    expect(await w.service.runStageOnce()).toEqual({ checked: 1, updated: 0 });
    expect(await w.stageRow(id)).toEqual(before);
  });

  it('a quotation TOP skips the cascade: stage quotation, no queue rows', async () => {
    const w = await world();
    const id = await w.seed({ erpNumber: 9109, sellerCode: 103, accountEmail: SELLER1 });
    const quotationTop = DEMO_CONFIGURATION.sales.quotationTopCode;
    expect(quotationTop).toBe(9001);
    w.book.stageFacts.set(9109, facts({ codtipoper: 9001, pendingReleases: [{ event: 44, cascadeSequence: 1 }] }));
    await w.service.runStageOnce();
    expect(await w.stageRow(id)).toMatchObject({ stage: 'quotation' });
    expect(await w.pendingRows(id)).toEqual([]);
  });

  it('a reproved release line (REPROVADO = S) makes the order "Barrado": persisted, no sector, no queue rows; invoiced still wins', async () => {
    const w = await world();
    const id = await w.seed({ erpNumber: 9130, sellerCode: 103, accountEmail: SELLER1 });
    w.book.stageFacts.set(9130, facts({ statusNota: 'A', hasReprovedRelease: true, pendingReleases: [{ event: 44, cascadeSequence: 1 }] }));
    await w.service.runStageOnce();
    expect(await w.stageRow(id)).toMatchObject({ stage: 'barred', label: 'Barrado', pendingSector: null });
    expect(await w.pendingRows(id)).toEqual([]);
    w.book.stageFacts.set(9130, facts({ hasReprovedRelease: true, hasInvoiceLink: true, invoiceNumber: 88 }));
    w.state.now += 10 * MIN;
    await w.service.runStageOnce();
    expect(await w.stageRow(id)).toMatchObject({ stage: 'invoiced' });
  });

  it('mirrors the pending release lines per sector: 44@1 -> Pedidos, 3 -> Financeiro, 13 -> both; released lines leave; first_seen_at is kept', async () => {
    const w = await world();
    const id = await w.seed({ erpNumber: 9120, sellerCode: 103, accountEmail: SELLER1 });
    w.book.stageFacts.set(9120, facts({ pendingReleases: [{ event: 44, cascadeSequence: 1, assignedUserCode: 120 }, { event: 13, cascadeSequence: null }] }));
    await w.service.runStageOnce();
    let rows = await w.pendingRows(id);
    expect(rows.map((r) => [r.sector, r.event, r.cascadeSequence, r.assignedUserCode])).toEqual([
      ['Financeiro', 13, null, null],
      ['Pedidos', 13, null, null],
      ['Pedidos', 44, 1, 120],
    ]);
    const firstSeen = rows.map((r) => r.firstSeenAt.getTime());
    expect(new Set(firstSeen).size).toBe(1);

    // Event 44@1 released, event 3 appears: the 44 row goes, 3 arrives, 13 keeps its first_seen_at.
    w.state.now += 20 * MIN;
    w.book.stageFacts.set(9120, facts({ pendingReleases: [{ event: 13, cascadeSequence: null }, { event: 3, cascadeSequence: null }] }));
    await w.service.runStageOnce();
    rows = await w.pendingRows(id);
    expect(rows.map((r) => [r.sector, r.event])).toEqual([['Financeiro', 3], ['Financeiro', 13], ['Pedidos', 13]]);
    expect(rows.find((r) => r.event === 13 && r.sector === 'Pedidos')?.firstSeenAt.getTime()).toBe(firstSeen[0]);
    expect(rows.find((r) => r.event === 3)?.firstSeenAt.getTime()).toBe(T0 + 20 * MIN);

    // Everything released and the note confirmed: no stage holds a release, the queue rows are gone.
    w.state.now += 20 * MIN;
    w.book.stageFacts.set(9120, facts({ statusNota: 'L' }));
    await w.service.runStageOnce();
    expect(await w.pendingRows(id)).toEqual([]);
    expect((await w.stageRow(id))?.stage).toBe('in_dispatch');
  });

  it('a failed read keeps the queue rows untouched', async () => {
    const w = await world();
    const id = await w.seed({ erpNumber: 9121, sellerCode: 103, accountEmail: SELLER1 });
    w.book.stageFacts.set(9121, facts({ pendingReleases: [{ event: 3, cascadeSequence: null }] }));
    await w.service.runStageOnce();
    const before = await w.pendingRows(id);
    w.state.now += 10 * MIN;
    w.state.failWith = new SankhyaGatewayError('temporary', { code: 'erp_busy', message: 'busy' });
    await w.service.runStageOnce();
    expect(await w.pendingRows(id)).toEqual(before);
  });

  it('the soft assignee failure (assigneeReadErrorCode): rows are still written, the known releaser is kept, one coded warning is logged', async () => {
    const w = await world();
    const id = await w.seed({ erpNumber: 9122, sellerCode: 103, accountEmail: SELLER1 });
    w.book.stageFacts.set(9122, facts({ pendingReleases: [{ event: 3, cascadeSequence: null, assignedUserCode: 130 }] }));
    await w.service.runStageOnce();
    w.state.now += 10 * MIN;
    w.book.stageFacts.set(9122, facts({ pendingReleases: [{ event: 3, cascadeSequence: null }], assigneeReadErrorCode: 'erp_column_refused' }));
    await w.service.runStageOnce();
    const rows = await w.pendingRows(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.assignedUserCode).toBe(130);
    const line = w.warnings.find((entry) => entry.message.includes('CODUSULIB'));
    expect(line?.fields).toEqual({ errorCodes: ['erp_column_refused'] });
    expect((await w.stageRow(id))?.stage).toBe('financial_check');
  });

  it('no valid installation configuration: nothing is read and the failure is reported', async () => {
    const w = await world();
    await w.app.database.handle.pool.query(`UPDATE installation_configuration_version SET is_current = false`);
    await w.seed({ erpNumber: 9123, sellerCode: 103, accountEmail: SELLER1 });
    expect(await w.service.runStageOnce()).toMatchObject({ checked: 0, updated: 0, failed: true, failure: { errorCode: 'configuration_unavailable' } });
    expect(w.state.reads).toBe(0);
  });
});

describe('release queue over HTTP (profiles, sectors, counts, order, restricted data)', () => {
  const configured: InstallationConfiguration = { ...DEMO_CONFIGURATION, erp: { ...(DEMO_CONFIGURATION.erp ?? {}), releaseQueue: { sectorUsers: { Pedidos: [120, 121] } } } };
  let w: Awaited<ReturnType<typeof world>>;
  let orderA: string;
  let orderC: string;
  let technicalCookie: string;
  const ids: Record<string, string> = {};

  let opsListedCookie: string;
  let opsOtherCookie: string;
  const callWith = (cookie: string, url: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET') =>
    w.app.app.inject({ method, url: `/api/v1${url}`, headers: { origin: TEST_ORIGIN, cookie } });
  const callTechnical = (url: string) => callWith(technicalCookie, url);
  const callOps = async (cookie: string, url: string): Promise<{ status: number; body: Json }> => {
    const response = await callWith(cookie, url);
    return { status: response.statusCode, body: response.body === '' ? null : JSON.parse(response.body) };
  };

  beforeAll(async () => {
    w = await world(configured);
    // A: oldest, seller 103, Pedidos (44@1), assigned to 120. B: seller 107, Financeiro (3). C: seller 103, event 13 (both sectors). D: received, not queued.
    orderA = await w.seed({ erpNumber: 8001, sellerCode: 103, accountEmail: SELLER1, ageMinutes: 300, total: '10.00' });
    ids['B'] = await w.seed({ erpNumber: 8002, sellerCode: 107, accountEmail: SELLER2, ageMinutes: 200, total: '20.00' });
    orderC = await w.seed({ erpNumber: 8003, sellerCode: 103, accountEmail: SELLER1, ageMinutes: 100, total: '30.00' });
    ids['D'] = await w.seed({ erpNumber: 8004, sellerCode: 103, accountEmail: SELLER1, ageMinutes: 50 });
    w.book.stageFacts.set(8001, facts({ pendingReleases: [{ event: 44, cascadeSequence: 1, assignedUserCode: 120 }] }));
    w.book.stageFacts.set(8002, facts({ pendingReleases: [{ event: 3, cascadeSequence: null, assignedUserCode: 130 }] }));
    w.book.stageFacts.set(8003, facts({ pendingReleases: [{ event: 13, cascadeSequence: null }] }));
    w.book.stageFacts.set(8004, facts());
    await w.service.runStageOnce();
    // The directory login stores the Sankhya user code (CODUSU) in account.external_user_id: seller1 is listed (120), seller2 is not (999).
    const pool = w.app.database.handle.pool;
    await pool.query(`UPDATE account SET external_user_id = '120' WHERE id = $1`, [w.app.accounts.ids[SELLER1]]);
    await pool.query(`UPDATE account SET external_user_id = '999' WHERE id = $1`, [w.app.accounts.ids[SELLER2]]);
    await createTestAccount(w.app.database.handle, { username: 'technical@example.test', role: 'technical' }, w.app.clock.fn);
    technicalCookie = await loginCookie(w.app, 'technical@example.test', TEST_PASSWORD);
    // `operations` accounts (owner ruling 2026-11-23, option A): the test harness logs in with a local password (dev mode), then the
    // directory link (CODUSU) the production directory login would have stored is set: 121 is listed under Pedidos (120, seller1's code, is listed too: a seller never sees the queue), 998 is not (seller2 holds 999).
    for (const [name, codusu] of [['ops-listed', '121'], ['ops-other', '998']] as const) {
      await createTestAccount(w.app.database.handle, { username: `${name}@example.test`, role: 'operations' }, w.app.clock.fn);
      const cookie = await loginCookie(w.app, `${name}@example.test`, TEST_PASSWORD);
      await pool.query(`UPDATE account SET external_user_id = $1 WHERE lower(email) = $2`, [codusu, `${name}@example.test`]);
      if (name === 'ops-listed') opsListedCookie = cookie;
      else opsOtherCookie = cookie;
    }
  });

  const rowsOf = (body: Json) => body.items.map((item: Json) => [item.nunota, item.sector]);

  it.each(['manager', 'admin'] as const)('%s sees every sector, one row per line and sector, oldest waiting first', async (who) => {
    const response = await w.app.call(who, 'GET', '/release-queue');
    expect(response.status).toBe(200);
    // A (300 min) < B (200) < C (100, two sectors: ties by note number then sector name).
    expect(rowsOf(response.body)).toEqual([[8001, 'Pedidos'], [8002, 'Financeiro'], [8003, 'Financeiro'], [8003, 'Pedidos']]);
    expect(response.body).toMatchObject({ total: 4, page: 1 });
    const first = response.body.items[0];
    expect(first).toMatchObject({ orderId: orderA, event: 44, cascadeSequence: 1, assignedUserCode: 120, sellerCode: 103, waitingSinceSource: 'order_time', estimatedTotal: '10' });
    expect(first.waitingMinutes).toBe(Math.floor((w.app.clock.fn().getTime() - (T0 - 300 * MIN)) / MIN));
    expect(typeof first.customerName).toBe('string');
    expect(first.customerName.length).toBeGreaterThan(0);
    expect(new Date(first.checkedAt).getTime()).toBe(T0);
  });

  it('counts an order once in the total even when its line shows in both sectors', async () => {
    const response = await w.app.call('manager', 'GET', '/release-queue/count');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      total: 3,
      sectors: [{ sector: 'Pedidos', count: 2 }, { sector: 'Financeiro', count: 2 }],
      lastCheckedAt: new Date(T0).toISOString(),
    });
    const onlyFinancial = await w.app.call('admin', 'GET', '/release-queue/count?sector=Financeiro');
    expect(onlyFinancial.body).toMatchObject({ total: 2, sectors: [{ sector: 'Financeiro', count: 2 }] });
  });

  it('filters: sector, seller code, assigned user; an unknown sector name is an empty queue, not an error', async () => {
    expect(rowsOf((await w.app.call('manager', 'GET', '/release-queue?sector=Financeiro')).body)).toEqual([[8002, 'Financeiro'], [8003, 'Financeiro']]);
    expect(rowsOf((await w.app.call('manager', 'GET', '/release-queue?sellerCode=107')).body)).toEqual([[8002, 'Financeiro']]);
    expect(rowsOf((await w.app.call('manager', 'GET', '/release-queue?assignedUserCode=120')).body)).toEqual([[8001, 'Pedidos']]);
    const unknown = await w.app.call('manager', 'GET', '/release-queue?sector=Inexistente');
    expect(unknown.status).toBe(200);
    expect(unknown.body).toMatchObject({ items: [], total: 0 });
    expect((await w.app.call('manager', 'GET', '/release-queue/count?sector=Inexistente')).body).toMatchObject({ total: 0, sectors: [] });
  });

  it('paginates (page size 1) without losing or repeating a row', async () => {
    const seen: unknown[] = [];
    for (const page of [1, 2, 3, 4]) {
      const response = await w.app.call('manager', 'GET', `/release-queue?page=${page}&pageSize=1`);
      expect(response.body.total).toBe(4);
      seen.push(...rowsOf(response.body));
    }
    expect(seen).toEqual([[8001, 'Pedidos'], [8002, 'Financeiro'], [8003, 'Financeiro'], [8003, 'Pedidos']]);
    expect((await w.app.call('manager', 'GET', '/release-queue?page=5&pageSize=1')).body.items).toEqual([]);
  });

  it('an operations account listed under Pedidos sees only Pedidos (never Financeiro), with matching counts', async () => {
    const list = await callOps(opsListedCookie, '/release-queue');
    expect(list.status).toBe(200);
    expect(rowsOf(list.body)).toEqual([[8001, 'Pedidos'], [8003, 'Pedidos']]);
    expect(list.body.total).toBe(2);
    expect((await callOps(opsListedCookie, '/release-queue?sector=Pedidos')).status).toBe(200);
    const count = await callOps(opsListedCookie, '/release-queue/count');
    expect(count.body).toMatchObject({ total: 2, sectors: [{ sector: 'Pedidos', count: 2 }] });
    expect(JSON.stringify(count.body)).not.toMatch(/Financeiro/);
  });

  it('a forbidden sector filter is 403 (not an empty list), for the list and the count', async () => {
    expect((await callOps(opsListedCookie, '/release-queue?sector=Financeiro')).status).toBe(403);
    expect((await callOps(opsListedCookie, '/release-queue/count?sector=Financeiro')).status).toBe(403);
  });

  it('an operations account not listed gets 403 on both routes; so does a listed one when the installation lists nobody', async () => {
    expect((await callOps(opsOtherCookie, '/release-queue')).status).toBe(403);
    expect((await callOps(opsOtherCookie, '/release-queue/count')).status).toBe(403);
    const bare = await world();
    await createTestAccount(bare.app.database.handle, { username: 'ops@example.test', role: 'operations' }, bare.app.clock.fn);
    const cookie = await loginCookie(bare.app, 'ops@example.test', TEST_PASSWORD);
    await bare.app.database.handle.pool.query(`UPDATE account SET external_user_id = '120' WHERE lower(email) = 'ops@example.test'`);
    const response = await bare.app.app.inject({ method: 'GET', url: '/api/v1/release-queue', headers: { origin: TEST_ORIGIN, cookie } });
    expect(response.statusCode).toBe(403);
    expect((await bare.app.call('manager', 'GET', '/release-queue')).status).toBe(200);
  });

  it('a seller is refused (403) on both routes, even when its Sankhya user is listed under a sector (owner ruling 2026-11-23)', async () => {
    // seller1 carries external_user_id 120, the same CODUSU that is listed under Pedidos.
    expect((await w.app.call('seller1', 'GET', '/release-queue')).status).toBe(403);
    expect((await w.app.call('seller1', 'GET', '/release-queue/count')).status).toBe(403);
    expect((await w.app.call('seller1', 'GET', '/release-queue?sector=Pedidos')).status).toBe(403);
    expect((await w.app.call('seller2', 'GET', '/release-queue')).status).toBe(403);
  });

  it('operations has no other route: orders, customers, prices, dashboard, configuration and approvals are all 403 (deny by default)', async () => {
    for (const url of ['/orders', '/customers', '/products', '/dashboard', '/configuration', '/approvals', '/sellers', '/discount-limits', '/sync/status']) {
      expect((await callWith(opsListedCookie, url)).statusCode, url).toBe(403);
    }
  });

  it('technical is refused by the route guard (403) on both routes', async () => {
    expect((await callTechnical('/release-queue')).statusCode).toBe(403);
    expect((await callTechnical('/release-queue/count')).statusCode).toBe(403);
  });

  it('carries no cost, margin or commission field, for any profile', async () => {
    for (const who of ['manager', 'admin'] as const) {
      expect(restrictedKeys((await w.app.call(who, 'GET', '/release-queue')).body), who).toEqual([]);
      expect(restrictedKeys((await w.app.call(who, 'GET', '/release-queue/count')).body), who).toEqual([]);
    }
    expect(restrictedKeys((await callOps(opsListedCookie, '/release-queue')).body)).toEqual([]);
    expect(restrictedKeys((await callOps(opsListedCookie, '/release-queue/count')).body)).toEqual([]);
  });

  it('is read-only: no write verb exists on the routes', async () => {
    for (const method of ['POST', 'PUT', 'DELETE'] as const) {
      const response = await w.app.call('manager', method, '/release-queue', {});
      expect([404, 405]).toContain(response.status);
    }
  });

  it('pending -> released leaves the queue on the next read; a failed read keeps the rows; the counter follows', async () => {
    // A failed read: the rows stay (and the order list shows the stored stage with a readError).
    w.state.now += 10 * MIN;
    w.state.failWith = new SankhyaGatewayError('unavailable', { code: 'erp_down', message: 'down' });
    await w.service.runStageOnce();
    w.state.failWith = null;
    expect((await w.app.call('manager', 'GET', '/release-queue/count')).body.total).toBe(3);
    const during = await w.app.call('seller1', 'GET', `/orders/${orderA}`);
    expect(during.body.erpStage).toMatchObject({ stage: 'in_review', readError: { errorClass: 'unavailable', errorCode: 'erp_down' } });

    // Order A is released in Sankhya (no pending line, note confirmed): it leaves the queue; C keeps its lines.
    w.state.now += 10 * MIN;
    w.book.stageFacts.set(8001, facts({ statusNota: 'L' }));
    await w.service.runStageOnce();
    const after = await w.app.call('manager', 'GET', '/release-queue');
    expect(rowsOf(after.body)).toEqual([[8002, 'Financeiro'], [8003, 'Financeiro'], [8003, 'Pedidos']]);
    expect((await w.app.call('manager', 'GET', '/release-queue/count')).body).toMatchObject({ total: 2, sectors: [{ sector: 'Pedidos', count: 1 }, { sector: 'Financeiro', count: 2 }] });
    expect(rowsOf((await callOps(opsListedCookie, '/release-queue')).body)).toEqual([[8003, 'Pedidos']]);
    const cleared = await w.app.call('seller1', 'GET', `/orders/${orderA}`);
    expect(cleared.body.erpStage).toMatchObject({ stage: 'in_dispatch', readError: null });
    // Order C is invoiced: leaves as well; the empty queue has no lastCheckedAt.
    w.state.now += 10 * MIN;
    w.book.stageFacts.set(8003, facts({ statusNota: 'L', hasInvoiceLink: true, invoiceNumber: 42 }));
    w.book.stageFacts.set(8002, facts({ statusNota: 'L' }));
    await w.service.runStageOnce();
    expect((await w.app.call('manager', 'GET', '/release-queue')).body).toMatchObject({ items: [], total: 0 });
    expect((await w.app.call('manager', 'GET', '/release-queue/count')).body).toEqual({ total: 0, sectors: [{ sector: 'Pedidos', count: 0 }, { sector: 'Financeiro', count: 0 }], lastCheckedAt: null });
    expect(orderC).toBeDefined();
  });
});

describe('erpStage on the order DTOs: scope and restricted data', () => {
  let w: Awaited<ReturnType<typeof world>>;
  let own: string;
  let foreign: string;

  beforeAll(async () => {
    w = await world();
    own = await w.seed({ erpNumber: 7001, sellerCode: 103, accountEmail: SELLER1 });
    foreign = await w.seed({ erpNumber: 7002, sellerCode: 107, accountEmail: SELLER2 });
    w.book.stageFacts.set(7001, facts({ pendingReleases: [{ event: 44, cascadeSequence: 1 }] }));
    w.book.stageFacts.set(7002, facts({ statusNota: 'L', orderCargo: 3 }));
    await w.service.runStageOnce();
  });

  it('the owner seller sees the stage of its order in the detail and the list', async () => {
    const detail = await w.app.call('seller1', 'GET', `/orders/${own}`);
    expect(detail.status).toBe(200);
    expect(detail.body.erpStage).toMatchObject({ stage: 'in_review', label: 'Em revisão', pendingSector: 'Pedidos', nunota: 7001, invoiceNumber: null, readError: null });
    const list = await w.app.call('seller1', 'GET', '/orders?pageSize=100');
    const item = list.body.items.find((x: Json) => x.id === own);
    expect(item.erpStage).toMatchObject({ stage: 'in_review' });
  });

  it('a seller never sees the stage (or the order) of another seller', async () => {
    const list = await w.app.call('seller1', 'GET', '/orders?pageSize=100');
    expect(list.body.items.map((x: Json) => x.id)).not.toContain(foreign);
    expect(JSON.stringify(list.body)).not.toContain('7002');
    const detail = await w.app.call('seller1', 'GET', `/orders/${foreign}`);
    expect([403, 404]).toContain(detail.status);
    expect(JSON.stringify(detail.body)).not.toMatch(/erpStage|in_invoicing/);
  });

  it('the manager sees both; neither response carries cost or margin fields', async () => {
    const list = await w.app.call('manager', 'GET', '/orders?pageSize=100');
    const stages = Object.fromEntries(list.body.items.map((x: Json) => [x.id, x.erpStage?.stage]));
    expect(stages[own]).toBe('in_review');
    expect(stages[foreign]).toBe('in_invoicing');
    for (const [who, id] of [['seller1', own], ['manager', foreign]] as const) {
      expect(restrictedKeys((await w.app.call(who, 'GET', `/orders/${id}`)).body), who).toEqual([]);
    }
    expect(restrictedKeys(list.body)).toEqual([]);
    expect(restrictedKeys((await w.app.call('seller1', 'GET', '/orders?pageSize=100')).body)).toEqual([]);
  });

  it('a read error is visible as readError with class and code only (no provider text)', async () => {
    w.state.now += 10 * MIN;
    w.state.failWith = new SankhyaGatewayError('rate_limit', { code: 'erp_slow', message: 'Sensitive provider text with a-token-like-value' });
    await w.service.runStageOnce();
    const detail = await w.app.call('seller1', 'GET', `/orders/${own}`);
    expect(detail.body.erpStage.readError).toMatchObject({ errorClass: 'rate_limit', errorCode: 'erp_slow' });
    expect(JSON.stringify(detail.body)).not.toMatch(/Sensitive provider text|a-token-like-value/);
    expect(detail.body.erpStage.stage).toBe('in_review');
  });
});
