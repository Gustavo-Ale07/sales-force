import { Module } from '@nestjs/common';
import { CustomersModule } from '../customers/customers.module.js';
import { MirrorModule } from '../mirror/mirror.module.js';
import { CatalogController } from './catalog.controller.js';
import { CatalogService } from './catalog.service.js';
import { PricingService } from './pricing.service.js';

@Module({
  imports: [MirrorModule, CustomersModule],
  controllers: [CatalogController],
  providers: [CatalogService, PricingService],
  exports: [PricingService],
})
export class CatalogModule {}
