import { Inject, Injectable } from '@nestjs/common';
import type { ConfigurationSourceKind, InstallationConfiguration } from '@salesforce/domain';
import { defaultUnconfiguredConfiguration } from '@salesforce/domain';
import type { ConfigurationSource } from '@salesforce/sankhya';
import { AppError } from '../http/app-error.js';
import type { Logger } from '../observability/logger.js';
import { LOGGER } from '../platform/tokens.js';
import { configurationContentHash } from './configuration-hash.js';
import { type InstallationConfigurationRepository } from './configuration.repository.js';
import { validateInstallationConfiguration } from './validate.js';

export const CONFIGURATION_SOURCE = Symbol('CONFIGURATION_SOURCE');

/** Nothing has been stored yet: the installation has no configuration snapshot. */
export class ConfigurationNotStoredError extends Error {
  constructor() {
    super('No installation configuration snapshot has been stored yet.');
    this.name = 'ConfigurationNotStoredError';
  }
}

/** A stored payload no longer satisfies the current schema (schema drift or manual edit). */
export class StoredConfigurationInvalidError extends Error {
  readonly issues: readonly string[];
  constructor(issues: readonly string[]) {
    super('The stored installation configuration snapshot is invalid.');
    this.name = 'StoredConfigurationInvalidError';
    this.issues = issues;
  }
}

/**
 * `ConfigurationSource` over the local mirror (`installation_configuration_version`). The snapshot is
 * written by the worker / seed from the governing source (Sankhya once its model exists, U-10; the
 * bootstrap file until then, U-11); the API only ever reads this local copy. `kind` reports where
 * the last snapshot read came from, `sankhya` (the governing source, CFG-1) before the first read.
 */
export class DatabaseConfigurationSource implements ConfigurationSource {
  #kind: ConfigurationSourceKind = 'sankhya';

  constructor(private readonly repository: InstallationConfigurationRepository) {}

  get kind(): ConfigurationSourceKind {
    return this.#kind;
  }

  async read(): Promise<InstallationConfiguration> {
    const row = await this.repository.findCurrent();
    if (row === null) throw new ConfigurationNotStoredError();
    const result = validateInstallationConfiguration(row.payload);
    if (!result.ok) throw new StoredConfigurationInvalidError(result.issues);
    this.#kind = result.value.source.kind;
    return result.value;
  }
}

export type CurrentConfiguration =
  | {
      readonly state: 'configured';
      readonly configuration: InstallationConfiguration;
      readonly contentHash: string;
    }
  | {
      readonly state: 'not_configured';
      /** The conservative disabled configuration of the domain (nothing sellable, nothing enabled). */
      readonly configuration: InstallationConfiguration;
      readonly contentHash: null;
    };

/**
 * Application service over the installation configuration (CFG-1...6). It returns the stored
 * snapshot, or the domain's conservative "unconfigured" state when nothing is stored: no invented
 * defaults (a disabled installation, nothing sellable). Consumers that need a working installation
 * call `requireEnabled()` and get `installation_not_enabled` otherwise.
 *
 * Exposed as `GET /configuration` (session, admin grant in the policy table) by `ConfigurationController`.
 */
@Injectable()
export class InstallationConfigurationService {
  constructor(
    @Inject(CONFIGURATION_SOURCE) private readonly source: ConfigurationSource,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  async current(): Promise<CurrentConfiguration> {
    try {
      const configuration = await this.source.read();
      return { state: 'configured', configuration, contentHash: configurationContentHash(configuration) };
    } catch (error) {
      if (error instanceof ConfigurationNotStoredError) {
        return { state: 'not_configured', configuration: defaultUnconfiguredConfiguration(), contentHash: null };
      }
      if (error instanceof StoredConfigurationInvalidError) {
        // Field paths and rule codes only, never values.
        this.logger.error({ issues: error.issues.slice(0, 20) }, 'stored installation configuration is invalid');
        throw new AppError('internal_error', { cause: error });
      }
      throw error;
    }
  }

  /** The stored configuration, provided the installation exists and is enabled. */
  async requireEnabled(): Promise<InstallationConfiguration> {
    const current = await this.current();
    if (current.state === 'not_configured' || !current.configuration.general.enabled) {
      throw new AppError('installation_not_enabled');
    }
    return current.configuration;
  }
}
