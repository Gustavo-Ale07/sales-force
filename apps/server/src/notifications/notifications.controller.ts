import { Controller, Inject } from '@nestjs/common';
import { API_BASE_PATH, routes, type NotificationsResponse, type UnreadCountResponse } from '@salesforce/contracts';
import { ApiRoute, Contract, type RequestContract } from '../http/route.js';
import { CurrentUserParam, type CurrentUser } from '../iam/current-user.js';
import { NotificationsService } from './notifications.service.js';

@Controller(API_BASE_PATH)
export class NotificationsController {
  constructor(@Inject(NotificationsService) private readonly notifications: NotificationsService) {}

  @ApiRoute(routes.listNotifications)
  list(
    @CurrentUserParam() user: CurrentUser,
    @Contract() contract: RequestContract<typeof routes.listNotifications>,
  ): Promise<NotificationsResponse> {
    return this.notifications.list(user, contract.query);
  }

  @ApiRoute(routes.markNotificationsRead)
  markRead(
    @CurrentUserParam() user: CurrentUser,
    @Contract() contract: RequestContract<typeof routes.markNotificationsRead>,
  ): Promise<UnreadCountResponse> {
    return this.notifications.markRead(user, contract.body);
  }

  @ApiRoute(routes.registerPushDevice)
  register(
    @CurrentUserParam() user: CurrentUser,
    @Contract() contract: RequestContract<typeof routes.registerPushDevice>,
  ): Promise<void> {
    return this.notifications.registerDevice(user, contract.body);
  }

  @ApiRoute(routes.unregisterPushDevice)
  unregister(
    @CurrentUserParam() user: CurrentUser,
    @Contract() contract: RequestContract<typeof routes.unregisterPushDevice>,
  ): Promise<void> {
    return this.notifications.unregisterDevice(user, contract.body);
  }
}
