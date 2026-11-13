import { randomUUID } from 'node:crypto';
import type { SyncRefresh } from '@salesforce/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CurrentUser } from '../../src/iam/current-user.js';
import { createLogger } from '../../src/observability/logger.js';
import { SyncRefreshService } from '../../src/sync-refresh/sync-refresh.service.js';
import type { MirrorRunResult } from '../../src/sync/mirror-sync.service.js';
import { SyncRefreshRunner } from '../../src/sync/sync-refresh-runner.service.js';
import { closeAllThenStop, createMigratedDatabase, startPostgres, type MigratedDatabase, type TestPostgres } from '../helpers/postgres.js';

/** Owner ruling 2026-11-13: visible/hidden counts per kind and the anti-empty guard reach the refresh result (detail view only). */
let postgres: TestPostgres;
const databases: MigratedDatabase[] = [];
beforeAll(async () => {
  postgres = await startPostgres();
});
afterAll(async () => {
  await closeAllThenStop(databases.map((d) => () => d.handle.close()), postgres);
});

const logger = createLogger({ level: 'silent', service: 'test' });
const manager = { accountId: randomUUID(), role: 'manager' } as CurrentUser;
const seller = { accountId: randomUUID(), role: 'seller' } as CurrentUser;

async function world() {
  const database = await createMigratedDatabase(postgres);
  databases.push(database);
  const clock = () => new Date('2026-11-13T12:00:00Z');
  const api = new SyncRefreshService(database.handle.db, clock);
  const ok = (entity: string, extra: Partial<MirrorRunResult> = {}): MirrorRunResult =>
    ({ entity, outcome: 'completed', stats: { read: 3, created: 0, updated: 0, reactivated: 0, unchanged: 3, deactivated: 0 }, ...extra }) as MirrorRunResult;
  return { api, ok, runner: (over: Partial<ConstructorParameters<typeof SyncRefreshRunner>[0]>) => new SyncRefreshRunner({ db: database.handle, mirror: { run: async (e) => ok(e) }, logger, now: clock, ...over }) };
}

describe('refresh result carries the AD_MOBILIDADE counts', () => {
  it('products: counts and keptPrevious on the step; the reason says to warn the IT; the seller sees only hasWarnings', async () => {
    const w = await world();
    const started = await w.api.start(manager);
    await w
      .runner({
        mirror: {
          run: async (entity) => (entity === 'products' ? w.ok(entity, { mobility: { visible: 4, hidden: 96, keptPrevious: true } }) : w.ok(entity)),
        },
      })
      .run(started.id);
    const detail = (await w.api.get(started.id, manager)) as SyncRefresh;
    const step = detail.steps.find((s) => s.entity === 'products');
    expect(step?.mobility).toEqual([{ kind: 'products', visible: 4, hidden: 96, keptPrevious: true }]);
    expect(step?.reason).toMatch(/avise o TI/i);
    const basic = await w.api.get(started.id, seller);
    expect(basic).toMatchObject({ hasWarnings: true });
    expect(JSON.stringify(basic)).not.toContain('mobility');
    expect(JSON.stringify(basic)).not.toContain('keptPrevious');
  });

  it('products without a guard hit: counts without a warning', async () => {
    const w = await world();
    const started = await w.api.start(manager);
    await w
      .runner({
        mirror: {
          run: async (entity) => (entity === 'products' ? w.ok(entity, { mobility: { visible: 90, hidden: 10, keptPrevious: false } }) : w.ok(entity)),
        },
      })
      .run(started.id);
    const detail = (await w.api.get(started.id, manager)) as SyncRefresh;
    const step = detail.steps.find((s) => s.entity === 'products');
    expect(step?.mobility).toEqual([{ kind: 'products', visible: 90, hidden: 10, keptPrevious: false }]);
    expect(step?.reason).toBeNull();
    expect(await w.api.get(started.id, seller)).toMatchObject({ hasWarnings: false });
  });

  it('configuration: TOP and negotiation-type counts', async () => {
    const w = await world();
    const started = await w.api.start(manager);
    await w
      .runner({
        configuration: {
          run: async () => ({
            outcome: 'unchanged',
            contentHash: 'h',
            warnings: 1,
            mobility: [
              { kind: 'tops', visible: 7, hidden: 3, keptPrevious: false },
              { kind: 'negotiationTypes', visible: 1, hidden: 34, keptPrevious: true },
            ],
          }),
        },
      })
      .run(started.id);
    const detail = (await w.api.get(started.id, manager)) as SyncRefresh;
    const step = detail.steps.find((s) => s.entity === 'configuration');
    expect(step?.mobility).toEqual([
      { kind: 'tops', visible: 7, hidden: 3, keptPrevious: false },
      { kind: 'negotiationTypes', visible: 1, hidden: 34, keptPrevious: true },
    ]);
    expect(step?.reason).toMatch(/avise o TI/i);
    expect(await w.api.get(started.id, seller)).toMatchObject({ hasWarnings: true });
  });

  it('the response of start() to a seller carries no mobility counts either, even when it reuses a run that has them (server-side)', async () => {
    const w = await world();
    const first = await w.api.start(manager);
    await w
      .runner({
        mirror: {
          run: async (entity) => (entity === 'products' ? w.ok(entity, { mobility: { visible: 4, hidden: 96, keptPrevious: true } }) : w.ok(entity)),
        },
      })
      .run(first.id);
    const again = await w.api.start(seller);
    expect(again.id).toBe(first.id);
    expect(again).toMatchObject({ reused: true, hasWarnings: true });
    const text = JSON.stringify(again);
    for (const word of ['mobility', 'keptPrevious', 'hidden', 'visible', 'steps', 'products']) expect(text).not.toContain(word);
  });
});
