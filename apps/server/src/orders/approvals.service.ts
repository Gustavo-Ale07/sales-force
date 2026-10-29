import { Inject, Injectable } from '@nestjs/common';
import type { ApprovalQueueQuery, ApprovalQueueResponse, OrderDetail } from '@salesforce/contracts';
import { approvableLevelsOf, canRoleApproveLevel, canTransitionOrder, isCustomerInScope, normalizeDecimalString } from '@salesforce/domain';
import { AppError } from '../http/app-error.js';
import { AUDIT_ACTIONS, AuditService } from '../iam/audit.service.js';
import type { CurrentUser } from '../iam/current-user.js';
import { PolicyService } from '../iam/policy.service.js';
import { CLOCK, type Clock } from '../platform/tokens.js';
import { ApprovalsRepository } from './approvals.repository.js';
import { customerNameOrFallback } from './order.mapper.js';
import { OrdersRepository } from './orders.repository.js';
import { OrdersService } from './orders.service.js';

export type ApprovalDecision = { readonly kind: 'approve'; readonly comment: string | undefined } | { readonly kind: 'reject'; readonly comment: string };

/**
 * W-20 (DISC-3, DISC-4, DISC-6): the discount approval queue and the explicit, audited decision. The pool is per level:
 * the roles that may decide a level come from the domain (`approvableLevelsOf`), never from here. Approval is always an
 * explicit action by an authenticated approver; nothing in the system approves on its own. Online only, no push.
 */
@Injectable()
export class ApprovalsService {
  constructor(
    @Inject(ApprovalsRepository) private readonly approvals: ApprovalsRepository,
    @Inject(OrdersRepository) private readonly orders: OrdersRepository,
    @Inject(OrdersService) private readonly ordersService: OrdersService,
    @Inject(PolicyService) private readonly policy: PolicyService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Pending requests of the levels the caller may decide, oldest first, inside the caller's data scope (P-21). */
  async list(user: CurrentUser, query: ApprovalQueueQuery): Promise<ApprovalQueueResponse> {
    const levels = approvableLevelsOf(user.role);
    if (levels.length === 0) throw new AppError('forbidden');
    const { scope } = await this.policy.accessContext(user);
    const { rows, total } = await this.approvals.listPending(levels, scope, { page: query.page, pageSize: query.pageSize });
    return {
      items: rows.map((row) => ({
        approvalId: row.approval.id,
        orderId: row.approval.orderId,
        draftNumber: row.draftNumber,
        customerCode: row.customerCode,
        customerName: customerNameOrFallback(row.customerName, row.customerCode),
        sellerCode: row.sellerCode,
        ownerName: row.ownerName,
        requestedLevel: row.approval.requestedLevel as 'manager' | 'director',
        requestedAt: row.approval.requestedAt.toISOString(),
        estimatedTotal: row.estimatedTotal,
        itemCount: row.itemCount,
        maxDiscountPercent: normalizeDecimalString(row.maxDiscountPercent),
      })),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  /**
   * Approves or rejects one pending request. Everything is decided on rows locked in the same order every writer uses
   * (order first, then its request), so a concurrent edit by the seller can never interleave: either the edit closes the
   * request first (409 approval_not_pending) or the decision wins and the edit is refused as not editable.
   */
  async decide(user: CurrentUser, approvalId: string, decision: ApprovalDecision): Promise<OrderDetail> {
    if (approvableLevelsOf(user.role).length === 0) throw new AppError('forbidden');
    const context = await this.policy.accessContext(user);
    const seen = await this.approvals.findById(approvalId);
    if (seen === null) throw new AppError('not_found');
    const at = this.clock();
    let denied: { orderId: string; requestedLevel: string } | null = null;

    try {
      await this.decideLocked(user, approvalId, decision, seen.orderId, context, at, (d) => {
        denied = d;
      });
    } catch (error) {
      // The refusal is audited on its own: the decision transaction rolls back with the error.
      if (denied !== null) {
        const info: { orderId: string; requestedLevel: string } = denied;
        await this.audit.record({
          action: AUDIT_ACTIONS.orderApprovalDenied,
          actorAccountId: user.accountId,
          detail: { orderId: info.orderId, approvalId, requestedLevel: info.requestedLevel, attempt: decision.kind },
        });
      }
      throw error;
    }
    return this.ordersService.get(user, seen.orderId);
  }

  private async decideLocked(
    user: CurrentUser,
    approvalId: string,
    decision: ApprovalDecision,
    orderId: string,
    context: Awaited<ReturnType<PolicyService['accessContext']>>,
    at: Date,
    onDenied: (info: { orderId: string; requestedLevel: string }) => void,
  ): Promise<void> {
    await this.orders.transaction(async (tx) => {
      const order = await this.orders.findById(orderId, tx, true);
      if (order === null || !isCustomerInScope({ sellerCode: order.sellerCode }, context.scope)) throw new AppError('not_found');
      const approval = await this.approvals.findById(approvalId, tx, true);
      if (approval === null) throw new AppError('not_found');
      const level = approval.requestedLevel as 'manager' | 'director';
      if (!canRoleApproveLevel(user.role, level)) {
        onDenied({ orderId: order.id, requestedLevel: level });
        throw new AppError('forbidden');
      }
      const target = decision.kind === 'approve' ? 'approved' : 'approval_rejected';
      if (
        approval.decision !== 'pending' ||
        order.status !== 'awaiting_approval' ||
        order.version !== approval.orderVersion ||
        !canTransitionOrder('awaiting_approval', target)
      ) {
        throw new AppError('approval_not_pending');
      }
      if (decision.kind === 'approve') {
        // The limits may have changed since the request: the stored lines are judged again, under the current limits and
        // the owner's role (Q12), so an approval can never release lines no level would accept today.
        const authority = await this.ordersService.recomputeAuthority(order, context.configuration, tx);
        if (authority.status === 'blocked') {
          throw new AppError('discount_blocked', { details: { reason: authority.reason ?? null } });
        }
        if (authority.level === 'director' && level === 'manager') {
          throw new AppError('conflict', { message: 'Os limites mudaram: este pedido agora exige a aprovação da Diretoria.', details: { reason: 'level_changed' } });
        }
      }
      const comment = decision.comment === undefined || decision.comment === '' ? null : decision.comment;
      const decided = await this.approvals.decide(
        approvalId,
        { decision: decision.kind === 'approve' ? 'approved' : 'rejected', decidedByAccountId: user.accountId, decidedAt: at, comment },
        tx,
      );
      if (!decided) throw new AppError('approval_not_pending');
      await this.orders.updateOrder(order.id, { status: target, version: order.version + 1, updatedAt: at }, tx);
      await this.audit.record(
        {
          action: decision.kind === 'approve' ? AUDIT_ACTIONS.orderApprovalApproved : AUDIT_ACTIONS.orderApprovalRejected,
          actorAccountId: user.accountId,
          detail: { orderId: order.id, approvalId, requestedLevel: level, orderVersion: order.version, hasComment: comment !== null, commentLength: comment === null ? 0 : comment.length },
        },
        tx,
      );
    });
  }
}
