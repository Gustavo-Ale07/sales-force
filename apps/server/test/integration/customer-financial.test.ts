import { erpCustomer, erpOpenTitle } from '@salesforce/db';
import { DEMO_CONFIGURATION, getDemoDataset } from '@salesforce/sankhya';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startCommercialApp, type CommercialApp, type Json, type Who } from '../helpers/commercial-app.js';
import { startPostgres, type TestPostgres, closeAllThenStop } from '../helpers/postgres.js';

/**
 * D-I: read-only financial area of a customer. Same scope as the portfolio (out of scope = 404), absent (404) when the installation
 * does not show it, limits only with `showCreditLimit`, overdue only with `overdueTitles`. Nothing here blocks anything.
 */

const dataset = getDemoDataset();
let postgres: TestPostgres;
const opened: (() => Promise<unknown>)[] = [];

const on = { ...DEMO_CONFIGURATION, financial: { showFinancialArea: true, overdueTitles: true, creditChecks: false } };
const noOverdueNoLimit = {
  ...DEMO_CONFIGURATION,
  customers: { ...DEMO_CONFIGURATION.customers, creditFeatures: { showCreditLimit: false } },
  financial: { showFinancialArea: true, overdueTitles: false, creditChecks: false },
};

let enabled: CommercialApp;
let restricted: CommercialApp;
let disabled: CommercialApp;
let mine: number; // seller1's customer
let foreign: number; // outside seller1's portfolio

const FAR_PAST = '2020-01-01';
const FAR_FUTURE = '2099-01-01';

async function seedTitles(ctx: CommercialApp, customerCode: number, offset: number): Promise<void> {
  const db = ctx.database.handle.db;
  const syncedAt = new Date('2026-11-04T10:00:00Z');
  const base = { customerCode, companyCode: 1, contentHash: 'x', sourceChangedAt: null, syncedAt, deletedAt: null };
  await db.insert(erpOpenTitle).values([
    { ...base, nufin: offset + 1, documentNumber: 5001, dueDate: FAR_PAST, amount: '100.00', paidAmount: '0' },
    { ...base, nufin: offset + 2, documentNumber: 5002, dueDate: FAR_FUTURE, amount: '250.50', paidAmount: '50.50' },
    { ...base, nufin: offset + 3, documentNumber: null, dueDate: FAR_PAST, amount: '30.00', paidAmount: '0', deletedAt: syncedAt },
  ]);
  await db
    .update(erpCustomer)
    .set({ creditLimit: '5000.00', monthlyCreditLimit: '1200.00', blockReason: 'Inadimplência', situation: '1' })
    .where(eq(erpCustomer.code, customerCode));
}

beforeAll(async () => {
  postgres = await startPostgres();
  enabled = await startCommercialApp(postgres, opened, { configuration: on });
  restricted = await startCommercialApp(postgres, opened, { configuration: noOverdueNoLimit });
  disabled = await startCommercialApp(postgres, opened);
  const own = dataset.customers.find((c) => c.sellerCode === 103 && c.active);
  const other = dataset.customers.find((c) => c.sellerCode !== 103 && c.sellerCode !== null && c.active);
  if (own === undefined || other === undefined) throw new Error('fixture lacks customers');
  mine = own.code;
  foreign = other.code;
  for (const ctx of [enabled, restricted, disabled]) {
    await seedTitles(ctx, mine, 9000);
    await seedTitles(ctx, foreign, 9100);
  }
});
afterAll(async () => {
  await closeAllThenStop(opened, postgres);
});

const financial = (ctx: CommercialApp, who: Who, code: number) => ctx.call(who, 'GET', `/customers/${code}/financial`);

describe('GET /customers/{code}/financial', () => {
  it('shows open and overdue titles, limits and the block reason to the owning seller', async () => {
    const { status, body } = await financial(enabled, 'seller1', mine);
    expect(status).toBe(200);
    expect(body.customerCode).toBe(mine);
    expect(body.creditLimit).toBe('5000.00');
    expect(body.monthlyCreditLimit).toBe('1200.00');
    expect(body.blockReason).toBe('Inadimplência');
    expect(body.summary).toMatchObject({ openCount: 2, openAmount: '300.00', overdueCount: 1, overdueAmount: '100.00', oldestOverdueDueDate: FAR_PAST });
    // Settled/deleted titles never appear; ordered by due date.
    expect(body.titles.map((t: Json) => t.nufin)).toEqual([9001, 9002]);
    expect(body.titles[1]).toMatchObject({ documentNumber: 5002, dueDate: FAR_FUTURE, amount: '250.50', balance: '200.00', overdue: false });
    expect(body.titles[0].overdue).toBe(true);
    expect(body.checkedAt).toBe('2026-11-04T10:00:00.000Z');
  });

  it('the manager sees the same customer', async () => {
    expect((await financial(enabled, 'manager', mine)).status).toBe(200);
  });

  it('a customer outside the seller scope is reported exactly like a missing one', async () => {
    const outside = await financial(enabled, 'seller1', foreign);
    const missing = await financial(enabled, 'seller1', 2_000_000_000);
    expect(outside.status).toBe(404);
    expect({ code: outside.body.code, message: outside.body.message }).toEqual({ code: missing.body.code, message: missing.body.message });
  });

  it('requires a session', async () => {
    const response = await enabled.app.inject({ method: 'GET', url: `/api/v1/customers/${mine}/financial` });
    expect(response.statusCode).toBe(401);
  });

  it('hides limits without showCreditLimit and overdue without overdueTitles', async () => {
    const { status, body } = await financial(restricted, 'seller1', mine);
    expect(status).toBe(200);
    expect(body.creditLimit).toBeNull();
    expect(body.monthlyCreditLimit).toBeNull();
    expect(body.summary).toMatchObject({ openCount: 2, overdueCount: null, overdueAmount: null, oldestOverdueDueDate: null });
    expect(body.titles.every((t: Json) => t.overdue === false)).toBe(true);
  });

  it('is absent (404) when the installation does not show the financial area', async () => {
    expect((await financial(disabled, 'seller1', mine)).status).toBe(404);
    expect((await financial(disabled, 'admin', mine)).status).toBe(404);
  });
});

describe('overdue hint in the portfolio list', () => {
  it('marks only the customer with an overdue title, when overdue titles are shown', async () => {
    const { body } = await enabled.call('manager', 'GET', '/customers?pageSize=100');
    const flagged = body.items.filter((c: Json) => c.overdue === true).map((c: Json) => c.code);
    expect(flagged.sort()).toEqual([mine, foreign].sort());
  });

  it('never marks anything without overdue titles or without the financial area', async () => {
    for (const ctx of [restricted, disabled]) {
      const { body } = await ctx.call('manager', 'GET', '/customers?pageSize=100');
      expect(body.items.some((c: Json) => c.overdue !== undefined)).toBe(false);
    }
  });
});
