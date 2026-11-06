import { integrationOutbox, salesOrder } from '@salesforce/db';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { uuidv7 } from '../platform/ids.js';
import type { Executor, OrderRow } from './orders.repository.js';

/**
 * API side of the ERP delivery (SNK-7). The API never talks to Sankhya: it only writes the business record of
 * the delivery (`integration_outbox`) in the SAME transaction that moves the order to `queued`, and the worker
 * delivers it. Both functions run inside the caller's transaction on rows the caller has already locked.
 */

export const ORDER_DELIVERY_AGGREGATE = 'sales_order';
export const ORDER_DELIVERY_OPERATION = 'send_order';

/**
 * Queues an order: status `queued`, the order id becomes its ERP origin id (SNK-4, one id for the whole life of
 * the order), and one outbox row due now. Returns the updated order.
 */
export async function enqueueOrderDelivery(tx: Executor, order: OrderRow, at: Date): Promise<OrderRow> {
  const [row] = await tx
    .update(salesOrder)
    .set({ status: 'queued', externalOriginId: order.id, version: order.version + 1, updatedAt: at })
    .where(eq(salesOrder.id, order.id))
    .returning();
  if (row === undefined) throw new Error('Order vanished during an update inside its own transaction');
  await tx.insert(integrationOutbox).values({
    id: uuidv7(at.getTime()),
    aggregateType: ORDER_DELIVERY_AGGREGATE,
    aggregateId: order.id,
    operation: ORDER_DELIVERY_OPERATION,
    payload: {},
    originId: order.id,
    status: 'pending',
    nextAttemptAt: at,
    createdAt: at,
    updatedAt: at,
  });
  return row;
}

/**
 * D-AA: the seller's "Reenviar" after a terminal failure. The SAME outbox row (same id and origin id, SNK-4) goes back
 * to `pending`; the worker asks the ERP by origin before any write, so no second note can be created. Only a row that
 * is `rejected` qualifies (never a dry run, never an ambiguous `unknown`). Returns null when there is nothing to resend.
 */
export async function requeueRejectedDelivery(tx: Executor, order: OrderRow, at: Date): Promise<OrderRow | null> {
  const [outbox] = await tx
    .select()
    .from(integrationOutbox)
    .where(
      and(
        eq(integrationOutbox.aggregateType, ORDER_DELIVERY_AGGREGATE),
        eq(integrationOutbox.aggregateId, order.id),
        eq(integrationOutbox.operation, ORDER_DELIVERY_OPERATION),
      ),
    )
    .orderBy(desc(integrationOutbox.createdAt))
    .limit(1)
    .for('update');
  if (outbox === undefined || outbox.status !== 'rejected' || outbox.originId === null) return null;
  await tx
    .update(integrationOutbox)
    .set({ status: 'pending', nextAttemptAt: at, lastStep: 'verifying_origin', lastErrorClass: null, lastErrorMessage: null, updatedAt: at })
    .where(eq(integrationOutbox.id, outbox.id));
  const [row] = await tx
    .update(salesOrder)
    .set({ status: 'queued', version: order.version + 1, updatedAt: at })
    .where(eq(salesOrder.id, order.id))
    .returning();
  return row ?? null;
}

/**
 * D-Y: removes the delivery records of an order that is being deleted. Refuses (`busy`) when a delivery is still
 * live (pending, processing or unknown): a send may be queued, in flight or already in the ERP. Terminal rows
 * (rejected, with their dry-run records by cascade) are deleted with the order.
 */
export async function deleteOrderDeliveries(tx: Executor, orderId: string): Promise<'deleted' | 'busy'> {
  const live = await tx
    .select({ id: integrationOutbox.id })
    .from(integrationOutbox)
    .where(
      and(
        eq(integrationOutbox.aggregateType, ORDER_DELIVERY_AGGREGATE),
        eq(integrationOutbox.aggregateId, orderId),
        inArray(integrationOutbox.status, ['pending', 'processing', 'unknown']),
      ),
    )
    .limit(1);
  if (live.length > 0) return 'busy';
  await tx
    .delete(integrationOutbox)
    .where(and(eq(integrationOutbox.aggregateType, ORDER_DELIVERY_AGGREGATE), eq(integrationOutbox.aggregateId, orderId)));
  return 'deleted';
}
