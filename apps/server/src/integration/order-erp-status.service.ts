import { salesOrder, type DbHandle } from '@salesforce/db';
import { mapErpOrderStatus } from '@salesforce/domain';
import { isSankhyaGatewayError, type SankhyaOrderReadPort } from '@salesforce/sankhya';
import { and, asc, eq, gte, isNotNull, sql } from 'drizzle-orm';
import type { Logger } from '../observability/logger.js';
import { encodeReleaseEventCodes } from '../orders/release-events.js';
import type { Clock } from '../platform/tokens.js';

/** Orders older than this are no longer polled (P2). */
export const ERP_STATUS_MAX_AGE_DAYS = 90;
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
}

/**
 * `sync.erp.orderStatus` (SNK-7 P2): reads the ERP status of orders already SENT and keeps the last one on the
 * order for display. Read-only toward the ERP; it never changes the delivery state of an order. Orders whose
 * ERP status is final (cancelled or invoiced and authorised) and orders older than 90 days are not read again.
 * A failing read leaves the stored status untouched and is retried by the next run.
 */
export class OrderErpStatusService {
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
          sql`(${salesOrder.erpStatusCode} is null or ${salesOrder.erpStatusCode} not in (0, 4))`,
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
      logger.warn(
        { err: isSankhyaGatewayError(error) ? { kind: error.kind, code: error.code } : { message: String(error) } },
        'ERP order status read failed; the stored statuses are kept and the next run retries',
      );
      return { checked: 0, updated: 0 };
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
}
