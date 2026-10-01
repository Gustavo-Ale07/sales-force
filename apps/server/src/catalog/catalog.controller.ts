import { Controller, Headers, Inject, Res } from '@nestjs/common';
import {
  API_BASE_PATH,
  routes,
  type ProductDetail,
  type ProductGroupsResponse,
  type ProductsResponse,
  type ResolveProductsResponse,
} from '@salesforce/contracts';
import type { FastifyReply } from 'fastify';
import { AppError } from '../http/app-error.js';
import { ApiRoute, Contract, type RequestContract } from '../http/route.js';
import { CurrentUserParam, type CurrentUser } from '../iam/current-user.js';
import { CatalogService } from './catalog.service.js';
import { ProductImageService } from './product-image.service.js';

@Controller(API_BASE_PATH)
export class CatalogController {
  constructor(
    @Inject(CatalogService) private readonly catalog: CatalogService,
    @Inject(ProductImageService) private readonly images: ProductImageService,
  ) {}

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

  /**
   * Binary route: the handler writes the reply itself (`@Res()`), so the JSON contract interceptor only checks
   * the status is declared. Product access is decided first, then the source is asked; the bytes are verified
   * before they leave (see `inspectImage`).
   */
  @ApiRoute(routes.getProductImage)
  async image(
    @CurrentUserParam() user: CurrentUser,
    @Contract() contract: RequestContract<typeof routes.getProductImage>,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const { code } = contract.params;
    const { variant } = contract.query;
    await this.catalog.requireVisibleProduct(user, code);
    const served = await this.images.serve(code, variant, ifNoneMatch);
    if (served === null) throw new AppError('not_found');
    const cacheControl = `private, max-age=${this.images.maxAgeSeconds}`;
    if (served.kind === 'not_modified') {
      void reply.status(304).header('etag', served.etag).header('cache-control', cacheControl).send();
      return;
    }
    void reply
      .status(200)
      .header('content-type', served.contentType)
      .header('content-length', served.bytes.length)
      .header('content-disposition', 'inline')
      .header('etag', served.etag)
      .header('cache-control', cacheControl)
      .send(Buffer.from(served.bytes.buffer, served.bytes.byteOffset, served.bytes.byteLength));
  }

  @ApiRoute(routes.resolveProducts)
  resolve(
    @CurrentUserParam() user: CurrentUser,
    @Contract() contract: RequestContract<typeof routes.resolveProducts>,
  ): Promise<ResolveProductsResponse> {
    return this.catalog.resolve(user, contract.body);
  }
}
