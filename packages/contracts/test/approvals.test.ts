import { describe, expect, it } from 'vitest';
import { canDecideApprovals, RejectApprovalRequestSchema, ApproveApprovalRequestSchema } from '../src/index.js';

describe('approval decision contracts (DISC-6)', () => {
  it('reject requires a non-blank comment of at most 500 characters', () => {
    expect(RejectApprovalRequestSchema.safeParse({}).success).toBe(false);
    expect(RejectApprovalRequestSchema.safeParse({ comment: '   ' }).success).toBe(false);
    expect(RejectApprovalRequestSchema.safeParse({ comment: 'x'.repeat(501) }).success).toBe(false);
    expect(RejectApprovalRequestSchema.safeParse({ comment: ' motivo ' }).data).toEqual({ comment: 'motivo' });
  });

  it('approve takes an optional comment and refuses unknown fields', () => {
    expect(ApproveApprovalRequestSchema.safeParse({}).success).toBe(true);
    expect(ApproveApprovalRequestSchema.safeParse({ comment: 'ok' }).success).toBe(true);
    expect(ApproveApprovalRequestSchema.safeParse({ comment: 'x'.repeat(501) }).success).toBe(false);
    expect(ApproveApprovalRequestSchema.safeParse({ level: 'director' }).success).toBe(false);
  });

  it('only manager and admin may see the approval queue', () => {
    expect(['admin', 'manager', 'seller', 'technical'].filter(canDecideApprovals)).toEqual(['admin', 'manager']);
  });
});
