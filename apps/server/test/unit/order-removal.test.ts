import { describe, expect, it } from 'vitest';
import { decideRemoval, isSuspectBatch, type OrderPresence } from '../../src/integration/order-removal.js';

const live = { removed: false, missingChecks: 0 };

describe('RT-1 deleted-order detection rules', () => {
  it('needs two consecutive confirmed absences to remove', () => {
    expect(decideRemoval({ presence: 'absent', ...live }, false)).toEqual({ action: 'count', missingChecks: 1 });
    expect(decideRemoval({ presence: 'absent', removed: false, missingChecks: 1 }, false)).toEqual({ action: 'remove', missingChecks: 2 });
  });

  it('resets the counter on any found reading and restores a removed order', () => {
    expect(decideRemoval({ presence: 'found', removed: false, missingChecks: 1 }, false)).toEqual({ action: 'reset' });
    expect(decideRemoval({ presence: 'found', ...live }, false)).toEqual({ action: 'none' });
    expect(decideRemoval({ presence: 'found', removed: true, missingChecks: 2 }, false)).toEqual({ action: 'restore' });
  });

  it('never counts an unknown reading, a suspect batch or an on-demand refresh, and keeps the state', () => {
    expect(decideRemoval({ presence: 'unknown', removed: false, missingChecks: 1 }, false)).toEqual({ action: 'none' });
    expect(decideRemoval({ presence: 'absent', removed: false, missingChecks: 1 }, true)).toEqual({ action: 'none' });
    expect(decideRemoval({ presence: 'absent', removed: false, missingChecks: 1 }, false, false)).toEqual({ action: 'none' });
    expect(decideRemoval({ presence: 'absent', removed: true, missingChecks: 2 }, false)).toEqual({ action: 'none' });
  });

  it('flags a batch as suspect when it is partial or (almost) entirely absent', () => {
    const absent: OrderPresence[] = ['absent', 'absent', 'absent'];
    expect(isSuspectBatch(absent, 3)).toBe(true);
    expect(isSuspectBatch(['absent', 'found', 'found'], 3)).toBe(false);
    expect(isSuspectBatch(['absent', 'absent', 'found'], 3)).toBe(false);
    // Small batches are judged order by order.
    expect(isSuspectBatch(['absent', 'absent'], 2)).toBe(false);
    // Partial read: fewer readings than orders asked for.
    expect(isSuspectBatch(['found', 'found'], 3)).toBe(true);
    // 10 of 10 and 9 of 10 absent are mass events.
    expect(isSuspectBatch([...Array(9).fill('absent'), 'found'] as OrderPresence[], 10)).toBe(true);
    expect(isSuspectBatch([...Array(8).fill('absent'), 'found', 'found'] as OrderPresence[], 10)).toBe(false);
  });
});
