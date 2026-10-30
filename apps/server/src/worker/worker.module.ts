import { Module, type DynamicModule } from '@nestjs/common';
import type { DbHandle } from '@salesforce/db';
import type { Logger } from '../observability/logger.js';
import { InfrastructureModule, type InfrastructureDeps } from '../platform/infrastructure.module.js';
import { CLOCK, DATABASE_HANDLE, LOGGER, type Clock } from '../platform/tokens.js';
import { loadCurrentReadScope } from '../sync/mirror-scope.js';
import { MirrorSyncService } from '../sync/mirror-sync.service.js';
import type { MirrorGateway } from '../sync/mirror-entities.js';
import type { MirrorEntity } from '../sync/mirror-entities.js';
import type { MirrorSchedules } from '../sync/schedules.js';
import { ProductMediaSyncService, type MediaGateway, type ProductMediaSettings } from '../media/product-media-sync.service.js';
import type { ObjectStore } from '../media/object-store.js';
import { SharpThumbnailRenderer, type ThumbnailRenderer } from '../media/thumbnail-renderer.js';
import { AuditService } from '../iam/audit.service.js';
import {
  OrderDeliveryService,
  type OrderDeliveryGateway,
  type OrderDeliverySettings,
} from '../integration/order-delivery.service.js';
import { OrderErpStatusService } from '../integration/order-erp-status.service.js';
import { WorkerRuntime, type WorkerRuntimeOptions } from './runtime.js';

/** Product photo synchronization wiring; passed only when PRODUCT_MEDIA_SYNC_ENABLED=true. */
export interface ProductMediaWiring {
  readonly gateway: MediaGateway;
  readonly store: ObjectStore;
  readonly settings: ProductMediaSettings;
  readonly cron: string;
  /** Thumbnail renderer; absent = sharp (tests inject their own). */
  readonly renderer?: ThumbnailRenderer;
}

/** ERP order delivery wiring (SNK-7); passed only when the order-write switch is on. */
export interface OrderDeliveryWiring {
  readonly gateway: OrderDeliveryGateway;
  readonly settings: OrderDeliverySettings;
}

/**
 * Root module of the Worker process (standalone application context, no HTTP). It registers the job
 * runtime. The gateway is created by the entry point from the worker-only environment and handed in
 * as `mirror.gateway`; only the mirror sync service (read port) receives it.
 */
@Module({})
export class WorkerModule {
  static register(
    deps: InfrastructureDeps,
    options: WorkerRuntimeOptions,
    mirror?: { readonly gateway: MirrorGateway; readonly schedules: MirrorSchedules; readonly startupSync?: readonly MirrorEntity[] },
    media?: ProductMediaWiring,
    orderDelivery?: OrderDeliveryWiring,
  ): DynamicModule {
    return {
      module: WorkerModule,
      imports: [InfrastructureModule.register(deps)],
      providers: [
        {
          provide: WorkerRuntime,
          useFactory: (logger: Logger, db: DbHandle, now: Clock) =>
            new WorkerRuntime({
              logger,
              db,
              now,
              options,
              ...(mirror === undefined
                ? {}
                : { mirror: { service: new MirrorSyncService({ db, gateway: mirror.gateway, logger, now, readScope: () => loadCurrentReadScope(db.db) }), schedules: mirror.schedules, ...(mirror.startupSync === undefined ? {} : { startupSync: mirror.startupSync }) } }),
              ...(media === undefined
                ? {}
                : {
                    media: {
                      cron: media.cron,
                      service: new ProductMediaSyncService({
                        db,
                        gateway: media.gateway,
                        store: media.store,
                        renderer: media.renderer ?? new SharpThumbnailRenderer(),
                        logger,
                        now,
                        settings: media.settings,
                        readScope: () => loadCurrentReadScope(db.db),
                      }),
                    },
                  }),
              ...(orderDelivery === undefined
                ? {}
                : {
                    orderDelivery: {
                      status: new OrderErpStatusService({ db, gateway: orderDelivery.gateway, logger, now }),
                      service: new OrderDeliveryService({
                        db,
                        gateway: orderDelivery.gateway,
                        settings: orderDelivery.settings,
                        audit: new AuditService(db.db, now),
                        logger,
                        now,
                      }),
                    },
                  }),
            }),
          inject: [LOGGER, DATABASE_HANDLE, CLOCK],
        },
      ],
      exports: [WorkerRuntime],
    };
  }
}
