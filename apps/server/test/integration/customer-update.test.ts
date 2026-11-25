import { auditLog, integrationOutbox } from '@salesforce/db';
import { getDemoDataset } from '@salesforce/sankhya';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startCommercialApp, type CommercialApp } from '../helpers/commercial-app.js';
import { startPostgres, type TestPostgres, closeAllThenStop } from '../helpers/postgres.js';

/**
 * D-AP: PATCH /customers/{code}. Edit delivery to the ERP is NOT approved (`updatePartner` stays refused), so the route validates,
 * scopes, audits and refuses with 409: nothing is stored, nothing is queued, the ERP is never called.
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
  open = await startCommercialApp(postgres, opened, { customerEditEnabled: true });
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

  it('answers 409 customer_edit_delivery_not_approved with the flag open, stores nothing and audits the field names only', async () => {
    const { status, body } = await patch(open, 'seller1', mine, { clientRequestId: REQUEST_ID, phone: '11999990000', notes: 'segredo-nao-auditar' });
    expect(status).toBe(409);
    expect(body.details.reason).toBe('customer_edit_delivery_not_approved');

    const db = open.database.handle.db;
    expect(await db.select().from(integrationOutbox)).toHaveLength(0);
    const audits = await db.select().from(auditLog).where(eq(auditLog.action, 'customer.update_refused'));
    expect(audits).toHaveLength(1);
    expect(audits[0]?.detail).toMatchObject({ customerCode: mine, fields: 'phone,notes' });
    expect(JSON.stringify(audits[0]?.detail)).not.toContain('11999990000');
    expect(JSON.stringify(audits[0]?.detail)).not.toContain('segredo');
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
