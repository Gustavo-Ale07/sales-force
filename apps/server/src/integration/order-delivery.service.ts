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
import { erpIpiRate, erpListPrice, erpPriceTableVersion, erpProduct } from '@salesforce/db';
import { erpSubmissionBlock, findEffectiveVersion, ipiRefOf, type ErpSubmissionTarget, type InstallationConfiguration, type IpiRate, type IpiRef } from '@salesforce/domain';
import {
  AmbiguousOriginError,
  isBudgetExhaustedError,
  isSankhyaGatewayError,
  SankhyaGatewayError,
  usesInformedPrice,
  type RequestBudget,
  type SankhyaOrderReadPort,
  type SankhyaWritePort,
} from '@salesforce/sankhya';
import { and, asc, eq, inArray, isNotNull, isNull, like, lt, lte, sql } from 'drizzle-orm';
import { validateInstallationConfiguration } from '../configuration/validate.js';
import { AUDIT_ACTIONS, type AuditDetail, type AuditService } from '../iam/audit.service.js';
import type { Logger } from '../observability/logger.js';
import { maskStoredError } from '../observability/mask-error-message.js';
import { uuidv7 } from '../platform/ids.js';
import type { Clock } from '../platform/tokens.js';
import {
  RECONCILE_INTERVAL_MS,
  RECONCILE_WINDOW_MS,
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
  /** The ERP environment this worker may send to; an order bound to another one is refused (SNK-6). */
  readonly target: ErpSubmissionTarget;
}

export interface OrderDeliveryDeps {
  readonly db: DbHandle;
  /** Used in `live` mode only; `dry_run` never touches it. */
  readonly gateway: OrderDeliveryGateway;
  readonly settings: OrderDeliverySettings;
  /** M3: cap on the Sankhya requests of the delivery; absent = no cap (dry run, fake gateway). */
  readonly budget?: RequestBudget;
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
const REJECTION_LOG_MAX = 300;

/** A configuration problem is operational, not the order's fault: retried like a temporary failure. */
class ConfigurationUnavailableError extends SankhyaGatewayError {
  constructor(message: string) {
    super('temporary', { code: 'configuration_unavailable', message });
  }
}

/** Distinct wording per reread divergence (D-AK): IPI and total are not "a different discount". */
function divergenceMessage(code: string, productCode: number, priceChanged = false): string {
  if (priceChanged) return `The table price changed after the order was created (product ${productCode}); create the order again.`;
  if (code === 'ipi_divergence') return 'The ERP stored a different IPI than the Force estimate' + (productCode === 0 ? ' (note header).' : ` (product ${productCode}).`);
  if (code === 'total_divergence') return 'The ERP note total differs from the Force total (net lines + IPI).';
  return `The ERP stored a different ${code === 'discount_divergence' ? 'discount' : 'price or line'} (product ${productCode}).`;
}

function parseErpNumber(reference: string | null): number | null {
  if (reference === null || !/^[1-9]\d{0,9}$/.test(reference)) return null;
  const value = Number(reference);
  return value <= 2_147_483_647 ? value : null;
}

/** When the include of this row first timed out (G2); the attempts since then only verify by origin. */
function parseReconcileSince(payload: unknown): Date | null {
  const raw = (payload as { reconcileSince?: unknown } | null)?.reconcileSince;
  if (typeof raw !== 'string') return null;
  const at = new Date(raw);
  return Number.isNaN(at.getTime()) ? null : at;
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
    await this.releaseNotImplementedParks();
    const recovered = await this.recoverStale();
    const limit = options.limit ?? DEFAULT_SWEEP_LIMIT;
    let processed = 0;
    while (processed < limit && options.signal?.aborted !== true) {
      if (this.deps.budget?.exhausted === true) {
        this.deps.logger.warn({ used: this.deps.budget.used, limit: this.deps.budget.limit }, 'order delivery stopped: the request budget is exhausted (restart the worker to start a new budget)');
        break;
      }
      const claimed = await this.claimNext();
      if (claimed === null) break;
      processed += 1;
      const startedMs = this.deps.now().getTime();
      try {
        await (this.deps.budget === undefined ? this.deliver(claimed, options.signal) : this.deps.budget.run(() => this.deliver(claimed, options.signal)));
      } catch (error) {
        // A bug or a database failure while recording the outcome: the row stays `processing` and is
        // recovered as `unknown` (never resent without verification). Surface it, keep the sweep alive.
        this.deps.logger.error({ err: error, outboxId: claimed.row.id }, 'order delivery attempt failed unexpectedly');
      } finally {
        // Every attempt: how long it really took (a timeout shows as ~the configured timeout, named in the stored message).
        this.deps.logger.info({ outboxId: claimed.row.id, attempt: claimed.row.attemptCount, durationMs: this.deps.now().getTime() - startedMs }, 'order delivery attempt finished');
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

  /**
   * D-AJ: before the Force stopped confirming notes, a failed confirm (`not_implemented`) parked the row with the
   * ERP number linked. Such a row only needs the verification cycle now (find by origin, reread, sent): give it a
   * due date. No include happens: the origin lookup links the existing note.
   */
  private async releaseNotImplementedParks(): Promise<number> {
    const now = this.deps.now();
    const released = await this.database
      .update(integrationOutbox)
      .set({ nextAttemptAt: now, updatedAt: now })
      .where(
        and(
          eq(integrationOutbox.aggregateType, ORDER_DELIVERY_AGGREGATE),
          eq(integrationOutbox.operation, ORDER_DELIVERY_OPERATION),
          eq(integrationOutbox.status, 'unknown'),
          isNull(integrationOutbox.nextAttemptAt),
          isNotNull(integrationOutbox.erpReference),
          like(integrationOutbox.lastErrorMessage, 'not_implemented:%'),
        ),
      )
      .returning({ id: integrationOutbox.id });
    if (released.length > 0) this.deps.logger.info({ count: released.length }, 'parked deliveries (not_implemented) released for verification');
    return released.length;
  }

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
      if (found !== null) {
        erpNumber = found.erpOrderNumber;
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
        // G2: after an include timeout the ERP may still be creating the note. Until the window ends, only VERIFY.
        const reconcileSince = parseReconcileSince(row.payload);
        if (reconcileSince !== null) {
          if (this.deps.now().getTime() - reconcileSince.getTime() < RECONCILE_WINDOW_MS) {
            await this.keepReconciling(row, order);
            return;
          }
          await this.finishRejected(
            row,
            order,
            'timeout',
            'include_timeout_unconfirmed',
            'The ERP did not answer the include and no order with this origin id appeared during the reconciliation window.',
            false,
          );
          return;
        }
        phase = 'include';
        await this.setStep(row.id, 'sending');
        // D-AK: what the include carries about price and discount (codes and numbers only, no personal data).
        logger.info(
          {
            outboxId: row.id,
            orderId: order.id,
            phase: 'include',
            priceMode: usesInformedPrice(request) ? 'True' : 'False',
            discountedItems: request.items.filter((item) => item.discountPercent !== null).length,
            items: request.items.map((item) => ({ productCode: item.productCode, vlrunit: usesInformedPrice(request) ? item.listUnitPrice : null, percdesc: item.discountPercent ?? (usesInformedPrice(request) ? '0' : null) })),
          },
          'including the order in the ERP',
        );
        const includeStartedMs = this.deps.now().getTime();
        const included = await this.deps.gateway.includeOrder(request, signal === undefined ? {} : { signal });
        erpNumber = included.erpOrderNumber;
        logger.info({ outboxId: row.id, orderId: order.id, phase: 'include', erpNumber, durationMs: this.deps.now().getTime() - includeStartedMs }, 'order included in the ERP');
        await this.recordErpNumber(row, order, erpNumber, 'awaiting_confirmation');
      }

      // The Force never confirms or releases the note: that is done inside the ERP by the customer's internal team (D-AJ). The include is final.
      phase = 'reread';
      const rereadStartedMs = this.deps.now().getTime();
      const written = await this.deps.gateway.readWrittenOrder(erpNumber, signal === undefined ? {} : { signal });
      logger.info({ outboxId: row.id, orderId: order.id, phase: 'reread', erpNumber, durationMs: this.deps.now().getTime() - rereadStartedMs }, 'order read back from the ERP');
      if (written === null) {
        throw new SankhyaGatewayError('temporary', { code: 'order_not_readable', message: 'The written order cannot be read back yet.' });
      }
      const verdict = verifyWrittenOrder(items, written, await this.loadIpiRefs(items), await this.loadCurrentPrices(items));
      if (!verdict.ok) {
        // D-7: the ERP stored something other than what was sent. The order exists there: keep its number.
        await this.finishRejected(row, order, 'validation', verdict.code, divergenceMessage(verdict.code, verdict.productCode, verdict.priceChanged === true), true);
        return;
      }
      await this.finishSent(row, order, erpNumber);
    } catch (error) {
      if (signal?.aborted === true && !isSankhyaGatewayError(error)) throw error;
      if (isBudgetExhaustedError(error)) {
        await this.parkForBudget(row, order);
        return;
      }
      if (error instanceof AmbiguousOriginError) {
        // K2: several ERP notes carry this origin id. Adopt none, include none, and block Reenviar: a person (IT) checks the ERP.
        this.deps.logger.error(
          { outboxId: row.id, orderId: order.id, erpOrderNumbers: error.erpOrderNumbers },
          'more than one ERP order carries this origin id: none adopted, nothing resent',
        );
        await this.finishRejected(row, order, 'permanent', 'ambiguous_origin', error.message, false, { erpOrderNumbers: error.erpOrderNumbers.join(',') });
        return;
      }
      if (phase === 'include' && isSankhyaGatewayError(error) && error.code === 'timeout') {
        await this.startReconciling(row, order, describeError(error));
        return;
      }
      const outcome = decideFailure(error, {
        phase,
        attemptCount: row.attemptCount,
        mayExist,
        hasErpNumber: erpNumber !== null,
      });
      await this.applyOutcome(row, order, outcome, describeError(error), erpNumber, phase);
    }
  }

  /** G2: the include timed out. Marks when (once), and the next attempts verify by origin every minute. */
  private async startReconciling(row: OutboxRow, order: OrderRow, message: string): Promise<void> {
    const at = this.deps.now();
    if (parseReconcileSince(row.payload) === null) {
      await this.database
        .update(integrationOutbox)
        .set({ payload: sql`${integrationOutbox.payload} || ${JSON.stringify({ reconcileSince: at.toISOString() })}::jsonb`, updatedAt: at })
        .where(eq(integrationOutbox.id, row.id));
    }
    await this.applyOutcome(
      row,
      order,
      { kind: 'retry', status: 'unknown', delayMs: RECONCILE_INTERVAL_MS, consumesAttempt: true, errorClass: 'temporary', errorCode: 'timeout' },
      message,
      null,
      'include',
    );
  }

  /** G2: still inside the window and the origin lookup found nothing: look again in a minute. Never includes; the verification does not consume an attempt. */
  private async keepReconciling(row: OutboxRow, order: OrderRow): Promise<void> {
    const at = this.deps.now();
    await this.database
      .update(integrationOutbox)
      .set({
        status: 'unknown',
        attemptCount: sql`greatest(${integrationOutbox.attemptCount} - 1, 0)`,
        nextAttemptAt: new Date(at.getTime() + RECONCILE_INTERVAL_MS),
        lastStep: 'waiting_retry',
        lastErrorClass: 'reconciling',
        lastErrorMessage: maskStoredError('include_timeout: the include timed out; waiting for the order to appear in the ERP (verified by origin id).').slice(0, MESSAGE_MAX),
        updatedAt: at,
      })
      .where(eq(integrationOutbox.id, row.id));
    this.deps.logger.info({ outboxId: row.id, orderId: order.id }, 'order not in the ERP yet after an include timeout: verified again, not resent');
  }

  /** M3: the budget ran out mid-attempt. The attempt is not counted, the row goes back to pending and the next attempt verifies by origin (SNK-4). */
  private async parkForBudget(row: OutboxRow, order: OrderRow): Promise<void> {
    const at = this.deps.now();
    const budget = this.deps.budget;
    await this.database.transaction(async (tx) => {
      await tx
        .update(integrationOutbox)
        .set({
          status: 'pending',
          attemptCount: sql`greatest(${integrationOutbox.attemptCount} - 1, 0)`,
          nextAttemptAt: at,
          lastStep: 'waiting_retry',
          lastErrorClass: 'budget_exhausted',
          lastErrorMessage: 'The test request budget is exhausted; delivery is paused until the worker is restarted.',
          updatedAt: at,
        })
        .where(eq(integrationOutbox.id, row.id));
    });
    this.deps.logger.warn(
      { outboxId: row.id, orderId: order.id, used: budget?.used, limit: budget?.limit },
      'order delivery paused: request budget exhausted (reason budget_exhausted)',
    );
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

  /** IPI reference per product from the mirror (display estimate, D-D); used only to compare the reread VLRIPI and VLRNOTA. */
  private async loadIpiRefs(items: readonly DeliveryItem[]): Promise<Map<number, IpiRef>> {
    const codes = [...new Set(items.map((item) => item.productCode))];
    const refs = new Map<number, IpiRef>();
    if (codes.length === 0) return refs;
    const products = await this.database
      .select({ code: erpProduct.code, ipiCode: erpProduct.ipiCode })
      .from(erpProduct)
      .where(and(isNull(erpProduct.deletedAt), inArray(erpProduct.code, codes)));
    const ipiCodes = [...new Set(products.flatMap((product) => (product.ipiCode === null ? [] : [product.ipiCode])))];
    const rates = new Map<number, IpiRate>();
    if (ipiCodes.length > 0) {
      const rows = await this.database.select().from(erpIpiRate).where(and(isNull(erpIpiRate.deletedAt), inArray(erpIpiRate.code, ipiCodes)));
      for (const row of rows) {
        rates.set(row.code, { code: row.code, percentual: row.percentual, byTariff: row.byTariff, description: row.description, rateMissing: row.rateMissing });
      }
    }
    for (const product of products) refs.set(product.code, ipiRefOf(product.ipiCode, rates));
    return refs;
  }

  /** Today's table price per product, from the mirror (the effective version of the table each line was priced from); only priced rows. */
  private async loadCurrentPrices(items: readonly DeliveryItem[]): Promise<Map<number, string>> {
    const current = new Map<number, string>();
    const byTable = new Map<number, number[]>();
    for (const item of items) {
      if (item.priceTableCode === null || item.priceTableCode === undefined || item.unitListPrice === null) continue;
      byTable.set(item.priceTableCode, [...(byTable.get(item.priceTableCode) ?? []), item.productCode]);
    }
    const at = this.deps.now().toISOString();
    for (const [tableCode, productCodes] of byTable) {
      const versionRows = await this.database
        .select({ versionId: erpPriceTableVersion.versionId, tableCode: erpPriceTableVersion.tableCode, effectiveFrom: erpPriceTableVersion.effectiveFrom })
        .from(erpPriceTableVersion)
        .where(and(eq(erpPriceTableVersion.tableCode, tableCode), isNull(erpPriceTableVersion.deletedAt)));
      const versions = versionRows.map((row) => ({ versionId: row.versionId, tableCode: row.tableCode, effectiveFrom: row.effectiveFrom.toISOString() }));
      const effective = findEffectiveVersion(tableCode, versions, at);
      if (effective === null) continue;
      const rows = await this.database
        .select({ productCode: erpListPrice.productCode, unitPrice: erpListPrice.unitPrice })
        .from(erpListPrice)
        .where(and(eq(erpListPrice.versionId, effective.versionId), isNull(erpListPrice.deletedAt), inArray(erpListPrice.productCode, productCodes)));
      for (const row of rows) current.set(row.productCode, row.unitPrice);
    }
    return current;
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
        priceTableCode: line.priceTableCode,
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
    auditExtra: AuditDetail = {},
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
          lastErrorMessage: maskStoredError(`${errorCode}: ${message}`).slice(0, MESSAGE_MAX),
          updatedAt: at,
        })
        .where(eq(integrationOutbox.id, row.id));
      if (order !== null && (order.status === 'queued' || order.status === 'unknown')) {
        await this.setOrderStatus(tx, order.id, ['queued', 'unknown'], 'rejected', at);
        await this.deps.audit.record(
          {
            action: AUDIT_ACTIONS.orderErpRejected,
            actorAccountId: null,
            detail: this.detail(row, order, { errorClass, errorCode, keptErpNumber: keepNumber, ...auditExtra }),
          },
          tx,
        );
      }
    });
    // The ERP's own refusal text (masked like the stored one, short, never the request) so the log says WHY, not only the code.
    this.deps.logger.warn(
      { outboxId: row.id, orderId: row.aggregateId, errorClass, errorCode, reason: maskStoredError(message).slice(0, REJECTION_LOG_MAX) },
      'order delivery rejected',
    );
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
          lastErrorMessage: maskStoredError(`${outcome.errorCode}: ${message}`).slice(0, MESSAGE_MAX),
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
      // D-Z: the simulated delivery is TERMINAL (`dry_run`), never picked again, and its origin id is released so a new
      // "Enviar ao Sankhya" can create a fresh record. The order goes back to draft carrying the dry-run mark (read from
      // integration_order_dry_run); nothing is delivered on its own when the mode turns live.
      await tx
        .update(integrationOutbox)
        .set({ status: 'dry_run', originId: null, nextAttemptAt: null, lastStep: 'dry_run', lastErrorClass: null, lastErrorMessage: null, updatedAt: at })
        .where(eq(integrationOutbox.id, row.id));
      await tx
        .update(salesOrder)
        .set({ status: 'draft', version: sql`${salesOrder.version} + 1`, updatedAt: at })
        .where(and(eq(salesOrder.id, order.id), eq(salesOrder.status, 'queued')));
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
    // The order's own TOP (D-A); null falls back to the configured default. The carrier (D-C/D-8) travels as CODPARCTRANSP when set.
    topCode: order.topCode,
    carrierCode: order.carrierCode,
    expedicao: order.expedicao,
    notes: order.notes,
    createdAt: order.createdAt,
  };
}
