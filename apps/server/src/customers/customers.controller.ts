import { Controller, Inject } from '@nestjs/common';
import { API_BASE_PATH, routes, type CustomerDetail, type CustomersResponse } from '@salesforce/contracts';
import { ApiRoute, Contract, type RequestContract } from '../http/route.js';
import { CurrentUserParam, type CurrentUser } from '../iam/current-user.js';
import { CustomersService } from './customers.service.js';

@Controller(API_BASE_PATH)
export class CustomersController {
  constructor(@Inject(CustomersService) private readonly customers: CustomersService) {}

  @ApiRoute(routes.listCustomers)
  list(
    @CurrentUserParam() user: CurrentUser,
    @Contract() contract: RequestContract<typeof routes.listCustomers>,
  ): Promise<CustomersResponse> {
    return this.customers.list(user, contract.query);
  }

  @ApiRoute(routes.getCustomer)
  get(
    @CurrentUserParam() user: CurrentUser,
    @Contract() contract: RequestContract<typeof routes.getCustomer>,
  ): Promise<CustomerDetail> {
    return this.customers.get(user, contract.params.code);
  }
}
