import { Controller, Inject } from '@nestjs/common';
import { API_BASE_PATH, routes, type SellersResponse } from '@salesforce/contracts';
import { ApiRoute, Contract, type RequestContract } from '../http/route.js';
import { CurrentUserParam, type CurrentUser } from '../iam/current-user.js';
import { SellersService } from './sellers.service.js';

@Controller(API_BASE_PATH)
export class SellersController {
  constructor(@Inject(SellersService) private readonly sellers: SellersService) {}

  @ApiRoute(routes.listSellers)
  list(
    @CurrentUserParam() user: CurrentUser,
    @Contract() contract: RequestContract<typeof routes.listSellers>,
  ): Promise<SellersResponse> {
    return this.sellers.list(user, contract.query);
  }
}
