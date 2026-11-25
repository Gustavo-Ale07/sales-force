import { Controller, Inject, Res } from '@nestjs/common';
import {
  API_BASE_PATH,
  routes,
  type CreateCustomerResponse,
  type CustomerDetail,
  type CustomerFinancial,
  type CustomerLettersResponse,
  type CustomersResponse,
  type UpdateCustomerResponse,
} from '@salesforce/contracts';
import type { FastifyReply } from 'fastify';
import { ApiRoute, Contract, type RequestContract } from '../http/route.js';
import { CurrentUserParam, type CurrentUser } from '../iam/current-user.js';
import { CustomerRegistrationService } from './customer-registration.service.js';
import { CustomerUpdateService } from './customer-update.service.js';
import { CustomersService } from './customers.service.js';

@Controller(API_BASE_PATH)
export class CustomersController {
  constructor(
    @Inject(CustomersService) private readonly customers: CustomersService,
    @Inject(CustomerRegistrationService) private readonly registrations: CustomerRegistrationService,
    @Inject(CustomerUpdateService) private readonly updates: CustomerUpdateService,
  ) {}

  @ApiRoute(routes.listCustomers)
  list(
    @CurrentUserParam() user: CurrentUser,
    @Contract() contract: RequestContract<typeof routes.listCustomers>,
  ): Promise<CustomersResponse> {
    return this.customers.list(user, contract.query);
  }

  @ApiRoute(routes.listCustomerLetters)
  letters(
    @CurrentUserParam() user: CurrentUser,
    @Contract() contract: RequestContract<typeof routes.listCustomerLetters>,
  ): Promise<CustomerLettersResponse> {
    return this.customers.letters(user, contract.query);
  }

  @ApiRoute(routes.createCustomer)
  async create(
    @CurrentUserParam() user: CurrentUser,
    @Contract() contract: RequestContract<typeof routes.createCustomer>,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<CreateCustomerResponse> {
    const { response, httpStatus } = await this.registrations.create(user, contract.body);
    // 201 confirmed in time; 202 still waiting for the ERP; 200 replay of an earlier request.
    if (httpStatus !== 201) void reply.status(httpStatus);
    return response;
  }

  @ApiRoute(routes.updateCustomer)
  async update(
    @CurrentUserParam() user: CurrentUser,
    @Contract() contract: RequestContract<typeof routes.updateCustomer>,
  ): Promise<UpdateCustomerResponse> {
    // Refuses with a 409 today (edit delivery not approved); the success path (202) exists for the day the owner approves it.
    const { response } = await this.updates.update(user, contract.params.code, contract.body);
    return response;
  }

  @ApiRoute(routes.getCustomer)
  get(
    @CurrentUserParam() user: CurrentUser,
    @Contract() contract: RequestContract<typeof routes.getCustomer>,
  ): Promise<CustomerDetail> {
    return this.customers.get(user, contract.params.code);
  }

  @ApiRoute(routes.getCustomerFinancial)
  financial(
    @CurrentUserParam() user: CurrentUser,
    @Contract() contract: RequestContract<typeof routes.getCustomerFinancial>,
  ): Promise<CustomerFinancial> {
    return this.customers.financial(user, contract.params.code);
  }
}
