import { describe, expect, it } from 'vitest';
import { DraftIssueCodeSchema } from '../src/orders.js';
import { SyncRefreshStepSchema } from '../src/sync-refresh.js';

describe('mobility contract additions (owner ruling 2026-11-13)', () => {
  it('draft issue codes include product_without_price and product_without_mobility', () => {
    expect(DraftIssueCodeSchema.safeParse('product_without_price').success).toBe(true);
    expect(DraftIssueCodeSchema.safeParse('product_without_mobility').success).toBe(true);
  });

  it('a refresh step may carry visible/hidden counts per kind and the kept-previous flag', () => {
    const step = {
      entity: 'products',
      status: 'ok',
      durationMs: 10,
      reason: 'Mobilidade: o Sankhya ocultaria quase tudo; a base anterior foi mantida. Avise o TI.',
      lastSuccessAt: null,
      mobility: [{ kind: 'products', visible: 3, hidden: 97, keptPrevious: true }],
    };
    expect(SyncRefreshStepSchema.parse(step)).toEqual(step);
  });

  it('mobility is optional on a step (older rows)', () => {
    const step = { entity: 'carriers', status: 'ok', durationMs: 1, reason: null, lastSuccessAt: null };
    expect(SyncRefreshStepSchema.safeParse(step).success).toBe(true);
  });
});
