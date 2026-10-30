import { auditLog, installationConfigurationVersion, syncState } from '@salesforce/db';
import {
  PLAC_CONFIGURATION_FACTS,
  SankhyaGatewayError,
  type ConfigurationFacts,
} from '@salesforce/sankhya';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { InstallationConfigurationRepository } from '../../src/configuration/configuration.repository.js';
import { AuditService } from '../../src/iam/audit.service.js';
import { createLogger } from '../../src/observability/logger.js';
import { summarizeIntegration } from '../../src/platform/integration-summary.js';
import { ConfigurationSyncService, CONFIGURATION_SYNC_ENTITY } from '../../src/sync/configuration-sync.service.js';
import { baseConfiguration } from '../helpers/overlay-base.js';
import { captureLogs, closeAllThenStop, createMigratedDatabase, startPostgres, type MigratedDatabase, type TestPostgres } from '../helpers/postgres.js';

let postgres: TestPostgres;
let database: MigratedDatabase;
const closers: (() => Promise<unknown>)[] = [];
const NOW = new Date('2026-10-30T12:00:00.000Z');

const factsWith = (patch: (facts: Record<string, any>) => void): ConfigurationFacts => { // eslint-disable-line @typescript-eslint/no-explicit-any
  const facts = structuredClone(PLAC_CONFIGURATION_FACTS) as unknown as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  patch(facts);
  return facts as ConfigurationFacts;
};

const gatewayOf = (read: () => Promise<ConfigurationFacts>) => ({ readConfigurationFacts: read });
const failedQuery = (facts: ConfigurationFacts, key: string, code: string, kind: 'permanent' | 'auth' = 'permanent'): ConfigurationFacts =>
  factsWith((f) => {
    f[key] = { ok: false, source: f[key].source, error: { kind, code, message: `${code} synthetic`, retryable: false } };
  });

beforeAll(async () => {
  postgres = await startPostgres();
  database = await createMigratedDatabase(postgres);
  closers.push(() => database.handle.close());
});
afterAll(async () => {
  await closeAllThenStop(closers, postgres);
});

async function reset(): Promise<InstallationConfigurationRepository> {
  await database.handle.pool.query('delete from audit_log');
  await database.handle.pool.query('delete from sync_state');
  await database.handle.pool.query('delete from installation_configuration_version');
  const repository = new InstallationConfigurationRepository(database.handle.db);
  await repository.saveSnapshot(baseConfiguration(), NOW);
  return repository;
}

function build(read: () => Promise<ConfigurationFacts>) {
  const logs = captureLogs();
  const logger = createLogger({ level: 'debug', service: 'worker', destination: logs.stream });
  const service = new ConfigurationSyncService({
    db: database.handle,
    gateway: gatewayOf(read),
    audit: new AuditService(database.handle.db, () => NOW),
    logger,
    now: () => NOW,
  });
  return { service, logs };
}

const versions = () => database.handle.db.select().from(installationConfigurationVersion);
const state = async () => (await database.handle.db.select().from(syncState).where(eq(syncState.entity, CONFIGURATION_SYNC_ENTITY)))[0];

describe('sync.configuration (CFG-8)', () => {
  beforeEach(async () => {
    await reset();
  });

  it('stores a sankhya version over the base file, switches is_current, audits the changed keys, records success', async () => {
    const { service } = build(async () => PLAC_CONFIGURATION_FACTS);
    const result = await service.run();
    expect(result.outcome).toBe('stored');

    const rows = await versions();
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.isCurrent)).toHaveLength(1);
    const current = rows.find((r) => r.isCurrent)!;
    expect(current.sourceKind).toBe('sankhya');
    const payload = current.payload as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(payload.source.base).toEqual({ kind: 'bootstrap-file', version: 'base-2026-10-02' });
    expect(payload.provenance['customers.historyDays']).toMatchObject({ table: 'AD_TVDYCFGFRC', column: 'DIASCONSULTAVENDAS' });
    expect(rows.find((r) => !r.isCurrent)?.sourceKind).toBe('bootstrap-file');

    const [audit] = await database.handle.db.select().from(auditLog);
    expect(audit?.action).toBe('config.sankhya_synced');
    expect(audit?.actorAccountId).toBeNull();
    const detail = audit?.detail as Record<string, unknown>;
    expect(detail['previousVersion']).toBe('base-2026-10-02');
    expect(detail['newHash']).toBe(current.contentHash);
    expect(String(detail['changedKeys'])).toContain('pricing.catalogReferenceTableCode');
    expect(typeof detail['scopeChanges']).toBe('string');
    expect(Number(detail['changedCount'])).toBeGreaterThan(0);

    const row = await state();
    expect(row?.status).toBe('succeeded');
    expect(row?.lastErrorClass).toBeNull();
  });

  it('is a registered no-op when the content hash did not change (even if read later)', async () => {
    await build(async () => PLAC_CONFIGURATION_FACTS).service.run();
    const later = { ...structuredClone(PLAC_CONFIGURATION_FACTS), readAt: '2031-01-01T00:00:00.000Z' } as ConfigurationFacts;
    const again = await build(async () => later).service.run();
    expect(again.outcome).toBe('unchanged');
    expect(await versions()).toHaveLength(2);
    expect(await database.handle.db.select().from(auditLog)).toHaveLength(1);
    expect((await state())?.status).toBe('succeeded');
  });

  it('keeps the discount authority edited by the admin (Force-owned) across a new Sankhya version', async () => {
    const repository = new InstallationConfigurationRepository(database.handle.db);
    await build(async () => PLAC_CONFIGURATION_FACTS).service.run();
    const current = await repository.findCurrent();
    await repository.replaceCurrent({
      expectedContentHash: current!.contentHash,
      now: NOW,
      build: (row) => ({
        ...(row.payload as any), // eslint-disable-line @typescript-eslint/no-explicit-any
        source: { ...(row.payload as any).source, version: 'admin-discount-limits-x' }, // eslint-disable-line @typescript-eslint/no-explicit-any
        sales: {
          ...(row.payload as any).sales, // eslint-disable-line @typescript-eslint/no-explicit-any
          discountAuthority: { mode: 'force', limits: { seller: '5', manager: '10', director: '15' }, provisional: false },
        },
      }),
    });
    const changed = factsWith((f) => {
      f['q1GeneralParameters'].rows[0].historyDays = 30;
    });
    expect((await build(async () => changed).service.run()).outcome).toBe('stored');
    const next = (await versions()).find((r) => r.isCurrent)!.payload as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(next.sales.discountAuthority.limits.manager).toBe('10');
    expect(next.customers.historyDays).toBe(30);
  });

  describe('fail closed: nothing written, sync_state filled, integration degraded', () => {
    const cases: { name: string; facts: () => Promise<ConfigurationFacts>; errorClass: string }[] = [
      {
        name: 'HTTP 403 GTW3403',
        facts: async () => {
          throw new SankhyaGatewayError('auth', { code: 'GTW3403', message: 'HTTP 403 GTW3403 token rejected' });
        },
        errorClass: 'auth',
      },
      { name: 'ORA-00904 on Q1', facts: async () => failedQuery(PLAC_CONFIGURATION_FACTS, 'q1GeneralParameters', 'ORA-00904'), errorClass: 'permanent' },
      { name: 'ORA-00942 on Q3', facts: async () => failedQuery(PLAC_CONFIGURATION_FACTS, 'q3EnabledTops', 'ORA-00942'), errorClass: 'permanent' },
      {
        name: 'Q1 row missing',
        facts: async () => factsWith((f) => {
          f['q1GeneralParameters'].rows = [];
        }),
        errorClass: 'permanent',
      },
      {
        name: 'value out of domain',
        facts: async () => factsWith((f) => {
          f['q1GeneralParameters'].rows[0].historyDays = 99999;
        }),
        errorClass: 'permanent',
      },
    ];

    for (const c of cases) {
      it(c.name, async () => {
        const before = await versions();
        await expect(build(c.facts).service.run()).rejects.toThrow();
        const after = await versions();
        expect(after.map((r) => [r.id, r.isCurrent, r.contentHash])).toEqual(before.map((r) => [r.id, r.isCurrent, r.contentHash]));
        expect(await database.handle.db.select().from(auditLog)).toHaveLength(0);
        const row = await state();
        expect(row?.status).toBe('failed');
        expect(row?.lastErrorClass).toBe(c.errorClass);
        expect(row?.lastErrorMessage).toBeTruthy();
        const summary = summarizeIntegration(await database.handle.db.select().from(syncState), NOW);
        expect(summary.failingEntities).toContain(CONFIGURATION_SYNC_ENTITY);
      });
    }

    it('no base version (bootstrap-file) exists', async () => {
      await database.handle.pool.query('delete from installation_configuration_version');
      const demoLike = baseConfiguration((c) => {
        c['source'] = { kind: 'demo', version: 'demo-1', syncedAt: NOW.toISOString() };
      });
      await new InstallationConfigurationRepository(database.handle.db).saveSnapshot(demoLike, NOW);
      await expect(build(async () => PLAC_CONFIGURATION_FACTS).service.run()).rejects.toThrow(/base configuration/);
      expect((await versions()).filter((r) => r.isCurrent)[0]?.sourceKind).toBe('demo');
      expect((await state())?.status).toBe('failed');
    });

    it('a later good run clears the failure', async () => {
      await expect(build(cases[0]!.facts).service.run()).rejects.toThrow();
      await build(async () => PLAC_CONFIGURATION_FACTS).service.run();
      const row = await state();
      expect(row?.status).toBe('succeeded');
      expect(row?.lastErrorMessage).toBeNull();
    });
  });

  it('leaves no credential, Authorization, token or password text in the snapshot, audit, sync_state or logs', async () => {
    const { service, logs } = build(async () => PLAC_CONFIGURATION_FACTS);
    await service.run();
    await expect(build(async () => { throw new SankhyaGatewayError('auth', { code: 'GTW3403', message: 'HTTP 403 GTW3403' }); }).service.run()).rejects.toThrow();
    const forbidden = /authorization|bearer|x-token|client_secret|password|basicauth/i;
    expect(JSON.stringify(await versions())).not.toMatch(forbidden);
    expect(JSON.stringify(await database.handle.db.select().from(auditLog))).not.toMatch(forbidden);
    expect(JSON.stringify(await database.handle.db.select().from(syncState))).not.toMatch(forbidden);
    expect(JSON.stringify(logs.lines())).not.toMatch(forbidden);
  });
});
