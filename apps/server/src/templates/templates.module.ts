import { Module } from '@nestjs/common';
import { CustomersModule } from '../customers/customers.module.js';
import { OrdersModule } from '../orders/orders.module.js';
import { TemplatesController } from './templates.controller.js';
import { TemplatesRepository } from './templates.repository.js';
import { TemplatesService } from './templates.service.js';

/**
 * Recurring order templates (Phase E). API process only. Using a template creates a draft through
 * `OrdersService`; no queue, no outbox, no gateway: ERP submission stays disabled.
 */
@Module({
  imports: [CustomersModule, OrdersModule],
  controllers: [TemplatesController],
  providers: [TemplatesRepository, TemplatesService],
})
export class TemplatesModule {}
