import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventsHub, pingFrame } from '../../src/events/events.hub.js';
import { OrderStatusCycle } from '../../src/worker/order-status-cycle.js';
import { PgListener, type ListenClient } from '../../src/platform/pg-listener.js';
import { createLogger } from '../../src/observability/logger.js';

const logger = createLogger({ level: 'silent', service: 'test' });

class FakeClient implements ListenClient {
  static all: FakeClient[] = [];
  handlers = new Map<string, ((...args: never[]) => void)[]>();
  queries: string[] = [];
  failConnect = false;
  ended = false;
  constructor() {
    FakeClient.all.push(this);
  }
  connect(): Promise<void> {
    return this.failConnect ? Promise.reject(new Error('down')) : Promise.resolve();
  }
  query(sql: string): Promise<unknown> {
    this.queries.push(sql);
    return Promise.resolve();
  }
  on(event: string, handler: (...args: never[]) => void): this {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
    return this;
  }
  end(): Promise<void> {
    this.ended = true;
    return Promise.resolve();
  }
  emit(event: string, ...args: unknown[]): void {
    for (const handler of this.handlers.get(event) ?? []) (handler as (...a: unknown[]) => void)(...args);
  }
}

afterEach(() => {
  FakeClient.all = [];
  vi.useRealTimers();
});

describe('PgListener', () => {
  it('listens, delivers payloads of its channel only, and reconnects with backoff after an error', async () => {
    vi.useFakeTimers();
    const messages: string[] = [];
    const listener = new PgListener({
      clientFactory: () => new FakeClient(),
      channel: 'sf_events',
      logger,
      initialBackoffMs: 100,
      onMessage: (payload) => messages.push(payload),
    });
    listener.start();
    await vi.advanceTimersByTimeAsync(0);
    const first = FakeClient.all[0]!;
    expect(first.queries).toEqual(['LISTEN sf_events']);
    expect(listener.connected).toBe(true);
    first.emit('notification', { channel: 'sf_events', payload: '{"topic":"orders"}' });
    first.emit('notification', { channel: 'other', payload: 'x' });
    expect(messages).toEqual(['{"topic":"orders"}']);

    first.emit('error', new Error('boom'));
    expect(listener.connected).toBe(false);
    await vi.advanceTimersByTimeAsync(150);
    expect(FakeClient.all).toHaveLength(2);
    expect(listener.connected).toBe(true);
    await listener.stop();
    expect(FakeClient.all[1]!.ended).toBe(true);
  });
});

describe('EventsHub', () => {
  const handle = { pool: {} } as never;
  const limits = { perAccount: 2, total: 3 };
  async function connectedHub(enabled = true) {
    return new EventsHub(handle, logger, enabled, limits);
  }

  it('refuses streams while the event channel is not connected', async () => {
    const hub = await connectedHub();
    expect(hub.subscribe({ accountId: 'a', write: () => undefined })).toEqual({ ok: false, reason: 'unavailable' });
    const off = await connectedHub(false);
    expect(off.subscribe({ accountId: 'a', write: () => undefined })).toEqual({ ok: false, reason: 'unavailable' });
  });

  it('frames pings content-free', () => {
    expect(pingFrame('orders')).toBe('event: ping\ndata: {"topic":"orders"}\n\n');
    expect(pingFrame('reference')).toBe('event: ping\ndata: {"topic":"reference"}\n\n');
  });
});

describe('OrderStatusCycle', () => {
  function pool(lock: boolean) {
    const queries: { sql: string; params: unknown[] }[] = [];
    const client = {
      query: (sql: string, params: unknown[] = []) => {
        queries.push({ sql, params });
        return Promise.resolve({ rows: [{ locked: lock }] });
      },
      release: () => undefined,
    };
    return { queries, db: { pool: { connect: () => Promise.resolve(client), query: (sql: string, params: unknown[]) => (queries.push({ sql, params }), Promise.resolve({ rows: [] })) } } as never };
  }
  const run = (updated: number) => ({ checked: 1, updated });

  it('runs the three passes and sends ONE content-free NOTIFY only when something changed', async () => {
    const { queries, db } = pool(true);
    const status = { runOnce: vi.fn().mockResolvedValue(run(0)), runReleaseOnce: vi.fn().mockResolvedValue(run(2)), runStageOnce: vi.fn().mockResolvedValue(run(1)) };
    const cycle = new OrderStatusCycle({ db, status, logger });
    expect(await cycle.runCycle()).toBe(true);
    expect(status.runOnce).toHaveBeenCalledTimes(1);
    const notifies = queries.filter((q) => q.sql.includes('pg_notify'));
    expect(notifies).toHaveLength(1);
    expect(notifies[0]!.params).toEqual(['sf_events', '{"topic":"orders"}']);

    status.runReleaseOnce.mockResolvedValue(run(0));
    status.runStageOnce.mockResolvedValue(run(0));
    await cycle.runCycle();
    expect(queries.filter((q) => q.sql.includes('pg_notify'))).toHaveLength(1);
  });

  it('does nothing when another replica holds the advisory lock', async () => {
    const { db } = pool(false);
    const status = { runOnce: vi.fn(), runReleaseOnce: vi.fn(), runStageOnce: vi.fn() };
    expect(await new OrderStatusCycle({ db, status, logger }).runCycle()).toBe(false);
    expect(status.runOnce).not.toHaveBeenCalled();
  });

  it('clamps the period to the 10 s minimum', () => {
    const { db } = pool(true);
    const status = { runOnce: vi.fn(), runReleaseOnce: vi.fn(), runStageOnce: vi.fn() };
    expect(new OrderStatusCycle({ db, status, logger, cycleMs: 1000 }).cycleMs).toBe(10_000);
    expect(new OrderStatusCycle({ db, status, logger }).cycleMs).toBe(30_000);
  });

  it('serves an on-demand refresh for one order without counting absences, and honors the 10 s cooldown', async () => {
    const { db } = pool(true);
    const status = { runOnce: vi.fn().mockResolvedValue(run(0)), runReleaseOnce: vi.fn().mockResolvedValue(run(0)), runStageOnce: vi.fn().mockResolvedValue(run(0)) };
    let now = 1_000_000;
    const client = new FakeClient();
    const cycle = new OrderStatusCycle({ db, status, logger, now: () => new Date(now), clientFactory: () => client });
    cycle.start();
    await new Promise((resolve) => setTimeout(resolve, 5));
    const id = '019a0000-0000-7000-8000-000000000001';
    const payload = JSON.stringify({ topic: 'order_refresh', id });
    client.emit('notification', { channel: 'sf_order_refresh', payload });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(status.runReleaseOnce).toHaveBeenCalledWith({ orderIds: [id], countAbsence: false });
    client.emit('notification', { channel: 'sf_order_refresh', payload });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(status.runReleaseOnce).toHaveBeenCalledTimes(1);
    now += 11_000;
    client.emit('notification', { channel: 'sf_order_refresh', payload });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(status.runReleaseOnce).toHaveBeenCalledTimes(2);
    await cycle.stop();
  });
});
