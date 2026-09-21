import { Module, type DynamicModule } from '@nestjs/common';
import { ConfigurationModule } from '../configuration/configuration.module.js';
import { InfrastructureModule, type InfrastructureDeps } from '../platform/infrastructure.module.js';
import { PlatformModule } from '../platform/platform.module.js';

/**
 * Root module of the API process. It registers HTTP-facing modules only: no queue, no gateway, no
 * Sankhya setting (STACK-2/STACK-3). Feature modules of later stages are added here.
 */
@Module({})
export class ApiModule {
  static register(deps: InfrastructureDeps): DynamicModule {
    return {
      module: ApiModule,
      imports: [InfrastructureModule.register(deps), PlatformModule, ConfigurationModule],
    };
  }
}
