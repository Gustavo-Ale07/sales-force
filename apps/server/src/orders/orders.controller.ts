import { Controller, Inject, Res } from '@nestjs/common';
import { API_BASE_PATH, routes, type OrderDetail, type OrdersResponse } from '@salesforce/contracts';
import type { FastifyReply } from 'fastify';
import { ApiRoute, Contract, type RequestContract } from '../http/route.js';
import { CurrentUserParam, type CurrentUser } from '../iam/current-user.js';
import { OrdersService } from './orders.service.js';

@Controller(API_BASE_PATH)
export class OrdersController {
  constructor(@Inject(OrdersService) private readonly orders: OrdersService) {}

  @ApiRoute(routes.listOrders)
  list(
    @CurrentUserParam() user: CurrentUser,
    @Contract() contract: RequestContract<typeof routes.listOrders>,
  ): Promise<OrdersResponse> {
    return this.orders.list(user, contract.query);
  }

  @ApiRoute(routes.createOrder)
  async create(
    @CurrentUserParam() user: CurrentUser,
    @Contract() contract: RequestContract<typeof routes.createOrder>,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<OrderDetail> {
    const { order, replayed } = await this.orders.create(user, contract.body);
    // 201 when created; 200 with the original order on a replay of the same request.
    if (replayed) void reply.status(200);
    return order;
  }

  @ApiRoute(routes.getOrder)
  get(
    @CurrentUserParam() user: CurrentUser,
    @Contract() contract: RequestContract<typeof routes.getOrder>,
  ): Promise<OrderDetail> {
    return this.orders.get(user, contract.params.id);
  }

  @ApiRoute(routes.replaceOrder)
  replace(
    @CurrentUserParam() user: CurrentUser,
    @Contract() contract: RequestContract<typeof routes.replaceOrder>,
  ): Promise<OrderDetail> {
    return this.orders.replace(user, contract.params.id, contract.body);
  }

  @ApiRoute(routes.discardOrder)
  discard(
    @CurrentUserParam() user: CurrentUser,
    @Contract() contract: RequestContract<typeof routes.discardOrder>,
  ): Promise<OrderDetail> {
    return this.orders.discard(user, contract.params.id);
  }

  /** Always ends in `erp_submission_disabled` (409): see `OrdersService.submit`. */
  @ApiRoute(routes.submitOrder)
  submit(
    @CurrentUserParam() user: CurrentUser,
    @Contract() contract: RequestContract<typeof routes.submitOrder>,
  ): Promise<never> {
    return this.orders.submit(user, contract.params.id);
  }
}
