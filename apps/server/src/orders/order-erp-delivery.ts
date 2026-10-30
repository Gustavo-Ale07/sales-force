import { integrationOutbox, salesOrder } from '@salesforce/db';
import { and, eq, inArray } from 'drizzle-orm';
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
 * D-5: the user cancels a queued order. Only a row still `pending` (the worker has not claimed it) can be
 * withdrawn; the update is atomic with the worker's claim. `processing`/`unknown` rows (a send may be in
 * flight or may already exist in the ERP) are never cancelled from here: `busy`.
 */
export async function withdrawPendingDelivery(tx: Executor, orderId: string, at: Date): Promise<'withdrawn' | 'busy'> {
  const withdrawn = await tx
    .update(integrationOutbox)
    .set({ status: 'rejected', lastErrorClass: 'cancelled_by_user', nextAttemptAt: null, lastStep: null, updatedAt: at })
    .where(
      and(
        eq(integrationOutbox.aggregateType, ORDER_DELIVERY_AGGREGATE),
        eq(integrationOutbox.aggregateId, orderId),
        eq(integrationOutbox.status, 'pending'),
      ),
    )
    .returning({ id: integrationOutbox.id });
  if (withdrawn.length > 0) return 'withdrawn';
  // No pending row: either a send is in flight/ambiguous (busy) or the order has no delivery row at all.
  const inFlight = await tx
    .select({ id: integrationOutbox.id })
    .from(integrationOutbox)
    .where(
      and(
        eq(integrationOutbox.aggregateType, ORDER_DELIVERY_AGGREGATE),
        eq(integrationOutbox.aggregateId, orderId),
        inArray(integrationOutbox.status, ['processing', 'unknown']),
      ),
    );
  return inFlight.length > 0 ? 'busy' : 'withdrawn';
}
