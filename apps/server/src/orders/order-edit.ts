import { integrationOutbox, salesOrder } from '@salesforce/db';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { uuidv7 } from '../platform/ids.js';
import type { Executor, OrderRow } from './orders.repository.js';

/**
 * "Editar pedido" (owner ruling 2026-11-27): an order already in Sankhya is edited by DELETING its unconfirmed note and
 * recreating it. The API only records the command (`integration_outbox`, operation `edit_order`) together with the edited,
 * already priced snapshot, and moves the order to `queued`. The worker revalidates eligibility live, deletes the old note
 * and only then applies the snapshot, so a refused edit leaves the order exactly as it was.
 */

export const ORDER_EDIT_OPERATION = 'edit_order';

/** The idempotency key of the command doubles as the outbox origin id (unique), distinct from the order's own origin id. */
export function editOriginId(clientRequestId: string): string {
  return `edit:${clientRequestId}`;
}

const DecimalText = z.string().regex(/^-?\d+(\.\d+)?$/);

export const OrderEditSnapshotSchema = z.object({
  header: z.object({
    customerCode: z.number().int(),
    sellerCode: z.number().int().nullable(),
    negotiationTypeCode: z.number().int().nullable(),
    topCode: z.number().int().nullable(),
    carrierCode: z.number().int().nullable(),
    freightType: z.string().nullable(),
    discountAboveLimitAccepted: z.boolean(),
    notes: z.string().nullable(),
    estimatedTotal: DecimalText,
    discountAuthority: z.string(),
    configVersionId: z.string().uuid(),
  }),
  items: z.array(
    z.object({
      lineNo: z.number().int().min(1),
      productCode: z.number().int(),
      productDescription: z.string(),
      unit: z.string(),
      quantity: DecimalText,
      unitListPrice: DecimalText.nullable(),
      priceState: z.enum(['priced', 'zero', 'none']),
      priceTableCode: z.number().int().nullable(),
      priceVersionId: z.number().int().nullable(),
      discountPercent: DecimalText,
      estimatedLineTotal: DecimalText.nullable(),
    }),
  ),
});
export type OrderEditSnapshot = z.infer<typeof OrderEditSnapshotSchema>;

export const OrderEditPayloadSchema = z.object({
  edit: z.object({
    /** NUNOTA being replaced; null = the order never became a note (rejected): editing is only sending the edited order again. */
    oldErpNumber: z.number().int().positive().nullable(),
    previousStatus: z.enum(['sent', 'rejected']),
    /** Who asked. Null only for the operator script (then `operator` names the person; never the order's creator). */
    actorAccountId: z.string().uuid().nullable(),
    operator: z.string().min(1).max(64).optional(),
    snapshot: OrderEditSnapshotSchema,
  }),
});
export type OrderEditPayload = z.infer<typeof OrderEditPayloadSchema>;

export type EnqueueEditResult = { readonly kind: 'queued'; readonly order: OrderRow } | { readonly kind: 'replay' };

/**
 * Records the edit command and queues the order. The same `clientRequestId` never queues twice (unique origin id): the second
 * call reports a replay. Runs inside the caller's transaction on the locked order row.
 */
export async function enqueueOrderEdit(
  tx: Executor,
  order: OrderRow,
  command: { readonly clientRequestId: string; readonly actorAccountId: string | null; readonly operator?: string; readonly snapshot: OrderEditSnapshot },
  at: Date,
): Promise<EnqueueEditResult> {
  if (order.status !== 'sent' && order.status !== 'rejected') throw new Error('Only a sent or rejected order can be edited');
  const payload: OrderEditPayload = {
    edit: {
      oldErpNumber: order.erpNumber,
      previousStatus: order.status,
      actorAccountId: command.actorAccountId,
      ...(command.operator === undefined ? {} : { operator: command.operator }),
      snapshot: command.snapshot,
    },
  };
  // The worker role cannot INSERT into the outbox: the order's own send_order row (same origin id, SNK-4) must exist before the
  // command does. A real order always has one; if it is missing it is recreated inert (rejected, never due) so the worker only UPDATEs it.
  const [send] = await tx
    .select({ id: integrationOutbox.id })
    .from(integrationOutbox)
    .where(and(eq(integrationOutbox.aggregateType, 'sales_order'), eq(integrationOutbox.operation, 'send_order'), eq(integrationOutbox.aggregateId, order.id)))
    .limit(1);
  if (send === undefined) {
    await tx.insert(integrationOutbox).values({
      id: uuidv7(at.getTime()),
      aggregateType: 'sales_order',
      aggregateId: order.id,
      operation: 'send_order',
      payload: {},
      originId: order.id,
      status: 'rejected',
      nextAttemptAt: null,
      createdAt: at,
      updatedAt: at,
    });
  }
  const inserted = await tx
    .insert(integrationOutbox)
    .values({
      id: uuidv7(at.getTime()),
      aggregateType: 'sales_order',
      aggregateId: order.id,
      operation: ORDER_EDIT_OPERATION,
      payload,
      originId: editOriginId(command.clientRequestId),
      status: 'pending',
      nextAttemptAt: at,
      createdAt: at,
      updatedAt: at,
    })
    .onConflictDoNothing({ target: integrationOutbox.originId })
    .returning({ id: integrationOutbox.id });
  if (inserted.length === 0) return { kind: 'replay' };
  const [row] = await tx
    .update(salesOrder)
    .set({ status: 'queued', version: order.version + 1, updatedAt: at })
    .where(eq(salesOrder.id, order.id))
    .returning();
  if (row === undefined) throw new Error('Order vanished during an update inside its own transaction');
  return { kind: 'queued', order: row };
}

/** The order an edit command with this key was recorded for, or null. */
export async function findEditCommandOrder(executor: Executor, clientRequestId: string): Promise<string | null> {
  const [existing] = await executor
    .select({ aggregateId: integrationOutbox.aggregateId })
    .from(integrationOutbox)
    .where(and(eq(integrationOutbox.operation, ORDER_EDIT_OPERATION), eq(integrationOutbox.originId, editOriginId(clientRequestId))));
  return existing?.aggregateId ?? null;
}
