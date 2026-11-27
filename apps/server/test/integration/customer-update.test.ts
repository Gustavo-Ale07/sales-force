import { auditLog, erpPriceTable, integrationOutbox } from '@salesforce/db';
import { getDemoDataset } from '@salesforce/sankhya';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startCommercialApp, type CommercialApp } from '../helpers/commercial-app.js';
import { startPostgres, type TestPostgres, closeAllThenStop } from '../helpers/postgres.js';

/**
 * D-AP: PATCH /customers/{code}. Owner-approved 2026-11-25 (Sandbox only): with the flag open the route validates, scopes, records one
 * `customer_update` outbox command plus audit and answers 202; the worker (never this route) writes to the ERP.
 */

const dataset = getDemoDataset();
let postgres: TestPostgres;
const opened: (() => Promise<unknown>)[] = [];
let closed: CommercialApp;
let open: CommercialApp;
let mine: number;
let foreign: number;

beforeAll(async () => {
  postgres = await startPostgres();
  closed = await startCommercialApp(postgres, opened);
  open = await startCommercialApp(postgres, opened, { customerEditEnabled: true, customerConfirmWait: { timeoutMs: 0, pollMs: 1, sleep: () => Promise.resolve() } });
  const own = dataset.customers.find((c) => c.sellerCode === 103 && c.active);
  const other = dataset.customers.find((c) => c.sellerCode !== 103 && c.sellerCode !== null && c.active);
  if (own === undefined || other === undefined) throw new Error('fixture lacks customers');
  mine = own.code;
  foreign = other.code;
});
afterAll(async () => {
  await closeAllThenStop(opened, postgres);
});

const REQUEST_ID = '019a0000-0000-7000-8000-0000000000aa';
const patch = (ctx: CommercialApp, who: 'seller1' | 'admin', code: number, body: unknown) => ctx.call(who, 'PATCH', `/customers/${code}`, body);

describe('PATCH /customers/{code}', () => {
  it('answers 409 customer_edit_disabled while the flag is closed (the shipped default)', async () => {
    const { status, body } = await patch(closed, 'seller1', mine, { clientRequestId: REQUEST_ID, phone: '11999990000' });
    expect(status).toBe(409);
    expect(body.details.reason).toBe('customer_edit_disabled');
  });

  it('records the edit for delivery (202 awaiting_send), audits only the field names, then replays it (200)', async () => {
    const { status, body } = await patch(open, 'seller1', mine, { clientRequestId: REQUEST_ID, phone: '11999990000', notes: 'segredo-nao-auditar' });
    expect(status).toBe(202);
    expect(body).toMatchObject({ customerCode: mine, state: 'awaiting_send', reasonCode: null });
    const db = open.database.handle.db;
    const rows = await db.select().from(integrationOutbox).where(eq(integrationOutbox.aggregateType, 'customer_update'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ operation: 'customer.update', status: 'pending', originId: `force-edit:${REQUEST_ID}` });
    expect(rows[0]?.nextAttemptAt).not.toBeNull();
    const audits = await db.select().from(auditLog).where(eq(auditLog.action, 'customer.update_requested'));
    expect(audits).toHaveLength(1);
    expect(audits[0]?.detail).toMatchObject({ customerCode: mine, fields: 'phone,notes' });
    expect(JSON.stringify(audits[0]?.detail)).not.toContain('11999990000');
    expect(JSON.stringify(audits[0]?.detail)).not.toContain('segredo');
    const replay = await patch(open, 'seller1', mine, { clientRequestId: REQUEST_ID, notes: 'segredo-nao-auditar', phone: '11999990000' });
    expect(replay.status).toBe(200);
    expect(replay.body.updateId).toBe(body.updateId);
    expect(await db.select().from(integrationOutbox).where(eq(integrationOutbox.aggregateType, 'customer_update'))).toHaveLength(1);
  });

  it('answers 409 for the same request id with other content', async () => {
    const { status } = await patch(open, 'seller1', mine, { clientRequestId: REQUEST_ID, phone: '11888880000' });
    expect(status).toBe(409);
  });

  it('answers customer_update_in_progress while another edit of the customer is open', async () => {
    const { status, body } = await patch(open, 'seller1', mine, { clientRequestId: '019a0000-0000-7000-8000-0000000000ab', email: 'novo@example.com' });
    expect(status).toBe(409);
    expect(body.details.reason).toBe('customer_update_in_progress');
  });

  it('refuses a price table that is not an active table of the mirror with 422 price_table_not_found (P-08)', async () => {
    const { status, body } = await patch(open, 'seller1', mine, { clientRequestId: '019a0000-0000-7000-8000-0000000000ac', priceTableCode: 987654 });
    expect(status).toBe(422);
    expect(body.details.fields.priceTableCode).toBeTruthy();
    expect(body.details.issues[0]).toMatchObject({ path: 'priceTableCode', code: 'price_table_not_found' });
  });

  it('accepts an active mirrored price table and records it in the command', async () => {
    const db = open.database.handle.db;
    const [table] = await db.select({ code: erpPriceTable.code }).from(erpPriceTable).where(eq(erpPriceTable.active, true)).limit(1);
    if (table === undefined) throw new Error('fixture lacks an active price table');
    const { status } = await patch(open, 'admin', foreign, { clientRequestId: '019a0000-0000-7000-8000-0000000000ad', priceTableCode: table.code });
    expect(status).toBe(202);
    const rows = await db.select().from(integrationOutbox).where(eq(integrationOutbox.originId, 'force-edit:019a0000-0000-7000-8000-0000000000ad'));
    expect(rows[0]?.payload).toMatchObject({ customerCode: foreign, changes: { priceTableCode: table.code } });
  });

  it('is 404 for a customer outside the seller scope, whatever the body says', async () => {
    const { status } = await patch(open, 'seller1', foreign, { clientRequestId: REQUEST_ID, phone: '11999990000' });
    expect(status).toBe(404);
  });

  it('refuses a field that cannot be edited with a 400 naming it', async () => {
    const { status, body } = await patch(open, 'seller1', mine, { clientRequestId: REQUEST_ID, document: '12345678000190', name: 'Outro' });
    expect(status).toBe(400);
    const paths = body.details.issues.map((issue: { path: string }) => issue.path);
    expect(paths).toEqual(expect.arrayContaining(['document', 'name']));
  });

  it('refuses an empty edit (no field to change) with a 400', async () => {
    const { status } = await patch(open, 'seller1', mine, { clientRequestId: REQUEST_ID });
    expect(status).toBe(400);
  });
});
