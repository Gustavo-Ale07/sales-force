import { Inject, Injectable } from '@nestjs/common';
import type { IntegrationSummary, ReadyResponse } from '@salesforce/contracts';
import { readiness, type DbHandle, type MigrationLevel } from '@salesforce/db';
import type { Logger } from '../observability/logger.js';
import { IntegrationSummaryService, UNKNOWN_GATEWAY_MODE } from './integration-summary.js';
import { DATABASE_HANDLE, LOGGER } from './tokens.js';
import { withTimeout } from './with-timeout.js';

export const READINESS_DB_TIMEOUT_MS = 3000;

type MigrationsCheck = ReadyResponse['checks']['migrations'];

/**
 * Migration status for `/ready`.
 * - `ok`: every migration this build expects is applied and nothing more.
 * - `ahead`: the database has migrations this build does not know. This is the normal state after
 *   migrations ran for a release that is not active yet, or after a code rollback; expand-migrate-
 *   contract (P-16) keeps the previous version working, so the API stays ready.
 * - `behind`: at least one expected migration is missing: NOT ready (DATA-2: migrations run in the
 *   one-shot step before the new version is active, never at boot).
 * - `unknown`: this build cannot read its own migration journal: NOT ready (cannot verify).
 * `applied` / `expected` are migration counts rendered as strings.
 */
export function migrationsCheckFrom(level: MigrationLevel): MigrationsCheck {
  const applied = String(level.appliedCount);
  if (level.expectedCount === null) return { status: 'unknown', applied, expected: null };
  const expected = String(level.expectedCount);
  if (!level.upToDate) return { status: 'behind', applied, expected };
  return { status: level.appliedCount > level.expectedCount ? 'ahead' : 'ok', applied, expected };
}

export function readyStatusFrom(input: {
  database: 'ok' | 'fail';
  migrations: MigrationsCheck['status'];
  integration: IntegrationSummary['state'];
}): ReadyResponse['status'] {
  if (input.database === 'fail') return 'not_ready';
  if (input.migrations === 'behind' || input.migrations === 'unknown') return 'not_ready';
  // The integration is never a reason to report the API as down.
  return input.integration === 'ok' ? 'ready' : 'degraded';
}

@Injectable()
export class ReadinessService {
  constructor(
    @Inject(DATABASE_HANDLE) private readonly handle: DbHandle,
    @Inject(IntegrationSummaryService) private readonly integration: IntegrationSummaryService,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  async check(): Promise<ReadyResponse> {
    let level: MigrationLevel;
    try {
      level = await withTimeout(readiness(this.handle.pool), READINESS_DB_TIMEOUT_MS, 'readiness query');
    } catch (error) {
      this.logger.warn({ err: error }, 'readiness: database check failed');
      return {
        status: 'not_ready',
        checks: { database: 'fail', migrations: { status: 'unknown', applied: null, expected: null } },
        integration: {
          state: 'degraded',
          gatewayMode: UNKNOWN_GATEWAY_MODE,
          lastSuccessAt: null,
          failingEntities: [],
          message: 'Estado da integração indisponível: banco de dados inacessível.',
        },
      };
    }

    const migrations = migrationsCheckFrom(level);
    let integration: IntegrationSummary;
    try {
      integration = await withTimeout(this.integration.summarize(), READINESS_DB_TIMEOUT_MS, 'integration summary');
    } catch (error) {
      this.logger.warn({ err: error }, 'readiness: integration summary failed');
      integration = {
        state: 'degraded',
        gatewayMode: UNKNOWN_GATEWAY_MODE,
        lastSuccessAt: null,
        failingEntities: [],
        message: 'Não foi possível ler o estado da integração.',
      };
    }

    return {
      status: readyStatusFrom({
        database: 'ok',
        migrations: migrations.status,
        integration: integration.state,
      }),
      checks: { database: 'ok', migrations },
      integration,
    };
  }
}
