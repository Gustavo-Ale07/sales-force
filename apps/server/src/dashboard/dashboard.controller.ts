import { Controller, Inject } from '@nestjs/common';
import { API_BASE_PATH, routes, type DashboardResponse } from '@salesforce/contracts';
import { ApiRoute } from '../http/route.js';
import { CurrentUserParam, type CurrentUser } from '../iam/current-user.js';
import { DashboardService } from './dashboard.service.js';

@Controller(API_BASE_PATH)
export class DashboardController {
  constructor(@Inject(DashboardService) private readonly dashboard: DashboardService) {}

  @ApiRoute(routes.getDashboard)
  get(@CurrentUserParam() user: CurrentUser): Promise<DashboardResponse> {
    return this.dashboard.get(user);
  }
}
