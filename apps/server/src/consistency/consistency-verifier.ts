import { syncState, type DbHandle } from '@salesforce/db';
import type { ReadScope, SankhyaOrderReadPort, SankhyaReadPort } from '@salesforce/sankhya';
import { inArray } from 'drizzle-orm';
import type { Logger } from '../observability/logger.js';
import type { MirrorGateway } from '../sync/mirror-entities.js';
import { verifyConfigurationType } from './config-consistency.js';
import { verifyMirrorType } from './mirror-consistency.js';
import { verifyOrderTypes, type OrderConsistencyType } from './order-consistency.js';
import {
  CONSISTENCY_TYPES,
  isMirrorConsistencyType,
  type ConsistencyReport,
  type ConsistencyType,
  type ConsistencyTypeReport,
  type DifferenceKind,
  type TypeOutcome,
} from './types.js';

export interface ConsistencyVerifierDeps {
  readonly db: DbHandle;
  readonly gateway: MirrorGateway & Pick<SankhyaReadPort, 'readConfigurationFacts'>;
  /** Order read port; absent when the installation cannot read orders (those types report `not_configured`). */
  readonly orders?: { readonly gateway: Pick<SankhyaOrderReadPort, 'readOrderStageFacts' | 'readOrderReleaseFacts' | 'findOrderByOrigin'>; readonly originField?: string };
  readonly logger: Logger;
  readonly now?: () => Date;
  readonly readScope?: () => Promise<ReadScope>;
  /** Serializes Sankhya reads with the mirror's own (the worker passes the mirror's mutex). */
  readonly exclusive?: <T>(work: () => Promise<T>) => Promise<T>;
}

export interface ConsistencyRunOptions {
  readonly types?: readonly ConsistencyType[];
  readonly sampleLimit?: number;
  readonly signal?: AbortSignal;
}

/** Hard cap of difference log lines per type; the summary always carries the full counts. */
const LOG_LINE_CAP = 1000;
export const DEFAULT_SAMPLE_LIMIT = 50;

const passThrough = <T>(work: () => Promise<T>): Promise<T> => work();

/**
 * Orchestrates the per-type checks. Read-only toward Sankhya and the mirror; a failing type never stops the others.
 * Every difference is logged as `{type, kind, id}` (identifiers only), the report carries counts and capped samples.
 */
export class ConsistencyVerifier {
  constructor(private readonly deps: ConsistencyVerifierDeps) {}

  async run(options: ConsistencyRunOptions = {}): Promise<ConsistencyReport> {
    const { logger } = this.deps;
    const now = this.deps.now ?? (() => new Date());
    const startedAt = now();
    const sampleLimit = Math.max(0, options.sampleLimit ?? DEFAULT_SAMPLE_LIMIT);
    const requested = CONSISTENCY_TYPES.filter((type) => options.types === undefined || options.types.includes(type));
    const exclusive = this.deps.exclusive ?? passThrough;
    const syncTimes = await this.#lastSyncTimes();
    const reports: ConsistencyTypeReport[] = [];
    const orderTypes = requested.filter((t): t is OrderConsistencyType => t === 'orders' || t === 'orderStatus' || t === 'releases');
    let orderOutcomes: Record<OrderConsistencyType, TypeOutcome> | null = null;

    for (const type of requested) {
      const t0 = Date.now();
      let outcome: TypeOutcome;
      try {
        outcome = await this.#check(type, orderTypes, exclusive, options.signal, async () => {
          orderOutcomes ??= await this.#orders(orderTypes, exclusive, options.signal, now);
          return orderOutcomes;
        });
      } catch (error) {
        // Defensive: a check must classify its own failures; anything that escapes still never reports differences.
        outcome = { status: 'read_failed', sourceCount: null, mirrorCount: null, differences: { missing: [], extra: [], divergent: [] }, detail: 'verifier_error' };
        logger.warn({ type, err: error instanceof Error ? error.name : 'unknown' }, 'consistency check failed');
      }
      const report = this.#report(type, outcome, sampleLimit, Date.now() - t0, syncTimes.get(type) ?? null);
      this.#log(report, outcome);
      reports.push(report);
    }

    const totals = reports.reduce(
      (acc, r) => ({ missing: acc.missing + r.missing, extra: acc.extra + r.extra, divergent: acc.divergent + r.divergent }),
      { missing: 0, extra: 0, divergent: 0 },
    );
    const incomplete = reports.some((r) => r.status !== 'checked' && r.status !== 'not_configured');
    const result: ConsistencyReport = {
      startedAt: startedAt.toISOString(),
      finishedAt: now().toISOString(),
      gatewayMode: this.deps.gateway.describe().mode,
      sampleLimit,
      types: reports,
      totals,
      consistent: !incomplete && totals.missing + totals.extra + totals.divergent === 0,
      incomplete,
    };
    logger.info({ ...totals, incomplete, consistent: result.consistent, types: reports.length }, 'consistency check finished');
    return result;
  }

  async #check(
    type: ConsistencyType,
    orderTypes: readonly OrderConsistencyType[],
    exclusive: <T>(work: () => Promise<T>) => Promise<T>,
    signal: AbortSignal | undefined,
    orders: () => Promise<Record<OrderConsistencyType, TypeOutcome>>,
  ): Promise<TypeOutcome> {
    const { db, gateway, logger } = this.deps;
    if (isMirrorConsistencyType(type)) {
      return exclusive(() =>
        verifyMirrorType(
          {
            db,
            gateway,
            logger,
            ...(this.deps.readScope === undefined ? {} : { readScope: this.deps.readScope }),
            ...(signal === undefined ? {} : { signal }),
          },
          type,
        ),
      );
    }
    if (type === 'tops' || type === 'negotiationTypes' || type === 'configuration') {
      return exclusive(() => verifyConfigurationType({ db, gateway, ...(signal === undefined ? {} : { signal }) }, type));
    }
    void orderTypes;
    return (await orders())[type];
  }

  async #orders(
    types: readonly OrderConsistencyType[],
    exclusive: <T>(work: () => Promise<T>) => Promise<T>,
    signal: AbortSignal | undefined,
    now: () => Date,
  ): Promise<Record<OrderConsistencyType, TypeOutcome>> {
    const none: TypeOutcome = { status: 'not_configured', sourceCount: null, mirrorCount: null, differences: { missing: [], extra: [], divergent: [] }, detail: 'order_reads_unavailable' };
    const orders = this.deps.orders;
    if (orders === undefined) return { orders: none, orderStatus: none, releases: none };
    return exclusive(() =>
      verifyOrderTypes(
        {
          db: this.deps.db,
          gateway: orders.gateway,
          now,
          ...(orders.originField === undefined ? {} : { originField: orders.originField }),
          ...(signal === undefined ? {} : { signal }),
        },
        types,
      ),
    );
  }

  async #lastSyncTimes(): Promise<Map<string, string | null>> {
    const times = new Map<string, string | null>();
    try {
      const rows = await this.deps.db.db
        .select({ entity: syncState.entity, at: syncState.lastSuccessAt })
        .from(syncState)
        .where(inArray(syncState.entity, [...CONSISTENCY_TYPES]));
      for (const row of rows) times.set(row.entity, row.at === null ? null : row.at.toISOString());
    } catch {
      // Informational only; the comparison never depends on it.
    }
    return times;
  }

  #report(type: ConsistencyType, outcome: TypeOutcome, limit: number, durationMs: number, lastSync: string | null): ConsistencyTypeReport {
    const { missing, extra, divergent } = outcome.differences;
    return {
      type,
      status: outcome.status,
      sourceCount: outcome.sourceCount,
      mirrorCount: outcome.mirrorCount,
      missing: missing.length,
      extra: extra.length,
      divergent: divergent.length,
      samples: { missing: missing.slice(0, limit), extra: extra.slice(0, limit), divergent: divergent.slice(0, limit) },
      ...(outcome.excluded === undefined ? {} : { excluded: outcome.excluded }),
      ...(outcome.detail === undefined ? {} : { detail: outcome.detail }),
      lastSuccessfulSyncAt: lastSync,
      durationMs,
    };
  }

  #log(report: ConsistencyTypeReport, outcome: TypeOutcome): void {
    const { logger } = this.deps;
    const kinds: DifferenceKind[] = ['missing', 'extra', 'divergent'];
    let lines = 0;
    for (const kind of kinds) {
      for (const id of outcome.differences[kind]) {
        if (lines >= LOG_LINE_CAP) break;
        logger.warn({ type: report.type, kind, id }, 'consistency difference');
        lines += 1;
      }
    }
    const total = report.missing + report.extra + report.divergent;
    if (total > lines) logger.warn({ type: report.type, logged: lines, total }, 'consistency differences truncated in the log');
    const level = report.status === 'checked' || report.status === 'not_configured' ? 'info' : 'warn';
    logger[level](
      {
        type: report.type,
        status: report.status,
        detail: report.detail,
        sourceCount: report.sourceCount,
        mirrorCount: report.mirrorCount,
        missing: report.missing,
        extra: report.extra,
        divergent: report.divergent,
      },
      'consistency type summary',
    );
  }
}
