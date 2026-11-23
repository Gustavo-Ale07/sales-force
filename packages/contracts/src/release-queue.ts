import { z } from 'zod';
import { DecimalStringSchema, IsoTimestampSchema, UuidSchema, codeInt, named, paginated, paginationQueryShape, queryInt } from './primitives.js';

/**
 * Release queue ("Aguardando liberação", docs/implementation/release-queue.md): orders sent to Sankhya that wait for a release
 * line (TSILIB) of Pedidos or Financeiro. READ ONLY: the release is done in Sankhya and the Force never writes it. The data is the
 * worker's mirror of the Sankhya stage read; nothing here carries cost, margin or a Sankhya credential. Sector names are
 * installation configuration (`erp.orderStage`), not an enum.
 */
export const ReleaseQueueQuerySchema = z.object({
  ...paginationQueryShape,
  /** Sector name; absent = every sector the caller may see. A sector the caller may not see is 403, never an empty list. */
  sector: z.string().min(1).max(60).optional(),
  sellerCode: queryInt(0).optional(),
  /** Sankhya user code (CODUSU) the line is assigned to. */
  assignedUserCode: queryInt(0).optional(),
});
export type ReleaseQueueQuery = z.infer<typeof ReleaseQueueQuerySchema>;

export const ReleaseQueueCountQuerySchema = z.object({ sector: z.string().min(1).max(60).optional() });
export type ReleaseQueueCountQuery = z.infer<typeof ReleaseQueueCountQuerySchema>;

export const WaitingSinceSourceSchema = named('WaitingSinceSource', z.enum(['sankhya_request', 'order_time']));
export type WaitingSinceSource = z.infer<typeof WaitingSinceSourceSchema>;

export const ReleaseQueueItemSchema = named(
  'ReleaseQueueItem',
  z.object({
    /** Unique note number in the ERP (the order note key): what the person searches in the Sankhya release screen. */
    nunota: z.number().int().min(1),
    orderId: UuidSchema,
    draftNumber: z.number().int().min(1),
    /** Sector that must release this line (a line of event 13 appears once per sector). */
    sector: z.string(),
    /** TSILIB.EVENTO and SEQCASCATA of the pending line, with the configured event name when there is one. */
    event: codeInt(),
    cascadeSequence: codeInt().nullable(),
    eventLabel: z.string().nullable(),
    customerCode: codeInt(),
    customerName: z.string(),
    sellerCode: codeInt().nullable(),
    sellerName: z.string().nullable(),
    /** Estimate from the Force order lines (list prices); the ERP computes the final value. */
    estimatedTotal: DecimalStringSchema,
    topCode: codeInt().nullable(),
    /** When the order was made in the Force. */
    orderedAt: IsoTimestampSchema,
    /** Waiting since: the TSILIB request time when validated and read, else the order time (see `waitingSinceSource`). */
    waitingSince: IsoTimestampSchema,
    waitingSinceSource: WaitingSinceSourceSchema,
    /** Whole minutes between `waitingSince` and the server time of the response. */
    waitingMinutes: z.number().int().min(0),
    /** When the Force first read this line as pending. */
    firstSeenAt: IsoTimestampSchema,
    /** Sankhya user the line is assigned to (TSILIB.CODUSULIB); null = not assigned or not readable. */
    assignedUserCode: codeInt().nullable(),
    /** Last successful Sankhya read of the order; a stale value means the queue may be out of date. */
    checkedAt: IsoTimestampSchema,
  }),
);
export type ReleaseQueueItem = z.infer<typeof ReleaseQueueItemSchema>;

export const ReleaseQueueResponseSchema = paginated('ReleaseQueueResponse', ReleaseQueueItemSchema);
export type ReleaseQueueResponse = z.infer<typeof ReleaseQueueResponseSchema>;

export const ReleaseQueueSectorCountSchema = named(
  'ReleaseQueueSectorCount',
  z.object({ sector: z.string(), count: z.number().int().min(0) }),
);

/** Counter of the menu: orders (not lines) waiting per sector the caller may see; `total` counts an order once. */
export const ReleaseQueueCountResponseSchema = named(
  'ReleaseQueueCountResponse',
  z.object({
    total: z.number().int().min(0),
    sectors: z.array(ReleaseQueueSectorCountSchema),
    /** Most recent successful Sankhya read among the counted orders; null when the queue is empty. */
    lastCheckedAt: IsoTimestampSchema.nullable(),
  }),
);
export type ReleaseQueueCountResponse = z.infer<typeof ReleaseQueueCountResponseSchema>;
