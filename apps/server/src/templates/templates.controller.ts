import { Controller, Inject, Res } from '@nestjs/common';
import {
  API_BASE_PATH,
  routes,
  type OrderTemplateDetail,
  type OrderTemplatesResponse,
  type UseOrderTemplateResponse,
} from '@salesforce/contracts';
import type { FastifyReply } from 'fastify';
import { ApiRoute, Contract, type RequestContract } from '../http/route.js';
import { CurrentUserParam, type CurrentUser } from '../iam/current-user.js';
import { TemplatesService } from './templates.service.js';

@Controller(API_BASE_PATH)
export class TemplatesController {
  constructor(@Inject(TemplatesService) private readonly templates: TemplatesService) {}

  @ApiRoute(routes.listOrderTemplates)
  list(
    @CurrentUserParam() user: CurrentUser,
    @Contract() contract: RequestContract<typeof routes.listOrderTemplates>,
  ): Promise<OrderTemplatesResponse> {
    return this.templates.list(user, contract.params.code);
  }

  @ApiRoute(routes.createOrderTemplate)
  async create(
    @CurrentUserParam() user: CurrentUser,
    @Contract() contract: RequestContract<typeof routes.createOrderTemplate>,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<OrderTemplateDetail> {
    const { template, replayed } = await this.templates.create(user, contract.params.code, contract.body);
    // 201 when created; 200 with the original template on a replay of the same request.
    if (replayed) void reply.status(200);
    return template;
  }

  @ApiRoute(routes.getOrderTemplate)
  get(
    @CurrentUserParam() user: CurrentUser,
    @Contract() contract: RequestContract<typeof routes.getOrderTemplate>,
  ): Promise<OrderTemplateDetail> {
    return this.templates.get(user, contract.params.id);
  }

  @ApiRoute(routes.replaceOrderTemplate)
  replace(
    @CurrentUserParam() user: CurrentUser,
    @Contract() contract: RequestContract<typeof routes.replaceOrderTemplate>,
  ): Promise<OrderTemplateDetail> {
    return this.templates.replace(user, contract.params.id, contract.body);
  }

  @ApiRoute(routes.deleteOrderTemplate)
  remove(
    @CurrentUserParam() user: CurrentUser,
    @Contract() contract: RequestContract<typeof routes.deleteOrderTemplate>,
  ): Promise<void> {
    return this.templates.remove(user, contract.params.id);
  }

  @ApiRoute(routes.useOrderTemplate)
  async use(
    @CurrentUserParam() user: CurrentUser,
    @Contract() contract: RequestContract<typeof routes.useOrderTemplate>,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<UseOrderTemplateResponse> {
    const { result, replayed } = await this.templates.use(user, contract.params.id, contract.body);
    if (replayed) void reply.status(200);
    return result;
  }
}
