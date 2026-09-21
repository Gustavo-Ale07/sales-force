import { Controller, Inject } from '@nestjs/common';
import { API_BASE_PATH, routes, type ConfigurationResponse } from '@salesforce/contracts';
import { syncState, type Database } from '@salesforce/db';
import { ApiRoute } from '../http/route.js';
import { CLOCK, DATABASE, type Clock } from '../platform/tokens.js';
import { buildConfigurationResponse } from './configuration-summary.js';
import { InstallationConfigurationService } from './configuration.service.js';

/**
 * `GET /configuration`: admin only (central policy, `getConfiguration`); the access guard has
 * already authenticated and authorized the caller. When nothing is stored the response carries the
 * conservative disabled configuration and `contentHash: null` (never an invented default).
 */
@Controller(API_BASE_PATH)
export class ConfigurationController {
  constructor(
    @Inject(InstallationConfigurationService) private readonly configuration: InstallationConfigurationService,
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  @ApiRoute(routes.getConfiguration)
  async get(): Promise<ConfigurationResponse> {
    const [current, rows] = await Promise.all([this.configuration.current(), this.db.select().from(syncState)]);
    return buildConfigurationResponse(current, rows, this.clock());
  }
}
