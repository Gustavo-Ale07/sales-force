import { Controller, Inject } from '@nestjs/common';
import { API_BASE_PATH, routes, type GoalsResponse } from '@salesforce/contracts';
import { ApiRoute } from '../http/route.js';
import { CurrentUserParam, type CurrentUser } from '../iam/current-user.js';
import { GoalsService } from './goals.service.js';

@Controller(API_BASE_PATH)
export class GoalsController {
  constructor(@Inject(GoalsService) private readonly goals: GoalsService) {}

  @ApiRoute(routes.getGoals)
  get(@CurrentUserParam() user: CurrentUser): Promise<GoalsResponse> {
    return this.goals.get(user);
  }
}
