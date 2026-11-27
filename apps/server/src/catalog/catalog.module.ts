import { Module } from '@nestjs/common';
import { CustomersModule } from '../customers/customers.module.js';
import { MirrorModule } from '../mirror/mirror.module.js';
import { CatalogController } from './catalog.controller.js';
import { CatalogService } from './catalog.service.js';
import { ProductImageService } from './product-image.service.js';
import { PricingService } from './pricing.service.js';
import { ForceConfigRepository } from '../force-config/force-config.repository.js';

@Module({
  imports: [MirrorModule, CustomersModule],
  controllers: [CatalogController],
  providers: [CatalogService, PricingService, ProductImageService, ForceConfigRepository],
  exports: [CatalogService, PricingService, ProductImageService],
})
export class CatalogModule {}
