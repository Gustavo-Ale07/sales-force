import type { MigrationLevel } from '@salesforce/db';
import { DEMO_CONFIGURATION } from '@salesforce/sankhya';
import { describe, expect, it } from 'vitest';
import { canonicalJson, configurationContentHash } from '../../src/configuration/configuration-hash.js';
import { uuidv7 } from '../../src/platform/ids.js';
import { summarizeIntegration } from '../../src/platform/integration-summary.js';
import { migrationsCheckFrom, readyStatusFrom } from '../../src/platform/readiness.service.js';
import { HEARTBEAT_STALE_AFTER_MS, WORKER_HEARTBEAT_ENTITY } from '../../src/platform/worker-heartbeat.js';

type Row = Parameters<typeof summarizeIntegration>[0][number];

const NOW = new Date('2026-09-21T12:00:00.000Z');

function row(overrides: Partial<Row> & { entity: string }): Row {
  return {
    status: 'succeeded',
    lastSuccessAt: NOW,
    lastAttemptAt: NOW,
    cursor: null,
    lastFullReconcileAt: null,
    rowCount: null,
    lastErrorClass: null,
    lastErrorMessage: null,
    ...overrides,
  };
}

const heartbeat = (at: Date, mode = 'fake') =>
  row({ entity: WORKER_HEARTBEAT_ENTITY, lastSuccessAt: at, cursor: { gatewayMode: mode, startedAt: NOW.toISOString() } });

describe('integration summary', () => {
  it('is not_configured until the worker reports, with a pt-BR message', () => {
    const summary = summarizeIntegration([], NOW);
    expect(summary).toMatchObject({ state: 'not_configured', failingEntities: [], lastSuccessAt: null });
    expect(summary.message).toMatch(/worker/);
  });

  it('is ok with a fresh heartbeat and reports the worker gateway mode', () => {
    expect(summarizeIntegration([heartbeat(NOW, 'live')], NOW)).toMatchObject({
      state: 'ok',
      gatewayMode: 'live',
      message: null,
    });
  });

  it('is degraded when the worker went silent', () => {
    const silent = new Date(NOW.getTime() - HEARTBEAT_STALE_AFTER_MS - 60_000);
    const summary = summarizeIntegration([heartbeat(silent)], NOW);
    expect(summary.state).toBe('degraded');
    expect(summary.message).toMatch(/4 minutos/);
  });

  it('is degraded, listing sorted failing entities, when a mirror entity failed; reserved rows are not entities', () => {
    const summary = summarizeIntegration(
      [
        heartbeat(NOW),
        row({ entity: 'customers', status: 'failed' }),
        row({ entity: 'products', status: 'failed' }),
        row({ entity: 'sellers', lastSuccessAt: new Date('2026-09-21T11:00:00.000Z') }),
        row({ entity: 'worker.other', status: 'failed' }),
      ],
      NOW,
    );
    expect(summary).toMatchObject({ state: 'degraded', failingEntities: ['customers', 'products'] });
    expect(summary.lastSuccessAt).toBe(NOW.toISOString());
  });

  it('reports an unknown mode (never fake) when the heartbeat cursor is malformed or absent', () => {
    const broken = row({ entity: WORKER_HEARTBEAT_ENTITY, cursor: { gatewayMode: 'turbo' } });
    expect(summarizeIntegration([broken], NOW).gatewayMode).toBe('unknown');
    expect(summarizeIntegration([], NOW).gatewayMode).toBe('unknown');
  });
});

describe('readiness rules', () => {
  const level = (overrides: Partial<MigrationLevel>): MigrationLevel => ({
    appliedCount: 3,
    lastId: '0002_x',
    expectedCount: 3,
    upToDate: true,
    ...overrides,
  });

  it('classifies the migration level', () => {
    expect(migrationsCheckFrom(level({}))).toEqual({ status: 'ok', applied: '3', expected: '3' });
    expect(migrationsCheckFrom(level({ appliedCount: 4 }))).toEqual({ status: 'ahead', applied: '4', expected: '3' });
    expect(migrationsCheckFrom(level({ appliedCount: 1, upToDate: false }))).toEqual({
      status: 'behind',
      applied: '1',
      expected: '3',
    });
    expect(migrationsCheckFrom(level({ expectedCount: null, upToDate: false }))).toEqual({
      status: 'unknown',
      applied: '3',
      expected: null,
    });
  });

  it('is not_ready for database failure and missing migrations, degraded (never not_ready) for the integration', () => {
    expect(readyStatusFrom({ database: 'fail', migrations: 'ok', integration: 'ok' })).toBe('not_ready');
    expect(readyStatusFrom({ database: 'ok', migrations: 'behind', integration: 'ok' })).toBe('not_ready');
    expect(readyStatusFrom({ database: 'ok', migrations: 'unknown', integration: 'ok' })).toBe('not_ready');
    expect(readyStatusFrom({ database: 'ok', migrations: 'ok', integration: 'ok' })).toBe('ready');
    expect(readyStatusFrom({ database: 'ok', migrations: 'ahead', integration: 'ok' })).toBe('ready');
    expect(readyStatusFrom({ database: 'ok', migrations: 'ok', integration: 'degraded' })).toBe('degraded');
    expect(readyStatusFrom({ database: 'ok', migrations: 'ok', integration: 'not_configured' })).toBe('degraded');
  });
});

describe('uuidv7', () => {
  it('sets version, variant and the millisecond timestamp, and sorts by time', () => {
    const fixed = (size: number) => new Uint8Array(size).fill(0xff);
    expect(uuidv7(0x0123_4567_89ab, fixed)).toBe('01234567-89ab-7fff-bfff-ffffffffffff');
    expect(uuidv7(2000)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(uuidv7(1000) < uuidv7(2000)).toBe(true);
    expect(uuidv7(5000)).not.toBe(uuidv7(5000));
  });
});

describe('configuration hash', () => {
  it('is stable across key order and ignores source.syncedAt', () => {
    expect(canonicalJson({ b: 1, a: { d: [2, 1], c: null } })).toBe('{"a":{"c":null,"d":[2,1]},"b":1}');
    const later = { ...DEMO_CONFIGURATION, source: { ...DEMO_CONFIGURATION.source, syncedAt: '2030-01-01T00:00:00.000Z' } };
    expect(configurationContentHash(later)).toBe(configurationContentHash(DEMO_CONFIGURATION));
    expect(configurationContentHash(DEMO_CONFIGURATION)).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('changes when the content changes', () => {
    const changed = { ...DEMO_CONFIGURATION, source: { ...DEMO_CONFIGURATION.source, version: 'another-version' } };
    expect(configurationContentHash(changed)).not.toBe(configurationContentHash(DEMO_CONFIGURATION));
  });
});
