import { Inject, Injectable } from '@nestjs/common';
import type { GatewayMode, IntegrationSummary } from '@salesforce/contracts';
import { syncState, type Database } from '@salesforce/db';
import { CLOCK, DATABASE, type Clock } from './tokens.js';
import {
  HEARTBEAT_STALE_AFTER_MS,
  isReservedSyncEntity,
  WORKER_HEARTBEAT_ENTITY,
  WorkerHeartbeatCursorSchema,
} from './worker-heartbeat.js';

type SyncStateRow = typeof syncState.$inferSelect;

/**
 * Reported when the mode is unknown (no valid heartbeat yet, or the database is unreachable): never
 * presented as `fake`, which would claim a synthetic data source nobody confirmed.
 */
export const UNKNOWN_GATEWAY_MODE: GatewayMode = 'unknown';

/**
 * Integration state for the UI pill and `/ready`, from `sync_state` alone (the API never asks the
 * ERP). Pure: the clock is a parameter.
 *
 * - no worker heartbeat yet: `not_configured`
 * - heartbeat older than `HEARTBEAT_STALE_AFTER_MS`, or any mirror entity `failed`: `degraded`
 * - otherwise `ok`
 */
export function summarizeIntegration(rows: readonly SyncStateRow[], now: Date): IntegrationSummary {
  const heartbeat = rows.find((row) => row.entity === WORKER_HEARTBEAT_ENTITY);
  const entities = rows.filter((row) => !isReservedSyncEntity(row.entity));

  const failingEntities = entities
    .filter((row) => row.status === 'failed')
    .map((row) => row.entity)
    .sort();
  const successTimes = entities
    .map((row) => row.lastSuccessAt)
    .filter((value): value is Date => value !== null);
  const lastSuccessAt =
    successTimes.length > 0
      ? new Date(Math.max(...successTimes.map((value) => value.getTime()))).toISOString()
      : null;

  const cursor = WorkerHeartbeatCursorSchema.safeParse(heartbeat?.cursor);
  const gatewayMode = cursor.success ? cursor.data.gatewayMode : UNKNOWN_GATEWAY_MODE;
  const common = { gatewayMode, lastSuccessAt, failingEntities };

  if (heartbeat === undefined || heartbeat.lastSuccessAt === null) {
    return {
      ...common,
      state: 'not_configured',
      message: 'O processador de integração (worker) ainda não reportou atividade.',
    };
  }
  const silentForMs = now.getTime() - heartbeat.lastSuccessAt.getTime();
  if (silentForMs > HEARTBEAT_STALE_AFTER_MS) {
    const minutes = Math.floor(silentForMs / 60_000);
    return {
      ...common,
      state: 'degraded',
      message: `O processador de integração (worker) não envia sinal há ${minutes} minutos.`,
    };
  }
  if (failingEntities.length > 0) {
    return {
      ...common,
      state: 'degraded',
      message: `Falha na sincronização de: ${failingEntities.join(', ')}.`,
    };
  }
  return { ...common, state: 'ok', message: null };
}

@Injectable()
export class IntegrationSummaryService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async summarize(): Promise<IntegrationSummary> {
    const rows = await this.db.select().from(syncState);
    return summarizeIntegration(rows, this.clock());
  }
}
