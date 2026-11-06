import { Controller, Inject } from '@nestjs/common';
import { API_BASE_PATH, routes, type StartSyncRefreshResponse, type SyncRefreshView, type SyncStatusResponse } from '@salesforce/contracts';
import { ApiRoute, Contract, type RequestContract } from '../http/route.js';
import { CurrentUserParam, type CurrentUser } from '../iam/current-user.js';
import { SyncRefreshService } from './sync-refresh.service.js';

@Controller(API_BASE_PATH)
export class SyncRefreshController {
  constructor(@Inject(SyncRefreshService) private readonly refresh: SyncRefreshService) {}

  @ApiRoute(routes.startSyncRefresh)
  start(@CurrentUserParam() user: CurrentUser): Promise<StartSyncRefreshResponse> {
    return this.refresh.start(user);
  }

  @ApiRoute(routes.getSyncRefresh)
  get(@Contract() contract: RequestContract<typeof routes.getSyncRefresh>, @CurrentUserParam() user: CurrentUser): Promise<SyncRefreshView> {
    return this.refresh.get(contract.params.id, user);
  }

  @ApiRoute(routes.getSyncStatus)
  status(): Promise<SyncStatusResponse> {
    return this.refresh.status();
  }
}
