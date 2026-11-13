import { describe, expect, it } from 'vitest';
import { DraftIssueCodeSchema } from '../src/orders.js';

describe('DraftIssueCodeSchema', () => {
  it.each(['product_unavailable', 'product_inactive'])('accepts the send-block code %s reported in issues[]', (code) => {
    expect(DraftIssueCodeSchema.safeParse(code).success).toBe(true);
  });
});
