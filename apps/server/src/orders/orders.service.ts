import { Inject, Injectable } from '@nestjs/common';
import type {
  CreateOrderRequest,
  DatasetIdentity,
  OrderDetail,
  OrdersQuery,
  OrdersResponse,
  RepeatLastOrderRequest,
  RepeatLastOrderResponse,
  ReplaceOrderRequest,
} from '@salesforce/contracts';
import {
  canTransitionOrder,
  customerOrderBlock,
  datasetOriginForConfigurationSource,
  isCustomerInScope,
  isOrderEditable,
  normalizeDecimalString,
  presentSkips,
  type CustomerScope,
} from '@salesforce/domain';
import { ProductImageService } from '../catalog/product-image.service.js';
import { CustomersService } from '../customers/customers.service.js';
import { AppError } from '../http/app-error.js';
import { AUDIT_ACTIONS, AuditService, type AuditDetail } from '../iam/audit.service.js';
import type { CurrentUser } from '../iam/current-user.js';
import { PolicyService, type AccessContext } from '../iam/policy.service.js';
import { isBlockedRaw, MirrorRepository, type CustomerRow, type CustomerStateRow } from '../mirror/mirror.repository.js';
import { assertDatasetMatches } from '../platform/dataset-guard.js';
import { uuidv7 } from '../platform/ids.js';
import { CLOCK, DATASET_IDENTITY, type Clock } from '../platform/tokens.js';
import { DraftBuilder, type DraftOutcome } from './draft-builder.js';
import { orderFingerprint } from './order-fingerprint.js';
import { toOrderDetail, toOrderListItem } from './order.mapper.js';
import { OrdersRepository, type Executor, type OrderCounts, type OrderRow } from './orders.repository.js';

type ValidDraft = Extract<DraftOutcome, { ok: true }>;

/**
 * Extra work that must commit or roll back together with a draft, run inside its create transaction:
 * how a feature that creates drafts (a saved template) locks what it depends on and audits its own
 * action without a second code path for the draft itself. Not run when the request is a replay.
 */
export interface CreateHooks {
  /** First thing in the transaction (locks, last checks). Throwing aborts the create. */
  readonly beforeInsert?: (tx: Executor) => Promise<void>;
  /** After the draft and its lines are written. */
  readonly afterInsert?: (tx: Executor, order: { readonly id: string; readonly itemCount: number }) => Promise<void>;
}

export interface CreateResult {
  readonly order: OrderDetail;
  /** True when the request id had already created this very order (served as 200, not 201). */
  readonly replayed: boolean;
}

export interface RepeatLastOrderResult {
  readonly result: RepeatLastOrderResponse;
  /** True when the request id had already created this very draft (served as 200, not 201). */
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
/**
 * A draft is created or changed only for an eligible customer (domain `customerOrderBlock`): active, not
 * blocked and with a valid seller (F4: nobody is chosen on the order, the customer's seller is the
 * attribution). Inactive/blocked -> 409 `customer_ineligible`; no valid seller -> 409 `customer_without_seller`.
 */
function assertCustomerEligible(customer: CustomerRow): void {
  const block = customerOrderBlock({
    active: customer.active,
    blocked: isBlockedRaw(customer.blockedRaw),
    sellerCode: customer.sellerCode,
  });
  if (block === null) return;
  if (block === 'customer_without_seller') throw new AppError('customer_without_seller');
  throw new AppError('customer_ineligible', { details: { reason: block } });
}

/**
 * F5: the origin stamp is immutable, so a replace can only be refused, never re-stamped. A draft priced
 * against another kind of dataset (fake vs sankhya) must not be repriced under the current one;
 * `legacy_dev` drafts are never ERP-eligible and stay editable.
 */
function assertOriginMatchesConfiguration(stamped: string, sourceKind: string): void {
  if (stamped === 'legacy_dev') return;
  if (stamped !== datasetOriginForConfigurationSource(sourceKind)) throw new AppError('dataset_mismatch');
}

function discountedLines(items: readonly { readonly discountPercent: string }[]): number {
  return items.filter((item) => item.discountPercent !== '0').length;
}

@Injectable()
export class OrdersService {
  constructor(
    @Inject(PolicyService) private readonly policy: PolicyService,
    @Inject(OrdersRepository) private readonly orders: OrdersRepository,
    @Inject(MirrorRepository) private readonly mirror: MirrorRepository,
    @Inject(CustomersService) private readonly customers: CustomersService,
    @Inject(DraftBuilder) private readonly builder: DraftBuilder,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(ProductImageService) private readonly images: ProductImageService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(DATASET_IDENTITY) private readonly dataset: DatasetIdentity | null,
  ) {}

  /* ---------- reads ---------- */

  async list(user: CurrentUser, query: OrdersQuery): Promise<OrdersResponse> {
    if (query.from !== undefined && query.to !== undefined && query.from > query.to) {
      throw new AppError('validation_failed', {
        details: { issues: [{ path: 'to', code: 'range_inverted', message: 'A data final não pode ser anterior à inicial.' }] },
      });
    }
    const { scope } = await this.policy.accessContext(user);
    const { rows, total } = await this.orders.list(
      {
        scope,
        search: query.search,
        status: query.status,
        customerCode: query.customerCode,
        from: query.from,
        to: query.to,
        dateField: query.dateField,
        productCodes: query.productCodes,
        productMatch: query.productMatch,
        productSearch: query.productSearch,
        sort: query.sort,
      },
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

  async create(user: CurrentUser, body: CreateOrderRequest, hooks: CreateHooks = {}): Promise<CreateResult> {
    // After authN/authZ (route guard), before everything else: also for a replay of an existing clientRequestId.
    assertDatasetMatches(this.dataset, body.expectedDataset);
    const context = await this.policy.accessContext(user);
    const fingerprint = orderFingerprint(body);

    const existing = await this.orders.findByClientRequestId(body.clientRequestId);
    if (existing !== null) return { order: await this.replayOf(existing, user, fingerprint, context.scope), replayed: true };

    const customer = await this.customers.requireVisible(context.scope, body.customerCode);
    assertCustomerEligible(customer);
    const draft = await this.buildValid(context, customer, body);
    const at = this.clock();

    const created = await this.orders.transaction(async (tx) => {
      await hooks.beforeInsert?.(tx);
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
          // Stamped by the server from the configuration the draft was priced against, never from the
          // request (SNK-6). The ERP environment stays unbound until an installation-level identity
          // for it is decided: an unbound order is never eligible for the ERP.
          datasetOrigin: datasetOriginForConfigurationSource(context.configuration.source.kind),
          erpEnvironment: null,
          createdAt: at,
          updatedAt: at,
        },
        tx,
      );
      if (row === null) return null;
      await this.orders.insertItems(id, draft.draft.items, () => uuidv7(at.getTime()), tx);
      await this.audit.record(
        { action: AUDIT_ACTIONS.orderCreated, actorAccountId: user.accountId, detail: this.auditDetail(row, draft.draft.items.length, discountedLines(draft.draft.items)) },
        tx,
      );
      await hooks.afterInsert?.(tx, { id: row.id, itemCount: draft.draft.items.length });
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

  /**
   * "Repetir último pedido" (Phase C): a NEW, independent draft from the customer's own most recent
   * NON-cancelled order recorded in Sales Force — never from Sankhya/ERP history, which is not
   * mirrored here. Only `productCode` and `quantity` are copied; lines are revalidated against the
   * CURRENT catalog by the very same classification a template use goes through, so removed,
   * inactive, hidden, not sellable or unpriced lines are left out and reported, never priced by guess.
   * The new draft goes through the ordinary `create` path, so it gets the customer's CURRENT seller
   * (which may differ from the source order's seller) and its own price, totals and idempotency. The
   * source order is only read here, never locked or mutated: unlike a template it has no version field
   * to protect, and nothing about this flow can change it.
   */
  async repeatLast(user: CurrentUser, customerCode: number, body: RepeatLastOrderRequest): Promise<RepeatLastOrderResult> {
    assertDatasetMatches(this.dataset, body.expectedDataset);
    const context = await this.policy.accessContext(user);
    const customer = await this.customers.requireVisible(context.scope, customerCode);
    assertCustomerEligible(customer);

    // Idempotency comes first, before any resolution of "the latest order" or reclassification of its
    // lines: both depend on mutable state (order history, catalog, prices), so a legitimate retry of
    // the same `clientRequestId` (e.g. after a client timeout) could otherwise recompute a different
    // item set, or find no usable source at all, and wrongly surface `no_previous_order` /
    // `no_usable_lines` / `idempotency_conflict` for what should be a transparent replay of the draft
    // already created. `skippedLines` is not persisted with the order, so a replay reports none: the
    // guarantee owed to a retry is the created draft itself (same id, same items), not a replay of the
    // original informational skip list.
    const priorOrder = await this.orders.findByClientRequestId(body.clientRequestId);
    if (priorOrder !== null) {
      const sameRequest =
        priorOrder.createdByAccountId === user.accountId &&
        priorOrder.customerCode === customer.code &&
        isCustomerInScope({ sellerCode: priorOrder.sellerCode }, context.scope);
      if (!sameRequest) throw new AppError('idempotency_conflict');
      return { result: { order: await this.detailOf(priorOrder), skippedLines: [] }, replayed: true };
    }

    const source = await this.orders.findLatestForCustomer(context.scope, customer.code);
    if (source === null) {
      throw new AppError('conflict', {
        message: 'Nenhum pedido anterior registrado no Sales Force para este cliente.',
        details: { reason: 'no_previous_order' },
      });
    }
    const sourceItems = await this.orders.itemsOf(source.id);

    const { usable, skipped } = await this.builder.classifyTemplateLines(
      { code: customer.code, sellerCode: customer.sellerCode, priceTableCode: customer.priceTableCode },
      sourceItems.map((item) => ({
        lineNo: item.lineNo,
        productCode: item.productCode,
        quantity: normalizeDecimalString(item.quantity),
      })),
      context.configuration,
    );
    if (usable.length === 0) {
      throw new AppError('conflict', {
        message:
          'Nenhum item do último pedido pode ser pedido agora (produtos removidos, inativos, indisponíveis ou sem preço). Nenhum pedido foi criado.',
        details: { reason: 'no_usable_lines', skippedLines: presentSkips(user.role, skipped) },
      });
    }

    const { order, replayed } = await this.create(
      user,
      {
        clientRequestId: body.clientRequestId,
        expectedDataset: body.expectedDataset,
        customerCode: customer.code,
        negotiationTypeCode: null,
        notes: null,
        items: usable.map((line) => ({ productCode: line.productCode, quantity: line.quantity })),
      },
      {
        afterInsert: async (tx, created) => {
          await this.audit.record(
            {
              action: AUDIT_ACTIONS.orderRepeatedFromLast,
              actorAccountId: user.accountId,
              detail: {
                sourceOrderId: source.id,
                orderId: created.id,
                customerCode: customer.code,
                usedCount: created.itemCount,
                skippedCount: skipped.length,
              },
            },
            tx,
          );
        },
      },
    );
    return { result: { order, skippedLines: presentSkips(user.role, skipped) }, replayed };
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
    assertDatasetMatches(this.dataset, body.expectedDataset);
    const context = await this.policy.accessContext(user);
    const current = await this.loadVisible(context.scope, id);
    this.assertEditable(current, body.expectedVersion);
    assertOriginMatchesConfiguration(current.datasetOrigin, context.configuration.source.kind);

    const customer = await this.customers.requireVisible(context.scope, body.customerCode);
    assertCustomerEligible(customer);
    const draft = await this.buildValid(context, customer, body);
    const at = this.clock();

    const updated = await this.orders.transaction(async (tx) => {
      // The read above was unlocked: decide again on the locked row so two writers cannot both win.
      const locked = await this.orders.findById(id, tx, true);
      // Scope first, on the locked row: a concurrent change may have moved the order out of the caller's
      // scope, and then it must look exactly like a missing one (never a version_conflict that shows it exists).
      this.assertInScope(context.scope, locked);
      this.assertEditable(locked, body.expectedVersion);
      assertOriginMatchesConfiguration(locked.datasetOrigin, context.configuration.source.kind);

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
        { action: AUDIT_ACTIONS.orderReplaced, actorAccountId: user.accountId, detail: this.auditDetail(row, draft.draft.items.length, discountedLines(draft.draft.items)) },
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
      this.assertInScope(scope, locked);
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
    // The server revalidates the customer NOW, not at draft time: a draft whose customer became ineligible
    // is refused and flagged (needs_review), never sent and never silently altered.
    const [state] = [...(await this.mirror.customerStates([order.customerCode])).values()];
    const block = customerOrderBlock(state === undefined || !state.live ? null : this.eligibilityOf(state));
    if (block !== null) {
      await this.audit.record({
        action: AUDIT_ACTIONS.orderSubmitCustomerIneligible,
        actorAccountId: user.accountId,
        detail: { ...this.auditDetail(order, 0), reason: block },
      });
      throw new AppError('customer_ineligible', { details: { reason: block } });
    }
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
    this.assertInScope(scope, row);
    return row;
  }

  /** Out of scope (or gone) looks exactly like missing (P-21); used on the row locked for update. */
  private assertInScope(scope: CustomerScope, row: OrderRow | null): asserts row is OrderRow {
    if (row === null || !isCustomerInScope({ sellerCode: row.sellerCode }, scope)) throw new AppError('not_found');
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

  private eligibilityOf(state: CustomerStateRow): { active: boolean; blocked: boolean; sellerCode: number | null } {
    return { active: state.active, blocked: isBlockedRaw(state.blockedRaw), sellerCode: state.sellerCode };
  }

  private async detailOf(order: OrderRow): Promise<OrderDetail> {
    const [items, states] = await Promise.all([
      this.orders.itemsOf(order.id),
      this.mirror.customerStates([order.customerCode]),
    ]);
    // Same media source as the catalog; best effort (a failure degrades to no photos, the order still works).
    const images = await this.images.metadataFor([...new Set(items.map((item) => item.productCode))]);
    const state = states.get(order.customerCode);
    return toOrderDetail(order, items, {
      customerName: state?.name ?? null,
      customerActive: state?.active ?? null,
      customerBlockedRaw: state?.blockedRaw ?? null,
      customerSellerCode: state?.sellerCode ?? null,
      customerLive: state?.live ?? null,
    }, images);
  }

  /** Identifiers and counts only: no notes, no free text. */
  private auditDetail(order: OrderRow, itemCount: number, discountedLineCount = 0): AuditDetail {
    return {
      orderId: order.id,
      draftNumber: order.draftNumber,
      customerCode: order.customerCode,
      version: order.version,
      itemCount,
      // Discounts are sensitive actions (CLAUDE.md §6): the trail shows that lines carry one, never the amounts.
      ...(discountedLineCount > 0 ? { discountedLineCount } : {}),
    };
  }
}
