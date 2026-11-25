import { randomUUID } from 'node:crypto';
import { DEMO_ACCOUNT_EMAILS, FakeGateway, FakeOrderBook, PLAC_CONFIGURATION_FACTS, SankhyaGatewayError, getDemoDataset } from '@salesforce/sankhya';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { InstallationConfigurationRepository } from '../../src/configuration/configuration.repository.js';
import { ConsistencyVerifier } from '../../src/consistency/consistency-verifier.js';
import type { ConsistencyType } from '../../src/consistency/types.js';
import { AuditService } from '../../src/iam/audit.service.js';
import { OrderErpStatusService } from '../../src/integration/order-erp-status.service.js';
import { createLogger } from '../../src/observability/logger.js';
import { ConfigurationSyncService } from '../../src/sync/configuration-sync.service.js';
import { baseConfiguration } from '../helpers/overlay-base.js';
import { startCommercialApp } from '../helpers/commercial-app.js';
import { closeAllThenStop, createMigratedDatabase, startPostgres, type MigratedDatabase, type TestPostgres } from '../helpers/postgres.js';

const logger = createLogger({ level: 'silent', service: 'worker' });
const NOW = new Date('2026-10-30T12:00:00.000Z');
let postgres: TestPostgres;
const closers: (() => Promise<unknown>)[] = [];

beforeAll(async () => {
  postgres = await startPostgres();
});
afterAll(async () => {
  await closeAllThenStop(closers, postgres);
});

describe('consistency verifier: TOPs, negotiation types, configuration', () => {
  let database: MigratedDatabase;
  const gateway = new FakeGateway({ configurationFacts: PLAC_CONFIGURATION_FACTS });
  const verify = (types: ConsistencyType[], g = gateway) => new ConsistencyVerifier({ db: database.handle, gateway: g, logger }).run({ types });
  const pool = () => database.handle.pool;

  beforeEach(async () => {
    const created = await createMigratedDatabase(postgres);
    database = created;
    closers.push(() => created.handle.close());
    await new InstallationConfigurationRepository(database.handle.db).saveSnapshot(baseConfiguration(), NOW);
    const sync = new ConfigurationSyncService({
      db: database.handle,
      gateway,
      audit: new AuditService(database.handle.db, () => NOW),
      logger,
      now: () => NOW,
    });
    expect((await sync.run()).outcome).toBe('stored');
  });

  it('consistent right after the configuration sync', async () => {
    const report = await verify(['tops', 'negotiationTypes', 'configuration']);
    for (const entry of report.types) expect(entry, entry.type).toMatchObject({ status: 'checked', missing: 0, extra: 0, divergent: 0 });
    expect(report.consistent).toBe(true);
  });

  it('TOPs: missing (dropped from the stored list) and extra (a stale code kept)', async () => {
    const [{ payload }] = (await pool().query<{ payload: { sales: { eligibleOrderTopCodes: number[] } } }>('select payload from installation_configuration_version where is_current')).rows as [
      { payload: { sales: { eligibleOrderTopCodes: number[] } } },
    ];
    const codes = payload.sales.eligibleOrderTopCodes;
    expect(codes.length).toBeGreaterThan(0);
    const tampered = [...codes.slice(1), 99999];
    await pool().query(`update installation_configuration_version set payload = jsonb_set(payload, '{sales,eligibleOrderTopCodes}', $1::jsonb) where is_current`, [JSON.stringify(tampered)]);
    const [tops] = (await verify(['tops'])).types;
    expect(tops).toMatchObject({ status: 'checked', missing: 1, extra: 1, divergent: 0 });
    expect(tops?.samples.extra).toEqual(['99999']);
  });

  it('negotiation types: divergent value, missing and extra', async () => {
    const { rows } = await pool().query<{ payload: { sales: { negotiationTypes: Record<string, unknown>[] } } }>('select payload from installation_configuration_version where is_current');
    const types = rows[0]!.payload.sales.negotiationTypes;
    expect(types.length).toBeGreaterThan(0);
    const tampered = [{ ...types[0], label: 'tampered', code: types[0]!['code'] }, ...types.slice(1), { ...types[0], code: 99998 }];
    await pool().query("update installation_configuration_version set payload = jsonb_set(payload, '{sales,negotiationTypes}', $1::jsonb) where is_current", [JSON.stringify(tampered)]);
    const [entry] = (await verify(['negotiationTypes'])).types;
    expect(entry?.status, entry?.detail).toBe('checked');
    expect(entry?.extra).toBe(1);
    expect(entry?.divergent).toBeGreaterThanOrEqual(1);
    await pool().query(
      `update installation_configuration_version set payload = jsonb_set(payload, '{sales,negotiationTypes}', $1::jsonb) where is_current`,
      [JSON.stringify(types.slice(1))],
    );
    const [emptied] = (await verify(['negotiationTypes'])).types;
    expect(emptied?.status, emptied?.detail).toBe('checked');
    expect(emptied?.missing).toBe(1);
  });

  it('read failure never reports differences', async () => {
    const failing = { describe: gateway.describe.bind(gateway), readConfigurationFacts: async () => { throw new SankhyaGatewayError('unavailable', { code: 'down', message: 'down' }); } };
    const report = await new ConsistencyVerifier({ db: database.handle, gateway: failing as never, logger }).run({ types: ['tops', 'negotiationTypes', 'configuration'] });
    for (const entry of report.types) expect(entry).toMatchObject({ status: 'read_failed', missing: 0, extra: 0, divergent: 0 });
    expect(report.incomplete).toBe(true);
  });
});

describe('consistency verifier: orders, order status, releases', () => {
  const dataset = getDemoDataset();
  const SELLER = DEMO_ACCOUNT_EMAILS.seller1;
  const MIN = 60_000;

  async function world() {
    const app = await startCommercialApp(postgres, opened, {});
    const book = new FakeOrderBook();
    const fake = new FakeGateway({ orders: book });
    const now = new Date();
    const pool = app.database.handle.pool;
    const seed = async (erpNumber: number | null, status = 'sent'): Promise<string> => {
      const id = randomUUID();
      const customer = dataset.customers.find((c) => c.sellerCode === 103 && c.active && !c.blocked)!.code;
      await pool.query(
        `INSERT INTO sales_order (id, customer_code, seller_code, created_by_account_id, status, negotiation_type_code, client_request_id, config_version_id, dataset_origin, erp_environment, external_origin_id, erp_number, estimated_total, created_at, updated_at)
         VALUES ($1, $2, 103, $3, $4, 2, $5, $6, 'sankhya', 'sandbox', $9, $7, '150.50', $8, $8)`,
        [id, customer, app.accounts.ids[SELLER], status, randomUUID(), app.accounts.configVersionId, erpNumber, new Date(now.getTime() - 60 * MIN), id],
      );
      return id;
    };
    const stageService = new OrderErpStatusService({ db: app.database.handle, gateway: fake as never, logger, now: () => now });
    const verify = (types: ConsistencyType[], gateway: unknown = fake, originField?: string) =>
      new ConsistencyVerifier({
        db: app.database.handle,
        gateway: fake as never,
        orders: { gateway: gateway as never, ...(originField === undefined ? {} : { originField }) },
        logger,
        now: () => now,
      }).run({ types });
    return { app, book, fake, seed, stageService, verify, pool };
  }
  const opened = closers;

  it('consistent after the stage cycle; divergent stage; missing stage row', async () => {
    const w = await world();
    const id = await w.seed(9101);
    w.book.noteHeaders.set(9101, { statusNota: 'A', pending: null });
    w.book.stageFacts.set(9101, { found: true, codtipoper: 4242, statusNota: 'A', pending: 'S', orderCargo: null, pendingReleases: [{ event: 44, cascadeSequence: 1 }], hasInvoiceLink: false, invoiceNumber: null });

    const before = (await w.verify(['orderStatus', 'releases', 'orders'])).types;
    expect(before.find((t) => t.type === 'orderStatus')).toMatchObject({ status: 'checked', missing: 1 });
    expect(before.find((t) => t.type === 'releases')).toMatchObject({ status: 'checked', missing: 1 });
    expect(before.find((t) => t.type === 'orders')).toMatchObject({ status: 'checked', missing: 0, extra: 0, divergent: 0 });

    await w.stageService.runStageOnce();
    const after = await w.verify(['orderStatus', 'releases', 'orders']);
    expect(after.consistent, JSON.stringify(after.types)).toBe(true);

    await w.pool.query(`update sales_order_erp_stage set stage = 'received', label = 'Recebido' where order_id = $1`, [id]);
    const divergent = (await w.verify(['orderStatus'])).types[0];
    expect(divergent).toMatchObject({ status: 'checked', divergent: 1 });

    await w.pool.query(`insert into sales_order_release_pending (id, order_id, nunota, event, cascade_sequence, sector, first_seen_at, last_seen_at) select gen_random_uuid(), order_id, nunota, 777, 9, sector, now(), now() from sales_order_release_pending where order_id = $1 limit 1`, [id]);
    expect((await w.verify(['releases'])).types[0]).toMatchObject({ status: 'checked', extra: 1 });
  });

  it('orders: extra (note gone in Sankhya), divergent (marked removed but present), missing (exists in Sankhya under our origin id)', async () => {
    const w = await world();
    await w.seed(9201);
    const present = await w.seed(9202);
    w.book.noteHeaders.set(9202, { statusNota: 'A', pending: null });
    await w.pool.query(`update sales_order set erp_removed_at = now() where id = $1`, [present]);
    const unlinked = await w.seed(null, 'unknown');
    w.book.orders.push({ erpOrderNumber: 7001, request: { originId: unlinked } as never, confirmed: false });

    const entry = (await w.verify(['orders'], w.fake, 'AD_ORIGEM')).types[0];
    expect(entry).toMatchObject({ status: 'checked', extra: 1, divergent: 1, missing: 1 });
    expect(entry?.samples.missing[0]).toContain('7001');
  });

  it('read failure never reports extras', async () => {
    const w = await world();
    await w.seed(9301);
    const failing = {
      readOrderReleaseFacts: async () => { throw new SankhyaGatewayError('unavailable', { code: 'down', message: 'down' }); },
      readOrderStageFacts: async () => { throw new SankhyaGatewayError('unavailable', { code: 'down', message: 'down' }); },
      findOrderByOrigin: async () => null,
    };
    const report = await w.verify(['orders', 'orderStatus', 'releases'], failing);
    for (const entry of report.types) expect(entry).toMatchObject({ status: 'read_failed', missing: 0, extra: 0, divergent: 0 });
  });
});
