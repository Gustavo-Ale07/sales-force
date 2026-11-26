import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module.js';
import { CustomersModule } from '../customers/customers.module.js';
import { OrdersModule } from '../orders/orders.module.js';
import { ExportsService } from './exports.service.js';
import { ImportsController } from './imports.controller.js';
import { ImportsService } from './imports.service.js';

/** Spreadsheet import and CSV/XLSX export. API process only; owns no tables (the import is stateless). */
@Module({
  imports: [CustomersModule, CatalogModule, OrdersModule],
  controllers: [ImportsController],
  providers: [ImportsService, ExportsService],
})
export class ImportsModule {}
