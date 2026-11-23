import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module.js';
import { ConfigurationModule } from '../configuration/configuration.module.js';
import { CustomersModule } from '../customers/customers.module.js';
import { MirrorModule } from '../mirror/mirror.module.js';
import { ApprovalsController } from './approvals.controller.js';
import { ApprovalsRepository } from './approvals.repository.js';
import { ApprovalsService } from './approvals.service.js';
import { DraftBuilder } from './draft-builder.js';
import { OrdersController } from './orders.controller.js';
import { ReleaseQueueController } from './release-queue.controller.js';
import { ReleaseQueueRepository } from './release-queue.repository.js';
import { ReleaseQueueService } from './release-queue.service.js';
import { OrdersRepository } from './orders.repository.js';
import { OrdersService } from './orders.service.js';

/**
 * Draft orders. Registered in the API process only: no queue, no outbox, no gateway. ERP submission
 * is disabled (SNK-4, SNK-6), so this module never enqueues a Sankhya write.
 */
@Module({
  imports: [MirrorModule, CustomersModule, CatalogModule, ConfigurationModule],
  controllers: [OrdersController, ApprovalsController, ReleaseQueueController],
  providers: [OrdersRepository, OrdersService, DraftBuilder, ApprovalsRepository, ApprovalsService, ReleaseQueueRepository, ReleaseQueueService],
  exports: [OrdersService, DraftBuilder],
})
export class OrdersModule {}
