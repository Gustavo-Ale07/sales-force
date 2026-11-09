import { integrationOutbox, salesOrder, type DbHandle } from '@salesforce/db';
import { and, desc, eq } from 'drizzle-orm';
import { AUDIT_ACTIONS, type AuditService } from '../iam/audit.service.js';

export interface ResendResult {
  readonly outboxId: string;
  readonly originId: string;
  readonly erpNumber: number;
}

export class ResendRefused extends Error {
  constructor(readonly reason: string, message: string) {
    super(message);
    this.name = 'ResendRefused';
  }
}

/**
 * M1 (SNK-7 roteiro §3, step 3): re-queues the delivery of an order that was already delivered, with the SAME outbox
 * row (same id and same origin id, which is the idempotency key SNK-4). The worker then asks the ERP by origin first
 * (`findOrderByOrigin`), finds the note and only links it; no second note can be created. Nothing is written to the
 * ERP here. Refused unless the order is `sent` with an ERP number and its newest delivery is `confirmed` with an origin id.
 */
export async function requeueDeliveredOrder(
  database: DbHandle,
  audit: AuditService,
  orderId: string,
  now: Date,
  /** Who asked (the ops CLI has no account: null). Recorded in the audit event. */
  actorAccountId: string | null = null,
): Promise<ResendResult> {
  return database.db.transaction(async (tx) => {
    const [order] = await tx.select().from(salesOrder).where(eq(salesOrder.id, orderId)).for('update');
    if (order === undefined) throw new ResendRefused('order_not_found', 'No order with this id.');
    const [row] = await tx
      .select()
      .from(integrationOutbox)
      .where(and(eq(integrationOutbox.aggregateType, 'sales_order'), eq(integrationOutbox.aggregateId, orderId), eq(integrationOutbox.operation, 'send_order')))
      .orderBy(desc(integrationOutbox.createdAt))
      .limit(1)
      .for('update');
    // K3: this tool never talks to Sankhya, so it cannot count the notes itself. It refuses when a delivery of this order
    // already found more than one note by origin (`ambiguous_origin`); and when it re-queues, the worker's origin lookup
    // (which treats several notes as ambiguous_origin and adopts none) is what decides.
    if (row !== undefined && (row.lastErrorMessage ?? '').startsWith('ambiguous_origin')) {
      throw new ResendRefused('ambiguous_origin', 'Há mais de uma nota com este pedido no Sankhya (origem ambígua). Não reenviar: peça à TI para conferir no Sankhya.');
    }
    if (order.status !== 'sent' || order.erpNumber === null) {
      throw new ResendRefused('order_not_sent', `The order is "${order.status}"; only an order already delivered (with an ERP number) can be re-queued.`);
    }
    if (row === undefined || row.status !== 'confirmed') {
      throw new ResendRefused('delivery_not_confirmed', 'The newest delivery of this order is not confirmed.');
    }
    if (row.originId === null) throw new ResendRefused('no_origin_id', 'The delivery has no origin id; refusing to resend without the idempotency key.');

    await tx
      .update(integrationOutbox)
      .set({ status: 'pending', nextAttemptAt: now, lastStep: 'verifying_origin', lastErrorClass: null, lastErrorMessage: null, updatedAt: now })
      .where(eq(integrationOutbox.id, row.id));
    await tx
      .update(salesOrder)
      .set({ status: 'queued', version: order.version + 1, updatedAt: now })
      .where(eq(salesOrder.id, orderId));
    await audit.record(
      {
        action: AUDIT_ACTIONS.orderErpResendRequested,
        actorAccountId,
        detail: { orderId, outboxId: row.id, originId: row.originId, erpNumber: order.erpNumber },
      },
      tx,
    );
    return { outboxId: row.id, originId: row.originId, erpNumber: order.erpNumber };
  });
}
