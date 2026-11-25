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
import { EVENT_STREAM_ENABLED, EVENT_STREAM_LIMITS, type EventStreamLimits } from '../events/events.tokens.js';
import type { ObjectStore } from '../media/object-store.js';
import {
  ACCOUNT_PHOTO_STORE,
  CLOCK,
  DATASET_IDENTITY,
  DATABASE,
  DATABASE_HANDLE,
  LOGGER,
  CUSTOMER_CONFIRM_WAIT,
  CUSTOMER_EDIT_ENABLED,
  CUSTOMER_ENQUEUE_ENABLED,
  PROFILE_PHOTO_ERP_WRITE_ENABLED,
  ORDER_ENQUEUE_ENABLED,
  type CustomerConfirmWait,
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
  /** API only: object store for profile photos (default none: the photo routes answer 503). */
  readonly accountPhotoStore?: ObjectStore;
  /** API only: queue submitted orders for the ERP (default false = submission stays disabled, SNK-6). */
  readonly orderEnqueueEnabled?: boolean;
  /** API only: accept customer creations (default false). The worker has its own flag. */
  readonly customerEnqueueEnabled?: boolean;
  /** API only: open the customer edit route (default false; the edit delivery is not approved, so it still refuses). */
  readonly customerEditEnabled?: boolean;
  /** API only: queue the profile photo write to the ERP (default false; the worker has its own validation of the same flag). */
  readonly profilePhotoErpWriteEnabled?: boolean;
  /** API only (RT-1): open the dedicated LISTEN connection and serve GET /sync/events (default false: the route answers 503). */
  readonly eventStreamEnabled?: boolean;
  readonly eventStreamLimits?: Partial<EventStreamLimits>;
  /** API only: how long a creation waits for the worker (default 15 s; tests shorten it). */
  readonly customerConfirmWait?: Partial<CustomerConfirmWait>;
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
      { provide: ORDER_ENQUEUE_ENABLED, useValue: deps.orderEnqueueEnabled ?? false },
      { provide: CUSTOMER_ENQUEUE_ENABLED, useValue: deps.customerEnqueueEnabled ?? false },
      { provide: CUSTOMER_EDIT_ENABLED, useValue: deps.customerEditEnabled ?? false },
      { provide: PROFILE_PHOTO_ERP_WRITE_ENABLED, useValue: deps.profilePhotoErpWriteEnabled ?? false },
      {
        provide: CUSTOMER_CONFIRM_WAIT,
        useValue: {
          timeoutMs: 8_000,
          pollMs: 500,
          sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
          ...deps.customerConfirmWait,
        } satisfies CustomerConfirmWait,
      },
      { provide: EVENT_STREAM_ENABLED, useValue: deps.eventStreamEnabled ?? false },
      { provide: EVENT_STREAM_LIMITS, useValue: { perAccount: 5, total: 200, ...deps.eventStreamLimits } satisfies EventStreamLimits },
      { provide: ACCOUNT_PHOTO_STORE, useValue: deps.accountPhotoStore ?? null },
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
