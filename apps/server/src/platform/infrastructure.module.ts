import { Global, Module, type DynamicModule } from '@nestjs/common';
import type { DatasetIdentity } from '@salesforce/contracts';
import type { DbHandle } from '@salesforce/db';
import {
  DEFAULT_PRODUCT_IMAGE_SETTINGS,
  NoImageSource,
  type ProductImageSettings,
  type ProductImageSource,
} from '../catalog/product-image.js';
import type { Logger } from '../observability/logger.js';
import {
  CLOCK,
  DATASET_IDENTITY,
  DATABASE,
  DATABASE_HANDLE,
  LOGGER,
  PRODUCT_IMAGE_SETTINGS,
  PRODUCT_IMAGE_SOURCE,
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
  /** Explicit dataset identity of the installation (default `null`: none declared). */
  readonly dataset?: DatasetIdentity | null;
  /** Product image source (default: `NoImageSource`, no product has an image). */
  readonly productImageSource?: ProductImageSource;
  readonly productImageSettings?: Partial<ProductImageSettings>;
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
      { provide: DATASET_IDENTITY, useValue: deps.dataset ?? null },
      { provide: PRODUCT_IMAGE_SOURCE, useValue: deps.productImageSource ?? new NoImageSource() },
      { provide: PRODUCT_IMAGE_SETTINGS, useValue: { ...DEFAULT_PRODUCT_IMAGE_SETTINGS, ...deps.productImageSettings } },
    ];
    return {
      module: InfrastructureModule,
      global: true,
      providers,
      exports: providers.map((provider) => provider.provide),
    };
  }
}
