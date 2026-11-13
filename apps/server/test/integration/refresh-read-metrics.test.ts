import { randomUUID } from 'node:crypto';
import { FakeGateway, getDemoDataset } from '@salesforce/sankhya';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SyncRefreshService } from '../../src/sync-refresh/sync-refresh.service.js';
import type { CurrentUser } from '../../src/iam/current-user.js';
import type { Logger } from '../../src/observability/logger.js';
import { MirrorSyncService, type MirrorRunResult } from '../../src/sync/mirror-sync.service.js';
import { SyncRefreshRunner } from '../../src/sync/sync-refresh-runner.service.js';
import { closeAllThenStop, createMigratedDatabase, startPostgres, type MigratedDatabase, type TestPostgres } from '../helpers/postgres.js';

/**
 * Owner ruling 2026-11-13 (F): every refresh read and step logs how long it took and how big it was, so a slow Sankhya read
 * can be found in production. Counts, sizes and durations only: never a name, document, price or any row content.
 */
let postgres: TestPostgres;
const databases: MigratedDatabase[] = [];
beforeAll(async () => {
  postgres = await startPostgres();
});
afterAll(async () => {
  await closeAllThenStop(databases.map((d) => () => d.handle.close()), postgres);
});

interface Entry {
  readonly level: 'info' | 'warn' | 'error';
  readonly fields: Record<string, unknown>;
  readonly message: string;
}
function capturingLogger(entries: Entry[]): Logger {
  const at = (level: Entry['level']) => (fields: unknown, message?: string) => {
    entries.push({ level, fields: typeof fields === 'object' && fields !== null ? (fields as Record<string, unknown>) : {}, message: message ?? String(fields) });
  };
  return { info: at('info'), warn: at('warn'), error: at('error'), debug: () => undefined, trace: () => undefined, fatal: at('error'), child: () => capturingLogger(entries) } as unknown as Logger;
}

const manager = { accountId: randomUUID(), role: 'manager' } as CurrentUser;

describe('refresh read metrics in the logs', () => {
  it('the mirror read logs its duration and the approximate size of what it read, with no row content', async () => {
    const database = await createMigratedDatabase(postgres);
    databases.push(database);
    const entries: Entry[] = [];
    const dataset = getDemoDataset();
    const service = new MirrorSyncService({
      db: database.handle,
      gateway: new FakeGateway({ dataset }),
      logger: capturingLogger(entries),
      now: () => new Date(),
    });
    const result = await service.run('productGroups');
    expect(result.outcome).toBe('completed');
    const done = entries.find((entry) => entry.message === 'mirror sync completed');
    expect(done?.fields).toMatchObject({ entity: 'productGroups' });
    expect(typeof done?.fields['durationMs']).toBe('number');
    expect(done?.fields['durationMs'] as number).toBeGreaterThanOrEqual(0);
    expect(done?.fields['payloadBytes'] as number).toBeGreaterThan(0);
    const text = JSON.stringify(entries);
    for (const group of dataset.productGroups.slice(0, 5)) expect(text).not.toContain(group.name);
  });

  it('each refresh step logs entity, status, duration and rows read, never anything else', async () => {
    const database = await createMigratedDatabase(postgres);
    databases.push(database);
    const entries: Entry[] = [];
    let tick = 0;
    const now = () => new Date(Date.UTC(2026, 10, 13, 12, 0, 0) + (tick += 25));
    const api = new SyncRefreshService(database.handle.db, now);
    const started = await api.start(manager);
    const ok = (entity: string): MirrorRunResult =>
      ({ entity, outcome: 'completed', stats: { read: 7, created: 0, updated: 0, reactivated: 0, unchanged: 7, deactivated: 0 } }) as MirrorRunResult;
    await new SyncRefreshRunner({ db: database.handle, mirror: { run: async (entity) => ok(entity) }, logger: capturingLogger(entries), now }).run(started.id);
    const steps = entries.filter((entry) => entry.message === 'on-demand refresh step finished');
    expect(steps.length).toBeGreaterThan(3);
    const products = steps.find((entry) => entry.fields['entity'] === 'products');
    expect(products?.fields).toMatchObject({ refreshId: started.id, status: 'ok', rowsRead: 7 });
    for (const step of steps) {
      expect(typeof step.fields['durationMs']).toBe('number');
      expect(Object.keys(step.fields).sort()).toEqual(['durationMs', 'entity', 'refreshId', 'rowsRead', 'status']);
    }
  });
});
