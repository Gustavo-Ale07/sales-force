import { z } from 'zod';
import { ApprovalLevelSchema } from './orders.js';
import { DecimalStringSchema, IsoTimestampSchema, UuidSchema, codeInt, named, paginated, paginationQueryShape } from './primitives.js';

/**
 * W-20: the discount approval queue (DISC-3, DISC-4, DISC-6). Online only; no push. A pending request waits for the
 * pool of its level: the manager role decides `manager` requests, the admin decides `director` requests (shown as
 * "Diretoria"). The queue only lists what the caller may decide.
 */
export const ApprovalQueueQuerySchema = z.object({ ...paginationQueryShape });
export type ApprovalQueueQuery = z.infer<typeof ApprovalQueueQuerySchema>;

export const ApprovalQueueItemSchema = named(
  'ApprovalQueueItem',
  z.object({
    approvalId: UuidSchema,
    orderId: UuidSchema,
    draftNumber: z.number().int().min(1),
    customerCode: codeInt(),
    customerName: z.string(),
    sellerCode: codeInt().nullable(),
    /** Display name of the draft owner (the account whose authority was exceeded). */
    ownerName: z.string(),
    requestedLevel: ApprovalLevelSchema,
    requestedAt: IsoTimestampSchema,
    estimatedTotal: DecimalStringSchema,
    itemCount: z.number().int().min(0),
    /** Highest line discount of the order, in percent: what the approver is being asked to accept. */
    maxDiscountPercent: DecimalStringSchema,
  }),
);
export type ApprovalQueueItem = z.infer<typeof ApprovalQueueItemSchema>;

export const ApprovalQueueResponseSchema = paginated('ApprovalQueueResponse', ApprovalQueueItemSchema);
export type ApprovalQueueResponse = z.infer<typeof ApprovalQueueResponseSchema>;

export const ApprovalPathSchema = z.object({ id: UuidSchema });

/** Optional on approval (DISC-6). */
export const ApproveApprovalRequestSchema = named(
  'ApproveApprovalRequest',
  z.strictObject({ comment: z.string().trim().max(500).optional() }),
);
export type ApproveApprovalRequest = z.infer<typeof ApproveApprovalRequestSchema>;

/** Mandatory on rejection (DISC-6): the seller reads it. */
export const RejectApprovalRequestSchema = named(
  'RejectApprovalRequest',
  z.strictObject({ comment: z.string().trim().min(1).max(500) }),
);
export type RejectApprovalRequest = z.infer<typeof RejectApprovalRequestSchema>;
