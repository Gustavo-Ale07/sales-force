import { salesOrder, type DbHandle } from '@salesforce/db';
import { billingItemQuantities, billingStateOf, isFinalBillingState, mapErpOrderStatus, type ErpReleaseState } from '@salesforce/domain';
import { type ErpOrderReleaseReading, type SankhyaOrderReadPort } from '@salesforce/sankhya';
import { and, asc, eq, gte, isNotNull, sql } from 'drizzle-orm';
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

  async runOnce(options: { signal?: AbortSignal } = {}): Promise<OrderErpStatusRun> {
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
  async runReleaseOnce(options: { signal?: AbortSignal } = {}): Promise<OrderErpStatusRun> {
    const { db, gateway, logger } = this.deps;
    const now = this.deps.now();
    const since = new Date(now.getTime() - BILLING_MAX_AGE_DAYS * 24 * 3600_000);
    const candidates = await db.db
      .select({ id: salesOrder.id, erpNumber: salesOrder.erpNumber, detail: salesOrder.erpStatusDetail })
      .from(salesOrder)
      .where(and(eq(salesOrder.status, 'sent'), isNotNull(salesOrder.erpNumber), gte(salesOrder.createdAt, since)))
      .orderBy(asc(salesOrder.updatedAt))
      .limit(ERP_STATUS_BATCH);
    // An order is followed until it is invoiced or cancelled, for at most 60 days (the query above).
    const due = candidates.filter((row) => !isFinalBillingState(storedBillingState(decodeReleaseDetail(row.detail))));
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
    for (const row of due) {
      const reading = row.erpNumber === null ? undefined : byNumber.get(row.erpNumber);
      if (reading === undefined) continue;
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
