import { Controller, Inject } from '@nestjs/common';
import { API_BASE_PATH, routes, type MyDiscountLimitsResponse } from '@salesforce/contracts';
import { ApiRoute } from '../http/route.js';
import { CurrentUserParam, type CurrentUser } from '../iam/current-user.js';
import { SellerDiscountLimitsService } from './seller-discount-limits.service.js';

/** W-39 per-seller limits. Roles come from the central policy; the seller scope is applied in the service. */
@Controller(API_BASE_PATH)
export class SellerDiscountLimitsController {
  constructor(@Inject(SellerDiscountLimitsService) private readonly service: SellerDiscountLimitsService) {}

  @ApiRoute(routes.getMyDiscountLimits)
  mine(@CurrentUserParam() user: CurrentUser): Promise<MyDiscountLimitsResponse> {
    return this.service.mine(user);
  }
}
