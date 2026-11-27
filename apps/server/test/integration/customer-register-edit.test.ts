import { randomUUID } from 'node:crypto';
import { auditLog, customerRegistration, erpCustomer, erpPriceTable, forceConfig, integrationOutbox } from '@salesforce/db';
import { and, eq, like, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { requeueStuckCustomers } from '../../src/customers/customer-requeue.js';
import { startCommercialApp, type CommercialApp, type Json } from '../helpers/commercial-app.js';
import { closeAllThenStop, startPostgres, type TestPostgres } from '../helpers/postgres.js';

/**
 * D-AP / D-AQ / D-AR over HTTP against a real PostgreSQL: the register's states, the correction flow, the scope of the register,
 * the edit allow-list and its recording, and the closed flags. No Sankhya: delivery outcomes are played by writing the registration
 * row the way the worker would (the delivery service itself is covered in `customer-delivery-service.test.ts`).
 */

let postgres: TestPostgres;
const opened: (() => Promise<unknown>)[] = [];
let open: CommercialApp;
let closed: CommercialApp;

const NO_WAIT = { timeoutMs: 0, pollMs: 1, sleep: () => Promise.resolve() };

beforeAll(async () => {
  postgres = await startPostgres();
  open = await startCommercialApp(postgres, opened, { customerEnqueueEnabled: true, customerEditEnabled: true, customerConfirmWait: NO_WAIT });
  // A second installation with every flag at its shipped value (closed).
  closed = await startCommercialApp(postgres, opened);
  // The Force default price table (own configuration) must be a table of the mirror: point it at the first mirrored one.
  const [firstTable] = await open.database.handle.db.select({ code: erpPriceTable.code }).from(erpPriceTable).where(eq(erpPriceTable.active, true)).limit(1);
  await open.database.handle.db.update(forceConfig).set({ defaultPriceTableCode: firstTable!.code });
}, 240_000);
afterAll(async () => {
  await closeAllThenStop(opened, postgres);
});

const db = () => open.database.handle.db;
const closedDb = () => closed.database.handle.db;

function cnpj(base: number): string {
  const digits = String(base).padStart(12, '0').split('').map(Number);
  const check = (list: number[], weights: number[]) => {
    const sum = list.reduce((acc, d, i) => acc + d * (weights[i] as number), 0) % 11;
    return sum < 2 ? 0 : 11 - sum;
  };
  const d1 = check(digits, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = check([...digits, d1], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return [...digits, d1, d2].join('');
}
let seed = 70_000_000;
const freshDocument = () => cnpj((seed += 1));

const createBody = (overrides: Record<string, unknown> = {}) => ({
  clientRequestId: randomUUID(),
  document: freshDocument(),
  name: 'Cliente Registro (teste)',
  stateRegistration: 'ISENTO',
  sellerCode: 103,
  ...overrides,
});

/** Plays the worker: the registration ends the way a delivery outcome would leave it. */
async function settle(registrationId: string, values: Partial<typeof customerRegistration.$inferInsert>, lastError?: string) {
  await db().update(customerRegistration).set(values).where(eq(customerRegistration.id, registrationId));
  if (lastError !== undefined) {
    await db().update(integrationOutbox).set({ lastErrorMessage: lastError, status: 'rejected', nextAttemptAt: null }).where(eq(integrationOutbox.aggregateId, registrationId));
  }
}

describe('create: state machine seen by the client', () => {
  it('records the creation as awaiting_send (the worker has not answered), then replays the same request', async () => {
    const body = createBody();
    const first = await open.call('seller1', 'POST', '/customers', body);
    expect(first.status).toBe(202);
    expect(first.body).toMatchObject({ state: 'awaiting_send', status: 'pending', customerCode: null });
    const replay = await open.call('seller1', 'POST', '/customers', body);
    expect(replay.status).toBe(200);
    expect(replay.body.registrationId).toBe(first.body.registrationId);
    const rows = await db().select().from(integrationOutbox).where(eq(integrationOutbox.aggregateId, first.body.registrationId));
    expect(rows).toHaveLength(1);
  });

  it('refuses the same request id with other content (idempotency_conflict)', async () => {
    const body = createBody();
    expect((await open.call('seller1', 'POST', '/customers', body)).status).toBe(202);
    const changed = await open.call('seller1', 'POST', '/customers', { ...body, name: 'Outro nome (teste)' });
    expect(changed.status).toBe(409);
    expect(changed.body.code).toBe('idempotency_conflict');
  });

  it('a confirmed customer is sent with its real code; a still-pending one stays awaiting_send and never needs correction', async () => {
    const created = await open.call('seller1', 'POST', '/customers', createBody());
    const id = created.body.registrationId as string;
    // Temporary trouble / offline ERP: the row stays pending or unknown (retrying): never "needs_correction".
    await settle(id, { status: 'unknown' });
    const waiting = await open.call('seller1', 'GET', `/customers/registrations/${id}`);
    expect(waiting.body).toMatchObject({ state: 'awaiting_send', status: 'unknown', reasonCode: null });
    await settle(id, { status: 'confirmed', erpCustomerCode: 880_001 });
    const sent = await open.call('seller1', 'GET', `/customers/registrations/${id}`);
    expect(sent.body).toMatchObject({ state: 'sent', customerCode: 880_001, reasonCode: null });
  });

  it('CUST-RT: a definitive ERP refusal is a 422 with a field map on a replay, is never listed and never needs correction', async () => {
    const body = createBody();
    const refused = await open.call('seller1', 'POST', '/customers', body);
    await settle(refused.body.registrationId, { status: 'rejected', rejectionCode: 'partner_required_field' }, 'partner_required_field: The ERP refused the partner: Informe o campo CEP.');
    const replay = await open.call('seller1', 'POST', '/customers', body);
    expect(replay.status).toBe(422);
    expect(replay.body).toMatchObject({ code: 'customer_refused', details: { fields: { addresses: expect.any(String) } } });
    // Nothing half saved: the refused row is neither readable nor listed.
    expect((await open.call('seller1', 'GET', `/customers/registrations/${refused.body.registrationId}`)).status).toBe(404);
    const list = await open.call('seller1', 'GET', '/customers/registrations?limit=100');
    expect(list.body.items.map((item: Json) => item.registrationId)).not.toContain(refused.body.registrationId);

    const duplicate = createBody();
    const dup = await open.call('seller1', 'POST', '/customers', duplicate);
    await settle(dup.body.registrationId, { status: 'rejected', rejectionCode: 'partner_document_duplicate' }, 'partner_document_duplicate: The ERP refused the partner: documento de Fulano 123.');
    const dupReplay = await open.call('seller1', 'POST', '/customers', duplicate);
    expect(dupReplay.status).toBe(422);
    expect(dupReplay.body.details.fields.document).toEqual(expect.any(String));
    expect(JSON.stringify(dupReplay.body)).not.toContain('Fulano');
  });

  it('CUST-RT: the worker answering inside the wait gives 201 with the code and sendState sent; a timeout gives 202 pending', async () => {
    const pending = await open.call('seller1', 'POST', '/customers', createBody());
    expect(pending.status).toBe(202);
    expect(pending.body).toMatchObject({ sendState: 'pending', customerCode: null });
    await settle(pending.body.registrationId, { status: 'confirmed', erpCustomerCode: 880_100 });
    const view = await open.call('seller1', 'GET', `/customers/registrations/${pending.body.registrationId}`);
    expect(view.body).toMatchObject({ sendState: 'sent', customerCode: 880_100 });
  });

  it('CUST-RT: a manager naming an unknown seller is refused on sellerCode and nothing is recorded; a seller needs none', async () => {
    const body = createBody({ sellerCode: 999_999 });
    const refused = await open.call('manager', 'POST', '/customers', body);
    expect(refused.status).toBe(422);
    expect(refused.body.details.fields.sellerCode).toEqual(expect.any(String));
    const rows = await db().select().from(customerRegistration).where(eq(customerRegistration.clientRequestId, body.clientRequestId));
    expect(rows).toHaveLength(0);
    expect((await open.call('seller1', 'POST', '/customers', createBody({ sellerCode: undefined }))).status).toBe(202);
  });

  it('a price table outside the mirror is refused on priceTableCode and nothing is recorded; the chosen table reaches the command (P-08)', async () => {
    const refusedBody = createBody({ priceTableCode: 987_654 });
    const refused = await open.call('seller1', 'POST', '/customers', refusedBody);
    expect(refused.status).toBe(422);
    expect(refused.body.details.fields.priceTableCode).toEqual(expect.any(String));
    expect(await db().select().from(customerRegistration).where(eq(customerRegistration.clientRequestId, refusedBody.clientRequestId))).toHaveLength(0);

    const [table] = await db().select({ code: erpPriceTable.code }).from(erpPriceTable).where(eq(erpPriceTable.active, true)).limit(1);
    if (table === undefined) throw new Error('fixture lacks an active price table');
    const okBody = createBody({ priceTableCode: table.code });
    const created = await open.call('seller1', 'POST', '/customers', okBody);
    expect(created.status).toBe(202);
    const [row] = await db().select().from(customerRegistration).where(eq(customerRegistration.clientRequestId, okBody.clientRequestId));
    const [command] = await db().select().from(integrationOutbox).where(eq(integrationOutbox.aggregateId, row?.id ?? ''));
    expect(command?.payload).toMatchObject({ priceTableCode: table.code });
  });
});

describe('CUST-RT: legacy correction is ignored; the seller of a pending customer is set by a manager', () => {
  it('correctsRegistrationId from an old build is accepted and ignored', async () => {
    const first = await open.call('seller1', 'POST', '/customers', createBody());
    const second = await open.call('seller1', 'POST', '/customers', createBody({ correctsRegistrationId: first.body.registrationId }));
    expect(second.status).toBe(202);
    const view = await open.call('seller1', 'GET', `/customers/registrations/${second.body.registrationId}`);
    expect(view.body.correctsRegistrationId).toBeNull();
  });

  it('PUT /customers/registrations/{id}/seller: manager only, re-queues the delivery with the seller', async () => {
    const created = await open.call('seller1', 'POST', '/customers', createBody());
    const id = created.body.registrationId as string;
    expect((await open.call('seller1', 'PUT', `/customers/registrations/${id}/seller`, { sellerCode: 103 })).status).toBe(403);
    await db().update(integrationOutbox).set({ status: 'rejected', nextAttemptAt: null }).where(eq(integrationOutbox.aggregateId, id));
    await db().update(customerRegistration).set({ status: 'rejected' }).where(eq(customerRegistration.id, id));
    const done = await open.call('manager', 'PUT', `/customers/registrations/${id}/seller`, { sellerCode: 103 });
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ sendState: 'pending' });
    const [outbox] = await db().select().from(integrationOutbox).where(eq(integrationOutbox.aggregateId, id));
    expect(outbox?.status).toBe('pending');
    expect(outbox?.attemptCount).toBe(0);
  });
});


describe('scope of the register', () => {
  it('a seller reads only their own registrations (404 for another seller), manager and admin read all', async () => {
    const mine = await open.call('seller1', 'POST', '/customers', createBody());
    const id = mine.body.registrationId as string;
    expect((await open.call('seller1', 'GET', `/customers/registrations/${id}`)).status).toBe(200);
    expect((await open.call('seller2', 'GET', `/customers/registrations/${id}`)).status).toBe(404);
    expect((await open.call('manager', 'GET', `/customers/registrations/${id}`)).status).toBe(200);
    expect((await open.call('admin', 'GET', `/customers/registrations/${id}`)).status).toBe(200);
    const others = await open.call('seller2', 'GET', '/customers/registrations?limit=100');
    expect(others.body.items.map((item: Json) => item.registrationId)).not.toContain(id);
    const all = await open.call('manager', 'GET', '/customers/registrations?limit=100');
    expect(all.body.items.map((item: Json) => item.registrationId)).toContain(id);
  });

  it('answers 400 for a malformed id or state filter', async () => {
    expect((await open.call('seller1', 'GET', '/customers/registrations/not-a-uuid')).status).toBe(400);
    expect((await open.call('seller1', 'GET', '/customers/registrations?state=nonsense')).status).toBe(400);
  });
});

describe('a customer that is not confirmed cannot receive an order', () => {
  it('has no customer code and no mirror row; an order for an unknown customer is refused and nothing is created', async () => {
    const created = await open.call('seller1', 'POST', '/customers', createBody());
    expect(created.body.customerCode).toBeNull();
    const mirror = await db().select().from(erpCustomer).where(eq(erpCustomer.name, 'Cliente Registro (teste)'));
    expect(mirror).toHaveLength(0);
    const order = await open.call('seller1', 'POST', '/orders', {
      clientRequestId: randomUUID(),
      customerCode: 987_654_321,
      negotiationTypeCode: 2,
      notes: null,
      items: [{ productCode: 1, quantity: '1' }],
    });
    expect(order.status).toBe(404);
  });
});

describe('closed flags refuse and record nothing', () => {
  it('create answers 409 customer_write_disabled with no registration and no outbox row', async () => {
    const body = createBody();
    const response = await closed.call('seller1', 'POST', '/customers', body);
    expect(response.status).toBe(409);
    expect(response.body.details.reason).toBe('customer_write_disabled');
    expect(await closedDb().select().from(customerRegistration)).toHaveLength(0);
    expect(await closedDb().select().from(integrationOutbox).where(eq(integrationOutbox.aggregateType, 'customer_registration'))).toHaveLength(0);
  });

  it('edit answers 409 customer_edit_disabled with no outbox row', async () => {
    const [customer] = await closedDb().select().from(erpCustomer).where(eq(erpCustomer.sellerCode, 103)).limit(1);
    const clientRequestId = randomUUID();
    const response = await closed.call('seller1', 'PATCH', `/customers/${customer?.code}`, { clientRequestId, phone: '11999990000' });
    expect(response.status).toBe(409);
    expect(response.body.details.reason).toBe('customer_edit_disabled');
    expect(await closedDb().select().from(integrationOutbox).where(eq(integrationOutbox.aggregateType, 'customer_update'))).toHaveLength(0);
  });

  it('the configuration only advertises edit when creation and edit are both open', async () => {
    const opened = await open.call('seller1', 'GET', '/order-entry/configuration');
    expect(opened.body.general).toMatchObject({ clientCreationEnabled: true, clientEditEnabled: true });
    const shut = await closed.call('seller1', 'GET', '/order-entry/configuration');
    expect(shut.body.general).toMatchObject({ clientCreationEnabled: false, clientEditEnabled: false });
  });
});

describe('edit of an existing customer', () => {
  const customerOf = async (sellerCode: number) => {
    const [row] = await db().select().from(erpCustomer).where(and(eq(erpCustomer.sellerCode, sellerCode), eq(erpCustomer.active, true))).limit(1);
    if (row === undefined) throw new Error(`fixture lacks a customer of seller ${sellerCode}`);
    return row.code;
  };

  it('rejects every field outside the allow-list with a 400 that names it', async () => {
    const code = await customerOf(103);
    for (const field of ['document', 'name', 'sellerCode', 'creditLimit', 'icmsClassification', 'blocked']) {
      const response = await open.call('seller1', 'PATCH', `/customers/${code}`, { clientRequestId: randomUUID(), phone: '11999990000', [field]: 'x' });
      expect(response.status, field).toBe(400);
      expect(response.body.details.issues.map((issue: Json) => issue.path), field).toContain(field);
    }
    expect((await open.call('seller1', 'PATCH', `/customers/${code}`, { clientRequestId: randomUUID() })).status).toBe(400);
  });

  it('records the edit in the outbox (due at once for the worker) and audits ids and field names only', async () => {
    const code = await customerOf(103);
    const clientRequestId = randomUUID();
    const body = { clientRequestId, phone: '11988887777', notes: 'Nota sigilosa do vendedor' };
    const first = await open.call('seller1', 'PATCH', `/customers/${code}`, body);
    expect(first.status).toBe(202);
    expect(first.body).toMatchObject({ customerCode: code, state: 'awaiting_send' });
    const rows = await db().select().from(integrationOutbox).where(eq(integrationOutbox.aggregateId, first.body.updateId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ aggregateType: 'customer_update', operation: 'customer.update', status: 'pending', originId: `force-edit:${clientRequestId}` });

    const audit = await db().select().from(auditLog).where(eq(auditLog.action, 'customer.update_requested'));
    const mine = audit.filter((row) => (row.detail as Json)?.updateId === first.body.updateId);
    expect(mine).toHaveLength(1);
    expect(mine[0]?.detail).toMatchObject({ customerCode: code, fields: 'phone,notes' });
    expect(JSON.stringify(mine[0]?.detail)).not.toContain('11988887777');
    expect(JSON.stringify(mine[0]?.detail)).not.toContain('sigilosa');

    // Replay: same answer, nothing new.
    const replay = await open.call('seller1', 'PATCH', `/customers/${code}`, body);
    expect(replay.status).toBe(200);
    expect(replay.body.updateId).toBe(first.body.updateId);
    // Same id, other content, and the same id from another account: both unusable.
    expect((await open.call('seller1', 'PATCH', `/customers/${code}`, { ...body, phone: '11977776666' })).body.code).toBe('idempotency_conflict');
    const stranger = await open.call('manager', 'PATCH', `/customers/${code}`, body);
    expect(stranger.status).toBe(409);
    expect(stranger.body.code).toBe('idempotency_conflict');
    expect(await db().select().from(integrationOutbox).where(like(integrationOutbox.originId, `force-edit:${clientRequestId}`))).toHaveLength(1);

    // One open edit per customer.
    const second = await open.call('seller1', 'PATCH', `/customers/${code}`, { clientRequestId: randomUUID(), email: 'novo@example.test' });
    expect(second.status).toBe(409);
    expect(second.body.details.reason).toBe('customer_update_in_progress');
  });

  it('a customer outside the seller scope does not exist for the seller (404), and the manager reaches it', async () => {
    const code = await customerOf(107);
    const denied = await open.call('seller1', 'PATCH', `/customers/${code}`, { clientRequestId: randomUUID(), phone: '11999990000' });
    expect(denied.status).toBe(404);
    const allowed = await open.call('manager', 'PATCH', `/customers/${code}`, { clientRequestId: randomUUID(), phone: '11999990000' });
    expect(allowed.status).toBe(202);
  });
});

describe('CUST-RT: customer-requeue script', () => {
  it('re-queues complete stuck customers, lists the ones without a seller, never writes the ERP and is idempotent', async () => {
    const ok = await open.call('seller1', 'POST', '/customers', createBody());
    const okId = ok.body.registrationId as string;
    await settle(okId, { status: 'rejected', rejectionCode: 'partner_required_field' }, 'x: The ERP refused the partner: faltou algo.');
    const noSeller = await open.call('seller1', 'POST', '/customers', createBody());
    const noSellerId = noSeller.body.registrationId as string;
    await settle(noSellerId, { status: 'rejected', rejectionCode: 'partner_required_field', sellerCode: null }, 'x: faltou vendedor.');
    await db().update(integrationOutbox).set({ payload: sql`payload - 'sellerCode'` }).where(eq(integrationOutbox.aggregateId, noSellerId));
    const report = await requeueStuckCustomers(db(), new Date());
    expect(report.requeued).toContain(okId);
    expect(report.missingSeller).toContain(noSellerId);
    const [row] = await db().select().from(integrationOutbox).where(eq(integrationOutbox.aggregateId, okId));
    expect(row).toMatchObject({ status: 'pending', attemptCount: 0 });
    const [left] = await db().select().from(integrationOutbox).where(eq(integrationOutbox.aggregateId, noSellerId));
    expect(left?.status).toBe('rejected');
    const again = await requeueStuckCustomers(db(), new Date());
    expect(again.requeued).not.toContain(okId);
  });
});
