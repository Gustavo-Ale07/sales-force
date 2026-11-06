import { randomUUID } from 'node:crypto';
import { SYNC_REFRESH_ENTITIES, type SyncRefresh } from '@salesforce/contracts';
import { syncRefresh } from '@salesforce/db';
import { SankhyaGatewayError } from '@salesforce/sankhya';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppError } from '../../src/http/app-error.js';
import type { CurrentUser } from '../../src/iam/current-user.js';
import { createLogger } from '../../src/observability/logger.js';
import { SyncRefreshService } from '../../src/sync-refresh/sync-refresh.service.js';
import type { MirrorRunResult } from '../../src/sync/mirror-sync.service.js';
import { SYNC_REFRESH_EXPIRED_REASON, SYNC_REFRESH_PENDING_EXPIRY_MS, SYNC_REFRESH_RUNNING_EXPIRY_MS } from '../../src/sync/sync-refresh-expiry.js';
import { SyncRefreshRunner } from '../../src/sync/sync-refresh-runner.service.js';
import { closeAllThenStop, createMigratedDatabase, startPostgres, type MigratedDatabase, type TestPostgres } from '../helpers/postgres.js';

let postgres: TestPostgres;
const databases: MigratedDatabase[] = [];

beforeAll(async () => {
  postgres = await startPostgres();
});
afterAll(async () => {
  await closeAllThenStop(databases.map((d) => () => d.handle.close()), postgres);
});

const T0 = Date.parse('2026-11-06T12:00:00Z');
const logger = createLogger({ level: 'silent', service: 'test' });
const user = { accountId: randomUUID(), role: 'manager' } as CurrentUser;
const seller = { accountId: randomUUID(), role: 'seller' } as CurrentUser;
type Detail = SyncRefresh & { reused?: boolean };

async function world() {
  const database = await createMigratedDatabase(postgres);
  databases.push(database);
  let at = T0;
  const clock = () => new Date(at);
  const api = new SyncRefreshService(database.handle.db, clock);
  const advance = (ms: number) => {
    at += ms;
  };
  const okResult = (entity: string, read = 3): MirrorRunResult =>
    ({ entity, outcome: 'completed', stats: { read, created: 0, updated: 0, reactivated: 0, unchanged: read, deactivated: 0 } }) as MirrorRunResult;
  const runner = (over: Partial<ConstructorParameters<typeof SyncRefreshRunner>[0]> = {}) =>
    new SyncRefreshRunner({
      db: database.handle,
      mirror: { run: async (entity) => okResult(entity) },
      logger,
      now: clock,
      ...over,
    });
  const row = async (id: string) => (await database.handle.db.select().from(syncRefresh).where(eq(syncRefresh.id, id)))[0]!;
  return { database, api, advance, runner, row, okResult };
}

describe('POST /sync/refresh (API side, D-AB B3)', () => {
  it('records a pending request with one pending step per entity, in the specified order', async () => {
    const w = await world();
    const started = (await w.api.start(user)) as Detail;
    expect(started.reused).toBe(false);
    expect(started.status).toBe('pending');
    expect(started.steps.map((s) => s.entity)).toEqual([...SYNC_REFRESH_ENTITIES]);
    expect(started.steps.every((s) => s.status === 'pending')).toBe(true);
  });

  it('a second click while one is pending or running returns the same refresh', async () => {
    const w = await world();
    const first = (await w.api.start(user)) as Detail;
    const second = (await w.api.start(user)) as Detail;
    expect(second.id).toBe(first.id);
    expect(second.reused).toBe(true);
    await w.database.handle.db.update(syncRefresh).set({ status: 'running', startedAt: new Date(T0) }).where(eq(syncRefresh.id, first.id));
    expect(((await w.api.start(user)) as Detail).id).toBe(first.id);
  });

  it('the database allows only one active refresh', async () => {
    const w = await world();
    (await w.api.start(user)) as Detail;
    await expect(
      w.database.handle.pool.query(`INSERT INTO sync_refresh (id, requested_by, status) VALUES ($1, $2, 'pending')`, [randomUUID(), randomUUID()]),
    ).rejects.toThrow(/sync_refresh_active_uq/);
  });

  it('a refresh finished less than a minute ago is returned; after the cooldown a new one starts', async () => {
    const w = await world();
    const first = (await w.api.start(user)) as Detail;
    await w.runner().run(first.id);
    w.advance(30_000);
    const within = (await w.api.start(user)) as Detail;
    expect(within.id).toBe(first.id);
    expect(within.reused).toBe(true);
    w.advance(31_000);
    const after = (await w.api.start(user)) as Detail;
    expect(after.id).not.toBe(first.id);
    expect(after.reused).toBe(false);
  });

  it('GET of an unknown id is not_found', async () => {
    const w = await world();
    await expect(w.api.get(randomUUID(), user)).rejects.toBeInstanceOf(AppError);
  });

  it('the status is the oldest last success among the mirrored entities (null while nothing was read)', async () => {
    const w = await world();
    expect(await w.api.status()).toEqual({ dataAsOf: null });
    const pool = w.database.handle.pool;
    await pool.query(`INSERT INTO sync_state (entity, status, last_success_at) VALUES ('customers', 'succeeded', $1), ('products', 'succeeded', $2)`, [
      new Date(T0 - 60_000),
      new Date(T0 - 600_000),
    ]);
    expect(await w.api.status()).toEqual({ dataAsOf: new Date(T0 - 600_000).toISOString() });
  });

  it('GET carries the last success of each entity so a failed step can say how old its data is', async () => {
    const w = await world();
    await w.database.handle.pool.query(`INSERT INTO sync_state (entity, status, last_success_at) VALUES ('customers', 'succeeded', $1)`, [new Date(T0 - 120_000)]);
    const started = (await w.api.start(user)) as Detail;
    const customers = (await (w.api.get(started.id, user) as Promise<Detail>)).steps.find((s) => s.entity === 'customers');
    expect(customers?.lastSuccessAt).toBe(new Date(T0 - 120_000).toISOString());
  });
});

describe('role-based view (D-AC C1): a seller never receives steps, counts or reasons', () => {
  const basicKeys = ['finishedAt', 'hasWarnings', 'id', 'phase', 'progressPercent', 'reused', 'status'];

  it('POST and GET give the seller only the basic fields, even after a failure with a technical reason', async () => {
    const w = await world();
    const started = await w.api.start(seller);
    expect(Object.keys(started).sort()).toEqual(basicKeys);
    expect(started).toMatchObject({ status: 'pending', progressPercent: 0, phase: 'cadastros', hasWarnings: false });
    await w
      .runner({
        mirror: {
          run: async (entity) => {
            if (entity === 'customers') throw new SankhyaGatewayError('unavailable', { code: 'SNK_DOWN', message: 'Sankhya fora do ar' });
            return w.okResult(entity, 7);
          },
        },
      })
      .run(started.id);
    const view = await w.api.get(started.id, seller);
    expect(Object.keys(view).sort()).toEqual(['finishedAt', 'hasWarnings', 'id', 'phase', 'progressPercent', 'status']);
    expect(view).toMatchObject({ status: 'done', progressPercent: 100, phase: 'concluido', hasWarnings: true });
    const text = JSON.stringify(view);
    for (const forbidden of ['steps', 'customers', 'SNK_DOWN', 'rowsRead', 'reason', 'Sankhya fora']) expect(text).not.toContain(forbidden);
  });

  it('manager, admin and technical keep the detail; any other role gets the basic view', async () => {
    const w = await world();
    const started = await w.api.start(user);
    for (const role of ['manager', 'admin', 'technical'] as const) {
      expect('steps' in (await w.api.get(started.id, { ...user, role }))).toBe(true);
    }
    expect('steps' in (await w.api.get(started.id, { ...user, role: 'unknown' as never }))).toBe(false);
  });

  it('progress grows with the finished steps and the phase follows the running one', async () => {
    const w = await world();
    const started = await w.api.start(seller);
    const seen: string[] = [];
    await w
      .runner({
        mirror: {
          run: async (entity) => {
            const view = await w.api.get(started.id, seller);
            if ('phase' in view) seen.push(`${view.phase}:${view.progressPercent}`);
            return w.okResult(entity);
          },
        },
      })
      .run(started.id);
    expect(seen[0]).toMatch(/^cadastros:/);
    expect(seen.some((entry) => entry.startsWith('precos:'))).toBe(true);
    const percents = seen.map((entry) => Number(entry.split(':')[1]));
    expect([...percents].sort((a, b) => a - b)).toEqual(percents);
  });
});

describe('sync.refresh.on-demand (worker side, D-AB B3)', () => {
  it('runs every step in order, records rows read, and marks the request done', async () => {
    const w = await world();
    const order: string[] = [];
    const started = (await w.api.start(user)) as Detail;
    await w
      .runner({
        mirror: {
          run: async (entity) => {
            order.push(entity);
            return { entity, outcome: 'completed', stats: { read: 5, created: 0, updated: 0, reactivated: 0, unchanged: 5, deactivated: 0 } } as MirrorRunResult;
          },
        },
        configuration: { run: async () => ({ outcome: 'unchanged', contentHash: 'h', warnings: 0 }) },
        orderStatus: { runOnce: async () => ({ checked: 2, updated: 1 }) },
      })
      .run(started.id);
    const done = await (w.api.get(started.id, user) as Promise<Detail>);
    expect(done.status).toBe('done');
    expect(done.steps.map((s) => s.status)).toEqual(SYNC_REFRESH_ENTITIES.map(() => 'ok'));
    expect(order).toEqual(SYNC_REFRESH_ENTITIES.filter((e) => e !== 'configuration' && e !== 'orderStatus'));
    expect(done.steps.find((s) => s.entity === 'customers')?.rowsRead).toBe(5);
    expect(done.steps.find((s) => s.entity === 'orderStatus')?.rowsRead).toBe(2);
    expect(done.finishedAt).not.toBeNull();
  });

  it('a failed entity is reported with a masked reason and does not stop the following ones', async () => {
    const w = await world();
    const started = (await w.api.start(user)) as Detail;
    await w
      .runner({
        mirror: {
          run: async (entity) => {
            if (entity === 'customers') throw new SankhyaGatewayError('unavailable', { code: 'SNK_DOWN', message: 'Sankhya fora do ar' });
            return { entity, outcome: 'completed', stats: { read: 1, created: 0, updated: 0, reactivated: 0, unchanged: 1, deactivated: 0 } } as MirrorRunResult;
          },
        },
      })
      .run(started.id);
    const done = await (w.api.get(started.id, user) as Promise<Detail>);
    const byEntity = new Map(done.steps.map((s) => [s.entity, s]));
    expect(byEntity.get('customers')?.status).toBe('failed');
    expect(byEntity.get('customers')?.reason).toContain('SNK_DOWN');
    expect(byEntity.get('products')?.status).toBe('ok');
    expect(done.status).toBe('done');
  });

  it('steps without a wired service are skipped with a reason, never silent', async () => {
    const w = await world();
    const started = (await w.api.start(user)) as Detail;
    await w.runner().run(started.id);
    const done = await (w.api.get(started.id, user) as Promise<Detail>);
    for (const entity of ['configuration', 'orderStatus'] as const) {
      const step = done.steps.find((s) => s.entity === entity);
      expect(step?.status).toBe('skipped');
      expect(step?.reason).toBeTruthy();
    }
  });

  it('a failing order-status read is reported as failed', async () => {
    const w = await world();
    const started = (await w.api.start(user)) as Detail;
    await w.runner({ orderStatus: { runOnce: async () => ({ checked: 0, updated: 0, failed: true }) } }).run(started.id);
    expect((await (w.api.get(started.id, user) as Promise<Detail>)).steps.find((s) => s.entity === 'orderStatus')?.status).toBe('failed');
  });

  it('a second delivery of the same job does nothing (idempotent claim)', async () => {
    const w = await world();
    const started = (await w.api.start(user)) as Detail;
    let calls = 0;
    const runner = w.runner({
      mirror: {
        run: async (entity) => {
          calls += 1;
          return { entity, outcome: 'completed', stats: null } as MirrorRunResult;
        },
      },
    });
    await runner.run(started.id);
    const firstCalls = calls;
    await runner.run(started.id);
    expect(calls).toBe(firstCalls);
  });

  it('lists pending requests', async () => {
    const w = await world();
    const started = (await w.api.start(user)) as Detail;
    expect(await w.runner().pendingIds()).toEqual([started.id]);
  });

  describe('expiry of a stuck refresh (D-AD)', () => {
    it('pending without pickup for more than 2 minutes fails with the masked reason, and the next click starts a new run', async () => {
      const w = await world();
      const started = (await w.api.start(user)) as Detail;
      w.advance(SYNC_REFRESH_PENDING_EXPIRY_MS - 1_000);
      expect(await w.runner().closeStale()).toBe(0);
      w.advance(2_000);
      expect(await w.runner().closeStale()).toBe(1);
      const closed = await w.row(started.id);
      expect(closed.status).toBe('done');
      expect((closed.steps as Array<{ status: string; reason: string }>).every((s) => s.status === 'failed' && s.reason === SYNC_REFRESH_EXPIRED_REASON)).toBe(true);
      // No 60 s cooldown for a dead run.
      const next = (await w.api.start(user)) as Detail;
      expect(next.reused).toBe(false);
      expect(next.id).not.toBe(started.id);
    });

    it('the API sweeps a stuck request itself when a new POST arrives (worker down)', async () => {
      const w = await world();
      const started = (await w.api.start(user)) as Detail;
      w.advance(SYNC_REFRESH_PENDING_EXPIRY_MS + 1_000);
      const next = (await w.api.start(user)) as Detail;
      expect(next.reused).toBe(false);
      expect((await w.row(started.id)).status).toBe('done');
    });

    it('running without progress for more than 5 minutes fails; a run that advances is not expired', async () => {
      const w = await world();
      const started = (await w.api.start(user)) as Detail;
      await w.database.handle.db
        .update(syncRefresh)
        .set({ status: 'running', startedAt: new Date(T0), progressAt: new Date(T0) })
        .where(eq(syncRefresh.id, started.id));
      w.advance(SYNC_REFRESH_RUNNING_EXPIRY_MS - 1_000);
      expect(await w.runner().closeStale()).toBe(0);
      w.advance(2_000);
      expect(await w.runner().closeStale()).toBe(1);
      const closed = await w.row(started.id);
      expect(closed.status).toBe('done');
      expect(((await w.api.start(user)) as Detail).reused).toBe(false);
    });

    it('a healthy slow refresh (a 90 s step) is not expired while it advances', async () => {
      const w = await world();
      const started = (await w.api.start(user)) as Detail;
      const sweeps: number[] = [];
      const runner = w.runner({
        mirror: {
          run: async (entity) => {
            // Each step takes 90 s of controlled time and a sweep runs in the middle of it.
            w.advance(90_000);
            sweeps.push(await w.runner().closeStale());
            return w.okResult(entity);
          },
        },
      });
      await runner.run(started.id);
      expect(sweeps.every((n) => n === 0)).toBe(true);
      const finished = await w.row(started.id);
      expect(finished.status).toBe('done');
      expect((finished.steps as Array<{ status: string }>).filter((s) => s.status === 'failed')).toHaveLength(0);
    });
  });
});
