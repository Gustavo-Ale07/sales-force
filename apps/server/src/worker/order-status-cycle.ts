import type { DbHandle } from '@salesforce/db';
import type { Logger } from '../observability/logger.js';
import type { OrderErpStatusRun, OrderErpStatusService } from '../integration/order-erp-status.service.js';
import { withAdvisoryLock } from '../sync/entity-lock.js';
import {
  dedicatedClientFactory,
  notifyTopic,
  ORDER_REFRESH_CHANNEL,
  PgListener,
  type ListenClient,
} from '../platform/pg-listener.js';

/** First key of the advisory lock that keeps replicas and restarts from running the cycle twice (`SFOC`). */
export const ORDER_CYCLE_LOCK_NAMESPACE = 0x53464f43;
export const ORDER_CYCLE_LOCK_OBJECT = 1;

export const DEFAULT_ORDER_STATUS_CYCLE_MS = 30_000;
export const MIN_ORDER_STATUS_CYCLE_MS = 10_000;
/** RT-1: minimum time between two on-demand reads of the same order (the API enforces the same window). */
export const ORDER_REFRESH_COOLDOWN_MS = 10_000;
/** More ids than this in one on-demand burst are ignored: the next cycle covers them. */
const MAX_REFRESH_IDS_PER_RUN = 50;

/** Minimum time between two automatic origin-field reconciliations of unconfirmed orders. */
export const ORIGIN_RECONCILE_EVERY_MS = 120_000;

export type OrderStatusPass = Pick<OrderErpStatusService, 'runOnce' | 'runReleaseOnce' | 'runStageOnce'> &
  Partial<Pick<OrderErpStatusService, 'reconcileByOriginOnce'>>;

export interface OrderStatusCycleDeps {
  readonly db: DbHandle;
  readonly status: OrderStatusPass;
  readonly logger: Logger;
  readonly cycleMs?: number;
  readonly now?: () => Date;
  /** Replaces the dedicated LISTEN client (tests). */
  readonly clientFactory?: () => ListenClient;
}

function changed(...runs: readonly OrderErpStatusRun[]): boolean {
  return runs.some((run) => run.updated > 0);
}

/**
 * RT-1 short cycle (replaces the 15-minute cron): every `cycleMs` the worker reads the status, release and stage of the still-open
 * orders (each pass already bounded to 200 orders, least recently checked first) and, when anything changed, sends ONE content-free
 * `NOTIFY sf_events {"topic":"orders"}`. A PostgreSQL advisory lock keeps two replicas (or a restart overlap) from running it at the
 * same time. It also serves "refresh this order now" requests the API sends over `sf_order_refresh`: only the worker reads Sankhya.
 */
export class OrderStatusCycle {
  readonly #timer: { current: ReturnType<typeof setInterval> | undefined } = { current: undefined };
  readonly #listener: PgListener;
  readonly #lastRefreshed = new Map<string, number>();
  #busy = false;
  #lastReconcileAt = 0;
  #refreshQueue = new Set<string>();
  #refreshBusy = false;

  constructor(private readonly deps: OrderStatusCycleDeps) {
    this.#listener = new PgListener({
      clientFactory: deps.clientFactory ?? dedicatedClientFactory(deps.db.pool, 'salesforce-worker-order-refresh'),
      channel: ORDER_REFRESH_CHANNEL,
      logger: deps.logger,
      onMessage: (payload) => this.#enqueueRefresh(payload),
    });
  }

  get cycleMs(): number {
    return Math.max(MIN_ORDER_STATUS_CYCLE_MS, this.deps.cycleMs ?? DEFAULT_ORDER_STATUS_CYCLE_MS);
  }

  start(): void {
    if (this.#timer.current !== undefined) return;
    this.#timer.current = setInterval(() => void this.runCycle(), this.cycleMs);
    this.#timer.current.unref();
    this.#listener.start();
  }

  async stop(): Promise<void> {
    if (this.#timer.current !== undefined) clearInterval(this.#timer.current);
    this.#timer.current = undefined;
    await this.#listener.stop();
  }

  /** One pass of the three reads under the advisory lock. Returns false when it did not run (busy or another replica holds the lock). */
  async runCycle(): Promise<boolean> {
    if (this.#busy) return false;
    this.#busy = true;
    try {
      const outcome = await withAdvisoryLock(this.deps.db.pool, ORDER_CYCLE_LOCK_NAMESPACE, ORDER_CYCLE_LOCK_OBJECT, async () => {
        // One failing read never blocks the others (each pass classifies its own failures and keeps the stored state).
        const status = await this.deps.status.runOnce();
        const release = await this.deps.status.runReleaseOnce();
        const stage = await this.deps.status.runStageOnce();
        // Orders the Force never saw answered (unknown / rejected without ERP number) are matched by the origin field only (SNK-4),
        // at most once per ORIGIN_RECONCILE_EVERY_MS: the lookup is one ERP read per candidate.
        const nowMs = (this.deps.now ?? (() => new Date()))().getTime();
        let reconciled: OrderErpStatusRun = { checked: 0, updated: 0 };
        if (this.deps.status.reconcileByOriginOnce !== undefined && nowMs - this.#lastReconcileAt >= ORIGIN_RECONCILE_EVERY_MS) {
          this.#lastReconcileAt = nowMs;
          reconciled = await this.deps.status.reconcileByOriginOnce();
        }
        return changed(status, release, stage, reconciled);
      });
      if (!outcome.acquired) return false;
      if (outcome.value) await this.#notifyOrders();
      return true;
    } catch (error) {
      this.deps.logger.warn({ err: error }, 'order status cycle failed; the next tick retries');
      return false;
    } finally {
      this.#busy = false;
    }
  }

  #enqueueRefresh(payload: string): void {
    let id: unknown;
    try {
      id = (JSON.parse(payload) as { id?: unknown }).id;
    } catch {
      return;
    }
    if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) return;
    const now = (this.deps.now ?? (() => new Date()))().getTime();
    const last = this.#lastRefreshed.get(id);
    if (last !== undefined && now - last < ORDER_REFRESH_COOLDOWN_MS) return;
    this.#lastRefreshed.set(id, now);
    if (this.#lastRefreshed.size > 2000) {
      for (const [key, at] of this.#lastRefreshed) if (now - at >= ORDER_REFRESH_COOLDOWN_MS) this.#lastRefreshed.delete(key);
    }
    if (this.#refreshQueue.size < MAX_REFRESH_IDS_PER_RUN) this.#refreshQueue.add(id);
    void this.#serveRefreshes();
  }

  async #serveRefreshes(): Promise<void> {
    if (this.#refreshBusy) return;
    this.#refreshBusy = true;
    try {
      while (this.#refreshQueue.size > 0) {
        const orderIds = [...this.#refreshQueue];
        this.#refreshQueue = new Set();
        // `countAbsence: false`: an on-demand read never counts towards the deletion confirmations (the cycle does).
        const status = await this.deps.status.runOnce({ orderIds });
        const release = await this.deps.status.runReleaseOnce({ orderIds, countAbsence: false });
        const stage = await this.deps.status.runStageOnce({ orderIds });
        if (changed(status, release, stage)) await this.#notifyOrders();
      }
    } catch (error) {
      this.deps.logger.warn({ err: error }, 'on-demand order refresh failed; the next cycle covers it');
    } finally {
      this.#refreshBusy = false;
    }
  }

  async #notifyOrders(): Promise<void> {
    await notifyTopic(this.deps.db.pool, 'orders').catch((error: unknown) =>
      this.deps.logger.warn({ err: error }, 'could not notify the order change'),
    );
  }
}
