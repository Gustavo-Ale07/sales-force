import {
  buildDemoSalesNotes,
  DEMO_RETURN_TOP,
  DEMO_SALE_TOP,
  FakeGateway,
  getDemoDataset,
  SankhyaGatewayError,
  type SalesHistoryReadOptions,
} from '@salesforce/sankhya';
import { syncState } from '@salesforce/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogger } from '../../src/observability/logger.js';
import { MirrorSyncService } from '../../src/sync/mirror-sync.service.js';
import type { SalesHistorySyncConfig } from '../../src/sync/sales-history-config.js';
import { closeAllThenStop, createMigratedDatabase, startPostgres, type MigratedDatabase, type TestPostgres } from '../helpers/postgres.js';

const CONFIG: SalesHistorySyncConfig = {
  tops: { saleTopCodes: [DEMO_SALE_TOP], returnTopCodes: [DEMO_RETURN_TOP] },
  statusCodes: ['L'],
  dateField: 'DTNEG',
  windowMonths: 12,
};

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

async function migrated(): Promise<MigratedDatabase> {
  const database = await createMigratedDatabase(postgres);
  databases.push(database);
  return database;
}

function service(database: MigratedDatabase, gateway: FakeGateway, salesHistory: SalesHistorySyncConfig | null = CONFIG): MirrorSyncService {
  return new MirrorSyncService({
    db: database.handle,
    gateway,
    logger: createLogger({ level: 'silent', service: 'worker' }),
    now: () => new Date(),
    salesHistory,
  });
}

async function count(database: MigratedDatabase, table: string): Promise<number> {
  const { rows } = await database.handle.pool.query<{ n: number }>(`select count(*)::int as n from ${table}`);
  return rows[0]?.n ?? 0;
}

async function stateOf(database: MigratedDatabase, entity: string) {
  const [row] = await database.handle.db.select().from(syncState).where(eq(syncState.entity, entity));
  return row;
}

const dataset = getDemoDataset();
const notes = buildDemoSalesNotes(dataset);

class FailingGateway extends FakeGateway {
  failMonthly = false;
  override readSalesHistoryMonthly(options: SalesHistoryReadOptions) {
    if (this.failMonthly) throw new SankhyaGatewayError('temporary', { code: 'blip', message: 'temporary blip' });
    return super.readSalesHistoryMonthly(options);
  }
}

describe('sales-history mirror (stage D block 1, atomic snapshot replacement)', () => {
  it('fills both tables, classifies each TOP once and stores the month as its first day', async () => {
    const database = await migrated();
    const gateway = new FakeGateway({ dataset, salesNotes: notes, batchSize: 3 });
    const monthly = await service(database, gateway).run('salesHistoryMonthly');
    const product = await service(database, gateway).run('salesHistoryCustomerProduct');
    expect(monthly.outcome).toBe('completed');
    expect(product.outcome).toBe('completed');
    expect(monthly.stats?.read).toBeGreaterThan(0);
    expect(await count(database, 'erp_sales_history_monthly')).toBe(monthly.stats?.read);

    const kinds = await database.handle.pool.query<{ top_code: number; top_kind: string }>(
      `select distinct top_code, top_kind from erp_sales_history_monthly order by top_code`,
    );
    expect(kinds.rows).toEqual([
      { top_code: DEMO_SALE_TOP, top_kind: 'sale' },
      { top_code: DEMO_RETURN_TOP, top_kind: 'return' },
    ]);
    expect((await count(database, 'erp_sales_history_monthly')) > 0).toBe(true);
    const badMonths = await database.handle.pool.query(`select 1 from erp_sales_history_monthly where extract(day from month) <> 1`);
    expect(badMonths.rowCount).toBe(0);
    const state = await stateOf(database, 'salesHistoryMonthly');
    expect(state?.status).toBe('succeeded');
    expect(state?.rowCount).toBe(monthly.stats?.read);
  });

  it('replaces the whole table each run: rows that left the source or the window disappear, none are duplicated', async () => {
    const database = await migrated();
    await service(database, new FakeGateway({ dataset, salesNotes: notes })).run('salesHistoryMonthly');
    const before = await count(database, 'erp_sales_history_monthly');

    const fewer = notes.slice(0, Math.max(1, notes.length - 3));
    const second = await service(database, new FakeGateway({ dataset, salesNotes: fewer })).run('salesHistoryMonthly');
    expect(await count(database, 'erp_sales_history_monthly')).toBe(second.stats?.read);
    expect(second.stats?.read).toBeLessThan(before);

    // Running again with the same source changes nothing (idempotent).
    const third = await service(database, new FakeGateway({ dataset, salesNotes: fewer })).run('salesHistoryMonthly');
    expect(third.stats?.read).toBe(second.stats?.read);
    expect(await count(database, 'erp_sales_history_monthly')).toBe(second.stats?.read);
  });

  it('a failed read changes nothing and keeps the previous success data', async () => {
    const database = await migrated();
    const gateway = new FailingGateway({ dataset, salesNotes: notes });
    await service(database, gateway).run('salesHistoryMonthly');
    const before = await count(database, 'erp_sales_history_monthly');
    const succeededAt = (await stateOf(database, 'salesHistoryMonthly'))?.lastSuccessAt;

    gateway.failMonthly = true;
    await expect(service(database, gateway).run('salesHistoryMonthly')).rejects.toThrow();
    expect(await count(database, 'erp_sales_history_monthly')).toBe(before);
    const state = await stateOf(database, 'salesHistoryMonthly');
    expect(state?.status).toBe('failed');
    expect(state?.lastSuccessAt).toEqual(succeededAt);
  });

  it('fails closed on an empty snapshot while rows exist: the mirror is not wiped', async () => {
    const database = await migrated();
    await service(database, new FakeGateway({ dataset, salesNotes: notes })).run('salesHistoryCustomerProduct');
    const before = await count(database, 'erp_sales_history_customer_product');
    expect(before).toBeGreaterThan(0);

    await expect(service(database, new FakeGateway({ dataset, salesNotes: [] })).run('salesHistoryCustomerProduct')).rejects.toMatchObject({
      code: 'empty_snapshot',
    });
    expect(await count(database, 'erp_sales_history_customer_product')).toBe(before);
    expect((await stateOf(database, 'salesHistoryCustomerProduct'))?.status).toBe('failed');
  });

  it('an empty first snapshot is a valid, empty mirror', async () => {
    const database = await migrated();
    const result = await service(database, new FakeGateway({ dataset, salesNotes: [] })).run('salesHistoryMonthly');
    expect(result.outcome).toBe('completed');
    expect(result.stats?.read).toBe(0);
    expect((await stateOf(database, 'salesHistoryMonthly'))?.status).toBe('succeeded');
  });

  it('without a TOP configuration nothing is read and nothing is recorded', async () => {
    const database = await migrated();
    const result = await service(database, new FakeGateway({ dataset, salesNotes: notes }), null).run('salesHistoryMonthly');
    expect(result.outcome).toBe('not_configured');
    expect(await count(database, 'erp_sales_history_monthly')).toBe(0);
    expect(await stateOf(database, 'salesHistoryMonthly')).toBeUndefined();
  });

  it('keeps notes on a non-configured status out (status filter is configuration)', async () => {
    const database = await migrated();
    const gateway = new FakeGateway({ dataset, salesNotes: notes });
    const onlyP = await service(database, gateway, { ...CONFIG, statusCodes: ['P'] }).run('salesHistoryMonthly');
    const onlyL = await service(database, gateway, CONFIG).run('salesHistoryMonthly');
    expect(onlyP.stats?.read).toBeLessThan(onlyL.stats?.read ?? 0);
  });
});
