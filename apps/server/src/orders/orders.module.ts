import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module.js';
import { CustomersModule } from '../customers/customers.module.js';
import { MirrorModule } from '../mirror/mirror.module.js';
import { DraftBuilder } from './draft-builder.js';
import { OrdersController } from './orders.controller.js';
import { OrdersRepository } from './orders.repository.js';
import { OrdersService } from './orders.service.js';

/**
 * Draft orders. Registered in the API process only: no queue, no outbox, no gateway. ERP submission
 * is disabled (SNK-4, SNK-6), so this module never enqueues a Sankhya write.
 */
@Module({
  imports: [MirrorModule, CustomersModule, CatalogModule],
  controllers: [OrdersController],
  providers: [OrdersRepository, OrdersService, DraftBuilder],
  exports: [OrdersService, DraftBuilder],
})
export class OrdersModule {}
