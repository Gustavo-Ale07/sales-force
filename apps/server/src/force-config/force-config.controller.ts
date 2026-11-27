import { Controller, Inject } from '@nestjs/common';
import { API_BASE_PATH, routes, type ForceSettings, type SellerDiscountRuleRecord, type SellerDiscountRulesResponse } from '@salesforce/contracts';
import { ApiRoute, Contract, type RequestContract } from '../http/route.js';
import { CurrentUserParam, type CurrentUser } from '../iam/current-user.js';
import { ForceConfigService } from './force-config.service.js';

/** Force configuration and per-seller discount rules. Thin: the central policy (admin, manager) decided who may call. */
@Controller(API_BASE_PATH)
export class ForceConfigController {
  constructor(@Inject(ForceConfigService) private readonly service: ForceConfigService) {}

  @ApiRoute(routes.getForceSettings)
  settings(): Promise<ForceSettings> {
    return this.service.getSettings();
  }

  @ApiRoute(routes.updateForceSettings)
  saveSettings(@CurrentUserParam() user: CurrentUser, @Contract() contract: RequestContract<typeof routes.updateForceSettings>): Promise<ForceSettings> {
    return this.service.saveSettings(user, contract.body);
  }

  @ApiRoute(routes.listSellerDiscountRules)
  list(@Contract() contract: RequestContract<typeof routes.listSellerDiscountRules>): Promise<SellerDiscountRulesResponse> {
    return this.service.listRules(contract.query.sellerCode);
  }

  @ApiRoute(routes.createSellerDiscountRule)
  create(@CurrentUserParam() user: CurrentUser, @Contract() contract: RequestContract<typeof routes.createSellerDiscountRule>): Promise<SellerDiscountRuleRecord> {
    return this.service.createRule(user, contract.body);
  }

  @ApiRoute(routes.updateSellerDiscountRule)
  update(@CurrentUserParam() user: CurrentUser, @Contract() contract: RequestContract<typeof routes.updateSellerDiscountRule>): Promise<SellerDiscountRuleRecord> {
    return this.service.updateRule(user, contract.params.id, contract.body);
  }

  @ApiRoute(routes.deleteSellerDiscountRule)
  async remove(@CurrentUserParam() user: CurrentUser, @Contract() contract: RequestContract<typeof routes.deleteSellerDiscountRule>): Promise<void> {
    await this.service.deleteRule(user, contract.params.id);
  }
}
