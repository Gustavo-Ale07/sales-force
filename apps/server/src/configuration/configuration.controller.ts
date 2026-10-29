import { Controller, Inject } from '@nestjs/common';
import {
  API_BASE_PATH,
  routes,
  type ConfigurationResponse,
  type DatasetIdentity,
  type DiscountLimitsResponse,
  type OrderEntryConfiguration,
} from '@salesforce/contracts';
import { syncState, type Database } from '@salesforce/db';
import { ApiRoute, Contract, type RequestContract } from '../http/route.js';
import { CurrentUserParam, type CurrentUser } from '../iam/current-user.js';
import { CLOCK, DATABASE, DATASET_IDENTITY, type Clock } from '../platform/tokens.js';
import { buildConfigurationResponse, toOrderEntryConfiguration } from './configuration-summary.js';
import { InstallationConfigurationService } from './configuration.service.js';
import { DiscountLimitsService } from './discount-limits.service.js';

/**
 * `GET /configuration`: admin and technical (central policy, `getConfiguration`; ROLE-1); the access guard has
 * already authenticated and authorized the caller. When nothing is stored the response carries the
 * conservative disabled configuration and `contentHash: null` (never an invented default).
 *
 * `GET /order-entry/configuration`: open to every role that can create an order (central policy,
 * `getOrderEntryConfiguration`). Narrower payload than `/configuration` on purpose — only what the
 * "Novo pedido" screen reads, never syncStates/gateway/integration/customers/pricing/financial.
 */
@Controller(API_BASE_PATH)
export class ConfigurationController {
  constructor(
    @Inject(InstallationConfigurationService) private readonly configuration: InstallationConfigurationService,
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(DATASET_IDENTITY) private readonly dataset: DatasetIdentity | null,
    @Inject(DiscountLimitsService) private readonly discountLimits: DiscountLimitsService,
  ) {}

  @ApiRoute(routes.getConfiguration)
  async get(): Promise<ConfigurationResponse> {
    const [current, rows] = await Promise.all([this.configuration.current(), this.db.select().from(syncState)]);
    return buildConfigurationResponse(current, rows, this.clock());
  }

  /** W-39: admin only (central policy). */
  @ApiRoute(routes.getDiscountLimits)
  getDiscountLimits(): Promise<DiscountLimitsResponse> {
    return this.discountLimits.get();
  }

  @ApiRoute(routes.updateDiscountLimits)
  updateDiscountLimits(
    @CurrentUserParam() user: CurrentUser,
    @Contract() contract: RequestContract<typeof routes.updateDiscountLimits>,
  ): Promise<DiscountLimitsResponse> {
    return this.discountLimits.update(user, contract.body);
  }

  @ApiRoute(routes.getOrderEntryConfiguration)
  async getOrderEntry(): Promise<OrderEntryConfiguration> {
    const current = await this.configuration.current();
    return toOrderEntryConfiguration(current.configuration, this.dataset);
  }
}
