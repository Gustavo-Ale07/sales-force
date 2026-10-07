import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FakeGateway, getDemoDataset, SankhyaGatewayError, type GatewayDescription } from '@salesforce/sankhya';
import { describe, expect, it } from 'vitest';
import { contentHash } from '../../src/sync/content-hash.js';
import { describeSyncFailure } from '../../src/sync/failure.js';
import {
  canonicalPlainDecimal,
  digitsOnly,
  fitsNumeric,
  MIRROR_ENTITIES,
  MIRROR_SPECS,
  mirrorQueueName,
  type MirrorGateway,
  type MirrorRow,
} from '../../src/sync/mirror-entities.js';
import { mirrorLockObjectId } from '../../src/sync/entity-lock.js';
import { DEFAULT_MIRROR_CRONS, mirrorSchedulesFromSettings } from '../../src/sync/schedules.js';
import { PermanentJobError, TransientJobError } from '../../src/worker/job-contract.js';
import { QUEUE_NAMES, QUEUE_REGISTRY } from '../../src/worker/queues.js';

async function collect(entity: (typeof MIRROR_ENTITIES)[number], gateway: MirrorGateway): Promise<MirrorRow[]> {
  const rows: MirrorRow[] = [];
  for await (const batch of MIRROR_SPECS[entity].read({ gateway, description: gateway.describe(), warn: () => undefined })) {
    rows.push(...batch);
  }
  return rows;
}

describe('content hash', () => {
  it('is independent of key order and stable across calls', () => {
    expect(contentHash({ a: 1, b: 'x' })).toBe(contentHash({ b: 'x', a: 1 }));
    expect(contentHash({ a: 1 })).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('changes when any value changes, and tells null apart from an empty string or zero', () => {
    const base = contentHash({ price: '2.5', note: null });
    expect(contentHash({ price: '2.6', note: null })).not.toBe(base);
    expect(contentHash({ price: '2.5', note: '' })).not.toBe(base);
    expect(contentHash({ price: '0', note: null })).not.toBe(contentHash({ price: null, note: null }));
  });

  it('serializes timestamps as ISO instants', () => {
    expect(contentHash({ at: new Date('2026-01-01T03:00:00.000Z') })).toBe(contentHash({ at: new Date(Date.UTC(2026, 0, 1, 3)) }));
  });
});

describe('decimal handling (DATA-3: no floating point, no silent rounding)', () => {
  it('canonicalizes the representation so the same amount hashes the same', () => {
    expect(canonicalPlainDecimal('2.5000')).toBe('2.5');
    expect(canonicalPlainDecimal('007')).toBe('7');
    expect(canonicalPlainDecimal('0.000000')).toBe('0');
    expect(canonicalPlainDecimal('-1')).toBeNull();
    expect(canonicalPlainDecimal('1e3')).toBeNull();
    expect(canonicalPlainDecimal('1,5')).toBeNull();
  });

  it('rejects values that numeric(p, s) would round or overflow', () => {
    expect(fitsNumeric('12345678901.23', 14, 2)).toBe(true);
    expect(fitsNumeric('1.234', 14, 2)).toBe(false);
    expect(fitsNumeric('1.230', 14, 2)).toBe(true);
    expect(fitsNumeric('1234567890123', 14, 2)).toBe(false);
    expect(fitsNumeric('999999999999.999999', 18, 6)).toBe(true);
    expect(fitsNumeric('1000000000000', 18, 6)).toBe(false);
  });

  it('keeps an explicit zero price distinct from a missing one (P-09)', () => {
    const zero = MIRROR_SPECS.listPrices;
    const gateway = new FakeGateway({
      dataset: { ...getDemoDataset(), listPrices: [{ versionId: 1, productCode: 1, unitPrice: '0.00' }] },
    });
    return collect(zero.entity, gateway).then((rows) => {
      expect(rows).toHaveLength(1);
      // Zero stays "0" (a string, never a number), and only rows the ERP returned exist.
      expect(rows[0]?.content).toEqual({ unitPrice: '0' });
    });
  });

  it('refuses a price with more decimals than the column stores', async () => {
    const gateway = new FakeGateway({
      dataset: { ...getDemoDataset(), listPrices: [{ versionId: 1, productCode: 1, unitPrice: '1.1234567' }] },
    });
    const error = await collect('listPrices', gateway).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SankhyaGatewayError);
    expect((error as SankhyaGatewayError).kind).toBe('validation');
    // The value is never echoed.
    expect((error as Error).message).not.toContain('1.1234567');
  });
});

describe('mapping', () => {
  it('maps every mirror entity from the fake dataset without loss of rows', async () => {
    const dataset = getDemoDataset();
    const gateway = new FakeGateway({ batchSize: 7 });
    const expected = {
      sellers: dataset.sellers.length,
      customers: dataset.customers.length,
      products: dataset.products.length,
      priceTables: dataset.priceTables.length,
      priceTableVersions: dataset.priceTableVersions.length,
      listPrices: dataset.listPrices.length,
      directoryUsers: dataset.directoryUsers.length,
    };
    for (const entity of MIRROR_ENTITIES) {
      expect((await collect(entity, gateway)).length, entity).toBe(expected[entity]);
    }
  });

  it('keeps a customer without a price table as NULL, never a default table (CFG-4)', async () => {
    const customers = await collect('customers', new FakeGateway());
    const withoutTable = getDemoDataset().customers.filter((customer) => customer.priceTableCode === null);
    expect(withoutTable.length).toBeGreaterThan(0);
    for (const customer of withoutTable) {
      const row = customers.find((candidate) => candidate.key[0] === customer.code);
      expect(row?.content['priceTableCode']).toBeNull();
    }
  });

  it('strips the tax id to digits and reports nothing when there are none', () => {
    expect(digitsOnly('12.345.678/0001-90')).toBe('12345678000190');
    expect(digitsOnly('---')).toBeNull();
    expect(digitsOnly(null)).toBeNull();
  });

  it('fills the product group name from the group list, and leaves it NULL when the gateway cannot read groups', async () => {
    const gateway = new FakeGateway();
    const withGroups = await collect('products', gateway);
    const grouped = withGroups.find((row) => row.content['groupCode'] !== null);
    expect(grouped?.content['groupName']).toEqual(expect.any(String));

    const base = gateway.describe();
    const noGroups: MirrorGateway = {
      describe: (): GatewayDescription => ({
        ...base,
        capabilities: { ...base.capabilities, reads: { ...base.capabilities.reads, productGroups: 'not_implemented' } },
      }),
      readSellers: (o) => gateway.readSellers(o),
      readDirectoryUsers: (o) => gateway.readDirectoryUsers(o),
      readCustomers: (o) => gateway.readCustomers(o),
      readProducts: (o) => gateway.readProducts(o),
      readProductGroups: (o) => gateway.readProductGroups(o),
      readPriceTables: (o) => gateway.readPriceTables(o),
      readPriceTableVersions: (o) => gateway.readPriceTableVersions(o),
      readListPrices: (o) => gateway.readListPrices(o),
      readConfiguration: (o) => gateway.readConfiguration(o),
    };
    const warnings: string[] = [];
    const rows: MirrorRow[] = [];
    for await (const batch of MIRROR_SPECS.products.read({
      gateway: noGroups,
      description: noGroups.describe(),
      warn: (message) => warnings.push(message),
    })) {
      rows.push(...batch);
    }
    expect(rows.every((row) => row.content['groupName'] === null)).toBe(true);
    expect(rows.some((row) => row.content['groupCode'] !== null)).toBe(true);
    expect(warnings).toHaveLength(1);
  });

  it('gives the sync no way to write to Sankhya (SNK-4, SNK-6): read port only, no write or outbox reference', () => {
    const syncDir = fileURLToPath(new URL('../../src/sync/', import.meta.url));
    const files = [
      ...readdirSync(syncDir).map((name) => join(syncDir, name)),
      fileURLToPath(new URL('../../src/worker/jobs/mirror-sync.job.ts', import.meta.url)),
      fileURLToPath(new URL('../../src/sync-once.ts', import.meta.url)),
    ];
    for (const file of files) {
      const text = readFileSync(file, 'utf8')
        .split('\n')
        .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
        .join('\n');
      expect(text, file).not.toMatch(/submitOrder|SankhyaWritePort|SankhyaGateway\b|integrationOutbox|integration_outbox/);
    }
  });
});

describe('failure classification for sync_state', () => {
  it('uses the Sankhya taxonomy and the retry flag of the gateway error', () => {
    const kinds = ['unavailable', 'rate_limit', 'temporary', 'auth', 'validation', 'permanent'] as const;
    for (const kind of kinds) {
      const failure = describeSyncFailure(new SankhyaGatewayError(kind, { code: 'x_1', message: 'clean message' }));
      expect(failure.errorClass).toBe(kind);
      expect(failure.retry).toBe(kind === 'unavailable' || kind === 'rate_limit' || kind === 'temporary');
      expect(failure.message).toBe('x_1: clean message');
    }
  });

  it('maps job errors and transient infrastructure errors', () => {
    expect(describeSyncFailure(new TransientJobError('down'))).toMatchObject({ errorClass: 'temporary', retry: true });
    expect(describeSyncFailure(new PermanentJobError('bad'))).toMatchObject({ errorClass: 'permanent', retry: false });
    expect(describeSyncFailure(Object.assign(new Error('boom'), { code: 'ECONNRESET' }))).toMatchObject({
      errorClass: 'temporary',
      retry: true,
    });
  });

  it('never stores the message of an unknown error (it can echo SQL text or personal data)', () => {
    const failure = describeSyncFailure(
      Object.assign(new Error('duplicate key value violates unique constraint (jose@example.com)'), { code: '23505' }),
    );
    expect(failure).toMatchObject({ errorClass: 'unclassified', errorCode: '23505', retry: false });
    expect(failure.message).not.toContain('jose@example.com');
    expect(failure.message.length).toBeLessThanOrEqual(500);
  });
});

describe('schedules, queues and locks', () => {
  it('schedules every entity from the settings, and none when disabled', () => {
    const settings = {
      SYNC_MIRROR_ENABLED: true,
      SYNC_CRON_SELLERS: '1 * * * *',
      SYNC_CRON_CUSTOMERS: '2 * * * *',
      SYNC_CRON_PRODUCTS: '3 * * * *',
      SYNC_CRON_PRICES: '4 * * * *',
    };
    expect(mirrorSchedulesFromSettings(settings)).toEqual({
      sellers: '1 * * * *',
      directoryUsers: '1 * * * *',
      customers: '2 * * * *',
      products: '3 * * * *',
      priceTables: '4 * * * *',
      priceTableVersions: '4 * * * *',
      listPrices: '4 * * * *',
    });
    expect(Object.values(mirrorSchedulesFromSettings({ ...settings, SYNC_MIRROR_ENABLED: false })).every((cron) => cron === null)).toBe(
      true,
    );
  });

  it('has valid 5-field default crons', () => {
    for (const cron of Object.values(DEFAULT_MIRROR_CRONS)) expect(cron).toMatch(/^\S+(\s+\S+){4}$/);
  });

  it('registers one dead-lettered, retrying queue per mirror entity, valid for pg-boss names', () => {
    for (const entity of MIRROR_ENTITIES) {
      const spec = QUEUE_REGISTRY.find((candidate) => candidate.name === mirrorQueueName(entity));
      expect(spec, entity).toBeDefined();
      expect(spec?.name).toMatch(/^[\w.\-/]+$/);
      expect(spec?.options.deadLetter).toBe(QUEUE_NAMES.deadLetter);
      expect(spec?.options.retryLimit).toBeGreaterThan(0);
      expect(spec?.options.retryBackoff).toBe(true);
    }
  });

  it('gives every entity its own advisory-lock object id', () => {
    const ids = MIRROR_ENTITIES.map(mirrorLockObjectId);
    expect(new Set(ids).size).toBe(MIRROR_ENTITIES.length);
    expect(ids.every((id) => id > 0)).toBe(true);
  });
});
