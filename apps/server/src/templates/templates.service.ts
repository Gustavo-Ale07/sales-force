import { Inject, Injectable } from '@nestjs/common';
import type {
  CreateOrderTemplateRequest,
  OrderTemplateDetail,
  OrderTemplatesResponse,
  ReplaceOrderTemplateRequest,
  UseOrderTemplateRequest,
  UseOrderTemplateResponse,
} from '@salesforce/contracts';
import {
  MAX_TEMPLATES_PER_CUSTOMER,
  canAddTemplate,
  normalizeDecimalString,
  normalizeTemplateItems,
  normalizeTemplateName,
  presentSkips,
  type CustomerScope,
  type TemplateItem,
} from '@salesforce/domain';
import { CustomersService } from '../customers/customers.service.js';
import { AppError } from '../http/app-error.js';
import { AUDIT_ACTIONS, AuditService, type AuditDetail } from '../iam/audit.service.js';
import type { CurrentUser } from '../iam/current-user.js';
import { PolicyService } from '../iam/policy.service.js';
import { DraftBuilder } from '../orders/draft-builder.js';
import type { Executor } from '../orders/orders.repository.js';
import { OrdersService } from '../orders/orders.service.js';
import { uuidv7 } from '../platform/ids.js';
import { CLOCK, type Clock } from '../platform/tokens.js';
import { toTemplate, toTemplateDetail } from './template.mapper.js';
import { templateFingerprint } from './template-fingerprint.js';
import { TemplatesRepository, type TemplateRow } from './templates.repository.js';

export interface TemplateResult {
  readonly template: OrderTemplateDetail;
  /** True when the request id had already created this very template (served as 200, not 201). */
  readonly replayed: boolean;
}

export interface UseTemplateResult {
  readonly result: UseOrderTemplateResponse;
  /** True when the request id had already created this very draft (served as 200, not 201). */
  readonly replayed: boolean;
}

type ParsedTemplate = { readonly name: string; readonly items: TemplateItem[] };

/**
 * Recurring order templates ("pedido recorrente", Phase E). Orchestration only: who may reach a template
 * (the seller scope of its customer, identical 404 outside it), idempotency, optimistic concurrency, locks,
 * transactions and audit. What counts as a valid name or line, the limits and which lines are usable when
 * a template is used are the domain's rules (`normalizeTemplateName`, `normalizeTemplateItems`,
 * `canAddTemplate`, `selectUsableTemplateLines`). A template stores product and quantity only; using it
 * goes through `OrdersService.create`, so the new draft is priced, validated and stored by the very
 * same code as any other draft and is not linked to the template afterwards.
 *
 * ASSUMPTION (owner ruling in the plan, not a formal decision): any actor inside the customer's scope may
 * read, use, edit and delete any template of that customer.
 */
@Injectable()
export class TemplatesService {
  constructor(
    @Inject(PolicyService) private readonly policy: PolicyService,
    @Inject(TemplatesRepository) private readonly templates: TemplatesRepository,
    @Inject(CustomersService) private readonly customers: CustomersService,
    @Inject(OrdersService) private readonly orders: OrdersService,
    @Inject(DraftBuilder) private readonly builder: DraftBuilder,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /* ---------- reads ---------- */

  async list(user: CurrentUser, customerCode: number): Promise<OrderTemplatesResponse> {
    const { scope } = await this.policy.accessContext(user);
    const customer = await this.customers.requireVisible(scope, customerCode);
    const rows = await this.templates.listForCustomer(customer.code);
    return { items: rows.map((row) => toTemplate(row.template, row.itemCount)) };
  }

  async get(user: CurrentUser, id: string): Promise<OrderTemplateDetail> {
    const { scope } = await this.policy.accessContext(user);
    return this.detailOf(await this.loadVisible(scope, id));
  }

  /* ---------- create (idempotent) ---------- */

  async create(user: CurrentUser, customerCode: number, body: CreateOrderTemplateRequest): Promise<TemplateResult> {
    const { scope } = await this.policy.accessContext(user);
    const customer = await this.customers.requireVisible(scope, customerCode);
    const parsed = this.parse(body);
    const fingerprint = templateFingerprint({ customerCode: customer.code, ...parsed });

    const existing = await this.templates.findByRequest(user.accountId, body.clientRequestId);
    if (existing !== null) return { template: await this.replayOf(existing, user, fingerprint, scope), replayed: true };

    const at = this.clock();
    const outcome = await this.templates.transaction(async (tx) => {
      // Lock order (every writer): advisory lock, customer row, template row.
      await this.templates.lockCustomerTemplates(customer.code, tx);
      await this.lockCustomer(scope, customer.code, tx);

      // A retry racing the original request: it is the same request, not a name collision.
      const winner = await this.templates.findByRequest(user.accountId, body.clientRequestId, tx);
      if (winner !== null) return { kind: 'existing' as const, row: winner };

      if (!canAddTemplate(await this.templates.countLive(customer.code, tx))) throw this.limitReached();
      if (await this.templates.nameTaken(customer.code, parsed.name, null, tx)) throw this.nameTaken();

      const row = await this.templates.insertTemplate(
        {
          id: uuidv7(at.getTime()),
          customerCode: customer.code,
          name: parsed.name,
          createdByAccountId: user.accountId,
          clientRequestId: body.clientRequestId,
          requestHash: fingerprint,
          version: 1,
          createdAt: at,
          updatedAt: at,
        },
        tx,
      );
      if (row === null) throw new AppError('conflict');
      await this.templates.insertItems(row.id, parsed.items, tx);
      await this.audit.record(
        {
          action: AUDIT_ACTIONS.orderTemplateCreated,
          actorAccountId: user.accountId,
          detail: this.auditDetail(row, parsed.items.length),
        },
        tx,
      );
      return { kind: 'created' as const, row };
    });

    if (outcome.kind === 'existing') {
      return { template: await this.replayOf(outcome.row, user, fingerprint, scope), replayed: true };
    }
    return { template: await this.detailOf(outcome.row), replayed: false };
  }

  private async replayOf(
    existing: TemplateRow,
    user: CurrentUser,
    fingerprint: string,
    scope: CustomerScope,
  ): Promise<OrderTemplateDetail> {
    // Another content, a deleted template, or one the caller may no longer see: the id is simply unusable.
    // The response never says which, nor shows anything about the existing template.
    const sameRequest =
      existing.createdByAccountId === user.accountId &&
      existing.requestHash === fingerprint &&
      existing.deletedAt === null &&
      (await this.templates.findVisible(scope, existing.id)) !== null;
    if (!sameRequest) throw new AppError('idempotency_conflict');
    return this.detailOf(existing);
  }

  /* ---------- replace / delete ---------- */

  async replace(user: CurrentUser, id: string, body: ReplaceOrderTemplateRequest): Promise<OrderTemplateDetail> {
    const { scope } = await this.policy.accessContext(user);
    const current = await this.loadVisible(scope, id);
    const parsed = this.parse(body);
    this.assertVersion(current, body.expectedVersion);
    const at = this.clock();

    const updated = await this.templates.transaction(async (tx) => {
      await this.templates.lockCustomerTemplates(current.customerCode, tx);
      // Scope first, on the locked rows: a customer moved out of the caller's scope after the unlocked read
      // makes the template look exactly like a missing one, never a version_conflict that shows it exists.
      await this.lockCustomer(scope, current.customerCode, tx);
      const locked = await this.lockTemplate(id, tx);
      this.assertVersion(locked, body.expectedVersion);
      if (await this.templates.nameTaken(locked.customerCode, parsed.name, id, tx)) throw this.nameTaken();

      const row = await this.templates.updateTemplate(
        id,
        { name: parsed.name, version: locked.version + 1, updatedAt: at },
        tx,
      );
      await this.templates.deleteItems(id, tx);
      await this.templates.insertItems(id, parsed.items, tx);
      await this.audit.record(
        {
          action: AUDIT_ACTIONS.orderTemplateReplaced,
          actorAccountId: user.accountId,
          detail: this.auditDetail(row, parsed.items.length),
        },
        tx,
      );
      return row;
    });
    return this.detailOf(updated);
  }

  /** Soft delete: the row stays (its request id can never create another template), orders made from it are untouched. */
  async remove(user: CurrentUser, id: string): Promise<void> {
    const { scope } = await this.policy.accessContext(user);
    const current = await this.loadVisible(scope, id);
    const at = this.clock();

    await this.templates.transaction(async (tx) => {
      await this.templates.lockCustomerTemplates(current.customerCode, tx);
      await this.lockCustomer(scope, current.customerCode, tx);
      const locked = await this.lockTemplate(id, tx);
      const itemCount = (await this.templates.itemsOf(id, tx)).length;
      const row = await this.templates.updateTemplate(
        id,
        { version: locked.version + 1, updatedAt: at, deletedAt: at },
        tx,
      );
      await this.audit.record(
        {
          action: AUDIT_ACTIONS.orderTemplateDeleted,
          actorAccountId: user.accountId,
          detail: this.auditDetail(row, itemCount),
        },
        tx,
      );
    });
  }

  /* ---------- use ---------- */

  /**
   * Creates a NEW draft from the template through `OrdersService.create` (same builder, same validation, same
   * idempotency on the fresh `clientRequestId`). Lines that cannot be ordered now are left out and reported;
   * with none left nothing is created. No negotiation type, note or price is carried over: the template has none.
   */
  async use(user: CurrentUser, id: string, body: UseOrderTemplateRequest): Promise<UseTemplateResult> {
    const context = await this.policy.accessContext(user);
    const template = await this.loadVisible(context.scope, id);
    const customer = await this.customers.requireVisible(context.scope, template.customerCode);
    const items = await this.templates.itemsOf(id);

    const { usable, skipped } = await this.builder.classifyTemplateLines(
      customer,
      items.map((item) => ({
        lineNo: item.lineNo,
        productCode: item.productCode,
        quantity: normalizeDecimalString(item.quantity),
      })),
      context.configuration,
    );
    if (usable.length === 0) {
      throw new AppError('conflict', {
        message:
          'Nenhum item deste modelo pode ser pedido agora (produtos removidos, inativos, indisponíveis ou sem preço). Nenhum pedido foi criado.',
        details: { reason: 'no_usable_lines', skippedLines: presentSkips(user.role, skipped) },
      });
    }

    const { order, replayed } = await this.orders.create(
      user,
      {
        clientRequestId: body.clientRequestId,
        customerCode: customer.code,
        negotiationTypeCode: null,
        notes: null,
        items: usable.map((line) => ({ productCode: line.productCode, quantity: line.quantity })),
      },
      {
        // The draft and the template lock live in one transaction: a template deleted (or a customer moved out of
        // scope) between the read above and the insert yields the same 404 as a missing template.
        beforeInsert: async (tx) => {
          await this.lockCustomer(context.scope, template.customerCode, tx);
          const locked = await this.lockTemplate(id, tx);
          // The lines above were read before this lock: an edit in between makes them stale, so the use is refused.
          this.assertVersion(locked, template.version);
        },
        afterInsert: async (tx, created) => {
          await this.audit.record(
            {
              action: AUDIT_ACTIONS.orderTemplateUsed,
              actorAccountId: user.accountId,
              detail: {
                templateId: id,
                customerCode: template.customerCode,
                orderId: created.id,
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

  /* ---------- helpers ---------- */

  private async loadVisible(scope: CustomerScope, id: string): Promise<TemplateRow> {
    const row = await this.templates.findVisible(scope, id);
    if (row === null) throw new AppError('not_found');
    return row;
  }

  /** The customer row, share-locked, inside the scope; otherwise 404 (P-21). */
  private async lockCustomer(scope: CustomerScope, customerCode: number, tx: Executor): Promise<void> {
    if (!(await this.templates.lockCustomerInScope(scope, customerCode, tx))) throw new AppError('not_found');
  }

  /** The template row locked for update; missing or deleted is 404. */
  private async lockTemplate(id: string, tx: Executor): Promise<TemplateRow> {
    const row = await this.templates.lockTemplate(id, tx);
    if (row === null) throw new AppError('not_found');
    return row;
  }

  private assertVersion(row: TemplateRow, expectedVersion: number): void {
    if (row.version !== expectedVersion) {
      throw new AppError('version_conflict', { details: { currentVersion: row.version } });
    }
  }

  /** Name and lines through the domain rules; problems are reported with stable codes and line positions. */
  private parse(body: { readonly name: string; readonly items: readonly { productCode: number; quantity: string }[] }): ParsedTemplate {
    const issues: { path: string; code: string }[] = [];
    const name = normalizeTemplateName(body.name);
    if (!name.ok) issues.push({ path: 'name', code: name.error });
    const items = normalizeTemplateItems(body.items);
    if (!items.ok) issues.push(...items.error.map((issue) => ({ path: issue.path, code: issue.code })));
    if (!name.ok || !items.ok) throw new AppError('validation_failed', { details: { issues } });
    return { name: name.value, items: items.value };
  }

  private nameTaken(): AppError {
    return new AppError('conflict', {
      message: 'Já existe um modelo com este nome para este cliente. Escolha outro nome.',
      details: { reason: 'template_name_taken' },
    });
  }

  private limitReached(): AppError {
    return new AppError('conflict', {
      message: `Este cliente já tem ${MAX_TEMPLATES_PER_CUSTOMER} modelos recorrentes. Remova um modelo antes de criar outro.`,
      details: { reason: 'template_limit_reached', limit: MAX_TEMPLATES_PER_CUSTOMER },
    });
  }

  private async detailOf(row: TemplateRow): Promise<OrderTemplateDetail> {
    return toTemplateDetail(row, await this.templates.itemsOf(row.id));
  }

  /** Identifiers and counts only: no name, no product code, no quantity. */
  private auditDetail(row: TemplateRow, itemCount: number): AuditDetail {
    return { templateId: row.id, customerCode: row.customerCode, version: row.version, itemCount };
  }
}
