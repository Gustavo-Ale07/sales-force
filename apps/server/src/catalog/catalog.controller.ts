import { Controller, Inject } from '@nestjs/common';
import {
  API_BASE_PATH,
  routes,
  type ProductDetail,
  type ProductGroupsResponse,
  type ProductsResponse,
} from '@salesforce/contracts';
import { ApiRoute, Contract, type RequestContract } from '../http/route.js';
import { CurrentUserParam, type CurrentUser } from '../iam/current-user.js';
import { CatalogService } from './catalog.service.js';

@Controller(API_BASE_PATH)
export class CatalogController {
  constructor(@Inject(CatalogService) private readonly catalog: CatalogService) {}

  @ApiRoute(routes.listProductGroups)
  groups(@CurrentUserParam() user: CurrentUser): Promise<ProductGroupsResponse> {
    return this.catalog.listGroups(user);
  }

  @ApiRoute(routes.listProducts)
  list(
    @CurrentUserParam() user: CurrentUser,
    @Contract() contract: RequestContract<typeof routes.listProducts>,
  ): Promise<ProductsResponse> {
    return this.catalog.list(user, contract.query);
  }

  @ApiRoute(routes.getProduct)
  get(
    @CurrentUserParam() user: CurrentUser,
    @Contract() contract: RequestContract<typeof routes.getProduct>,
  ): Promise<ProductDetail> {
    return this.catalog.get(user, contract.params.code, contract.query.customerCode);
  }
}
