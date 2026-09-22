import { Module, type DynamicModule } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module.js';
import { ConfigurationModule } from '../configuration/configuration.module.js';
import { CustomersModule } from '../customers/customers.module.js';
import { DashboardModule } from '../dashboard/dashboard.module.js';
import { OrdersModule } from '../orders/orders.module.js';
import { SellersModule } from '../sellers/sellers.module.js';
import { TemplatesModule } from '../templates/templates.module.js';
import type { AuthConfig } from '../iam/auth-config.js';
import { IamModule } from '../iam/iam.module.js';
import { InfrastructureModule, type InfrastructureDeps } from '../platform/infrastructure.module.js';
import { PlatformModule } from '../platform/platform.module.js';

/**
 * Root module of the API process. It registers HTTP-facing modules only: no queue, no gateway, no
 * Sankhya setting (STACK-2/STACK-3). Feature modules of later stages are added here.
 */
@Module({})
export class ApiModule {
  static register(deps: InfrastructureDeps, auth: AuthConfig): DynamicModule {
    return {
      module: ApiModule,
      imports: [
        InfrastructureModule.register(deps),
        PlatformModule,
        ConfigurationModule,
        IamModule.register(auth),
        SellersModule,
        CustomersModule,
        CatalogModule,
        OrdersModule,
        TemplatesModule,
        DashboardModule,
      ],
    };
  }
}
