import { integrationOutbox, salesOrder, salesOrderErpHistory, salesOrderErpStage, salesOrderItem, type Database } from '@salesforce/db';
import { erpSubmissionBlock, evaluateOrderEdit, type OrderEditFacts, type OrderEditRefusal } from '@salesforce/domain';
import { AmbiguousOriginError, isBudgetExhaustedError, isRetryableKind, isSankhyaGatewayError, type ErpOrderEditReading } from '@salesforce/sankhya';
import { and, asc, desc, eq, inArray, isNotNull, lt, lte, sql } from 'drizzle-orm';
import { AUDIT_ACTIONS } from '../iam/audit.service.js';
import { maskStoredError } from '../observability/mask-error-message.js';
import { ORDER_EDIT_OPERATION, OrderEditPayloadSchema, type OrderEditPayload } from '../orders/order-edit.js';
import { uuidv7 } from '../platform/ids.js';
import { AUTH_RETRY_DELAY_MS, MAX_DELIVERY_ATTEMPTS, STALE_PROCESSING_MS, backoffMs } from './order-delivery.policy.js';
import { ORDER_DELIVERY_AGGREGATE, ORDER_DELIVERY_OPERATION } from '../orders/order-erp-delivery.js';
import type { OrderDeliveryDeps, RunOptions } from './order-delivery.service.js';

type OutboxRow = typeof integrationOutbox.$inferSelect;
type OrderRow = typeof salesOrder.$inferSelect;

const MESSAGE_MAX = 500;

/** Why an edit was refused, in the words stored on the outbox row (the order itself goes back to its previous state). */
const REFUSAL_TEXT: Record<OrderEditRefusal | 'origin_mismatch' | 'origin_exists' | 'ambiguous_origin' | 'edit_requires_live' | 'order_not_queued' | 'target_blocked' | 'payload_invalid' | 'erp_refused_delete' | 'send_row_missing', string> = {
  confirmed: 'A nota já foi confirmada no Sankhya.',
  invoiced: 'A nota já foi faturada no Sankhya.',
  in_load: 'A nota já está em uma carga no Sankhya.',
  has_release: 'A nota já tem liberações no Sankhya.',
  financial_generated: 'A nota já gerou financeiro definitivo no Sankhya.',
  unknown_status: 'O estado da nota no Sankhya não permite edição.',
  origin_mismatch: 'A nota encontrada não é a nota deste pedido (origem divergente); nada foi excluído.',
  origin_exists: 'Já existe uma nota com a origem deste pedido no Sankhya; nada foi excluído nem reenviado.',
  ambiguous_origin: 'Há mais de uma nota com a origem deste pedido no Sankhya; peça à TI para conferir.',
  edit_requires_live: 'A edição só roda com o envio ao Sankhya ativo.',
  order_not_queued: 'O pedido não está aguardando edição.',
  target_blocked: 'O pedido não é elegível para o ambiente Sankhya deste worker.',
  payload_invalid: 'O comando de edição está inválido.',
  erp_refused_delete: 'O Sankhya recusou a exclusão da nota.',
  send_row_missing: 'O pedido não tem o registro de envio ao Sankhya; nada foi excluído. Peça à TI para conferir.',
};

type RefusalCode = keyof typeof REFUSAL_TEXT;

function toFacts(reading: ErpOrderEditReading): OrderEditFacts {
  return {
    nunota: reading.erpOrderNumber,
    statusnota: reading.statusNota,
    ordemcarga: reading.orderCargo,
    hasReleaseLines: reading.hasReleaseLines,
    hasInvoiceLink: reading.hasInvoiceLink,
    hasDefinitiveFinancial: reading.hasDefinitiveFinancial,
  };
}

/**
 * Worker side of "Editar pedido" (owner ruling 2026-11-27; spike F-51, §9.67). One `edit_order` outbox row per command:
 *
 *  1. read the old note LIVE (fail-closed) and refuse unless it is still unconfirmed and untouched (`evaluateOrderEdit`);
 *  2. prove the note is ours (the origin lookup returns exactly this NUNOTA) and only then call `CACSP.excluirNotas`;
 *  3. in ONE transaction: history row (old NUNOTA), clear the order's NUNOTA and stage, apply the edited snapshot and put the
 *     order's normal `send_order` row back to `pending` (same origin id, SNK-4). The normal delivery then does the origin check,
 *     the include, the reread and the confirmation, and its failures land the order in "Precisa de correção" (re-editable).
 *
 * Resumable without heuristics: after a crash the NUNOTA is read directly; a note that is gone was deleted by an earlier
 * attempt, so it is never deleted twice and the transaction of step 3 simply runs. A refused edit changes nothing in the order.
 * The recreated note reuses the order's own origin id: the deleted note is physically gone (F-51), so the lookup cannot find it.
 */
export class OrderEditDelivery {
  constructor(private readonly deps: OrderDeliveryDeps) {}

  private get database(): Database {
    return this.deps.db.db;
  }

  async runDue(options: RunOptions = {}): Promise<number> {
    await this.recoverStale();
    const limit = options.limit ?? 25;
    let processed = 0;
    while (processed < limit && options.signal?.aborted !== true) {
      if (this.deps.budget?.exhausted === true) break;
      const claimed = await this.claimNext();
      if (claimed === null) break;
      processed += 1;
      try {
        await (this.deps.budget === undefined ? this.deliver(claimed, options.signal) : this.deps.budget.run(() => this.deliver(claimed, options.signal)));
      } catch (error) {
        // A bug or a database failure: the row stays `processing` and is recovered as `unknown` (resumed by reading the note).
        this.deps.logger.error({ err: error, outboxId: claimed.id }, 'order edit attempt failed unexpectedly');
      }
    }
    return processed;
  }

  private async recoverStale(): Promise<void> {
    const now = this.deps.now();
    const cutoff = new Date(now.getTime() - STALE_PROCESSING_MS);
    await this.database
      .update(integrationOutbox)
      .set({ status: 'unknown', nextAttemptAt: now, lastStep: 'waiting_retry', lastErrorClass: 'interrupted', lastErrorMessage: 'The worker stopped during the edit; it resumes by reading the note.', updatedAt: now })
      .where(
        and(
          eq(integrationOutbox.aggregateType, ORDER_DELIVERY_AGGREGATE),
          eq(integrationOutbox.operation, ORDER_EDIT_OPERATION),
          eq(integrationOutbox.status, 'processing'),
          lt(integrationOutbox.updatedAt, cutoff),
        ),
      );
  }

  private async claimNext(): Promise<OutboxRow | null> {
    const now = this.deps.now();
    return this.database.transaction(async (tx) => {
      const [due] = await tx
        .select()
        .from(integrationOutbox)
        .where(
          and(
            eq(integrationOutbox.aggregateType, ORDER_DELIVERY_AGGREGATE),
            eq(integrationOutbox.operation, ORDER_EDIT_OPERATION),
            inArray(integrationOutbox.status, ['pending', 'unknown']),
            isNotNull(integrationOutbox.nextAttemptAt),
            lte(integrationOutbox.nextAttemptAt, now),
          ),
        )
        .orderBy(asc(integrationOutbox.nextAttemptAt), asc(integrationOutbox.createdAt))
        .limit(1)
        .for('update', { skipLocked: true });
      if (due === undefined) return null;
      const [row] = await tx
        .update(integrationOutbox)
        .set({ status: 'processing', attemptCount: sql`${integrationOutbox.attemptCount} + 1`, lastStep: 'verifying_origin', updatedAt: now })
        .where(eq(integrationOutbox.id, due.id))
        .returning();
      return row ?? null;
    });
  }

  private async deliver(row: OutboxRow, signal: AbortSignal | undefined): Promise<void> {
    const { settings, gateway, logger } = this.deps;
    const options = signal === undefined ? {} : { signal };
    const parsed = OrderEditPayloadSchema.safeParse(row.payload);
    const [order] = await this.database.select().from(salesOrder).where(eq(salesOrder.id, row.aggregateId));
    if (!parsed.success) {
      await this.refuse(row, order ?? null, null, 'payload_invalid');
      return;
    }
    const { edit } = parsed.data;
    if (order === undefined || order.status !== 'queued') {
      await this.refuse(row, null, edit, 'order_not_queued');
      return;
    }
    if (settings.mode !== 'live') {
      await this.refuse(row, order, edit, 'edit_requires_live');
      return;
    }
    if (erpSubmissionBlock(order, settings.target) !== null) {
      await this.refuse(row, order, edit, 'target_blocked');
      return;
    }

    // Fail closed BEFORE any ERP call: without the order's own send_order row the edit cannot be completed (nothing is deleted).
    const [sendRow] = await this.database
      .select({ id: integrationOutbox.id })
      .from(integrationOutbox)
      .where(and(eq(integrationOutbox.aggregateType, ORDER_DELIVERY_AGGREGATE), eq(integrationOutbox.operation, ORDER_DELIVERY_OPERATION), eq(integrationOutbox.aggregateId, order.id)))
      .limit(1);
    if (sendRow === undefined) {
      await this.refuse(row, order, edit, 'send_row_missing');
      return;
    }

    let deleteCalled = false;
    try {
      const oldNumber = edit.oldErpNumber;
      if (oldNumber === null) {
        // Nothing was ever written (refused delivery): editing is only sending the edited order. SNK-4: if the ERP already has a
        // note with this origin id the delivery is not restarted blindly (that note is handled by the normal verify path).
        if ((await gateway.findOrderByOrigin(settings.originField, order.id, options)) !== null) {
          await this.refuse(row, order, edit, 'origin_exists');
          return;
        }
      } else {
        const [reading] = await gateway.readOrderEditFacts([oldNumber], options);
        if (reading === undefined) throw new Error('readOrderEditFacts returned no entry');
        if (reading.found) {
          // Live, fail-closed eligibility (every fact must prove the note untouched).
          const verdict = evaluateOrderEdit(toFacts(reading));
          if (!verdict.canEdit) {
            await this.refuse(row, order, edit, verdict.reason);
            return;
          }
          // Never delete a note that is not proven to be this order's own (SNK-4): the origin lookup must return exactly this NUNOTA.
          const byOrigin = await gateway.findOrderByOrigin(settings.originField, order.id, options);
          if (byOrigin === null || byOrigin.erpOrderNumber !== oldNumber) {
            await this.refuse(row, order, edit, 'origin_mismatch');
            return;
          }
          deleteCalled = true;
          await this.setStep(row.id, 'sending');
          await gateway.deleteOrder(oldNumber, options);
          logger.info({ outboxId: row.id, orderId: order.id, erpNumber: oldNumber }, 'old ERP note deleted for an order edit');
        }
        // A note that is no longer there was deleted by an earlier attempt of this same command: resume, never delete again.
        // The origin must now be free (the deleted note is physically gone, F-51); anything found is not adopted here.
        deleteCalled = true;
        if ((await gateway.findOrderByOrigin(settings.originField, order.id, options)) !== null) {
          await this.park(row, 'origin_still_present', 'A nota antiga foi excluída mas ainda há uma nota com a origem deste pedido; peça à TI para conferir.');
          return;
        }
      }
      await this.applyAndRequeue(row, order, edit);
    } catch (error) {
      if (signal?.aborted === true && !isSankhyaGatewayError(error)) throw error;
      if (isBudgetExhaustedError(error)) {
        await this.database
          .update(integrationOutbox)
          .set({ status: 'pending', attemptCount: sql`greatest(${integrationOutbox.attemptCount} - 1, 0)`, nextAttemptAt: this.deps.now(), lastErrorClass: 'budget_exhausted', updatedAt: this.deps.now() })
          .where(eq(integrationOutbox.id, row.id));
        return;
      }
      if (error instanceof AmbiguousOriginError) {
        if (deleteCalled) await this.park(row, 'ambiguous_origin', REFUSAL_TEXT.ambiguous_origin);
        else await this.refuse(row, order, edit, 'ambiguous_origin');
        return;
      }
      if (isSankhyaGatewayError(error)) {
        if (error.kind === 'validation' && error.code === 'erp_refused_delete') {
          await this.refuse(row, order, edit, 'erp_refused_delete');
          return;
        }
        if (error.kind === 'auth') {
          await this.retryLater(row, error.code, error.message, AUTH_RETRY_DELAY_MS, false);
          return;
        }
        if (isRetryableKind(error.kind) && row.attemptCount < MAX_DELIVERY_ATTEMPTS) {
          await this.retryLater(row, error.code, error.message, backoffMs(row.attemptCount), true);
          return;
        }
        if (!deleteCalled) {
          await this.refuse(row, order, edit, 'erp_refused_delete');
          return;
        }
        await this.park(row, error.code, error.message);
        return;
      }
      await this.park(row, 'unclassified', 'Falha não classificada durante a edição.');
      logger.error({ err: error, outboxId: row.id }, 'order edit failed with an unclassified error');
    }
  }

  /** Step 3: one transaction. After it the normal delivery owns the recreation. */
  private async applyAndRequeue(row: OutboxRow, order: OrderRow, edit: OrderEditPayload['edit']): Promise<void> {
    const at = this.deps.now();
    const { header, items } = edit.snapshot;
    await this.database.transaction(async (tx) => {
      if (edit.oldErpNumber !== null) {
        await tx
          .insert(salesOrderErpHistory)
          .values({ id: uuidv7(at.getTime()), orderId: order.id, erpNumber: edit.oldErpNumber, editedByAccountId: edit.actorAccountId, replacedAt: at })
          .onConflictDoNothing({ target: [salesOrderErpHistory.orderId, salesOrderErpHistory.erpNumber] });
        await tx.delete(salesOrderErpStage).where(eq(salesOrderErpStage.orderId, order.id));
      }
      await tx
        .update(salesOrder)
        .set({
          ...header,
          erpNumber: null,
          erpStatusCode: null,
          erpStatusLabel: null,
          erpInvoiceNumber: null,
          erpStatusCheckedAt: null,
          erpStatusDetail: null,
          erpMissingChecks: 0,
          status: 'queued',
          version: sql`${salesOrder.version} + 1`,
          updatedAt: at,
        })
        .where(eq(salesOrder.id, order.id));
      await tx.delete(salesOrderItem).where(eq(salesOrderItem.orderId, order.id));
      if (items.length > 0) {
        await tx.insert(salesOrderItem).values(
          items.map((item) => ({
            id: uuidv7(at.getTime()),
            orderId: order.id,
            lineNo: item.lineNo,
            productCode: item.productCode,
            productDescription: item.productDescription,
            unit: item.unit === '' ? null : item.unit,
            quantity: item.quantity,
            unitListPrice: item.unitListPrice,
            priceState: item.priceState,
            priceTableCode: item.priceTableCode,
            priceVersionId: item.priceVersionId,
            discountPercent: item.discountPercent,
            estimatedLineTotal: item.estimatedLineTotal,
          })),
        );
      }
      // The order's own send row (same id and origin id, SNK-4) goes back to pending with a clean slate; the header is resolved again.
      const [send] = await tx
        .select({ id: integrationOutbox.id })
        .from(integrationOutbox)
        .where(and(eq(integrationOutbox.aggregateType, ORDER_DELIVERY_AGGREGATE), eq(integrationOutbox.operation, ORDER_DELIVERY_OPERATION), eq(integrationOutbox.aggregateId, order.id)))
        .orderBy(desc(integrationOutbox.createdAt))
        .limit(1)
        .for('update');
      // The API guarantees this row when it records the command; the worker role has no INSERT on the outbox (least privilege).
      if (send === undefined) throw new Error('send_order row missing');
      await tx
        .update(integrationOutbox)
        .set({ status: 'pending', attemptCount: 0, nextAttemptAt: at, lastStep: 'verifying_origin', lastErrorClass: null, lastErrorMessage: null, erpReference: null, payload: {}, updatedAt: at })
        .where(eq(integrationOutbox.id, send.id));
      await tx
        .update(integrationOutbox)
        .set({ status: 'confirmed', nextAttemptAt: null, lastStep: 'confirmed', lastErrorClass: null, lastErrorMessage: null, erpReference: edit.oldErpNumber === null ? null : String(edit.oldErpNumber), updatedAt: at })
        .where(eq(integrationOutbox.id, row.id));
      await this.deps.audit.record(
        {
          action: AUDIT_ACTIONS.orderEditDeleted,
          actorAccountId: edit.actorAccountId,
          detail: { orderId: order.id, outboxId: row.id, itemCount: items.length, ...(edit.operator === undefined ? {} : { actor: 'cli', operator: edit.operator }), ...(edit.oldErpNumber === null ? {} : { oldErpNumber: edit.oldErpNumber }) },
        },
        tx,
      );
    });
    this.deps.logger.info({ outboxId: row.id, orderId: order.id, oldErpNumber: edit.oldErpNumber }, 'order edit applied; the order is queued for recreation');
  }

  /** Refused (nothing was deleted or the ERP kept the note): the order goes back to its previous state, untouched. */
  private async refuse(row: OutboxRow, order: OrderRow | null, edit: OrderEditPayload['edit'] | null, code: RefusalCode): Promise<void> {
    const at = this.deps.now();
    await this.database.transaction(async (tx) => {
      await tx
        .update(integrationOutbox)
        .set({ status: 'rejected', nextAttemptAt: null, lastStep: null, lastErrorClass: 'validation', lastErrorMessage: maskStoredError(`${code}: ${REFUSAL_TEXT[code]}`).slice(0, MESSAGE_MAX), updatedAt: at })
        .where(eq(integrationOutbox.id, row.id));
      if (order !== null && edit !== null && order.status === 'queued') {
        await tx
          .update(salesOrder)
          .set({ status: edit.previousStatus, version: sql`${salesOrder.version} + 1`, updatedAt: at })
          .where(and(eq(salesOrder.id, order.id), eq(salesOrder.status, 'queued')));
        await this.deps.audit.record(
          { action: AUDIT_ACTIONS.orderEditRefused, actorAccountId: edit.actorAccountId, detail: { orderId: order.id, outboxId: row.id, reason: code, ...(edit.oldErpNumber === null ? {} : { oldErpNumber: edit.oldErpNumber }) } },
          tx,
        );
      }
    });
    this.deps.logger.warn({ outboxId: row.id, orderId: row.aggregateId, reason: code }, 'order edit refused; nothing was changed');
  }

  private async retryLater(row: OutboxRow, code: string, message: string, delayMs: number, consumesAttempt: boolean): Promise<void> {
    const at = this.deps.now();
    await this.database
      .update(integrationOutbox)
      .set({
        status: 'unknown',
        nextAttemptAt: new Date(at.getTime() + delayMs),
        lastStep: 'waiting_retry',
        lastErrorClass: 'temporary',
        lastErrorMessage: maskStoredError(`${code}: ${message}`).slice(0, MESSAGE_MAX),
        ...(consumesAttempt ? {} : { attemptCount: sql`greatest(${integrationOutbox.attemptCount} - 1, 0)` }),
        updatedAt: at,
      })
      .where(eq(integrationOutbox.id, row.id));
  }

  /** Needs a person: the row stays `unknown` with no next attempt and the order stays queued (never retried blindly). */
  private async park(row: OutboxRow, code: string, message: string): Promise<void> {
    const at = this.deps.now();
    await this.database
      .update(integrationOutbox)
      .set({ status: 'unknown', nextAttemptAt: null, lastStep: 'waiting_retry', lastErrorClass: 'permanent', lastErrorMessage: maskStoredError(`${code}: ${message}`).slice(0, MESSAGE_MAX), updatedAt: at })
      .where(eq(integrationOutbox.id, row.id));
    this.deps.logger.error({ outboxId: row.id, orderId: row.aggregateId, code }, 'order edit parked: needs a person');
  }

  private async setStep(outboxId: string, step: 'sending'): Promise<void> {
    await this.database.update(integrationOutbox).set({ lastStep: step, updatedAt: this.deps.now() }).where(eq(integrationOutbox.id, outboxId));
  }
}
