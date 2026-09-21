import { Inject, Injectable } from '@nestjs/common';
import type { InstallationConfiguration } from '@salesforce/domain';
import { AppError } from '../http/app-error.js';
import type { Logger } from '../observability/logger.js';
import { LOGGER } from '../platform/tokens.js';
import { InstallationConfigurationRepository } from './configuration.repository.js';
import { validateInstallationConfiguration } from './validate.js';

export interface EnabledConfiguration {
  /** Id of the stored snapshot (`installation_configuration_version.id`), for audit and order provenance. */
  readonly versionId: string;
  readonly configuration: InstallationConfiguration;
}

/**
 * Reads the current configuration snapshot together with its version id in a single query, so a
 * business write can record exactly the snapshot whose rules it applied (sales_order.config_version_id,
 * CFG-1). Same "enabled" rule as `InstallationConfigurationService.requireEnabled`.
 */
@Injectable()
export class ConfigurationVersionService {
  constructor(
    @Inject(InstallationConfigurationRepository) private readonly repository: InstallationConfigurationRepository,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  async requireEnabled(): Promise<EnabledConfiguration> {
    const row = await this.repository.findCurrent();
    if (row === null) throw new AppError('installation_not_enabled');
    const result = validateInstallationConfiguration(row.payload);
    if (!result.ok) {
      // Field paths and rule codes only, never values.
      this.logger.error({ issues: result.issues.slice(0, 20) }, 'stored installation configuration is invalid');
      throw new AppError('internal_error');
    }
    if (!result.value.general.enabled) throw new AppError('installation_not_enabled');
    return { versionId: row.id, configuration: result.value };
  }
}
