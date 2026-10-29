import { Module } from '@nestjs/common';
import {
  CONFIGURATION_SOURCE,
  DatabaseConfigurationSource,
  InstallationConfigurationService,
} from './configuration.service.js';
import { ConfigurationVersionService } from './configuration-version.service.js';
import { ConfigurationController } from './configuration.controller.js';
import { InstallationConfigurationRepository } from './configuration.repository.js';
import { DiscountLimitsService } from './discount-limits.service.js';

/** Installation configuration (CFG-1...6): the local mirror of the governed configuration. */
@Module({
  controllers: [ConfigurationController],
  providers: [
    InstallationConfigurationRepository,
    {
      provide: CONFIGURATION_SOURCE,
      useFactory: (repository: InstallationConfigurationRepository) => new DatabaseConfigurationSource(repository),
      inject: [InstallationConfigurationRepository],
    },
    InstallationConfigurationService,
    ConfigurationVersionService,
    DiscountLimitsService,
  ],
  exports: [InstallationConfigurationService, ConfigurationVersionService],
})
export class ConfigurationModule {}
