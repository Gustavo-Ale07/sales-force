import { Controller, Inject, Res } from '@nestjs/common';
import {
  API_BASE_PATH,
  routes,
  type CreateCustomerResponse,
  type CustomerDetail,
  type CustomerFinancial,
  type CustomerLettersResponse,
  type CustomerRegistrationsResponse,
  type CustomerRegistrationView,
  type CustomersResponse,
  type PostalCodeLookup,
  type UpdateCustomerResponse,
} from '@salesforce/contracts';
import type { FastifyReply } from 'fastify';
import { ApiRoute, Contract, type RequestContract } from '../http/route.js';
import { CurrentUserParam, type CurrentUser } from '../iam/current-user.js';
import { CustomerRegistrationQueryService } from './customer-registration-query.service.js';
import { CustomerRegistrationService } from './customer-registration.service.js';
import { CustomerUpdateService } from './customer-update.service.js';
import { CustomersService } from './customers.service.js';
import { PostalCodeService } from './postal-code.service.js';

@Controller(API_BASE_PATH)
export class CustomersController {
  constructor(
    @Inject(CustomersService) private readonly customers: CustomersService,
    @Inject(CustomerRegistrationService) private readonly registrations: CustomerRegistrationService,
    @Inject(CustomerRegistrationQueryService) private readonly registrationQueries: CustomerRegistrationQueryService,
    @Inject(CustomerUpdateService) private readonly updates: CustomerUpdateService,
    @Inject(PostalCodeService) private readonly postalCodes: PostalCodeService,
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

  @ApiRoute(routes.lookupPostalCode)
  lookupPostalCode(
    @CurrentUserParam() user: CurrentUser,
    @Contract() contract: RequestContract<typeof routes.lookupPostalCode>,
  ): Promise<PostalCodeLookup> {
    return this.postalCodes.lookup(user, contract.params.cep);
  }

  @ApiRoute(routes.updateCustomer)
  async update(
    @CurrentUserParam() user: CurrentUser,
    @Contract() contract: RequestContract<typeof routes.updateCustomer>,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<UpdateCustomerResponse> {
    const { response, httpStatus } = await this.updates.update(user, contract.params.code, contract.body);
    // 202 recorded for delivery; 200 replay of an earlier request.
    void reply.status(httpStatus);
    return response;
  }

  @ApiRoute(routes.listCustomerRegistrations)
  listRegistrations(
    @CurrentUserParam() user: CurrentUser,
    @Contract() contract: RequestContract<typeof routes.listCustomerRegistrations>,
  ): Promise<CustomerRegistrationsResponse> {
    return this.registrationQueries.list(user, contract.query);
  }

  @ApiRoute(routes.getCustomerRegistration)
  getRegistration(
    @CurrentUserParam() user: CurrentUser,
    @Contract() contract: RequestContract<typeof routes.getCustomerRegistration>,
  ): Promise<CustomerRegistrationView> {
    return this.registrationQueries.get(user, contract.params.registrationId);
  }

  @ApiRoute(routes.setCustomerRegistrationSeller)
  setRegistrationSeller(
    @CurrentUserParam() user: CurrentUser,
    @Contract() contract: RequestContract<typeof routes.setCustomerRegistrationSeller>,
  ): Promise<CustomerRegistrationView> {
    return this.registrationQueries.setSeller(user, contract.params.registrationId, contract.body.sellerCode);
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
