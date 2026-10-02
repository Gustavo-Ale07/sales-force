import { defaultUnconfiguredConfiguration } from '@salesforce/domain';
import { BootstrapFileConfigurationSource, DEMO_CONFIGURATION } from '@salesforce/sankhya';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { configurationContentHash } from '../../src/configuration/configuration-hash.js';
import { InstallationConfigurationRepository } from '../../src/configuration/configuration.repository.js';
import {
  DatabaseConfigurationSource,
  InstallationConfigurationService,
  StoredConfigurationInvalidError,
} from '../../src/configuration/configuration.service.js';
import { validateInstallationConfiguration } from '../../src/configuration/validate.js';
import { AppError } from '../../src/http/app-error.js';
import { createLogger } from '../../src/observability/logger.js';
import { createMigratedDatabase, startPostgres, type MigratedDatabase, type TestPostgres, closeAllThenStop } from '../helpers/postgres.js';

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

async function setup() {
  const database = await createMigratedDatabase(postgres);
  databases.push(database);
  const repository = new InstallationConfigurationRepository(database.handle.db);
  const source = new DatabaseConfigurationSource(repository);
  const service = new InstallationConfigurationService(source, createLogger({ level: 'silent', service: 'test' }));
  return { database, repository, source, service };
}

const NOW = new Date('2026-09-21T12:00:00.000Z');

describe('installation configuration (CFG-1..6)', () => {
  it('without a stored snapshot the installation is not enabled and nothing is invented', async () => {
    const { service } = await setup();
    const current = await service.current();
    expect(current).toMatchObject({ state: 'not_configured', contentHash: null });
    expect(current.configuration).toEqual(defaultUnconfiguredConfiguration());
    expect(current.configuration.general.enabled).toBe(false);
    expect(current.configuration.products.sellableUsageValues).toEqual([]);

    const error = await service.requireEnabled().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('installation_not_enabled');
    expect((error as AppError).status).toBe(409);
  });

  it('stores a snapshot, serves it, and treats the same content as a no-op', async () => {
    const { service, repository, database } = await setup();
    const first = await repository.saveSnapshot(DEMO_CONFIGURATION, NOW);
    expect(first).toEqual({ stored: true, contentHash: configurationContentHash(DEMO_CONFIGURATION) });

    const current = await service.current();
    expect(current).toMatchObject({ state: 'configured', contentHash: first.contentHash });
    expect(current.configuration).toEqual(DEMO_CONFIGURATION);
    await expect(service.requireEnabled()).resolves.toEqual(DEMO_CONFIGURATION);

    // Same content read again later (only syncedAt differs): nothing new is stored.
    const again = await repository.saveSnapshot(
      { ...DEMO_CONFIGURATION, source: { ...DEMO_CONFIGURATION.source, syncedAt: '2030-01-01T00:00:00.000Z' } },
      NOW,
    );
    expect(again.stored).toBe(false);
    const rows = await database.handle.pool.query('select count(*)::int as n from installation_configuration_version');
    expect(rows.rows[0]).toEqual({ n: 1 });
  });

  it('keeps history: a changed snapshot becomes the only current version', async () => {
    const { service, repository, database } = await setup();
    await repository.saveSnapshot(DEMO_CONFIGURATION, NOW);
    const changed = {
      ...DEMO_CONFIGURATION,
      source: { ...DEMO_CONFIGURATION.source, version: 'demo-2' },
      general: { ...DEMO_CONFIGURATION.general, enabled: false },
    };
    expect((await repository.saveSnapshot(changed, new Date(NOW.getTime() + 1000))).stored).toBe(true);

    const { rows } = await database.handle.pool.query<{ version_label: string; is_current: boolean }>(
      'select version_label, is_current from installation_configuration_version order by synced_at, version_label',
    );
    expect(rows.filter((row) => row.is_current).map((row) => row.version_label)).toEqual(['demo-2']);
    expect(rows).toHaveLength(2);

    const error = await service.requireEnabled().catch((caught: unknown) => caught);
    expect((error as AppError).code).toBe('installation_not_enabled');
  });

  it('reports the kind of the stored snapshot and never serves an invalid stored payload', async () => {
    const { service, source, database } = await setup();
    expect(source.kind).toBe('sankhya');
    await database.handle.pool.query(
      `insert into installation_configuration_version (id, version_label, source_kind, payload, content_hash, synced_at, is_current)
       values ('0190a000-0000-7000-8000-000000000001', 'broken', 'bootstrap-file', '{"schemaVersion": 99}', 'sha256:broken', now(), true)`,
    );
    const error = await service.current().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('internal_error');
    expect((error as AppError).cause).toBeInstanceOf(StoredConfigurationInvalidError);
  });

  it('validates the bootstrap file source with the contracts schema (U-11)', async () => {
    const file = new BootstrapFileConfigurationSource({
      path: 'unused.json',
      validate: validateInstallationConfiguration,
      now: () => NOW.getTime(),
      readText: () => Promise.resolve(JSON.stringify({ ...DEMO_CONFIGURATION, source: undefined })),
    });
    const read = await file.read();
    expect(read.source).toMatchObject({ kind: 'bootstrap-file' });

    const invalid = new BootstrapFileConfigurationSource({
      path: 'unused.json',
      validate: validateInstallationConfiguration,
      readText: () => Promise.resolve(JSON.stringify({ ...DEMO_CONFIGURATION, source: undefined, sales: {} })),
    });
    await expect(invalid.read()).rejects.toMatchObject({ code: 'config_file_invalid' });
  });
});
