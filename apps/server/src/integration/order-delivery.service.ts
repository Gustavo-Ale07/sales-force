import {
  integrationOrderDryRun,
  integrationOutbox,
  installationConfigurationVersion,
  salesOrder,
  salesOrderItem,
  type Database,
  type DbHandle,
  type OutboxStep,
} from '@salesforce/db';
import { erpSubmissionBlock, type ErpSubmissionTarget, type InstallationConfiguration } from '@salesforce/domain';
import { isSankhyaGatewayError, SankhyaGatewayError, type SankhyaOrderReadPort, type SankhyaWritePort } from '@salesforce/sankhya';
import { and, asc, eq, inArray, isNotNull, lt, lte, sql } from 'drizzle-orm';
import { validateInstallationConfiguration } from '../configuration/validate.js';
import { AUDIT_ACTIONS, type AuditDetail, type AuditService } from '../iam/audit.service.js';
import type { Logger } from '../observability/logger.js';
import { uuidv7 } from '../platform/ids.js';
import type { Clock } from '../platform/tokens.js';
import {
  STALE_PROCESSING_MS,
  decideFailure,
  type DeliveryOutcome,
  type DeliveryPhase,
} from './order-delivery.policy.js';
import {
  FrozenHeaderSchema,
  buildOrderRequest,
  dryRunRecord,
  resolveHeader,
  verifyWrittenOrder,
  type DeliveryItem,
  type DeliveryOrder,
  type FrozenHeader,
} from './order-request.js';

/** The outbox operation and aggregate of an order delivery. */
export const ORDER_DELIVERY_AGGREGATE = 'sales_order';
export const ORDER_DELIVERY_OPERATION = 'send_order';

export type OrderDeliveryGateway = SankhyaWritePort & SankhyaOrderReadPort;

export interface OrderDeliverySettings {
  /** `dry_run` builds and stores the payload; `live` sends it (Sandbox only, validated at boot). */
  readonly mode: 'dry_run' | 'live';
  /** Dedicated origin field (SNK-5). Empty never reaches here: the worker config refuses it. */
  readonly originField: string;
  /** Header TOPs that are included but never confirmed (D-4: quotation 1000). */
  readonly unconfirmedTops: readonly number[];
  /** The ERP environment this worker may send to; an order bound to another one is refused (SNK-6). */
  readonly target: ErpSubmissionTarget;
}

export interface OrderDeliveryDeps {
  readonly db: DbHandle;
  /** Used in `live` mode only; `dry_run` never touches it. */
  readonly gateway: OrderDeliveryGateway;
  readonly settings: OrderDeliverySettings;
  readonly audit: Pick<AuditService, 'record'>;
  readonly logger: Logger;
  readonly now: Clock;
}

export interface RunOptions {
  readonly signal?: AbortSignal | undefined;
  /** Orders handled by one sweep (default 25). */
  readonly limit?: number | undefined;
}

export interface RunSummary {
  readonly processed: number;
  readonly recovered: number;
}

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
type OutboxRow = typeof integrationOutbox.$inferSelect;
type OrderRow = typeof salesOrder.$inferSelect;

interface Claimed {
  readonly row: OutboxRow;
  readonly previousStatus: 'pending' | 'unknown';
}

const DEFAULT_SWEEP_LIMIT = 25;
const MESSAGE_MAX = 500;

/** A configuration problem is operational, not the order's fault: retried like a temporary failure. */
class ConfigurationUnavailableError extends SankhyaGatewayError {
  constructor(message: string) {
    super('temporary', { code: 'configuration_unavailable', message });
  }
}

function parseErpNumber(reference: string | null): number | null {
  if (reference === null || !/^[1-9]\d{0,9}$/.test(reference)) return null;
  const value = Number(reference);
  return value <= 2_147_483_647 ? value : null;
}

function describeError(error: unknown): string {
  // Gateway messages are secret-free by contract (errors.ts); anything else is reduced to its type.
  if (isSankhyaGatewayError(error)) return error.message.slice(0, MESSAGE_MAX);
  return `${error instanceof Error ? error.name : 'Error'}: unclassified failure`;
}

/**
 * Consumer of the order delivery outbox (SNK-7, STACK-6): the ONLY place that sends an order to the ERP.
 *
 * Invariants:
 *  - SNK-4: before ANY send or resend the ERP is asked, by the dedicated origin field, whether the order
 *    already exists; if it does it is linked, never sent again. The origin id is the order UUID on every
 *    attempt, and the header values resolved from configuration are frozen on the outbox row at the first
 *    attempt, so a resend is byte-identical.
 *  - No network call happens inside a database transaction.
 *  - Failures are classified (`order-delivery.policy.ts`): a business refusal is never retried; a result
 *    that may hide a created order is `unknown` and re-verified, never resent blindly.
 *  - `dry_run` builds and stores the payload and calls nothing.
 */
export class OrderDeliveryService {
  constructor(private readonly deps: OrderDeliveryDeps) {}

  private get database(): Database {
    return this.deps.db.db;
  }

  /** One sweep: rows left `processing` by a dead worker become `unknown`, then due rows are delivered one by one. */
  async runDue(options: RunOptions = {}): Promise<RunSummary> {
    const recovered = await this.recoverStale();
    const limit = options.limit ?? DEFAULT_SWEEP_LIMIT;
    let processed = 0;
    while (processed < limit && options.signal?.aborted !== true) {
      const claimed = await this.claimNext();
      if (claimed === null) break;
      processed += 1;
      try {
        await this.deliver(claimed, options.signal);
      } catch (error) {
        // A bug or a database failure while recording the outcome: the row stays `processing` and is
        // recovered as `unknown` (never resent without verification). Surface it, keep the sweep alive.
        this.deps.logger.error({ err: error, outboxId: claimed.row.id }, 'order delivery attempt failed unexpectedly');
      }
    }
    return { processed, recovered };
  }

  /** Retention (D-6): dry-run records older than the retention window are deleted. */
  async purgeDryRuns(retentionDays = 30): Promise<number> {
    const cutoff = new Date(this.deps.now().getTime() - retentionDays * 24 * 3600_000);
    const deleted = await this.database
      .delete(integrationOrderDryRun)
      .where(lt(integrationOrderDryRun.createdAt, cutoff))
      .returning({ id: integrationOrderDryRun.id });
    return deleted.length;
  }

  /* ---------- claim / recovery ---------- */

  private async recoverStale(): Promise<number> {
    const now = this.deps.now();
    const cutoff = new Date(now.getTime() - STALE_PROCESSING_MS);
    return this.database.transaction(async (tx) => {
      const stale = await tx
        .select({ id: integrationOutbox.id, aggregateId: integrationOutbox.aggregateId })
        .from(integrationOutbox)
        .where(
          and(
            eq(integrationOutbox.aggregateType, ORDER_DELIVERY_AGGREGATE),
            eq(integrationOutbox.operation, ORDER_DELIVERY_OPERATION),
            eq(integrationOutbox.status, 'processing'),
            lt(integrationOutbox.updatedAt, cutoff),
          ),
        )
        .for('update', { skipLocked: true });
      for (const item of stale) {
        await tx
          .update(integrationOutbox)
          .set({
            status: 'unknown',
            nextAttemptAt: now,
            lastStep: 'waiting_retry',
            lastErrorClass: 'interrupted',
            lastErrorMessage: 'The worker stopped during the attempt; the order will be verified by origin id before any resend.',
            updatedAt: now,
          })
          .where(eq(integrationOutbox.id, item.id));
        await this.setOrderStatus(tx, item.aggregateId, ['queued'], 'unknown', now);
      }
      return stale.length;
    });
  }

  private async claimNext(): Promise<Claimed | null> {
    const now = this.deps.now();
    return this.database.transaction(async (tx) => {
      const [due] = await tx
        .select()
        .from(integrationOutbox)
        .where(
          and(
            eq(integrationOutbox.aggregateType, ORDER_DELIVERY_AGGREGATE),
            eq(integrationOutbox.operation, ORDER_DELIVERY_OPERATION),
            inArray(integrationOutbox.status, ['pending', 'unknown']),
            isNotNull(integrationOutbox.nextAttemptAt),
            lte(integrationOutbox.nextAttemptAt, now),
          ),
        )
        .orderBy(asc(integrationOutbox.nextAttemptAt), asc(integrationOutbox.createdAt))
        .limit(1)
        .for('update', { skipLocked: true });
      if (due === undefined) return null;
      const previousStatus = due.status === 'unknown' ? 'unknown' : 'pending';
      const [row] = await tx
        .update(integrationOutbox)
        .set({
          status: 'processing',
          attemptCount: sql`${integrationOutbox.attemptCount} + 1`,
          lastStep: 'verifying_origin',
          updatedAt: now,
        })
        .where(eq(integrationOutbox.id, due.id))
        .returning();
      return row === undefined ? null : { row, previousStatus };
    });
  }

  /* ---------- one delivery attempt ---------- */

  private async deliver(claimed: Claimed, signal: AbortSignal | undefined): Promise<void> {
    const { row } = claimed;
    const { settings, logger } = this.deps;
    const loaded = await this.loadOrder(row.aggregateId);
    if (loaded === null || (loaded.order.status !== 'queued' && loaded.order.status !== 'unknown')) {
      await this.finishRejected(row, loaded?.order ?? null, 'inconsistent_order', 'order_not_deliverable', 'The order is not in a deliverable state.', false);
      return;
    }
    const { order, items } = loaded;
    const block = erpSubmissionBlock(order, settings.target);
    if (block !== null) {
      await this.finishRejected(row, order, 'validation', block, 'The order is not eligible for the target ERP environment.', false);
      return;
    }

    let phase: DeliveryPhase = 'verify';
    let erpNumber = parseErpNumber(row.erpReference);
    const mayExist = claimed.previousStatus === 'unknown' || erpNumber !== null;
    try {
      const frozen = await this.resolveFrozen(row, order);
      if (!frozen.ok) {
        await this.finishRejected(row, order, 'validation', frozen.code, frozen.message, erpNumber !== null);
        return;
      }
      const delivery = toDelivery(order);
      const built = buildOrderRequest(delivery, items, frozen.header, settings.originField);
      if (!built.ok) {
        await this.finishRejected(row, order, 'validation', built.code, built.message, erpNumber !== null);
        return;
      }
      const request = built.value;

      if (settings.mode === 'dry_run') {
        await this.storeDryRun(row, order, dryRunRecord(request));
        return;
      }

      // SNK-4: ask the ERP by origin id first, on EVERY attempt.
      const found = await this.deps.gateway.findOrderByOrigin(settings.originField, order.id, signal === undefined ? {} : { signal });
      let confirmed = false;
      if (found !== null) {
        erpNumber = found.erpOrderNumber;
        confirmed = found.confirmed;
        await this.recordErpNumber(row, order, erpNumber, 'linked_existing');
        logger.info({ outboxId: row.id, orderId: order.id, erpNumber }, 'order already in the ERP: linked, not resent');
      } else {
        if (erpNumber !== null) {
          // The number was recorded but the origin lookup cannot see it: do NOT send again.
          throw new SankhyaGatewayError('temporary', {
            code: 'origin_not_found_after_include',
            message: 'The ERP order number is known but the origin lookup does not find the order; not resent.',
          });
        }
        phase = 'include';
        await this.setStep(row.id, 'sending');
        const included = await this.deps.gateway.includeOrder(request, signal === undefined ? {} : { signal });
        erpNumber = included.erpOrderNumber;
        await this.recordErpNumber(row, order, erpNumber, 'awaiting_confirmation');
      }

      const needsConfirmation = !confirmed && !settings.unconfirmedTops.includes(frozen.header.topCode);
      if (needsConfirmation) {
        phase = 'confirm';
        await this.deps.gateway.confirmOrder(erpNumber, signal === undefined ? {} : { signal });
      }

      phase = 'reread';
      const written = await this.deps.gateway.readWrittenOrder(erpNumber, signal === undefined ? {} : { signal });
      if (written === null) {
        throw new SankhyaGatewayError('temporary', { code: 'order_not_readable', message: 'The written order cannot be read back yet.' });
      }
      const verdict = verifyWrittenOrder(items, written);
      if (!verdict.ok) {
        // D-7: the ERP stored something other than what was sent. The order exists there: keep its number.
        await this.finishRejected(row, order, 'validation', verdict.code, `The ERP stored a different ${verdict.code === 'discount_divergence' ? 'discount' : 'price or line'} (product ${verdict.productCode}).`, true);
        return;
      }
      await this.finishSent(row, order, erpNumber);
    } catch (error) {
      if (signal?.aborted === true && !isSankhyaGatewayError(error)) throw error;
      const outcome = decideFailure(error, {
        phase,
        attemptCount: row.attemptCount,
        mayExist,
        hasErpNumber: erpNumber !== null,
      });
      await this.applyOutcome(row, order, outcome, describeError(error), erpNumber, phase);
    }
  }

  private async resolveFrozen(row: OutboxRow, order: OrderRow): Promise<{ ok: true; header: FrozenHeader } | { ok: false; code: string; message: string }> {
    const stored = FrozenHeaderSchema.safeParse((row.payload as { frozen?: unknown } | null)?.frozen);
    if (stored.success) return { ok: true, header: stored.data };
    const config = await this.loadConfiguration();
    const resolved = resolveHeader(toDelivery(order), config);
    if (!resolved.ok) return resolved;
    // Dry run never freezes: nothing was decided for a real send yet.
    if (this.deps.settings.mode === 'live') {
      await this.database
        .update(integrationOutbox)
        .set({ payload: { frozen: resolved.value }, updatedAt: this.deps.now() })
        .where(eq(integrationOutbox.id, row.id));
    }
    return { ok: true, header: resolved.value };
  }

  private async loadConfiguration(): Promise<InstallationConfiguration> {
    const [current] = await this.database
      .select({ payload: installationConfigurationVersion.payload })
      .from(installationConfigurationVersion)
      .where(eq(installationConfigurationVersion.isCurrent, true));
    if (current === undefined) throw new ConfigurationUnavailableError('No current installation configuration.');
    const validated = validateInstallationConfiguration(current.payload);
    if (!validated.ok) throw new ConfigurationUnavailableError('The current installation configuration is invalid.');
    return validated.value;
  }

  private async loadOrder(orderId: string): Promise<{ order: OrderRow; items: DeliveryItem[] } | null> {
    const [order] = await this.database.select().from(salesOrder).where(eq(salesOrder.id, orderId));
    if (order === undefined) return null;
    const lines = await this.database
      .select()
      .from(salesOrderItem)
      .where(eq(salesOrderItem.orderId, orderId))
      .orderBy(asc(salesOrderItem.lineNo));
    return {
      order,
      items: lines.map((line) => ({
        productCode: line.productCode,
        unit: line.unit,
        quantity: line.quantity,
        unitListPrice: line.unitListPrice,
        discountPercent: line.discountPercent,
        priceState: line.priceState,
      })),
    };
  }

  /* ---------- persistence of outcomes (each one atomic, none holds a network call) ---------- */

  private async setStep(outboxId: string, step: OutboxStep): Promise<void> {
    await this.database.update(integrationOutbox).set({ lastStep: step, updatedAt: this.deps.now() }).where(eq(integrationOutbox.id, outboxId));
  }

  /** The ERP number is stored the moment it is known (outbox and order), before any further step. */
  private async recordErpNumber(row: OutboxRow, order: OrderRow, erpNumber: number, step: OutboxStep): Promise<void> {
    const at = this.deps.now();
    await this.database.transaction(async (tx) => {
      await tx
        .update(integrationOutbox)
        .set({ erpReference: String(erpNumber), lastStep: step, updatedAt: at })
        .where(eq(integrationOutbox.id, row.id));
      if (order.erpNumber === null) {
        await tx.update(salesOrder).set({ erpNumber, updatedAt: at }).where(eq(salesOrder.id, order.id));
      }
    });
  }

  private async setOrderStatus(
    tx: Tx,
    orderId: string,
    from: readonly OrderRow['status'][],
    to: 'unknown' | 'sent' | 'rejected',
    at: Date,
    erpNumber?: number,
  ): Promise<boolean> {
    const updated = await tx
      .update(salesOrder)
      .set({
        status: to,
        version: sql`${salesOrder.version} + 1`,
        updatedAt: at,
        ...(erpNumber === undefined ? {} : { erpNumber }),
      })
      .where(and(eq(salesOrder.id, orderId), inArray(salesOrder.status, [...from])))
      .returning({ id: salesOrder.id });
    return updated.length > 0;
  }

  private async finishSent(row: OutboxRow, order: OrderRow, erpNumber: number): Promise<void> {
    const at = this.deps.now();
    await this.database.transaction(async (tx) => {
      await tx
        .update(integrationOutbox)
        .set({
          status: 'confirmed',
          nextAttemptAt: null,
          lastStep: 'confirmed',
          lastErrorClass: null,
          lastErrorMessage: null,
          erpReference: String(erpNumber),
          updatedAt: at,
        })
        .where(eq(integrationOutbox.id, row.id));
      await this.setOrderStatus(tx, order.id, ['queued', 'unknown'], 'sent', at, order.erpNumber ?? erpNumber);
      await this.deps.audit.record(
        { action: AUDIT_ACTIONS.orderErpSent, actorAccountId: null, detail: this.detail(row, order, { erpOrderNumber: erpNumber }) },
        tx,
      );
    });
    this.deps.logger.info({ outboxId: row.id, orderId: order.id, erpNumber, attempts: row.attemptCount }, 'order delivered to the ERP');
  }

  private async finishRejected(
    row: OutboxRow,
    order: OrderRow | null,
    errorClass: string,
    errorCode: string,
    message: string,
    keepNumber: boolean,
  ): Promise<void> {
    const at = this.deps.now();
    await this.database.transaction(async (tx) => {
      await tx
        .update(integrationOutbox)
        .set({
          status: 'rejected',
          nextAttemptAt: null,
          lastStep: null,
          lastErrorClass: errorClass,
          lastErrorMessage: `${errorCode}: ${message}`.slice(0, MESSAGE_MAX),
          updatedAt: at,
        })
        .where(eq(integrationOutbox.id, row.id));
      if (order !== null && (order.status === 'queued' || order.status === 'unknown')) {
        await this.setOrderStatus(tx, order.id, ['queued', 'unknown'], 'rejected', at);
        await this.deps.audit.record(
          {
            action: AUDIT_ACTIONS.orderErpRejected,
            actorAccountId: null,
            detail: this.detail(row, order, { errorClass, errorCode, keptErpNumber: keepNumber }),
          },
          tx,
        );
      }
    });
    this.deps.logger.warn({ outboxId: row.id, orderId: row.aggregateId, errorClass, errorCode }, 'order delivery rejected');
  }

  private async applyOutcome(
    row: OutboxRow,
    order: OrderRow,
    outcome: DeliveryOutcome,
    message: string,
    erpNumber: number | null,
    phase: DeliveryPhase,
  ): Promise<void> {
    if (outcome.kind === 'reject') {
      await this.finishRejected(row, order, outcome.errorClass, outcome.errorCode, message, erpNumber !== null);
      return;
    }
    const at = this.deps.now();
    const awaitingConfirmation = erpNumber !== null && phase !== 'verify';
    const status = outcome.kind === 'park' ? 'unknown' : outcome.status;
    const nextAttemptAt = outcome.kind === 'park' ? null : new Date(at.getTime() + outcome.delayMs);
    const step: OutboxStep = outcome.kind === 'retry' ? 'waiting_retry' : awaitingConfirmation ? 'awaiting_confirmation' : 'waiting_retry';
    await this.database.transaction(async (tx) => {
      await tx
        .update(integrationOutbox)
        .set({
          status,
          nextAttemptAt,
          lastStep: step,
          lastErrorClass: outcome.errorClass,
          lastErrorMessage: `${outcome.errorCode}: ${message}`.slice(0, MESSAGE_MAX),
          // An authentication failure does not consume an attempt (repeating it can lock the integration user).
          ...(outcome.kind === 'retry' && !outcome.consumesAttempt ? { attemptCount: sql`greatest(${integrationOutbox.attemptCount} - 1, 0)` } : {}),
          updatedAt: at,
        })
        .where(eq(integrationOutbox.id, row.id));
      if (status === 'unknown') {
        const moved = await this.setOrderStatus(tx, order.id, ['queued'], 'unknown', at);
        if (moved || outcome.kind === 'park') {
          await this.deps.audit.record(
            {
              action: AUDIT_ACTIONS.orderErpUnknown,
              actorAccountId: null,
              detail: this.detail(row, order, { errorClass: outcome.errorClass, errorCode: outcome.errorCode, parked: outcome.kind === 'park', ...(erpNumber === null ? {} : { erpOrderNumber: erpNumber }) }),
            },
            tx,
          );
        }
      }
    });
    this.deps.logger.warn(
      { outboxId: row.id, orderId: order.id, phase, outcome: outcome.kind, status, errorClass: outcome.errorClass, errorCode: outcome.errorCode, attempt: row.attemptCount },
      'order delivery attempt did not complete',
    );
  }

  private async storeDryRun(row: OutboxRow, order: OrderRow, record: { payload: unknown; payloadHash: string }): Promise<void> {
    const at = this.deps.now();
    await this.database.transaction(async (tx) => {
      await tx
        .insert(integrationOrderDryRun)
        .values({ id: uuidv7(at.getTime()), outboxId: row.id, orderId: order.id, payload: record.payload, payloadHash: record.payloadHash, createdAt: at })
        .onConflictDoNothing({ target: integrationOrderDryRun.outboxId });
      // Parked as `pending` with no next attempt: nothing was sent, nothing will be until the mode changes.
      await tx
        .update(integrationOutbox)
        .set({ status: 'pending', nextAttemptAt: null, lastStep: 'dry_run', lastErrorClass: null, lastErrorMessage: null, updatedAt: at })
        .where(eq(integrationOutbox.id, row.id));
      await this.deps.audit.record(
        { action: AUDIT_ACTIONS.orderErpDryRun, actorAccountId: null, detail: this.detail(row, order, { payloadHash: record.payloadHash }) },
        tx,
      );
    });
    this.deps.logger.info({ outboxId: row.id, orderId: order.id }, 'order delivery dry run stored; nothing was sent');
  }

  private detail(row: OutboxRow, order: OrderRow, extra: AuditDetail): AuditDetail {
    return { orderId: order.id, outboxId: row.id, attempts: row.attemptCount, ...extra };
  }
}

function toDelivery(order: OrderRow): DeliveryOrder {
  return {
    id: order.id,
    customerCode: order.customerCode,
    sellerCode: order.sellerCode,
    negotiationTypeCode: order.negotiationTypeCode,
    // The order's own TOP (D-A); null falls back to the configured default. The carrier column is not in this branch yet (D-C).
    topCode: order.topCode,
    carrierCode: null,
    notes: order.notes,
    createdAt: order.createdAt,
  };
}
