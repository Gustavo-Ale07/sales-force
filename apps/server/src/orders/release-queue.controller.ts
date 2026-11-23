import { Controller, Inject } from '@nestjs/common';
import { API_BASE_PATH, routes, type ReleaseQueueCountResponse, type ReleaseQueueResponse } from '@salesforce/contracts';
import { ApiRoute, Contract, type RequestContract } from '../http/route.js';
import { CurrentUserParam, type CurrentUser } from '../iam/current-user.js';
import { ReleaseQueueService } from './release-queue.service.js';

/** Release queue (read only). Role gate in `ROUTE_POLICY`; the sector permission is enforced by the service. */
@Controller(API_BASE_PATH)
export class ReleaseQueueController {
  constructor(@Inject(ReleaseQueueService) private readonly queue: ReleaseQueueService) {}

  @ApiRoute(routes.listReleaseQueue)
  list(
    @CurrentUserParam() user: CurrentUser,
    @Contract() contract: RequestContract<typeof routes.listReleaseQueue>,
  ): Promise<ReleaseQueueResponse> {
    return this.queue.list(user, contract.query);
  }

  @ApiRoute(routes.getReleaseQueueCount)
  count(
    @CurrentUserParam() user: CurrentUser,
    @Contract() contract: RequestContract<typeof routes.getReleaseQueueCount>,
  ): Promise<ReleaseQueueCountResponse> {
    return this.queue.count(user, contract.query);
  }
}
