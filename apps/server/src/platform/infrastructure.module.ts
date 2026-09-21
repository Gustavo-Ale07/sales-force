import { Global, Module, type DynamicModule } from '@nestjs/common';
import type { DbHandle } from '@salesforce/db';
import type { Logger } from '../observability/logger.js';
import {
  CLOCK,
  DATABASE,
  DATABASE_HANDLE,
  LOGGER,
  READINESS_CACHE_TTL_MS,
  systemClock,
  type Clock,
} from './tokens.js';

export interface InfrastructureDeps {
  readonly logger: Logger;
  readonly db: DbHandle;
  readonly clock?: Clock;
  /** `/ready` cache window (default 0 = every call checks; the API entry point sets a few seconds). */
  readonly readinessCacheTtlMs?: number;
}

/**
 * Process-level dependencies (logger, database, clock) shared by every module of a process. The
 * process entry point builds them (after validating its environment) and hands them in, so no module
 * reads `process.env` and both processes register only what they need (STACK-2).
 */
@Global()
@Module({})
export class InfrastructureModule {
  static register(deps: InfrastructureDeps): DynamicModule {
    const providers = [
      { provide: LOGGER, useValue: deps.logger },
      { provide: DATABASE_HANDLE, useValue: deps.db },
      { provide: DATABASE, useValue: deps.db.db },
      { provide: CLOCK, useValue: deps.clock ?? systemClock },
      { provide: READINESS_CACHE_TTL_MS, useValue: deps.readinessCacheTtlMs ?? 0 },
    ];
    return {
      module: InfrastructureModule,
      global: true,
      providers,
      exports: providers.map((provider) => provider.provide),
    };
  }
}
