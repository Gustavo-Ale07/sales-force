import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module.js';
import { MirrorModule } from '../mirror/mirror.module.js';
import { OrdersModule } from '../orders/orders.module.js';
import { DashboardController } from './dashboard.controller.js';
import { DashboardService } from './dashboard.service.js';

@Module({
  imports: [MirrorModule, CatalogModule, OrdersModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
