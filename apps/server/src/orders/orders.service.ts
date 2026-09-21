import { Inject, Injectable } from '@nestjs/common';
import type {
  CreateOrderRequest,
  OrderDetail,
  OrdersQuery,
  OrdersResponse,
  ReplaceOrderRequest,
} from '@salesforce/contracts';
import {
  canTransitionOrder,
  isCustomerInScope,
  isOrderEditable,
  type CustomerScope,
} from '@salesforce/domain';
import { CustomersService } from '../customers/customers.service.js';
import { AppError } from '../http/app-error.js';
import { AUDIT_ACTIONS, AuditService, type AuditDetail } from '../iam/audit.service.js';
import type { CurrentUser } from '../iam/current-user.js';
import { PolicyService, type AccessContext } from '../iam/policy.service.js';
import { MirrorRepository, type CustomerRow } from '../mirror/mirror.repository.js';
import { uuidv7 } from '../platform/ids.js';
import { CLOCK, type Clock } from '../platform/tokens.js';
import { DraftBuilder, type DraftOutcome } from './draft-builder.js';
import { orderFingerprint } from './order-fingerprint.js';
import { toOrderDetail, toOrderListItem } from './order.mapper.js';
import { OrdersRepository, type OrderCounts, type OrderRow } from './orders.repository.js';

type ValidDraft = Extract<DraftOutcome, { ok: true }>;

export interface CreateResult {
  readonly order: OrderDetail;
  /** True when the request id had already created this very order (served as 200, not 201). */
  readonly replayed: boolean;
}

/**
 * Draft orders (RF-PED, Phase 0 slice). What this class decides is orchestration only: who may see or
 * touch an order (the central policy's scope), idempotency and optimistic concurrency, transactions
 * and audit. Prices, totals and every draft invariant come from the domain through `DraftBuilder`
 * (P-09, P-14); nothing here decides discount authority, credit or payment rules (P-10, R35/R36 are
 * UNDECIDED). Nothing is ever sent to the ERP: `submit` always ends in `erp_submission_disabled`
 * (SNK-4, SNK-6) and touches neither the outbox nor the gateway.
 */
@Injectable()
export class OrdersService {
  constructor(
    @Inject(PolicyService) private readonly policy: PolicyService,
    @Inject(OrdersRepository) private readonly orders: OrdersRepository,
    @Inject(MirrorRepository) private readonly mirror: MirrorRepository,
    @Inject(CustomersService) private readonly customers: CustomersService,
    @Inject(DraftBuilder) private readonly builder: DraftBuilder,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /* ---------- reads ---------- */

  async list(user: CurrentUser, query: OrdersQuery): Promise<OrdersResponse> {
    const { scope } = await this.policy.accessContext(user);
    const { rows, total } = await this.orders.list(
      { scope, search: query.search, status: query.status, customerCode: query.customerCode, sort: query.sort },
      { page: query.page, pageSize: query.pageSize },
    );
    return { items: rows.map(toOrderListItem), page: query.page, pageSize: query.pageSize, total };
  }

  async get(user: CurrentUser, id: string): Promise<OrderDetail> {
    const { scope } = await this.policy.accessContext(user);
    return this.detailOf(await this.loadVisible(scope, id));
  }

  /** Figures and latest orders for the dashboard, within the caller's scope. */
  async dashboardFigures(scope: CustomerScope): Promise<{ counts: OrderCounts; recent: ReturnType<typeof toOrderListItem>[] }> {
    const [counts, recent] = await Promise.all([
      this.orders.countByStatus(scope),
      this.orders.list({ scope, sort: '-updatedAt' }, { page: 1, pageSize: 5 }),
    ]);
    return { counts, recent: recent.rows.map(toOrderListItem) };
  }

  /* ---------- create (idempotent) ---------- */

  async create(user: CurrentUser, body: CreateOrderRequest): Promise<CreateResult> {
    const context = await this.policy.accessContext(user);
    const fingerprint = orderFingerprint(body);

    const existing = await this.orders.findByClientRequestId(body.clientRequestId);
    if (existing !== null) return { order: await this.replayOf(existing, user, fingerprint, context.scope), replayed: true };

    const customer = await this.customers.requireVisible(context.scope, body.customerCode);
    const draft = await this.buildValid(context, customer, body);
    const at = this.clock();

    const created = await this.orders.transaction(async (tx) => {
      const id = uuidv7(at.getTime());
      const row = await this.orders.insertOrder(
        {
          id,
          customerCode: customer.code,
          sellerCode: customer.sellerCode,
          createdByAccountId: user.accountId,
          status: 'draft',
          negotiationTypeCode: body.negotiationTypeCode,
          notes: body.notes,
          estimatedTotal: draft.totals.estimatedTotal,
          version: 1,
          clientRequestId: body.clientRequestId,
          clientRequestHash: fingerprint,
          configVersionId: context.configVersionId,
          createdAt: at,
          updatedAt: at,
        },
        tx,
      );
      if (row === null) return null;
      await this.orders.insertItems(id, draft.draft.items, () => uuidv7(at.getTime()), tx);
      await this.audit.record(
        { action: AUDIT_ACTIONS.orderCreated, actorAccountId: user.accountId, detail: this.auditDetail(row, draft.draft.items.length) },
        tx,
      );
      return row;
    });

    if (created === null) {
      // A concurrent request with the same id won the insert: decide like any other replay.
      const winner = await this.orders.findByClientRequestId(body.clientRequestId);
      if (winner === null) throw new AppError('conflict');
      return { order: await this.replayOf(winner, user, fingerprint, context.scope), replayed: true };
    }
    return { order: await this.detailOf(created), replayed: false };
  }

  private async replayOf(existing: OrderRow, user: CurrentUser, fingerprint: string, scope: CustomerScope): Promise<OrderDetail> {
    // Another account, another content, or an order the caller may no longer see: the id is simply
    // unusable. The response never says which, nor shows anything about the existing order.
    const sameRequest =
      existing.createdByAccountId === user.accountId &&
      existing.clientRequestHash === fingerprint &&
      isCustomerInScope({ sellerCode: existing.sellerCode }, scope);
    if (!sameRequest) throw new AppError('idempotency_conflict');
    return this.detailOf(existing);
  }

  /* ---------- replace / discard ---------- */

  async replace(user: CurrentUser, id: string, body: ReplaceOrderRequest): Promise<OrderDetail> {
    const context = await this.policy.accessContext(user);
    const current = await this.loadVisible(context.scope, id);
    this.assertEditable(current, body.expectedVersion);

    const customer = await this.customers.requireVisible(context.scope, body.customerCode);
    const draft = await this.buildValid(context, customer, body);
    const at = this.clock();

    const updated = await this.orders.transaction(async (tx) => {
      // The read above was unlocked: decide again on the locked row so two writers cannot both win.
      const locked = await this.orders.findById(id, tx, true);
      if (locked === null) throw new AppError('not_found');
      this.assertEditable(locked, body.expectedVersion);

      const row = await this.orders.updateOrder(
        id,
        {
          customerCode: customer.code,
          sellerCode: customer.sellerCode,
          negotiationTypeCode: body.negotiationTypeCode,
          notes: body.notes,
          estimatedTotal: draft.totals.estimatedTotal,
          version: locked.version + 1,
          configVersionId: context.configVersionId,
          updatedAt: at,
        },
        tx,
      );
      await this.orders.deleteItems(id, tx);
      await this.orders.insertItems(id, draft.draft.items, () => uuidv7(at.getTime()), tx);
      await this.audit.record(
        { action: AUDIT_ACTIONS.orderReplaced, actorAccountId: user.accountId, detail: this.auditDetail(row, draft.draft.items.length) },
        tx,
      );
      return row;
    });
    return this.detailOf(updated);
  }

  async discard(user: CurrentUser, id: string): Promise<OrderDetail> {
    const { scope } = await this.policy.accessContext(user);
    const current = await this.loadVisible(scope, id);
    this.assertCancellable(current);
    const at = this.clock();

    const updated = await this.orders.transaction(async (tx) => {
      const locked = await this.orders.findById(id, tx, true);
      if (locked === null) throw new AppError('not_found');
      this.assertCancellable(locked);
      const row = await this.orders.updateOrder(
        id,
        { status: 'cancelled', version: locked.version + 1, updatedAt: at },
        tx,
      );
      const items = await this.orders.itemsOf(id, tx);
      await this.audit.record(
        { action: AUDIT_ACTIONS.orderDiscarded, actorAccountId: user.accountId, detail: this.auditDetail(row, items.length) },
        tx,
      );
      return row;
    });
    return this.detailOf(updated);
  }

  /* ---------- submit (disabled) ---------- */

  /**
   * ERP submission is disabled until its write-safety gates close (SNK-4, SNK-6): the attempt is
   * audited and refused. No outbox row, no job, no gateway call, no status change.
   */
  async submit(user: CurrentUser, id: string): Promise<never> {
    const { scope } = await this.policy.accessContext(user);
    const order = await this.loadVisible(scope, id);
    await this.audit.record({
      action: AUDIT_ACTIONS.orderSubmitAttempted,
      actorAccountId: user.accountId,
      detail: { ...this.auditDetail(order, 0), outcome: 'erp_submission_disabled' },
    });
    throw new AppError('erp_submission_disabled');
  }

  /* ---------- helpers ---------- */

  private async loadVisible(scope: CustomerScope, id: string): Promise<OrderRow> {
    const row = await this.orders.findById(id);
    // Out of scope looks exactly like missing (P-21).
    if (row === null || !isCustomerInScope({ sellerCode: row.sellerCode }, scope)) throw new AppError('not_found');
    return row;
  }

  private assertEditable(order: OrderRow, expectedVersion: number): void {
    if (!isOrderEditable(order.status as Parameters<typeof isOrderEditable>[0])) throw new AppError('order_not_editable');
    if (order.version !== expectedVersion) {
      throw new AppError('version_conflict', { details: { currentVersion: order.version } });
    }
  }

  private assertCancellable(order: OrderRow): void {
    if (!canTransitionOrder(order.status as Parameters<typeof canTransitionOrder>[0], 'cancelled')) {
      throw new AppError('order_not_editable');
    }
  }

  private async buildValid(
    context: AccessContext,
    customer: CustomerRow,
    request: Pick<CreateOrderRequest, 'negotiationTypeCode' | 'notes' | 'items'>,
  ): Promise<ValidDraft> {
    const outcome = await this.builder.build(
      {
        customer: { code: customer.code, sellerCode: customer.sellerCode, priceTableCode: customer.priceTableCode },
        negotiationTypeCode: request.negotiationTypeCode,
        notes: request.notes,
        items: request.items,
      },
      context.configuration,
    );
    if (!outcome.ok) {
      throw new AppError('validation_failed', {
        details: { issues: outcome.issues.map((issue) => ({ path: issue.path, code: issue.code })) },
      });
    }
    return outcome;
  }

  private async detailOf(order: OrderRow): Promise<OrderDetail> {
    const [items, names] = await Promise.all([
      this.orders.itemsOf(order.id),
      this.mirror.customerNames([order.customerCode]),
    ]);
    return toOrderDetail(order, items, names.get(order.customerCode) ?? null);
  }

  /** Identifiers and counts only: no notes, no free text. */
  private auditDetail(order: OrderRow, itemCount: number): AuditDetail {
    return {
      orderId: order.id,
      draftNumber: order.draftNumber,
      customerCode: order.customerCode,
      version: order.version,
      itemCount,
    };
  }
}
