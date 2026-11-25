import { createHash } from 'node:crypto';
import { installationConfigurationVersion, integrationOutbox, salesOrder, salesOrderErpStage, salesOrderReleasePending, type DbHandle } from '@salesforce/db';
import {
  awaitedReleaseLevel,
  billingItemQuantities,
  billingStateOf,
  classifyOrderStage,
  isFinalBillingState,
  mapErpOrderStatus,
  resolveOrderStageRules,
  sectorsOfPendingRelease,
  type ErpReleaseState,
  type OrderStageRules,
} from '@salesforce/domain';
import { type ErpOrderReleaseReading, type SankhyaOrderReadPort } from '@salesforce/sankhya';
import { and, asc, eq, gt, gte, inArray, isNotNull, isNull, lt, ne, or, sql } from 'drizzle-orm';
import { validateInstallationConfiguration } from '../configuration/validate.js';
import { describeSyncFailure, type SyncFailure } from '../sync/failure.js';
import type { Logger } from '../observability/logger.js';
import {
  decodeReleaseDetail,
  encodeReleaseDetail,
  encodeReleaseEventCodes,
  releaseStateOfFacts,
  storedBillingState,
  type StoredBilling,
  type StoredReleaseDetail,
} from '../orders/release-events.js';
import { uuidv7 } from '../platform/ids.js';
import { AUDIT_ACTIONS, AuditService } from '../iam/audit.service.js';
import { decideRemoval, isSuspectBatch, type OrderPresence } from './order-removal.js';
import type { Clock } from '../platform/tokens.js';

/** Orders older than this are no longer polled (P2). */
export const ERP_STATUS_MAX_AGE_DAYS = 90;
/** The release/billing cycle follows an order for at most this long after its creation. */
export const BILLING_MAX_AGE_DAYS = 60;
/** Orders read per run; the next run continues with the least recently checked. */
export const ERP_STATUS_BATCH = 200;

export interface OrderErpStatusDeps {
  readonly db: DbHandle;
  readonly gateway: SankhyaOrderReadPort;
  readonly logger: Logger;
  readonly now: Clock;
  /** Dedicated origin field (SNK-5); with it, `reconcileByOriginOnce` can link orders the ERP already holds. */
  readonly originField?: string;
}

/** Restricts a run to these orders (the on-demand refresh of RT-1); the batch limit still applies. */
export interface OrderErpScopeOptions {
  readonly signal?: AbortSignal;
  readonly orderIds?: readonly string[];
}

export interface OrderErpStatusRun {
  readonly checked: number;
  readonly updated: number;
  /** True when the ERP read itself failed (the stored statuses are kept); lets the on-demand refresh report it. */
  readonly failed?: true;
  /** Secret-free classification of the failed read (class, code, message); present with `failed`. */
  readonly failure?: SyncFailure;
}

const NOT_IMPLEMENTED_WARN_EVERY_MS = 3600_000;

/**
 * `sync.erp.orderStatus` (SNK-7 P2): reads the ERP status of orders already SENT and keeps the last one on the
 * order for display. Read-only toward the ERP; it never changes the delivery state of an order. Orders whose
 * ERP status is final (cancelled, invoiced and authorised, or a quote converted into an order) and orders older than 90 days are not read again.
 * A failing read leaves the stored status untouched and is retried by the next run.
 */
export class OrderErpStatusService {
  /** Last time the "read not implemented" WARN was written: that known, permanent state is logged once per hour. */
  #lastNotImplementedWarnAt: number | null = null;

  constructor(private readonly deps: OrderErpStatusDeps) {}

  async runOnce(options: OrderErpScopeOptions = {}): Promise<OrderErpStatusRun> {
    const { db, gateway, logger } = this.deps;
    const now = this.deps.now();
    const since = new Date(now.getTime() - ERP_STATUS_MAX_AGE_DAYS * 24 * 3600_000);
    const due = await db.db
      .select({ id: salesOrder.id, erpNumber: salesOrder.erpNumber, statusCode: salesOrder.erpStatusCode })
      .from(salesOrder)
      .where(
        and(
          eq(salesOrder.status, 'sent'),
          isNotNull(salesOrder.erpNumber),
          gte(salesOrder.createdAt, since),
          sql`(${salesOrder.erpStatusCode} is null or ${salesOrder.erpStatusCode} not in (0, 4, 7))`,
          options.orderIds === undefined ? undefined : inArray(salesOrder.id, [...options.orderIds]),
        ),
      )
      .orderBy(sql`${salesOrder.erpStatusCheckedAt} asc nulls first`, asc(salesOrder.createdAt))
      .limit(ERP_STATUS_BATCH);
    if (due.length === 0) return { checked: 0, updated: 0 };

    const numbers = due.flatMap((row) => (row.erpNumber === null ? [] : [row.erpNumber]));
    let readings;
    try {
      readings = await gateway.readOrderStatusFacts(numbers, options.signal === undefined ? {} : { signal: options.signal });
    } catch (error) {
      // Whatever was thrown (an Error, a string, a response-like object): class, code and message are kept; never the raw value.
      const failure = describeSyncFailure(error);
      const notImplemented = failure.errorCode === 'not_implemented';
      const quiet = notImplemented && this.#lastNotImplementedWarnAt !== null && now.getTime() - this.#lastNotImplementedWarnAt < NOT_IMPLEMENTED_WARN_EVERY_MS;
      if (notImplemented && !quiet) this.#lastNotImplementedWarnAt = now.getTime();
      if (!quiet) logger.warn(
        {
          errorClass: failure.errorClass,
          errorCode: failure.errorCode,
          detail: failure.message,
          thrownType: error instanceof Error ? error.name : error === null ? 'null' : typeof error,
          orders: numbers.length,
        },
        'ERP order status read failed; the stored statuses are kept and the next run retries',
      );
      return { checked: 0, updated: 0, failed: true, failure };
    }
    const byNumber = new Map(readings.map((reading) => [reading.erpOrderNumber, reading]));
    let updated = 0;
    for (const row of due) {
      const reading = row.erpNumber === null ? undefined : byNumber.get(row.erpNumber);
      if (reading === undefined) continue;
      const mapped = mapErpOrderStatus(reading.facts);
      // An order the ERP cannot find keeps its previous status; "unknown" is shown only when nothing was ever read.
      if (!reading.facts.found && row.statusCode !== null) continue;
      await db.db
        .update(salesOrder)
        .set({
          erpStatusCode: mapped.code,
          erpStatusLabel: mapped.label,
          erpInvoiceNumber: reading.invoiceNumber,
          erpStatusCheckedAt: now,
          // Absent in the reading = the source did not provide events: keep what was stored.
          ...(reading.releaseEventCodes === undefined ? {} : { erpStatusDetail: encodeReleaseEventCodes(reading.releaseEventCodes) }),
        })
        .where(eq(salesOrder.id, row.id));
      updated += 1;
    }
    return { checked: due.length, updated };
  }

  /**
   * Release (liberação) state of sent orders whose ERP number is known: one SELECT-only read through the gateway, stored as
   * a versioned detail on the order. Independent of `runOnce` (billing/status is a later block): an unreadable release
   * leaves the stored one untouched, and an order the ERP has no release lines for has none stored. Orders already
   * released are not read again; denied and awaiting ones are, until they settle or age out.
   */
  /** Order stage following Sankhya; see `runOrderStageOnce`. */
  runStageOnce(options: OrderStageRunOptions = {}): Promise<OrderErpStatusRun> {
    return runOrderStageOnce(this.deps, options);
  }

  /**
   * "Sincronizar agora" (owner 2026-11-25): orders sent while the Force did not record the answer (status `unknown` or `rejected`
   * with no ERP number) may already exist in Sankhya carrying OUR origin id. The ERP is asked by the dedicated origin field only
   * (SNK-4, never a heuristic); an exact match is linked and the order becomes `sent`. Read-only toward the ERP. A failed or
   * ambiguous lookup changes nothing for that order.
   */
  async reconcileByOriginOnce(options: OrderErpScopeOptions = {}): Promise<OrderErpStatusRun> {
    const { db, gateway, logger, originField } = this.deps;
    if (originField === undefined || originField === '') return { checked: 0, updated: 0 };
    const now = this.deps.now();
    const since = new Date(now.getTime() - ERP_STATUS_MAX_AGE_DAYS * 24 * 3600_000);
    const candidates = await db.db
      .select({ id: salesOrder.id })
      .from(salesOrder)
      .where(
        and(
          inArray(salesOrder.status, ['unknown', 'rejected']),
          isNull(salesOrder.erpNumber),
          gte(salesOrder.createdAt, since),
          options.orderIds === undefined ? undefined : inArray(salesOrder.id, [...options.orderIds]),
          sql`not exists (select 1 from ${integrationOutbox} where ${integrationOutbox.aggregateType} = 'sales_order' and ${integrationOutbox.operation} = 'send_order' and ${integrationOutbox.aggregateId} = ${salesOrder.id} and ${integrationOutbox.status} = 'processing')`,
        ),
      )
      .orderBy(sql`${salesOrder.updatedAt} desc`)
      .limit(50);
    const audit = new AuditService(db.db, () => now);
    let updated = 0;
    for (const candidate of candidates) {
      if (options.signal?.aborted === true) break;
      let found;
      try {
        found = await gateway.findOrderByOrigin(originField, candidate.id, options.signal === undefined ? {} : { signal: options.signal });
      } catch (error) {
        const failure = describeSyncFailure(error);
        logger.warn({ errorClass: failure.errorClass, errorCode: failure.errorCode }, 'ERP origin lookup failed; the order was left as it is');
        continue;
      }
      if (found === null) continue;
      const linked = await db.db.transaction(async (tx) => {
        const rows = await tx
          .update(salesOrder)
          .set({ status: 'sent', erpNumber: found.erpOrderNumber, version: sql`${salesOrder.version} + 1`, updatedAt: now })
          .where(and(eq(salesOrder.id, candidate.id), inArray(salesOrder.status, ['unknown', 'rejected']), isNull(salesOrder.erpNumber)))
          .returning({ id: salesOrder.id });
        if (rows.length === 0) return false;
        await tx
          .update(integrationOutbox)
          .set({ status: 'confirmed', nextAttemptAt: null, lastStep: 'confirmed', lastErrorClass: null, lastErrorMessage: null, erpReference: String(found.erpOrderNumber), updatedAt: now })
          .where(and(eq(integrationOutbox.aggregateType, 'sales_order'), eq(integrationOutbox.operation, 'send_order'), eq(integrationOutbox.aggregateId, candidate.id)));
        await audit.record(
          { action: AUDIT_ACTIONS.orderErpSent, actorAccountId: null, detail: { orderId: candidate.id, erpOrderNumber: found.erpOrderNumber, via: 'origin_reconciliation' } },
          tx,
        );
        return true;
      });
      if (linked) updated += 1;
    }
    return { checked: candidates.length, updated };
  }

  async runReleaseOnce(options: OrderErpScopeOptions & { readonly countAbsence?: boolean; readonly confirmNow?: boolean } = {}): Promise<OrderErpStatusRun> {
    const { db, gateway, logger } = this.deps;
    const now = this.deps.now();
    const since = new Date(now.getTime() - BILLING_MAX_AGE_DAYS * 24 * 3600_000);
    const candidates = await db.db
      .select({ id: salesOrder.id, erpNumber: salesOrder.erpNumber, detail: salesOrder.erpStatusDetail, removedAt: salesOrder.erpRemovedAt, missingChecks: salesOrder.erpMissingChecks })
      .from(salesOrder)
      .where(
        and(
          eq(salesOrder.status, 'sent'),
          isNotNull(salesOrder.erpNumber),
          gte(salesOrder.createdAt, since),
          options.orderIds === undefined ? undefined : inArray(salesOrder.id, [...options.orderIds]),
        ),
      )
      .orderBy(asc(salesOrder.updatedAt))
      .limit(ERP_STATUS_BATCH);
    // An order is followed until it is invoiced or cancelled, for at most 60 days (the query above).
    // A removed order stays in the set: reading it again is how it is restored if its note comes back.
    const due = candidates.filter((row) => row.removedAt !== null || !isFinalBillingState(storedBillingState(decodeReleaseDetail(row.detail))));
    if (due.length === 0) return { checked: 0, updated: 0 };
    const numbers = due.flatMap((row) => (row.erpNumber === null ? [] : [row.erpNumber]));
    let readings;
    try {
      readings = await gateway.readOrderReleaseFacts(numbers, options.signal === undefined ? {} : { signal: options.signal });
    } catch (error) {
      const failure = describeSyncFailure(error);
      const notImplemented = failure.errorCode === 'not_implemented';
      const quiet = notImplemented && this.#lastNotImplementedWarnAt !== null && now.getTime() - this.#lastNotImplementedWarnAt < NOT_IMPLEMENTED_WARN_EVERY_MS;
      if (notImplemented && !quiet) this.#lastNotImplementedWarnAt = now.getTime();
      if (!quiet) logger.warn(
        { errorClass: failure.errorClass, errorCode: failure.errorCode, detail: failure.message, orders: numbers.length },
        'ERP order release read failed; the stored release states are kept and the next run retries',
      );
      return { checked: 0, updated: 0, failed: true, failure };
    }
    const byNumber = new Map(readings.map((reading) => [reading.erpOrderNumber, reading]));
    // A failed billing read is never silent: one warning with the error code(s) and the count (no order data); the stored billing state is kept.
    const billingErrors = readings.flatMap((reading) => (reading.billingErrorCode === undefined ? [] : [reading.billingErrorCode]));
    if (billingErrors.length > 0) {
      logger.warn(
        { errorCodes: [...new Set(billingErrors)], orders: billingErrors.length },
        'ERP billing read failed; the stored billing states are kept and the next run retries',
      );
    }
    let updated = 0;
    // RT-1 deleted-order detection (order-removal.ts): the read succeeded, so each order is found, confirmed absent (no header, not in
    // the cancellation tables, billing read healthy) or unknown. A suspect batch (partial / mostly absent) counts nothing.
    const presenceOf = (reading: ErpOrderReleaseReading): OrderPresence =>
      reading.found ? 'found' : reading.billing?.cancelled === true || reading.billingErrorCode !== undefined ? 'unknown' : 'absent';
    const presences = due.flatMap((row) => {
      const reading = row.erpNumber === null ? undefined : byNumber.get(row.erpNumber);
      return reading === undefined ? [] : [presenceOf(reading)];
    });
    const suspect = isSuspectBatch(presences, due.length);
    if (suspect && presences.some((p) => p === 'absent')) {
      logger.warn(
        { orders: due.length, readings: presences.length, absent: presences.filter((p) => p === 'absent').length },
        'ERP order absence ignored: the batch looks partial or mostly absent (anti-mass-delete guard)',
      );
    }
    const audit = new AuditService(db.db, () => now);
    for (const row of due) {
      const reading = row.erpNumber === null ? undefined : byNumber.get(row.erpNumber);
      if (reading === undefined) continue;
      const decision = decideRemoval(
        { presence: presenceOf(reading), missingChecks: row.missingChecks, removed: row.removedAt !== null },
        suspect,
        options.countAbsence !== false,
        options.confirmNow === true,
      );
      if (decision.action === 'count') {
        await db.db.update(salesOrder).set({ erpMissingChecks: decision.missingChecks }).where(eq(salesOrder.id, row.id));
      } else if (decision.action === 'reset') {
        await db.db.update(salesOrder).set({ erpMissingChecks: 0 }).where(eq(salesOrder.id, row.id));
      } else if (decision.action === 'remove' || decision.action === 'restore') {
        const removing = decision.action === 'remove';
        await db.db.transaction(async (tx) => {
          await tx
            .update(salesOrder)
            .set(removing ? { erpRemovedAt: now, erpMissingChecks: decision.missingChecks } : { erpRemovedAt: null, erpMissingChecks: 0 })
            .where(eq(salesOrder.id, row.id));
          await audit.record(
            { action: removing ? AUDIT_ACTIONS.orderErpRemoved : AUDIT_ACTIONS.orderErpRestored, actorAccountId: null, detail: { orderId: row.id, erpNumber: row.erpNumber } },
            tx,
          );
        });
        updated += 1;
      }
      const stored = decodeReleaseDetail(row.detail);
      // A note the ERP cannot find keeps what was stored (a missing note is not "no release" and not a cancellation),
      // unless the cancellation tables hold it: then the stored release lines stay and the billing state is "cancelled".
      if (!reading.found && reading.billing?.cancelled !== true) continue;
      const lines = reading.found
        ? reading.lines
        : (stored?.lines ?? []).map((line) => ({ event: line.code, description: line.description, released: line.state === 'released', denied: line.state === 'denied' }));
      const billing = reading.billing === undefined ? stored?.billing : storedBillingOf(reading, releaseStateOfFacts(lines));
      const next = encodeReleaseDetail(lines, now, billing);
      // No change in the lines or billing: keep the row untouched (the reading time is only stored with a change).
      if (stored !== null && next !== null && sameDetail(stored, decodeReleaseDetail(next))) continue;
      if (stored === null && next === null) continue;
      await db.db.update(salesOrder).set({ erpStatusDetail: next }).where(eq(salesOrder.id, row.id));
      updated += 1;
    }
    return { checked: due.length, updated };
  }
}

/** Reads of the stage younger than this are reused by an on-demand refresh (login / "Sincronizar agora"). */
export const ORDER_STAGE_ON_DEMAND_REUSE_MS = 60_000;

export interface OrderStageRunOptions {
  readonly signal?: AbortSignal;
  /** Only these orders (RT-1 on-demand refresh). */
  readonly orderIds?: readonly string[];
  /** Orders whose stage was read less than this long ago are not read again (0 = the scheduled run reads every due order). */
  readonly reuseMs?: number;
}

/** Stable, secret-free code of a stage read that could not even start (no current configuration). */
const CONFIGURATION_UNAVAILABLE_CODE = 'configuration_unavailable';

/**
 * Order stage following Sankhya (docs/implementation/order-status-following-sankhya.md). One batched SELECT-only read through the
 * gateway for the delivered, non-final orders; the domain classifies the facts (`classifyOrderStage`); the result is mirrored in
 * `sales_order_erp_stage`. Read-only toward the ERP and independent of `runOnce` / `runReleaseOnce`: a failed read keeps the stored
 * stage and its times and records the error class/code on the rows already known. Invoiced orders are read again only inside the
 * configured window after the stage was reached; nothing here ever changes an order or its delivery state.
 */
export async function runOrderStageOnce(deps: OrderErpStatusDeps, options: OrderStageRunOptions = {}): Promise<OrderErpStatusRun> {
  const { db, gateway, logger } = deps;
  const now = deps.now();
  const configured = await loadStageConfiguration(db);
  if (configured === null) {
    const failure: SyncFailure = { errorClass: 'permanent', errorCode: CONFIGURATION_UNAVAILABLE_CODE, message: 'No valid installation configuration.', retry: false };
    logger.warn({ errorCode: CONFIGURATION_UNAVAILABLE_CODE }, 'order stage read skipped: no valid installation configuration');
    return { checked: 0, updated: 0, failed: true, failure };
  }
  const { rules, quotationTopCode } = configured;
  const since = new Date(now.getTime() - ERP_STATUS_MAX_AGE_DAYS * 24 * 3600_000);
  const reuseBefore = new Date(now.getTime() - (options.reuseMs ?? 0));
  const windowStart = new Date(now.getTime() - rules.finalRereadWindowHours * 3600_000);
  const candidates = await db.db
    .select({ id: salesOrder.id, erpNumber: salesOrder.erpNumber, stored: salesOrderErpStage })
    .from(salesOrder)
    .leftJoin(salesOrderErpStage, eq(salesOrderErpStage.orderId, salesOrder.id))
    .where(
      and(
        eq(salesOrder.status, 'sent'),
        isNotNull(salesOrder.erpNumber),
        gte(salesOrder.createdAt, since),
        options.orderIds === undefined ? undefined : inArray(salesOrder.id, [...options.orderIds]),
        // Invoiced: only inside the window after the stage was reached; every other stage keeps being read.
        or(isNull(salesOrderErpStage.orderId), ne(salesOrderErpStage.stage, 'invoiced'), gt(salesOrderErpStage.updatedAt, windowStart)),
        // On-demand reuse: a read younger than `reuseMs` is not repeated.
        options.reuseMs === undefined || options.reuseMs <= 0 ? undefined : or(isNull(salesOrderErpStage.orderId), lt(salesOrderErpStage.checkedAt, reuseBefore)),
      ),
    )
    .orderBy(sql`${salesOrderErpStage.checkedAt} asc nulls first`, asc(salesOrder.createdAt))
    .limit(ERP_STATUS_BATCH);
  const due = candidates.flatMap((row) => (row.erpNumber === null ? [] : [{ id: row.id, erpNumber: row.erpNumber, stored: row.stored }]));
  if (due.length === 0) return { checked: 0, updated: 0 };

  let readings;
  try {
    readings = await gateway.readOrderStageFacts(due.map((row) => row.erpNumber), options.signal === undefined ? {} : { signal: options.signal });
  } catch (error) {
    const failure = describeSyncFailure(error);
    if (failure.errorCode !== 'not_implemented') {
      logger.warn(
        { errorClass: failure.errorClass, errorCode: failure.errorCode, orders: due.length },
        'ERP order stage read failed; the stored stages are kept and the next run retries',
      );
      const known = due.flatMap((row) => (row.stored === null ? [] : [row.id]));
      if (known.length > 0) {
        await db.db
          .update(salesOrderErpStage)
          .set({ lastErrorClass: failure.errorClass, lastErrorCode: failure.errorCode ?? failure.errorClass, lastErrorAt: now })
          .where(inArray(salesOrderErpStage.orderId, known));
      }
    }
    return { checked: 0, updated: 0, failed: true, failure };
  }
  const byNumber = new Map(readings.map((reading) => [reading.erpOrderNumber, reading]));
  const withQueueRows = new Set(
    (await db.db.select({ orderId: salesOrderReleasePending.orderId }).from(salesOrderReleasePending).where(inArray(salesOrderReleasePending.orderId, due.map((row) => row.id)))).map((r) => r.orderId),
  );
  const assigneeErrorCodes = new Set<string>();
  let updated = 0;
  for (const row of due) {
    const reading = byNumber.get(row.erpNumber);
    // A note the ERP cannot find keeps what was stored: a missing note is neither a stage nor a cancellation (open validation).
    if (reading === undefined || !reading.found) continue;
    const stage = classifyOrderStage(
      {
        nunota: row.erpNumber,
        codtipoper: reading.codtipoper,
        statusnota: reading.statusNota,
        pendente: reading.pending,
        ordemcarga: reading.orderCargo,
        pendingReleases: reading.pendingReleases,
        hasReprovedRelease: reading.hasReprovedRelease === true,
        hasInvoiceLink: reading.hasInvoiceLink,
        invoiceNumber: reading.invoiceNumber,
        isQuotation: quotationTopCode !== null && reading.codtipoper === quotationTopCode,
      },
      rules,
    );
    // Release queue: the pending lines of an order held by Pedidos/Financeiro; any other stage (released, in invoicing, invoiced,
    // quotation) has none, so a line released in Sankhya leaves the queue on this very read.
    const holdsRelease = stage.code === 'in_review' || stage.code === 'financial_check';
    await syncReleaseQueue(db, {
      orderId: row.id,
      nunota: row.erpNumber,
      lines: holdsRelease ? reading.pendingReleases : [],
      rules,
      now,
      hadRows: withQueueRows.has(row.id),
    });
    // A failed read of the assigned releaser is logged once per read with its stable code only (the queue still works, unassigned).
    if (reading.assigneeReadErrorCode !== undefined) assigneeErrorCodes.add(reading.assigneeReadErrorCode);
    const invoiceNumber = stage.code === 'invoiced' ? reading.invoiceNumber : null;
    const contentHash = createHash('sha256')
      .update(JSON.stringify([row.erpNumber, stage.code, stage.label, stage.pendingSector, invoiceNumber]))
      .digest('hex');
    // Awaited release level (owner decision 2026-11-25): lowest SEQCASCATA of a pending EVENTO 44 line; no TSILIB line = not confirmed
    // yet. Kept out of the content hash so a level change never moves `updatedAt`; absent lines (not read) keep the stored level.
    const level = reading.releaseLines === undefined ? null : awaitedReleaseLevel(reading.releaseLines);
    const levelValues = level === null ? {} : { releaseState: level.state, awaitedLevel: level.level };
    if (row.stored !== null && row.stored.contentHash === contentHash) {
      // Same content: only the reading time (and the level) moves, and a previous read error is cleared.
      await db.db
        .update(salesOrderErpStage)
        .set({ checkedAt: now, lastErrorClass: null, lastErrorCode: null, lastErrorAt: null, ...levelValues })
        .where(eq(salesOrderErpStage.orderId, row.id));
      continue;
    }
    const values = {
      nunota: row.erpNumber,
      stage: stage.code as (typeof salesOrderErpStage.$inferInsert)['stage'],
      label: stage.label,
      pendingSector: stage.pendingSector,
      invoiceNumber,
      contentHash,
      ...levelValues,
      updatedAt: now,
      checkedAt: now,
      lastErrorClass: null,
      lastErrorCode: null,
      lastErrorAt: null,
    };
    await db.db
      .insert(salesOrderErpStage)
      .values({ orderId: row.id, ...values })
      .onConflictDoUpdate({ target: salesOrderErpStage.orderId, set: values });
    updated += 1;
  }
  if (assigneeErrorCodes.size > 0) {
    logger.warn({ errorCodes: [...assigneeErrorCodes] }, 'ERP release assignee (CODUSULIB) read failed; the release queue shows lines without a releaser');
  }
  return { checked: due.length, updated };
}

interface ReleaseQueueSync {
  readonly orderId: string;
  readonly nunota: number;
  readonly lines: readonly { readonly event: number; readonly cascadeSequence: number | null; readonly assignedUserCode?: number | null }[];
  readonly rules: OrderStageRules;
  readonly now: Date;
  /** The order already has queue rows (preloaded): with no lines and no rows there is nothing to write. */
  readonly hadRows: boolean;
}

/**
 * Replaces the queue rows of ONE order with the pending lines of this read (one row per line and sector). Existing rows keep
 * `first_seen_at` and `notified_at`; rows no longer pending are deleted (released in Sankhya). Read-only toward the ERP.
 */
export async function syncReleaseQueue(db: DbHandle, input: ReleaseQueueSync): Promise<void> {
  if (input.lines.length === 0 && !input.hadRows) return;
  const wanted = new Map<string, { event: number; cascadeSequence: number | null; sector: string; assigned: number | null }>();
  for (const line of input.lines) {
    for (const sector of sectorsOfPendingRelease({ event: line.event, cascadeSequence: line.cascadeSequence }, input.rules)) {
      const key = `${line.event}|${line.cascadeSequence ?? ''}|${sector}`;
      if (!wanted.has(key)) wanted.set(key, { event: line.event, cascadeSequence: line.cascadeSequence, sector, assigned: line.assignedUserCode ?? null });
    }
  }
  await db.db.transaction(async (tx) => {
    const existing = await tx.select().from(salesOrderReleasePending).where(eq(salesOrderReleasePending.orderId, input.orderId));
    const keyOf = (row: { event: number; cascadeSequence: number | null; sector: string }): string => `${row.event}|${row.cascadeSequence ?? ''}|${row.sector}`;
    const known = new Map(existing.map((row) => [keyOf(row), row]));
    const gone = existing.filter((row) => !wanted.has(keyOf(row))).map((row) => row.id);
    if (gone.length > 0) await tx.delete(salesOrderReleasePending).where(inArray(salesOrderReleasePending.id, gone));
    for (const [key, line] of wanted) {
      const current = known.get(key);
      if (current === undefined) {
        await tx.insert(salesOrderReleasePending).values({
          id: uuidv7(input.now.getTime()),
          orderId: input.orderId,
          nunota: input.nunota,
          event: line.event,
          cascadeSequence: line.cascadeSequence,
          sector: line.sector,
          assignedUserCode: line.assigned,
          firstSeenAt: input.now,
          lastSeenAt: input.now,
        });
      } else {
        // The releaser keeps its last known value when the soft assignee read produced nothing for this read.
        await tx
          .update(salesOrderReleasePending)
          .set({ lastSeenAt: input.now, assignedUserCode: line.assigned ?? current.assignedUserCode })
          .where(eq(salesOrderReleasePending.id, current.id));
      }
    }
  });
}

async function loadStageConfiguration(db: DbHandle): Promise<{ rules: OrderStageRules; quotationTopCode: number | null } | null> {
  const [current] = await db.db
    .select({ payload: installationConfigurationVersion.payload })
    .from(installationConfigurationVersion)
    .where(eq(installationConfigurationVersion.isCurrent, true));
  if (current === undefined) return null;
  const validated = validateInstallationConfiguration(current.payload);
  if (!validated.ok) return null;
  return { rules: resolveOrderStageRules(validated.value.erp?.orderStage), quotationTopCode: validated.value.sales.quotationTopCode };
}

function sameDetail(a: StoredReleaseDetail, b: StoredReleaseDetail | null): boolean {
  if (b === null || a.lines.length !== b.lines.length) return false;
  const sameLines = a.lines.every((line, index) => {
    const other = b.lines[index];
    return other !== undefined && other.code === line.code && other.state === line.state && other.description === line.description;
  });
  return sameLines && JSON.stringify(a.billing ?? null) === JSON.stringify(b.billing ?? null);
}

/** Billing state and per-item quantities of one reading (domain rules); a stored form with no secrets or ERP identifiers beyond the product. */
export function storedBillingOf(reading: ErpOrderReleaseReading, releaseState: ErpReleaseState | null): StoredBilling {
  const billing = reading.billing;
  const state = billingStateOf({
    cancelled: billing?.cancelled === true,
    releaseState,
    invoiced: billing?.invoiced === true,
    statusNota: reading.statusNota,
    pending: reading.pending,
  });
  return {
    state,
    invoicedAt: billing?.invoicedAt ?? null,
    nfeAuthorized: billing?.nfeAuthorized === true,
    items: (billing?.items ?? []).map((item) => ({ sequence: item.sequence, productCode: item.productCode, ...billingItemQuantities(item) })),
  };
}
