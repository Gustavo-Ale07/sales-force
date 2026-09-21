import { Module, type DynamicModule } from '@nestjs/common';
import type { DbHandle } from '@salesforce/db';
import type { Logger } from '../observability/logger.js';
import { InfrastructureModule, type InfrastructureDeps } from '../platform/infrastructure.module.js';
import { CLOCK, DATABASE_HANDLE, LOGGER, type Clock } from '../platform/tokens.js';
import { WorkerRuntime, type WorkerRuntimeOptions } from './runtime.js';

/**
 * Root module of the Worker process (standalone application context, no HTTP). It registers the job
 * runtime only; the gateway is created by the entry point from the worker-only environment and is
 * not a provider yet because no Stage 1a job talks to Sankhya.
 */
@Module({})
export class WorkerModule {
  static register(deps: InfrastructureDeps, options: WorkerRuntimeOptions): DynamicModule {
    return {
      module: WorkerModule,
      imports: [InfrastructureModule.register(deps)],
      providers: [
        {
          provide: WorkerRuntime,
          useFactory: (logger: Logger, db: DbHandle, now: Clock) => new WorkerRuntime({ logger, db, now, options }),
          inject: [LOGGER, DATABASE_HANDLE, CLOCK],
        },
      ],
      exports: [WorkerRuntime],
    };
  }
}
