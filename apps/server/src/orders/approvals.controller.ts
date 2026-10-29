import { Controller, Inject } from '@nestjs/common';
import { API_BASE_PATH, routes, type ApprovalQueueResponse, type OrderDetail } from '@salesforce/contracts';
import { ApiRoute, Contract, type RequestContract } from '../http/route.js';
import { CurrentUserParam, type CurrentUser } from '../iam/current-user.js';
import { ApprovalsService } from './approvals.service.js';

/** W-20: the discount approval queue and the decisions. Role gate in `ROUTE_POLICY`; the level pool is enforced by the service. */
@Controller(API_BASE_PATH)
export class ApprovalsController {
  constructor(@Inject(ApprovalsService) private readonly approvals: ApprovalsService) {}

  @ApiRoute(routes.listApprovals)
  list(
    @CurrentUserParam() user: CurrentUser,
    @Contract() contract: RequestContract<typeof routes.listApprovals>,
  ): Promise<ApprovalQueueResponse> {
    return this.approvals.list(user, contract.query);
  }

  @ApiRoute(routes.approveApproval)
  approve(
    @CurrentUserParam() user: CurrentUser,
    @Contract() contract: RequestContract<typeof routes.approveApproval>,
  ): Promise<OrderDetail> {
    return this.approvals.decide(user, contract.params.id, { kind: 'approve', comment: contract.body.comment });
  }

  @ApiRoute(routes.rejectApproval)
  reject(
    @CurrentUserParam() user: CurrentUser,
    @Contract() contract: RequestContract<typeof routes.rejectApproval>,
  ): Promise<OrderDetail> {
    return this.approvals.decide(user, contract.params.id, { kind: 'reject', comment: contract.body.comment });
  }
}
